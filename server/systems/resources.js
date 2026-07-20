/**
 * resources.js — Server-side resource production
 */

const GAME = require('../game-data.json');

function getProductionRates(colony) {
  const extLevel = colony.buildings.extractionGrid.level || 0;
  const ecoResearch = colony.research.levels.economy || 0;
  const mult = 1 + (extLevel - 1) * 0.12 + ecoResearch * 0.08;
  return {
    ore: 8 * mult,
    solar: 7 * mult,
    crystal: 5 * mult,
    isotopes: 3.2 * mult
  };
}

function updateCaps(colony) {
  const levelSum = Object.values(colony.buildings).reduce((s, b) => s + (b.level || 0), 0);
  Object.keys(colony.resources).forEach(key => {
    const resDef = GAME.resources[key];
    if (!resDef) return;
    const baseCap = resDef.capBase;
    colony.resources[key].cap = Math.floor(baseCap + levelSum * 35);
    colony.resources[key].amount = Math.min(colony.resources[key].cap, colony.resources[key].amount);
  });
}

function getUpkeep(colony) {
  let total = 0;
  const counts = colony.troops.counts || {};
  Object.keys(counts).forEach(key => {
    total += (counts[key] || 0) * (GAME.troops[key] ? GAME.troops[key].upkeep : 0);
  });
  return total;
}

function tick(colony, dt) {
  updateCaps(colony);
  const rates = getProductionRates(colony);
  Object.keys(rates).forEach(key => {
    colony.resources[key].amount = Math.min(
      colony.resources[key].cap,
      colony.resources[key].amount + rates[key] * dt
    );
  });
  const upkeep = getUpkeep(colony) * dt;
  colony.resources.isotopes.amount = Math.max(0, colony.resources.isotopes.amount - upkeep);
}

function getPopulation(colony) {
  return Object.values(colony.buildings).reduce((sum, b) => sum + (b.level || 0) * 6, 0) +
         Object.values(colony.troops.counts || {}).reduce((a, b) => a + b, 0);
}

function getBasePower(colony) {
  const buildingPower = Object.values(colony.buildings).reduce((sum, b) => sum + (b.level || 0) * 18, 0);
  const troopPower = Object.values(colony.troops.counts || {}).reduce((sum, count) => sum + count * 12, 0);
  const researchPower = (colony.research.completedTotal || 0) * 20;
  return buildingPower + troopPower + researchPower;
}

module.exports = { tick, getProductionRates, updateCaps, getUpkeep, getPopulation, getBasePower };
