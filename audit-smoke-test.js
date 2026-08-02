// Audit smoke test: verifies the 7 combat/resources audit fixes.
// Part 1: unit tests for resources.js + combat.js (pure modules).
// Part 2: integration test — seeds a temp DB with a PvP attack already in
// transit (overdue), spawns the real server, and verifies resolvePendingAttack
// results: defenseLosses/defenseWins, casualties, and the combat_report_v2 mail.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const net = require('net');
const { spawn } = require('child_process');

const PORT = 3467;
const HOST = '127.0.0.1';

let failures = 0;
function expect(cond, label) {
  if (cond) console.log('  ✅ ' + label);
  else { console.log('  ❌ FAIL: ' + label); failures++; }
}

// ── Part 1: unit tests ────────────────────────────────────────────
console.log('── Part 1: unit tests (resources + combat) ──');

// 1. Resource caps decrease when bunker/warehouse level drops
const Resources = require('./server/systems/resources');
{
  console.log('1. updateCaps decreases caps when defenseBunker drops:');
  const colony = {
    buildings: { defenseBunker: { level: 5 }, extractionGrid: { level: 1 } },
    resources: {
      ore: { amount: 999999, cap: 999999, production: 0 },
      solar: { amount: 999999, cap: 999999, production: 0 },
      crystal: { amount: 999999, cap: 999999, production: 0 },
      isotopes: { amount: 999999, cap: 999999, production: 0 }
    }
  };
  Resources.updateCaps(colony);
  const capHigh = colony.resources.ore.cap;
  const amountClampedHigh = colony.resources.ore.amount <= capHigh;
  colony.buildings.defenseBunker.level = 2;
  Resources.updateCaps(colony);
  const capLow = colony.resources.ore.cap;
  const amountClampedLow = colony.resources.ore.amount <= capLow;
  expect(capLow < capHigh, 'cap decreased after bunker drop (' + capHigh + ' -> ' + capLow + ')');
  expect(amountClampedHigh && amountClampedLow, 'amount clamped to cap in both cases');
}

// 2+3. NPC combat tick: process-then-spawn, defense mail written
const Combat = require('./server/systems/combat');
const GAME = require('./server/game-data.json');
function makeColony() {
  const b = {};
  Object.keys(GAME.buildings).forEach(k => { b[k] = { level: 1, integrity: 100, upgrading: null }; });
  const r = {};
  ['ore', 'solar', 'crystal', 'isotopes'].forEach(k => { r[k] = { amount: 500, cap: 50000, production: 0 }; });
  return {
    buildings: b,
    resources: r,
    troops: { counts: { rifleUnit: 50, reconScout: 10 }, queue: [], fleets: {} },
    research: { levels: { economy: 0, military: 0, defense: 0 }, active: null, completedTotal: 0 },
    combat: { scoutsCompleted: 0, attackWins: 0, defenseWins: 0, incomingAttacks: [], raidHistory: [] },
    mailbox: { messages: [], selectedTab: 'Inbox', selectedMessageId: null },
    position: { galaxy: 1, sector: 1, planet: 1 }
  };
}

// 2. Newly spawned attack never resolves in the same tick on large dt
{
  console.log('2. tick() does not spawn+resolve in the same tick on large dt:');
  // Stub Math.random=0 -> chance(0.6) always true (spawn), rand(35,90) -> 35 (full ETA)
  const realRandom = Math.random;
  Math.random = () => 0;
  try {
    const colony = makeColony();
    // Pre-schedule a DUE attack (remaining 1s) — it must resolve while the fresh spawn survives
    colony.combat.incomingAttacks = [{ id: 'due1', threatLevel: 2, remaining: 1, retaliation: false }];
    Combat.tick(colony, 300);
    // Due attack resolved:
    expect(!colony.combat.incomingAttacks.some(a => a.id === 'due1'), 'pre-existing due attack resolved');
    // A fresh attack spawned with a FULL ETA (35-90), never decremented by the 300s tick:
    const spawned = colony.combat.incomingAttacks.find(a => a.id !== 'due1');
    expect(!!spawned, 'a new attack was spawned (Math.random=0 -> chance(0.6) true)');
    expect(spawned.remaining === 35, 'spawned attack has full ETA remaining (' + spawned.remaining + 's), not resolved same tick');
    expect(spawned.remaining >= 35 && spawned.remaining <= 90, 'spawned ETA within schedule range 35-90s');
  } finally {
    Math.random = realRandom;
  }
}

// 3. Defense report mail when an NPC attack resolves
{
  console.log('3. resolveIncoming writes Defense mail (combat_report_v2):');
  // Stub Math.random=1 -> spawn roll (chance 0.05) never fires, no interference
  const realRandom = Math.random;
  Math.random = () => 1;
  try {
    const colony = makeColony();
    colony.combat.incomingAttacks = [{ id: 'test1', threatLevel: 2, remaining: 1, retaliation: false }];
    Combat.tick(colony, 5); // resolves the due attack
    expect(colony.combat.incomingAttacks.length === 0, 'due attack removed after resolve');
    const msgs = colony.mailbox.messages;
    expect(msgs.length > 0, 'mailbox received a message');
    const m = msgs[0];
    expect(m.tab === 'Defense', 'mail tab is Defense (got ' + m.tab + ')');
    expect(/Defense Report: Threat L2/.test(m.subject), 'subject is "Defense Report: Threat L2" (got "' + m.subject + '")');
    expect(m.type === 'combat_report_v2', 'mail type is combat_report_v2');
    expect(m.data && m.data.kind === 'npc_defense', 'mail data.kind is npc_defense');
    expect(typeof m.body === 'string' && m.body.length > 20, 'body is a readable formatted string');
    expect(/DEFENSE REPORT/.test(m.body), 'body contains DEFENSE REPORT header');
  } finally {
    Math.random = realRandom;
  }
}

// ── Part 2: integration — real server, seeded PvP attack ──────────
console.log('── Part 2: integration (server + resolvePendingAttack) ──');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'de-audit-'));
const DATA_DIR = path.join(tmpDir, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

// Seed a DB: attacker with an overdue PvP fleet transit, defender with troops.
function seedColony(name, opts) {
  const b = {};
  Object.keys(GAME.buildings).forEach(k => { b[k] = { level: 1, integrity: 100, upgrading: null }; });
  const r = {};
  ['ore', 'solar', 'crystal', 'isotopes'].forEach(k => { r[k] = { amount: 500, cap: 50000, production: 0 }; });
  return {
    username: name,
    planetName: name + "'s Planet",
    homeGalaxy: 1, homeSector: 1, homePlanet: 1,
    position: { galaxy: 1, sector: 1, planet: 1 },
    resources: r,
    buildings: b,
    troops: { counts: opts.troops || {}, queue: [], fleets: opts.fleets || {} },
    research: { levels: { economy: 0, military: 0, defense: 0 }, active: null, completedTotal: 0 },
    combat: { scoutsCompleted: 0, attackWins: 0, defenseWins: 0, defenseLosses: 0, incomingAttacks: [], raidHistory: [] },
    mailbox: { messages: [], selectedTab: 'Inbox', selectedMessageId: null },
    expeditions: { active: null, completed: [], queue: [] },
    inventory: { artifacts: [] },
    alliance: { joinedId: null },
    events: { active: null, history: [] },
    market: { transactions: [], listings: [] },
    missions: {},
    queue: [],
    lastTick: Date.now(),
    shield: { current: 120, max: 120 }
  };
}

const dbSeed = { users: {}, universe: { galaxies: [{ id: 1, name: 'G1', universeX: 0, universeY: 0, index: 0, sectors: [] }], nextId: 2, claimedPlanets: {} } };

// Attacker: two fleets in transit, overdue (arrivalTime in the past).
const fleetTroopsStrong = { rifleUnit: 400, heavyTrooper: 200, siegeMech: 50 };  // siege mechs -> building damage
const fleetTroopsWeak = { reconScout: 5 };                 // tiny fleet -> repelled
const attColony = seedColony('audit_atk', {
  troops: { reconScout: 0 },
  fleets: {
    f_strong: {
      name: 'Hammers',
      troops: Object.assign({}, fleetTroopsStrong),
      transit: {
        mode: 'pvp_attack', returning: false,
        startTime: Date.now() - 60000,
        attacker: 'audit_atk', defender: 'audit_def',
        target: 'audit_def',
        arrivalTime: Date.now() - 1000, // overdue -> resolves at startup
        targetBuilding: 'any',
        fleetComposition: Object.assign({}, fleetTroopsStrong),
        atkPower: 100000,
        defPowerWithShield: 0,
        travelTime: 60,
        origin: { galaxyId: 1, sectorId: 1, planetId: 1, planetName: 'audit_atk\'s Planet' },
        targetPos: { galaxyId: 1, sectorId: 1, planetId: 2, planetName: 'audit_def\'s Planet' }
      }
    },
    f_weak: {
      name: 'Pickets',
      troops: Object.assign({}, fleetTroopsWeak),
      transit: {
        mode: 'pvp_attack', returning: false,
        startTime: Date.now() - 60000,
        attacker: 'audit_atk', defender: 'audit_def',
        target: 'audit_def',
        arrivalTime: Date.now() - 1000,
        targetBuilding: 'any',
        fleetComposition: Object.assign({}, fleetTroopsWeak),
        atkPower: 100,
        defPowerWithShield: 0,
        travelTime: 60,
        origin: { galaxyId: 1, sectorId: 1, planetId: 1, planetName: 'audit_atk\'s Planet' },
        targetPos: { galaxyId: 1, sectorId: 1, planetId: 2, planetName: 'audit_def\'s Planet' }
      }
    }
  }
});
dbSeed.users['audit_atk'] = { username: 'audit_atk', password: 'x', salt: 's', colony: attColony, createdAt: Date.now() };

// Defender: strong garrison -> beats the weak attack, loses to the strong one
const defColony = seedColony('audit_def', { troops: { rifleUnit: 5000, heavyTrooper: 2000 } });
dbSeed.users['audit_def'] = { username: 'audit_def', password: 'x', salt: 's', colony: defColony, createdAt: Date.now() };

fs.writeFileSync(path.join(DATA_DIR, 'db.json'), JSON.stringify(dbSeed));

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
        waitForPred(pred, label, timeoutMs) {
          return new Promise((resolve, reject) => {
            for (let i = 0; i < messages.length; i++) {
              try {
                const parsed = JSON.parse(messages[i]);
                if (pred(parsed)) { messages.splice(i, 1); return resolve(parsed); }
              } catch (e) {}
            }
            const t = setTimeout(() => reject(new Error('timeout waiting for ' + label)), timeoutMs || 6000);
            waiters.push({ pred, resolve: m => { clearTimeout(t); resolve(m); } });
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
            if (waiters[i].pred(parsed)) { const w = waiters[i]; waiters.splice(i, 1); w.resolve(parsed); }
          }
        } else if (op === 8) { sock.end(); }
      }
      buf = buf.slice(off);
    });

    sock.on('error', reject);
    resolveClient = resolve;
  });
}

(async () => {
  console.log('4. Waiting for server + seeded PvP resolution...');
  await waitForPort(10000);
  console.log('   server log: ' + serverLog.split('\n').filter(l => /Server:|Fleet:|Tick/.test(l)).join(' | '));

  // The server resolves overdue attacks at startup and saves on every 10th tick.
  // Poll db.json until the defender's combat counters show the resolves.
  const dbPath = path.join(DATA_DIR, 'db.json');
  let saved = null;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 1500));
    try { saved = JSON.parse(fs.readFileSync(dbPath, 'utf8')); } catch (e) {}
    const def = saved && saved.users['audit_def'];
    if (def && def.colony && def.colony.combat && (def.colony.combat.defenseWins > 0 || def.colony.combat.defenseLosses > 0)) break;
  }

  const defUser = saved && saved.users['audit_def'];
  const atkUser = saved && saved.users['audit_atk'];
  expect(!!defUser, 'defender found in saved DB after resolution');

  if (defUser && defUser.colony) {
    const combat = defUser.colony.combat;
    console.log('   defender combat:', JSON.stringify({ attackWins: combat.attackWins, defenseWins: combat.defenseWins, defenseLosses: combat.defenseLosses }));
    expect((combat.defenseWins || 0) === 1, 'defenseWins incremented exactly once (weak attack repelled) — got ' + combat.defenseWins);
    expect((combat.defenseLosses || 0) === 1, 'defenseLosses incremented once (strong attack raided) — got ' + combat.defenseLosses);
    // Bug check: defenseWins must NOT have been bumped by the attacker's victory
    expect((combat.attackWins || 0) === 0, 'defender attackWins untouched');

    const msgs = defUser.colony.mailbox && defUser.colony.mailbox.messages || [];
    const pvpMails = msgs.filter(m => m.type === 'combat_report_v2' && m.data && m.data.kind === 'pvp');
    expect(pvpMails.length === 2, 'defender received 2 PvP combat_report_v2 mails (got ' + pvpMails.length + ')');
    if (pvpMails.length >= 2) {
      const winMail = pvpMails.find(m => !m.data.attackerWins);
      const lossMail = pvpMails.find(m => m.data.attackerWins);
      expect(!!winMail && /DEFENDER VICTORY/.test(winMail.body), 'winning defense mail body says DEFENDER VICTORY');
      expect(!!lossMail && /COLONY RAIDED/.test(lossMail.body), 'losing defense mail body says COLONY RAIDED');
      expect(!!lossMail && /Building Damage/.test(lossMail.body), 'raided mail includes Building Damage section');
      expect(!!lossMail && lossMail.data.buildingDamage && lossMail.data.buildingDamage.length > 0, 'raided mail data includes building damage hits');
      expect(/Survivors returning/.test(lossMail.body), 'mail includes Fleet Status / survivors section');
      expect(lossMail.subject === 'Defense Report: audit_atk', 'defender subject is "Defense Report: audit_atk" (got "' + lossMail.subject + '")');
      expect(msgs.length <= 120, 'mailbox capped at 120 (' + msgs.length + ')');
    }
  }

  if (atkUser && atkUser.colony) {
    const atkMsgs = atkUser.colony.mailbox && atkUser.colony.mailbox.messages || [];
    const atkMails = atkMsgs.filter(m => m.type === 'combat_report_v2' && m.data && m.data.kind === 'pvp');
    expect(atkMails.length === 2, 'attacker received 2 PvP combat_report_v2 mails (got ' + atkMails.length + ')');
    if (atkMails.length >= 2) {
      const atkWin = atkMails.find(m => m.data.attackerWins);
      expect(!!atkWin && /VICTORY/.test(atkWin.body), 'attacker win mail says VICTORY');
      expect(atkWin.subject === 'Attack Report: audit_def', 'attacker subject is "Attack Report: audit_def"');
      expect(!!atkWin && atkWin.data.loot && Object.keys(atkWin.data.loot).length > 0, 'attacker win mail has loot data');
    }
  }

  console.log('\nAUDIT SMOKE TEST ' + (failures ? 'FAILED (' + failures + ')' : 'PASSED'));
  serverProc.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(failures ? 1 : 0);
})().catch(e => {
  console.error('AUDIT SMOKE TEST ERROR: ' + e.stack);
  serverProc.kill();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  process.exit(1);
});
