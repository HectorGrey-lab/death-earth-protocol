/**
 * universe.js — Server-side universe expansion
 * Grows galaxies/sectors/planets as players register.
 */

const GAME = require('./game-data.json');

const PLANETS_PER_SECTOR = GAME.universe.planetsPerSector;  // 20
const SECTORS_PER_GALAXY = GAME.universe.sectorsPerGalaxy;  // 10

// ─── Planet type pool ───────────────────────────────────
const PLANET_TYPES = [
  { id: 'terran', name: 'Terran', icon: '🌍', color: '#4ade80' },
  { id: 'desert', name: 'Desert', icon: '🏜️', color: '#fbbf24' },
  { id: 'ocean', name: 'Ocean', icon: '🌊', color: '#60a5fa' },
  { id: 'barren', name: 'Barren', icon: '🌑', color: '#9ca3af' },
  { id: 'gas-giant', name: 'Gas Giant', icon: '🪐', color: '#c084fc' },
  { id: 'volcanic', name: 'Volcanic', icon: '🌋', color: '#f87171' },
  { id: 'ice', name: 'Ice', icon: '❄️', color: '#67e8f9' },
  { id: 'forest', name: 'Forest', icon: '🌲', color: '#22c55e' }
];

// ─── Generate names ─────────────────────────────────────
const PREFIXES = ['Nova', 'Astra', 'Void', 'Crimson', 'Iron', 'Helix', 'Obsidian', 'Solar', 'Shadow', 'Aeon', 'Kestrel', 'Null', 'Proxy', 'Morrow', 'Sable', 'Crest', 'Dawn', 'Harbor', 'Vortex', 'Zenith'];
const SUFFIXES = ['Prime', 'Major', 'Minor', 'Station', 'Outpost', 'Hold', 'Gate', 'Reach', 'Deep', 'Ridge', 'Falls', 'Haven', 'Spire', 'March', 'Pulse'];

function randomName(rng) {
  return PREFIXES[rng() % PREFIXES.length] + ' ' + SUFFIXES[rng() % SUFFIXES.length];
}

function randomInt(max, rng) {
  return rng() % max;
}

// Simple seeded RNG (pass in counter to get deterministic results)
function makeRNG(seed) {
  let s = seed;
  return function() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s;
  };
}

// ─── Planet generation ───────────────────────────────────
function generatePlanet(galaxyId, sectorId, planetIndex, rng) {
  const pType = PLANET_TYPES[rng() % PLANET_TYPES.length];
  const names = ['Aeon', 'Nova', 'Crimson', 'Helix', 'Void'];
  const subs = ['Prime', 'Station', 'Outpost', 'Haven', 'Gate'];
  const name = names[rng() % names.length] + ' ' + subs[rng() % subs.length] + ' ' + (planetIndex + 1);
  return {
    id: 'p-' + galaxyId + '-' + sectorId + '-' + (planetIndex + 1),
    index: planetIndex + 1,
    name: name,
    typeId: pType.id,
    typeName: pType.name,
    icon: pType.icon,
    color: pType.color,
    occupied: false,
    owner: null,
    x: 5 + (rng() % 90),
    y: 5 + (rng() % 90)
  };
}

// ─── Sector generation ───────────────────────────────────
function generateSector(galaxyId, sectorIndex, rng) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const name = galaxyId + '-' + letters[sectorIndex % 26];
  const planets = [];
  for (let i = 0; i < PLANETS_PER_SECTOR; i++) {
    planets.push(generatePlanet(galaxyId, name, i, rng));
  }
  return {
    id: name,
    name: name,
    planets,
    full: false
  };
}

// ─── Galaxy generation ───────────────────────────────────
function generateGalaxy(galaxyIndex, rng) {
  const name = 'Galaxy ' + galaxyIndex;
  return {
    id: 'galaxy-' + galaxyIndex,
    name: name,
    index: galaxyIndex,
    sectors: [],
    full: false
  };
}

// ─── Find next available planet ──────────────────────────
function findNextAvailable(universe) {
  // Look through existing galaxies for an unoccupied planet
  for (let gi = 0; gi < universe.galaxies.length; gi++) {
    const gal = universe.galaxies[gi];
    for (let si = 0; si < gal.sectors.length; si++) {
      const sec = gal.sectors[si];
      for (let pi = 0; pi < sec.planets.length; pi++) {
        const planet = sec.planets[pi];
        if (!planet.occupied) {
          return {
            galaxy: gal,
            galaxyId: gal.id,
            sector: sec,
            sectorId: sec.id,
            planet: planet,
            planetId: planet.id
          };
        }
      }
    }
  }
  return null;
}

// ─── Expand universe (add sectors / galaxies) ────────────
function ensurePlanetAvailable(universe) {
  const existing = findNextAvailable(universe);
  if (existing) return existing;

  // Need to expand — add a sector or galaxy
  const rng = makeRNG(universe.nextId || 1);
  universe.nextId = (universe.nextId || 1) + 1;

  if (!universe.galaxies.length) {
    // First galaxy + first sector
    const gal = generateGalaxy(1, rng);
    const sec = generateSector(gal.id, 0, rng);
    gal.sectors.push(sec);
    universe.galaxies.push(gal);
  } else {
    const lastGal = universe.galaxies[universe.galaxies.length - 1];
    if (lastGal.sectors.length < SECTORS_PER_GALAXY) {
      // Add sector to existing galaxy
      const sec = generateSector(lastGal.id, lastGal.sectors.length, rng);
      lastGal.sectors.push(sec);
    } else {
      // Galaxy full, create new one
      lastGal.full = true;
      const newGal = generateGalaxy(universe.galaxies.length + 1, rng);
      const sec = generateSector(newGal.id, 0, rng);
      newGal.sectors.push(sec);
      universe.galaxies.push(newGal);
    }
  }

  return findNextAvailable(universe);
}

// ─── Claim planet ────────────────────────────────────────
function claimPlanet(universe, planetInfo, username) {
  planetInfo.planet.occupied = true;
  planetInfo.planet.owner = username;
  planetInfo.sector.full = planetInfo.sector.planets.every(p => p.occupied);
  planetInfo.galaxy.full = planetInfo.galaxy.sectors.every(s => s.full);
  return {
    galaxyId: planetInfo.galaxyId,
    sectorId: planetInfo.sectorId,
    planetId: planetInfo.planetId
  };
}

// ─── Get player count from universe ──────────────────────
function getClaimedCount(universe) {
  let count = 0;
  for (const gal of universe.galaxies) {
    for (const sec of gal.sectors) {
      for (const p of sec.planets) {
        if (p.occupied) count++;
      }
    }
  }
  return count;
}

// ─── Exports ────────────────────────────────────────────
module.exports = {
  ensurePlanetAvailable,
  claimPlanet,
  getClaimedCount,
  generateGalaxy,
  generateSector
};
