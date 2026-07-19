/**
 * Dead Earth Protocol — Multiplayer Server
 * Zero external dependencies. Uses only Node.js built-in modules.
 * 
 * Features:
 *   - HTTP static file server
 *   - WebSocket (RFC 6455) for real-time communication
 *   - Player authentication (register/login via REST)
 *   - Presence tracking (who's online, where in the universe)
 *   - Global chat
 * 
 * Usage: node server/index.js [port]
 *   Default port: 3000
 *   Open http://localhost:3000 in browser
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Config ───────────────────────────────────────────────
const PORT = parseInt(process.argv[2] || '3000', 10);
const STATIC_DIR = path.resolve(__dirname, '..');
const DB_PATH = path.join(__dirname, 'db.json');

// MIME types for static serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ─── Simple JSON Database ────────────────────────────────
function loadDB() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(data);
    }
  } catch (e) { /* corrupted db, reset */ }
  return { users: {}, planets: {} };
}

function saveDB(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

const db = loadDB();

// ─── WebSocket RFC 6455 Implementation ───────────────────
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

function wsParseFrame(buffer) {
  if (buffer.length < 2) return null;
  const firstByte = buffer[0];
  const opcode = firstByte & 0x0F;
  const isMasked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7F;
  let offset = 2;
  if (payloadLen === 126) { payloadLen = buffer.readUInt16BE(offset); offset += 2; }
  else if (payloadLen === 127) { payloadLen = Number(buffer.readBigUInt64BE(offset)); offset += 8; }
  let maskKey = null;
  if (isMasked) { maskKey = buffer.slice(offset, offset + 4); offset += 4; }
  if (buffer.length < offset + payloadLen) return null;
  let payload = buffer.slice(offset, offset + payloadLen);
  if (maskKey) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= maskKey[i % 4];
  }
  return { opcode, payload: payload.toString('utf8'), closeCode: opcode === 8 && payload.length >= 2 ? payload.readUInt16BE(0) : null };
}

// ─── Connected Clients ──────────────────────────────────
const clients = new Map();

function broadcast(message, excludeSocket = null) {
  const frame = wsEncodeFrame(JSON.stringify(message));
  for (const [sock] of clients) {
    if (sock !== excludeSocket && sock.writable) sock.write(frame);
  }
}

function broadcastPresence() {
  const online = [];
  for (const [, info] of clients) {
    online.push({
      username: info.username,
      galaxyId: info.galaxyId || null,
      sectorId: info.sectorId || null,
      planetId: info.planetId || null,
    });
  }
  broadcast({ type: 'presence', players: online });
}

function removeClient(socket) {
  clients.delete(socket);
  broadcastPresence();
}

// ─── HTTP Server ─────────────────────────────────────────
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = parsedUrl.pathname;

  // ── REST API Routes ──
  if (pathname === '/api/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        if (!username || !password || username.length < 2 || password.length < 3) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid username or password (min 2/3 chars)' }));
          return;
        }
        if (db.users[username]) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Username already taken' }));
          return;
        }
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = crypto.createHash('sha256').update(password + salt).digest('hex');
        db.users[username] = { username, hash, salt, created: Date.now() };
        saveDB(db);
        const token = crypto.createHash('sha256').update(username + Date.now() + crypto.randomBytes(8).toString('hex')).digest('hex');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, token, username }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
      }
    });
    return;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { username, password } = JSON.parse(body);
        const user = db.users[username];
        if (!user) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid credentials' }));
          return;
        }
        const hash = crypto.createHash('sha256').update(password + user.salt).digest('hex');
        if (hash !== user.hash) {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Invalid credentials' }));
          return;
        }
        const token = crypto.createHash('sha256').update(user.username + Date.now() + crypto.randomBytes(8).toString('hex')).digest('hex');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, token, username }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Invalid request' }));
      }
    });
    return;
  }

  // ── Static files ──
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.join(STATIC_DIR, filePath);
  if (!filePath.startsWith(STATIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found: ' + pathname);
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

// ─── WebSocket Upgrade Handler ──────────────────────────
server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }

  const acceptKey = wsAcceptKey(key);
  socket.write([
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    'Sec-WebSocket-Accept: ' + acceptKey,
    '', '',
  ].join('\r\n'));

  let buffer = Buffer.alloc(0);
  let clientInfo = { username: null, galaxyId: null, sectorId: null, planetId: null };

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const frame = wsParseFrame(buffer);
      if (!frame) break;
      const headerLen = (buffer[1] & 0x80 ? 4 : 0) + 2 +
        ((buffer[1] & 0x7F) === 126 ? 2 : (buffer[1] & 0x7F) === 127 ? 8 : 0);
      const maskLen = (buffer[1] & 0x80) ? 4 : 0;
      const payloadLen = (buffer[1] & 0x7F) === 126
        ? buffer.readUInt16BE(2)
        : (buffer[1] & 0x7F) === 127
          ? Number(buffer.readBigUInt64BE(2))
          : (buffer[1] & 0x7F);
      const totalFrameLen = headerLen + maskLen + payloadLen;
      buffer = buffer.slice(Math.min(totalFrameLen, buffer.length));

      if (frame.opcode === 8) {
        try { socket.write(wsEncodeFrame('')); } catch(e) {}
        removeClient(socket);
        socket.end();
        return;
      }
      if (frame.opcode === 9) {
        try { socket.write(Buffer.from([0x8A, 0x00])); } catch(e) {}
        continue;
      }
      if (frame.opcode !== 1) continue;

      try {
        const msg = JSON.parse(frame.payload);
        switch (msg.type) {
          case 'auth':
            const user = db.users[msg.username];
            const expectedToken = crypto.createHash('sha256').update(msg.username + 'DEPAUTH' + (user?.hash || '').slice(0, 16)).digest('hex').slice(0, 32);
            if (!user || msg.token !== expectedToken) {
              socket.write(wsEncodeFrame(JSON.stringify({ type: 'auth_error', error: 'Invalid token' })));
              socket.end();
              return;
            }
            clientInfo.username = msg.username;
            clients.set(socket, clientInfo);
            socket.write(wsEncodeFrame(JSON.stringify({ type: 'auth_ok', username: msg.username })));
            broadcast({ type: 'system', message: msg.username + ' has joined the universe' });
            broadcastPresence();
            break;

          case 'position':
            clientInfo.galaxyId = msg.galaxyId || null;
            clientInfo.sectorId = msg.sectorId || null;
            clientInfo.planetId = msg.planetId || null;
            broadcastPresence();
            break;

          case 'chat':
            if (clientInfo.username) {
              broadcast({ type: 'chat', username: clientInfo.username, message: msg.message, timestamp: Date.now() });
            }
            break;

          case 'ping':
            socket.write(wsEncodeFrame(JSON.stringify({ type: 'pong' })));
            break;
        }
      } catch (e) {}
    }
  });

  socket.on('close', () => { removeClient(socket); });
  socket.on('error', () => { removeClient(socket); });
});

// ─── Start ──────────────────────────────────────────────
server.listen(PORT, () => {
  const addr = `http://localhost:${PORT}`;
  console.log('');
  console.log('  \x1b[36m\uD83D\uDE80 Dead Earth Protocol \u2014 Multiplayer Server\x1b[0m');
  console.log('  \x1b[90m' + '-'.repeat(48) + '\x1b[0m');
  console.log('  \x1b[33mServer:\x1b[0m   ' + addr);
  console.log('  \x1b[33mPlayers:\x1b[0m  ' + Object.keys(db.users).length + ' registered users');
  console.log('  \x1b[33mShare:\x1b[0m    Use ngrok or deploy to Railway/Render');
  console.log('');
  console.log('  Give this URL to friends so they can join!');
  console.log('');
});
