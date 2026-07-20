/**
 * market.js — Server-side market system (exchange, buy artifact)
 */
const GAME = require('../game-data.json');

function getRateModifier(colony) {
  const lvl = colony.buildings.marketNexus.level || 0;
  return 1 - (lvl - 1) * 0.04;
}

function exchange(colony, fromKey, toKey, amount) {
  amount = Math.max(10, parseInt(amount, 10) || 0);
  if (fromKey === toKey) return { ok: false, reason: 'Invalid pair' };
  if (!colony.resources[fromKey] || colony.resources[fromKey].amount < amount) {
    return { ok: false, reason: 'Insufficient source resource' };
  }

  const mod = getRateModifier(colony);
  const gain = Math.floor(amount * 0.72 / mod);
  colony.resources[fromKey].amount -= amount;
  colony.resources[toKey].amount = Math.min(colony.resources[toKey].cap, colony.resources[toKey].amount + gain);

  // Track transaction
  if (!colony.market) colony.market = { transactions: [], listings: [] };
  const line = 'Exchanged ' + amount + ' ' + GAME.resources[fromKey].name + ' for ' + gain + ' ' + GAME.resources[toKey].name + '.';
  colony.market.transactions.unshift({ id: 'tx-' + Date.now(), text: line, time: Date.now() });
  colony.market.transactions = colony.market.transactions.slice(0, 20);

  return { ok: true, message: line };
}

function buyArtifact(colony, listingId) {
  // Find listing from game data
  const listings = [
    { id: 'm1', artifactId: 'relay-spindle', price: { ore: 100, solar: 70, crystal: 20, isotopes: 8 } },
    { id: 'm2', artifactId: 'exo-plating', price: { ore: 140, solar: 80, crystal: 40, isotopes: 12 } },
    { id: 'm3', artifactId: 'quantum-shard', price: { ore: 180, solar: 120, crystal: 70, isotopes: 18 } },
    { id: 'm4', artifactId: 'sun-sigil', price: { ore: 220, solar: 160, crystal: 80, isotopes: 20 } }
  ];
  const listing = listings.find(l => l.id === listingId);
  if (!listing) return { ok: false, reason: 'Listing not found' };

  // Check and pay cost
  for (const k of Object.keys(listing.price)) {
    if ((colony.resources[k]?.amount || 0) < listing.price[k]) {
      return { ok: false, reason: 'Insufficient ' + k };
    }
  }
  for (const k of Object.keys(listing.price)) {
    colony.resources[k].amount -= listing.price[k];
  }

  // Add artifact to inventory
  if (!colony.inventory) colony.inventory = { artifacts: [] };
  colony.inventory.artifacts.push({
    id: 'artifact-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    templateId: listing.artifactId,
    foundAt: Date.now()
  });

  // Track transaction
  if (!colony.market) colony.market = { transactions: [], listings: [] };
  const artName = listing.artifactId.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  const text = 'Purchased artifact ' + artName + '.';
  colony.market.transactions.unshift({ id: 'tx-' + Date.now(), text: text, time: Date.now() });
  colony.market.transactions = colony.market.transactions.slice(0, 20);

  return { ok: true, message: text };
}

module.exports = { exchange, buyArtifact, getRateModifier };
