/**
 * universe.js — Procedural Universe Engine (Seed-Based)
 * 
 * Generates a deterministic universe: galaxies → sectors → planets.
 * Used by both single-player and (future) multiplayer.
 * 
 * Seed: 42 (keeps universe consistent across all players)
 * 
 * COORDINATE SYSTEM:
 *   Galaxy spacing: 1,000 units between galaxy centers
 *   Sector spacing: 100 units within a galaxy
 *   Planet spacing: ~10 units within a sector
 * 
 * CHANGELOG:
 *   2026-07-18: Created for Phase 2 — Universe System
 *     - 9 galaxies in 3x3 grid
 *     - 15 sectors per galaxy (reusing existing region names)
 *     - 30-50 planets per sector with type, position, bonuses
 *     - Deterministic seed for multiplayer consistency
 */

window.Universe = (function () {
  'use strict';

  const SEED = 42;
  let _rngState = SEED;

  // ── Simple seeded PRNG (mulberry32) ──
  function nextRandom() {
    let t = (_rngState += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function resetRNG(seed) {
    _rngState = seed !== undefined ? seed : SEED;
  }

  // ── Planet name generation ──
  const PLANET_PREFIXES = [
    'Prox', 'Noct', 'Vela', 'Cygn', 'Rig', 'Alde', 'Lyra', 'Orph',
    'Titan', 'Ereb', 'Nova', 'Stel', 'Astr', 'Cosm', 'Nebl', 'Gal',
    'Quan', 'Phas', 'Zeph', 'Oriz', 'Kryp', 'Xeno', 'Pyro', 'Hade'
  ];

  const PLANET_SUFFIXES = [
    'ia', 'on', 'ar', 'is', 'um', 'an', 'os', 'us',
    'or', 'ax', 'en', 'ix', 'a', 'is-3', 'os-5', 'ar-2',
    'ia Prime', 'Minor', 'Major', 'Secundus'
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

  // ── Galaxy generation ──
  const GALAXY_NAMES = [
    'Andromeda Prime', 'Centauri Reach', 'Sol Dominion',
    'Lyra Expanse', 'Orion Verge', 'Cygnus Rift',
    'Draco Marches', 'Phoenix Gate', 'Vela Corridor'
  ];

  const GALAXY_COLORS = [
    '#58d6ff', '#69f0ae', '#ffd166',
    '#bf7bff', '#ff6b6b', '#4fc3f7',
    '#ff8a65', '#aed581', '#f06292'
  ];

  // Sectors per galaxy (reusing existing region/sector naming scheme)
  const SECTOR_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'];
  const SECTOR_NAMES = [
    'Ash Meridian', 'Glass Barrens', 'Black Scar', 'Iron Reach', 'Cinder Vale',
    'Obsidian Deep', 'Rust Fields', 'Crystal Drift', 'Shadow Expanse', 'Bone Plains',
    'Violet Marches', 'Scorch Basin', 'Frost Rim', 'Thorn Wastes', 'Pulse Belt'
  ];

  // ── Generated universe data ──
  let _galaxies = [];

  function generateGalaxies(seed) {
    resetRNG(seed || SEED);
    _galaxies = [];
    const numGalaxies = 9;
    const gridSize = 3; // 3×3 grid
    const galaxySpacing = 1000;

    for (let g = 0; g < numGalaxies; g++) {
      const row = Math.floor(g / gridSize);
      const col = g % gridSize;

      const galaxy = {
        id: 'galaxy-' + g,
        name: GALAXY_NAMES[g],
        color: GALAXY_COLORS[g],
        index: g,
        universeX: (col - 1) * galaxySpacing,
        universeY: (row - 1) * galaxySpacing,
        sectors: []
      };

      // Generate 15 sectors per galaxy
      for (let s = 0; s < 15; s++) {
        const sector = {
          id: 'sector-' + g + '-' + s,
          galaxyId: galaxy.id,
          index: s,
          label: SECTOR_LETTERS[s] + '-' + String(s + 1).padStart(2, '0'),
          name: SECTOR_NAMES[s],
          // Position within the galaxy (percentage-based for map rendering)
          x: 5 + (s % 5) * 22 + nextRandom() * 8,
          y: 5 + Math.floor(s / 5) * 32 + nextRandom() * 10,
          planets: []
        };

        // Generate 30-50 planets per sector
        const numPlanets = 30 + Math.floor(nextRandom() * 21);
        for (let p = 0; p < numPlanets; p++) {
          const typeIdx = Math.floor(nextRandom() * PLANET_TYPES.length);
          const type = PLANET_TYPES[typeIdx];
          const prefix = PLANET_PREFIXES[Math.floor(nextRandom() * PLANET_PREFIXES.length)];
          const suffix = PLANET_SUFFIXES[Math.floor(nextRandom() * PLANET_SUFFIXES.length)];
          const name = prefix + ' ' + suffix;

          const planet = {
            id: 'planet-' + g + '-' + s + '-' + p,
            galaxyId: galaxy.id,
            sectorId: sector.id,
            index: p,
            name: name,
            type: type.id,
            typeName: type.name,
            color: type.color,
            // Position within sector (percentage, 0-100)
            x: 5 + nextRandom() * 90,
            y: 5 + nextRandom() * 90,
            // Resource bonuses
            oreBonus: (type.oreMult - 1) * 100,
            solarBonus: (type.solarMult - 1) * 100,
            crystalBonus: (type.crystalMult - 1) * 100,
            isotopeBonus: (type.isotopeMult - 1) * 100,
            // Gameplay flags
            isPlayerBase: false,
            isColonized: false,
            colonizedBy: null,
            baseLevel: 0
          };

          sector.planets.push(planet);
        }

        galaxy.sectors.push(sector);
      }

      _galaxies.push(galaxy);
    }

    return _galaxies;
  }

  // ── Accessors ──
  function getGalaxies() {
    return _galaxies;
  }

  function getGalaxy(galaxyId) {
    return _galaxies.find(g => g.id === galaxyId) || null;
  }

  function getSector(galaxyId, sectorId) {
    const gal = getGalaxy(galaxyId);
    if (!gal) return null;
    return gal.sectors.find(s => s.id === sectorId) || null;
  }

  function getPlanet(galaxyId, sectorId, planetId) {
    const sec = getSector(galaxyId, sectorId);
    if (!sec) return null;
    return sec.planets.find(p => p.id === planetId) || null;
  }

  function getPlanetByName(name) {
    for (const gal of _galaxies) {
      for (const sec of gal.sectors) {
        const planet = sec.planets.find(p => p.name === name);
        if (planet) return planet;
      }
    }
    return null;
  }

  function findPlanets(query) {
    const results = [];
    const q = query.toLowerCase();
    for (const gal of _galaxies) {
      for (const sec of gal.sectors) {
        for (const p of sec.planets) {
          if (p.name.toLowerCase().includes(q) || p.typeName.toLowerCase().includes(q)) {
            results.push(p);
          }
        }
      }
    }
    return results;
  }

  // ── Serialization ──
  function toJSON() {
    return _galaxies;
  }

  function fromJSON(data) {
    if (Array.isArray(data) && data.length > 0) {
      _galaxies = data;
    }
  }

  // ── Initialization ──
  function init(seed) {
    if (_galaxies.length === 0) {
      generateGalaxies(seed || SEED);
    }
    return _galaxies;
  }

  return {
    // Generation
    generateGalaxies,
    init,
    resetRNG,

    // Accessors
    getGalaxies,
    getGalaxy,
    getSector,
    getPlanet,
    getPlanetByName,
    findPlanets,

    // Serialization
    toJSON,
    fromJSON,

    // Constants (exported for reference)
    SEED,
    GALAXY_NAMES,
    GALAXY_COLORS,
    PLANET_TYPES,
    SECTOR_NAMES,
    SECTOR_LETTERS
  };
})();
