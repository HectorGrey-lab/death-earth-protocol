/**
 * research.js — Server-side research system
 */
const GAME = require('../game-data.json');
const Requirements = require('./requirements');

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
  let reduction = Math.max(0, (colony.buildings.researchLab.level - 1) * 0.08);
  // Alliance perk would go here if server tracks alliances
  reduction += colony.research.timeReduction || 0;
  return Math.max(0, reduction);
}

function getResearchDuration(colony, category, level) {
  const def = GAME.research[category];
  if (!def) return 9999;
  const pacing = GAME.pacing || {};
  const minL1 = pacing.researchMinL1 || 60;
  const growth = pacing.researchGrowth || 1.32;
  const weightBase = pacing.researchWeightBase || 45;
  const effectiveLevel = (level || 0) + 1; // first research => level 0 => effective 1
  const weight = Math.max(0.7, Math.min(2.5, (def.durationBase || weightBase) / weightBase));
  const base = Math.max(minL1, Math.floor(minL1 * weight * Math.pow(growth, effectiveLevel - 1)));
  const reduction = Math.max(0, getTimeReduction(colony));
  return Math.max(10, Math.floor(base * (1 - reduction)));
}

function startResearch(colony, category) {
  if (colony.research.active) return { ok: false, reason: 'Research already active' };
  const def = GAME.research[category];
  if (!def) return { ok: false, reason: 'Unknown research category' };
  // Tech-tree prerequisites
  const r = Requirements.checkRequirements(colony, def.requires);
  if (!r.ok) return { ok: false, reason: r.reason };
  const lvl = colony.research.levels[category] || 0;
  const cost = getResearchCost(category, lvl);
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
