/**
 * research.js — Server-side research system
 */
const GAME = require('../game-data.json');

function getResearchCost(category, level) {
  const def = GAME.research[category];
  if (!def) return null;
  const mult = 1 + level * 0.6;
  const cost = {};
  Object.keys(def.baseCost).forEach(k => {
    cost[k] = Math.floor(def.baseCost[k] * mult);
  });
  return cost;
}

function getTimeReduction(colony) {
  let reduction = (colony.buildings.researchLab.level - 1) * 0.08;
  // Alliance perk would go here if server tracks alliances
  reduction += colony.research.timeReduction || 0;
  return reduction;
}

function getResearchDuration(colony, category, level) {
  const def = GAME.research[category];
  if (!def) return 9999;
  const base = def.durationBase * (1 + level * 0.22);
  const reduction = getTimeReduction(colony);
  return Math.max(10, Math.floor(base * (1 - reduction)));
}

function startResearch(colony, category) {
  if (colony.research.active) return { ok: false, reason: 'Research already active' };
  const lvl = colony.research.levels[category] || 0;
  const cost = getResearchCost(category, lvl);
  if (!cost) return { ok: false, reason: 'Unknown research category' };
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
  colony.research.active = {
    category: category,
    remaining: getResearchDuration(colony, category, lvl),
    targetLevel: lvl + 1
  };
  return { ok: true, message: GAME.research[category].name + ' research initiated' };
}

function tick(colony, dt) {
  if (!colony.research.active) return;
  colony.research.active.remaining -= dt;
  if (colony.research.active.remaining <= 0) {
    colony.research.levels[colony.research.active.category] = colony.research.active.targetLevel;
    colony.research.active = null;
    colony.research.completedTotal = (colony.research.completedTotal || 0) + 1;
  }
}

module.exports = { getResearchCost, getResearchDuration, startResearch, tick };
