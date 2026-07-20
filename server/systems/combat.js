/**
 * combat.js — Server-side combat system (scouting, raids, incoming attacks, defense)
 */
const GAME = require('../game-data.json');

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function chance(prob) {
  return Math.random() < prob;
}

function generateEnemyProfile(threatLevel) {
  const t = threatLevel;
  return {
    power: 60 + t * 55,
    shield: 40 + t * 35,
    bunker: 30 + t * 20,
    buildings: 3 + t
  };
}

function getTotalPower(colony) {
  const mod = 1 + (colony.research.levels.military || 0) * 0.08;
  let power = 0;
  const counts = colony.troops.counts || {};
  Object.keys(counts).forEach(key => {
    const def = GAME.troops[key];
    if (def) power += (counts[key] || 0) * def.power * mod;
  });
  return Math.floor(power);
}

function getTotalDefense(colony) {
  const mod = 1 + (colony.research.levels.defense || 0) * 0.06 + (colony.buildings.defenseBunker.level - 1) * 0.08;
  let defense = 0;
  const counts = colony.troops.counts || {};
  Object.keys(counts).forEach(key => {
    const def = GAME.troops[key];
    if (def) defense += (counts[key] || 0) * def.defense * mod;
  });
  return Math.floor(defense);
}

function estimateTraits(colony) {
  const traits = { scout: 0, siege: 0, shieldBreak: 0, supportShield: 0 };
  const counts = colony.troops.counts || {};
  Object.keys(counts).forEach(key => {
    const def = GAME.troops[key];
    if (def) (def.traits || []).forEach(tr => traits[tr] += counts[key] || 0);
  });
  return traits;
}

function scout(colony, nodeId) {
  // Generate enemy profile based on threat level (1-4 from node ID)
  const threatLevel = parseInt(nodeId.replace(/[^0-9]/g, '').slice(-1)) || 1;
  const profile = generateEnemyProfile(threatLevel);
  const radar = colony.buildings.radarArray.level;
  const accuracy = 0.12 * radar;

  const intel = {
    power: Math.max(1, Math.floor(profile.power * (1 + (Math.random() * accuracy - accuracy / 2)))),
    shield: Math.max(1, Math.floor(profile.shield * (1 + (Math.random() * accuracy - accuracy / 2)))),
    bunker: Math.max(1, Math.floor(profile.bunker * (1 + (Math.random() * accuracy - accuracy / 2)))),
    buildings: profile.buildings
  };

  // Track scouting
  if (!colony.combat) colony.combat = { scoutsCompleted: 0, attackWins: 0, defenseWins: 0, incomingAttacks: [], raidHistory: [], scoutingIntel: {} };
  colony.combat.scoutsCompleted = (colony.combat.scoutsCompleted || 0) + 1;
  if (!colony.combat.scoutingIntel) colony.combat.scoutingIntel = {};
  colony.combat.scoutingIntel[nodeId] = intel;

  return { ok: true, intel: intel };
}

function raid(colony, nodeId) {
  const threatLevel = parseInt(nodeId.replace(/[^0-9]/g, '').slice(-1)) || 1;
  const enemy = generateEnemyProfile(threatLevel);
  const armyPower = getTotalPower(colony);
  const traits = estimateTraits(colony);

  let effectivePower = armyPower;
  effectivePower += traits.siege * 2.5;
  effectivePower += traits.shieldBreak * 3;
  effectivePower -= enemy.shield * Math.max(0.25, 1 - traits.shieldBreak * 0.015);

  const enemyEffective = enemy.power + enemy.bunker * 1.1 + enemy.shield * 0.6;
  const success = effectivePower > enemyEffective * 0.92;

  // Casualties
  const casualtyRate = success ? 0.08 + threatLevel * 0.03 : 0.18 + threatLevel * 0.05;
  const casualties = {};
  const counts = colony.troops.counts || {};
  Object.keys(counts).forEach(key => {
    const count = counts[key];
    const def = GAME.troops[key];
    const rate = casualtyRate * (def && def.defense < 10 ? 1.1 : 0.9);
    casualties[key] = Math.min(count, Math.floor(count * rate));
  });
  // Apply casualties
  Object.keys(casualties).forEach(key => {
    colony.troops.counts[key] = Math.max(0, (colony.troops.counts[key] || 0) - casualties[key]);
  });

  let loot = { ore: 0, solar: 0, crystal: 0, isotopes: 0 };
  if (success) {
    loot = {
      ore: rand(70, 130) + threatLevel * 40,
      solar: rand(40, 90) + threatLevel * 30,
      crystal: rand(20, 60) + threatLevel * 18,
      isotopes: rand(10, 24) + threatLevel * 10
    };
    // Grant loot
    Object.keys(loot).forEach(k => {
      if (colony.resources[k]) {
        colony.resources[k].amount = Math.min(colony.resources[k].cap, colony.resources[k].amount + loot[k]);
      }
    });
    if (!colony.combat) colony.combat = {};
    colony.combat.attackWins = (colony.combat.attackWins || 0) + 1;
  }

  // Maybe schedule retaliation attack
  const retaliationChance = 0.2 + threatLevel * 0.08 + (success ? 0.1 : 0);
  if (chance(retaliationChance)) {
    scheduleIncomingAttack(colony, threatLevel + (success ? 0 : 1), true);
  }

  // Track raid history
  if (!colony.combat) colony.combat = {};
  if (!colony.combat.raidHistory) colony.combat.raidHistory = [];
  colony.combat.raidHistory.unshift({ target: nodeId, success: success, time: Date.now() });
  colony.combat.raidHistory = colony.combat.raidHistory.slice(0, 20);

  return { ok: true, success: success, loot: loot, casualties: casualties };
}

function scheduleIncomingAttack(colony, threatLevel, retaliation) {
  if (!colony.combat) colony.combat = { scoutsCompleted: 0, attackWins: 0, defenseWins: 0, incomingAttacks: [], raidHistory: [] };
  if (!colony.combat.incomingAttacks) colony.combat.incomingAttacks = [];
  const eta = rand(35, 90);
  colony.combat.incomingAttacks.push({
    id: 'atk-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    threatLevel: threatLevel,
    remaining: eta,
    retaliation: !!retaliation
  });
}

function tick(colony, dt) {
  if (!colony.combat) return;
  if (!colony.combat.incomingAttacks) return;

  // Maybe spawn random attack
  const radarReduction = (colony.buildings.radarArray.level - 1) * 0.0015;
  const randomChance = Math.max(0.002, 0.01 * dt - radarReduction);
  if (chance(randomChance)) {
    scheduleIncomingAttack(colony, rand(1, 4), false);
  }

  // Process incoming attacks
  const due = [];
  colony.combat.incomingAttacks.forEach(a => {
    a.remaining -= dt;
    if (a.remaining <= 0) due.push(a);
  });
  due.forEach(a => resolveIncoming(colony, a));
  colony.combat.incomingAttacks = colony.combat.incomingAttacks.filter(a => a.remaining > 0);
}

function resolveIncoming(colony, attack) {
  const defense = getTotalDefense(colony) + (colony.buildings.defenseBunker.level || 0) * 40 + (colony.buildings.shieldGenerator.level || 0) * 25;
  const enemyPower = 80 + attack.threatLevel * 65;
  const defended = defense > enemyPower * 1.05;

  // Casualties
  const counts = colony.troops.counts || {};
  Object.keys(counts).forEach(key => {
    const count = counts[key];
    const def = GAME.troops[key];
    const rate = defended ? 0.05 + attack.threatLevel * 0.02 : 0.12 + attack.threatLevel * 0.05;
    const actualRate = rate * (def && def.defense > 12 ? 0.75 : 1);
    const lost = Math.min(count, Math.floor(count * actualRate));
    colony.troops.counts[key] = Math.max(0, (colony.troops.counts[key] || 0) - lost);
  });

  // Building damage if not defended
  if (!defended) {
    const keys = Object.keys(colony.buildings);
    const hits = rand(1, 3);
    for (let i = 0; i < hits; i++) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      colony.buildings[k].integrity = Math.max(40, (colony.buildings[k].integrity || 100) - rand(8, 20));
    }
  }

  if (defended) colony.combat.defenseWins = (colony.combat.defenseWins || 0) + 1;
}

module.exports = { scout, raid, scheduleIncomingAttack, tick, getTotalPower, getTotalDefense };
