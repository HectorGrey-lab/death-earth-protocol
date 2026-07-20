/**
 * db.js — Server-side database
 * Manages universe state and player colonies.
 */

const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, 'data', 'db.json');

// ─── Load / Save ────────────────────────────────────────

let db = null;

function loadDB() {
  if (db) return db;
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    db = JSON.parse(raw);
  } catch (e) {
    db = { users: {}, universe: { galaxies: [], nextId: 1, claimedPlanets: {} } };
    saveDB();
  }
  return db;
}

function saveDB() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

// ─── Player Colony State ────────────────────────────────

function createInitialColony(username, planetName, galaxyId, sectorId, planetId) {
  const buildings = {};
  const bDefs = require('./game-data.json').buildings;
  Object.keys(bDefs).forEach(key => {
    buildings[key] = { level: 0, upgrading: null, integrity: 100 };
  });

  return {
    username,
    planetName: planetName || username + "'s Planet",
    homeGalaxy: galaxyId,
    homeSector: sectorId,
    homePlanet: planetId,
    resources: {
      ore: { amount: 0, cap: 1200 },
      solar: { amount: 0, cap: 1100 },
      crystal: { amount: 0, cap: 900 },
      isotopes: { amount: 0, cap: 700 }
    },
    buildings,
    troops: {
      counts: {},
      queue: []
    },
    research: {
      levels: {},
      queue: null
    },
    lastTick: Date.now(),
    shield: { current: 120, max: 120 }
  };
}

// ─── Exports ────────────────────────────────────────────

module.exports = {
  loadDB,
  saveDB,
  createInitialColony,
  get db() { return db; }
};
