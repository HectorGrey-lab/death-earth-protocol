/**
 * resources.js — Server-side resource production
 *
 * Tunable via env vars (set on Railway, no code changes needed):
 *   ECONOMY_SPEED           global production multiplier   (default 1.0, clamp 0.05..5)
 *   ECONOMY_EXT_STEP        production scaling per extractionGrid level (default 0.05, clamp 0..0.25)
 *   ECONOMY_RESEARCH_STEP   production scaling per economy research level (default 0.05, clamp 0..0.25)
 *   ECONOMY_ISOTOPE_MULT    isotopes-only multiplier       (default 1.0, clamp 0.05..5)
 */

const GAME = require('../game-data.json');

function clampNumber(raw, fallback, min, max) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const ECONOMY_SPEED = clampNumber(process.env.ECONOMY_SPEED, 1, 0.05, 5);
const EXT_STEP = clampNumber(process.env.ECONOMY_EXT_STEP, 0.05, 0, 0.25);
const ECO_STEP = clampNumber(process.env.ECONOMY_RESEARCH_STEP, 0.05, 0, 0.25);
const ISO_MULT = clampNumber(process.env.ECONOMY_ISOTOPE_MULT, 1, 0.05, 5);

function getProductionRates(colony) {
  const extLevel = colony.buildings.extractionGrid.level || 0;
  const ecoResearch = colony.research.levels.economy || 0;
  const mult = 1 + (extLevel - 1) * EXT_STEP + ecoResearch * ECO_STEP;
  return {
    ore: 1.1 * mult * ECONOMY_SPEED,
    solar: 0.9 * mult * ECONOMY_SPEED,
    crystal: 1.0 * mult * ECONOMY_SPEED,
    isotopes: 2.2 * mult * ECONOMY_SPEED * ISO_MULT
  };
}

function updateCaps(colony) {
  const warehouseLevel = colony.buildings.defenseBunker.level || 0;
  const bonus = warehouseLevel * 10000;
  Object.keys(colony.resources).forEach(key => {
    const resDef = GAME.resources[key];
    if (!resDef) return;
    const baseCap = resDef.capBase;
    const newCap = Math.floor(baseCap + bonus);
    // Set cap directly so sieged-down buildings shrink caps instead of ratcheting up forever
    colony.resources[key].cap = newCap;
    colony.resources[key].amount = Math.min(colony.resources[key].amount, colony.resources[key].cap);
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
  // Population is infrastructure-only: total building levels
  return Object.values(colony.buildings || {}).reduce((sum, b) => sum + (b.level || 0), 0);
}

function getBasePower(colony) {
  const buildingPower = Object.values(colony.buildings).reduce((sum, b) => sum + (b.level || 0) * 18, 0);
  const troopPower = Object.values(colony.troops.counts || {}).reduce((sum, count) => sum + count * 12, 0);
  const researchPower = (colony.research.completedTotal || 0) * 20;
  return buildingPower + troopPower + researchPower;
}

module.exports = { tick, getProductionRates, updateCaps, getUpkeep, getPopulation, getBasePower };
