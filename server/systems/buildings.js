/**
 * buildings.js — Server-side building construction
 */

const GAME = require('../game-data.json');
const ResourceSystem = require('./resources');
const Requirements = require('./requirements');

function getUpgradeCost(buildingKey, level) {
  const def = GAME.buildings[buildingKey];
  if (!def) return null;
  const effectiveLevel = Math.max(1, level); // level 0 construction uses base cost
  const mult = 1 + (effectiveLevel - 1) * 0.55;
  const cost = {};
  Object.keys(def.baseCost).forEach(k => {
    cost[k] = Math.floor(def.baseCost[k] * mult);
  });
  return cost;
}

function getUpgradeTime(buildingKey, level) {
  const def = GAME.buildings[buildingKey];
  if (!def) return 9999;
  const pacing = GAME.pacing || {};
  const minL1 = pacing.buildingMinL1 || 60;
  const growth = pacing.buildingGrowth || 1.28;
  const weightBase = pacing.buildingWeightBase || 30;
  const effectiveLevel = Math.max(1, level); // level 0 -> 1 construction also >= 60s
  const weight = Math.max(0.6, Math.min(2.5, (def.timeBase || weightBase) / weightBase));
  const t = Math.floor(minL1 * weight * Math.pow(growth, effectiveLevel - 1));
  return Math.max(minL1, t);
}

function startUpgrade(colony, buildingKey) {
  const b = colony.buildings[buildingKey];
  if (!b) return { ok: false, reason: 'Unknown building' };
  // Tech-tree prerequisites
  const req = GAME.buildings[buildingKey].requires;
  const r = Requirements.checkRequirements(colony, req);
  if (!r.ok) return { ok: false, reason: r.reason };
  if (b.upgrading) return { ok: false, reason: 'Already upgrading' };
  if (b.level >= 20) return { ok: false, reason: 'Maximum level (20) reached' };
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
        b.integrity = Math.min(100, (b.integrity || 100) + 15);
      }
    }
  });
}

function getRepairCost(buildingKey, level) {
  var upgradeCost = getUpgradeCost(buildingKey, level);
  if (!upgradeCost) return null;
  var cost = {};
  Object.keys(upgradeCost).forEach(function(k) {
    cost[k] = Math.max(1, Math.ceil(upgradeCost[k] / 2));
  });
  return cost;
}

function startRepair(colony, buildingKey) {
  var b = colony.buildings[buildingKey];
  if (!b) return { ok: false, reason: 'Unknown building' };
  if (b.level <= 0) return { ok: false, reason: 'Not constructed' };
  if (b.integrity >= 100) return { ok: false, reason: 'Building is at full integrity' };
  var cost = getRepairCost(buildingKey, b.level);
  if (!cost) return { ok: false, reason: 'Invalid building' };
  for (var k of Object.keys(cost)) {
    if ((colony.resources[k]?.amount || 0) < cost[k]) {
      return { ok: false, reason: 'Insufficient ' + k };
    }
  }
  for (var k of Object.keys(cost)) {
    colony.resources[k].amount -= cost[k];
  }
  b.integrity = 100;
  return { ok: true, message: GAME.buildings[buildingKey].name + ' repaired to 100%' };
}

module.exports = { getUpgradeCost, getUpgradeTime, startUpgrade, tick, getRepairCost, startRepair };
