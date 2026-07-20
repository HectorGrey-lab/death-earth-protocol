/**
 * buildings.js — Server-side building construction
 */

const GAME = require('../game-data.json');
const ResourceSystem = require('./resources');

function getUpgradeCost(buildingKey, level) {
  const def = GAME.buildings[buildingKey];
  if (!def) return null;
  const mult = 1 + (level - 1) * 0.55;
  const cost = {};
  Object.keys(def.baseCost).forEach(k => {
    cost[k] = Math.floor(def.baseCost[k] * mult);
  });
  return cost;
}

function getUpgradeTime(buildingKey, level) {
  const def = GAME.buildings[buildingKey];
  if (!def) return 9999;
  return Math.floor(def.timeBase * (1 + (level - 1) * 0.18));
}

function startUpgrade(colony, buildingKey) {
  const b = colony.buildings[buildingKey];
  if (!b) return { ok: false, reason: 'Unknown building' };
  if (b.upgrading) return { ok: false, reason: 'Already upgrading' };
  const cost = getUpgradeCost(buildingKey, b.level);
  if (!cost) return { ok: false, reason: 'Invalid building' };
  // Check resources
  for (const k of Object.keys(cost)) {
    if ((colony.resources[k]?.amount || 0) < cost[k]) {
      return { ok: false, reason: 'Insufficient ' + k };
    }
  }
  // Pay cost
  for (const k of Object.keys(cost)) {
    colony.resources[k].amount -= cost[k];
  }
  b.upgrading = {
    remaining: getUpgradeTime(buildingKey, b.level),
    targetLevel: b.level + 1
  };
  return { ok: true, message: GAME.buildings[buildingKey].name + ' upgrade initiated' };
}

function tick(colony, dt) {
  Object.keys(colony.buildings).forEach(key => {
    const b = colony.buildings[key];
    if (b.upgrading) {
      b.upgrading.remaining -= dt;
      if (b.upgrading.remaining <= 0) {
        b.level = b.upgrading.targetLevel;
        b.upgrading = null;
        b.integrity = Math.min(100, (b.integrity || 100) + 5);
      }
    }
  });
}

module.exports = { getUpgradeCost, getUpgradeTime, startUpgrade, tick };
