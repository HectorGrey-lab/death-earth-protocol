window.BuildingSystem = (function () {
  function getUpgradeCost(buildingKey, level) {
    const def = GameData.buildings[buildingKey];
    const mult = 1 + (level - 1) * 0.55;
    const cost = {};
    Object.keys(def.baseCost).forEach((k) => {
      cost[k] = Math.floor(def.baseCost[k] * mult);
    });
    return cost;
  }

  function getUpgradeTime(buildingKey, level) {
    const def = GameData.buildings[buildingKey];
    return Math.floor(def.timeBase * (1 + (level - 1) * 0.18));
  }

  function startUpgrade(state, buildingKey) {
    const b = state.buildings[buildingKey];
    if (b.upgrading) return { ok: false, reason: "Already upgrading" };
    const cost = getUpgradeCost(buildingKey, b.level);
    if (!Utils.payCost(state, cost)) return { ok: false, reason: "Insufficient resources" };

    b.upgrading = {
      remaining: getUpgradeTime(buildingKey, b.level),
      targetLevel: b.level + 1
    };
    MailboxSystem.addSystemMail(state, `${GameData.buildings[buildingKey].name} upgrade initiated.`);
    return { ok: true };
  }

  function repairBuilding(state, buildingKey) {
    const b = state.buildings[buildingKey];
    if (b.integrity >= 100) return { ok: false, reason: "Integrity full" };

    const missing = 100 - b.integrity;
    const cost = {
      ore: Math.floor(missing * 1.2),
      solar: Math.floor(missing * 0.7),
      crystal: Math.floor(missing * 0.4)
    };
    if (!Utils.payCost(state, cost)) return { ok: false, reason: "Insufficient resources" };

    b.integrity = Math.min(100, b.integrity + 25);
    MailboxSystem.addSystemMail(state, `${GameData.buildings[buildingKey].name} repair cycle completed.`);
    return { ok: true };
  }

  function getShieldStats(state) {
    const genLevel = state.buildings.shieldGenerator && state.buildings.shieldGenerator.level || 0;
    const defenseResearch = (state.research && state.research.levels && state.research.levels.defense) || 0;
    const max = 120 + genLevel * 70 + defenseResearch * 25;
    const integrity = (state.buildings.shieldGenerator && state.buildings.shieldGenerator.integrity) || 100;
    const current = Math.floor(max * (integrity / 100));
    return { current, max };
  }

  function getBasePower(state) {
    const buildingPower = Object.values(state.buildings).reduce((sum, b) => sum + b.level * 18, 0);
    const troopPower = TroopSystem.getTotalPower(state);
    const researchPower = (state.research && state.research.completedTotal || 0) * 20;
    return buildingPower + troopPower + researchPower;
  }

  function getPopulation(state) {
    return 40 + Object.values(state.buildings).reduce((sum, b) => sum + b.level * 6, 0) + TroopSystem.getTotalTroops(state);
  }

  function tick(state, dt) {
    Object.keys(state.buildings).forEach((key) => {
      const b = state.buildings[key];
      if (b.upgrading) {
        b.upgrading.remaining -= dt;
        if (b.upgrading.remaining <= 0) {
          b.level = b.upgrading.targetLevel;
          b.upgrading = null;
          b.integrity = Math.min(100, b.integrity + 5);
          MailboxSystem.addSystemMail(state, `${GameData.buildings[key].name} upgraded to level ${b.level}.`);
          CommanderSystem.addRankPoints(state, 1);
        }
      }
    });
  }

  return {
    getUpgradeCost,
    getUpgradeTime,
    startUpgrade,
    repairBuilding,
    getShieldStats,
    getBasePower,
    getPopulation,
    tick
  };
})();