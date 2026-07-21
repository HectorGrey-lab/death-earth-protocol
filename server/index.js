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

// ─── Config ───────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

// ─── Data ─────────────────────────────────────────────────────────
const gameData = JSON.parse(fs.readFileSync(path.join(__dirname, 'game-data.json'), 'utf-8'));

// ─── Database ─────────────────────────────────────────────────────
// db is populated asynchronously at startup (see server.listen)
const db = DB.db;   // referential — will point to the module's cache once loaded

// ─── WebSocket broadcast helpers ──────────────────────────────────
const wsClients = new Map(); // socket -> { username, colony }

function broadcastAll(msg) {
  const data = JSON.stringify(msg);
  wsClients.forEach((info, socket) => {
    try { socket.write(wsEncodeFrame(data)); } catch(e) {}
  });
}

function broadcastToUser(socket, msg) {
  try { socket.write(wsEncodeFrame(JSON.stringify(msg))); } catch(e) {}
}

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
  return { counts: {}, queue: [] };
}

function createInitialResearch() {
  return { levels: {}, active: null, completedTotal: 0 };
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
    res.end(JSON.stringify({ ok: true, uptime: process.uptime(), players: Object.keys(DB.db.users).length }));
    return;
  }

  // ── Static Files ──
  let filePath = req.url === '/' ? '/login.html' : req.url;
  filePath = path.normalize(filePath).replace(/^(\.[\\/])+/, '');
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
});

// ─── WebSocket Upgrade ────────────────────────────────────────────
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
          wsClients.set(socket, { username: username, colony: user && user.colony ? user.colony : null });
          socket.write(wsEncodeFrame(JSON.stringify({ type: 'auth_ok', username: username })));

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
        broadcastAll(chatMsg);
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
    GameLoop.startLoop(DB.db, { broadcast: broadcastAll }, function() { DB.saveDB(); });
  });
})();
