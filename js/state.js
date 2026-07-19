window.GameState = (function () {
  const SAVE_KEY = "deadEarthProtocolSave";

  function makeInitialResources() {
    return {
      ore: { amount: 420, cap: 1200 },
      solar: { amount: 360, cap: 1100 },
      crystal: { amount: 220, cap: 900 },
      isotopes: { amount: 180, cap: 700 }
    };
  }

  function makeInitialBuildings() {
    const out = {};
    Object.keys(GameData.buildings).forEach((key) => {
      out[key] = {
        level: 1,
        integrity: 100,
        upgrading: null
      };
    });
    return out;
  }

  function makeInitialTroops() {
    const counts = {};
    Object.keys(GameData.troops).forEach((key) => counts[key] = 0);
    counts.reconScout = 2;
    counts.rifleUnit = 4;
    return counts;
  }

  function makeInitialResearch() {
    return {
      levels: { economy: 0, military: 0, defense: 0 },
      active: null,
      completedTotal: 0
    };
  }

  function makeInitialMissionState() {
    const obj = {};
    GameData.missions.forEach(m => {
      obj[m.id] = { claimed: false };
    });
    return obj;
  }

  function makeInitialDiscoveredNodes() {
    return {
      "n-home": true,
      "n-resource-1": true,
      "n-enemy-1": true
    };
  }

  function createInitialState() {
    return {
      saveVersion: GameData.saveVersion,
      lastTick: Date.now(),
      lastAutosave: 0,
      tickCount: 0,

      ui: {
        currentPage: "home",
        logPage: 0
      },

      statusFlags: {
        isotopeDepleted: false
      },

      commander: {
        name: "Commander Hector",
        factionTitle: "Ash Meridian Command",
        emblem: GameData.emblems[0],
        theme: "cyan"
      },

      resources: makeInitialResources(),
      buildings: makeInitialBuildings(),
      troops: {
        counts: makeInitialTroops(),
        queue: []
      },

      research: makeInitialResearch(),

      combat: {
        scoutsCompleted: 0,
        attackWins: 0,
        defenseWins: 0,
        incomingAttacks: [],
        lastScoutedEnemyId: null,
        scoutingIntel: {},
        raidHistory: []
      },

      expeditions: {
        queue: []
      },

      market: {
        transactions: []
      },

      alliance: {
        joinedId: null
      },

      events: {
        active: null,
        history: []
      },

      mailbox: {
        selectedTab: "Inbox",
        selectedMessageId: null,
        messages: []
      },

      map: {
        selectedNodeId: "n-home",
        discoveredNodes: makeInitialDiscoveredNodes(),
        camera: {
          zoom: 1,
          offsetX: 0,
          offsetY: 0
        },
        scanPulses: []
      },

      commanderStats: {
        rankPoints: 0
      },

      missions: makeInitialMissionState(),

      log: [
        { id: "log-init-1", text: "Command uplink established.", time: Date.now() },
        { id: "log-init-2", text: "Starter colony systems online.", time: Date.now() }
      ],

      inventory: {
        artifacts: []
      },

      universe: {
        seed: 42,
        showUniverseView: false,
        zoomLevel: "universe",
        activeGalaxyId: null,
        activeSectorId: null,
        activePlanetId: null,
        discoveredPlanets: {},
        fleets: [],
        hasWarpGate: false
      }
    };
  }

  function normalizeState(state) {
    const clean = state || {};
    const base = createInitialState();

    clean.saveVersion = clean.saveVersion || base.saveVersion;
    clean.lastTick = clean.lastTick || Date.now();
    clean.lastAutosave = clean.lastAutosave || 0;
    clean.tickCount = clean.tickCount || 0;

    clean.ui = Object.assign({}, base.ui, clean.ui || {});
    clean.statusFlags = Object.assign({}, base.statusFlags, clean.statusFlags || {});
    clean.commander = Object.assign({}, base.commander, clean.commander || {});
    clean.resources = Object.assign({}, base.resources, clean.resources || {});
    Object.keys(base.resources).forEach((k) => {
      clean.resources[k] = Object.assign({}, base.resources[k], clean.resources[k] || {});
    });

    clean.buildings = Object.assign({}, base.buildings, clean.buildings || {});
    Object.keys(base.buildings).forEach((k) => {
      clean.buildings[k] = Object.assign({}, base.buildings[k], clean.buildings[k] || {});
    });

    clean.troops = Object.assign({}, base.troops, clean.troops || {});
    clean.troops.counts = Object.assign({}, base.troops.counts, (clean.troops && clean.troops.counts) || {});
    clean.troops.queue = Array.isArray(clean.troops.queue) ? clean.troops.queue : [];

    clean.research = Object.assign({}, base.research, clean.research || {});
    clean.research.levels = Object.assign({}, base.research.levels, (clean.research && clean.research.levels) || {});
    clean.research.completedTotal = clean.research.completedTotal || 0;

    clean.combat = Object.assign({}, base.combat, clean.combat || {});
    clean.combat.incomingAttacks = Array.isArray(clean.combat.incomingAttacks) ? clean.combat.incomingAttacks : [];
    clean.combat.scoutingIntel = clean.combat.scoutingIntel || {};
    clean.combat.raidHistory = Array.isArray(clean.combat.raidHistory) ? clean.combat.raidHistory : [];

    clean.expeditions = Object.assign({}, base.expeditions, clean.expeditions || {});
    clean.expeditions.queue = Array.isArray(clean.expeditions.queue) ? clean.expeditions.queue : [];

    clean.market = Object.assign({}, base.market, clean.market || {});
    clean.market.transactions = Array.isArray(clean.market.transactions) ? clean.market.transactions : [];

    clean.alliance = Object.assign({}, base.alliance, clean.alliance || {});
    clean.events = Object.assign({}, base.events, clean.events || {});
    clean.events.history = Array.isArray(clean.events.history) ? clean.events.history : [];

    clean.mailbox = Object.assign({}, base.mailbox, clean.mailbox || {});
    clean.mailbox.messages = Array.isArray(clean.mailbox.messages) ? clean.mailbox.messages : [];

    clean.map = Object.assign({}, base.map, clean.map || {});
    clean.map.discoveredNodes = Object.assign({}, base.map.discoveredNodes, clean.map.discoveredNodes || {});
    clean.map.camera = Object.assign({}, base.map.camera, clean.map.camera || {});
    clean.map.scanPulses = Array.isArray(clean.map.scanPulses) ? clean.map.scanPulses : [];

    clean.commanderStats = Object.assign({}, base.commanderStats, clean.commanderStats || {});
    clean.missions = Object.assign({}, base.missions, clean.missions || {});
    GameData.missions.forEach(m => {
      clean.missions[m.id] = Object.assign({ claimed: false }, clean.missions[m.id] || {});
    });

    clean.log = Array.isArray(clean.log) ? clean.log : [];
    clean.inventory = Object.assign({}, base.inventory, clean.inventory || {});
    clean.inventory.artifacts = Array.isArray(clean.inventory.artifacts) ? clean.inventory.artifacts : [];

    clean.universe = Object.assign({}, base.universe, clean.universe || {});
    clean.universe.discoveredPlanets = Object.assign({}, base.universe.discoveredPlanets, clean.universe.discoveredPlanets || {});
    clean.universe.fleets = Array.isArray(clean.universe.fleets) ? clean.universe.fleets : [];

    return clean;
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return createInitialState();
      return normalizeState(JSON.parse(raw));
    } catch (e) {
      console.error("Load failed", e);
      return createInitialState();
    }
  }

  function save(state) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error("Save failed", e);
      return false;
    }
  }

  function reset() {
    localStorage.removeItem(SAVE_KEY);
    return createInitialState();
  }

  return {
    SAVE_KEY,
    createInitialState,
    normalizeState,
    load,
    save,
    reset
  };
})();