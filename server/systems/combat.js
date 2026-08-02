/**
 * combat.js — Server-side combat system (scouting, raids, incoming attacks, defense)
 */
const GAME = require('../game-data.json');

// ─── NPC attack tuning (env-tunable, see README/changelog) ───
function clampNumber(val, def, min, max) {
  const n = parseFloat(val);
  if (isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}
const NPC_ATTACKS_PER_HOUR = clampNumber(process.env.NPC_ATTACKS_PER_HOUR, 0.8, 0, 10);
const NPC_ATTACK_COOLDOWN_SEC = clampNumber(process.env.NPC_ATTACK_COOLDOWN_SEC, 1800, 0, 86400); // default 30m
const NPC_DEFENSE_MAIL_MODE = process.env.NPC_DEFENSE_MAIL_MODE || 'important'; // 'all' | 'important'
const NPC_DEFENSE_MAIL_MAX = 25; // keep only this many npc_defense messages in the Defense tab

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

  // Maybe schedule retaliation attack (nerfed: was 0.2 + threat*0.08 + 0.1, now ~0.06-0.13)
  const retaliationChance = 0.06 + threatLevel * 0.04 + (success ? 0.03 : 0);
  if (chance(retaliationChance) && canNpcAttack(colony)) {
    markNpcAttack(colony);
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

function canNpcAttack(colony) {
  if (!colony.combat) return true;
  const last = colony.combat.lastNpcAttackAt || 0;
  return (Date.now() - last) >= NPC_ATTACK_COOLDOWN_SEC * 1000;
}

function markNpcAttack(colony) {
  if (!colony.combat) colony.combat = {};
  colony.combat.lastNpcAttackAt = Date.now();
}

function pruneNpcDefenseMail(colony) {
  if (!colony.mailbox || !Array.isArray(colony.mailbox.messages)) return;
  // Keep only the newest NPC_DEFENSE_MAIL_MAX npc_defense messages in the Defense tab
  const npcDefIdx = [];
  colony.mailbox.messages.forEach((m, i) => {
    if (m && m.data && m.data.kind === 'npc_defense') npcDefIdx.push(i);
  });
  if (npcDefIdx.length > NPC_DEFENSE_MAIL_MAX) {
    // messages are newest-first, so npcDefIdx is ordered newest→oldest:
    // drop everything beyond the newest NPC_DEFENSE_MAIL_MAX
    const toDrop = new Set(npcDefIdx.slice(NPC_DEFENSE_MAIL_MAX));
    colony.mailbox.messages = colony.mailbox.messages.filter((m, i) => !toDrop.has(i));
  }
}

function addColonyLog(colony, text) {
  if (!colony.log) colony.log = [];
  colony.log.unshift({ text: text, time: Date.now() });
  colony.log = colony.log.slice(0, 40);
}

function tick(colony, dt) {
  if (!colony.combat) return;
  if (!colony.combat.incomingAttacks) return;

  // One-time cleanup: prune old NPC defense mail spam (spec F)
  if (!colony.combat._defenseMailPruned) {
    colony.combat._defenseMailPruned = true;
    pruneNpcDefenseMail(colony);
  }

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
  if (!canNpcAttack(colony)) return; // per-colony cooldown — no machine-gunning

  // Rate-based chance: ~0.8 NPC attacks/hour by default (was 0.01/dt ~= 36/hour)
  const dtSafe = dt > 10 ? Math.min(dt, 60) : dt;
  const perSec = NPC_ATTACKS_PER_HOUR / 3600;
  let baseChance = perSec * dtSafe;
  // Radar reduces chance multiplicatively (lvl 1 = no reduction, lvl 5 = ~35% floor)
  const radarLvl = (colony.buildings && colony.buildings.radarArray && colony.buildings.radarArray.level) || 0;
  const radarFactor = Math.min(1, Math.max(0.35, 1 - (radarLvl - 1) * 0.08));
  let finalChance = baseChance * radarFactor;
  // Cap to avoid guaranteed spawns on dt spikes
  finalChance = Math.min(0.25, finalChance);
  if (chance(finalChance)) {
    markNpcAttack(colony);
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

  // ── Defense mail spam reduction (spec E) ──
  // 'important' mode: only mail when not defended, or threat >= 3, or retaliation.
  // Otherwise drop the mail and log a brief system entry so the player still sees it.
  const isImportant = !result.defended || lvl >= 3 || !!attack.retaliation;
  if (NPC_DEFENSE_MAIL_MODE === 'important' && !isImportant) {
    addColonyLog(colony, '🛡 NPC raid repelled — Threat L' + lvl + ', no casualties.');
    pruneNpcDefenseMail(colony);
    return;
  }

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
  pruneNpcDefenseMail(colony);
}

module.exports = {
  scout, raid, scheduleIncomingAttack, tick, getTotalPower, getTotalDefense,
  canNpcAttack, markNpcAttack, pruneNpcDefenseMail, addColonyLog,
  clampNumber, NPC_ATTACKS_PER_HOUR, NPC_ATTACK_COOLDOWN_SEC, NPC_DEFENSE_MAIL_MODE
};
