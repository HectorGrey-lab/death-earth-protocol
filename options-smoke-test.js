// Options smoke test: verifies profile_update (displayName/baseName), chat
// displayName propagation, logout token invalidation, and delete_account
// (confirm gate + full user removal) over raw WebSocket + HTTP.
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');

const PORT = 3457;
const HOST = '127.0.0.1';

function waitForPort(ms) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tryConnect = () => {
      const s = net.connect(PORT, HOST);
      s.on('connect', () => { s.destroy(); resolve(); });
      s.on('error', () => {
        s.destroy();
        if (Date.now() - t0 > ms) return reject(new Error('server did not come up in ' + ms + 'ms'));
        setTimeout(tryConnect, 250);
      });
    };
    tryConnect();
  });
}

const serverProc = spawn(process.execPath, ['server/index.js'], {
  cwd: __dirname,
  env: Object.assign({}, process.env, { PORT: String(PORT) })
});
let serverLog = '';
let testFinished = false;
serverProc.stdout.on('data', d => { serverLog += d; });
serverProc.stderr.on('data', d => { serverLog += d; });
serverProc.on('exit', (code) => {
  if (!testFinished) {
    console.error('SERVER EXITED EARLY code=' + code + '\n--- log ---\n' + serverLog);
    process.exit(1);
  }
});

function post(path, body, headers) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const hdrs = Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, headers || {});
    const req = http.request({ host: HOST, port: PORT, path, method: 'POST', headers: hdrs }, res => {
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

function connectWS() {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PORT, HOST);
    const key = crypto.randomBytes(16).toString('base64');
    let handshaken = false;
    let buf = Buffer.alloc(0);
    const messages = [];
    const waiters = [];
    let resolveClient = null;

    sock.on('connect', () => {
      sock.write(
        'GET /ws HTTP/1.1\r\n' +
        'Host: ' + HOST + ':' + PORT + '\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });

    function makeClient() {
      return {
        send(obj) {
          const payload = Buffer.from(JSON.stringify(obj), 'utf8');
          let header;
          if (payload.length < 126) { header = Buffer.alloc(2); header[0] = 0x81; header[1] = payload.length; }
          else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
          sock.write(Buffer.concat([header, payload]));
        },
        waitFor(type, timeoutMs) {
          return new Promise((resolve, reject) => {
            for (let i = 0; i < messages.length; i++) {
              try {
                const parsed = JSON.parse(messages[i]);
                if (parsed.type === type) { messages.splice(i, 1); return resolve(parsed); }
              } catch (e) {}
            }
            const t = setTimeout(() => reject(new Error('timeout waiting for ' + type)), timeoutMs || 5000);
            waiters.push({ type, resolve: m => { clearTimeout(t); resolve(m); } });
          });
        },
        waitForPred(pred, label, timeoutMs) {
          return new Promise((resolve, reject) => {
            for (let i = 0; i < messages.length; i++) {
              try {
                const parsed = JSON.parse(messages[i]);
                if (pred(parsed)) { messages.splice(i, 1); return resolve(parsed); }
              } catch (e) {}
            }
            const t = setTimeout(() => reject(new Error('timeout waiting for ' + label)), timeoutMs || 6000);
            waiters.push({ type: '__pred__', label, pred, resolve: m => { clearTimeout(t); resolve(m); } });
          });
        },
        close() { sock.end(); }
      };
    }

    sock.on('data', d => {
      if (!handshaken) {
        buf = Buffer.concat([buf, d]);
        const idx = buf.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const head = buf.slice(0, idx).toString();
        if (!/101 Switching Protocols/.test(head)) return reject(new Error('handshake failed: ' + head.split('\r\n')[0]));
        if (!/Sec-WebSocket-Accept:/.test(head)) return reject(new Error('missing accept key'));
        handshaken = true;
        buf = buf.slice(idx + 4);
        if (resolveClient) { resolveClient(makeClient()); resolveClient = null; }
      } else {
        buf = Buffer.concat([buf, d]);
      }
      let off = 0;
      while (off + 2 <= buf.length) {
        const fin = buf[off] & 0x80, op = buf[off] & 0x0f;
        const lenB = buf[off + 1] & 0x7f;
        let len = lenB, ext = 0;
        if (lenB === 126) { len = buf.readUInt16BE(off + 2); ext = 2; }
        else if (lenB === 127) { len = Number(buf.readBigUInt64BE(off + 2)); ext = 8; }
        if (off + 2 + ext + len > buf.length) break;
        const payload = buf.slice(off + 2 + ext, off + 2 + ext + len);
        off += 2 + ext + len;
        if (op === 1) {
          const text = payload.toString('utf8');
          messages.push(text);
          for (let i = waiters.length - 1; i >= 0; i--) {
            const w = waiters[i];
            const parsed = JSON.parse(text);
            if (w.type === '__pred__') {
              if (w.pred(parsed)) { waiters.splice(i, 1); w.resolve(parsed); }
            } else if (parsed.type === w.type) {
              waiters.splice(i, 1); w.resolve(parsed);
            }
          }
        } else if (op === 8) { sock.end(); }
      }
      buf = buf.slice(off);
    });

    sock.on('error', reject);
    resolveClient = resolve;
  });
}

function expect(cond, label) {
  if (cond) { console.log('  ✅ ' + label); }
  else { console.log('  ❌ FAIL: ' + label); process.exitCode = 1; }
}

(async () => {
  const t0 = Date.now();
  const uname = 'opttest_' + t0;

  console.log('0. Waiting for server to come up...');
  await waitForPort(10000);
  console.log('   server up');

  console.log('1. Register + auth...');
  const reg = await post('/api/register', { username: uname, password: 'test1234' });
  expect(reg.ok && reg.token, 'register -> token');
  const ws = await connectWS();
  ws.send({ type: 'auth', token: reg.token });
  const authOk = await ws.waitFor('auth_ok', 5000);
  expect(authOk.username === uname, 'auth_ok');

  console.log('2. profile_update (displayName + baseName)...');
  ws.send({ type: 'profile_update', displayName: 'Opt Commander', baseName: 'New Base' });
  const pu = await ws.waitFor('profile_update_result', 5000);
  expect(pu.ok === true, 'profile_update ok');
  expect(pu.colony && pu.colony.profile && pu.colony.profile.displayName === 'Opt Commander', 'colony.profile.displayName set');
  expect(pu.colony && pu.colony.profile && pu.colony.profile.baseName === 'New Base', 'colony.profile.baseName set');
  expect(pu.colony && pu.colony.planetName === 'New Base', 'colony.planetName updated to base name');

  console.log('3. Invalid names rejected...');
  ws.send({ type: 'profile_update', displayName: 'x', baseName: 'New Base' });
  const bad1 = await ws.waitForPred(m => m.type === 'profile_update_result' && m.ok === false && /Display name/.test(m.error || ''), 'short displayName rejected', 5000);
  expect(true, 'short displayName rejected (got error: ' + bad1.error + ')');
  ws.send({ type: 'profile_update', displayName: 'Bad Name!!', baseName: 'New Base' });
  const bad2 = await ws.waitForPred(m => m.type === 'profile_update_result' && m.ok === false && /letters, numbers/.test(m.error || ''), 'invalid chars rejected', 5000);
  expect(true, 'invalid chars rejected (got error: ' + bad2.error + ')');

  console.log('4. Chat message carries displayName...');
  ws.send({ type: 'chat', text: 'hello from opt test' });
  const chatMsg = await ws.waitForPred(
    m => m.type === 'chat' && /opt test/.test(m.text || ''),
    'chat echo', 5000
  );
  expect(chatMsg.username === uname, 'chat carries login username');
  expect(chatMsg.displayName === 'Opt Commander', 'chat carries displayName');

  console.log('5. Leaderboard entry has displayName (fresh 30s broadcast)...');
  // Boost colony via admin API so the user is guaranteed in the top-20
  // population leaderboard (JSON DB persists test users across runs).
  const adminLogin = await post('/api/admin/login', { password: 'thegreyzone' });
  expect(adminLogin.ok === true, 'admin login');
  const boost = await post('/api/admin/players/' + uname + '/buildings', {
    set: { extractionGrid: 50, defenseBunker: 50 }
  }, { 'Authorization': 'Bearer ' + adminLogin.token });
  expect(boost.ok === true, 'admin building boost applied');
  // auth-time broadcast was computed before profile_update; wait for a NEW one
  const lb = await ws.waitForPred(
    m => m.type === 'leaderboard' && (m.data && m.data.population || []).some(function(e) { return e.name === uname && e.displayName === 'Opt Commander'; }),
    'leaderboard with displayName', 40000
  );
  expect(true, 'leaderboard entry carries displayName');

  console.log('6. Logout invalidates token...');
  ws.send({ type: 'logout' });
  const lo = await ws.waitFor('logout_ok', 5000);
  expect(lo.type === 'logout_ok', 'logout_ok received');
  await new Promise(r => setTimeout(r, 300));
  const ws2 = await connectWS();
  ws2.send({ type: 'auth', token: reg.token });
  const authErr = await ws2.waitForPred(
    m => m.type === 'auth_error' || m.type === 'auth_ok',
    'auth result after logout', 5000
  );
  expect(authErr.type === 'auth_error', 'old token rejected after logout (got ' + authErr.type + ')');
  ws2.close();

  console.log('7. delete_account requires confirm=DELETE (fresh user)...');
  const uname2 = 'opttest2_' + t0;
  const reg2 = await post('/api/register', { username: uname2, password: 'test1234' });
  expect(reg2.ok && reg2.token, 'register user2');
  const ws3 = await connectWS();
  ws3.send({ type: 'auth', token: reg2.token });
  await ws3.waitFor('auth_ok', 5000);
  ws3.send({ type: 'delete_account', confirm: 'NOPE' });
  const daBad = await ws3.waitForPred(m => m.type === 'delete_account_result' && m.ok === false, 'wrong confirm rejected', 5000);
  expect(true, 'wrong confirm rejected (got error: ' + daBad.error + ')');

  console.log('8. delete_account with correct confirm removes user...');
  ws3.send({ type: 'delete_account', confirm: 'DELETE' });
  const da = await ws3.waitForPred(m => m.type === 'delete_account_result' && m.ok === true, 'delete_account ok', 5000);
  expect(true, 'delete_account ok');
  await new Promise(r => setTimeout(r, 300));
  const login2 = await post('/api/login', { username: uname2, password: 'test1234' });
  expect(login2.ok !== true, 'login fails after account deletion');

  console.log('\nOPTIONS SMOKE TEST ' + (process.exitCode ? 'FAILED' : 'PASSED'));
  testFinished = true;
  serverProc.kill();
  setTimeout(() => process.exit(process.exitCode || 0), 300);
})().catch(e => { console.error('OPTIONS SMOKE TEST ERROR: ' + e.message); testFinished = true; serverProc.kill(); process.exit(1); });
