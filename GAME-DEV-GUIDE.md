# Dead Earth Protocol — Developer Guide

## Architecture Overview

The game is a **real-time multiplayer strategy game** with a zero-dependency Node.js server and a browser-based client.

```
┌─────────┐    HTTP/WebSocket     ┌──────────────┐
│ Browser │ ◄──────────────────► │ Node Server  │
│ (Client)│     port 3000         │ (Railway)    │
└─────────┘                      └──────┬───────┘
                                        │
                                   ┌────┴───────┐
                                   │  data/      │
                                   │ db.json     │
                                   │ (JSON file) │
                                   └────────────┘
```

---

## Connected Services

### GitHub (Source Code)
- **Repository:** `github.com/HectorGrey-lab/death-earth-protocol`
- **Branch:** `main` (auto-deploys to Railway)
- **Login:** GitHub account `HectorGrey-lab`
- **To push changes:**
  ```bash
  git add -A
  git commit -m "description of changes"
  git push
  ```

### Railway (Hosting)
- **URL:** `https://death-earth-protocol-production.up.railway.app`
- **How it works:** Railway watches the GitHub repo. Every `git push` to `main` triggers an automatic rebuild and deploy (~2 minutes).
- **Start command:** `node server/index.js` (defined in `Procfile` and `package.json`)
- **Auto HTTPS:** Railway provides SSL/TLS for free.
- **Persistence:** Game data is saved to `server/data/db.json` on Railway's filesystem.

---

## How to Edit the Game

### 1. Pull the latest code
```bash
cd "/c/Users/byron/OneDrive/Desktop/death-earth-prototypeV1"
git pull
```

### 2. Run locally for testing
```bash
node server/index.js
```
Then open `http://localhost:3000` in your browser.

### 3. Edit files and test
- **Server code:** `server/` directory (index.js, db.js, universe.js, systems/, game-loop.js)
- **Client code:** `js/` directory (app.js, network.js, ui/*.js, systems/*.js)
- **Game constants:** `server/game-data.json` and `js/data.js`
- **HTML pages:** `login.html` (auth), `game.html` (game client)

### 4. Push to deploy
```bash
git add -A
git commit -m "what you changed"
git push
```
Wait ~2 minutes, then visit the Railway URL and hard refresh (Ctrl+Shift+R).

---

## Sprint 1 Changes (Complete)

This sprint converted the game from a **single-player browser game** (localStorage, local game loop) to a **fully online multiplayer game** (server-authoritative, no local data).

### What was added

| File | Purpose |
|------|---------|
| `server/db.js` | Database — loads/saves `db.json`, ensures a planet is available for new players |
| `server/universe.js` | Universe expansion — 20 planets per sector, 10 sectors per galaxy, auto-grows as players join |
| `server/game-loop.js` | World tick loop — processes resource production, building construction, troop training every 2 seconds for ALL colonies |
| `server/systems/resources.js` | Server-side resource production rates and storage caps |
| `server/systems/buildings.js` | Server-side building upgrade costs, build times, and queue processing |
| `server/systems/troops.js` | Server-side troop training costs and queue processing |
| `server/game-data.json` | Shared game constants (resources, buildings, troops, universe params) |
| `login.html` | Standalone auth page with planet name on registration |
| `game.html` | Game client page (separate from login) |
| `js/network.js` | WebSocket client — connects, authenticates, sends/receives game actions |

### What was removed

| File | Reason |
|------|--------|
| `js/state.js` | GameState class with localStorage save/load — all state now comes from server |
| `data/db.json` | Removed from git (now in `.gitignore`) — generated at runtime |

### What was rewritten

| File | Change |
|------|--------|
| `server/index.js` | Now integrates all game modules + universe expansion + WebSocket game actions + login endpoint creates planet colony |
| `js/app.js` | No local tick loop, no localStorage, no GameState. Initializes minimal UI state, receives colony from server, sends build/train actions to server |
| `js/ui/ui-forces.js` | Train buttons call `Network.train()` instead of local `TroopSystem.queueTrain()` |
| `js/ui/ui-modal.js` | Building upgrades call `Network.build()` instead of local `BuildingSystem.startUpgrade()` |

### What defensive fixes were applied

These files were patched to handle missing server data gracefully (the old code assumed all game state was local):

| File | Fix |
|------|-----|
| `js/systems/alliance.js` | Added `null` guard for `state.alliance` before accessing `.joinedId` |
| `js/systems/buildings.js` | Added fallback for `state.research.completedTotal` when server hasn't sent it yet |

### Server-Side Colony Structure

Every registered player gets a colony with:
- **Planet:** Named on registration, assigned to next free Terran planet in the universe
- **Universe position:** Galaxy -> Sector -> Planet (auto-assigned)
- **Starter resources:** 500 ore, 300 solar, 100 crystal, 50 population
- **Starter buildings:** Command Center (lvl 1), Mine (lvl 1), Solar Collector (lvl 1), Crystal Lab (lvl 1), Barracks (lvl 1)
- **Resources grow offline:** Game loop produces resources every 2s even when no one is logged in

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/register` | POST | Create account + assign planet |
| `/api/login` | POST | Authenticate + return token |
| `/api/validate` | POST | Validate a token |
| `/api/health` | GET | Server health check |

### WebSocket Messages

| Direction | Type | Purpose |
|-----------|------|---------|
| Server -> Client | `auth_ok` | Auth success + welcome |
| Server -> Client | `colony_state` | Full colony data + universe |
| Server -> Client | `build_result` | Building upgrade result |
| Server -> Client | `train_result` | Troop training result |
| Server -> Client | `universe_state` | Universe map data |
| Client -> Server | `build` | Start building upgrade |
| Client -> Server | `train` | Start troop training |
| Server -> Client | `chat` | Chat message broadcast |
| Client -> Server | `chat` | Send chat message |
| Server -> Client | `presence` | Online player list |
| Client -> Server | `position` | Update player's universe location |

---

## File Structure

```
death-earth-prototypeV1/
├── server/
│   ├── index.js           # HTTP + WebSocket server (entry point)
│   ├── db.js              # Database module (JSON file)
│   ├── universe.js        # Universe expansion logic
│   ├── game-loop.js       # World tick loop
│   ├── game-data.json     # Shared game constants
│   ├── systems/
│   │   ├── resources.js   # Resource production
│   │   ├── buildings.js   # Building upgrades
│   │   └── troops.js      # Troop training
│   └── data/              # Runtime data (not in git)
│       ├── db.json        # Universe + colonies + users
│       └── chat.json      # Chat history
├── js/
│   ├── app.js             # Client initialization (server-driven)
│   ├── network.js         # WebSocket client
│   ├── data.js            # Client-side game constants
│   ├── utils.js           # Utility functions
│   ├── universe.js        # Client universe rendering helpers
│   ├── ui/
│   │   ├── ui-core.js     # Main rendering + navigation
│   │   ├── ui-home.js     # Home page
│   │   ├── ui-map.js      # World map / universe view
│   │   ├── ui-chat.js     # Chat panel
│   │   ├── ui-buildings.js# Buildings page
│   │   ├── ui-forces.js   # Forces/troops page
│   │   ├── ui-research.js # Research page
│   │   ├── ui-resources.js# Resources display
│   │   └── ...            # Other UI modules
│   └── systems/           # Client-side display helpers
│       ├── buildings.js   # Power/population calculations
│       ├── troops.js      # Power modifiers
│       └── ...            # Other helpers (no save/load/tick)
├── css/
│   └── styles.css         # Game styles
├── login.html             # Auth page (register/login)
├── game.html              # Game page
├── package.json           # Node.js config (start script)
├── Procfile               # Railway deployment config
└── GAME-DEV-GUIDE.md      # This file
```

---

## Common Tasks

### Add a new building type
1. Add to `server/game-data.json` under `buildings` (cost, time, effects)
2. Add to `js/data.js` under `buildings` (name, description, image)
3. Server auto-picks it up - no server code changes needed
4. Client UI auto-renders it from `GameData.buildings`

### Add a new troop type
1. Add to `server/game-data.json` under `troops` (cost, power, defense, upkeep)
2. Add to `js/data.js` under `troops` (name, description)
3. UI auto-renders it

### Change starter resources
Edit `server/game-data.json` - `startingResources` section.

### Change universe size
Edit `server/game-data.json` - `universe.planetsPerSector` and `universe.sectorsPerGalaxy`.

### Reset all game data
Delete `server/data/db.json` and restart the server. All players and colonies are wiped.

---

## Debugging Tips

- **Browser console:** `F12` -> Console tab shows JS errors
- **Network tab:** `F12` -> Network -> WS shows WebSocket messages
- **Server logs:** Enabled by default - shows all HTTP requests and WebSocket actions
- **Hard refresh:** Always use `Ctrl+Shift+R` after Railway deploys (browser caching is aggressive)
- **Local test:** `node server/index.js` -> `http://localhost:3000` for rapid iteration without Railway
- **OneDrive note:** If developing from OneDrive folder (`C:\Users\byron\OneDrive\Desktop\`), use `git push` to deploy first, then run locally

---

## Future Sprints (Planned)

| Sprint | Features |
|--------|----------|
| Sprint 2 | Research (server-side), Fleet travel (server), Combat (server), Battle reports |
| Sprint 3 | Market, Alliances, Galaxy wars, Trading |
| Sprint 4 | Premium features, Notifications, Mobile support |
