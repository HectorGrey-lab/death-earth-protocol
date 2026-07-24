window.FleetSystem = (function () {
  // Compute total attack power of a fleet
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

  // Compute total defense (HP) of a fleet
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

  // Compute total carry capacity of a fleet
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

  // Get total units in a fleet
  function getFleetSize(fleet) {
    var troops = fleet.troops || {};
    return Object.values(troops).reduce(function (a, b) { return a + b; }, 0);
  }

  // Get all fleet ids
  function getFleetIds(state) {
    return Object.keys(state.fleets || {});
  }

  // Get fleet by id
  function getFleet(state, fleetId) {
    return (state.fleets || {})[fleetId] || null;
  }

  // Create a new empty fleet
  function createFleet(state, name) {
    if (!state.fleets) state.fleets = {};
    var id = 'fleet_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    state.fleets[id] = {
      id: id,
      name: name || 'Unnamed Fleet',
      troops: {},
      createdAt: Date.now()
    };
    return id;
  }

  // Delete a fleet and return its troops to the pool
  function deleteFleet(state, fleetId) {
    var fleet = state.fleets[fleetId];
    if (!fleet) return false;
    // Return troops to main pool
    var troops = fleet.troops || {};
    Object.keys(troops).forEach(function (key) {
      var count = troops[key] || 0;
      if (!state.troops.counts[key]) state.troops.counts[key] = 0;
      state.troops.counts[key] += count;
    });
    delete state.fleets[fleetId];
    return true;
  }

  // Move troops from the main pool INTO a fleet
  function addToFleet(state, fleetId, troopKey, quantity) {
    quantity = Math.max(0, parseInt(quantity, 10) || 0);
    if (quantity <= 0) return { ok: false, reason: 'Quantity must be positive' };
    var fleet = state.fleets[fleetId];
    if (!fleet) return { ok: false, reason: 'Fleet not found' };
    var available = state.troops.counts[troopKey] || 0;
    if (available < quantity) return { ok: false, reason: 'Not enough troops available. You have ' + available };
    // Deduct from main pool
    state.troops.counts[troopKey] = Math.max(0, (state.troops.counts[troopKey] || 0) - quantity);
    // Add to fleet
    if (!fleet.troops[troopKey]) fleet.troops[troopKey] = 0;
    fleet.troops[troopKey] += quantity;
    return { ok: true };
  }

  // Move troops FROM a fleet back to the main pool
  function removeFromFleet(state, fleetId, troopKey, quantity) {
    quantity = Math.max(0, parseInt(quantity, 10) || 0);
    if (quantity <= 0) return { ok: false, reason: 'Quantity must be positive' };
    var fleet = state.fleets[fleetId];
    if (!fleet) return { ok: false, reason: 'Fleet not found' };
    var inFleet = fleet.troops[troopKey] || 0;
    if (inFleet < quantity) return { ok: false, reason: 'Not enough troops in fleet. Only ' + inFleet };
    // Deduct from fleet
    fleet.troops[troopKey] = Math.max(0, (fleet.troops[troopKey] || 0) - quantity);
    if (fleet.troops[troopKey] <= 0) delete fleet.troops[troopKey];
    // Add back to main pool
    if (!state.troops.counts[troopKey]) state.troops.counts[troopKey] = 0;
    state.troops.counts[troopKey] += quantity;
    return { ok: true };
  }

  // Rename a fleet
  function renameFleet(state, fleetId, newName) {
    var fleet = state.fleets[fleetId];
    if (!fleet) return false;
    fleet.name = newName || 'Unnamed Fleet';
    return true;
  }

  return {
    getFleetPower,
    getFleetDefense,
    getFleetCarry,
    getFleetSize,
    getFleetIds,
    getFleet,
    createFleet,
    deleteFleet,
    addToFleet,
    removeFromFleet,
    renameFleet
  };
})();
