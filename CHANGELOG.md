# CHANGELOG — Dead Earth Protocol Online Migration

All changes made to transform the prototype into a fully online, multiplayer-ready game.

---

## Phase 1: Critical Bug Fixes

### 1.1 Fixed Field Name Mismatches — `js/network.js`
**Problem**: The client and server used different field names for the same data, breaking build/train/chat.
- `Network.build()` sent `buildingKey` but server expected `buildingId` → Fixed to send `buildingId`
- `Network.train()` sent `troopKey` but server expected `troopId` → Fixed to send `troopId`
- `Network.sendChat()` sent `message` but server expected `text` → Fixed to send `text`

### 1.2 Fixed Client Game Loop — `js/app.js`
**Problem**: The `world_tick` event from the server was not handled, so resources never auto-refreshed.
- Added `world_tick` listener that re-renders the UI and periodically requests fresh colony state
- Added handlers for `research_result`, `scout_result`, `raid_result`, `expedition_result`, `exchange_result`, `buy_artifact_result`

### 1.3 Fixed Troop Image Paths — `js/data.js`
**Problem**: Troop images referenced `assets/troops/` but the actual SVG files were at `assets/buildings/troops/`.
- Changed all 10 troop image paths from `assets/troops/*.svg` → `assets/buildings/troops/*.svg`

### 1.4 Removed Save/Reset Buttons — `game.html`
**Problem**: Game-state save/reset buttons used localStorage — no longer needed since all state is server-authoritative.
- Removed the "Save Control" panel with Manual Save and Reset Save buttons

---

## Phase 2: Server-Side Game Systems (New)

### 2.1 Server Research System — `server/systems/research.js` (NEW)
- Handles research initiation, cost calculation, duration, and completion
- Supports three research categories: Economy, Military, Defense
- Research Lab building level reduces research time (8% per level)
- Ticks on server, completes automatically

### 2.2 Server Combat System — `server/systems/combat.js` (NEW)
- **Scout**: Generates enemy intel based on threat level, influenced by Radar Array level
- **Raid**: Resolves battle using troop counts, traits, and research bonuses
  - Casualties calculated per unit type
  - Loot awarded on success (capped by storage)
  - Retaliation attacks scheduled dynamically
- **Defense**: Incoming attacks resolved based on total defense power
  - Building integrity can be damaged on failed defense
  - Random attacks spawned with increasing difficulty
- Full troop tracking: traits (scout, siege, shieldBreak, supportShield) factored into combat

### 2.3 Server Expedition System — `server/systems/expeditions.js` (NEW)
- Launch expeditions to map nodes with ETA based on Trade Pod Terminal level
- Rewards resources on completion with scaling based on terminal level
- 10%+ chance to find artifacts on return

### 2.4 Server Market System — `server/systems/market.js` (NEW)
- Resource exchange with rate modifier based on Market Nexus level
- Artifact purchasing from predefined listings
- Transaction history tracking

### 2.5 Server Integration — `server/index.js` (REWRITTEN)
- Integrated all new game systems as WebSocket handlers
- Added WebSocket message types: `research`, `scout`, `raid`, `expedition`, `exchange`, `buy_artifact`
- Each handler validates input, calls system function, saves to disk, and returns updated colony state
- Unified DB management (no split between db.js and inline code)
- Proper error handling with specific error messages

### 2.6 Game Loop Update — `server/game-loop.js` (REWRITTEN)
- Ticks all systems: resources, buildings, troops, research, combat, expeditions
- Auto-saves every 10 ticks using passed save callback (fixed dual-db copy bug)
- Sends `world_tick` broadcast to all connected clients

---

## Phase 3: Data Cleanup & UI Fixes

### 3.1 Database Cleanup
- **Deleted**: `data/db.json` — old root-level test data with `hector`, `player2`, `finaltest` accounts
- **Created**: `server/data/db.json` — clean empty database (new players only)
- **Updated**: `.gitignore` to cover both old and new db.json paths

### 3.2 Client UI Wired to Server
- **`ui-research.js`**: Research buttons now send `Network.send({type:'research', category:...})` instead of calling local `ResearchSystem.startResearch()`
- **`ui-map.js`**: Scout, Raid, and Expedition buttons now send WebSocket messages instead of calling local `CombatSystem`/`ExpeditionSystem` functions
- **`ui-market.js`**: Buy artifact and exchange buttons now send WebSocket messages instead of calling local `MarketSystem`

### 3.3 Property Cleanup
- **`.gitignore`**: Now ignores `data/db.json`, `server/data/db.json`, and `server/data/` directory

---

## Phase 4: Reliability & Testing

### 4.1 Server Persistence
- All game state persisted to `server/data/db.json`
- Auto-save every 20 seconds (10 ticks × 2s)
- Save-on-action for every WebSocket operation

### 4.2 API Endpoints Tested ✓
| Test | Result |
|------|--------|
| Register new user | ✓ Token + planet allocation |
| Login with correct password | ✓ Token returned |
| Login with wrong password | ✓ Blocked with error |
| Duplicate registration | ✓ Blocked with error |
| Health check | ✓ Returns uptime + player count |

### 4.3 What Still Has Local-Only Logic
These client systems still have display-only functions (cost calculation, profile rendering) that don't affect game state:
- Client-side `ResearchSystem` — `getResearchCost()` and `getResearchDuration()` still used for UI display
- Client-side `CombatSystem` — `generateEnemyProfile()` still used for UI previews
- Client-side `MarketSystem` — `getRateModifier()` still used for display
- Client-side `MapSystem` — map rendering logic

These are harmless — they're essentially UI formatting helpers.

---

## Architecture Summary

```
client/browser                    server (Node.js)
├── login.html  ──POST──►        ├── /api/register
├── game.html                     ├── /api/login
├── js/network.js  ◄─WebSocket─► ├── /api/health
│   ├── auth                      │
│   ├── build                     ├── ws: chat
│   ├── train                     ├── ws: build → BuildingSystem
│   ├── research                  ├── ws: train → TroopSystem
│   ├── scout                     ├── ws: research → ResearchSystem
│   ├── raid                      ├── ws: scout/raid → CombatSystem
│   ├── expedition                ├── ws: expedition → ExpeditionSystem
│   ├── exchange                  ├── ws: exchange/buy_artifact → MarketSystem
│   └── buy_artifact              │
│                                 ├── GameLoop (every 2s)
│                                 │   ├── Resources
│                                 │   ├── Buildings
│                                 │   ├── Troops
│                                 │   ├── Research
│                                 │   ├── Combat
│                                 │   └── Expeditions
│                                 └── server/data/db.json
```

## Railway Deployment
- **Procfile**: `web: node server/index.js` (unchanged)
- **package.json start**: `node server/index.js` (unchanged)
- **PORT**: Uses `process.env.PORT || 3000` (Railway-compatible)
- **Dependencies**: Zero npm packages — pure Node.js stdlib
- **Persistent data**: Railway's ephemeral storage resets on deploy. Players are preserved within a deployment's lifetime.
