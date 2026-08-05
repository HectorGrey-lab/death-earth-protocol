# Dead Earth Protocol — Changelog & Fix History

## 2026-08-05 — Mobile UI Cleanup + Options Tab (Help, Logout, Edit Profile, Delete Account)

### Milestone
The HUD no longer clutters non-Command pages on mobile, and a new Options tab centralises account self-service: Starter Guide/Help accordion, logout with token invalidation, profile editing (display name + base name), and full account deletion with a typed-confirmation gate. Display names propagate through chat, PMs, and the leaderboard.

### Phase 1 — Options nav tab + routing (client)
- `game.html` — new `nav-btn[data-page="options"]` after Leaderboard; `ui-options.js` script loaded before `app.js`
- `js/ui/ui-core.js` — `options` page in `PAGE_META`, router case delegating to `UIOptions.render()/bind()`, `body[data-page]` attribute set in `renderAll`

### Phase 2 — Mobile HUD hiding (CSS)
- `css/styles.css` `@media (max-width: 720px)` — `.hud-shield/.hud-queue/.hud-systemlog/.hud-relay` hidden unless `body[data-page="home"]`; sidebar panels reflow to a single column; Command page keeps the full HUD

### Phase 3 — Help / Starter Guide accordion (client)
- `js/ui/ui-options.js` — collapsible accordion rendered from `window.GameData.helpSections` (pushed with `colony_state.gamedata`); first-run / Help button opens it

### Phase 4 — Logout (client + server)
- Client sends `logout`, clears `de_token`/`de_username`, redirects to `/login`
- Server invalidates the session token (removes from token map), replies `logout_ok`, closes the socket

### Phase 5 — Edit Profile (client + server)
- `profile_update` WS message — validates display name (3–20 chars) and base name (3–24 chars) against `^[A-Za-z0-9 _-]+$`, collapses whitespace, enforces display-name uniqueness
- Persists `colony.profile {displayName, baseName}` + `colony.planetName`; replies fresh `colony_state`; modal UI in Options tab

### Phase 6 — Delete Account (client + server)
- Danger zone with `type DELETE` confirmation gate (client modal + server-side confirm check)
- Server: leaves/disbands alliance, unclaims owned planets (`colonizedBy: null`), cancels pending attacks, removes mailbox + chat history entries, deletes the user, saves, replies `delete_account_result`, closes socket
- Client clears storage and redirects to `/login`

### Phase 7 — Display-name propagation + mobile polish (client + server)
- Chat messages, PM subjects, leaderboard entries carry `displayName` (username as `title` tooltip); `ui-chat.js` `nameOf()` helper prefers display name
- Options mobile polish: single-column forms, 44px tap targets, centered confirm modal

### Fixes along the way
- `server/admin.js` — admin POST write-routes returned `undefined` from `handleBody`, so the request fell through to static file serving and double-wrote the response (`ERR_HTTP_HEADERS_SENT` crash). All four routes now `return true` after async handling.
- `server/index.js` — global socket `error` handler + `broadcastAll`/`broadcastPresence`/`broadcastLeaderboard` skip `destroyed`/non-writable sockets, preventing crashes when a logout/delete closes a socket mid-broadcast.
- New `options-smoke-test.js` (19 assertions: profile validation, displayName in chat/leaderboard, logout token invalidation, delete-account confirm gate + cleanup).

## 2026-08-02 — Alliance Perms Defaults + Alliance Leaderboard + PvP Alert + NPC Attack Tuning

### Milestone
Quality-of-life batch: commander permissions now default on (kick recruits, edit MOTD, officer broadcasts), alliances appear on the leaderboard with a scope toggle, incoming player attacks trigger a red-screen alert, and NPC raids got a major frequency nerf with defense-mail spam reduction.

### Phase 1 — Alliance permission defaults (server)
- Commander defaults flipped on: `canEditMotd`, `canBroadcastOfficers`, `canKickRecruits` → `true` (was `false`); officer defaults unchanged. `normalizePerms` continues to clamp every key to a boolean.

### Phase 2 — Alliance leaderboard (server + client)
- `computeAllianceLeaderboard()` — aggregates members from user colonies (authoritative), scores each alliance by population / raider (attackWins) / attacker (troop power) / defence (troop defense), top 20 per category with `{name, score, allianceId, members}`
- WS `leaderboard` payload now carries `alliances` (both `sendLeaderboardTo` and `broadcastLeaderboard`)
- `js/ui/ui-leaderboard.js` — Commanders / Alliances scope toggle; `js/app.js` passes `msg.alliances`; `.lb-scope` pill styles in `css/styles.css`

### Phase 3 — PvP incoming-attack red border (client)
- `js/ui/ui-core.js` `updateAttackGlow(state)` in `renderAll` — red overlay while a **player** attack is inbound (`combat.incomingAttacks` entries with an `attacker` field); NPC raids don't trigger it

### Phase 4 — NPC attack tuning + defense mail spam (server)
- **Env-tunable rate**: `NPC_ATTACKS_PER_HOUR` (default 0.8/hr — was ~36/hr), `NPC_ATTACK_COOLDOWN_SEC` (default 1800s per-colony), `NPC_DEFENSE_MAIL_MODE` (`'important'` default), 25-message `npc_defense` mail cap
- **Retaliation nerf**: chance ~0.2–0.38 → ~0.06–0.13, and gated by the NPC cooldown
- **Radar**: spawn chance reduced multiplicatively (`1 − (lvl−1)·0.08`, floor 0.35)
- **Mail mode `'important'`**: repelled low-threat NPC raids (threat < 3, no retaliation) skip the mailbox and write a brief `colony.log` entry instead — player still sees it in the system log (client drains + dedups); high-threat / retaliation / undefended raids still mail
- **Prune**: `npc_defense` messages capped at newest 25 (one-time cleanup + on every send)

### Tests
- `npc-tuning-smoke-test.js` (new, 30 assertions); `audit-smoke-test.js` runs in `NPC_DEFENSE_MAIL_MODE='all'` so existing mail assertions hold; `alliance-extra-smoke-test.js` updated for new commander defaults (kick tests reordered + recruit-denial before kick); `alliance-smoke-test.js` predicate tightened to skip stale pre-join auth `colony_state` (was a flaky waiter race)

### Milestone
Alliance management matured (MOTD, audit log, granular permissions, member kicks, officer broadcasts) and the Forces tab got a real fleet builder: custom training quantities, numeric fleet composition with live stats, and transit safety.

### Part A — Alliance extras (server + client)
- **MOTD** — `alliance_set_motd`; founder or officer with `canEditMotd` (240-char cap, sanitized)
- **Audit log** — `alliance_get_audit`; founder or officer with `canViewAudit`; entries for create/join/leave/set_role/motd_update/set_perms/broadcast/kick; capped 200 newest
- **Granular permissions** — `alliance_set_perms` (founder only); per-rank toggles via `DEFAULT_PERMS` + merge: officer (canUseOfficerChat, canEditMotd, canBroadcastOfficers, canKickRecruits, canViewAudit) and commander (+ canKickMembers, canPromoteToOfficer); perms preserved through `normalizeAlliance` so broadcasts don't reset them; new `alliance_update` broadcast carries perms/MOTD/members so all clients stay in sync
- **Kick** — `alliance_kick`; founder kicks anyone, commander with `canKickMembers` kicks members, officer/commander with `canKickRecruits` kicks recruits; founder protected; kicked user gets Alliance-tab mail + joinedId cleared; audit entry records the target
- **Officer broadcasts** — `alliance_broadcast` accepts `audience: 'officers'` for officers with `canBroadcastOfficers`; still founder-only for `all`
- **UI** — `js/ui/ui-alliance.js` rewritten with Settings (perms checkboxes, MOTD edit, kick buttons) + Audit tabs; `js/systems/alliance.js` wrappers (setMotd/getAudit/setPerms/kick/broadcast/can/isOfficerPlus); `js/app.js` `alliance_update`/`alliance_audit` handlers

### Part B — Forces UI v2
- **Custom train quantity** — training cards accept a number (clamped 0–99999) + quick-add buttons; `train` message sends the chosen qty
- **Fleet builder v2** — Create/Edit Fleet modals with numeric per-troop inputs, quick-add (+1/+5/+10/Max), live Power/Defense/Carry/Speed/Count summary; Edit sends only changed counts (diff-based)
- **Transit safety** — fleets in transit: Edit/Delete disabled in UI **and** guarded server-side in `js/systems/fleets.js`; CSS for `.fleet-qty-input` / `.fleet-quick-btn` / `.fleet-summary`

### Bug fix — WebSocket heartbeat reconnect loop (pre-existing)
- Client sent **raw WS ping frames** (masked binary) — browsers can't emit control frames, server never responded, socket died every 15s. Fixed with JSON `{type:'ping'}` ↔ `{type:'pong'}` heartbeat.
- Dead-check threshold was `HEARTBEAT_TIMEOUT` (10s) < `HEARTBEAT_INTERVAL` (15s), so every tick tripped it. Now `interval + timeout` (25s).
- **Live-verified:** stable connection, no reconnects over 40s+ watch; alliance chat round-trip confirmed in-browser.

### Tests
- New `alliance-extra-smoke-test.js` — 32 assertions: MOTD gates, audit entries/limits, perms gating + persistence, kick gating (founder/commander/officer), kick mail + colony clear, officer broadcast (32/32 green)
- All suites green: alliance-extra 32/32, alliance 24/24, progression 30/30, audit 26/26, economy (print-only) exit 0



### Milestone
Alliances are now real organizations: role-based hierarchy (founder/commander/officer/member/recruit), founder-controlled ranks, two private chat channels, and founder broadcast mail — with server-side security fixes.

### Phase 1 — Role data model (server)
- `normalizeAlliance()` migrates legacy array-based members to a role map (`{ username: { role, joinedAt } }`); runs at startup for existing DBs
- `getRole()` / `roleLevel()` helpers (recruit=0 → founder=4)

### Phase 2 — Create / join / leave
- Handlers rewritten onto the role map; case-insensitive duplicate-name rejection; joiners enter as **recruit**
- Founder leaving transfers founder-ship to the highest-ranked remaining member; empty alliances are deleted
- Updated `alliances` list broadcast to all connected users after every mutation

### Phase 3 — Ranks
- `alliance_set_role` — promote/demote (recruit/member/officer/commander), **founder only**

### Phase 4 — Alliance chat (2 channels)
- `alliance_chat_send` — `alliance` channel (open to members) + `officers` channel (gated to rank ≥2)
- Recruits are read-only; text escaped + capped at 500 chars; history (last 30) delivered on `auth_ok`
- **Security fix:** `colony_state` now ships `getPublicUniverse()` — raw `DB.db.universe` (alliances + chat) no longer leaks to clients

### Phase 5 — Founder broadcast mail
- `alliance_broadcast` — founder-only mail to all members or officers; subject/body capped, message cap 3/day not enforced server-side (UI hint only)

### Phase 6–8 — Client
- `js/systems/alliance.js` — new actions (setRole/sendChat/broadcast) + `joined()`/role helpers; stale `getJoinedAlliance(state)` call sites updated (research, troops, commander, home)
- `js/ui/ui-alliance.js` — rewritten as tabbed panel: Overview (members + role badges + promote/demote), Chat (alliance + officers tabs), Officers, Broadcast (founder form)
- `js/app.js` — `alliance_chat` / `alliance_chat_history` handlers
- CSS — role badge colors, tab bar, chat log, broadcast form

### Bug fix — WS frame drain
- Server WS `data` handler parsed **one frame per TCP chunk**; pipelined messages (e.g. auth + first action) were silently dropped. Now drains all complete frames per chunk. This is a pre-existing live-site bug, caught by the alliance test.

### Phase 9 — Tests
- New `alliance-smoke-test.js` — 24 assertions: create/dup-name/join/leave, founder transfer, role gates (set_role + officer channel + recruit posting), 2-channel chat, broadcast mail, chat history on re-auth, and the universe-leak security check (24/24 green)
- All prior suites still green: progression 30/30, audit 26/26, economy 5/5

## 2026-08-02 — Progression Pacing & Tech Tree

### Milestone
Slower, gated progression: level-0 buildings are now truly "not built", research/training/market/expeditions unlock via a tech tree, and build times scale gently.

### Phase 1 — Pacing constants (`game-data.json` → `pacing`)
- `buildingMinL1: 60` · `buildingGrowth: 1.28` · `researchMinL1: 60` · `researchGrowth: 1.32` — weight-based time formulas (heavier buildings/research scale slower)
- Server + client `getUpgradeTime` / `getResearchDuration` rewritten to use pacing; research time reduction clamped ≥ 0

### Phase 2 — Tech tree prerequisites
- `requires` added to buildings (`communicationsHub`, `trainingFacility` ← Extraction Grid L2; `researchLab`, `radarArray` ← CommHub L1; `marketNexus` ← CommHub L2; `tradePodTerminal` ← Nexus L1; `shieldGenerator` ← Radar L2 + Defense research L1) and research (`economy` ← Lab L1; `military` ← Lab L2 + Training Facility L1; `defense` ← Lab L2 + Radar L1)
- New `server/systems/requirements.js` checker enforced in: build, research, troop training, market exchange/artifact, expeditions

### Phase 3 — New colony start state
- `createInitialBuildings()` uses `startLevel` (extractionGrid + defenseBunker start at L1; everything else at L0 = unbuilt)

### Phase 4 — Level-0 construction math
- `getUpgradeCost` uses `effectiveLevel = max(1, level)` — constructing from 0 costs base cost (same as L1→2)
- Repair blocked on unbuilt (level 0) buildings

### Phase 5 — Server gameData sync
- `colony_state` now carries trimmed `gameData` (pacing, building/research cost/time/requires/startLevel); client merges into `window.GameData` so UI always matches server truth
- Client fallback tech tree in `js/data.js` for pre-sync renders

### Phase 6 — UI locked states
- Research cards: lock reason + disabled button; Training roster: disabled Train buttons + "Requires Training Facility Lv1"; Market: disabled form + note; Map expeditions: disabled Launch button + note; Building modal: "Construct" label for level 0, requirement gate, Repair hidden when unbuilt

### Phase 7 — Tests
- New `progression-smoke-test.js` — 30 assertions covering pacing formulas, startLevel, level-0 cost math, repair guard, all 6 gate blocks + 3 pass cases, gameData payload (30/30 green)

## 2026-08-02 — Tunable Economy Speed (Railway env vars)

### Milestone
Production rates are now configurable from Railway env vars — slow the game down globally, soften per-level scaling, and gate isotopes — without touching code.

### What Changed

**Global speed multiplier (server/systems/resources.js)** — `ECONOMY_SPEED` env var (default `1.0`, clamp 0.05..5) scales ALL production rates. `ECONOMY_SPEED=0.2` → 20% production.

**Per-level scaling softened + tunable** — extractionGrid and economy research were hardcoded at 8% per level. Now `ECONOMY_EXT_STEP` / `ECONOMY_RESEARCH_STEP` (default `0.05`, clamp 0..0.25) — gentler by default, and old behavior restorable with `0.08` on Railway.

**Isotope rarity gate** — `ECONOMY_ISOTOPE_MULT` (default `1.0`, clamp 0.05..5) applies only to isotopes.

**Safety** — all vars validated/clamped at module load; missing/empty/invalid values fall back to defaults, so the game behaves identically with no env vars except the intended 8%→5% step change.

**Docs** — GAME-DEV-GUIDE.md gained an "Economy Tuning (Railway env vars)" table with suggested slow-game settings.

### Verified
`economy-smoke-test.js` (new, kept as rebalance tool): defaults → mult 1.35 @ ext5/eco3; `ECONOMY_SPEED=0.2` → exactly 20%; +`ECONOMY_ISOTOPE_MULT=0.6` → isotopes 60% of that; steps 0.08 → old mult; speed=100 → clamped to 5×. Tick still clamps to cap and drains isotope upkeep.

## 2026-08-02 — Combat & Resources Audit (Caps, NPC Defense Mails, PvP Stats, Combat Report Cards)

### Milestone
Seven-item gameplay-consistency audit: resource caps now shrink when warehouse buildings drop, NPC attacks can't resolve in the same tick they spawn, NPC defense reports are mailed server-authoritatively, PvP `defenseWins` counts only real defender victories, casualties no longer force 1 loss per troop type, and both PvP/NPC reports render as structured combat-report cards.

### What Changed

**Resource caps (server/systems/resources.js)** — `updateCaps()` set `cap = Math.max(cap, newCap)`, so caps ratcheted up forever even after siege damage dropped warehouse levels. Now sets `cap = newCap` directly and clamps `amount` — siege a colony down and its storage shrinks.

**NPC attack fairness (server/systems/combat.js)** — `tick()` spawned a random attack *before* processing, so on large offline `dt` a fresh attack could decrement to zero and resolve instantly in the same tick. Processing now runs first (collect due → resolve), then the spawn roll happens with a guaranteed full ETA.

**NPC defense reports (server/systems/combat.js)** — `resolveIncoming()` now tracks casualties per troop type (`{troopKey: lost}`) and building damage hits (key, integrity before/after), then `sendDefenseReport()` writes a Defense-tab mail: subject `Defense Report: Threat L{level}` (+ `(Retaliation)`), sectioned plain-text body, `type: 'combat_report_v2'` + structured `data`, mailbox capped at 120 messages.

**PvP stats bug (server/index.js)** — `defenseWins` incremented even when the attacker won. Now: attacker win → `att.attackWins++`, `def.defenseLosses++` (new counter, back-compat init); defender win → `def.defenseWins++` only.

**PvP casualty rule (server/index.js)** — `Math.max(1, floor(count * rate))` forced every troop type present to lose ≥1. Now `Math.min(count, floor(count * rate))`; if both sides lost nothing, exactly 1 random unit from one side is sacrificed ("combat always costs something").

**Battle report formatting (server/index.js)** — added `formatCombatReportText(perspective, context)` + `buildCombatReportData()`: readable sectioned report with report ID, UTC time, route with galaxy:sector:planet ids, outcome per perspective, power/shield/ratio, per-type casualties, loot + carry cap, building damage with level drops, and fleet return ETA. Defender subject now `Defense Report: <attacker>`.

**Structured mail UI (js/ui/ui-mailbox.js + css/styles.css)** — messages with `type: 'combat_report_v2'` render as HTML combat cards (outcome banner, Power/Losses/Loot/Building Damage tables, fleet status) with all dynamic text escaped; older messages fall back to the `<pre>` renderer. New `.cr-*` styles added.

## 2026-07-31 — Map Improvements Phase 2 (Universe Coords, Player Markers, Occupied Bases, Nebula, Route Preview, Impact Rings, Sound)

### Milestone
Seven-phase map overhaul: server-authoritative galaxy coordinates, live player markers at every zoom level, colonized planets rendering as occupied bases, drifting nebula layers, route preview with ETA, PvP arrival shock rings, and an opt-in WebAudio sound toggle.

### What Changed

**Universe coordinates (server)** — `generateGalaxy()` now stamps `universeX`/`universeY` grid positions and an `index` on every galaxy; `backfillGalaxyCoords()` assigns coords+index to pre-existing galaxies at server startup (no universe regen needed). `getUniverseCoords()` in `travel.js` gained NaN guards and defensive defaults so missing coords can never poison fleet travel.

**Live player markers** — the server previously never sent a presence broadcast the client could render; added `broadcastPresence()` emitting `{type:'presence', players:[{username, galaxyId, sectorId, planetId}]}` on connect, disconnect, idle-close and close. Client `renderPlayerMarkers()` now places markers at every zoom level (universe → galaxy grid, galaxy → sector, sector → planet) with a deterministic per-username `stableOffset()` so markers never stack; `app.js` presence handler reads the `players` payload.

**Occupied bases** — colonized planets render as occupied bases: double-accent border, rotating dashed orbit ring, ⚑ glyph, and an occupant label (undiscovered name shown as "Signal" if you haven't discovered the owner).

**Nebula drift** — nested nebula layers (both viewports already consume both pseudo-elements) drift on 60–90s CSS loops, with `prefers-reduced-motion` support.

**Route preview + ETA** — selecting a planet renders a dashed animated route line from your colony (z-index below markers); the planet panel shows travel time and a clock ETA computed from the server travel system.

**PvP arrival impact rings** — the PvP RAF loop now detects fleet arrival (`pvpProgress >= 1`) and spawns an expanding shock ring once per fleet per direction (red outbound attack, amber return), with cleanup and a sound hook.

**Opt-in sound** — `SoundSystem` WebAudio module with localStorage-persisted opt-in (`de_sound`), 🔊 toggle in the camera controls, tick on planet select and impact on arrival; audio context resumes on first user interaction.

## 2026-07-31 — Map Improvements (Camera Persistence, UI Polish, PvP Fleet Transit)

### Milestone
Map UX overhaul: persistent universe camera with cursor-anchored zoom, one-time document listeners (no more handler stacking/clobbering), drifting starfields, fog shimmer, click feedback, selection ping rings, and live PvP fleet markers traveling between planets.

### What Changed

**Persistent universe camera** — `state.universe.camera = { zoom, panX, panY }` survives re-renders and view switches. Wheel zoom anchors on the cursor position, drag pan is 1:1, Reset and ⌂ Home buttons write through to the camera state and re-apply the transform.

**No listener stacking** — universe view mousemove/mouseup/touchmove/touchend are bound **once** on `document` (live refs via `_uvRefs`); tactical map pan handlers are bound **once** on `window` (live refs via `_tacRefs`). Removed `window.onmousemove`/`window.onmouseup` clobbering and per-render `addEventListener` stacking in both views. `.map-stage.dragging` disables the CSS transition so panning feels 1:1.

**UI polish (CSS)** — drifting starfield behind both map viewports (tactical + galaxy), shimmer animation on fogged/undiscovered nodes, press-down scale feedback on node clicks, expanding ping ring on selected galaxy/sector/planet, `touch-action: none` on viewports, `prefers-reduced-motion` support.

**PvP fleet transit visuals** — server now stamps `fleet.transit` with `mode: 'pvp_attack'`, `startTime`, `attacker`, `defender`, `origin`/`targetPos` (galaxyId/sectorId/planetId/planetName) on launch **and** return trips. Client renders ⚔️/↩ markers that animate along the origin→target path via a lightweight RAF loop (no re-render), red for outgoing, amber/yellow for return. `attack_launched` carries the full transit so the marker appears instantly.

**Restart resilience** — `sync_fleets` restore now reads `transit.attacker`/`transit.defender` with fallbacks (was misusing `origin.planetName` as the attacker name).

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
