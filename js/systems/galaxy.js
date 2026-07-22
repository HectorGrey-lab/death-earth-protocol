/**
 * galaxy.js — Galaxy System
 * 
 * Manages the player's position in the universe and galaxy-map game logic.
 * Works alongside MapSystem (tactical sector map) — NOT replacing it.
 * 
 * CHANGELOG:
 *   2026-07-18: Created for Phase 2 — Universe System
 *     - Player universe position tracking
 *     - Galaxy map zoom level management
 *     - Planet discovery / colonize state
 *     - Save/load integration with GameState
 *   2026-07-18: Phase 3 — Added fleet management functions
 *     - sendScout, getHomePlanet, getActiveFleets, hasActiveFleetTo
 *   2026-07-18: Fixed — fleet functions were nested inside getPlayerPosition (scope bug)
 *     - Moved all fleet functions to IIFE top level
 *     - All functions now accessible from the return statement
 */

window.GalaxySystem = (function () {
  'use strict';

  // ── Zoom levels ──
  const ZOOM_UNIVERSE = 'universe';
  const ZOOM_GALAXY = 'galaxy';
  const ZOOM_SECTOR = 'sector';

  // ── Player position helpers ──
  function getPlayerPosition(state) {
    return {
      galaxyId: state.universe.activeGalaxyId,
      sectorId: state.universe.activeSectorId,
      planetId: state.universe.activePlanetId,
      zoomLevel: state.universe.zoomLevel
    };
  }

  function setActiveGalaxy(state, galaxyId) {
    state.universe.activeGalaxyId = galaxyId;
    state.universe.zoomLevel = ZOOM_GALAXY;
    state.universe.activeSectorId = null;
    state.universe.activePlanetId = null;
  }

  function setActiveSector(state, galaxyId, sectorId) {
    state.universe.activeGalaxyId = galaxyId;
    state.universe.activeSectorId = sectorId;
    state.universe.zoomLevel = ZOOM_SECTOR;
    state.universe.activePlanetId = null;
  }

  function setActivePlanet(state, galaxyId, sectorId, planetId) {
    state.universe.activeGalaxyId = galaxyId;
    state.universe.activeSectorId = sectorId;
    state.universe.activePlanetId = planetId;
  }

  function zoomOut(state) {
    if (state.universe.zoomLevel === ZOOM_SECTOR) {
      state.universe.zoomLevel = ZOOM_GALAXY;
      state.universe.activePlanetId = null;
    } else if (state.universe.zoomLevel === ZOOM_GALAXY) {
      state.universe.zoomLevel = ZOOM_UNIVERSE;
      state.universe.activeGalaxyId = null;
      state.universe.activeSectorId = null;
    }
  }

  function zoomIn(state) {
    if (state.universe.zoomLevel === ZOOM_UNIVERSE && state.universe.activeGalaxyId) {
      state.universe.zoomLevel = ZOOM_GALAXY;
    } else if (state.universe.zoomLevel === ZOOM_GALAXY && state.universe.activeSectorId) {
      state.universe.zoomLevel = ZOOM_SECTOR;
    }
  }

  // ── Planet interaction ──
  function isDiscovered(state, planetId) {
    return !!state.universe.discoveredPlanets[planetId];
  }

  function discoverPlanet(state, planetId) {
    state.universe.discoveredPlanets[planetId] = true;
    const p = Universe.findPlanets(planetId).length > 0 ? Universe.findPlanets(planetId)[0] : null;
    MailboxSystem.addLog(state, '🔭 New celestial body charted: ' + (p ? p.name : planetId), 'intel');
  }

  function colonizePlanet(state, galaxyId, sectorId, planetId) {
    const planet = Universe.getPlanet(galaxyId, sectorId, planetId);
    if (!planet) return { ok: false, reason: 'Planet not found' };
    if (planet.isColonized) return { ok: false, reason: 'Already colonized' };

    planet.isColonized = true;
    planet.colonizedBy = 'player';
    planet.baseLevel = 1;
    planet.isPlayerBase = true;
    discoverPlanet(state, planetId);

    MailboxSystem.addLog(state, '🏛 Colony established on ' + planet.name, 'success');
    return { ok: true };
  }

  // ── Mark the player's home planet after server data loads ──
  function markHomePlanet(galaxyId, sectorId, planetId) {
    // First, clear isPlayerBase from ALL planets in the universe
    // (the server sends isPlayerBase=true for all colonized planets)
    var gals = Universe.getGalaxies();
    for (var gi = 0; gi < gals.length; gi++) {
      for (var si = 0; si < gals[gi].sectors.length; si++) {
        var planets = gals[gi].sectors[si].planets;
        for (var pi = 0; pi < planets.length; pi++) {
          planets[pi].isPlayerBase = false;
        }
      }
    }
    // Now set isPlayerBase on the actual home planet only
    const planet = Universe.getPlanet(galaxyId, sectorId, planetId);
    if (planet) {
      planet.isPlayerBase = true;
      planet.isColonized = true;
      planet.colonizedBy = 'player';
    }
    return planet;
  }

  function ensureTypeName(planet) {
    if (!planet.typeName) {
      var typeNames = {
        terran: 'Terran',
        desert: 'Desert',
        ice: 'Ice',
        gas: 'Gas Giant',
        lava: 'Lava',
        ocean: 'Oceanic',
        barren: 'Barren'
      };
      planet.typeName = typeNames[planet.type] || planet.type || 'Unknown';
    }
  }

  // ── Current galaxy/sector/planet info ──
  function getCurrentGalaxy(state) {
    if (!state.universe.activeGalaxyId) return null;
    return Universe.getGalaxy(state.universe.activeGalaxyId);
  }

  function getCurrentSector(state) {
    if (!state.universe.activeGalaxyId || !state.universe.activeSectorId) return null;
    return Universe.getSector(state.universe.activeGalaxyId, state.universe.activeSectorId);
  }

  function getCurrentPlanet(state) {
    if (!state.universe.activeGalaxyId || !state.universe.activeSectorId || !state.universe.activePlanetId) return null;
    return Universe.getPlanet(state.universe.activeGalaxyId, state.universe.activeSectorId, state.universe.activePlanetId);
  }

  // ── Fleet management (Phase 3) ──
  function sendScout(state, galaxyId, sectorId, planetId) {
    const homePlanet = getHomePlanet(state);
    if (!homePlanet) return { ok: false, reason: 'No home base found' };

    const dest = Universe.getPlanet(galaxyId, sectorId, planetId);
    if (!dest) return { ok: false, reason: 'Destination planet not found' };

    const origin = {
      galaxyId: homePlanet.galaxyId,
      sectorId: homePlanet.sectorId,
      planetId: homePlanet.id
    };

    const destRef = {
      galaxyId: galaxyId,
      sectorId: sectorId,
      planetId: planetId
    };

    const fleet = TravelSystem.createFleet(state, 'scout', 'Scout Fleet', origin, destRef);
    if (fleet) {
      MailboxSystem.addLog(state, '🔭 Scout dispatched to ' + dest.name + '. ETA ' + TravelSystem.formatTravelTime(fleet.totalTravelTime), 'intel');
      return { ok: true, fleet: fleet };
    }
    return { ok: false, reason: 'Failed to dispatch fleet' };
  }

  function getHomePlanet(state) {
    const galaxies = Universe.getGalaxies();
    for (const gal of galaxies) {
      for (const sec of gal.sectors) {
        for (const p of sec.planets) {
          if (p.isPlayerBase) return p;
        }
      }
    }
    return null;
  }

  function getActiveFleets(state) {
    return TravelSystem.getActiveFleets(state);
  }

  function hasActiveFleetTo(state, planetId) {
    return (state.universe.fleets || []).some(f =>
      f.status === 'traveling' && f.destPlanetId === planetId
    );
  }

  // ── Initial state factory ──
  function createInitialUniverseState() {
    return {
      seed: Universe.SEED,
      zoomLevel: ZOOM_UNIVERSE,
      activeGalaxyId: null,
      activeSectorId: null,
      activePlanetId: null,
      discoveredPlanets: {}
    };
  }

  return {
    ZOOM_UNIVERSE,
    ZOOM_GALAXY,
    ZOOM_SECTOR,

    // Position
    getPlayerPosition,
    setActiveGalaxy,
    setActiveSector,
    setActivePlanet,
    zoomOut,
    zoomIn,

    // Planets
    isDiscovered,
    discoverPlanet,
    colonizePlanet,

    // Current context
    getCurrentGalaxy,
    getCurrentSector,
    getCurrentPlanet,

    // Fleet
    sendScout,
    getHomePlanet,
    getActiveFleets,
    hasActiveFleetTo,

    // Home planet
    markHomePlanet,
    ensureTypeName,

    // State
    createInitialUniverseState
  };
})();
