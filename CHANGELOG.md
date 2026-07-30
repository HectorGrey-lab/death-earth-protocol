# Dead Earth Protocol — Changelog & Fix History

## 2026-07-30 — Security Hardening (Input Validation & XSS Prevention)

### Milestone
Server-side HTML escaping, prototype pollution guard, input caps, and register validation. Client-side mailbox XSS fixed (defense in depth).

### Fixes

**XSS prevention** — `escapeHTML(str)` helper added to `server/index.js`, applied to:
- Chat messages (username + text)
- System join/leave/disconnect messages
- Alliance names, founders, member lists (`getAlliancesList()`)
- Private message subjects, bodies, sender/recipient names
- Mailbox client-side (`ui-mailbox.js`): added inline `esc()` for subject/body in preview

**Prototype pollution** — Alliance join rejects `__proto__`, `constructor`, and non-string IDs

**Train qty capped** at 9999 (was unbounded, infinite queue-item creation possible)

**Register validation** — Username trimmed, max 32 chars enforced, error message more specific

**Chat** still limited to 500 chars (unchanged); **private messages** already limited to 1000 chars

## 2026-07-30 — Game Loop & Systems Reliability

### Milestone
Fixed deterministic bugs in the server-side game loop and systems: troop queue only processed 1 item per tick, expeditions did 3-pass iteration, combat tick had mutating-while-iterating pattern and unsafe building key access. Optimized offline catch-up for combat spawns and tightened queue processing.

### What Changed

**`server/systems/troops.js` — Multi-drain queue**
- **Before**: Only `queue[0]` decremented per tick. After long offline (300s catch-up), a 50-item queue at 10s each took 100+ real seconds to fully drain (1 item per 2s tick).
- **After**: `while` loop drains all completed items in one tick. `dt` propagates through sequential queue items. A full queue caught up instantly.

**`server/systems/expeditions.js` — Single-pass queue**
- **Before**: 1× forEach decrement + 1× filter for completed + 1× filter for survivors = 3 full array passes per tick per player.
- **After**: Single forEach pass decrements, resolves completions inline, and collects survivors in one pass.

**`server/systems/combat.js` — Deterministic tick & safety**
- **Fixed mutating-while-iterating**: Random attack spawn (via `scheduleIncomingAttack`) now fires **before** the iteration over `incomingAttacks`, and due items are collected in a separate `alive` array instead of using `.filter()` after the loop.
- **Fixed offline catch-up spawn rate**: Random chance capped at `Math.min(1.0, ...)` so offline players returning after 5+ minutes don't get guaranteed attacks. Also uses `Math.min(dt, 60)` for chance calculation so the spawn probability stays reasonable even at dt=300s.
- **Safe building key check**: `resolveIncoming` now guards `colony.buildings[k]` with an `if` check before modifying integrity, preventing a crash if a building key was deleted.

### Files Changed
| File | Lines | Change |
|------|-------|--------|
| `server/systems/troops.js` | 17 | Multi-drain queue with while loop |
| `server/systems/expeditions.js` | 15 | Single-pass queue processing |
| `server/systems/combat.js` | 26 | Deterministic tick, spawn rate cap, safe key access |
| `CHANGELOG.md` | +24 | This entry |

### Test Steps
1. Queue 5+ troop training items, kill server and restart — observe all completed items resolved instantly on reconnect
2. Launch 3 expeditions simultaneously — verify all complete and reward independently
3. Stay offline 5+ minutes — rejoin, verify reasonable number of random attacks spawned (not guaranteed 6+)
4. Combat tick with building damage — no crashes regardless of building state

---

## 2026-07-30 — Network & Sync Robustness (v2)

### Milestone
Complete network resilience pass. Added client heartbeat, exponential backoff reconnect, request ID pairing, server-side idle timeout, and colony state sequence numbers.

### What Changed

**`js/network.js` — Complete Rewrite (v2)**
- **Heartbeat**: Client sends WS ping every 15s; if no pong within 10s, socket is closed and reconnection begins
- **Exponential backoff reconnect**: 1s → 2s → 4s → 8s → 16s → 30s (capped). Previous: fixed 5s
- **Request IDs + Callback pattern**: `Network.send(data, callback)` returns request ID; responses with matching `_reqId` resolve the callback directly (avoids race conditions)
- **Request timeout**: 30s timeout per pending request, auto-rejects on timeout
- **Reconnection events**: `Network.on('connecting', ...)` and `Network.on('reconnecting', ...)` for UI feedback
- **Cleanup on disconnect**: All pending callbacks are rejected with "Connection lost" to prevent stale handlers
- `Network.build()`, `Network.train()` now accept optional callbacks
- `Network.isConnected` property and `Network.reconnectAttempt` counter
- **No more `_setupGameHandlers()` dead function**

**`js/app.js` — Reconnection Flow**
- **Reconnection UI**: `connecting` event shows "⟳ Reconnecting… attempt N" with orange bar; `auth_ok` shows "✅ Reconnected" in green, auto-hides after 2s
- **Reduced `get_colony` frequency**: From every 5 ticks (10s) to every 15 ticks (30s), since individual action results update independently
- **Auto `get_colony` on reconnect**: Ensures fresh state after connection is re-established
- `disconnect` handler simplified to use the new HTML element

**`server/index.js` — Request ID Echo + Idle Timeout**
- **`reply(socket, data, reqId)` helper**: Attaches `_reqId` from client message to every response. All 26 message handler `socket.write(wsEncodeFrame(...))` calls replaced
- **Idle timeout**: 120s inactivity = socket closed + cleanup. Resets on every data frame
- **Sequence numbers**: `colonySeq` increments on every state-changing operation (build, train, research, scout, raid); included as `seq` in `colony_state` responses
- **Cleanup on close**: Idle timeout cleared on socket close

### Files Changed
| File | Lines | Change |
|------|-------|--------|
| `js/network.js` | 354 | Complete rewrite: heartbeat, backoff, request IDs, callbacks |
| `js/app.js` | 42 | Reconnection flow, reduced get_colony, auto-refresh |
| `server/index.js` | 121 | `reply()` helper, idle timeout, seq numbers, all handlers updated |
| `CHANGELOG.md` | +28 | This entry |

### Test Steps
1. Start server, connect client — verify normal auth flow
2. Kill server — observe "⟳ Reconnecting…" with increasing delays (1s, 2s, 4s...)
3. Restart server — observe "✅ Reconnected" auto-refresh
4. Build/train — verify response arrives with `_reqId` matching request
5. Let connection idle 2+ minutes — verify idle timeout disconnects

---

## 2026-07-30 — Mobile Responsiveness Overhaul

### Milestone
Complete mobile responsiveness pass for the game dashboard. Consolidated duplicate CSS, added touch-friendly sizing, collapsible sidebar panels, sticky nav, and accessibility improvements.

### Changes

#### CSS — `css/styles.css`
- **Fixed `.building-visual` missing closing brace** (line 1134): The block was accidentally left open, causing `#authOverlay` and everything after to be nested inside `.building-visual`. Added `}` to close it properly.
- **Removed duplicate media query blocks**: The file had 3× 768px blocks and 2× 480px blocks. Kept only one per breakpoint, merged missing rules from the removed blocks into the remaining ones.
- **Touch target sizing**: Added `min-height: 44px` and `min-width: 44px` to nav buttons and action buttons at both 768px and 480px breakpoints to meet WCAG/Apple touch guidelines.
- **Sticky nav**: `.command-nav` now uses `position: sticky; top: 0; z-index: 10` on mobile so the navigation stays accessible while scrolling.
- **Map touch improvements**: Added `touch-action: none` to `.map-surface` at 768px to prevent browser gesture conflicts when dragging the map.
- **Building visuals**: Changed from `display: none` (hidden entirely) to `max-width: 60px` (768px) / `max-width: 48px` (480px) so building icons still show on mobile.
- **New CSS classes**:
  - `.connection-status` — fixed-position notification bar styled via CSS instead of inline styles
  - `.collapsible-header` / `.collapsible-body` — accordion toggle pattern for mobile sidebar panels
- **Modal overlay**: Added `overscroll-behavior: contain; -webkit-overflow-scrolling: touch;` to prevent background scrolling while modal is open.
- **Galaxy node sizes** preserved from removed blocks at both breakpoints.
- **320+ lines of dead duplicate CSS removed** (file reduced from 1869 to 1565 lines).

#### HTML — `game.html`
- Added `role="navigation"` and `aria-label="Command Navigation"` to command nav
- Added `aria-label` attributes to all nav buttons for screen reader support
- Added `role="region"` and `aria-live="polite"` to `#pageContent` so dynamic updates are announced by screen readers
- Added declarative `<div id="connectionStatus" class="connection-status hidden">` element instead of creating it dynamically in JS

#### JavaScript — `js/ui/ui-core.js`
- Added `isMobile()` helper (`window.innerWidth < 768`)
- Added `initCollapsiblePanels()` — wraps sidebar panel content into `.collapsible-body` divs on mobile, sets up click-to-toggle on panel titles. Resources panel stays open by default; Shield, Queue, and System Log start collapsed.
- Added `showConnectionStatus(text, type)` and `hideConnectionStatus()` — uses the new HTML element + CSS classes instead of inline styles
- `renderAll()` now auto-calls `initCollapsiblePanels()` after each full render
- Exposed new functions in the return object

#### JavaScript — `js/app.js`
- Updated disconnect handler to use the declarative `#connectionStatus` element with CSS class toggling instead of creating a dynamic div with inline styles. Falls back to dynamic creation if the element is missing.

### How to Test
1. Open the game on a phone/tablet viewport (< 768px wide)
2. Verify: nav sticks to top while scrolling, sidebar panels collapse/expand on title tap
3. Verify: building images are visible (small thumbnails) instead of hidden
4. Verify: all buttons are comfortably tappable (not tiny)
5. Open map view on mobile — verify drag works smoothly without page scroll interference
6. Open a modal — verify background doesn't scroll
7. Disconnect from server — verify connection status bar appears at bottom

---

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
