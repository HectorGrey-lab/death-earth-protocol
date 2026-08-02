// Alliance smoke test — verifies the expanded Alliance feature set:
// roles data model, create/join/leave, set_role (founder only), alliance chat +
// officer chat (2 channels with role gating), founder broadcast mail, and the
// colony_state security fix (universe payload no longer leaks alliances/chat).
//
// Flow: spawn the real server with a temp JSON DB -> register 3 users over HTTP
// -> open 3 WS connections -> founder creates alliance -> officer joins -> promote
// to commander -> chat posting (member vs recruit gating) -> officer channel ->
// broadcast mail -> security check on colony_state payload.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');

const PORT = 3481;
const HOST = '127.0.0.1';

let failures = 0;
function expect(cond, label) {
  if (cond) console.log('  ✅ ' + label);
  else { console.log('  ❌ FAIL: ' + label); failures++; }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'de-alliance-'));
const DATA_DIR = path.join(tmpDir, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const serverProc = spawn(process.execPath, ['server/index.js'], {
  cwd: __dirname,
  env: Object.assign({}, process.env, { PORT: String(PORT), DATA_DIR })
});
let serverLog = '';
serverProc.stdout.on('data', d => { serverLog += d; });
serverProc.stderr.on('data', d => { serverLog += d; });
serverProc.on('exit', code => {
  if (process.exitCode === undefined) {
    console.error('SERVER EXITED EARLY code=' + code + '\n--- log ---\n' + serverLog);
    process.exit(1);
  }
});

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

function httpPost(apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      host: HOST, port: PORT, path: apiPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let out = '';
      res.on('data', d => { out += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(out)); } catch (e) { reject(new Error('bad json: ' + out)); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function connectWS(token) {
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
        waitForPred(pred, label, timeoutMs) {
          return new Promise((resolve2, reject2) => {
            for (let i = 0; i < messages.length; i++) {
              try {
                const parsed = JSON.parse(messages[i]);
                if (pred(parsed)) { messages.splice(i, 1); return resolve2(parsed); }
              } catch (e) {}
            }
            const t = setTimeout(() => reject2(new Error('timeout waiting for ' + label)), timeoutMs || 7000);
            waiters.push({ pred, resolve: m => { clearTimeout(t); resolve2(m); } });
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
        handshaken = true;
        buf = buf.slice(idx + 4);
        if (resolveClient) { resolveClient(makeClient()); resolveClient = null; }
      } else {
        buf = Buffer.concat([buf, d]);
      }
      let off = 0;
      while (off + 2 <= buf.length) {
        const op = buf[off] & 0x0f;
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
          const parsed = JSON.parse(text);
          for (let i = waiters.length - 1; i >= 0; i--) {
            if (waiters[i].pred(parsed)) {
              const w = waiters[i];
              waiters.splice(i, 1);
              // Consume the message too — it was delivered to this waiter, so
              // later waitForPred buffer scans must NOT re-match it.
              const idx = messages.lastIndexOf(text);
              if (idx !== -1) messages.splice(idx, 1);
              w.resolve(parsed);
            }
          }
        } else if (op === 8) { sock.end(); }
      }
      buf = buf.slice(off);
    });

    sock.on('error', reject);

    // Auth as soon as client is handed over
    const origResolve = resolve;
    resolve = function (client) {
      origResolve(client);
      client.send({ type: 'auth', token: token });
    };
    resolveClient = resolve;
  });
}

(async () => {
  console.log('── Alliance smoke test ──');
  await waitForPort(10000);
  console.log('   server up: ' + serverLog.split('\n').filter(l => /Server:|Players:/.test(l)).join(' | ').trim());

  // 1. Register 4 users via HTTP (4th used for dup-name + join tests)
  const r1 = await httpPost('/api/register', { username: 'all_founder', password: 'pass123', planetName: 'FPlanet' });
  const r2 = await httpPost('/api/register', { username: 'all_officer', password: 'pass123', planetName: 'OPlanet' });
  const r3 = await httpPost('/api/register', { username: 'all_recruit', password: 'pass123', planetName: 'RPlanet' });
  const r4 = await httpPost('/api/register', { username: 'all_other', password: 'pass123', planetName: 'XPlanet' });
  expect(!!r1.token && !!r2.token && !!r3.token && !!r4.token, '4 users registered with tokens');

  // 2. Open 4 WS connections
  const [f, o, rc, other] = await Promise.all([
    connectWS(r1.token), connectWS(r2.token), connectWS(r3.token), connectWS(r4.token)
  ]);

  // 3. Founder creates an alliance (reply carries colony; broadcasts do not)
  f.send({ type: 'alliance_create', name: 'Alpha Corps' });
  const created = await f.waitForPred(m => m.type === 'alliance_result' && m.colony, 'founder create result');
  expect(created.ok === true, 'founder creates alliance (ok)');
  const allId = created.alliances.find(a => a.name === 'Alpha Corps').id;
  const fMember = created.alliances.find(a => a.id === allId).members.find(m => m.username === 'all_founder');
  expect(fMember.role === 'founder', 'founder role is founder');
  expect(created.colony.alliance.joinedId === allId, 'colony alliance.joinedId set');

  // 4. Duplicate name rejected (use a user NOT in an alliance — the dup check runs after joinedId check)
  other.send({ type: 'alliance_create', name: 'alpha corps' });
  const dupRes = await other.waitForPred(m => m.type === 'alliance_result' && !m.ok && m.error, 'dup name rejected');
  expect(/already exists/.test(dupRes.error), 'duplicate name (case-insensitive) rejected');

  // 5. Officer joins (becomes recruit), then recruit joins
  o.send({ type: 'alliance_join', allianceId: allId });
  const joinedO = await o.waitForPred(m => m.type === 'alliance_result' && m.colony, 'officer join result');
  expect(joinedO.alliances.find(a => a.id === allId).members.some(m => m.username === 'all_officer' && m.role === 'recruit'), 'joiner gets recruit role');
  rc.send({ type: 'alliance_join', allianceId: allId });
  const joinedRc = await rc.waitForPred(m => m.type === 'alliance_result' && m.colony, 'recruit join result');
  expect(joinedRc.colony.alliance.joinedId === allId, 'recruit joined');

  // 6. Founder promotes officer -> commander
  f.send({ type: 'alliance_set_role', targetUsername: 'all_officer', role: 'commander' });
  const prom = await f.waitForPred(m => m.type === 'alliance_result' && m.colony && m.alliances && m.alliances.find(a => a.id === allId) && m.alliances.find(a => a.id === allId).members.some(x => x.username === 'all_officer' && x.role === 'commander'), 'promote result');
  expect(prom.ok === true, 'promotion ok');

  // 7. Non-founder cannot set roles
  rc.send({ type: 'alliance_set_role', targetUsername: 'all_officer', role: 'recruit' });
  const denyProm = await rc.waitForPred(m => m.type === 'alliance_result' && !m.ok, 'recruit promote denied');
  expect(/founder/.test(denyProm.error), 'non-founder role change blocked (only founder)');

  // 8. Chat: commander posts to alliance chat; recruit can read but not post
  o.send({ type: 'alliance_chat_send', channel: 'alliance', text: 'Welcome recruits!' });
  const chatMsg = await f.waitForPred(m => m.type === 'alliance_chat' && m.channel === 'alliance', 'alliance chat broadcast');
  expect(chatMsg.username === 'all_officer' && chatMsg.text === 'Welcome recruits!', 'chat message broadcast to alliance');

  rc.send({ type: 'alliance_chat_send', channel: 'alliance', text: 'hello' });
  const recruitBlock = await rc.waitForPred(m => m.type === 'alliance_result' && !m.ok, 'recruit post blocked');
  expect(/recruit/i.test(recruitBlock.error), 'recruits cannot post (read-only)');

  // 9. Officer channel: commander can post, recruit cannot even read it (no officers payload)
  o.send({ type: 'alliance_chat_send', channel: 'officers', text: 'secret plan' });
  const offMsg = await f.waitForPred(m => m.type === 'alliance_chat' && m.channel === 'officers', 'officer chat');
  expect(offMsg.text === 'secret plan', 'officer chat reaches founder');

  rc.send({ type: 'alliance_chat_send', channel: 'officers', text: 'sneaky' });
  const offBlock = await rc.waitForPred(m => m.type === 'alliance_result' && !m.ok, 'recruit officer chat blocked');
  expect(/officer/.test(offBlock.error), 'officer channel requires officer rank+');

  // 10. Broadcast mail: founder -> all
  f.send({ type: 'alliance_broadcast', audience: 'all', subject: 'War Drills', body: 'All hands prepare' });
  const bcast = await f.waitForPred(m => m.type === 'alliance_result' && m.ok && m.message, 'broadcast result');
  expect(/recipient/.test(bcast.message), 'broadcast sent to recipients (' + bcast.message + ')');

  // 11. Security fix: colony_state universe payload must NOT contain alliances or chat
  //     Predicate requires the alliances list so it can't match the recruit's stale
  //     pre-join auth colony_state (alliances: []) buffered from connect time.
  rc.send({ type: 'get_colony' });
  const state = await rc.waitForPred(m => m.type === 'colony_state' && Array.isArray(m.alliances) && m.alliances.length >= 1, 'recruit colony_state with alliances');
  expect(!state.universe.alliances, 'colony_state universe does not leak alliances');
  expect(!state.universe.chat, 'colony_state universe does not leak chat');
  expect(Array.isArray(state.alliances) && state.alliances.length >= 1, 'colony_state still carries public alliances list');

  // 12. Chat history delivered on auth (reconnect the officer)
  const o2 = await connectWS(r2.token);
  const hist = await o2.waitForPred(m => m.type === 'alliance_chat_history', 'officer chat history');
  expect(hist.allianceId === allId, 'chat history has allianceId');
  expect(hist.alliance.some(e => e.text === 'Welcome recruits!'), 'history includes earlier alliance chat');
  expect(Array.isArray(hist.officers) && hist.officers.some(e => e.text === 'secret plan'), 'officer sees officer channel history');
  o2.close();

  // 13. Leave: officer leaves -> members shrink
  o.send({ type: 'alliance_leave' });
  const left = await o.waitForPred(m => m.type === 'alliance_result' && m.colony, 'officer leave result');
  expect(left.colony.alliance.joinedId === null, 'colony cleared on leave');
  expect(!left.alliances.find(a => a.id === allId).members.some(m => m.username === 'all_officer'), 'member removed from roster');

  // 14. Founder transfer: founder leaves -> remaining member takes over
  f.send({ type: 'alliance_leave' });
  const transfer = await rc.waitForPred(m => m.type === 'alliance_result' && m.alliances && m.alliances.find(a => a.id === allId) && m.alliances.find(a => a.id === allId).founder === 'all_recruit', 'founder transfer broadcast');
  expect(transfer.ok === true, 'founder leave broadcast ok');
  const after = transfer.alliances.find(a => a.id === allId);
  expect(after.founder === 'all_recruit', 'founder transferred to remaining member (got ' + after.founder + ')');

  f.close(); o.close(); rc.close(); other.close();

  console.log('\nALLIANCE SMOKE TEST ' + (failures ? 'FAILED (' + failures + ')' : 'PASSED'));
  serverProc.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error('ALLIANCE SMOKE TEST ERROR: ' + e.stack);
  console.error('--- server log ---\n' + serverLog);
  serverProc.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(1);
});
