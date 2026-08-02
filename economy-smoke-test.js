/**
 * economy-smoke-test.js — verifies ECONOMY_SPEED / EXT_STEP / ECO_STEP / ISOTOPE_MULT
 * Run with: node economy-smoke-test.js            (defaults: rates unchanged, step 0.05)
 *           ECONOMY_SPEED=0.2 node economy-smoke-test.js
 *           ECONOMY_SPEED=0.2 ECONOMY_ISOTOPE_MULT=0.6 node economy-smoke-test.js
 * Prints rates for a colony with extGrid=5, economy research=3.
 */
const R = require('./server/systems/resources.js');

function colony() {
  const b = {};
  Object.keys(require('./server/game-data.json').buildings).forEach(k => { b[k] = { level: k === 'extractionGrid' ? 5 : 1, integrity: 100, upgrading: null }; });
  return {
    buildings: b,
    resources: { ore: { amount: 0, cap: 50000 }, solar: { amount: 0, cap: 50000 }, crystal: { amount: 0, cap: 50000 }, isotopes: { amount: 0, cap: 50000 } },
    troops: { counts: {}, queue: [], fleets: {} },
    research: { levels: { economy: 3, military: 0, defense: 0 }, active: null, completedTotal: 0 },
    combat: { scoutsCompleted: 0, attackWins: 0, defenseWins: 0, incomingAttacks: [], raidHistory: [] },
    mailbox: { messages: [], selectedTab: 'Inbox', selectedMessageId: null },
    position: { galaxy: 1, sector: 1, planet: 1 }
  };
}

const rates = R.getProductionRates(colony());
const out = {
  ECONOMY_SPEED: process.env.ECONOMY_SPEED || '(unset)',
  ECONOMY_EXT_STEP: process.env.ECONOMY_EXT_STEP || '(unset)',
  ECONOMY_RESEARCH_STEP: process.env.ECONOMY_RESEARCH_STEP || '(unset)',
  ECONOMY_ISOTOPE_MULT: process.env.ECONOMY_ISOTOPE_MULT || '(unset)',
  mult: 1 + (5 - 1) * (Number(process.env.ECONOMY_EXT_STEP) || 0.05) + 3 * (Number(process.env.ECONOMY_RESEARCH_STEP) || 0.05),
  rates
};
console.log(JSON.stringify(out, null, 2));
