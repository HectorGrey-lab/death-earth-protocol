/**
 * universe.js — Server-side universe generation
 * Grows dynamically as players join.
 *
 * DESIGN (your vision):
 *  - 10 sectors per galaxy, 10 planets per sector = 100 planets per galaxy
 *  - First player creates Galaxy 1 with Sector A and 10 planets
 *  - Each new player claims the next free planet
 *  - When a sector fills (10 planets), add the next sector
 *  - When a galaxy fills (10 sectors), create the next galaxy
 *  - Universe grows naturally with player count
 *
 * CLIENT-COMPATIBLE FORMAT (matches js/universe.js):
 *  Galaxy:  { id, name, color, index, sectors: [...] }
 *  Sector:  { id, galaxyId, index, label, name, x, y, planets: [...] }
 *  Planet:  { id, galaxyId, sectorId, index, name, type, typeName, color,
 *             x, y, oreBonus, solarBonus, crystalBonus, isotopeBonus,
 *             isPlayerBase, isColonized, colonizedBy, baseLevel }
 */

const GAME = require('./game-data.json');
const PLANETS_PER_SECTOR = GAME.universe.planetsPerSector;  // 10
const SECTORS_PER_GALAXY = GAME.universe.sectorsPerGalaxy;  // 10

// ─── Galaxy definitions ─────────────────────────────────────────
const GALAXY_NAMES = [
  'Andromeda Prime', 'Centauri Reach', 'Sol Dominion',
  'Lyra Expanse', 'Orion Verge', 'Cygnus Rift',
  'Draco Marches', 'Phoenix Gate', 'Vela Corridor',
  'Sirius Belt', 'Rigel Frontier', 'Vega Halo',
  'Altair Ring', 'Proxima Vale', 'Nebula Drift'
];

const GALAXY_COLORS = [
  '#58d6ff', '#69f0ae', '#ffd166',
  '#bf7bff', '#ff6b6b', '#4fc3f7',
  '#ff8a65', '#aed581', '#f06292',
  '#00bcd4', '#ff9800', '#e040fb',
  '#76ff03', '#ff4081', '#18ffff'
];

const SECTOR_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
const SECTOR_NAMES = [
  'Ash Meridian', 'Glass Barrens', 'Black Scar', 'Iron Reach', 'Cinder Vale',
  'Obsidian Deep', 'Rust Fields', 'Crystal Drift', 'Shadow Expanse', 'Bone Plains'
];

const PLANET_TYPES = [
  { id: 'barren', name: 'Barren', color: '#b8a99a', oreMult: 1.2, solarMult: 0.6, crystalMult: 0.4, isotopeMult: 0.3 },
  { id: 'terran', name: 'Terran', color: '#69f0ae', oreMult: 1.0, solarMult: 1.2, crystalMult: 0.8, isotopeMult: 0.6 },
  { id: 'ocean', name: 'Ocean', color: '#4fc3f7', oreMult: 0.6, solarMult: 0.8, crystalMult: 1.0, isotopeMult: 1.2 },
  { id: 'volcanic', name: 'Volcanic', color: '#ff6b6b', oreMult: 1.4, solarMult: 0.5, crystalMult: 0.6, isotopeMult: 1.5 },
  { id: 'gas', name: 'Gas Giant', color: '#ffd166', oreMult: 0.4, solarMult: 1.4, crystalMult: 0.5, isotopeMult: 0.8 },
  { id: 'forest', name: 'Forest', color: '#66bb6a', oreMult: 0.8, solarMult: 1.0, crystalMult: 1.2, isotopeMult: 0.5 },
  { id: 'tundra', name: 'Tundra', color: '#90a4ae', oreMult: 0.9, solarMult: 0.7, crystalMult: 1.1, isotopeMult: 0.7 },
  { id: 'desert', name: 'Desert', color: '#ffe082', oreMult: 1.1, solarMult: 1.3, crystalMult: 0.3, isotopeMult: 0.4 }
];

const PREFIXES = ['Prox', 'Noct', 'Vela', 'Cygn', 'Rig', 'Alde', 'Lyra', 'Orph', 'Titan', 'Ereb', 'Nova', 'Stel', 'Astr', 'Cosm', 'Nebl', 'Gal', 'Quan', 'Phas', 'Zeph', 'Oriz', 'Kryp', 'Xeno', 'Pyro', 'Hade'];
const SUFFIXES = ['ia', 'on', 'ar', 'is', 'um', 'an', 'os', 'us', 'or', 'ax', 'en', 'ix', 'a', 'is-3', 'os-5', 'ar-2', 'ia Prime', 'Minor', 'Major', 'Secundus'];

// ─── Seeded PRNG (mulberry32) ───────────────────────────────────
function makeRNG(seed) {
  let s = seed;
  return function() {
    const t = (s += 0x6D2B79F5) >>> 0;
    let r = t ^ (t >>> 15);
    r = Math.imul(r, r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(max, rng) {
  return Math.floor(rng() * max);
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

// ─── Planet generation ──────────────────────────────────────────
function generatePlanet(galaxyIndex, sectorIndex, planetIndex, rng) {
  const typeIdx = randomInt(PLANET_TYPES.length, rng);
  const type = PLANET_TYPES[typeIdx];
  const name = pick(PREFIXES, rng) + ' ' + pick(SUFFIXES, rng);

  return {
    id: 'planet-' + galaxyIndex + '-' + sectorIndex + '-' + planetIndex,
    galaxyId: 'galaxy-' + galaxyIndex,
    sectorId: 'sector-' + galaxyIndex + '-' + sectorIndex,
    index: planetIndex,
    name: name,
    type: type.id,
    typeName: type.name,
    color: type.color,
    x: 5 + rng() * 90,
    y: 5 + rng() * 90,
    oreBonus: Math.round((type.oreMult - 1) * 100),
    solarBonus: Math.round((type.solarMult - 1) * 100),
    crystalBonus: Math.round((type.crystalMult - 1) * 100),
    isotopeBonus: Math.round((type.isotopeMult - 1) * 100),
    isPlayerBase: false,
    isColonized: false,
    colonizedBy: null,
    baseLevel: 0
  };
}

// ─── Sector generation ──────────────────────────────────────────
function generateSector(galaxyIndex, sectorIndex, rng) {
  const planets = [];
  for (let i = 0; i < PLANETS_PER_SECTOR; i++) {
    planets.push(generatePlanet(galaxyIndex, sectorIndex, i, rng));
  }

  return {
    id: 'sector-' + galaxyIndex + '-' + sectorIndex,
    galaxyId: 'galaxy-' + galaxyIndex,
    index: sectorIndex,
    label: SECTOR_LETTERS[sectorIndex] + '-' + String(sectorIndex + 1).padStart(2, '0'),
    name: SECTOR_NAMES[sectorIndex],
    x: 5 + (sectorIndex % 5) * 22 + rng() * 8,
    y: 5 + Math.floor(sectorIndex / 5) * 32 + rng() * 10,
    full: false,
    planets: planets
  };
}

// ─── Galaxy generation ──────────────────────────────────────────
function generateGalaxy(index, rng) {
  return {
    id: 'galaxy-' + index,
    name: GALAXY_NAMES[index],
    color: GALAXY_COLORS[index],
    index: index,
    full: false,
    sectors: []
  };
}

// ─── Find next available planet ─────────────────────────────────
function findNextAvailable(universe) {
  if (!universe.galaxies) return null;
  for (let gi = 0; gi < universe.galaxies.length; gi++) {
    const gal = universe.galaxies[gi];
    if (gal.full) continue;
    for (let si = 0; si < gal.sectors.length; si++) {
      const sec = gal.sectors[si];
      if (sec.full) continue;
      for (let pi = 0; pi < sec.planets.length; pi++) {
        const planet = sec.planets[pi];
        if (!planet.isColonized && !planet.isPlayerBase) {
          return { galaxy: gal, galaxyId: gal.id, sector: sec, sectorId: sec.id, planet: planet, planetId: planet.id };
        }
      }
    }
  }
  return null;
}

// ─── Expand universe (add sectors / galaxies) ────────────────────
function ensurePlanetAvailable(universe) {
  // Check for existing free planets
  const existing = findNextAvailable(universe);
  if (existing) return existing;

  // Need to expand
  const rng = makeRNG(Date.now());

  if (!universe.galaxies || universe.galaxies.length === 0) {
    // First galaxy + first sector
    const gal = generateGalaxy(0, rng);
    const sec = generateSector(0, 0, rng);
    gal.sectors.push(sec);
    universe.galaxies.push(gal);
  } else {
    const lastGal = universe.galaxies[universe.galaxies.length - 1];
    if (!lastGal.full && lastGal.sectors.length < SECTORS_PER_GALAXY) {
      // Add sector to existing galaxy
      const sec = generateSector(lastGal.index, lastGal.sectors.length, rng);
      lastGal.sectors.push(sec);
    } else {
      // Galaxy full, create new one
      lastGal.full = true;
      const newIndex = universe.galaxies.length;
      const newGal = generateGalaxy(newIndex, rng);
      const sec = generateSector(newIndex, 0, rng);
      newGal.sectors.push(sec);
      universe.galaxies.push(newGal);
    }
  }

  return findNextAvailable(universe);
}

// ─── Transition: fill previously empty sectors (mark full) ──────
function updateSectorFullFlags(universe) {
  if (!universe.galaxies) return;
  for (const gal of universe.galaxies) {
    let allSectorsFull = true;
    for (const sec of gal.sectors) {
      const colonizedCount = sec.planets.filter(p => p.isColonized).length;
      sec.full = colonizedCount >= sec.planets.length;
      if (!sec.full) allSectorsFull = false;
    }
    gal.full = allSectorsFull && gal.sectors.length >= SECTORS_PER_GALAXY;
  }
}

// ─── Claim a planet for a player ────────────────────────────────
function claimPlanet(universe, planetInfo, username) {
  planetInfo.planet.isPlayerBase = true;
  planetInfo.planet.isColonized = true;
  planetInfo.planet.colonizedBy = username;
  planetInfo.planet.baseLevel = 1;

  // Check if this sector is now full
  updateSectorFullFlags(universe);

  return {
    galaxyId: planetInfo.galaxyId,
    sectorId: planetInfo.sectorId,
    planetId: planetInfo.planetId,
    planetName: planetInfo.planet.name
  };
}

// ─── Get claimed planet count ───────────────────────────────────
function getClaimedCount(universe) {
  if (!universe.galaxies) return 0;
  let count = 0;
  for (const gal of universe.galaxies) {
    for (const sec of gal.sectors) {
      count += sec.planets.filter(p => p.isColonized).length;
    }
  }
  return count;
}

// ─── Get player's claimed planet ────────────────────────────────
function getPlayerPlanet(universe, username) {
  if (!universe.galaxies) return null;
  for (const gal of universe.galaxies) {
    for (const sec of gal.sectors) {
      for (const p of sec.planets) {
        if (p.colonizedBy === username) {
          return { galaxyId: gal.id, sectorId: sec.id, planetId: p.id, planetName: p.name };
        }
      }
    }
  }
  return null;
}

module.exports = {
  ensurePlanetAvailable,
  claimPlanet,
  getClaimedCount,
  getPlayerPlanet
};
