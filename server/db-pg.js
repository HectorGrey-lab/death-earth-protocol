/**
 * db-pg.js — Server-side database
 * PostgreSQL driver with auto-fallback to JSON file for local dev.
 *
 * When DATABASE_URL is set (Railway Postgres), uses PostgreSQL.
 * Otherwise saves to server/data/db.json (local dev without DB).
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────
const DATABASE_URL = process.env.DATABASE_URL;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const JSON_PATH = path.join(DATA_DIR, 'db.json');

// ─── In-memory cache ───────────────────────────────────────
let db = null;
let pgPool = null;

// ─── PostgreSQL initialisation ─────────────────────────────
async function initPostgres() {
  const { Pool } = require('pg');
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000
  });

  // Test connection
  const client = await pgPool.connect();
  try {
    // Create tables if they don't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        username TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL DEFAULT '',
        token TEXT,
        token_expires BIGINT,
        colony JSONB NOT NULL DEFAULT '{}',
        created_at BIGINT DEFAULT (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS universe (
        id INTEGER PRIMARY KEY DEFAULT 1,
        state JSONB NOT NULL DEFAULT '{}'
      );
    `);
  } finally {
    client.release();
  }
}

// ─── PostgreSQL load / save ────────────────────────────────
async function loadFromPostgres() {
  const { rows: uniRows } = await pgPool.query('SELECT state FROM universe WHERE id = 1');
  const universe = uniRows.length
    ? uniRows[0].state
    : { galaxies: [], nextId: 1, claimedPlanets: {} };

  const { rows: userRows } = await pgPool.query(
    `SELECT username, password_hash, salt, token, token_expires, colony FROM users`
  );
  const users = {};
  for (const row of userRows) {
    users[row.username] = {
      username: row.username,
      password: row.password_hash,
      salt: row.salt,
      token: row.token,
      tokenExpires: row.token_expires,
      colony: row.colony
    };
  }

  return { users, universe };
}

async function saveToPostgres() {
  if (!db) return;

  // Save universe
  await pgPool.query(
    `INSERT INTO universe (id, state) VALUES (1, $1)
     ON CONFLICT (id) DO UPDATE SET state = $1`,
    [JSON.stringify(db.universe)]
  );

  // Save each user
  for (const [username, userData] of Object.entries(db.users)) {
    await pgPool.query(
      `INSERT INTO users (username, password_hash, salt, token, token_expires, colony)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (username) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         salt = EXCLUDED.salt,
         token = EXCLUDED.token,
         token_expires = EXCLUDED.token_expires,
         colony = EXCLUDED.colony`,
      [
        username,
        userData.password,
        userData.salt || '',
        userData.token || null,
        userData.tokenExpires || null,
        JSON.stringify(userData.colony || {})
      ]
    );
  }
}

// ─── JSON file backend (fallback for local dev) ────────────
function initJsonDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadFromJson() {
  try {
    if (fs.existsSync(JSON_PATH)) {
      return JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
    }
  } catch (e) { /* corrupted, reset */ }
  return { users: {}, universe: { galaxies: [], nextId: 1, claimedPlanets: {} } };
}

function saveToJson() {
  if (!db) return;
  initJsonDir();
  fs.writeFileSync(JSON_PATH, JSON.stringify(db, null, 2));
}

// ─── Public API ────────────────────────────────────────────

/**
 * Load all data from the backend (PostgreSQL or JSON) into the in-memory cache.
 * Must be called once at server startup before any requests are handled.
 */
async function loadDB() {
  if (DATABASE_URL) {
    await initPostgres();
    db = await loadFromPostgres();
    console.log('  [DB] Connected to PostgreSQL');
  } else {
    initJsonDir();
    db = loadFromJson();
    console.log('  [DB] Using JSON file (set DATABASE_URL for PostgreSQL)');
  }

  // Ensure universe structure exists
  if (!db.universe) db.universe = { galaxies: [], nextId: 1, claimedPlanets: {} };
  if (!db.universe.galaxies) db.universe.galaxies = [];
  if (!db.universe.nextId) db.universe.nextId = db.universe.galaxies.length + 1;
  if (!db.universe.claimedPlanets) db.universe.claimedPlanets = {};

  return db;
}

/**
 * Persist the in-memory cache to PostgreSQL or JSON file.
 * Safe to call after every mutation.
 */
async function saveDB() {
  if (!db) return;
  try {
    if (DATABASE_URL) {
      await saveToPostgres();
    } else {
      saveToJson();
    }
  } catch (e) {
    console.error('[DB] Save error:', e.message, e.stack);
  }
}

/**
 * Get the in-memory database cache.
 * All game logic reads/writes this object synchronously.
 */
function getDB() {
  return db;
}

module.exports = {
  loadDB,
  saveDB,
  get db() { return db; }
};
