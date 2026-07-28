window.FleetSystem = (function () {
  // ── Persistence ──
  function _save(state) {
    try { localStorage.setItem('de_fleets', JSON.stringify(state.fleets || {})); } catch(e) {}
  }

  function loadFleets(state) {
    var raw;
    try { raw = localStorage.getItem('de_fleets'); } catch(e) {}
    if (!raw) return;
    var saved;
    try { saved = JSON.parse(raw); } catch(e) { return; }
    if (typeof saved !== 'object') return;
    state.fleets = saved;
    reconcile(state);
  }

  /** After server overwrites troop counts, subtract fleet troops from reserve so they aren't double-counted */
  function reconcile(state) {
    var fleets = state.fleets || {};
    Object.keys(fleets).forEach(function (fid) {
      var ft = fleets[fid].troops || {};
      Object.keys(ft).forEach(function (key) {
        var inFleet = ft[key] || 0;
        if (state.troops && state.troops.counts) {
          state.troops.counts[key] = Math.max(0, (state.troops.counts[key] || 0) - inFleet);
        }
      });
    });
  }

  function getFleetPower(state, fleet) {
    var mod = 1 + (state.research.levels.military || 0) * 0.08;
    var total = 0;
    var troops = fleet.troops || {};
    Object.keys(troops).forEach(function (key) {
      var count = troops[key] || 0;
      var def = GameData.troops[key];
      if (def) total += count * def.power * mod;
    });
    return Math.floor(total);
  }

  function getFleetDefense(state, fleet) {
    var mod = 1 + (state.research.levels.defense || 0) * 0.06;
    var total = 0;
    var troops = fleet.troops || {};
    Object.keys(troops).forEach(function (key) {
      var count = troops[key] || 0;
      var def = GameData.troops[key];
      if (def) total += count * def.defense * mod;
    });
    return Math.floor(total);
  }

  function getFleetCarry(fleet) {
    var total = 0;
    var troops = fleet.troops || {};
    Object.keys(troops).forEach(function (key) {
      var count = troops[key] || 0;
      var def = GameData.troops[key];
      if (def) total += count * (def.carryCapacity || 10);
    });
    return total;
  }

  function getFleetSize(fleet) {
    var troops = fleet.troops || {};
    return Object.values(troops).reduce(function (a, b) { return a + b; }, 0);
  }

  function getFleetIds(state) {
    return Object.keys(state.fleets || {});
  }

  function getFleet(state, fleetId) {
    return (state.fleets || {})[fleetId] || null;
  }

  function createFleet(state, name) {
    if (!state.fleets) state.fleets = {};
    var id = 'fleet_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    state.fleets[id] = {
      id: id,
      name: name || 'Unnamed Fleet',
      troops: {},
      createdAt: Date.now()
    };
    _save(state);
    return id;
  }

  function deleteFleet(state, fleetId) {
    var fleet = state.fleets[fleetId];
    if (!fleet) return false;
    var troops = fleet.troops || {};
    Object.keys(troops).forEach(function (key) {
      var count = troops[key] || 0;
      if (!state.troops.counts[key]) state.troops.counts[key] = 0;
      state.troops.counts[key] += count;
    });
    delete state.fleets[fleetId];
    _save(state);
    return true;
  }

  function addToFleet(state, fleetId, troopKey, quantity) {
    quantity = Math.max(0, parseInt(quantity, 10) || 0);
    if (quantity <= 0) return { ok: false, reason: 'Quantity must be positive' };
    var fleet = state.fleets[fleetId];
    if (!fleet) return { ok: false, reason: 'Fleet not found' };
    var available = state.troops.counts[troopKey] || 0;
    if (available < quantity) return { ok: false, reason: 'Not enough troops available. You have ' + available };
    state.troops.counts[troopKey] = Math.max(0, (state.troops.counts[troopKey] || 0) - quantity);
    if (!fleet.troops[troopKey]) fleet.troops[troopKey] = 0;
    fleet.troops[troopKey] += quantity;
    _save(state);
    return { ok: true };
  }

  function removeFromFleet(state, fleetId, troopKey, quantity) {
    quantity = Math.max(0, parseInt(quantity, 10) || 0);
    if (quantity <= 0) return { ok: false, reason: 'Quantity must be positive' };
    var fleet = state.fleets[fleetId];
    if (!fleet) return { ok: false, reason: 'Fleet not found' };
    var inFleet = fleet.troops[troopKey] || 0;
    if (inFleet < quantity) return { ok: false, reason: 'Not enough troops in fleet. Only ' + inFleet };
    fleet.troops[troopKey] = Math.max(0, (fleet.troops[troopKey] || 0) - quantity);
    if (fleet.troops[troopKey] <= 0) delete fleet.troops[troopKey];
    if (!state.troops.counts[troopKey]) state.troops.counts[troopKey] = 0;
    state.troops.counts[troopKey] += quantity;
    _save(state);
    return { ok: true };
  }

  function renameFleet(state, fleetId, newName) {
    var fleet = state.fleets[fleetId];
    if (!fleet) return false;
    fleet.name = newName || 'Unnamed Fleet';
    _save(state);
    return true;
  }

  return {
    getFleetPower, getFleetDefense, getFleetCarry, getFleetSize,
    getFleetIds, getFleet,
    createFleet, deleteFleet, addToFleet, removeFromFleet, renameFleet,
    loadFleets, reconcile
  };
})();
