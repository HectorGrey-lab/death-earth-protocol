/**
 * admin.js — Admin console: auth, player management, resource editing
 */

const crypto = require('crypto');

// In-memory session tokens
const sessions = new Map();

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function init(DB, GAME, envPassword) {
  const ADMIN_PASSWORD = envPassword || 'thegreyzone';

  function adminAuth(req, res) {
    // CORS / preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' });
      return res.end();
    }

    const url = req.url.split('?')[0];
    const method = req.method;

    // Serve admin page
    if (url === '/admin' && method === 'GET') {
      serveAdminPage(res);
      return true;
    }

    // Login — no token needed
    if (url === '/api/admin/login' && method === 'POST') {
      adminLogin(req, res);
      return true;
    }

    // All other /api/admin/* routes require auth
    if (url.startsWith('/api/admin/')) {
      const token = extractToken(req);
      if (!token || !sessions.has(token)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Unauthorized' }));
        return true;
      }
      // Refresh session TTL
      const session = sessions.get(token);
      session.lastSeen = Date.now();
      sessions.set(token, session);

      return handleAdminAPI(method, url, req, res, DB, GAME);
    }

    return false; // not an admin route
  }

  function serveAdminPage(res) {
    const fs = require('fs');
    const path = require('path');
    const adminHtmlPath = path.join(__dirname, '..', 'admin.html');
    try {
      const html = fs.readFileSync(adminHtmlPath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<h1>Admin page not found</h1><p>Create admin.html in the project root.</p>');
    }
  }

  function adminLogin(req, res) {
    const body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      try {
        const data = JSON.parse(Buffer.concat(body).toString());
        if (data.password === ADMIN_PASSWORD) {
          const token = generateToken();
          sessions.set(token, { username: 'admin', lastSeen: Date.now() });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, token: token }));
        } else {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid password' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Bad request' }));
      }
    });
  }

  function extractToken(req) {
    const auth = req.headers['authorization'] || '';
    const match = auth.match(/Bearer\s+(.+)/i);
    if (match) return match[1];
    return null;
  }

  return adminAuth;
}

function handleAdminAPI(method, url, req, res, DB, GAME) {
  const parsed = url.replace('/api/admin/', '').split('/');
  // parsed = ['players'] or ['players', username] or ['players', username, 'resources'] etc.
  const resource = parsed[0];
  const username = parsed[1];
  const action = parsed[2];

  if (resource === 'players' && method === 'GET' && !username) {
    // List all players
    const list = Object.keys(DB.db.users).map(name => {
      const u = DB.db.users[name];
      const c = u.colony;
      return {
        username: name,
        population: c ? require('./systems/resources').getPopulation(c) : 0,
        resources: c ? {
          ore: Math.floor(c.resources.ore?.amount || 0),
          solar: Math.floor(c.resources.solar?.amount || 0),
          crystal: Math.floor(c.resources.crystal?.amount || 0),
          isotopes: Math.floor(c.resources.isotopes?.amount || 0)
        } : {},
        buildings: c ? Object.keys(c.buildings).length : 0,
        troops: c ? Object.values(c.troops.counts || {}).reduce((a, b) => a + b, 0) : 0
      };
    });

    sendJSON(res, { ok: true, players: list });
    return true;
  }

  if (resource === 'players' && method === 'GET' && username) {
    // Get single player details
    const user = DB.db.users[username];
    if (!user || !user.colony) {
      sendJSON(res, { ok: false, error: 'Player not found' }, 404);
      return true;
    }
    sendJSON(res, { ok: true, player: JSON.parse(JSON.stringify(user)) });
    return true;
  }

  if (resource === 'players' && method === 'POST' && username && action === 'resources') {
    return handleBody(req, res, (data) => {
      const user = DB.db.users[username];
      if (!user || !user.colony) return sendJSON(res, { ok: false, error: 'Player not found' }, 404);

      const colony = user.colony;
      if (data.set) {
        // Set absolute values
        Object.keys(data.set).forEach(k => {
          if (colony.resources[k]) {
            colony.resources[k].amount = Math.max(0, data.set[k]);
          }
        });
      }
      if (data.add) {
        // Add to current values
        Object.keys(data.add).forEach(k => {
          if (colony.resources[k]) {
            colony.resources[k].amount = Math.min(colony.resources[k].cap, colony.resources[k].amount + data.add[k]);
          }
        });
      }

      sendJSON(res, { ok: true, resources: {
        ore: Math.floor(colony.resources.ore?.amount || 0),
        solar: Math.floor(colony.resources.solar?.amount || 0),
        crystal: Math.floor(colony.resources.crystal?.amount || 0),
        isotopes: Math.floor(colony.resources.isotopes?.amount || 0)
      }});
    });
  }

  if (resource === 'players' && method === 'POST' && username && action === 'buildings') {
    return handleBody(req, res, (data) => {
      const user = DB.db.users[username];
      if (!user || !user.colony) return sendJSON(res, { ok: false, error: 'Player not found' }, 404);

      const colony = user.colony;
      if (data.set) {
        Object.keys(data.set).forEach(k => {
          if (colony.buildings[k]) {
            colony.buildings[k].level = Math.max(0, parseInt(data.set[k]) || 0);
          }
        });
      }

      sendJSON(res, { ok: true });
    });
  }

  if (resource === 'players' && method === 'POST' && username && action === 'troops') {
    return handleBody(req, res, (data) => {
      const user = DB.db.users[username];
      if (!user || !user.colony) return sendJSON(res, { ok: false, error: 'Player not found' }, 404);

      const colony = user.colony;
      if (data.set) {
        Object.keys(data.set).forEach(k => {
          if (colony.troops.counts[k] !== undefined) {
            colony.troops.counts[k] = Math.max(0, parseInt(data.set[k]) || 0);
          }
        });
      }

      sendJSON(res, { ok: true });
    });
  }

  if (resource === 'players' && method === 'POST' && username && action === 'add-troops') {
    return handleBody(req, res, (data) => {
      const user = DB.db.users[username];
      if (!user || !user.colony) return sendJSON(res, { ok: false, error: 'Player not found' }, 404);

      const colony = user.colony;
      if (data.add) {
        Object.keys(data.add).forEach(k => {
          if (colony.troops.counts[k] !== undefined) {
            colony.troops.counts[k] = (colony.troops.counts[k] || 0) + Math.max(0, parseInt(data.add[k]) || 0);
          }
        });
      }

      sendJSON(res, { ok: true });
    });
  }

  if (resource === 'save' && method === 'POST') {
    try {
      if (typeof DB.saveDB === 'function') DB.saveDB();
      sendJSON(res, { ok: true, message: 'Database saved' });
    } catch (e) {
      sendJSON(res, { ok: false, error: e.message }, 500);
    }
    return true;
  }

  sendJSON(res, { ok: false, error: 'Unknown endpoint' }, 404);
  return true;
}

function handleBody(req, res, callback) {
  const body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    try {
      const data = JSON.parse(Buffer.concat(body).toString());
      callback(data);
    } catch (e) {
      sendJSON(res, { ok: false, error: 'Bad request body' }, 400);
    }
  });
}

function sendJSON(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

module.exports = { init };
