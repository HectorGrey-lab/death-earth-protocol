window.BuildingSystem = (function () {
  function getUpgradeCost(buildingKey, level) {
    const def = GameData.buildings[buildingKey];
    const effectiveLevel = Math.max(1, level); // level 0 construction uses base cost
    const mult = 1 + (effectiveLevel - 1) * 0.55;
    const cost = {};
    Object.keys(def.baseCost).forEach((k) => {
      cost[k] = Math.floor(def.baseCost[k] * mult);
    });
    return cost;
  }

  function getUpgradeTime(buildingKey, level) {
    const def = GameData.buildings[buildingKey];
    const pacing = (GameData.pacing) || {};
    const minL1 = pacing.buildingMinL1 || 60;
    const growth = pacing.buildingGrowth || 1.28;
    const weightBase = pacing.buildingWeightBase || 30;
    const effectiveLevel = Math.max(1, level); // level 0 -> 1 construction also >= 60s
    const weight = Math.max(0.6, Math.min(2.5, (def.timeBase || weightBase) / weightBase));
    const t = Math.floor(minL1 * weight * Math.pow(growth, effectiveLevel - 1));
    return Math.max(minL1, t);
  }

  function getRepairCost(buildingKey, level) {
    const upgradeCost = getUpgradeCost(buildingKey, level);
    if (!upgradeCost) return null;
    const cost = {};
    Object.keys(upgradeCost).forEach(function(k) {
      cost[k] = Math.max(1, Math.ceil(upgradeCost[k] / 2));
    });
    return cost;
  }

  function startUpgrade(state, buildingKey) {
    const b = state.buildings[buildingKey];
    // Tech-tree prerequisites (mirror of server check)
    const def = GameData.buildings[buildingKey];
    if (def && def.requires) {
      const req = RequirementsClient.check(state, def.requires);
      if (!req.ok) return { ok: false, reason: req.reason };
    }
    if (b.upgrading) return { ok: false, reason: "Already upgrading" };
    if (b.level >= 20) return { ok: false, reason: "Maximum level (20) reached" };
    const cost = getUpgradeCost(buildingKey, b.level);
    if (!Utils.payCost(state, cost)) return { ok: false, reason: "Insufficient resources" };

    b.upgrading = {
      remaining: getUpgradeTime(buildingKey, b.level),
      targetLevel: b.level + 1
    };
    MailboxSystem.addSystemMail(state, `${GameData.buildings[buildingKey].name} upgrade initiated.`);
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
          b.integrity = Math.min(100, b.integrity + 15);
          MailboxSystem.addSystemMail(state, `${GameData.buildings[key].name} upgraded to level ${b.level}.`);
          CommanderSystem.addRankPoints(state, 1);
        }
      }
    });
  }

  return {
    getUpgradeCost,
    getUpgradeTime,
    getRepairCost,
    startUpgrade,
    getShieldStats,
    getBasePower,
    getPopulation,
    tick
  };
})();