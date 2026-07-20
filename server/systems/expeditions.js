/**
 * expeditions.js — Server-side expedition system
 */
const GAME = require('../game-data.json');

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function chance(prob) {
  return Math.random() < prob;
}

function launch(colony, nodeId) {
  // Calculate duration based on Trade Pod Terminal level
  const threatLevel = parseInt(nodeId.replace(/[^0-9]/g, '').slice(-1)) || 1;
  const duration = Math.max(25, 70 - (colony.buildings.tradePodTerminal.level || 0) * 4 + threatLevel * 6);

  if (!colony.expeditions) colony.expeditions = { active: null, completed: [], queue: [] };
  colony.expeditions.queue.push({
    id: 'exp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    nodeId: nodeId,
    remaining: duration,
    totalDuration: duration,
    returnsAt: Date.now() + duration * 1000
  });

  return { ok: true, message: 'Expedition launched. ETA ' + duration + 's' };
}

function resolveRewards(colony, expedition) {
  const level = colony.buildings.tradePodTerminal.level || 0;
  const base = 1 + (level - 1) * 0.15;

  const rewards = {
    ore: Math.floor(rand(40, 85) * base),
    solar: Math.floor(rand(25, 60) * base),
    crystal: Math.floor(rand(18, 45) * base),
    isotopes: Math.floor(rand(10, 24) * base)
  };

  // Grant resources
  Object.keys(rewards).forEach(k => {
    if (colony.resources[k]) {
      colony.resources[k].amount = Math.min(colony.resources[k].cap, colony.resources[k].amount + rewards[k]);
    }
  });

  // Artifact chance
  let artifactFound = null;
  const artifactChance = 0.1 + (level - 1) * 0.04;
  if (chance(artifactChance)) {
    const artifacts = [
      { id: 'quantum-shard', name: 'Quantum Shard', rarity: 'Rare' },
      { id: 'void-core', name: 'Void Core', rarity: 'Epic' },
      { id: 'relay-spindle', name: 'Relay Spindle', rarity: 'Common' },
      { id: 'exo-plating', name: 'Exo Plating', rarity: 'Uncommon' },
      { id: 'sun-sigil', name: 'Sun Sigil', rarity: 'Rare' }
    ];
    artifactFound = artifacts[Math.floor(Math.random() * artifacts.length)];
    if (!colony.inventory) colony.inventory = { artifacts: [] };
    colony.inventory.artifacts.push({
      id: 'artifact-' + Date.now(),
      templateId: artifactFound.id,
      foundAt: Date.now()
    });
  }

  return { rewards: rewards, artifact: artifactFound };
}

function tick(colony, dt) {
  if (!colony.expeditions || !colony.expeditions.queue) return;
  colony.expeditions.queue.forEach(item => { item.remaining -= dt; });
  const completed = colony.expeditions.queue.filter(item => item.remaining <= 0);
  completed.forEach(item => {
    resolveRewards(colony, item);
  });
  colony.expeditions.queue = colony.expeditions.queue.filter(item => item.remaining > 0);
}

module.exports = { launch, resolveRewards, tick };
