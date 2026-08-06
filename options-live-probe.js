// Live production probe for Options features — raw WS against Railway.
// Verifies: register -> auth -> profile_update -> logout token invalidation
//           -> fresh user -> delete_account confirm gate + cleanup.
// Mirrors options-smoke-test.js but targets the LIVE server over wss://.
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const HOST = 'death-earth-protocol-production.up.railway.app';
const WSS_PORT = 443;

function post(path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const hdrs = Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers || {});
    const req = https.request({ host: HOST, port: 443, path, method: 'POST', headers: hdrs }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error('bad json: ' + buf)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Minimal RFC6455 client over TLS
function connectWS() {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = require('tls').connect({ host: HOST, port: WSS_PORT, servername: HOST }, () => {
      sock.write(
        'GET / HTTP/1.1\r\n' +
        'Host: ' + HOST + '\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });
    let buf = Buffer.alloc(0);
    let handshaken = false;
    const messages = [];
    const waiters = [];
    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshaken) {
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const head = buf.slice(0, idx).toString();
        if (!/101/.test(head)) return reject(new Error('handshake failed: ' + head.split('\r\n')[0]));
        buf = buf.slice(idx + 4);
        handshaken = true;
        resolve({
          send(obj) {
            const data = Buffer.from(JSON.stringify(obj));
            let mask = crypto.randomBytes(4);
            let header;
            if (data.length < 126) {
              header = Buffer.from([0x81, 0x80 | data.length]);
            } else if (data.length < 65536) {
              header = Buffer.alloc(4);
              header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2);
            } else {
              header = Buffer.alloc(10);
              header[0] = 0x81; header[1] = 0x80 | 127; header.writeUInt32BE(0, 2); header.writeUInt32BE(data.length, 6);
            }
            const masked = Buffer.alloc(data.length);
            for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
            sock.write(Buffer.concat([header, mask, masked]));
          },
          waitFor(type, timeoutMs) {
            return new Promise((res2, rej2) => {
              const t = setTimeout(() => rej2(new Error('timeout waiting for ' + type)), timeoutMs || 8000);
              for (let i = 0; i < messages.length; i++) {
                let m; try { m = JSON.parse(messages[i]); } catch (e) { continue; }
                if (m.type === type) { clearTimeout(t); messages.splice(i, 1); return res2(m); }
              }
              waiters.push({ type, resolve: (m) => { clearTimeout(t); res2(m); } });
            });
          },
          waitForPred(pred, label, timeoutMs) {
            return new Promise((res2, rej2) => {
              const t = setTimeout(() => rej2(new Error('timeout waiting for ' + label)), timeoutMs || 8000);
              for (let i = 0; i < messages.length; i++) {
                let m; try { m = JSON.parse(messages[i]); } catch (e) { continue; }
                if (pred(m)) { clearTimeout(t); messages.splice(i, 1); return res2(m); }
              }
              waiters.push({ pred, resolve: (m) => { clearTimeout(t); res2(m); } });
            });
          },
          close() { sock.end(); }
        });
        return;
      }
      // parse frames
      while (buf.length >= 2) {
        const b0 = buf[0], b1 = buf[1];
        const len = b1 & 0x7f;
        let off = 2;
        let realLen = len;
        if (len === 126) { if (buf.length < 4) return; realLen = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; realLen = Number(buf.readBigUInt64BE(2)); off = 10; }
        const masked = (b1 & 0x80) !== 0;
        if (masked) { if (buf.length < off + 4) return; off += 4; }
        if (buf.length < off + realLen) return;
        const payload = buf.slice(off, off + realLen);
        buf = buf.slice(off + realLen);
        const opcode = b0 & 0x0f;
        if (opcode === 8) { sock.end(); return; } // close
        if (opcode === 1) {
          const text = payload.toString('utf8');
          messages.push(text);
          for (let i = waiters.length - 1; i >= 0; i--) {
            const w = waiters[i];
            let m; try { m = JSON.parse(text); } catch (e) { continue; }
            if (w.pred) { if (w.pred(m)) { waiters.splice(i, 1); w.resolve(m); } }
            else if (m.type === w.type) { waiters.splice(i, 1); w.resolve(m); }
          }
        }
      }
    });
    sock.on('error', reject);
  });
}

function expect(cond, label) {
  if (cond) { console.log('  ✅ ' + label); }
  else { console.log('  ❌ FAIL: ' + label); process.exitCode = 1; }
}

(async function () {
  const t0 = Date.now();
  const uname = 'lb_opts_' + t0;

  console.log('1. register (live)...');
  const reg = await post('/api/register', { username: uname, password: 'verifypass123' });
  expect(reg.token && reg.username === uname, 'register -> token');

  console.log('2. auth + profile_update (live)...');
  const ws = await connectWS();
  ws.send({ type: 'auth', token: reg.token });
  await ws.waitFor('auth_ok', 10000);
  ws.send({ type: 'profile_update', displayName: 'Live Options Tester', baseName: 'New Home' });
  const pu = await ws.waitForPred(m => m.type === 'profile_update_result', 'profile_update_result', 10000);
  expect(pu.ok === true, 'profile_update ok');
  expect(pu.colony && pu.colony.profile && pu.colony.profile.displayName === 'Live Options Tester', 'colony.profile.displayName set');
  expect(pu.colony && pu.colony.planetName === 'New Home', 'colony.planetName updated to base name');

  console.log('3. invalid name rejected (live)...');
  ws.send({ type: 'profile_update', displayName: '!!bad name!!', baseName: 'New Home' });
  const bad = await ws.waitForPred(m => m.type === 'profile_update_result' && m.ok === false, 'invalid name rejected', 10000);
  expect(bad.ok === false, 'invalid chars rejected (got: ' + (bad.error || 'n/a') + ')');

  console.log('4. chat carries displayName (live)...');
  ws.send({ type: 'chat', text: 'hello from live options probe' });
  const chatMsg = await ws.waitForPred(m => m.type === 'chat' && m.text && m.text.indexOf('hello from live options probe') !== -1, 'chat echo', 10000);
  expect(chatMsg.username === uname, 'chat carries login username');
  expect(chatMsg.displayName === 'Live Options Tester', 'chat carries displayName');

  console.log('5. logout invalidates token (live)...');
  ws.send({ type: 'logout' });
  await ws.waitFor('logout_ok', 10000);
  const ws2 = await connectWS();
  ws2.send({ type: 'auth', token: reg.token });
  const badAuth = await ws2.waitForPred(m => m.type === 'auth_error' || m.type === 'error', 'auth error after logout', 10000);
  expect(!!badAuth, 'old token rejected after logout (got ' + badAuth.type + ')');
  ws2.close();

  console.log('6. delete_account confirm gate + cleanup (live)...');
  const uname2 = 'lb_opts2_' + t0;
  const reg2 = await post('/api/register', { username: uname2, password: 'verifypass123' });
  expect(reg2.token ? true : false, 'register user2');
  const ws3 = await connectWS();
  ws3.send({ type: 'auth', token: reg2.token });
  await ws3.waitFor('auth_ok', 10000);
  ws3.send({ type: 'delete_account', confirm: 'wrong' });
  const wrong = await ws3.waitForPred(m => m.type === 'delete_account_result' && m.ok === false, 'wrong confirm rejected', 10000);
  expect(wrong.ok === false, 'wrong confirm rejected (got: ' + (wrong.error || 'n/a') + ')');
  ws3.send({ type: 'delete_account', confirm: 'DELETE' });
  const da = await ws3.waitForPred(m => m.type === 'delete_account_result' && m.ok === true, 'delete ok', 10000);
  expect(da.ok === true, 'delete_account ok');
  ws3.close();

  const login2 = await post('/api/login', { username: uname2, password: 'verifypass123' });
  expect(!login2.ok, 'login fails after account deletion');
  console.log('\nLIVE OPTIONS PROBE ' + (process.exitCode ? 'FAILED' : 'PASSED'));
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('LIVE OPTIONS PROBE ERROR: ' + e.message); process.exit(1); });
