/**
 * game-loop.js — Server world tick loop
 * Ticks every 2 seconds for all online players.
 */

const ResourceSystem = require('./systems/resources');
const BuildingSystem = require('./systems/buildings');
const TroopSystem = require('./systems/troops');

const TICK_INTERVAL = 2; // seconds
const SAVE_INTERVAL = 10; // auto-save every 10 ticks

let tickCount = 0;
let intervalHandle = null;

function tickAllPlayers(db, wsServer) {
  tickCount++;
  const now = Date.now();
  const usernameSet = new Set();

  Object.keys(db.users).forEach(username => {
    const user = db.users[username];
    if (!user.colony) return;
    usernameSet.add(username);

    // Calculate delta time since last tick (capped at 300s for offline catch-up)
    const elapsed = Math.min(300, (now - (user.colony.lastTick || now)) / 1000);
    if (elapsed < 1) return;
    user.colony.lastTick = now;

    // Tick resource production first
    ResourceSystem.tick(user.colony, elapsed);

    // Tick building construction
    BuildingSystem.tick(user.colony, elapsed);

    // Tick troop training
    TroopSystem.tick(user.colony, elapsed);
  });

  // Auto-save periodically
  if (tickCount % SAVE_INTERVAL === 0) {
    const Database = require('./db');
    Database.saveDB();
  }

  // Send state updates to connected clients
  if (wsServer && wsServer.broadcast) {
    wsServer.broadcast({ type: 'world_tick' });
  }
}

function startLoop(db, wsServer) {
  if (intervalHandle) return;
  console.log('  [Tick] World loop started (every ' + TICK_INTERVAL + 's)');
  intervalHandle = setInterval(() => {
    tickAllPlayers(db, wsServer);
  }, TICK_INTERVAL * 1000);
}

function stopLoop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

module.exports = { startLoop, stopLoop, tickAllPlayers };
