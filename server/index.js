const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── HTML Escaping ──────────────────────────────────────────
function escapeHTML(str) {
  if (typeof str !== 'string') return str || '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Game Modules ─────────────────────────────────────────────────
const Universe = require('./universe.js');
const DB = require('./db-pg.js');
const ResourceSystem = require('./systems/resources.js');
const BuildingSystem = require('./systems/buildings.js');
const TroopSystem = require('./systems/troops.js');
const ResearchSystem = require('./systems/research.js');
const CombatSystem = require('./systems/combat.js');
const ExpeditionSystem = require('./systems/expeditions.js');
const MarketSystem = require('./systems/market.js');
const GameLoop = require('./game-loop.js');
const Admin = require('./admin.js');

// ─── Config ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// ─── Data ─────────────────────────────────────────────────────────
const gameData = JSON.parse(fs.readFileSync(path.join(__dirname, 'game-data.json'), 'utf-8'));

// ─── Database ─────────────────────────────────────────────────────
// db is populated asynchronously at startup (see server.listen)
const db = DB.db;   // referential — will point to the module's cache once loaded

// ─── WebSocket broadcast helpers ──────────────────────────────────
const wsClients = new Map(); // socket -> { username, colony }
const pendingAttacks = []; // PvP fleet attacks in transit {id,attacker,defender,fleetId,fleetComposition,atkPower,defPowerWithShield,arrivalTime,origin}
const chatHistory = [];

function broadcastAll(msg) {
  const data = JSON.stringify(msg);
  wsClients.forEach((info, socket) => {
    try { if (!socket.destroyed && socket.writable) socket.write(wsEncodeFrame(data)); } catch(e) {}
  });
}

function broadcastToUser(socket, msg) {
  try { socket.write(wsEncodeFrame(JSON.stringify(msg))); } catch(e) {}
}

// ─── Leaderboard ──────────────────────────────────────────
function computeLeaderboard() {
  var users = DB.db.users || {};
  var data = { population: [], raider: [], attacker: [], defence: [] };

  Object.keys(users).forEach(function(name) {
    var u = users[name];
    if (!u || !u.colony) return;
    var c = u.colony;
    var displayName = (c.profile && c.profile.displayName) ? escapeHTML(c.profile.displayName) : null;

    data.population.push({
      name: escapeHTML(name),
      displayName: displayName,
      score: ResourceSystem.getPopulation(c)
    });
    data.raider.push({
      name: escapeHTML(name),
      displayName: displayName,
      score: (c.combat && c.combat.attackWins) || 0
    });
    data.attacker.push({
      name: escapeHTML(name),
      displayName: displayName,
      score: CombatSystem.getTotalPower(c)
    });
    data.defence.push({
      name: escapeHTML(name),
      displayName: displayName,
      score: CombatSystem.getTotalDefense(c)
    });
  });

  // Sort each descending and keep top 20
  Object.keys(data).forEach(function(key) {
    data[key].sort(function(a, b) { return b.score - a.score; });
    data[key] = data[key].slice(0, 20);
  });

  return data;
}

function computeAllianceLeaderboard() {
  const users = DB.db.users || {};
  const alls = DB.db.universe.alliances || {};
  const out = { population: [], raider: [], attacker: [], defence: [] };

  // Build members list per allianceId from USER colonies (authoritative)
  const membersByAlliance = {};
  Object.keys(users).forEach(username => {
    const u = users[username];
    if (!u || !u.colony || !u.colony.alliance) return;
    const aid = u.colony.alliance.joinedId;
    if (!aid) return;
    if (!membersByAlliance[aid]) membersByAlliance[aid] = [];
    membersByAlliance[aid].push(username);
  });

  Object.keys(membersByAlliance).forEach(aid => {
    const a = alls[aid];
    const allianceName = a && a.name ? escapeHTML(a.name) : ('Alliance ' + aid);
    let pop = 0, raids = 0, atk = 0, def = 0;

    membersByAlliance[aid].forEach(username => {
      const u = users[username];
      if (!u || !u.colony) return;
      const c = u.colony;
      pop += ResourceSystem.getPopulation(c);
      raids += (c.combat && c.combat.attackWins) || 0;
      atk += CombatSystem.getTotalPower(c);
      def += CombatSystem.getTotalDefense(c);
    });

    out.population.push({ name: allianceName, score: pop, allianceId: aid, members: membersByAlliance[aid].length });
    out.raider.push({ name: allianceName, score: raids, allianceId: aid, members: membersByAlliance[aid].length });
    out.attacker.push({ name: allianceName, score: atk, allianceId: aid, members: membersByAlliance[aid].length });
    out.defence.push({ name: allianceName, score: def, allianceId: aid, members: membersByAlliance[aid].length });
  });

  Object.keys(out).forEach(k => {
    out[k].sort((a, b) => b.score - a.score);
    out[k] = out[k].slice(0, 20);
  });

  return out;
}

function sendLeaderboardTo(socket) {
  try {
    socket.write(wsEncodeFrame(JSON.stringify({
      type: 'leaderboard',
      data: computeLeaderboard(),
      alliances: computeAllianceLeaderboard()
    })));
  } catch(e) {}
}

function broadcastLeaderboard() {
  var data = computeLeaderboard();
  var msg = JSON.stringify({ type: 'leaderboard', data: data, alliances: computeAllianceLeaderboard() });
  wsClients.forEach(function(info, socket) {
    try { socket.write(wsEncodeFrame(msg)); } catch(e) {}
  });
}

// ─── Online player presence (positions for map markers) ─────────
function broadcastPresence() {
  var players = [];
  wsClients.forEach(function(info) {
    if (!info || !info.username) return;
    var c = info.colony;
    players.push({
      username: info.username,
      galaxyId: c && c.homeGalaxy ? c.homeGalaxy : null,
      sectorId: c && c.homeSector ? c.homeSector : null,
      planetId: c && c.homePlanet ? c.homePlanet : null
    });
  });
  var msg = JSON.stringify({ type: 'presence', players: players });
    wsClients.forEach(function(info, socket) {
      try { if (!socket.destroyed && socket.writable) socket.write(wsEncodeFrame(msg)); } catch(e) {}
    });
  }

// ─── Admin Console ──────────────────────────────────────────
const adminAuth = Admin.init(DB, gameData, process.env.ADMIN_PASSWORD);

// ─── WebSocket RFC 6455 Implementation ────────────────────────────
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsAcceptKey(key) {
  const sha1 = crypto.createHash('sha1');
  sha1.update(key + WS_GUID);
  return sha1.digest('base64');
}

function wsEncodeFrame(data) {
  const payload = Buffer.from(data, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

// ─── Helpers ──────────────────────────────────────────────────────
function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

function log(ip, msg) {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log('[' + ts + '] ' + ip + ' ' + msg);
}

// ─── Alliance helpers ──────────────────────────────────────────
const DEFAULT_PERMS = {
  officer: {
    canUseOfficerChat: true, canEditMotd: false, canBroadcastOfficers: false,
    canKickRecruits: false, canViewAudit: true
  },
  commander: {
    canUseOfficerChat: true, canEditMotd: true, canBroadcastOfficers: true,
    canKickRecruits: true, canViewAudit: true,
    canKickMembers: false, canPromoteToOfficer: false
  }
};

function normalizePerms(p) {
  const out = JSON.parse(JSON.stringify(DEFAULT_PERMS));
  if (p && typeof p === 'object') {
    ['officer', 'commander'].forEach(function (rank) {
      if (p[rank] && typeof p[rank] === 'object') {
        Object.keys(out[rank]).forEach(function (key) {
          if (typeof p[rank][key] === 'boolean') out[rank][key] = p[rank][key];
        });
      }
    });
  }
  return out;
}

// Audit entry: { time, actor, action, target, meta } — newest first, cap 200
function pushAudit(alliance, entry) {
  if (!Array.isArray(alliance.audit)) alliance.audit = [];
  alliance.audit.unshift(entry);
  if (alliance.audit.length > 200) alliance.audit = alliance.audit.slice(0, 200);
}

function roleLevel(role) {
  const levels = { recruit: 0, member: 1, officer: 2, commander: 3, founder: 4 };
  return levels[role] !== undefined ? levels[role] : 0;
}

function getRole(alliance, username) {
  if (!alliance) return null;
  if (alliance.members && typeof alliance.members === 'object' && !Array.isArray(alliance.members)) {
    const m = alliance.members[username];
    return m ? (m.role || 'member') : null;
  }
  // Legacy array-of-strings form
  if (Array.isArray(alliance.members) && alliance.members.indexOf(username) !== -1) {
    return (username === alliance.founder) ? 'founder' : 'member';
  }
  return null;
}

function getMemberRole(alliance, username) {
  return getRole(alliance, username);
}

function normalizeAlliance(a, id) {
  if (!a) a = {};
  a.id = a.id || id;
  // Convert legacy members array -> map with roles
  if (Array.isArray(a.members)) {
    const map = {};
    a.members.forEach(function(u) {
      if (u) map[u] = { role: (u === a.founder ? 'founder' : 'member'), joinedAt: a.created || Date.now() };
    });
    if (a.founder && !map[a.founder]) map[a.founder] = { role: 'founder', joinedAt: a.created || Date.now() };
    a.members = map;
  }
  if (!a.members || typeof a.members !== 'object') a.members = {};
  if (!a.chat) a.chat = {};
  if (!Array.isArray(a.chat.alliance)) a.chat.alliance = [];
  if (!Array.isArray(a.chat.officers)) a.chat.officers = [];
  if (typeof a.motd !== 'string') a.motd = '';
  if (!Array.isArray(a.audit)) a.audit = [];
  a.perms = normalizePerms(a.perms);
  if (!a.created) a.created = Date.now();
  return a;
}

function normalizeAlliances() {
  DB.db.universe.alliances = DB.db.universe.alliances || {};
  Object.keys(DB.db.universe.alliances).forEach(function(id) {
    DB.db.universe.alliances[id] = normalizeAlliance(DB.db.universe.alliances[id], id);
  });
}

function getAlliancesListV2() {
  var result = [];
  var alls = DB.db.universe.alliances || {};
  Object.keys(alls).forEach(function(id) {
    var a = alls[id];
    var members = [];
    Object.keys(a.members || {}).forEach(function(uname) {
      members.push({
        username: escapeHTML(uname),
        role: a.members[uname].role || 'member',
        joinedAt: a.members[uname].joinedAt
      });
    });
    result.push({
      id: id,
      name: escapeHTML(a.name),
      founder: escapeHTML(a.founder),
      members: members,
      memberCount: members.length,
      motd: escapeHTML(a.motd || ''),
      perms: normalizePerms(a.perms),
      created: a.created
    });
  });
  return result;
}

function getAlliancesList() {
  return getAlliancesListV2();
}

// Single-alliance public view for alliance_update broadcasts
function getAlliancePublic(id) {
  var entry = getAlliancesListV2().filter(function (e) { return e.id === id; })[0];
  return entry || null;
}

// Public universe view — excludes alliances/chat so colony_state never leaks private chat
function getPublicUniverse() {
  const u = DB.db.universe;
  return { galaxies: u.galaxies || {}, claimedPlanets: u.claimedPlanets || {}, nextId: u.nextId || 0 };
}

// Broadcast to members of one alliance; optional predicateFn(info, socket) filters recipients
function broadcastToAlliance(allianceId, msg, predicateFn) {
  const data = JSON.stringify(msg);
  wsClients.forEach(function(info, socket) {
    try {
      if (!info || !info.username) return;
      const userRec = DB.db.users[info.username];
      if (!userRec || !userRec.colony || !userRec.colony.alliance) return;
      if (userRec.colony.alliance.joinedId !== allianceId) return;
      if (predicateFn && !predicateFn(info, socket)) return;
      socket.write(wsEncodeFrame(data));
    } catch (e) {}
  });
}

// Push a mail message into a colony mailbox (cap 120)
function pushMail(colony, tab, subject, body, type, data) {
  if (!colony.mailbox) colony.mailbox = { messages: [], selectedTab: 'Inbox', selectedMessageId: null };
  if (!Array.isArray(colony.mailbox.messages)) colony.mailbox.messages = [];
  colony.mailbox.messages.unshift({
    id: 'mail_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    tab: tab, subject: subject, body: body, time: Date.now(), isNew: true,
    type: type || 'standard', data: data || null
  });
  colony.mailbox.messages = colony.mailbox.messages.slice(0, 120);
}

function cloneColonyWithRates(colony) {
  const copy = JSON.parse(JSON.stringify(colony));
  copy.productionRates = ResourceSystem.getProductionRates(colony);
  return copy;
}

// ─── Client gameData (balance/definitions only — sent with colony_state so UI matches server truth) ──
function getClientGameData() {
  const g = gameData;
  const out = {
    pacing: g.pacing || {},
    buildings: {},
    research: {}
  };
  Object.keys(g.buildings || {}).forEach(k => {
    const b = g.buildings[k];
    out.buildings[k] = {
      name: b.name,
      baseCost: b.baseCost,
      timeBase: b.timeBase,
      requires: b.requires || null,
      startLevel: b.startLevel || 0
    };
  });
  Object.keys(g.research || {}).forEach(k => {
    const r = g.research[k];
    out.research[k] = {
      name: r.name,
      baseCost: r.baseCost,
      durationBase: r.durationBase,
      requires: r.requires || null
    };
  });
  return out;
}

// ─── PvP Travel Time & Pending Attack Resolution ────────────────
function calculateTravelTime(origin, target) {
  // Guard against NaN/undefined position values
  var og = Number(origin.galaxy), tg = Number(target.galaxy);
  var os = Number(origin.sector), ts = Number(target.sector);
  var op = Number(origin.planet), tp = Number(target.planet);
  if (isNaN(og) || isNaN(tg)) return 300;
  if (og === tg && os === ts) {
    return Math.max(30, Math.abs((op||0) - (tp||0)) * 30);
  }
  if (og === tg) {
    return Math.abs((os||0) - (ts||0)) * 300 + Math.abs((op||0) - (tp||0)) * 30;
  }
  return 1800;
}

function processPendingAttacks(now) {
  var due = [];
  pendingAttacks.forEach(function(pa, idx) {
    if (now >= pa.arrivalTime) due.push(idx);
  });
  due.sort(function(a,b){return b-a}).forEach(function(idx) {
    var pa = pendingAttacks.splice(idx, 1)[0];
    if (pa.type === 'return') {
      // Fleet returns home — clear transit so it can be used again
      var att = DB.db.users[pa.attacker];
      if (att && att.colony && att.colony.troops && att.colony.troops.fleets) {
        var f = att.colony.troops.fleets[pa.fleetId];
        if (f) {
          var fleetName = f.name || 'Fleet';
          delete f.transit;
        }
      }
    } else {
      resolvePendingAttack(pa);
    }
  });
}

function resolvePendingAttack(pa) {
  var att = DB.db.users[pa.attacker];
  var def = DB.db.users[pa.defender];
  if (!att || !def || !att.colony || !def.colony) return;

  // Remove this PvP attack from defender's incomingAttacks
  if (def.colony.combat && def.colony.combat.incomingAttacks) {
    def.colony.combat.incomingAttacks = def.colony.combat.incomingAttacks.filter(function(a) {
      return a.attacker !== pa.attacker;
    });
  }

  var fleet = att.colony.troops && att.colony.troops.fleets ? att.colony.troops.fleets[pa.fleetId] : null;
  if (!fleet) return;
  var fleetTroops = pa.fleetComposition || fleet.troops || {};

  // Recalculate defender's current power (troops + research + shield at arrival time)
  var defMod = 1 + (def.colony.research.levels.defense || 0) * 0.06;
  var defPowerNow = 0;
  var defCounts = def.colony.troops.counts || {};
  Object.keys(defCounts).forEach(function(key) {
    var count = defCounts[key] || 0;
    var d = gameData.troops[key];
    if (d) defPowerNow += count * d.defense * defMod;
  });
  defPowerNow = Math.floor(defPowerNow);
  var shieldNow = (def.colony.buildings.shieldGenerator && def.colony.buildings.shieldGenerator.level || 0) * 25;
  var defPowerWithShield = defPowerNow + shieldNow;

  // Ratio combat
  var atkPower = pa.atkPower || 0;
  var total = atkPower + defPowerWithShield;
  var ratio = total > 0 ? atkPower / total : 0;
  var attackerWins = ratio >= 0.33;

  var atkLossRate = Math.min(0.8, Math.max(0.05, attackerWins ? (1 - ratio) * 0.6 : 0.5));
  var defLossRate = Math.min(0.8, Math.max(0.05, attackerWins ? ratio * 0.7 : (1 - ratio) * 0.3));

  // Attacker casualties — no forced minimum per troop type
  var atkCas = {};
  Object.keys(fleetTroops).forEach(function(key) {
    var count = fleetTroops[key] || 0;
    var lost = Math.min(count, Math.floor(count * atkLossRate));
    if (lost > 0) { atkCas[key] = lost; fleetTroops[key] = count - lost; if (fleetTroops[key] <= 0) delete fleetTroops[key]; }
  });

  // Defender casualties — no forced minimum per troop type
  var defCounts = def.colony.troops.counts || {};
  var defCas = {};
  Object.keys(defCounts).forEach(function(key) {
    var count = defCounts[key] || 0;
    var lost = Math.min(count, Math.floor(count * defLossRate));
    if (lost > 0) { defCas[key] = lost; def.colony.troops.counts[key] = Math.max(0, count - lost); if (def.colony.troops.counts[key] <= 0) delete def.colony.troops.counts[key]; }
  });

  // Combat always costs something: if both sides lost nothing, sacrifice 1 random unit from one side
  var atkTotalLost = Object.keys(atkCas).reduce(function(s, k) { return s + atkCas[k]; }, 0);
  var defTotalLost = Object.keys(defCas).reduce(function(s, k) { return s + defCas[k]; }, 0);
  if (atkTotalLost === 0 && defTotalLost === 0) {
    var allAtk = Object.keys(fleetTroops).filter(function(k) { return fleetTroops[k] > 0; });
    var allDef = Object.keys(defCounts).filter(function(k) { return defCounts[k] > 0; });
    if (allAtk.length > 0 || allDef.length > 0) {
      var pickSide = allDef.length > 0 && (allAtk.length === 0 || Math.random() < 0.5);
      if (pickSide) {
        var dk = allDef[Math.floor(Math.random() * allDef.length)];
        defCas[dk] = 1;
        def.colony.troops.counts[dk] = Math.max(0, (def.colony.troops.counts[dk] || 0) - 1);
        if (def.colony.troops.counts[dk] <= 0) delete def.colony.troops.counts[dk];
      } else if (allAtk.length > 0) {
        var ak = allAtk[Math.floor(Math.random() * allAtk.length)];
        atkCas[ak] = 1;
        fleetTroops[ak] = Math.max(0, (fleetTroops[ak] || 0) - 1);
        if (fleetTroops[ak] <= 0) delete fleetTroops[ak];
      }
    }
  }

  // Loot (attacker win only)
  var loot = {};
  var carryCap = 0;
  if (attackerWins) {
    var carry = 0;
    Object.keys(fleetTroops).forEach(function(key) {
      var count = fleetTroops[key] || 0;
      var d = gameData.troops[key];
      carry += count * (d && d.carryCapacity ? d.carryCapacity : 10);
    });
    carryCap = carry;
    var types = ['ore','solar','crystal','isotopes'];
    var pool = carry;
    types.forEach(function(rt) {
      var avail = def.colony.resources[rt] ? def.colony.resources[rt].amount || 0 : 0;
      var take = Math.min(avail, Math.floor(pool / (types.length - types.indexOf(rt))));
      if (take > 0) { def.colony.resources[rt].amount = Math.max(0, avail - take); loot[rt] = take; pool -= take; }
    });
    Object.keys(loot).forEach(function(rt) {
      if (!att.colony.resources[rt]) att.colony.resources[rt] = { amount: 0, cap: 100000 };
      att.colony.resources[rt].amount = Math.min(att.colony.resources[rt].cap || 100000, (att.colony.resources[rt].amount || 0) + loot[rt]);
    });

    // Building damage — only siegeMech can damage buildings
    // Each mech deals 0.1 building damage; when integrity ≤ 0, building drops 1 level
    var bldgDamage = [];
    var siegeCount = fleetTroops['siegeMech'] || 0;
    if (siegeCount > 0 && attackerWins) {
      var totalDmg = Math.floor(siegeCount * 0.1);
      if (totalDmg > 0) {
        var bldgKeys = Object.keys(def.colony.buildings);
        // If player targeted a specific building, focus all damage there
        var targetKey = (pa.targetBuilding && pa.targetBuilding !== 'any') ? pa.targetBuilding : null;
        var numTargets;
        if (targetKey) {
          numTargets = 1;
        } else {
          numTargets = Math.min(5, Math.ceil(siegeCount / 2000));
          numTargets = Math.max(1, numTargets);
        }
        var dmgPerTarget = Math.max(1, Math.floor(totalDmg / numTargets));
        for (var i = 0; i < numTargets && i < bldgKeys.length; i++) {
          var k = targetKey || bldgKeys[Math.floor(Math.random() * bldgKeys.length)];
          var b = def.colony.buildings[k];
          // If targeted building doesn't exist, fall back to random
          if (!b || !b.level || b.level <= 0) {
            if (targetKey) { targetKey = null; k = bldgKeys[Math.floor(Math.random() * bldgKeys.length)]; b = def.colony.buildings[k]; }
            if (!b || !b.level || b.level <= 0) continue;
          }
          var beforeInt = b.integrity || 100;
          var beforeLvl = b.level;
          b.integrity = beforeInt - dmgPerTarget;
          while (b.integrity <= 0 && b.level > 0) {
            b.level--;
            if (b.level > 0) b.integrity = 100;
          }
          if (b.level <= 0) b.level = 0;
          bldgDamage.push({ key: k, before: beforeInt, after: b.integrity, levelBefore: beforeLvl, levelAfter: b.level });
        }
      }
    }
  }

  // Stats — defenseWins only counts when the defender actually wins
  if (!att.colony.combat) att.colony.combat = { scoutsCompleted:0, attackWins:0, defenseWins:0, defenseLosses:0, incomingAttacks:[], raidHistory:[] };
  if (!def.colony.combat) def.colony.combat = { scoutsCompleted:0, attackWins:0, defenseWins:0, defenseLosses:0, incomingAttacks:[], raidHistory:[] };
  if (attackerWins) {
    att.colony.combat.attackWins = (att.colony.combat.attackWins||0)+1;
    def.colony.combat.defenseLosses = (def.colony.combat.defenseLosses||0)+1;
  } else {
    def.colony.combat.defenseWins = (def.colony.combat.defenseWins||0)+1;
  }

  // Fleet return — survivors head home
  if (Object.keys(fleetTroops).length > 0) {
    var returnTravelMs = Math.max(5000, (pa.travelTime || 30) * 1000);
    var defPos = def.colony.position || { galaxy: def.homeGalaxy, sector: def.homeSector, planet: def.homePlanet };
    var attPos = pa.origin || { galaxy: att.homeGalaxy, sector: att.homeSector, planet: att.homePlanet };
    fleet.transit = {
      mode: 'pvp_attack',
      returning: true,
      startTime: Date.now(),
      attacker: pa.attacker,
      defender: pa.defender,
      target: pa.attacker, // heading home
      arrivalTime: Date.now() + returnTravelMs,
      travelTime: Math.round(returnTravelMs / 1000),
      origin: { galaxyId: defPos.galaxy, sectorId: defPos.sector, planetId: defPos.planet, planetName: def.colony.planetName || (pa.defender + "'s Planet") },
      targetPos: { galaxyId: attPos.galaxy, sectorId: attPos.sector, planetId: attPos.planet, planetName: att.colony.planetName || (pa.attacker + "'s Planet") }
    };
    pendingAttacks.push({
      type: 'return',
      attacker: pa.attacker,
      fleetId: pa.fleetId,
      arrivalTime: Date.now() + returnTravelMs
    });
  } else {
    delete att.colony.troops.fleets[pa.fleetId];
  }

  // Save combat report to mailboxes (persists for offline users)
  function makeMailMsg(tab, subject, body, type, data) {
    return { id: 'cmbt_' + Date.now() + '_' + Math.random().toString(36).substr(2,4), tab: tab, subject: subject, body: body, time: Date.now(), isNew: true, type: type, data: data };
  }
  if (!att.colony.mailbox) att.colony.mailbox = { messages: [], selectedTab: 'Inbox', selectedMessageId: null };
  if (!def.colony.mailbox) def.colony.mailbox = { messages: [], selectedTab: 'Inbox', selectedMessageId: null };

  var reportId = 'pvp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  var defPosId = (def.colony.position && def.colony.position.galaxy ? def.colony.position : { galaxy: def.homeGalaxy, sector: def.homeSector, planet: def.homePlanet });
  var attPosId = pa.origin || { galaxy: att.homeGalaxy, sector: att.homeSector, planet: att.homePlanet };
  var survivorsReturning = Object.keys(fleetTroops).length > 0;
  var returnEta = survivorsReturning ? Math.round((pa.travelTime || 30)) : 0;

  var reportCtx = {
    reportId: reportId,
    timestamp: new Date().toUTCString(),
    attackerName: pa.attacker,
    attackerPlanet: att.colony.planetName || (pa.attacker + "'s Planet"),
    defenderName: pa.defender,
    defenderPlanet: def.colony.planetName || (pa.defender + "'s Planet"),
    originId: attPosId,
    targetId: defPosId,
    outboundTravel: pa.travelTime || 0,
    returnEta: returnEta,
    survivorsReturning: survivorsReturning,
    attackerPower: pa.atkPower || 0,
    defenderPower: defPowerNow,
    shieldNow: shieldNow,
    ratio: ratio,
    attackerWins: attackerWins,
    atkCas: atkCas,
    defCas: defCas,
    loot: loot,
    carryCap: carryCap,
    bldgDamage: typeof bldgDamage !== 'undefined' ? bldgDamage : []
  };

  var atkBody = formatCombatReportText('attacker', reportCtx);
  var defBody = formatCombatReportText('defender', reportCtx);
  var atkData = buildCombatReportData('attacker', reportCtx);
  var defData = buildCombatReportData('defender', reportCtx);

  att.colony.mailbox.messages.unshift(makeMailMsg('Attack', 'Attack Report: ' + pa.defender, atkBody, 'combat_report_v2', atkData));
  def.colony.mailbox.messages.unshift(makeMailMsg('Defense', 'Defense Report: ' + pa.attacker, defBody, 'combat_report_v2', defData));
  if (att.colony.mailbox.messages.length > 120) att.colony.mailbox.messages = att.colony.mailbox.messages.slice(0, 120);
  if (def.colony.mailbox.messages.length > 120) def.colony.mailbox.messages = def.colony.mailbox.messages.slice(0, 120);

  DB.saveDB();

  // Send results
  var atkCol = JSON.parse(JSON.stringify(att.colony));
  atkCol.productionRates = ResourceSystem.getProductionRates(att.colony);
  var defCol = JSON.parse(JSON.stringify(def.colony));
  defCol.productionRates = ResourceSystem.getProductionRates(def.colony);

  wsClients.forEach(function(info, sock) {
    if (info.username === pa.attacker) {
      broadcastToUser(sock, { type:'attack_result', ok:true, victory:attackerWins,
        loot:loot, casualties:atkCas, fleetId:pa.fleetId, target:pa.defender, colony:atkCol,
        log:['Attack launched from '+pa.origin.planetName,'Transit time: '+pa.travelTime+'s',
          attackerWins ? 'Victory! Loot: '+JSON.stringify(loot) : 'Defeated. Fleet heavily damaged.'] });
    }
    if (info.username === pa.defender) {
      broadcastToUser(sock, { type:'attack_result', ok:true, victory:!attackerWins,
        loot:{}, casualties:defCas, fleetId:null, target:pa.attacker, attackedBy:pa.attacker,
        colony:defCol,
        log:[attackerWins ? 'Your colony was raided by '+pa.attacker : 'You repelled the attack from '+pa.attacker,
          'Casualties suffered: '+JSON.stringify(defCas)] });
    }
  });
}

// ── Combat report formatting ──

function fmtPos(pos) {
  return (pos && pos.galaxy) ? (pos.galaxy + ':' + pos.sector + ':' + pos.planet) : '?:?:?';
}

function fmtCasualties(cas, side) {
  const keys = Object.keys(cas);
  if (keys.length === 0) return '  ' + side + ': None';
  let out = '  ' + side + ':';
  keys.forEach(k => {
    const name = (gameData.troops[k] && gameData.troops[k].name) || k;
    out += '\n    ' + name + ' × ' + cas[k];
  });
  return out;
}

function fmtLoot(loot) {
  const keys = ['ore', 'solar', 'crystal', 'isotopes'].filter(k => (loot[k] || 0) > 0);
  if (keys.length === 0) return '  None';
  return '  ' + keys.map(k => {
    const name = (gameData.resources[k] && gameData.resources[k].name) || k;
    return name + ': ' + loot[k];
  }).join(' | ');
}

function formatCombatReportText(perspective, ctx) {
  const win = ctx.attackerWins;
  const outcome = perspective === 'attacker'
    ? (win ? '✅ VICTORY' : '❌ DEFEAT')
    : (win ? '❌ COLONY RAIDED' : '✅ DEFENDER VICTORY');
  const lines = [];
  lines.push('⚔ PvP BATTLE REPORT (ID: ' + ctx.reportId + ')');
  lines.push('Time: ' + ctx.timestamp);
  lines.push('Route: ' + ctx.attackerPlanet + ' (' + fmtPos(ctx.originId) + ') → ' + ctx.defenderPlanet + ' (' + fmtPos(ctx.targetId) + ')');
  lines.push('Outcome: ' + outcome);
  lines.push('');
  lines.push('Power');
  lines.push('- Attacker Power: ' + ctx.attackerPower);
  lines.push('- Defender Power: ' + ctx.defenderPower);
  lines.push('- Defender Shield: ' + ctx.shieldNow);
  lines.push('- Ratio: ' + ctx.ratio.toFixed(3) + ' (threshold: 0.330)');
  lines.push('');
  lines.push('Losses');
  lines.push(fmtCasualties(ctx.atkCas, 'Attacker'));
  lines.push(fmtCasualties(ctx.defCas, 'Defender'));
  lines.push('');
  lines.push('Loot (Carry Cap: ' + ctx.carryCap + ')');
  lines.push(fmtLoot(ctx.loot));
  lines.push('');
  lines.push('Building Damage');
  if (!ctx.bldgDamage || ctx.bldgDamage.length === 0) {
    lines.push('  None');
  } else {
    ctx.bldgDamage.forEach(d => {
      const name = (gameData.buildings[d.key] && gameData.buildings[d.key].name) || d.key;
      let lvlDrop = '';
      if (d.levelAfter !== undefined && d.levelBefore !== undefined && d.levelAfter < d.levelBefore) lvlDrop = ' (level ' + d.levelBefore + ' → ' + d.levelAfter + ')';
      lines.push('  ' + name + ': integrity ' + d.before + ' → ' + d.after + lvlDrop);
    });
  }
  lines.push('');
  lines.push('Fleet Status');
  lines.push('- Survivors returning: ' + (ctx.survivorsReturning ? 'Yes (ETA ' + ctx.returnEta + 's)' : 'No'));
  return lines.join('\n');
}

function buildCombatReportData(perspective, ctx) {
  return {
    kind: 'pvp',
    perspective: perspective,
    reportId: ctx.reportId,
    timestamp: ctx.timestamp,
    attacker: ctx.attackerName,
    attackerPlanet: ctx.attackerPlanet,
    defender: ctx.defenderName,
    defenderPlanet: ctx.defenderPlanet,
    origin: ctx.originId,
    target: ctx.targetId,
    outboundTravel: ctx.outboundTravel,
    returnEta: ctx.returnEta,
    survivorsReturning: ctx.survivorsReturning,
    attackerWins: ctx.attackerWins,
    attackerPower: ctx.attackerPower,
    defenderPower: ctx.defenderPower,
    shieldNow: ctx.shieldNow,
    ratio: ctx.ratio,
    attackerCasualties: ctx.atkCas,
    defenderCasualties: ctx.defCas,
    loot: ctx.loot,
    carryCap: ctx.carryCap,
    buildingDamage: ctx.bldgDamage || []
  };
}

function getStarterResources() {
  return {
    ore: { amount: 1500, cap: 1500, production: 0 },
    solar: { amount: 1500, cap: 1500, production: 0 },
    crystal: { amount: 1500, cap: 1500, production: 0 },
    isotopes: { amount: 1500, cap: 1500, production: 0 }
  };
}

function createInitialBuildings() {
  const bDefs = gameData.buildings || {};
  const b = {};
  Object.keys(bDefs).forEach(function(key) {
    const start = (bDefs[key].startLevel !== undefined) ? bDefs[key].startLevel : 0;
    b[key] = {
      level: start,
      integrity: 100,
      upgrading: null
    };
  });
  return b;
}

function createInitialTroops() {
  return { counts: {}, queue: [], fleets: {} };
}

function createInitialResearch() {
  return { levels: { economy: 0, military: 0, defense: 0 }, active: null, completedTotal: 0 };
}

function createInitialColony(username, planetName, galaxyId, sectorId, planetId) {
  return {
    username: username,
    planetName: planetName || username + "'s Planet",
    homeGalaxy: galaxyId,
    homeSector: sectorId,
    homePlanet: planetId,
    resources: getStarterResources(),
    buildings: createInitialBuildings(),
    troops: createInitialTroops(),
    research: createInitialResearch(),
    position: { galaxy: galaxyId, sector: sectorId, planet: planetId },
    combat: { scoutsCompleted: 0, attackWins: 0, defenseWins: 0, incomingAttacks: [], raidHistory: [], scoutingIntel: {} },
    expeditions: { active: null, completed: [], queue: [] },
    inventory: { artifacts: [] },
    mailbox: { messages: [], selectedTab: 'Inbox', selectedMessageId: null },
    alliance: { joinedId: null },
    events: { active: null, history: [] },
    market: { transactions: [], listings: [] },
    missions: {}, // Will be populated from GameData.missions
    queue: [],
    lastTick: Date.now(),
    shield: { current: 120, max: 120 },
    profile: { displayName: username, baseName: planetName || username + "'s Planet" }
  };
}

// ─── Token management ─────────────────────────────────────────────
function generateToken(username) {
  const token = makeToken();
  const user = DB.db.users[username];
  if (user) {
    user.token = token;
    user.tokenExpires = Date.now() + 86400000; // 24h
    DB.saveDB();
  }
  return token;
}

function validateToken(token) {
  for (const username in DB.db.users) {
    const u = DB.db.users[username];
    if (u.token === token && u.tokenExpires > Date.now()) {
      return username;
    }
  }
  return null;
}

// ─── HTTP Server ──────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer(function(req, res) {
  const ip = req.connection.remoteAddress || 'unknown';

  // ── Admin Console Routes ──
  if (adminAuth(req, res)) return;

  // ── API Routes ──
  if (req.method === 'POST' && req.url === '/api/register') {
    let body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        const parsed = JSON.parse(body);
        var username = String(parsed.username || '').trim();
        var password = parsed.password;
        var planetName = parsed.planetName;
        if (!username || !password || username.length < 2 || username.length > 32 || password.length < 3) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid username (2-32 chars) or password (min 3 chars)' }));
          return;
        }
        if (DB.db.users[username]) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Username already exists' }));
          return;
        }
        const salt = makeToken().substring(0, 16);
        const hash = hashPassword(password, salt);
        // Assign next free planet
        const planetInfo = Universe.ensurePlanetAvailable(DB.db.universe);
        if (!planetInfo) {
          res.writeHead(507, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'No free planets available' }));
          return;
        }
        const claim = Universe.claimPlanet(DB.db.universe, planetInfo, username);
        const pName = escapeHTML(planetName || claim.planetName);

        const colony = createInitialColony(username, pName, claim.galaxyId, claim.sectorId, claim.planetId);

        // Initialize missions from GameData
        if (gameData.missions) {
          colony.missions = {};
          gameData.missions.forEach(m => {
            colony.missions[m.id] = { claimed: false };
          });
        }

        DB.db.users[username] = { username: username, password: hash, salt: salt, colony: colony, createdAt: Date.now() };
        DB.saveDB();
        const token = generateToken(username);
        log(ip, 'POST /api/register (' + username + ') planet=' + pName + ' G' + planetInfo.galaxyId + 'S' + planetInfo.sectorId + 'P' + planetInfo.planetId);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          token: token,
          username: username,
          planetName: pName,
          galaxyId: claim.galaxyId,
          sectorId: claim.sectorId,
          planetId: claim.planetId
        }));
      } catch (e) {
        log(ip, 'REGISTER ERROR: ' + e.message + ' body=' + body.substring(0, 200));
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid request body: ' + e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/login') {
    let body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        const parsed = JSON.parse(body);
        const username = parsed.username;
        const password = parsed.password;
        const user = DB.db.users[username];
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid username or password' }));
          return;
        }
        const hash = hashPassword(password, user.salt);
        if (hash !== user.password) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid username or password' }));
          return;
        }

        // Migrate old users without colony
        if (!user.colony) {
          const planetInfo = Universe.ensurePlanetAvailable(DB.db.universe);
          if (planetInfo) {
            const claim = Universe.claimPlanet(DB.db.universe, planetInfo, username);
            user.colony = createInitialColony(username, claim.planetName, claim.galaxyId, claim.sectorId, claim.planetId);
            if (gameData.missions) {
              user.colony.missions = {};
              gameData.missions.forEach(m => {
                user.colony.missions[m.id] = { claimed: false };
              });
            }
            DB.saveDB();
          }
        }

        const token = generateToken(username);
        log(ip, 'POST /api/login (' + username + ')');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, token: token, username: username }));
      } catch (e) {
        log(ip, 'LOGIN ERROR: ' + e.message + ' body=' + body.substring(0, 200));
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid request: ' + e.message }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/validate') {
    let body = '';
    req.on('data', function(c) { body += c; });
    req.on('end', function() {
      try {
        const parsed = JSON.parse(body);
        const token = parsed.token;
        const username = validateToken(token);
        if (username) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, username: username }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      uptime: process.uptime(),
      players: Object.keys(DB.db.users).length,
      db: process.env.DATABASE_URL ? 'postgresql' : 'json-file',
      chatHistory: chatHistory.length
    }));
    return;
  }

  // ─── Debug: universe planet state ──────────────────────────────
  if (req.url === '/api/debug/planets') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const claimed = [];
    if (DB.db.universe && DB.db.universe.galaxies) {
      DB.db.universe.galaxies.forEach(g => {
        g.sectors.forEach(s => {
          s.planets.filter(p => p.isColonized).forEach(p => {
            claimed.push({
              name: p.name,
              type: p.type,
              id: p.id,
              colonizedBy: p.colonizedBy,
              galaxy: g.name,
              sector: s.name
            });
          });
        });
      });
    }
    res.end(JSON.stringify({ players: Object.keys(DB.db.users).length, planets: claimed }, null, 2));
    return;
  }

  // ─── Debug: user colony data ──────────────────────────────────
  if (req.url === '/api/debug/users') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const users = {};
    for (const [name, data] of Object.entries(DB.db.users)) {
      users[name] = {
        colony: data.colony ? {
          planetName: data.colony.planetName,
          homePlanet: data.colony.homePlanet,
          homeGalaxy: data.colony.homeGalaxy,
          homeSector: data.colony.homeSector,
          resources: data.colony.resources
        } : null,
        registerTime: data.registerTime,
        lastSeen: data.lastSeen
      };
    }
    res.end(JSON.stringify(users, null, 2));
    return;
  }

  // ── Static Files ──
  let filePath = req.url === '/' ? '/login.html' : req.url;
  filePath = filePath.split('?')[0];
  filePath = path.normalize(filePath).replace(/^(\\.[\\\\/])+/, '');
  const fullPath = path.join(__dirname, '..', filePath);

  if (!fullPath.startsWith(path.resolve(__dirname, '..'))) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(fullPath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';

  fs.readFile(fullPath, function(err, data) {
    if (err) {
      // Try appending .html for extensionless paths (e.g. /game -> game.html)
      const htmlPath = path.join(__dirname, '..', filePath + '.html');
      fs.readFile(htmlPath, function(err2, data2) {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<h1>Not Found</h1><p>The page you requested does not exist.</p>');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(data2);
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
  return;
});
server.on('upgrade', function(req, socket, head) {
  const ip = req.connection.remoteAddress || 'unknown';
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const accept = wsAcceptKey(key);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );

  let authenticated = false;
  let username = null;
  let idleTimeout = null;
  const IDLE_TIMEOUT_MS = 120000; // 2 minutes of inactivity = disconnect

  function resetIdleTimeout() {
    if (idleTimeout) clearTimeout(idleTimeout);
    idleTimeout = setTimeout(function() {
      if (username) {
        wsClients.delete(socket);
        broadcastAll({ type: 'system', message: escapeHTML(username) + ' has disconnected (idle timeout)' });
        broadcastPresence();
      }
      try { socket.end(); } catch(e) {}
    }, IDLE_TIMEOUT_MS);
  }

  // Helper to attach request ID from client message to server response
  function reply(socket, data, reqId) {
    if (reqId) data._reqId = reqId;
    socket.write(wsEncodeFrame(JSON.stringify(data)));
  }

  // Sequence counter for colony state responses
  let colonySeq = 0;

  // Send welcome
  socket.write(wsEncodeFrame(JSON.stringify({ type: 'system', message: 'Connected to Dead Earth Protocol' })));

  let buffer = Buffer.alloc(0);
  let authChecked = false;

  function tryAuth(data) {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'auth') {
        const uname = validateToken(msg.token);
        if (uname) {
          authenticated = true;
          username = uname;
          const user = DB.db.users[username];
          // Ensure missions exist for existing users (migration)
          if (user && user.colony && (!user.colony.missions || Object.keys(user.colony.missions).length === 0)) {
            if (gameData.missions) {
              user.colony.missions = {};
              gameData.missions.forEach(function(m) {
                user.colony.missions[m.id] = { claimed: false };
              });
              DB.saveDB();
            }
          }
          wsClients.set(socket, { username: username, colony: user && user.colony ? user.colony : null });
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'auth_ok', username: username })));
          // Send leaderboard data
          sendLeaderboardTo(socket);
          // Send recent chat history to this user
          if (chatHistory.length > 0) {
            socket.write(wsEncodeFrame(JSON.stringify({ type: 'chat_history', messages: chatHistory })));
          }

          // Send colony state with production rates
          if (user && user.colony) {
            var colony = JSON.parse(JSON.stringify(user.colony));
            colony.productionRates = ResourceSystem.getProductionRates(user.colony);
            socket.write(wsEncodeFrame(JSON.stringify({
              type: 'colony_state',
              colony: colony,
              universe: getPublicUniverse(),
              alliances: getAlliancesList(),
              gameData: getClientGameData()
            })));
          }

          // Send alliance chat history for the user's alliance (if any)
          if (user && user.colony && user.colony.alliance && user.colony.alliance.joinedId) {
            var myAid = user.colony.alliance.joinedId;
            var myAlliance = (DB.db.universe.alliances || {})[myAid];
            if (myAlliance) {
              myAlliance = normalizeAlliance(myAlliance, myAid);
              var myRoleLvl = roleLevel(getRole(myAlliance, username));
              var hist = {
                type: 'alliance_chat_history',
                allianceId: myAid,
                alliance: (myAlliance.chat.alliance || []).slice(-30)
              };
              if (myRoleLvl >= 2) hist.officers = (myAlliance.chat.officers || []).slice(-30);
              socket.write(wsEncodeFrame(JSON.stringify(hist)));
            }
          }
          log(ip, 'WS auth (' + uname + ')');
          broadcastAll({ type: 'system', message: escapeHTML(username) + ' has joined the universe' });
          broadcastPresence();
        } else {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'auth_error', message: 'Invalid token' })));
        }
        authChecked = true;
      }
    } catch(e) {}
  }

  // Swallow write-after-end / reset errors from sockets that were ended
  // while a broadcast loop still holds them (logout, delete_account, idle close).
  socket.on('error', function() {});

  socket.on('data', function(chunk) {
    resetIdleTimeout();
    buffer = Buffer.concat([buffer, chunk]);
    // Drain ALL complete frames in the buffer (client may pipeline multiple
    // messages in one TCP segment — auth + first action, chat bursts, etc.)
    while (true) {
      if (buffer.length < 2) break;
      const opcode = buffer[0] & 0x0f;
      if (opcode === 0x08) { // close
        if (username) {
          wsClients.delete(socket);
          broadcastAll({ type: 'system', message: escapeHTML(username) + ' has left the universe' });
          broadcastPresence();
        }
        socket.end();
        return;
      }
      if (opcode === 0x09) { // ping
        socket.write(Buffer.from([0x8a, 0x00]));
        buffer = buffer.slice(2);
        continue;
      }
      if (opcode !== 0x01 && opcode !== 0x02) { buffer = buffer.slice(1); continue; }

      const masked = buffer[1] & 0x80;
      let payloadLen = buffer[1] & 0x7f;
      let offset = 2;
      if (payloadLen === 126) { if (buffer.length < 4) break; offset += 2; payloadLen = buffer.readUInt16BE(2); }
      else if (payloadLen === 127) { if (buffer.length < 10) break; offset += 8; payloadLen = Number(buffer.readBigUInt64BE(2)); }

      const maskKey = masked ? buffer.slice(offset, offset + 4) : null;
      offset += masked ? 4 : 0;

      if (buffer.length < offset + payloadLen) break;
      var payload = buffer.slice(offset, offset + payloadLen);
      if (masked) {
        for (var i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
      }

      buffer = buffer.slice(offset + payloadLen);
      var text = payload.toString('utf8');

      if (!authChecked) { tryAuth(text); continue; }
      if (!authenticated) continue;

      try {
      var msg = JSON.parse(text);
      var user = DB.db.users[username];
      if (!user || !user.colony) return;
      // ── Chat ──
      if (msg.type === 'ping') {
        // JSON heartbeat — browsers can't emit raw WS ping frames
        reply(socket, { type: 'pong', t: Date.now() }, msg._reqId);
      }
      if (msg.type === 'chat') {
        // Cap and escape chat text
        var safeText = escapeHTML(msg.text.substring(0, 500));
        var safeUser = escapeHTML(username);
        var displayName = (user.colony.profile && user.colony.profile.displayName) ? escapeHTML(user.colony.profile.displayName) : null;
        var chatMsg = { type: 'chat', username: safeUser, text: safeText, time: Date.now() };
        if (displayName) chatMsg.displayName = displayName;
        chatHistory.push(chatMsg);
        if (chatHistory.length > 20) chatHistory.splice(0, chatHistory.length - 20);
        broadcastAll(chatMsg);
        DB.saveChatMessage(username, msg.text.substring(0, 500), chatMsg.time);
        log(ip, 'chat ' + username + ': ' + msg.text.substring(0, 50));
      }

      // ── Position ──
      if (msg.type === 'position') {
        var info = wsClients.get(socket);
        if (info) {
          info.position = { galaxy: msg.galaxy, sector: msg.sector, planet: msg.planet };
          wsClients.set(socket, info);
        }
      }

      // ── Get Colony State ──
      if (msg.type === 'get_colony') {
        colonySeq++;
        var colony = JSON.parse(JSON.stringify(user.colony));
        colony.productionRates = ResourceSystem.getProductionRates(user.colony);
        reply(socket, { type: 'colony_state', seq: colonySeq, colony: colony, universe: getPublicUniverse(), alliances: getAlliancesList(), gameData: getClientGameData() }, msg._reqId);
      }

      // ── Profile update (display name + base name) ──
      if (msg.type === 'profile_update') {
        var cleanName = function(s, maxLen) {
          return String(s || '').trim().replace(/\s+/g, ' ').substring(0, maxLen);
        };
        var dn = cleanName(msg.displayName, 20);
        var bn = cleanName(msg.baseName, 24);
        var nameRe = /^[A-Za-z0-9 _-]+$/;
        if (dn.length < 3 || dn.length > 20) {
          reply(socket, { type: 'profile_update_result', ok: false, error: 'Display name must be 3-20 characters' }, msg._reqId);
        } else if (bn.length < 3 || bn.length > 24) {
          reply(socket, { type: 'profile_update_result', ok: false, error: 'Base name must be 3-24 characters' }, msg._reqId);
        } else if (!nameRe.test(dn) || !nameRe.test(bn)) {
          reply(socket, { type: 'profile_update_result', ok: false, error: 'Names may only contain letters, numbers, spaces, _ and -' }, msg._reqId);
        } else {
          if (!user.colony.profile) user.colony.profile = {};
          user.colony.profile.displayName = escapeHTML(dn);
          user.colony.profile.baseName = escapeHTML(bn);
          user.colony.planetName = escapeHTML(bn);
          DB.saveDB();
          colonySeq++;
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          reply(socket, {
            type: 'profile_update_result', ok: true, colony: colony,
            universe: getPublicUniverse(), alliances: getAlliancesList(), gameData: getClientGameData()
          }, msg._reqId);
          broadcastPresence();
          log(ip, 'profile_update ' + username + ' display=' + dn + ' base=' + bn);
        }
      }

      // ── Logout (invalidate token) ──
      if (msg.type === 'logout') {
        var u = DB.db.users[username];
        if (u) {
          u.token = null;
          u.tokenExpires = 0;
          DB.saveDB();
        }
        try {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'logout_ok' })));
          socket.end();
        } catch (e) {}
        log(ip, 'logout ' + username);
        return;
      }

      // ── Delete account (permanent) ──
      if (msg.type === 'delete_account') {
        if (msg.confirm !== 'DELETE') {
          reply(socket, { type: 'delete_account_result', ok: false, error: 'Confirmation text must be DELETE' }, msg._reqId);
        } else {
          // Leave / disband any alliance the user belongs to
          var joinedId = user.colony.alliance && user.colony.alliance.joinedId;
          if (joinedId) {
            var alls = DB.db.universe.alliances || {};
            var alliance = alls[joinedId];
            if (alliance) {
              alliance = normalizeAlliance(alliance, joinedId);
              delete alliance.members[username];
              if (alliance.founder === username) {
                var remaining = Object.keys(alliance.members);
                if (remaining.length > 0) {
                  remaining.sort(function(x, y) {
                    return roleLevel(alliance.members[y].role) - roleLevel(alliance.members[x].role);
                  });
                  var newFounder = remaining[0];
                  alliance.founder = newFounder;
                  alliance.members[newFounder].role = 'founder';
                } else {
                  delete alls[joinedId];
                }
              } else if (Object.keys(alliance.members).length === 0) {
                delete alls[joinedId];
              }
            }
          }
          // Cancel in-transit attacks involving this user
          for (var pi = pendingAttacks.length - 1; pi >= 0; pi--) {
            if (pendingAttacks[pi].attacker === username || pendingAttacks[pi].defender === username) {
              pendingAttacks.splice(pi, 1);
            }
          }
          // Release claimed planets owned by the user
          var uni = DB.db.universe;
          if (uni && uni.galaxies) {
            (uni.galaxies || []).forEach(function(gal) {
              (gal.sectors || []).forEach(function(sec) {
                (sec.planets || []).forEach(function(planet) {
                  if (planet && planet.colonizedBy === username) {
                    planet.isPlayerBase = false;
                    planet.isColonized = false;
                    planet.colonizedBy = null;
                    planet.baseLevel = null;
                  }
                });
              });
            });
          }
          // Remove the user
          delete DB.db.users[username];
          DB.saveDB();
          try {
            socket.write(wsEncodeFrame(JSON.stringify({ type: 'delete_account_result', ok: true })));
            socket.end();
          } catch (e) {}
          broadcastAll({ type: 'system', message: escapeHTML(username) + ' has left the universe' });
          broadcastAll({ type: 'alliance_result', ok: true, alliances: getAlliancesList() });
          broadcastPresence();
          log(ip, 'delete_account ' + username);
          return;
        }
      }

      // ── Build ──
      if (msg.type === 'build') {
        var result = BuildingSystem.startUpgrade(user.colony, msg.buildingId);
        if (result.ok) {
          DB.saveDB();
          colonySeq++;
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          reply(socket, { type: 'build_result', ok: true, colony: colony }, msg._reqId);
          log(ip, 'build ' + username + ' ' + msg.buildingId);
        } else {
          reply(socket, { type: 'build_result', ok: false, error: result.reason }, msg._reqId);
        }
      }

      // ── Repair ──
      if (msg.type === 'building_repair') {
        var result = BuildingSystem.startRepair(user.colony, msg.buildingId);
        if (result.ok) {
          DB.saveDB();
          colonySeq++;
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          reply(socket, { type: 'build_result', ok: true, colony: colony }, msg._reqId);
          log(ip, 'repair ' + username + ' ' + msg.buildingId);
        } else {
          reply(socket, { type: 'build_result', ok: false, error: result.reason }, msg._reqId);
        }
      }

      // ── Train ──
      if (msg.type === 'train') {
        var result = TroopSystem.queueTrain(user.colony, msg.troopId, msg.qty || 1);
        if (result.ok) {
          DB.saveDB();
          colonySeq++;
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          reply(socket, { type: 'train_result', ok: true, colony: colony }, msg._reqId);
          log(ip, 'train ' + username + ' ' + msg.troopId + ' x' + (msg.qty || 1));
        } else {
          reply(socket, { type: 'train_result', ok: false, error: result.reason }, msg._reqId);
        }
      }

      // ── Claim Mission ──
      if (msg.type === 'claim_mission') {
        var missionId = msg.missionId;
        var mission = gameData.missions ? gameData.missions.find(function(m) { return m.id === missionId; }) : null;
        if (!mission) {
          reply(socket, { type: 'claim_result', ok: false, error: 'Mission not found' }, msg._reqId);
        } else if (user.colony.missions && user.colony.missions[missionId] && user.colony.missions[missionId].claimed) {
          reply(socket, { type: 'claim_result', ok: false, error: 'Already claimed' }, msg._reqId);
        } else {
          var progress = 0;
          switch (mission.type) {
            case 'buildingLevel':
              progress = (user.colony.buildings[mission.targetKey] || {}).level || 0;
              break;
            case 'troopCount':
              var total = 0;
              if (user.colony.troops && user.colony.troops.counts) {
                for (var k in user.colony.troops.counts) total += user.colony.troops.counts[k];
              }
              progress = total;
              break;
            case 'researchCount':
              progress = (user.colony.research && user.colony.research.completedTotal) || 0;
              break;
            case 'scoutCount':
              progress = (user.colony.combat && user.colony.combat.scoutsCompleted) || 0;
              break;
            case 'attackWins':
              progress = (user.colony.combat && user.colony.combat.attackWins) || 0;
              break;
            case 'defenseWins':
              progress = (user.colony.combat && user.colony.combat.defenseWins) || 0;
              break;
          }
          if (progress < mission.target) {
            reply(socket, { type: 'claim_result', ok: false, error: 'Mission not yet complete' }, msg._reqId);
          } else {
            if (!user.colony.missions) user.colony.missions = {};
            user.colony.missions[missionId] = { claimed: true };
            if (mission.reward) {
              if (!user.colony.resources) user.colony.resources = {};
              for (var r in mission.reward) {
                if (!user.colony.resources[r]) user.colony.resources[r] = { amount: 0 };
                user.colony.resources[r].amount = (user.colony.resources[r].amount || 0) + mission.reward[r];
              }
            }
            DB.saveDB();
            colonySeq++;
            var colony = JSON.parse(JSON.stringify(user.colony));
            colony.productionRates = ResourceSystem.getProductionRates(user.colony);
            reply(socket, { type: 'claim_result', ok: true, colony: colony }, msg._reqId);
            log(ip, 'claim_mission ' + username + ' ' + missionId);
          }
        }
      }

      // ── Research ──
      if (msg.type === 'research') {
        var result = ResearchSystem.startResearch(user.colony, msg.category);
        if (result.ok) {
          DB.saveDB();
          colonySeq++;
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          reply(socket, { type: 'research_result', ok: true, colony: colony }, msg._reqId);
          log(ip, 'research ' + username + ' ' + msg.category);
        } else {
          reply(socket, { type: 'research_result', ok: false, error: result.reason }, msg._reqId);
        }
      }

      // ── Scout ──
      if (msg.type === 'scout') {
        var result = CombatSystem.scout(user.colony, msg.nodeId);
        if (result.ok) {
          DB.saveDB();
          colonySeq++;
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          reply(socket, { type: 'scout_result', ok: true, colony: colony, intel: result.intel }, msg._reqId);
          log(ip, 'scout ' + username + ' ' + msg.nodeId);
        } else {
          reply(socket, { type: 'scout_result', ok: false, error: result.reason }, msg._reqId);
        }
      }

      // ── Raid ──
      if (msg.type === 'raid') {
        var result = CombatSystem.raid(user.colony, msg.nodeId);
        if (result.ok) {
          DB.saveDB();
          colonySeq++;
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          reply(socket, { type: 'raid_result', ok: true, colony: colony, success: result.success, loot: result.loot }, msg._reqId);
          log(ip, 'raid ' + username + ' ' + msg.nodeId + ' success=' + result.success);
        } else {
          reply(socket, { type: 'raid_result', ok: false, error: result.reason }, msg._reqId);
        }
      }

      // ── Expedition ──
      if (msg.type === 'expedition') {
        var result = ExpeditionSystem.launch(user.colony, msg.nodeId);
        if (result.ok) {
          DB.saveDB();
          colonySeq++;
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          reply(socket, { type: 'expedition_result', ok: true, colony: colony }, msg._reqId);
          log(ip, 'expedition ' + username + ' ' + msg.nodeId);
        } else {
          reply(socket, { type: 'expedition_result', ok: false, error: result.reason }, msg._reqId);
        }
      }

      // ── Market Exchange ──
      if (msg.type === 'exchange') {
        var result = MarketSystem.exchange(user.colony, msg.from, msg.to, msg.amount);
        if (result.ok) {
          DB.saveDB();
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          reply(socket, { type: 'exchange_result', ok: true, colony: colony }, msg._reqId);
          log(ip, 'exchange ' + username + ' ' + msg.from + '->' + msg.to);
        } else {
          reply(socket, { type: 'exchange_result', ok: false, error: result.reason }, msg._reqId);
        }
      }

      // ── Buy Artifact ──
      if (msg.type === 'buy_artifact') {
        var result = MarketSystem.buyArtifact(user.colony, msg.listingId);
        if (result.ok) {
          DB.saveDB();
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          reply(socket, { type: 'buy_artifact_result', ok: true, colony: colony }, msg._reqId);
          log(ip, 'buy_artifact ' + username + ' ' + msg.listingId);
        } else {
          reply(socket, { type: 'buy_artifact_result', ok: false, error: result.reason }, msg._reqId);
        }
      }

      // ── Private Message ──
      if (msg.type === 'private_message') {
        var target = String(msg.target).toLowerCase();
        var targetUser = DB.db.users[target];
        if (!targetUser || !targetUser.colony) {
          reply(socket, { type: 'private_message_result', ok: false, error: 'Player not found' }, msg._reqId);
        } else if (target === username.toLowerCase()) {
          reply(socket, { type: 'private_message_result', ok: false, error: 'Cannot message yourself' }, msg._reqId);
        } else {
          var text = String(msg.text).substring(0, 1000);
          var safeUsername = escapeHTML(username);
          var safeText = escapeHTML(text);
          var pm = {
            id: 'pm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            tab: 'Inbox',
            subject: 'From: ' + ((user.colony && user.colony.profile && user.colony.profile.displayName) ? escapeHTML(user.colony.profile.displayName) : safeUsername),
            body: safeText,
            time: Date.now(),
            from: escapeHTML(username),
            fromDisplayName: (user.colony && user.colony.profile && user.colony.profile.displayName) ? escapeHTML(user.colony.profile.displayName) : null,
            isNew: true
          };
          // Add to target's mailbox
          if (!targetUser.colony.mailbox) targetUser.colony.mailbox = { messages: [], selectedTab: 'Inbox', selectedMessageId: null };
          if (!targetUser.colony.mailbox.messages) targetUser.colony.mailbox.messages = [];
          targetUser.colony.mailbox.messages.unshift(pm);
          targetUser.colony.mailbox.messages = targetUser.colony.mailbox.messages.slice(0, 120);
          DB.saveDB();
          // If target is online, send immediately
          wsClients.forEach(function (info, sock) {
            if (info.username === target) {
              broadcastToUser(sock, { type: 'mailbox_update', message: pm });
            }
          });
          // Also add to sender's mailbox as confirmation
          if (!user.colony.mailbox) user.colony.mailbox = { messages: [], selectedTab: 'Inbox', selectedMessageId: null };
          if (!user.colony.mailbox.messages) user.colony.mailbox.messages = [];
          var sentPm = {
            id: 'pm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            tab: 'Inbox',
            subject: 'To: ' + escapeHTML(target),
            body: safeText,
            time: Date.now(),
            to: escapeHTML(target),
            isNew: true
          };
          user.colony.mailbox.messages.unshift(sentPm);
          user.colony.mailbox.messages = user.colony.mailbox.messages.slice(0, 120);
          // Send updated colony to sender so they see the sent message
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          reply(socket, { type: 'private_message_result', ok: true, colony: colony, sent: sentPm }, msg._reqId);
          log(ip, 'pm ' + username + ' -> ' + target + ': ' + text.substring(0, 50));
        }
      }

      if (msg.type === 'alliance_create') {
        var aName = msg.name;
        if (!aName || typeof aName !== 'string' || aName.trim().length < 2) {
          reply(socket, { type: 'alliance_result', ok: false, error: 'Alliance name must be at least 2 characters' }, msg._reqId);
        } else if (!/^[A-Za-z0-9 _\-]+$/.test(aName.trim()) || aName.trim().length > 32) {
          reply(socket, { type: 'alliance_result', ok: false, error: 'Name: letters/numbers/spaces/_- only, max 32 chars' }, msg._reqId);
        } else if (user.colony.alliance.joinedId) {
          reply(socket, { type: 'alliance_result', ok: false, error: 'You are already in an alliance' }, msg._reqId);
        } else {
          var alls = DB.db.universe.alliances = DB.db.universe.alliances || {};
          var id = 'a_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
          // Unique check (case-insensitive)
          var nameTaken = Object.keys(alls).some(function(k) { return alls[k].name.toLowerCase() === aName.trim().toLowerCase(); });
          if (nameTaken) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'An alliance with that name already exists' }, msg._reqId);
          } else {
            alls[id] = normalizeAlliance({
              id: id,
              name: aName.trim(),
              founder: username,
              created: Date.now(),
              members: { [username]: { role: 'founder', joinedAt: Date.now() } },
              motd: '',
              chat: { alliance: [], officers: [] }
            }, id);
            user.colony.alliance.joinedId = id;
            pushAudit(alls[id], { time: Date.now(), actor: username, action: 'create' });
            DB.saveDB();
            reply(socket, {
              type: 'alliance_result', ok: true, colony: cloneColonyWithRates(user.colony),
              alliances: getAlliancesList()
            }, msg._reqId);
            broadcastAll({ type: 'alliance_result', ok: true, alliances: getAlliancesList() });
            log(ip, 'alliance_create ' + username + ' -> ' + aName.trim());
          }
        }
      }

      if (msg.type === 'alliance_join') {
        var allianceId = msg.allianceId;
        if (!allianceId || typeof allianceId !== 'string' || allianceId.indexOf('__') >= 0) {
          reply(socket, { type: 'alliance_result', ok: false, error: 'Invalid alliance specified' }, msg._reqId);
        } else {
          var alls = DB.db.universe.alliances || {};
          var alliance = alls[allianceId];
          if (!alliance) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Alliance not found' }, msg._reqId);
          } else if (user.colony.alliance.joinedId) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'You are already in an alliance' }, msg._reqId);
          } else if (getRole(alliance, username)) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Already in this alliance' }, msg._reqId);
          } else {
            alliance = normalizeAlliance(alliance, allianceId);
            alliance.members[username] = { role: 'recruit', joinedAt: Date.now() };
            user.colony.alliance.joinedId = allianceId;
            pushAudit(alliance, { time: Date.now(), actor: username, action: 'join', target: username });
            DB.saveDB();
            reply(socket, {
              type: 'alliance_result', ok: true, colony: cloneColonyWithRates(user.colony),
              alliances: getAlliancesList()
            }, msg._reqId);
            broadcastAll({ type: 'alliance_result', ok: true, alliances: getAlliancesList() });
            log(ip, 'alliance_join ' + username + ' -> ' + allianceId);
          }
        }
      }

      if (msg.type === 'alliance_leave') {
        var joinedId = user.colony.alliance.joinedId;
        if (!joinedId) {
          reply(socket, { type: 'alliance_result', ok: false, error: 'Not in an alliance' }, msg._reqId);
        } else {
          var alls = DB.db.universe.alliances || {};
          var alliance = alls[joinedId];
          if (alliance) {
            alliance = normalizeAlliance(alliance, joinedId);
            delete alliance.members[username];
            // If founder leaves and others remain, transfer founder to highest-ranked member
            if (alliance.founder === username) {
              var remaining = Object.keys(alliance.members);
              if (remaining.length > 0) {
                remaining.sort(function(x, y) {
                  return roleLevel(alliance.members[y].role) - roleLevel(alliance.members[x].role);
                });
                var newFounder = remaining[0];
                alliance.founder = newFounder;
                alliance.members[newFounder].role = 'founder';
              } else {
                delete alls[joinedId];
              }
            } else if (Object.keys(alliance.members).length === 0) {
              delete alls[joinedId];
            }
            pushAudit(alliance, { time: Date.now(), actor: username, action: 'leave', target: username });
          }
          user.colony.alliance.joinedId = null;
          DB.saveDB();
          reply(socket, {
            type: 'alliance_result', ok: true, colony: cloneColonyWithRates(user.colony),
            alliances: getAlliancesList()
          }, msg._reqId);
          broadcastAll({ type: 'alliance_result', ok: true, alliances: getAlliancesList() });
          log(ip, 'alliance_leave ' + username);
        }
      }

      // ── Alliance ranks (promote/demote) — founder only ──
      if (msg.type === 'alliance_set_role') {
        var joinedId = user.colony.alliance.joinedId;
        if (!joinedId) {
          reply(socket, { type: 'alliance_result', ok: false, error: 'Not in an alliance' }, msg._reqId);
        } else {
          var alls = DB.db.universe.alliances || {};
          var alliance = alls[joinedId];
          var targetRole = msg.role;
          var validRoles = ['recruit', 'member', 'officer', 'commander'];
          if (!alliance) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Alliance not found' }, msg._reqId);
          } else if (alliance.founder !== username) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Only the founder can change roles' }, msg._reqId);
          } else if (msg.targetUsername === username) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Founder cannot change their own role' }, msg._reqId);
          } else if (validRoles.indexOf(targetRole) === -1) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Invalid role' }, msg._reqId);
          } else if (!alliance.members[msg.targetUsername]) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Target is not in this alliance' }, msg._reqId);
          } else {
            var fromRole = alliance.members[msg.targetUsername].role;
            alliance.members[msg.targetUsername].role = targetRole;
            pushAudit(alliance, { time: Date.now(), actor: username, action: 'set_role', target: msg.targetUsername, meta: { from: fromRole, to: targetRole } });
            DB.saveDB();
            reply(socket, {
              type: 'alliance_result', ok: true, colony: cloneColonyWithRates(user.colony),
              alliances: getAlliancesList()
            }, msg._reqId);
            broadcastAll({ type: 'alliance_result', ok: true, alliances: getAlliancesList() });
            log(ip, 'alliance_set_role ' + username + ' -> ' + msg.targetUsername + ' = ' + targetRole);
          }
        }
      }

      // ── Alliance chat (two channels) ──
      if (msg.type === 'alliance_chat_send') {
        var joinedId = user.colony.alliance.joinedId;
        var channel = msg.channel === 'officers' ? 'officers' : 'alliance';
        if (!joinedId) {
          reply(socket, { type: 'alliance_result', ok: false, error: 'Not in an alliance' }, msg._reqId);
        } else {
          var alls = DB.db.universe.alliances || {};
          var alliance = alls[joinedId];
          if (!alliance) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Alliance not found' }, msg._reqId);
          } else if (channel === 'officers' && roleLevel(getRole(alliance, username)) < 2) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Officer channel requires officer rank or higher' }, msg._reqId);
          } else if (roleLevel(getRole(alliance, username)) < 1) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Recruits can read chat but cannot post. Ask an officer to promote you.' }, msg._reqId);
          } else {
            var safeChatText = escapeHTML(String(msg.text || '').substring(0, 500));
            if (safeChatText.trim().length > 0) {
              alliance = normalizeAlliance(alliance, joinedId);
              var aDn = (user.colony.profile && user.colony.profile.displayName) ? escapeHTML(user.colony.profile.displayName) : null;
              var aChatMsg = { username: escapeHTML(username), text: safeChatText, time: Date.now() };
              if (aDn) aChatMsg.displayName = aDn;
              alliance.chat[channel].push(aChatMsg);
              if (alliance.chat[channel].length > 50) alliance.chat[channel] = alliance.chat[channel].slice(-50);
              DB.saveDB();
              var chatMsg = { type: 'alliance_chat', channel: channel, username: escapeHTML(username), text: safeChatText, time: Date.now() };
              if (aDn) chatMsg.displayName = aDn;
              if (channel === 'officers') {
                broadcastToAlliance(joinedId, chatMsg, function(info) {
                  var rec = DB.db.users[info.username];
                  if (!rec || !rec.colony || !rec.colony.alliance) return false;
                  var a = alls[rec.colony.alliance.joinedId];
                  return a ? roleLevel(getRole(a, info.username)) >= 2 : false;
                });
              } else {
                broadcastToAlliance(joinedId, chatMsg);
              }
            }
          }
        }
      }

      // ── Founder/officer broadcast mail ──
      if (msg.type === 'alliance_broadcast') {
        var joinedId = user.colony.alliance.joinedId;
        if (!joinedId) {
          reply(socket, { type: 'alliance_result', ok: false, error: 'Not in an alliance' }, msg._reqId);
        } else {
          var alls = DB.db.universe.alliances || {};
          var alliance = alls[joinedId];
          if (!alliance) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Alliance not found' }, msg._reqId);
          } else {
            var myRole = getMemberRole(alliance, username);
            var isFounder = alliance.founder === username;
            var officerBroadcastAllowed = roleLevel(myRole) >= 2 && alliance.perms.officer.canBroadcastOfficers;
            var audience = msg.audience === 'officers' ? 'officers' : 'all';
            if (!isFounder && !officerBroadcastAllowed) {
              reply(socket, { type: 'alliance_result', ok: false, error: 'Only the founder can broadcast (officers need the canBroadcastOfficers permission)' }, msg._reqId);
            } else if (!isFounder && audience === 'all') {
              reply(socket, { type: 'alliance_result', ok: false, error: 'Officers can only broadcast to officers' }, msg._reqId);
            } else {
              var subject = String(msg.subject || '').substring(0, 80);
              var body = String(msg.body || '').substring(0, 1500);
              if (!subject.trim()) {
                reply(socket, { type: 'alliance_result', ok: false, error: 'Subject required' }, msg._reqId);
              } else {
                var recipients = Object.keys(alliance.members).filter(function(uname) {
                  if (audience === 'all') return true;
                  return roleLevel(alliance.members[uname].role) >= 2;
                });
                var mailBody = '📢 Alliance Broadcast\nFrom: ' + username + '\nTo: ' + (audience === 'officers' ? 'Officers' : 'All Members') + '\nTime: ' + new Date().toUTCString() + '\n\n' + body;
                recipients.forEach(function(recName) {
                  var rec = DB.db.users[recName];
                  if (rec && rec.colony) {
                    pushMail(rec.colony, 'Alliance', '[Alliance] ' + subject, mailBody, 'alliance_broadcast');
                  }
                });
                pushAudit(alliance, { time: Date.now(), actor: username, action: 'broadcast', meta: { audience: audience, subject: subject } });
                DB.saveDB();
                // Optional UX: post a system line into alliance chat
                var sysLine = (isFounder ? 'Founder' : username) + ' sent a broadcast: ' + subject;
                alliance = normalizeAlliance(alliance, joinedId);
                alliance.chat.alliance.push({ username: 'System', text: escapeHTML(sysLine), time: Date.now() });
                if (alliance.chat.alliance.length > 50) alliance.chat.alliance = alliance.chat.alliance.slice(-50);
                broadcastToAlliance(joinedId, { type: 'alliance_chat', channel: 'alliance', username: 'System', text: escapeHTML(sysLine), time: Date.now() });
                broadcastToAlliance(joinedId, { type: 'alliance_update', alliancePublic: getAlliancePublic(joinedId) });
                reply(socket, { type: 'alliance_result', ok: true, message: 'Broadcast sent to ' + recipients.length + ' recipient(s)' }, msg._reqId);
                log(ip, 'alliance_broadcast ' + username + ' to ' + audience + ' (' + recipients.length + ')');
              }
            }
          }
        }
      }

      // ── MOTD (founder or officer with canEditMotd) ──
      if (msg.type === 'alliance_set_motd') {
        var joinedId = user.colony.alliance.joinedId;
        if (!joinedId) {
          reply(socket, { type: 'alliance_result', ok: false, error: 'Not in an alliance' }, msg._reqId);
        } else {
          var alls = DB.db.universe.alliances || {};
          var alliance = alls[joinedId];
          if (!alliance) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Alliance not found' }, msg._reqId);
          } else {
            var myRole = getMemberRole(alliance, username);
            var canEdit = alliance.founder === username ||
              (roleLevel(myRole) >= 2 && alliance.perms.officer.canEditMotd);
            if (!canEdit) {
              reply(socket, { type: 'alliance_result', ok: false, error: 'You do not have permission to edit the MOTD' }, msg._reqId);
            } else {
              var motd = String(msg.motd || '').replace(/[\r\n]+/g, ' ').trim().substring(0, 240);
              alliance = normalizeAlliance(alliance, joinedId);
              alliance.motd = escapeHTML(motd);
              pushAudit(alliance, { time: Date.now(), actor: username, action: 'motd_update' });
              DB.saveDB();
              broadcastToAlliance(joinedId, { type: 'alliance_update', alliancePublic: getAlliancePublic(joinedId) });
              reply(socket, { type: 'alliance_result', ok: true, message: 'MOTD updated' }, msg._reqId);
              log(ip, 'alliance_set_motd ' + username);
            }
          }
        }
      }

      // ── Audit log (founder or officer with canViewAudit) ──
      if (msg.type === 'alliance_get_audit') {
        var joinedId = user.colony.alliance.joinedId;
        if (!joinedId) {
          reply(socket, { type: 'alliance_result', ok: false, error: 'Not in an alliance' }, msg._reqId);
        } else {
          var alls = DB.db.universe.alliances || {};
          var alliance = alls[joinedId];
          if (!alliance) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Alliance not found' }, msg._reqId);
          } else {
            var myRole = getMemberRole(alliance, username);
            var canView = alliance.founder === username ||
              (roleLevel(myRole) >= 2 && alliance.perms.officer.canViewAudit);
            if (!canView) {
              reply(socket, { type: 'alliance_result', ok: false, error: 'You do not have permission to view the audit log' }, msg._reqId);
            } else {
              var limit = Math.max(1, Math.min(200, parseInt(msg.limit, 10) || 100));
              reply(socket, { type: 'alliance_audit', ok: true, entries: (alliance.audit || []).slice(0, limit) }, msg._reqId);
              log(ip, 'alliance_get_audit ' + username + ' (' + (alliance.audit || []).length + ' entries)');
            }
          }
        }
      }

      // ── Permissions (founder only) ──
      if (msg.type === 'alliance_set_perms') {
        var joinedId = user.colony.alliance.joinedId;
        if (!joinedId) {
          reply(socket, { type: 'alliance_result', ok: false, error: 'Not in an alliance' }, msg._reqId);
        } else {
          var alls = DB.db.universe.alliances || {};
          var alliance = alls[joinedId];
          if (!alliance) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Alliance not found' }, msg._reqId);
          } else if (alliance.founder !== username) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Only the founder can change permissions' }, msg._reqId);
          } else {
            alliance = normalizeAlliance(alliance, joinedId);
            var incoming = msg.perms || {};
            var merged = JSON.parse(JSON.stringify(DEFAULT_PERMS));
            ['officer', 'commander'].forEach(function (rank) {
              var src = incoming[rank];
              if (src && typeof src === 'object') {
                Object.keys(merged[rank]).forEach(function (key) {
                  if (typeof src[key] === 'boolean') merged[rank][key] = src[key];
                });
              }
            });
            alliance.perms = merged;
            pushAudit(alliance, { time: Date.now(), actor: username, action: 'set_perms', meta: { perms: JSON.stringify(alliance.perms) } });
            DB.saveDB();
            broadcastToAlliance(joinedId, { type: 'alliance_update', alliancePublic: getAlliancePublic(joinedId) });
            reply(socket, { type: 'alliance_result', ok: true, message: 'Permissions updated' }, msg._reqId);
            log(ip, 'alliance_set_perms ' + username);
          }
        }
      }

      // ── Kick member ──
      if (msg.type === 'alliance_kick') {
        var joinedId = user.colony.alliance.joinedId;
        if (!joinedId) {
          reply(socket, { type: 'alliance_result', ok: false, error: 'Not in an alliance' }, msg._reqId);
        } else {
          var alls = DB.db.universe.alliances || {};
          var alliance = alls[joinedId];
          if (!alliance) {
            reply(socket, { type: 'alliance_result', ok: false, error: 'Alliance not found' }, msg._reqId);
          } else {
            var targetName = String(msg.targetUsername || '');
            var myRole = getMemberRole(alliance, username);
            var targetRole = getMemberRole(alliance, targetName);
            var myLvl = roleLevel(myRole);
            var tgtLvl = roleLevel(targetRole);
            var allowed = false;
            if (alliance.founder === username) {
              allowed = targetName !== username && targetName !== '';
            } else if (myLvl >= 3) {
              // commanders: can kick recruits/members if perms allow
              if (tgtLvl <= 0 && alliance.perms.commander.canKickRecruits) allowed = true;
              else if (tgtLvl === 1 && alliance.perms.commander.canKickMembers) allowed = true;
            } else if (myLvl >= 2) {
              // officers: can kick recruits if perms allow
              if (tgtLvl <= 0 && alliance.perms.officer.canKickRecruits) allowed = true;
            }
            if (!targetName || !targetRole) {
              reply(socket, { type: 'alliance_result', ok: false, error: 'Target is not in this alliance' }, msg._reqId);
            } else if (targetName === username) {
              reply(socket, { type: 'alliance_result', ok: false, error: 'You cannot kick yourself' }, msg._reqId);
            } else if (!allowed) {
              reply(socket, { type: 'alliance_result', ok: false, error: 'You do not have permission to kick that member' }, msg._reqId);
            } else {
              delete alliance.members[targetName];
              var kickedUser = DB.db.users[targetName];
              if (kickedUser && kickedUser.colony) {
                kickedUser.colony.alliance.joinedId = null;
                pushMail(kickedUser.colony, 'Alliance', 'You were removed from ' + alliance.name,
                  'You have been removed from the alliance "' + alliance.name + '".', 'alliance_kick');
              }
              pushAudit(alliance, { time: Date.now(), actor: username, action: 'kick', target: targetName });
              DB.saveDB();
              broadcastToAlliance(joinedId, { type: 'alliance_update', alliancePublic: getAlliancePublic(joinedId) });
              reply(socket, { type: 'alliance_result', ok: true, message: targetName + ' was kicked from the alliance' }, msg._reqId);
              log(ip, 'alliance_kick ' + username + ' -> ' + targetName);
            }
          }
        }
      }

      if (msg.type === 'sync_fleets') {
        // Merge: preserve server-side transit state (client may not have it yet)
        var incoming = msg.fleets || {};
        var existing = user.colony.troops.fleets || {};
        Object.keys(incoming).forEach(function(fid) {
          if (existing[fid] && existing[fid].transit && !incoming[fid].transit) {
            incoming[fid].transit = existing[fid].transit;
          }
        });
        user.colony.troops.fleets = incoming;
        DB.saveDB();
      }

      if (msg.type === 'attack_fleet') {
        var fleetId = msg.fleetId;
        var targetName = msg.target;
        var targetBuilding = msg.targetBuilding || 'any';
        var fleet = user.colony.troops && user.colony.troops.fleets ? user.colony.troops.fleets[fleetId] : null;
        if (!fleet) {
          reply(socket, { type: 'attack_result', ok: false, error: 'Fleet not found' }, msg._reqId);
        } else if (fleet.transit) {
          reply(socket, { type: 'attack_result', ok: false, error: 'Fleet is already in transit' }, msg._reqId);
        } else if (targetName === username) {
          reply(socket, { type: 'attack_result', ok: false, error: 'Cannot attack yourself' }, msg._reqId);
        } else {
          var targetUser = DB.db.users[targetName];
          if (!targetUser || !targetUser.colony) {
            reply(socket, { type: 'attack_result', ok: false, error: 'Target not found' }, msg._reqId);
          } else {
            // Ensure both sides have position (handle legacy players without it)
            if (!targetUser.colony.position) {
              targetUser.colony.position = { galaxy: targetUser.homeGalaxy, sector: targetUser.homeSector, planet: targetUser.homePlanet };
            }
            if (!user.colony.position) {
              user.colony.position = { galaxy: user.homeGalaxy, sector: user.homeSector, planet: user.homePlanet };
            }
            var origin = user.colony.position;
            var target = targetUser.colony.position;
            var travelTime = calculateTravelTime(origin, target);
            var arrivalTime = Date.now() + travelTime * 1000;

            // Compute attacker power from fleet (snapshot at launch)
            var atkMod = 1 + (user.colony.research.levels.military || 0) * 0.08;
            var atkPower = 0;
            var fleetTroops = fleet.troops || {};
            Object.keys(fleetTroops).forEach(function (key) {
              var count = fleetTroops[key] || 0;
              var def = gameData.troops[key];
              if (def) atkPower += count * def.power * atkMod;
            });
            atkPower = Math.floor(atkPower);

            // Compute defender power including shield generator
            var defMod = 1 + (targetUser.colony.research.levels.defense || 0) * 0.06;
            var defPower = 0;
            var defCounts = targetUser.colony.troops.counts || {};
            Object.keys(defCounts).forEach(function (key) {
              var count = defCounts[key] || 0;
              var def = gameData.troops[key];
              if (def) defPower += count * def.defense * defMod;
            });
            defPower = Math.floor(defPower);
            var shieldBonus = (targetUser.colony.buildings.shieldGenerator && targetUser.colony.buildings.shieldGenerator.level || 0) * 25;
            var defPowerWithShield = defPower + shieldBonus;

            // Mark fleet as in transit (store full combat snapshot for restart resilience)
            fleet.transit = {
              mode: 'pvp_attack',
              returning: false,
              startTime: Date.now(),
              attacker: username,
              defender: targetName,
              target: targetName, // username string (legacy display compat)
              arrivalTime: arrivalTime,
              targetBuilding: targetBuilding,
              fleetComposition: JSON.parse(JSON.stringify(fleetTroops)),
              atkPower: atkPower,
              defPowerWithShield: defPowerWithShield,
              travelTime: travelTime,
              origin: { galaxyId: origin.galaxy, sectorId: origin.sector, planetId: origin.planet, planetName: user.colony.planetName || (username + "'s Planet") },
              targetPos: { galaxyId: target.galaxy, sectorId: target.sector, planetId: target.planet, planetName: targetUser.colony.planetName || (targetName + "'s Planet") }
            };

            // Push to pending queue
            pendingAttacks.push({
              attacker: username,
              defender: targetName,
              fleetId: fleetId,
              targetBuilding: targetBuilding,
              fleetComposition: JSON.parse(JSON.stringify(fleetTroops)),
              atkPower: atkPower,
              defPowerWithShield: defPowerWithShield,
              arrivalTime: arrivalTime,
              travelTime: travelTime,
              origin: { galaxy: origin.galaxy, sector: origin.sector, planet: origin.planet, planetName: username }
            });

            DB.saveDB();

            // Confirm launch to attacker
            reply(socket, {
              type: 'attack_launched',
              ok: true,
              target: targetName,
              eta: travelTime,
              arrivalTime: arrivalTime,
              fleetId: fleetId,
              atkPower: atkPower,
              defPower: defPowerWithShield,
              transit: fleet.transit
            }, msg._reqId);

            // Notify defender of incoming attack (no fleet strength — preserves surprise)
            wsClients.forEach(function (info, sock) {
              if (info.username === targetName) {
                broadcastToUser(sock, {
                  type: 'incoming_attack',
                  attacker: username,
                  eta: travelTime,
                  arrivalTime: arrivalTime,
                  origin: { galaxy: origin.galaxy, sector: origin.sector, planet: origin.planet }
                });
              }
            });

            // Add PvP attack to defender's colony.combat.incomingAttacks so it persists across colony_state syncs
            if (!targetUser.colony.combat) targetUser.colony.combat = { scoutsCompleted:0, attackWins:0, defenseWins:0, incomingAttacks:[], raidHistory:[] };
            if (!targetUser.colony.combat.incomingAttacks) targetUser.colony.combat.incomingAttacks = [];
            targetUser.colony.combat.incomingAttacks.push({
              id: 'pvp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
              threatLevel: '?',
              remaining: travelTime,
              retaliation: false,
              attacker: username,
              origin: { galaxy: origin.galaxy, sector: origin.sector, planet: origin.planet }
            });

            log(ip, 'attack_fleet ' + username + ' -> ' + targetName + ' (launched, ETA ' + travelTime + 's)');
          }
        }
      }

    } catch(e) {
      console.error('WebSocket error:', e);
    }
    } // end while (drain frames)
  });

  socket.on('close', function() {
    if (idleTimeout) clearTimeout(idleTimeout);
    if (username) {
      wsClients.delete(socket);
      broadcastAll({ type: 'system', message: escapeHTML(username) + ' has left the universe' });
      broadcastPresence();
    }
  });
});

// ─── Start Server (async) ─────────────────────────────────────────
(async function start() {
  await DB.loadDB();

  // Ensure all galaxies carry universe coordinates (backfill for pre-existing DBs)
  Universe.backfillGalaxyCoords(DB.db.universe);

  // Normalize alliances: legacy array members -> role map, ensure chat/motd exist
  normalizeAlliances();
  DB.saveDB();

  // Load persistent chat history from database
  try {
    var savedHistory = await DB.loadChatHistory(20);
    chatHistory.length = 0;
    savedHistory.forEach(function(m) { chatHistory.push(m); });
    console.log('  Chat:     ' + chatHistory.length + ' recent messages loaded');
  } catch (e) {
    console.log('  Chat:     (no saved history)');
  }

  // ─── Clean up / restore fleet transits after restart ───
  var users = DB.db.users || {};
  var restored = 0;
  var resolved = 0;
  Object.keys(users).forEach(function(uname) {
    var colony = users[uname].colony;
    if (!colony || !colony.troops || !colony.troops.fleets) return;
    Object.keys(colony.troops.fleets).forEach(function(fid) {
      var f = colony.troops.fleets[fid];
      if (!f.transit || f.transit.returning) return;
      // If arrivalTime is missing/invalid, or attack should have already landed,
      // resolve it immediately (push with arrived timestamp)
      var arrived = !f.transit.arrivalTime || isNaN(f.transit.arrivalTime) || f.transit.arrivalTime < Date.now();
      pendingAttacks.push({
        attacker: f.transit.attacker || (f.transit.origin && f.transit.origin.planetName) || uname,
        defender: f.transit.defender || f.transit.target,
        fleetId: fid,
        targetBuilding: f.transit.targetBuilding || 'any',
        fleetComposition: f.transit.fleetComposition || f.troops || {},
        atkPower: f.transit.atkPower || 0,
        defPowerWithShield: f.transit.defPowerWithShield || 0,
        arrivalTime: arrived ? Date.now() : f.transit.arrivalTime,
        travelTime: f.transit.travelTime || 30,
        origin: f.transit.origin || { planetName: uname }
      });
      if (arrived) resolved++; else restored++;
    });
  });
  if (resolved > 0) { DB.saveDB(); console.log('  Fleet:    ' + resolved + ' overdue attacks queued for resolution'); }
  if (restored > 0) console.log('  Fleet:    ' + restored + ' active transits restored');
  console.log('  Fleet:    ' + pendingAttacks.length + ' total pending attacks');

  server.listen(PORT, '0.0.0.0', function() {
    console.log('');
    console.log('  🚀 Dead Earth Protocol — Multiplayer Server');
    console.log('  ------------------------------------------------');
    console.log('  Server:   http://localhost:' + PORT);
    console.log('  Database: ' + (process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON file'));
    console.log('  Players:  ' + Object.keys(DB.db.users).length + ' registered users');
    console.log('  Universe: ' + Universe.getClaimedCount(DB.db.universe) + ' planets claimed');
    console.log('');

    // Start game loop
    GameLoop.startLoop(DB.db, { broadcast: broadcastAll }, function() { DB.saveDB(); }, processPendingAttacks);

    // Broadcast leaderboard every 30 seconds
    setInterval(broadcastLeaderboard, 30000);
    broadcastLeaderboard(); // also send immediately at startup
  });
})();