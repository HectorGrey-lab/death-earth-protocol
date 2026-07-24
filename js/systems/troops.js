window.TroopSystem = (function () {
  function getTrainingSpeedMult(state) {
    const lvl = state.buildings.trainingFacility.level;
    return 1 + (lvl - 1) * 0.15;
  }

  function queueTrain(state, troopKey, qty) {
    qty = Math.max(1, parseInt(qty, 10) || 1);
    const def = GameData.troops[troopKey];
    const cost = {};
    Object.keys(def.cost).forEach((k) => cost[k] = def.cost[k] * qty);
    if (!Utils.payCost(state, cost)) return { ok: false, reason: "Insufficient resources" };

    state.troops.queue.push({
      id: Utils.uid("train"),
      type: "troop",
      troopKey,
      qty,
      remaining: Math.floor((def.trainTime * qty) / getTrainingSpeedMult(state))
    });
    MailboxSystem.addSystemMail(state, `${def.name} x${qty} queued for training.`);
    return { ok: true };
  }

  function tick(state, dt) {
    if (!state.troops.queue.length) return;
    const item = state.troops.queue[0];
    item.remaining -= dt;
    if (item.remaining <= 0) {
      state.troops.counts[item.troopKey] += item.qty;
      MailboxSystem.addSystemMail(state, `Training complete: ${GameData.troops[item.troopKey].name} x${item.qty}.`);
      state.troops.queue.shift();
      CommanderSystem.addRankPoints(state, 1);
    }
  }

  function getTotalTroops(state) {
    var base = Object.values(state.troops.counts).reduce(function(a, b) { return a + b; }, 0);
    // Include troops in fleets
    var fleets = state.fleets || {};
    Object.keys(fleets).forEach(function(fid) {
      Object.values(fleets[fid].troops || {}).forEach(function(c) { base += c; });
    });
    return base;
  }

  function getPowerModifier(state) {
    let mod = 1 + (state.research.levels.military || 0) * 0.08;
    const alliance = AllianceSystem.getJoinedAlliance(state);
    if (alliance && alliance.perkType === "military") mod += alliance.perkValue;
    return mod;
  }

  function getDefenseModifier(state) {
    return 1 + (state.research.levels.defense || 0) * 0.06;
  }

  function getTotalPower(state) {
    const mod = getPowerModifier(state);
    var total = Object.keys(state.troops.counts).reduce(function(sum, key) {
      return sum + state.troops.counts[key] * GameData.troops[key].power * mod;
    }, 0);
    // Include fleets
    var fleets = state.fleets || {};
    Object.keys(fleets).forEach(function(fid) {
      var ftroops = fleets[fid].troops || {};
      Object.keys(ftroops).forEach(function(key) {
        total += ftroops[key] * GameData.troops[key].power * mod;
      });
    });
    return Math.floor(total);
  }

  function getTotalDefense(state) {
    const mod = getDefenseModifier(state);
    var total = Object.keys(state.troops.counts).reduce(function(sum, key) {
      return sum + state.troops.counts[key] * GameData.troops[key].defense * mod;
    }, 0);
    // Include fleets
    var fleets = state.fleets || {};
    Object.keys(fleets).forEach(function(fid) {
      var ftroops = fleets[fid].troops || {};
      Object.keys(ftroops).forEach(function(key) {
        total += ftroops[key] * GameData.troops[key].defense * mod;
      });
    });
    return Math.floor(total);
  }

  function removeCasualties(state, casualtiesByType) {
    Object.keys(casualtiesByType).forEach((key) => {
      state.troops.counts[key] = Math.max(0, state.troops.counts[key] - casualtiesByType[key]);
    });
  }

  function getAvailableArmy(state) {
    return Utils.deepClone(state.troops.counts);
  }

  return {
    queueTrain,
    tick,
    getTotalTroops,
    getTotalPower,
    getTotalDefense,
    getPowerModifier,
    getAvailableArmy,
    removeCasualties
  };
})();