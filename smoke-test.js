// Smoke test: spawns the server as a child process, then verifies
// the presence + colony_state + universe-coords flow over raw WebSocket.
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');

const PORT = 3456;
const HOST = '127.0.0.1';

// ── Spawn server and wait until the port accepts connections ──
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
serverProc.stdout.on('data', d => { serverLog += d; });
serverProc.stderr.on('data', d => { serverLog += d; });
serverProc.on('exit', (code) => {
  if (process.exitCode === undefined) {
    console.error('SERVER EXITED EARLY code=' + code + '\n--- log ---\n' + serverLog);
    process.exit(1);
  }
});

function post(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: HOST, port: PORT, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
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
            // already buffered?
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
        // Consume messages until `pred` matches one; skips stale ones of the same type.
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
        buf = buf.slice(idx + 4); // keep frames that arrived with the header
        if (resolveClient) { resolveClient(makeClient()); resolveClient = null; }
      } else {
        buf = Buffer.concat([buf, d]);
      }
      // parse frames (server->client unmasked), keep partial tail buffered
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

    // Resolve the connect promise only after the 101 handshake completes
    // so callers can immediately send auth without racing the upgrade.
    resolveClient = resolve;
  });
}

function expect(cond, label) {
  if (cond) { console.log('  ✅ ' + label); }
  else { console.log('  ❌ FAIL: ' + label); process.exitCode = 1; }
}

(async () => {
  const t0 = Date.now();
  const unameA = 'smoketestA_' + t0;
  const unameB = 'smoketestB_' + t0;

  console.log('0. Waiting for server to come up...');
  await waitForPort(10000);
  console.log('   server up (' + serverLog.split('\n').filter(l => /Server:|World loop/.test(l)).join(' | ') + ')');

  console.log('1. Register two users via HTTP...');
  const regA = await post('/api/register', { username: unameA, password: 'test1234' });
  const regB = await post('/api/register', { username: unameB, password: 'test1234' });
  expect(regA.ok && regA.token, 'register A -> token');
  expect(regB.ok && regB.token, 'register B -> token');

  console.log('2. Connect WS client A, authenticate...');
  const a = await connectWS();
  a.send({ type: 'auth', token: regA.token });
  const authOk = await a.waitFor('auth_ok', 5000);
  expect(authOk.username === unameA, 'auth_ok for A');

  console.log('3. colony_state: universe coords backfill...');
  const csA = await a.waitFor('colony_state', 5000);
  const gals = csA.universe && csA.universe.galaxies || [];
  expect(gals.length > 0, 'colony_state includes ' + gals.length + ' galaxies');
  const missingCoords = gals.filter(g => typeof g.universeX !== 'number' || typeof g.universeY !== 'number').length;
  expect(missingCoords === 0, 'all galaxies have universeX/universeY (' + missingCoords + ' missing)');
  const missingIndex = gals.filter(g => typeof g.index !== 'number').length;
  expect(missingIndex === 0, 'all galaxies have index (' + missingIndex + ' missing)');

  console.log('4. Presence: A alone -> 1 player...');
  const pres1 = await a.waitFor('presence', 5000);
  expect(Array.isArray(pres1.players) && pres1.players.length === 1, 'presence with 1 player (got ' + (pres1.players || []).length + ')');
  expect(pres1.players[0] && pres1.players[0].username === unameA, 'presence lists A with username');
  expect(pres1.players[0] && pres1.players[0].galaxyId, 'presence entry has galaxyId');

  console.log('5. Connect WS client B -> presence broadcast to A has 2...');
  const b = await connectWS();
  b.send({ type: 'auth', token: regB.token });
  await b.waitFor('auth_ok', 5000);
  const pres2 = await a.waitForPred(
    m => m.type === 'presence' && Array.isArray(m.players) && m.players.length === 2,
    'presence with 2 players', 6000
  );
  expect(Array.isArray(pres2.players) && pres2.players.length === 2, 'A receives presence with 2 players (got ' + (pres2.players || []).length + ')');
  const names = pres2.players.map(p => p.username).sort();
  expect(names.join(',') === [unameA, unameB].sort().join(','), 'both usernames present: ' + names.join(', '));
  const allHaveCoords = pres2.players.every(p => p.galaxyId && p.sectorId && p.planetId);
  expect(allHaveCoords, 'every presence entry has galaxyId+sectorId+planetId');

  console.log('6. Close B -> A receives presence with 1 player again...');
  b.close();
  const pres3 = await a.waitForPred(
    m => m.type === 'presence' && Array.isArray(m.players) && m.players.length === 1,
    'presence with 1 player after B leaves', 6000
  );
  expect(Array.isArray(pres3.players) && pres3.players.length === 1, 'presence back to 1 player after B leaves (got ' + (pres3.players || []).length + ')');

  a.close();
  console.log('\nSMOKE TEST ' + (process.exitCode ? 'FAILED' : 'PASSED'));
  serverProc.kill();
  // give the child a moment to flush, then exit with our code
  setTimeout(() => process.exit(process.exitCode || 0), 300);
})().catch(e => { console.error('SMOKE TEST ERROR: ' + e.message); serverProc.kill(); process.exit(1); });
