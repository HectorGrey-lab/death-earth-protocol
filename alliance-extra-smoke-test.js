// Alliance Extra Features smoke test — verifies Part A of the alliance update:
// MOTD (founder + officer-with-perm), audit log (officer+ with canViewAudit),
// granular perms (founder only, broadcast to members via alliance_update),
// kick (founder always; commander/officer per role perms + target mail + audit).
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');

const PORT = 3482;
const HOST = '127.0.0.1';

let failures = 0;
function expect(cond, label) {
  if (cond) console.log('  ✅ ' + label);
  else { console.log('  ❌ FAIL: ' + label); failures++; }
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'de-alliance-x-'));
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
            // Scan buffered messages FIRST (most recent first so stale ones don't shadow)
            for (let i = messages.length - 1; i >= 0; i--) {
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

    const origResolve = resolve;
    resolve = function (client) {
      origResolve(client);
      client.send({ type: 'auth', token: token });
    };
    resolveClient = resolve;
  });
}

(async () => {
  console.log('── Alliance Extra Features smoke test ──');
  await waitForPort(10000);
  console.log('   server up: ' + serverLog.split('\n').filter(l => /Server:|Players:/.test(l)).join(' | ').trim());

  // 1. Register 4 users: founder, commander (promoted), member, recruit
  const r1 = await httpPost('/api/register', { username: 'ax_founder', password: 'pass123', planetName: 'FP' });
  const r2 = await httpPost('/api/register', { username: 'ax_commander', password: 'pass123', planetName: 'CP' });
  const r3 = await httpPost('/api/register', { username: 'ax_member', password: 'pass123', planetName: 'MP' });
  const r4 = await httpPost('/api/register', { username: 'ax_recruit', password: 'pass123', planetName: 'RP' });
  expect(!!r1.token && !!r2.token && !!r3.token && !!r4.token, '4 users registered with tokens');

  const [f, c, m, rc] = await Promise.all([
    connectWS(r1.token), connectWS(r2.token), connectWS(r3.token), connectWS(r4.token)
  ]);

  // 2. Founder creates alliance
  f.send({ type: 'alliance_create', name: 'X Corps' });
  const created = await f.waitForPred(m2 => m2.type === 'alliance_result' && m2.colony, 'founder create result');
  expect(created.ok === true, 'founder creates alliance');
  const allId = created.alliances.find(a => a.name === 'X Corps').id;

  // 3. Others join; promote commander->commander
  for (const cl of [c, m, rc]) {
    cl.send({ type: 'alliance_join', allianceId: allId });
    await cl.waitForPred(m2 => m2.type === 'alliance_result' && m2.colony, 'join result');
  }
  f.send({ type: 'alliance_set_role', targetUsername: 'ax_commander', role: 'commander' });
  const prom = await f.waitForPred(m2 => m2.type === 'alliance_result' && m2.ok && m2.alliances && m2.alliances.find(a => a.id === allId) && m2.alliances.find(a => a.id === allId).members.some(x => x.username === 'ax_commander' && x.role === 'commander'), 'promote commander');
  expect(prom.ok === true, 'commander promoted (member + recruit stay)');

  // 4. MOTD: founder sets it — audit entry + alliance_update broadcast carries motd
  f.send({ type: 'alliance_set_motd', motd: 'Welcome to X Corps!' });
  const motdRes = await f.waitForPred(m2 => m2.type === 'alliance_result' && m2.message === 'MOTD updated', 'motd result');
  expect(motdRes.ok === true, 'founder sets MOTD');
  const upd1 = await f.waitForPred(m2 => m2.type === 'alliance_update' && m2.alliancePublic && m2.alliancePublic.motd === 'Welcome to X Corps!', 'alliance_update with motd');
  expect(!!upd1, 'alliance_update broadcast carries new MOTD');
  expect(upd1.alliancePublic.perms && typeof upd1.alliancePublic.perms.officer.canEditMotd === 'boolean', 'alliance_update carries perms object');

  // 5. MOTD gating: recruit denied, commander denied (canEditMotd default false)
  rc.send({ type: 'alliance_set_motd', motd: 'hacked' });
  const rcMotd = await rc.waitForPred(m2 => m2.type === 'alliance_result' && /permission/i.test(m2.error || ''), 'recruit motd denied');
  expect(rcMotd.ok === false, 'recruit cannot set MOTD');
  c.send({ type: 'alliance_set_motd', motd: 'hacked2' });
  const cMotd = await c.waitForPred(m2 => m2.type === 'alliance_result' && /permission/i.test(m2.error || ''), 'commander motd denied default');
  expect(cMotd.ok === false, 'commander cannot set MOTD without canEditMotd');

  // 6. Perms: founder enables officer.canEditMotd + officer.canKickRecruits + officer.canBroadcastOfficers + commander.canKickMembers
  f.send({ type: 'alliance_set_perms', perms: {
    officer: { canEditMotd: true, canKickRecruits: true, canBroadcastOfficers: true },
    commander: { canKickMembers: true, canPromoteToOfficer: true }
  }});
  const permsRes = await f.waitForPred(m2 => m2.type === 'alliance_result' && m2.message === 'Permissions updated', 'set_perms result');
  expect(permsRes.ok === true, 'founder sets granular perms');
  const upd2 = await f.waitForPred(m2 => m2.type === 'alliance_update' && m2.alliancePublic && m2.alliancePublic.perms && m2.alliancePublic.perms.officer.canEditMotd === true, 'perms update broadcast');
  expect(upd2.alliancePublic.perms.commander.canKickMembers === true, 'commander perms broadcast in alliance_update');
  expect(upd2.alliancePublic.perms.officer.canBroadcastOfficers === true, 'officer broadcast perm broadcast');
  expect(upd2.alliancePublic.perms.commander.canKickRecruits === true, 'commander canKickRecruits defaults true (spec Phase 1)');

  // 7. Perms gating: recruit cannot set_perms, commander cannot either (founder only)
  rc.send({ type: 'alliance_set_perms', perms: { officer: { canEditMotd: true } } });
  const rcPerms = await rc.waitForPred(m2 => m2.type === 'alliance_result' && /founder/i.test(m2.error || ''), 'recruit perms denied');
  expect(rcPerms.ok === false, 'recruit cannot set perms');
  c.send({ type: 'alliance_set_perms', perms: { officer: { canEditMotd: true } } });
  const cP = await c.waitForPred(m2 => m2.type === 'alliance_result' && /founder/i.test(m2.error || ''), 'commander perms denied');
  expect(cP.ok === false, 'commander cannot set perms (founder only)');

  // 8. MOTD now allowed for commander (perm granted) + audit recorded
  c.send({ type: 'alliance_set_motd', motd: 'Commander says hi' });
  const cMotdOk = await c.waitForPred(m2 => m2.type === 'alliance_result' && m2.message === 'MOTD updated', 'commander motd allowed');
  expect(cMotdOk.ok === true, 'commander can set MOTD after perm grant');

  // 9. Audit log: founder + commander can read (canViewAudit default true); recruit denied
  f.send({ type: 'alliance_get_audit', limit: 100 });
  const fAudit = await f.waitForPred(m2 => m2.type === 'alliance_audit' && m2.ok, 'founder audit');
  const auditActions = fAudit.entries.map(e => e.action);
  expect(auditActions.includes('create'), 'audit has create entry');
  expect(auditActions.includes('join'), 'audit has join entries');
  expect(auditActions.includes('set_role'), 'audit has set_role entry');
  expect(auditActions.includes('motd_update'), 'audit has motd_update entry');
  expect(auditActions.includes('set_perms'), 'audit has set_perms entry');
  expect(fAudit.entries.length <= 100, 'audit respects limit');
  rc.send({ type: 'alliance_get_audit', limit: 100 });
  const rcAudit = await rc.waitForPred(m2 => m2.type === 'alliance_result' && /permission/i.test(m2.error || ''), 'recruit audit denied');
  expect(rcAudit.ok === false, 'recruit cannot read audit log');

  // 10. Broadcast gating: commander (officer-rank) can broadcast to officers (perm on); cannot to all
  c.send({ type: 'alliance_broadcast', audience: 'officers', subject: 'Ops', body: 'be ready' });
  const cBcast = await c.waitForPred(m2 => m2.type === 'alliance_result' && m2.ok && /recipient/i.test(m2.message || ''), 'commander officer broadcast');
  expect(cBcast.ok === true, 'commander can broadcast to officers (perm)');
  c.send({ type: 'alliance_broadcast', audience: 'all', subject: 'Ops2', body: 'hi' });
  const cBcastAll = await c.waitForPred(m2 => m2.type === 'alliance_result' && /officers/i.test(m2.error || ''), 'commander all-broadcast denied');
  expect(cBcastAll.ok === false, 'officer-rank cannot broadcast to all');

  // 11. Kick gating: commander defaults canKickRecruits=true (Phase 1) AND canKickMembers on -> can kick both.
  //     Recruit has no kick perms -> denied. Note: new joiners are 'recruit' — promote ax_member to 'member'
  //     so the canKickMembers path also applies.
  f.send({ type: 'alliance_set_role', targetUsername: 'ax_member', role: 'member' });
  const promMember = await f.waitForPred(m2 => m2.type === 'alliance_result' && m2.ok && m2.alliances && m2.alliances.find(a => a.id === allId) && m2.alliances.find(a => a.id === allId).members.some(x => x.username === 'ax_member' && x.role === 'member'), 'promote member');
  expect(promMember.ok === true, 'member promoted to member role');
  // Recruit (no kick perms) is denied first — before the recruit itself gets kicked
  rc.send({ type: 'alliance_kick', targetUsername: 'ax_commander' });
  const k3 = await rc.waitForPred(m2 => m2.type === 'alliance_result' && /permission/i.test(m2.error || ''), 'recruit kick denied');
  expect(k3.ok === false, 'recruit cannot kick anyone');
  c.send({ type: 'alliance_kick', targetUsername: 'ax_recruit' });
  const k1 = await c.waitForPred(m2 => m2.type === 'alliance_result' && m2.ok && /kicked/i.test(m2.message || ''), 'commander recruit kick allowed');
  expect(k1.ok === true, 'commander can kick recruit (commander.canKickRecruits defaults true)');
  c.send({ type: 'alliance_kick', targetUsername: 'ax_member' });
  const k2 = await c.waitForPred(m2 => m2.type === 'alliance_result' && m2.ok && /kicked/i.test(m2.message || ''), 'commander member kick allowed');
  expect(k2.ok === true, 'commander kicks member (canKickMembers on)');

  // 12. Kicked member: joinedId cleared + kick mail in mailbox
  //     Note: the initial auth colony_state (joinedId null, empty mailbox) sits stale in the buffer —
  //     so the predicate must require the kick mail itself to be present.
  m.send({ type: 'get_colony' });
  const mState = await m.waitForPred(m2 => {
    if (m2.type !== 'colony_state' || !m2.colony || !m2.colony.alliance) return false;
    const mm = (m2.colony.mailbox && m2.colony.mailbox.messages || []).find(x => /removed/i.test(x.subject || ''));
    return m2.colony.alliance.joinedId === null && !!mm;
  }, 'member colony_state after kick');
  expect(mState.colony.alliance.joinedId === null, 'kicked user colony alliance cleared');
  const kickMail = (mState.colony.mailbox && mState.colony.mailbox.messages || []).find(mm => /removed/i.test(mm.subject || ''));
  expect(!!kickMail && kickMail.tab === 'Alliance', 'kicked user got Alliance-tab mail');

  // 13. Audit shows kick entry
  f.send({ type: 'alliance_get_audit', limit: 100 });
  const fAudit2 = await f.waitForPred(m2 => m2.type === 'alliance_audit' && m2.ok, 'audit after kick');
  expect(fAudit2.entries.some(e => e.action === 'kick' && e.target === 'ax_member'), 'audit records kick with target');

  // 14. Founder can kick anyone (commander)
  f.send({ type: 'alliance_kick', targetUsername: 'ax_commander' });
  const k4 = await f.waitForPred(m2 => m2.type === 'alliance_result' && m2.ok && /kicked/i.test(m2.message || ''), 'founder kick commander');
  expect(k4.ok === true, 'founder kicks commander');
  c.send({ type: 'get_colony' });
  const cState = await c.waitForPred(m2 => m2.type === 'colony_state', 'commander colony_state after kick');
  expect(cState.colony.alliance.joinedId === null, 'kicked commander colony cleared');

  f.close(); c.close(); m.close(); rc.close();

  console.log('\nALLIANCE EXTRA SMOKE TEST ' + (failures ? 'FAILED (' + failures + ')' : 'PASSED'));
  serverProc.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error('ALLIANCE EXTRA SMOKE TEST ERROR: ' + e.stack);
  console.error('--- server log ---\n' + serverLog);
  serverProc.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(1);
});
