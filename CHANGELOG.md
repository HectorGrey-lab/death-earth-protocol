# Dead Earth Protocol — Changelog & Fix History

## 2026-07-21 — Railway PostgreSQL + Full Client-Server Sync

### Milestone
Game is fully functional on Railway with persistent PostgreSQL storage. WebSocket colony_state, building upgrades, resources, map rendering all working end-to-end.

---

### Infrastructure

#### PostgreSQL database on Railway
- **Problem:** Server fell back to `server/data/db.json` because `DATABASE_URL` wasn't injected into the web service. Data wiped on every Railway restart.
- **Fix:** Added PostgreSQL service to Railway project → linked `DATABASE_URL` from Postgres to web service via Variables tab (`DATABASE_URL = ${{Postgres.DATABASE_URL}}`)
- **Schema:** `server/db-pg.js` — 2 tables:
  - `users` (username PK, password_hash, salt, token, colony JSONB, created_at)
  - `universe` (single row, state JSONB containing galaxies/sectors/planets)
- **Tables created automatically** on server startup via `CREATE TABLE IF NOT EXISTS`

---

### Critical Bug Fixes

#### 1. `Network.on()` silently drops callbacks for new event types
- **File:** `js/network.js`
- **Symptoms:** Game loaded but showed empty resources, no map, couldn't upgrade buildings. WebSocket connected but colony_state/build_result never processed.
- **Root cause:** The `listeners` object only pre-registered 6 event types (`presence`, `chat`, `system`, `auth_ok`, `auth_error`, `disconnect`). The `on()` function checked `if (listeners[event])` and silently skipped any event type not in this fixed set. All game action callbacks (`colony_state`, `build_result`, `train_result`, `research_result`, etc.) were registered but never stored.
- **Fix:** Changed `on()` to dynamically create listener arrays for any event type:
  ```js
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(callback);
  ```

#### 2. WebSocket switch statement had no default routing
- **File:** `js/network.js`
- **Root cause:** The `onmessage` handler used a `switch(msg.type)` that only handled 6 message types. All game messages fell through to an implicit default (no routing).
- **Fix:** Added `default: trigger(msg.type, msg);` so every message type is routed to its registered callbacks via `trigger()`.

#### 3. Building ID mismatch (client vs server)
- **File:** `js/systems/resources.js`
- **Symptoms:** Resources showed NaN, production rates broken.
- **Root cause:** The `getProductionRates` function referenced building IDs from the old single-player version (`extractor`, `solar`, `refinery`, `synthesizer`). The server's `game-data.json` uses different IDs (`metal_mine`, `crystal_mine`, `deuterium_mine`, `solar_plant`, `deuterium_tank`).
- **Fix:** Updated building ID references to match server's `game-data.json`.

#### 4. Shield stats NaN crash
- **File:** `js/systems/buildings.js` (`getShieldStats`)
- **Symptoms:** Shield panel crashed or showed NaN.
- **Root cause:** `state.buildings.shieldGenerator.level` and `state.research.levels.defense` could be `undefined` when data was incomplete.
- **Fix:** Added `|| 0` guards for both accessors.

#### 5. Image path typo
- **File:** `js/data.js` + asset rename
- **Problem:** Asset path referenced `communicatios-hub.svg` (missing 'n'), file was named correctly `communications-hub.svg`.
- **Fix:** Fixed the typo in `data.js` and renamed the asset file.

#### 6. Planet map rendering — missing features
- **File:** `js/ui/ui-map.js`
- **Symptoms:** Other players' planets invisible on the map. No home planet marker.
- **Root cause:** Map rendering only checked for `isPlayerBase` property; server sends `colonizedBy` instead. No home planet marker utility existed.
- **Fix:** Added `colonizedBy` rendering for other players' bases. Added `GalaxySystem.markHomePlanet()` and `GalaxySystem.ensureTypeName()` helpers. Wired these into `app.js` colony_state handler.

#### 7. Server building init was incomplete
- **File:** `server/index.js` (`createInitialBuildings`)
- **Symptoms:** New players got only `commandCenter` building instead of all 9 building types.
- **Root cause:** The function had hardcoded dead code that only created one building type, instead of iterating `gameData.building` definitions.
- **Fix:** Replaced with a generic loop over all `gameData.building` keys, creating each at level 1 with integrity 100.

---

### Knowledge Base

#### Debugging WebSocket issues
After confirming server-side WebSocket works (via `node` + `ws` script), the client-side bug was narrowed to event routing. Pattern: **If server sends it but client doesn't process it, check the event registration code.**

#### Railway PostgreSQL setup
1. Add PostgreSQL service to project in Railway dashboard
2. Link `DATABASE_URL` to web service via Variables tab
3. Server must restart after variable is added (new deploy)
4. `DATABASE_URL` is cached at `require()` time — process restart required

#### Key design decisions
- Colony and universe state stored in JSONB columns (no complex JOINs)
- Server ticks every 2 seconds, saves state to PostgreSQL
- Client reconciles via WebSocket messages (colony_state, world_tick)
- No migration needed between JSON file and PostgreSQL — server auto-detects `DATABASE_URL`
