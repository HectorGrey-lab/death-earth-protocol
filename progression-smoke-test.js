/**
 * progression-smoke-test.js — verifies pacing (P1), tech tree (P2), startLevel (P3),
 * level-0 cost/time (P4), gameData payload (P5). Run: node progression-smoke-test.js
 */
const assert = require('assert');
const Buildings = require('./server/systems/buildings');
const Research = require('./server/systems/research');
const Troops = require('./server/systems/troops');
const Market = require('./server/systems/market');
const Expeditions = require('./server/systems/expeditions');
const G = require('./server/game-data.json');

let passed = 0;
function ok(cond, name) {
  if (!cond) { console.error('FAIL: ' + name); process.exitCode = 1; return; }
  passed++;
  console.log('  ok - ' + name);
}

// --- fresh colony (what createInitialBuildings produces) ---
function freshColony() {
  const b = {};
  Object.keys(G.buildings).forEach(k => {
    b[k] = { level: (G.buildings[k].startLevel || 0), integrity: 100, upgrading: null };
  });
  const colony = {
    buildings: b,
    resources: {
      ore: { amount: 5000, cap: 5000 }, solar: { amount: 5000, cap: 5000 },
      crystal: { amount: 5000, cap: 5000 }, isotopes: { amount: 5000, cap: 5000 }
    },
    troops: { counts: {}, queue: [] },
    research: { levels: { economy: 0, military: 0, defense: 0 }, active: null, completedTotal: 0 }
  };
  return colony;
}

console.log('P1: pacing + time formulas');
{
  // building L0->1 uses min floor 60s; heavier defs weigh more
  const t0 = Buildings.getUpgradeTime('extractionGrid', 0);
  const t1 = Buildings.getUpgradeTime('extractionGrid', 1);
  ok(t0 === 60, 'L0->1 construction is >= 60s (got ' + t0 + ')');
  ok(t1 === 60, 'L1->2 is 60s base (got ' + t1 + ')');
  const t2 = Buildings.getUpgradeTime('extractionGrid', 2);
  ok(t2 > t1, 'time grows with level (' + t1 + ' -> ' + t2 + ')');
  const lab5 = Buildings.getUpgradeTime('researchLab', 5);
  ok(lab5 > 60, 'researchLab L5 slower than base (got ' + lab5 + ')');

  const r0 = Research.getResearchDuration(freshColony(), 'economy', 0);
  ok(r0 >= 60, 'first research >= 60s (got ' + r0 + ')');
  const r1 = Research.getResearchDuration(freshColony(), 'economy', 1);
  ok(r1 > r0, 'research duration grows (' + r0 + ' -> ' + r1 + ')');
}

console.log('P3: startLevel');
{
  const c = freshColony();
  ok(c.buildings.extractionGrid.level === 1, 'extractionGrid starts L1');
  ok(c.buildings.defenseBunker.level === 1, 'defenseBunker starts L1');
  ok(c.buildings.trainingFacility.level === 0, 'trainingFacility starts L0');
  ok(c.buildings.researchLab.level === 0, 'researchLab starts L0');
  ok(c.buildings.marketNexus.level === 0, 'marketNexus starts L0');
  ok(c.buildings.tradePodTerminal.level === 0, 'tradePodTerminal starts L0');
}

console.log('P4: level-0 cost + repair guard');
{
  const c = freshColony();
  const cost0 = Buildings.getUpgradeCost('communicationsHub', 0);
  const cost1 = Buildings.getUpgradeCost('communicationsHub', 1);
  const cost2 = Buildings.getUpgradeCost('communicationsHub', 2);
  ok(JSON.stringify(cost0) === JSON.stringify(G.buildings.communicationsHub.baseCost), 'L0 construction uses base cost exactly');
  ok(JSON.stringify(cost1) === JSON.stringify(cost0), 'L0->1 and L1->2 share the same base-cost math (per spec)');
  ok(cost2.ore > cost0.ore, 'L2->3 costs more than L0->1 (' + cost0.ore + ' -> ' + cost2.ore + ')');

  const c2 = freshColony();
  c2.buildings.researchLab.level = 1; // make it built
  const r = Buildings.startRepair(c2, 'researchLab');
  ok(r.ok === false && r.reason === 'Building is at full integrity', 'repair at full integrity blocked');
  const r2 = Buildings.startRepair(freshColony(), 'communicationsHub');
  ok(r2.ok === false && r2.reason === 'Not constructed', 'repair at level 0 blocked');
}

console.log('P2: tech tree gates (server-authoritative)');
{
  // economy research requires researchLab L1 -> blocked on fresh colony
  const c = freshColony();
  let r = Research.startResearch(c, 'economy');
  ok(r.ok === false && /Research Lab Lv1/.test(r.reason), 'economy research blocked without Lab (got: ' + r.reason + ')');

  // train requires trainingFacility L1
  const c2 = freshColony();
  r = Troops.queueTrain(c2, 'rifleUnit', 1);
  ok(r.ok === false && /Training Facility Lv1/.test(r.reason), 'training blocked without Facility (got: ' + r.reason + ')');

  // exchange requires marketNexus L1
  const c3 = freshColony();
  r = Market.exchange(c3, 'ore', 'solar', 100);
  ok(r.ok === false && /Market Nexus Lv1/.test(r.reason), 'exchange blocked without Nexus (got: ' + r.reason + ')');

  // expedition requires tradePodTerminal L1
  const c4 = freshColony();
  r = Expeditions.launch(c4, 'n-resource-1');
  ok(r.ok === false && /Trade Pod Terminal Lv1/.test(r.reason), 'expedition blocked without Terminal (got: ' + r.reason + ')');

  // communicationsHub requires extractionGrid L2
  const c5 = freshColony();
  r = Buildings.startUpgrade(c5, 'communicationsHub');
  ok(r.ok === false && /Extraction Grid Lv2/.test(r.reason), 'commHub blocked without Extraction Grid L2 (got: ' + r.reason + ')');
}

console.log('P2: gates pass when prerequisites met');
{
  // commHub at extractionGrid L2
  const c = freshColony();
  c.buildings.extractionGrid.level = 2;
  let r = Buildings.startUpgrade(c, 'communicationsHub');
  ok(r.ok === true, 'commHub builds with Extraction Grid L2 (got: ' + JSON.stringify(r) + ')');

  // economy research with lab L1
  const c2 = freshColony();
  c2.buildings.researchLab.level = 1;
  r = Research.startResearch(c2, 'economy');
  ok(r.ok === true, 'economy research with Lab L1 (got: ' + JSON.stringify(r) + ')');

  // military research needs lab L2 + trainingFacility L1
  const c3 = freshColony();
  c3.buildings.researchLab.level = 1;
  c3.buildings.trainingFacility.level = 1;
  r = Research.startResearch(c3, 'military');
  ok(r.ok === false, 'military research blocked at Lab L1 even with Facility');
  c3.buildings.researchLab.level = 2;
  r = Research.startResearch(c3, 'military');
  ok(r.ok === true, 'military research passes at Lab L2 + Facility L1');
}

console.log('P5: gameData payload shape');
{
  const gd = {
    pacing: G.pacing,
    buildings: {}, research: {}
  };
  Object.keys(G.buildings).forEach(k => { gd.buildings[k] = { requires: G.buildings[k].requires || null, startLevel: G.buildings[k].startLevel || 0 }; });
  Object.keys(G.research).forEach(k => { gd.research[k] = { requires: G.research[k].requires || null }; });
  ok(gd.pacing.buildingMinL1 === 60, 'pacing in payload');
  ok(gd.buildings.trainingFacility.requires.buildings.extractionGrid === 2, 'building reqs in payload');
  ok(gd.research.economy.requires.buildings.researchLab === 1, 'research reqs in payload');
  ok(gd.buildings.extractionGrid.startLevel === 1 && gd.buildings.trainingFacility.startLevel === 0, 'startLevel in payload');
}

console.log('\n' + passed + ' assertions passed');
if (process.exitCode) { console.error('SOME ASSERTIONS FAILED'); process.exit(1); }
console.log('PROGRESSION SMOKE PASS');
