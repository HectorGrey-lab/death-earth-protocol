# Dead Earth Protocol — Master Roadmap

## 📋 Project Overview
Dead Earth Protocol is a single-player dark sci-fi strategy dashboard (HTML/CSS/JS). This roadmap breaks down how to evolve it into an **online multiplayer Galactic Conquest game** — starting with core structural upgrades and progressively adding features.

---

## PHASE 0: Codebase Audit & Architecture (Estimated: 1-2 sessions)
**Goal:** Deep understanding and structural documentation before any changes.

- [ ] Create architecture reference doc (module dependency graph, data flow, state shape)
- [ ] Map all system interdependencies (who calls whom, shared globals)
- [ ] Identify global naming conflicts / implicit coupling
- [ ] Document the tick system flow (App.gameLoop → processTick → per-system tick → render)
- [ ] Check for browser compatibility issues (ES6/7 features used)
- [ ] Create a dev/test plan (how to verify nothing breaks per phase)

---

## PHASE 1: Local Multi-Colony Expansion (Estimated: 2-3 sessions)
**Goal:** Player can have multiple colonies on the tactical map, switching between them.

### 1A — Multi-Colony State
- [ ] Add `colonies: []` array to GameState (each with own buildings, troops, resources, map position)
- [ ] Migrate `window.gameState` singleton to support active colony switching
- [ ] Add `activeColonyIndex` to state
- [ ] Create colony management system (createColony, switchColony, abandonColony)
- [ ] Update normalizeState to handle colonies (backward-compatible)
- [ ] Add `/colonize` console command or UI button

### 1B — Save/Load Expansion
- [ ] Save/load all colonies with per-colony state
- [ ] Auto-switch to correct colony on load
- [ ] Add conflict resolution (what if colony's map node doesn't exist anymore?)

### 1C — Colony UI
- [ ] Add colony selector dropdown to left sidebar
- [ ] Show per-colony resources/buildings/troops when active
- [ ] Add "Colony" tab to nav

---

## PHASE 2: Universe System — Galaxy / Sector / Planet (Estimated: 3-4 sessions)
**Goal:** Replace the flat 7-node map with a procedural universe → galaxy → sector → planet hierarchy.

### 2A — Procedural Universe Engine
- [ ] Create `js/universe.js` — seed-based procedural generation
  - [ ] `NUM_GALAXIES` (9 in 3×3 grid)
  - [ ] `SECTORS_PER_GALAXY` (15, reusing existing tactical regions)
  - [ ] `PLANETS_PER_SECTOR` (30-50 procedural)
  - [ ] Coordinate system: galaxy=1000u, sector=100u, planet=10u spacing
  - [ ] Deterministic seed for multiplayer consistency
- [ ] Generate planet names, types (barren, gas, forest, ocean, volcanic)
- [ ] Assign resource bonuses per planet type

### 2B — Galaxy/Sector/Planet Map View
- [ ] New "Galaxy Map" page (separate from the tactical node map)
- [ ] Implement 3 zoom layers: Universe → Galaxy → Sector
- [ ] Galaxy view: glowing galaxy clusters at universe coordinates
- [ ] Sector view: 15 sectors with labels, connections
- [ ] Planet view: procedural planet dots, selectable
- [ ] Click drill-down: galaxy → sector → planet
- [ ] Press R/Zoom-out to go back up
- [ ] Integrate with colony system: player's colony visible on galaxy map

### 2C — Convert Existing Tactical Map to Sector-Level
- [ ] The current node map becomes the "Sector Detail" view
- [ ] Player's current sector's nodes are rendered like today
- [ ] Navigation: Galaxy Map → click sector → opens current tactical map for that sector
- [ ] Update node generation to be per-sector (not global 7 nodes)

---

## PHASE 3: Travel & Expedition System Overhaul (Estimated: 1-2 sessions)
**Goal:** Distance-based travel times between planets/sectors/galaxies.

- [ ] Calculate distance-based travel time using universe coordinates
  - [ ] Within sector (planet-to-planet): 40-60 seconds
  - [ ] Cross-sector (within galaxy): 5-15 minutes
  - [ ] Cross-galaxy: 1-4 hours (warp gates reduce to 10 min)
- [ ] Animate fleet movement on galaxy map (like current tactical trails but scaled)
- [ ] Add warp gate infrastructure (can be built, connects galaxies)
- [ ] Update expedition system to use distance-based times
- [ ] Add travel queue UI showing ETA

---

## PHASE 4: Online Backend — Node.js + WebSocket (Estimated: 5-8 sessions)
**Goal:** Players can see each other, trade, and raid across the galaxy.

### 4A — Minimal Backend
- [ ] Create `/server/` directory with Node.js + Express + ws
- [ ] Set up project: `package.json`, `npm init`
- [ ] WebSocket server with rooms (galaxy-based sharding)
- [ ] Simple REST API for auth and data sync

### 4B — Authentication
- [ ] Username + password (bcrypt hashed)
- [ ] Session tokens (JWT)
- [ ] Registration via POST /api/register
- [ ] Save/load player state from server (JSON column or MongoDB)

### 4C — Real-Time Sync
- [ ] WebSocket messages for:
  - [ ] Player position (galaxy/sector/planet)
  - [ ] Colony state changes (buildings, troops, resources)
  - [ ] Scout reports (real enemy data instead of generated)
  - [ ] Raid requests and resolutions
  - [ ] Chat / alliance communication
- [ ] Server-side game loop (tick every 1s, process all active players)
- [ ] Dedicated game loop for combat resolution

### 4D — Data Persistence
- [ ] SQLite (MVP) or PostgreSQL (production)
- [ ] Tables: users, colonies, buildings, troops, expeditions, combat, market_orders
- [ ] Player colony location = galaxy + sector + planet coordinates
- [ ] Index coordinates for spatial queries (find players near me)

---

## PHASE 5: Multiplayer Gameplay Features (Estimated: 3-4 sessions)
**Goal:** Players can interact meaningfully.

- [ ] **Visible players**: Show other players in same sector on tactical map
- [ ] **Real raids**: Send troops to another player's colony
  - [ ] Calculate defender bonuses (shield, bunker, defense troops)
  - [ ] Raid report sent to both parties
- [ ] **Colony hiding / scouting**: Planets show as "Unknown" until scouted
  - [ ] Scout mission reveals player presence
  - [ ] Intel economy: scouting costs resources
- [ ] **Alliance system expansion**: Shared vision, joint raids, alliance-controlled sectors
- [ ] **Market P2P**: Players can trade resources at faction relays
- [ ] **Leaderboards**: Base power, military strength, alliance dominance

---

## PHASE 6: Content Expansion (Estimated: 2-3 sessions)
**Goal:** More content, depth, and replayability.

- [ ] New building types (shipyard, hangar, starport)
- [ ] Ship system (interstellar vessels separate from ground troops)
- [ ] More research categories (warp drive, colony management, stealth)
- [ ] Artifact crafting (combine artifacts → powerful bonuses)
- [ ] Events that affect entire galaxies
- [ ] NPC factions with procedural diplomacy
- [ ] Missions that span galaxies

---

## PHASE 7: Polish & Balance (Estimated: 2-3 sessions)
**Goal:** A game that's fun to play online.

- [ ] UI polishing (responsive on tablet, accessibility)
- [ ] Audio (ambient, UI sounds, alerts)
- [ ] Animations (scout fleet travel, combat, building upgrade)
- [ ] Balance pass: resource rates, build times, combat formulas
- [ ] Performance optimization (render only visible layers, batch DOM updates)
- [ ] Error handling (connection lost, state conflicts, cheating detection)
- [ ] Tutorial / onboarding flow for new players

---

## ⚡ Recommended Starting Point

Since you're already asking about galaxy/sector/planet and online, I'd recommend starting with:

1. **PHASE 2A** (Universe Engine) + **PHASE 2B** (Galaxy Map) as one combined push — this is the visual centerpiece
2. Then **PHASE 4A** (Minimal Backend) — get a sign-up flow and server
3. Then **PHASE 5** (Multiplayer Features) — real player interaction

---

## 🤝 How I Work
I'll tackle one checkbox at a time, commit changes, and verify before moving on. Each session I'll:
1. Brief you on what I'm about to do
2. Do it (real code changes, tested)
3. Report what changed and what's next
