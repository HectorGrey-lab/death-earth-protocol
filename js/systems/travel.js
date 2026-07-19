/**
 * travel.js — Travel System (Phase 3)
 * 
 * Distance-based travel time between planets, sectors, and galaxies.
 * Fleets move in real-time on the galaxy map.
 * 
 * CALIBRATION:
 *   Same sector (planet→planet):    30-60 seconds  (max ~42 units × 1.2)
 *   Same galaxy (sector→sector):      5-15 minutes  (max ~283 units × 2.2)
 *   Different galaxy:                 1-4 hours     (need warp gate)
 *   With warp gate (cross-galaxy):   10-20 minutes
 * 
 * CHANGELOG:
 *   2026-07-18: Created for Phase 3 — Travel & Expedition Overhaul
 *     - Distance calculation from universe coordinates
 *     - Travel time with scale-aware multipliers
 *     - Fleet movement queue with tick-based ETA
 *     - Arrival events (scouting, colonization)
 *     - Warp gate factor for cross-galaxy travel
 */

window.TravelSystem = (function () {
  'use strict';

  // ── Constants ──
  // Universe coordinate scale factors (planet positions are 0-100% within their parent)
  const SECTOR_SPAN = 200;    // A sector's area spans 200 universe units
  const PLANET_SPAN = 30;     // A planet's area spans 30 universe units
  // Speed multipliers (seconds per universe unit of distance)
  const SPEED_INTRA_SECTOR = 1.2;     // ~30-60 sec for same-sector planets
  const SPEED_INTRA_GALAXY = 2.2;     // ~5-15 min for same-galaxy sectors
  const SPEED_INTER_GALAXY = 12;      // ~1-4 hours for cross-galaxy
  const WARP_GATE_MULT = 0.08;        // Warp gate reduces time to 8%
  const WARP_GATE_MIN = 300;          // Minimum 5 min with warp gate
  const MAX_FLEETS = 20;              // Hard cap on active fleets

  // ── Coordinate conversion ──
  function getUniverseCoords(galaxyId, sectorId, planetId) {
    const gal = Universe.getGalaxy(galaxyId);
    if (!gal) return { x: 0, y: 0 };

    let sx = 50, sy = 50; // center of galaxy if no sector
    let px = 50, py = 50; // center of sector if no planet

    if (sectorId) {
      const sec = Universe.getSector(galaxyId, sectorId);
      if (sec) {
        sx = sec.x;
        sy = sec.y;
      }
    }

    if (planetId) {
      const p = Universe.getPlanet(galaxyId, sectorId, planetId);
      if (p) {
        px = p.x;
        py = p.y;
      }
    }

    // Convert percentage positions to universe coordinates
    return {
      x: gal.universeX + (sx / 100) * SECTOR_SPAN + (px / 100) * PLANET_SPAN - PLANET_SPAN / 2,
      y: gal.universeY + (sy / 100) * SECTOR_SPAN + (py / 100) * PLANET_SPAN - PLANET_SPAN / 2
    };
  }

  // ── Distance ──
  function getDistance(origin, dest) {
    const o = getUniverseCoords(origin.galaxyId, origin.sectorId, origin.planetId);
    const d = getUniverseCoords(dest.galaxyId, dest.sectorId, dest.planetId);
    const dx = d.x - o.x;
    const dy = d.y - o.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // ── Travel time ──
  function getTravelTime(origin, dest, hasWarpGate) {
    const dist = getDistance(origin, dest);

    // Same planet
    if (origin.planetId && origin.planetId === dest.planetId &&
        origin.sectorId === dest.sectorId &&
        origin.galaxyId === dest.galaxyId) {
      return 0;
    }

    let time;
    if (origin.galaxyId === dest.galaxyId) {
      if (origin.sectorId === dest.sectorId) {
        // Same sector
        time = dist * SPEED_INTRA_SECTOR;
      } else {
        // Same galaxy, different sector
        time = dist * SPEED_INTRA_GALAXY;
      }
    } else {
      // Different galaxy
      if (hasWarpGate) {
        time = Math.max(dist * SPEED_INTER_GALAXY * WARP_GATE_MULT, WARP_GATE_MIN);
      } else {
        time = dist * SPEED_INTER_GALAXY;
      }
    }

    return Math.max(1, Math.round(time));
  }

  // ── Format travel time for display ──
  function formatTravelTime(seconds) {
    if (seconds < 60) return seconds + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return hrs + 'h ' + mins + 'm';
  }

  // ── Fleet management ──
  function createFleet(state, type, name, origin, dest) {
    const fleets = state.universe.fleets || [];
    if (fleets.length >= MAX_FLEETS) {
      MailboxSystem.addLog(state, 'Fleet command at capacity (' + MAX_FLEETS + '). Wait for a fleet to arrive.', 'warning');
      return null;
    }

    const totalTime = getTravelTime(origin, dest, state.universe.hasWarpGate);

    const fleet = {
      id: 'fleet-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      type: type || 'scout',
      name: name || 'Fleet',
      originGalaxyId: origin.galaxyId,
      originSectorId: origin.sectorId,
      originPlanetId: origin.planetId,
      destGalaxyId: dest.galaxyId,
      destSectorId: dest.sectorId,
      destPlanetId: dest.planetId,
      startTime: Date.now(),
      totalTravelTime: totalTime,
      remainingTime: totalTime,
      status: 'traveling',
      fleetSize: 1
    };

    fleets.push(fleet);
    state.universe.fleets = fleets;

    MailboxSystem.addLog(state, '🚀 ' + fleet.name + ' dispatched. ETA ' + formatTravelTime(totalTime), 'system');
    return fleet;
  }

  // ── Tick: process active fleet movements ──
  function tick(state, dt) {
    const fleets = state.universe.fleets || [];
    if (fleets.length === 0) return;

    let changed = false;
    for (let i = fleets.length - 1; i >= 0; i--) {
      const f = fleets[i];
      if (f.status !== 'traveling') continue;

      f.remainingTime = Math.max(0, f.remainingTime - dt);

      if (f.remainingTime <= 0) {
        // Fleet arrived!
        f.status = 'arrived';
        f.remainingTime = 0;
        onFleetArrival(state, f);
        changed = true;
      }
    }

    // Clean up old arrived fleets (keep max 5 latest)
    const arrived = fleets.filter(f => f.status === 'arrived');
    if (arrived.length > 5) {
      const toRemove = arrived.length - 5;
      let removed = 0;
      for (let i = fleets.length - 1; i >= 0 && removed < toRemove; i--) {
        if (fleets[i].status === 'arrived') {
          fleets.splice(i, 1);
          removed++;
        }
      }
      changed = true;
    }
  }

  // ── Fleet arrival handler ──
  function onFleetArrival(state, fleet) {
    const planetName = getPlanetName(fleet.destGalaxyId, fleet.destSectorId, fleet.destPlanetId);

    switch (fleet.type) {
      case 'scout':
        if (fleet.destPlanetId) {
          Universe.getPlanet(fleet.destGalaxyId, fleet.destSectorId, fleet.destPlanetId);
          GalaxySystem.discoverPlanet(state, fleet.destPlanetId);
          MailboxSystem.addLog(state, '🔭 Scout arrived at ' + planetName + '. Intel updated.', 'intel');
        }
        break;

      case 'colony':
        MailboxSystem.addLog(state, '🏛 Colony fleet arrived at ' + planetName + '. Ready to establish.', 'success');
        break;

      case 'expedition':
        MailboxSystem.addLog(state, '📦 Expedition fleet reached ' + planetName + '.', 'system');
        break;

      default:
        MailboxSystem.addLog(state, 'Fleet arrived at ' + planetName + '.', 'system');
        break;
    }
  }

  // ── Helpers ──
  function getPlanetName(galaxyId, sectorId, planetId) {
    const p = Universe.getPlanet(galaxyId, sectorId, planetId);
    return p ? p.name : 'Unknown';
  }

  function getActiveFleets(state) {
    return (state.universe.fleets || []).filter(f => f.status === 'traveling');
  }

  function getInterpolatedPosition(fleet) {
    // Returns {x, y} of fleet's current interpolated position on the galaxy map
    if (fleet.status !== 'traveling' || fleet.totalTravelTime === 0) {
      return getUniverseCoords(fleet.originGalaxyId, fleet.originSectorId, fleet.originPlanetId);
    }

    const progress = 1 - (fleet.remainingTime / fleet.totalTravelTime);
    const o = getUniverseCoords(fleet.originGalaxyId, fleet.originSectorId, fleet.originPlanetId);
    const d = getUniverseCoords(fleet.destGalaxyId, fleet.destSectorId, fleet.destPlanetId);

    return {
      x: o.x + (d.x - o.x) * progress,
      y: o.y + (d.y - o.y) * progress
    };
  }

  // ── Initial state factory ──
  function createInitialTravelState() {
    return {
      fleets: [],
      hasWarpGate: false
    };
  }

  return {
    // Travel time
    getDistance,
    getTravelTime,
    formatTravelTime,
    getUniverseCoords,

    // Fleet management
    createFleet,
    getActiveFleets,
    getInterpolatedPosition,

    // Tick
    tick,

    // State
    createInitialTravelState,

    // Helpers
    getPlanetName,

    // Constants (for reference)
    SPEED_INTRA_SECTOR,
    SPEED_INTRA_GALAXY,
    SPEED_INTER_GALAXY
  };
})();
