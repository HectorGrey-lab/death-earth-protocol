# Dead Earth Protocol — Change Log

## Fix: Universe View Integrated into World Map (2026-07-18)

> **Problem:** Galaxy Map was a separate nav tab instead of being integrated into the existing World Map. Sector→planet drill-down was broken.
> **Fix:** Removed Galaxy Map tab, merged universe views into World Map with a toggle button.

### Changes Made

| File | Change | Revert |
|------|--------|--------|
| `index.html` | Removed Galaxy Map nav button, removed ui-galaxy.js script tag | Re-add them |
| `js/ui/ui-core.js` | Removed galaxy PAGE_META entry, removed `case "galaxy"` from renderActivePage | Re-add them |
| `js/state.js` | Changed `showUniverseView` from missing to `false` in universe state | Remove field |
| `js/ui/ui-map.js` | **Major rewrite** — added universe view mode alongside existing tactical map. New functions: renderUniverseViewport, renderUniverseView, renderGalaxyView, renderSectorView2, renderUniverseSidebar, renderPlanetTravelInfo, renderTravelQueue, renderUniverseFleetMarkers, renderUniverseFleetTrails, bindUniverseView. Toggle button switches between modes. Sector→planet drill-down now functional. | Revert to original tactical-only version |
| `css/galaxy.css` | Added `.map-mode-toggle` style | Remove |

### How It Works Now

1. **World Map tab** still works exactly as before — tactical nodes, scouts, raids, expeditions
2. **"🌌 Explore Universe" button** at the top switches to universe view (3-tier galaxy/sector/planet hierarchy)
3. **"◄ Back to Tactical Map"** switches back
4. **Sector→Planet navigation**: Click galaxy → see sectors. Click sector → see planets. Click planet → see travel info + Send Scout
5. **Fleet markers** and travel queue visible in universe mode too

### Revert Procedure
1. Revert ui-map.js to original tactical-only version
2. Re-add ui-galaxy.js script tag to index.html
3. Re-add Galaxy Map nav button
4. Re-add galaxy routing to ui-core.js
5. Remove showUniverseView from state.js

---

## Phase 3 — Travel & Fleet System (2026-07-18)

> **Goal:** Distance-based travel between planets using universe coordinates. Fleets travel in real-time on the galaxy map.
> **Design principle:** Only add — never modify or remove existing UI. Big changes documented for revertability.

### New Files Created

| File | Purpose | Revert |
|------|---------|--------|
| `js/systems/travel.js` | Travel system — universe coordinate conversion, distance calculation, travel time formula (same-sector: 30-60s, same-galaxy: 5-15min, cross-galaxy: 1-4h / 10-20min with warp gate). Fleet queue management with tick-based ETA. Arrival event handling (scout → discover, colony → establish). Max 20 active fleets. | Delete file + remove script tag |

### Files Modified

| File | Change | Revert |
|------|--------|--------|
| `js/state.js` | Added `fleets: []` and `hasWarpGate: false` to universe state. Added fleet array normalization. | Remove additions |
| `js/systems/galaxy.js` | Added fleet management functions: `sendScout()`, `getHomePlanet()`, `getActiveFleets()`, `hasActiveFleetTo()`. Updated `discoverPlanet()` to log planet name instead of ID. | Revert patches |
| `js/ui/ui-galaxy.js` | Added fleet markers on galaxy map (moving dots with trails). Added travel queue panel in sidebar. Added planet travel info (distance, ETA, Send Scout button) on planet selection. | Revert to Phase 2 version |
| `css/galaxy.css` | Added fleet marker styles (animated dots per type), fleet trail styles, fleet queue item card. | Remove additions |
| `js/app.js` | Added `TravelSystem.tick(state, dt)` to game loop — processes fleet ETA every second, triggers arrival events. | Remove line |
| `index.html` | Added `js/systems/travel.js` script tag. | Remove script tag |

### Architecture Decisions

1. **Coordinate conversion** — `getUniverseCoords()` converts planet/sector percentage positions to universe coordinates by combining galaxy center + sector offset + planet offset. Enables accurate Euclidean distance.
2. **Travel time formula** — Uses scale-aware multipliers per distance level: 1.2s/unit intra-sector, 2.2s/unit intra-galaxy, 12s/unit inter-galaxy. Warp gate reduces to 8% (min 5 min).
3. **Fleet queue** — Max 20 active fleets, oldest arrived fleets auto-pruned (keep latest 5). Fleets stored in state.universe.fleets for persistence.
4. **Send Scout** — Sends a scout fleet from home planet to selected destination. On arrival, auto-discovers the planet. Foundation for future colonization fleets.
5. **Fleet markers** — Rendered as animated dots on the galaxy map with trails from origin to destination. Color-coded by fleet type (purple=scout, green=colony).
6. **Travel queue** — Shows in sidebar with destination name, ETA, progress bar. Updates every tick.

### What Works

- ✅ Distance calculation between any two planets in the universe
- ✅ Travel time formula per scale (sector/galaxy/warp gate)
- ✅ Fleet dispatch via Send Scout button on planet selection
- ✅ Fleet travel animation on galaxy map (moving dots + trails)
- ✅ Travel queue panel with ETA and progress bars
- ✅ Fleet arrival handling (scout discovers planet on arrival)
- ✅ Tick-based ETA processing (decrements every second)
- ✅ System log notifications for fleet dispatch + arrival
- ✅ Auto-pruning of old arrived fleets (keep 5 latest)
- ✅ Save/load persists active fleet state
- ✅ Max 20 fleet cap with warning

### What's Next

- Distance-based expedition times (integrate with existing ExpeditionSystem)
- Warp gate building (can be constructed, reduces cross-galaxy travel time)
- Colony fleet travel (send colony ship → auto-create colony on arrival)
- Visible enemy fleets on galaxy map (PvP)

### Revert Procedure

To fully revert Phase 3:
1. Delete `js/systems/travel.js`
2. Remove `TravelSystem.tick(state, dt)` from app.js
3. Remove travel.js script tag from index.html
4. Revert galaxy.js fleet additions
5. Revert ui-galaxy.js to Phase 2 version
6. Remove fleet CSS from galaxy.css
7. Remove fleets/hasWarpGate from state.js

---

## Phase 2 — Universe System (2026-07-18)

> **Goal:** Add galaxy/sector/planet hierarchy as a new layer above the existing tactical map.
> **Design principle:** Only add — never modify or remove existing UI. Big changes documented for revertability.

### New Files Created

| File | Purpose | Revert |
|------|---------|--------|
| `js/universe.js` | Seed-based procedural universe engine. Generates 9 galaxies (3×3 grid), 15 sectors each, 30-50 planets per sector. Deterministic from seed 42. | Delete file + remove script tag from index.html |
| `js/systems/galaxy.js` | Galaxy system — player position tracking, zoom level management, planet discovery/colonization state. Works alongside existing MapSystem. | Delete file + remove script tag |
| `js/ui/ui-galaxy.js` | Galaxy map HTML renderer. Three zoom layers: Universe→Galaxy→Sector. Click drill-down, back/reset controls, selection details sidebar. | Delete file + remove script tag |
| `css/galaxy.css` | Galaxy map styles — viewport, nodes, cores, animations, responsive breakpoints. All new styles, never touches existing CSS. | Delete file + remove CSS link from index.html |

### Files Modified

| File | Change | Revert |
|------|--------|--------|
| `index.html` | Added Galaxy Map nav button after World Map. Added galaxy.css link. Added 3 script tags (universe.js, galaxy.js, ui-galaxy.js) in load order. | Reverse the patches or re-read original |
| `js/state.js` | Added `universe` section to `createInitialState()` (seed, zoomLevel, activeGalaxyId/SectorId/PlanetId, discoveredPlanets). Added `clean.universe` normalization in `normalizeState()`. | Remove the additions |
| `js/ui/ui-core.js` | Added `galaxy` entry to `PAGE_META`. Added `case "galaxy"` in `renderActivePage()` calling UIGalaxy.render() and bind(). | Remove the additions |

### Architecture Decisions

1. **Seed-based universe** (seed=42) — ensures all players see the same universe layout. Critical for future multiplayer.
2. **Coordinate system**: Galaxy spacing=1000u, sector spacing=100u, planet spacing=10u (same as galaxy-war prototype but adapted to HTML DOM positioning).
3. **Planet types** — 8 types (barren, terran, ocean, volcanic, gas, forest, tundra, desert) with unique resource bonuses. Colors match existing game palette.
4. **Separate from tactical map** — The Galaxy Map is a new page/feature, not a replacement. The existing World Map (tactical node map) remains fully functional.
5. **Discovered vs undiscovered planets** — Planets show as "???" until clicked. First click auto-discovers them. Foundation for future scouting/intel economy.
6. **DOM-based rendering** — Follows the same pattern as UIMap (HTML strings with percentage positioning). No canvas dependency.

### What Works

- ✅ Universe generation — 9 galaxies × 15 sectors × 30-50 planets = ~5,400 planets
- ✅ Galaxy Map nav button routes to new page
- ✅ Universe view: 9 galaxy clusters in 3×3 grid with colors + labels
- ✅ Click galaxy → zooms into galaxy view showing 15 sectors
- ✅ Click sector → zooms into sector view showing 30-50 planets
- ✅ Planet discovery on first click (auto-reveals name + type)
- ✅ Zoom Out / Reset buttons to navigate up
- ✅ Selection sidebar showing galaxy/sector/planet details
- ✅ Player base indicator on home planet
- ✅ Legend showing colony vs unexplored colors
- ✅ Save/load persists universe state (position, discoveries)
- ✅ Backward compatible — existing saves get default universe state

### What's Next (Phase 3+)

- Distance-based travel times using universe coordinates
- Warp gates between galaxies
- Fleet animation on galaxy map
- Convert tactical map to sector-level view
- Multiplayer backend

### Revert Procedure

To fully revert Phase 2:
1. Delete `css/galaxy.css`
2. Delete `js/universe.js`, `js/systems/galaxy.js`, `js/ui/ui-galaxy.js`
3. Revert `index.html` — remove nav button, CSS link, and 3 script tags
4. Revert `js/state.js` — remove universe section from createInitialState and normalizeState
5. Revert `js/ui/ui-core.js` — remove galaxy page meta and route case

---

## Phase 1 (Pre-existing) — Original Game

Dead Earth Protocol was built as a single-player dark sci-fi strategy dashboard with:
- Resource management (4 resources with production/cap)
- 9 building types with upgrades and integrity
- 10 troop types with training
- 3 research categories
- Combat system (scouting, raids, defense)
- 7-node tactical map with regions
- Expeditions to resource nodes
- Market for trading
- 3 alliances with perks
- Random events
- 6 missions
- Commander customization
- Mailbox and system log
- localStorage save/load
