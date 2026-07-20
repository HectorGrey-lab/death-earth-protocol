/**
 * troops.js — Server-side troop training
 */

const GAME = require('../game-data.json');

function getTrainingSpeedMult(colony) {
  const lvl = colony.buildings.trainingFacility.level || 0;
  return 1 + (lvl - 1) * 0.15;
}

function queueTrain(colony, troopKey, qty) {
  qty = Math.max(1, parseInt(qty, 10) || 1);
  const def = GAME.troops[troopKey];
  if (!def) return { ok: false, reason: 'Unknown troop type' };
  // Calculate cost for qty
  const cost = {};
  Object.keys(def.cost).forEach(k => {
    cost[k] = def.cost[k] * qty;
  });
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
  colony.troops.queue.push({
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    troopKey,
    qty,
    remaining: Math.floor(def.trainTime * qty / getTrainingSpeedMult(colony))
  });
  return { ok: true, message: def.name + ' x' + qty + ' queued' };
}

function tick(colony, dt) {
  const queue = colony.troops.queue;
  if (!queue.length) return;
  const item = queue[0];
  item.remaining -= dt;
  if (item.remaining <= 0) {
    colony.troops.counts[item.troopKey] = (colony.troops.counts[item.troopKey] || 0) + item.qty;
    queue.shift();
  }
}

module.exports = { getTrainingSpeedMult, queueTrain, tick };
