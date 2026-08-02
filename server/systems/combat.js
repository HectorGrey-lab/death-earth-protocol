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
  const mod = 1 + (colony.research.levels.defense || 0) * 0.06;
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

  // Process incoming attacks FIRST — collect due in separate array to avoid mutating-while-iterating
  const due = [];
  const alive = [];
  colony.combat.incomingAttacks.forEach(function(a) {
    a.remaining -= dt;
    if (a.remaining <= 0) {
      due.push(a);
    } else {
      alive.push(a);
    }
  });
  colony.combat.incomingAttacks = alive;
  due.forEach(function(a) { resolveIncoming(colony, a); });

  // THEN roll for a new random attack AFTER processing, so a freshly spawned
  // attack always gets a full ETA and can never resolve in the same tick (large dt offline catch-up)
  const radarReduction = (colony.buildings.radarArray.level - 1) * 0.0015;
  // Cap random chance at 1.0 even at large dt to avoid guaranteed spawns on offline catch-up
  const rawChance = Math.min(1.0, Math.max(0.002, 0.01 * (dt > 10 ? Math.min(dt, 60) : dt) - radarReduction));
  if (chance(rawChance)) {
    scheduleIncomingAttack(colony, rand(1, 4), false);
  }
}

function resolveIncoming(colony, attack) {
  const defense = getTotalDefense(colony) + (colony.buildings.shieldGenerator.level || 0) * 25;
  const enemyPower = 80 + attack.threatLevel * 65;
  const defended = defense > enemyPower * 1.05;

  // Casualties — track per troop type for the defense report
  const casualties = {};
  const counts = colony.troops.counts || {};
  Object.keys(counts).forEach(key => {
    const count = counts[key];
    const def = GAME.troops[key];
    const rate = defended ? 0.05 + attack.threatLevel * 0.02 : 0.12 + attack.threatLevel * 0.05;
    const actualRate = rate * (def && def.defense > 12 ? 0.75 : 1);
    const lost = Math.min(count, Math.floor(count * actualRate));
    if (lost > 0) casualties[key] = lost;
    colony.troops.counts[key] = Math.max(0, (colony.troops.counts[key] || 0) - lost);
  });

  // Building damage if not defended — track hits for the defense report
  const buildingHits = [];
  if (!defended) {
    const keys = Object.keys(colony.buildings);
    const hits = rand(1, 3);
    for (let i = 0; i < hits; i++) {
      const k = keys[Math.floor(Math.random() * keys.length)];
      if (colony.buildings[k]) {
        const before = colony.buildings[k].integrity || 100;
        const dmg = rand(8, 20);
        colony.buildings[k].integrity = Math.max(20, before - dmg);
        buildingHits.push({ key: k, before: before, after: colony.buildings[k].integrity, damage: before - colony.buildings[k].integrity });
      }
    }
  }

  if (defended) colony.combat.defenseWins = (colony.combat.defenseWins || 0) + 1;

  // Mail the defense report (server-authoritative, persists for offline players)
  sendDefenseReport(colony, attack, { defended: defended, casualties: casualties, buildingHits: buildingHits });
}

function sendDefenseReport(colony, attack, result) {
  const lvl = attack.threatLevel || 1;
  const retLabel = attack.retaliation ? ' (Retaliation)' : '';
  const lines = [];
  lines.push('🛡 DEFENSE REPORT — Threat L' + lvl + retLabel);
  lines.push('Time: ' + new Date().toUTCString());
  lines.push('Outcome: ' + (result.defended ? '✅ DEFENDED' : '❌ DAMAGE TAKEN'));
  lines.push('');
  lines.push('Losses');
  const casKeys = Object.keys(result.casualties);
  if (casKeys.length === 0) {
    lines.push('  None');
  } else {
    casKeys.forEach(k => {
      const name = (GAME.troops[k] && GAME.troops[k].name) || k;
      lines.push('  ' + name + ': ' + result.casualties[k]);
    });
  }
  lines.push('');
  lines.push('Building Damage');
  if (result.buildingHits.length === 0) {
    lines.push('  None');
  } else {
    result.buildingHits.forEach(h => {
      const name = (GAME.buildings[h.key] && GAME.buildings[h.key].name) || h.key;
      lines.push('  ' + name + ': integrity ' + h.before + ' → ' + h.after);
    });
  }
  const body = lines.join('\n');

  if (!colony.mailbox) colony.mailbox = { messages: [], selectedTab: 'Inbox', selectedMessageId: null };
  if (!colony.mailbox.messages) colony.mailbox.messages = [];
  colony.mailbox.messages.unshift({
    id: 'def_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    tab: 'Defense',
    subject: 'Defense Report: Threat L' + lvl + (attack.retaliation ? ' (Retaliation)' : ''),
    body: body,
    time: Date.now(),
    isNew: true,
    type: 'combat_report_v2',
    data: {
      kind: 'npc_defense',
      threatLevel: lvl,
      retaliation: !!attack.retaliation,
      defended: result.defended,
      casualties: result.casualties,
      buildingDamage: result.buildingHits
    }
  });
  colony.mailbox.messages = colony.mailbox.messages.slice(0, 120);
}

module.exports = { scout, raid, scheduleIncomingAttack, tick, getTotalPower, getTotalDefense };
