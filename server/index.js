const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
    try { socket.write(wsEncodeFrame(data)); } catch(e) {}
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

    data.population.push({
      name: name,
      score: ResourceSystem.getPopulation(c)
    });
    data.raider.push({
      name: name,
      score: (c.combat && c.combat.attackWins) || 0
    });
    data.attacker.push({
      name: name,
      score: CombatSystem.getTotalPower(c)
    });
    data.defence.push({
      name: name,
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

function sendLeaderboardTo(socket) {
  try {
    socket.write(wsEncodeFrame(JSON.stringify({
      type: 'leaderboard',
      data: computeLeaderboard()
    })));
  } catch(e) {}
}

function broadcastLeaderboard() {
  var data = computeLeaderboard();
  var msg = JSON.stringify({ type: 'leaderboard', data: data });
  wsClients.forEach(function(info, socket) {
    try { socket.write(wsEncodeFrame(msg)); } catch(e) {}
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

// ─── PvP Travel Time & Pending Attack Resolution ────────────────
function calculateTravelTime(origin, target) {
  if (origin.galaxy === target.galaxy && origin.sector === target.sector) {
    return Math.max(30, Math.abs(origin.planet - target.planet) * 30); // 30s–2min
  }
  if (origin.galaxy === target.galaxy) {
    return Math.abs(origin.sector - target.sector) * 300 + Math.abs(origin.planet - target.planet) * 30; // 5min+ per sector
  }
  return 1800; // 30 min across galaxies
}

function processPendingAttacks(now) {
  var due = [];
  pendingAttacks.forEach(function(pa, idx) {
    if (now >= pa.arrivalTime) due.push(idx);
  });
  due.sort(function(a,b){return b-a}).forEach(function(idx) {
    var pa = pendingAttacks.splice(idx, 1)[0];
    resolvePendingAttack(pa);
  });
}

function resolvePendingAttack(pa) {
  var att = DB.db.users[pa.attacker];
  var def = DB.db.users[pa.defender];
  if (!att || !def || !att.colony || !def.colony) return;

  var fleet = att.colony.troops && att.colony.troops.fleets ? att.colony.troops.fleets[pa.fleetId] : null;
  if (!fleet) return;
  var fleetTroops = fleet.troops || {};

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
  var total = pa.atkPower + defPowerWithShield;
  var ratio = total > 0 ? pa.atkPower / total : 0;
  var attackerWins = ratio >= 0.33;

  var atkLossRate = Math.min(0.8, Math.max(0.05, attackerWins ? (1 - ratio) * 0.6 : 0.5));
  var defLossRate = Math.min(0.8, Math.max(0.05, attackerWins ? ratio * 0.7 : (1 - ratio) * 0.3));

  // Attacker casualties
  var atkCas = {};
  Object.keys(fleetTroops).forEach(function(key) {
    var count = fleetTroops[key] || 0;
    var lost = Math.min(count, Math.max(1, Math.floor(count * atkLossRate)));
    if (lost > 0) { atkCas[key] = lost; fleetTroops[key] = count - lost; if (fleetTroops[key] <= 0) delete fleetTroops[key]; }
  });

  // Defender casualties
  var defCounts = def.colony.troops.counts || {};
  var defCas = {};
  Object.keys(defCounts).forEach(function(key) {
    var count = defCounts[key] || 0;
    var lost = Math.min(count, Math.max(1, Math.floor(count * defLossRate)));
    if (lost > 0) { defCas[key] = lost; def.colony.troops.counts[key] = Math.max(0, count - lost); if (def.colony.troops.counts[key] <= 0) delete def.colony.troops.counts[key]; }
  });

  // Loot (attacker win only)
  var loot = {};
  if (attackerWins) {
    var carry = 0;
    Object.keys(fleetTroops).forEach(function(key) {
      var count = fleetTroops[key] || 0;
      var d = gameData.troops[key];
      carry += count * (d && d.carryCapacity ? d.carryCapacity : 10);
    });
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
          b.integrity = (b.integrity || 100) - dmgPerTarget;
          while (b.integrity <= 0 && b.level > 0) {
            b.level--;
            if (b.level > 0) b.integrity = 100;
          }
          if (b.level <= 0) b.level = 0;
        }
      }
    }
  }

  // Stats
  if (!att.colony.combat) att.colony.combat = { scoutsCompleted:0, attackWins:0, defenseWins:0, incomingAttacks:[], raidHistory:[] };
  if (!def.colony.combat) def.colony.combat = { scoutsCompleted:0, attackWins:0, defenseWins:0, incomingAttacks:[], raidHistory:[] };
  if (attackerWins) { att.colony.combat.attackWins = (att.colony.combat.attackWins||0)+1; def.colony.combat.defenseWins = (def.colony.combat.defenseWins||0)+1; }
  else { def.colony.combat.defenseWins = (def.colony.combat.defenseWins||0)+1; }

  // Unlock / cleanup fleet
  delete fleet.transit;
  if (Object.keys(fleetTroops).length === 0) delete att.colony.troops.fleets[pa.fleetId];

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
    b[key] = {
      level: 1,
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
    combat: { scoutsCompleted: 0, attackWins: 0, defenseWins: 0, incomingAttacks: [], raidHistory: [], scoutingIntel: {} },
    expeditions: { active: null, completed: [], queue: [] },
    inventory: { artifacts: [] },
    mailbox: { messages: [], selectedTab: 'System', selectedMessageId: null },
    alliance: { joinedId: null },
    events: { active: null, history: [] },
    market: { transactions: [], listings: [] },
    missions: {}, // Will be populated from GameData.missions
    queue: [],
    lastTick: Date.now(),
    shield: { current: 120, max: 120 }
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
        const username = parsed.username;
        const password = parsed.password;
        const planetName = parsed.planetName;
        if (!username || !password || username.length < 2 || password.length < 3) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid username or password (min 2/3 chars)' }));
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
        const pName = planetName || claim.planetName;

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
              universe: DB.db.universe
            })));
          }
          log(ip, 'WS auth (' + uname + ')');
          broadcastAll({ type: 'system', message: username + ' has joined the universe' });
        } else {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'auth_error', message: 'Invalid token' })));
        }
        authChecked = true;
      }
    } catch(e) {}
  }

  socket.on('data', function(chunk) {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length < 2) return;
    const opcode = buffer[0] & 0x0f;
    if (opcode === 0x08) { // close
      if (username) {
        wsClients.delete(socket);
        broadcastAll({ type: 'system', message: username + ' has left the universe' });
      }
      socket.end();
      return;
    }
    if (opcode === 0x09) { // ping
      socket.write(Buffer.from([0x8a, 0x00]));
      return;
    }
    if (opcode !== 0x01 && opcode !== 0x02) return;

    const masked = buffer[1] & 0x80;
    let payloadLen = buffer[1] & 0x7f;
    let offset = 2;
    if (payloadLen === 126) { offset += 2; payloadLen = buffer.readUInt16BE(2); }
    else if (payloadLen === 127) { offset += 8; payloadLen = Number(buffer.readBigUInt64BE(2)); }

    const maskKey = masked ? buffer.slice(offset, offset + 4) : null;
    offset += masked ? 4 : 0;

    if (buffer.length < offset + payloadLen) return;
    var payload = buffer.slice(offset, offset + payloadLen);
    if (masked) {
      for (var i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
    }

    buffer = buffer.slice(offset + payloadLen);
    var text = payload.toString('utf8');

    if (!authChecked) { tryAuth(text); return; }
    if (!authenticated) return;

    try {
      var msg = JSON.parse(text);
      var user = DB.db.users[username];
      if (!user || !user.colony) return;

      // ── Chat ──
      if (msg.type === 'chat') {
        var chatMsg = { type: 'chat', username: username, text: msg.text.substring(0, 500), time: Date.now() };
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
        var colony = JSON.parse(JSON.stringify(user.colony));
        colony.productionRates = ResourceSystem.getProductionRates(user.colony);
        socket.write(wsEncodeFrame(JSON.stringify({ type: 'colony_state', colony: colony, universe: DB.db.universe })));
      }

      // ── Build ──
      if (msg.type === 'build') {
        var result = BuildingSystem.startUpgrade(user.colony, msg.buildingId);
        if (result.ok) {
          DB.saveDB();
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'build_result', ok: true, colony: colony })));
          log(ip, 'build ' + username + ' ' + msg.buildingId);
        } else {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'build_result', ok: false, error: result.reason })));
        }
      }

      // ── Train ──
      if (msg.type === 'train') {
        var result = TroopSystem.queueTrain(user.colony, msg.troopId, msg.qty || 1);
        if (result.ok) {
          DB.saveDB();
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'train_result', ok: true, colony: colony })));
          log(ip, 'train ' + username + ' ' + msg.troopId + ' x' + (msg.qty || 1));
        } else {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'train_result', ok: false, error: result.reason })));
        }
      }

      // ── Claim Mission ──
      if (msg.type === 'claim_mission') {
        var missionId = msg.missionId;
        var mission = gameData.missions ? gameData.missions.find(function(m) { return m.id === missionId; }) : null;
        if (!mission) {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'claim_result', ok: false, error: 'Mission not found' })));
        } else if (user.colony.missions && user.colony.missions[missionId] && user.colony.missions[missionId].claimed) {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'claim_result', ok: false, error: 'Already claimed' })));
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
            socket.write(wsEncodeFrame(JSON.stringify({ type: 'claim_result', ok: false, error: 'Mission not yet complete' })));
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
            var colony = JSON.parse(JSON.stringify(user.colony));
            colony.productionRates = ResourceSystem.getProductionRates(user.colony);
            socket.write(wsEncodeFrame(JSON.stringify({ type: 'claim_result', ok: true, colony: colony })));
            log(ip, 'claim_mission ' + username + ' ' + missionId);
          }
        }
      }

      // ── Research ──
      if (msg.type === 'research') {
        var result = ResearchSystem.startResearch(user.colony, msg.category);
        if (result.ok) {
          DB.saveDB();
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'research_result', ok: true, colony: colony })));
          log(ip, 'research ' + username + ' ' + msg.category);
        } else {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'research_result', ok: false, error: result.reason })));
        }
      }

      // ── Scout ──
      if (msg.type === 'scout') {
        var result = CombatSystem.scout(user.colony, msg.nodeId);
        if (result.ok) {
          DB.saveDB();
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'scout_result', ok: true, colony: colony, intel: result.intel })));
          log(ip, 'scout ' + username + ' ' + msg.nodeId);
        } else {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'scout_result', ok: false, error: result.reason })));
        }
      }

      // ── Raid ──
      if (msg.type === 'raid') {
        var result = CombatSystem.raid(user.colony, msg.nodeId);
        if (result.ok) {
          DB.saveDB();
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'raid_result', ok: true, colony: colony, success: result.success, loot: result.loot })));
          log(ip, 'raid ' + username + ' ' + msg.nodeId + ' success=' + result.success);
        } else {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'raid_result', ok: false, error: result.reason })));
        }
      }

      // ── Expedition ──
      if (msg.type === 'expedition') {
        var result = ExpeditionSystem.launch(user.colony, msg.nodeId);
        if (result.ok) {
          DB.saveDB();
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'expedition_result', ok: true, colony: colony })));
          log(ip, 'expedition ' + username + ' ' + msg.nodeId);
        } else {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'expedition_result', ok: false, error: result.reason })));
        }
      }

      // ── Market Exchange ──
      if (msg.type === 'exchange') {
        var result = MarketSystem.exchange(user.colony, msg.from, msg.to, msg.amount);
        if (result.ok) {
          DB.saveDB();
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'exchange_result', ok: true, colony: colony })));
          log(ip, 'exchange ' + username + ' ' + msg.from + '->' + msg.to);
        } else {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'exchange_result', ok: false, error: result.reason })));
        }
      }

      // ── Buy Artifact ──
      if (msg.type === 'buy_artifact') {
        var result = MarketSystem.buyArtifact(user.colony, msg.listingId);
        if (result.ok) {
          DB.saveDB();
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'buy_artifact_result', ok: true, colony: colony })));
          log(ip, 'buy_artifact ' + username + ' ' + msg.listingId);
        } else {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'buy_artifact_result', ok: false, error: result.reason })));
        }
      }

      // ── Private Message ──
      if (msg.type === 'private_message') {
        var target = String(msg.target).toLowerCase();
        var targetUser = DB.db.users[target];
        if (!targetUser || !targetUser.colony) {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'private_message_result', ok: false, error: 'Player not found' })));
        } else if (target === username.toLowerCase()) {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'private_message_result', ok: false, error: 'Cannot message yourself' })));
        } else {
          var text = String(msg.text).substring(0, 1000);
          var pm = {
            id: 'pm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
            tab: 'Inbox',
            subject: 'From: ' + username,
            body: text,
            time: Date.now(),
            from: username
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
            subject: 'To: ' + target,
            body: text,
            time: Date.now(),
            to: target
          };
          user.colony.mailbox.messages.unshift(sentPm);
          user.colony.mailbox.messages = user.colony.mailbox.messages.slice(0, 120);
          // Send updated colony to sender so they see the sent message
          var colony = JSON.parse(JSON.stringify(user.colony));
          colony.productionRates = ResourceSystem.getProductionRates(user.colony);
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'private_message_result', ok: true, colony: colony, sent: sentPm })));
          log(ip, 'pm ' + username + ' -> ' + target + ': ' + text.substring(0, 50));
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
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'attack_result', ok: false, error: 'Fleet not found' })));
        } else if (fleet.transit) {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'attack_result', ok: false, error: 'Fleet is already in transit' })));
        } else if (targetName === username) {
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'attack_result', ok: false, error: 'Cannot attack yourself' })));
        } else {
          var targetUser = DB.db.users[targetName];
          if (!targetUser || !targetUser.colony) {
            socket.write(wsEncodeFrame(JSON.stringify({ type: 'attack_result', ok: false, error: 'Target not found' })));
          } else if (!targetUser.colony.position) {
            socket.write(wsEncodeFrame(JSON.stringify({ type: 'attack_result', ok: false, error: 'Target has no planet position' })));
          } else {
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

            // Mark fleet as in transit
            fleet.transit = {
              target: targetName,
              arrivalTime: arrivalTime,
              origin: { galaxy: origin.galaxy, sector: origin.sector, planet: origin.planet, planetName: username }
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
            socket.write(wsEncodeFrame(JSON.stringify({
              type: 'attack_launched',
              ok: true,
              target: targetName,
              eta: travelTime,
              arrivalTime: arrivalTime,
              fleetId: fleetId,
              atkPower: atkPower,
              defPower: defPowerWithShield
            })));

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

            log(ip, 'attack_fleet ' + username + ' -> ' + targetName + ' (launched, ETA ' + travelTime + 's)');
          }
        }
      }

    } catch(e) {
      console.error('WebSocket error:', e);
    }
  });

  socket.on('close', function() {
    if (username) {
      wsClients.delete(socket);
      broadcastAll({ type: 'system', message: username + ' has left the universe' });
    }
  });
});

// ─── Start Server (async) ─────────────────────────────────────────
(async function start() {
  await DB.loadDB();

  // Load persistent chat history from database
  try {
    var savedHistory = await DB.loadChatHistory(20);
    chatHistory.length = 0;
    savedHistory.forEach(function(m) { chatHistory.push(m); });
    console.log('  Chat:     ' + chatHistory.length + ' recent messages loaded');
  } catch (e) {
    console.log('  Chat:     (no saved history)');
  }

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
