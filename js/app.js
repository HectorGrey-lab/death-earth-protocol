window.App = (function () {
  function render() {
    UICore.renderAll(window.gameState);
  }

  function bindNav() {
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.onclick = function () {
        window.gameState.ui.currentPage = btn.dataset.page;
        render();
      };
    });
  }

  function bindGlobalUI() {
    bindNav();
    UIModal.bind();
  }

  function setupNetwork() {
    Network.init();

    setTimeout(function () {
      if (Network.isConnected) {
        // Chat widget removed — Global Chat tab replaced the homepage widget
        Network.on("chat", function (msg) { UIChat.addMessage(msg); });
        Network.on("presence", function (players) {
          UIChat.setOnlineCount(players.length);
          window._onlinePlayers = players;
        });
        // Removed: system listener was adding join/leave notifications to chat
        Network.on('chat_history', function (msg) {
          if (msg.messages && msg.messages.length) {
            UIChat.loadHistory(msg.messages);
          }
        });
      }
    }, 2000);

    Network.on("auth_error", function () {
      try { localStorage.removeItem("de_token"); localStorage.removeItem("de_username"); } catch(e) {}
      window.location.href = "/login";
    });

    // Receive colony state from server
    Network.on("colony_state", function (msg) {
      if (msg.colony) {
        var c = msg.colony;
        window.gameState.resources = c.resources;
        window.gameState.buildings = c.buildings;
        window.gameState.troops = c.troops;
        window.gameState.research = c.research || { levels: {}, active: null, completedTotal: 0 };
        window.gameState.commander.planetName = c.planetName;

        // Store missions state if sent by server
        if (c.missions) {
          window.gameState.missions = c.missions;
        }
        // Store inventory if sent by server
        if (c.inventory) {
          window.gameState.inventory = c.inventory;
        }
        // Store combat stats if sent by server
        if (c.combat) {
          window.gameState.combat = c.combat;
        }
        // Store mailbox messages if sent by server
        if (c.mailbox) {
          window.gameState.mailbox = c.mailbox;
        }
        // Store alliance if sent by server
        if (c.alliance) {
          window.gameState.alliance = c.alliance;
        }
        // Store events if sent by server
        if (c.events) {
          window.gameState.events = c.events;
        }
        // Store market if sent by server
        if (c.market) {
          window.gameState.market = c.market;
        }
        // Store expeditions if sent by server
        if (c.expeditions) {
          window.gameState.expeditions = c.expeditions;
        }

        // Store production rates from server
        window.gameState._productionRates = c.productionRates || null;

        // Set player's planet location ONLY on first colony_state
        // (subsequent refreshes from world_tick must NOT steal the user's selection)
        if (!window._colonyInitialized) {
          window._colonyInitialized = true;
          if (c.homeGalaxy !== undefined) {
            window.gameState.universe.activeGalaxyId = c.homeGalaxy;
            window.gameState.universe.activeSectorId = c.homeSector;
            window.gameState.universe.activePlanetId = c.homePlanet;
            window.gameState.universe.zoomLevel = 'sector';
          }
        }

        // Populate Universe module with server data
        if (msg.universe && msg.universe.galaxies && msg.universe.galaxies.length > 0) {
          window.gameState.universe.galaxies = msg.universe.galaxies;
          if (window.Universe && typeof window.Universe.fromJSON === 'function') {
            window.Universe.fromJSON(msg.universe.galaxies);
          }
          // Mark the player's home planet so map rendering shows the ⌂ icon
          if (window.GalaxySystem) {
            if (c.homeGalaxy && c.homeSector && c.homePlanet) {
              GalaxySystem.markHomePlanet(c.homeGalaxy, c.homeSector, c.homePlanet);
            }
            // Ensure all planets have typeName set (server doesn't send it)
            var gals = Universe.getGalaxies();
            for (var gi = 0; gi < gals.length; gi++) {
              for (var si = 0; si < gals[gi].sectors.length; si++) {
                var planets = gals[gi].sectors[si].planets;
                for (var pi = 0; pi < planets.length; pi++) {
                  GalaxySystem.ensureTypeName(planets[pi]);
                }
              }
            }
          }
        }

        render();
      }
    });

    // Build result
    Network.on("build_result", function (msg) {
      if (msg.colony) {
        window.gameState.resources = msg.colony.resources;
        window.gameState.buildings = msg.colony.buildings;
        window.gameState._productionRates = msg.colony.productionRates || null;
        render();
      }
    });

    // Train result
    Network.on("train_result", function (msg) {
      if (msg.colony) {
        window.gameState.resources = msg.colony.resources;
        window.gameState.troops = msg.colony.troops;
        window.gameState._productionRates = msg.colony.productionRates || null;
        render();
      }
    });

    // World tick — re-render to show resource updates from server
    Network.on("world_tick", function () {
      // Periodically request fresh colony state (every 10 ticks = ~10s)
      if (!window._tickCounter) window._tickCounter = 0;
      window._tickCounter++;
      if (window._tickCounter % 5 === 0) {
        Network.getColony();
      }
      render();
    });

    // Disconnect handler
    Network.on("disconnect", function () {
      var statusEl = document.getElementById("connectionStatus");
      if (!statusEl) {
        var div = document.createElement("div");
        div.id = "connectionStatus";
        div.style.cssText = "position:fixed;bottom:10px;right:10px;background:#ff4444;color:#fff;padding:6px 14px;border-radius:6px;font-size:13px;z-index:9999;";
        div.textContent = "⚠ Disconnected from server";
        document.body.appendChild(div);
      }
    });

    // Research result
    Network.on("research_result", function (msg) {
      if (msg.colony) {
        window.gameState.research = msg.colony.research || window.gameState.research;
        window.gameState.resources = msg.colony.resources;
        window.gameState._productionRates = msg.colony.productionRates || null;
        render();
      }
    });

    // Scout result
    Network.on("scout_result", function (msg) {
      if (msg.colony) {
        window.gameState.combat = msg.colony.combat || window.gameState.combat;
        window.gameState.resources = msg.colony.resources;
        window.gameState._productionRates = msg.colony.productionRates || null;
        // Add scout report to mailbox
        if (msg.intel) {
          MailboxSystem.addMessage(window.gameState, "Attack", "Scout Report", "Intel received: Power " + msg.intel.power + ", Shield " + msg.intel.shield + ", Bunker " + msg.intel.bunker);
        }
        render();
      }
    });

    // Raid result
    Network.on("raid_result", function (msg) {
      if (msg.colony) {
        window.gameState.combat = msg.colony.combat || window.gameState.combat;
        window.gameState.resources = msg.colony.resources;
        window.gameState._productionRates = msg.colony.productionRates || null;
        render();
      }
    });

    // Expedition result
    Network.on("expedition_result", function (msg) {
      if (msg.colony) {
        window.gameState.expeditions = msg.colony.expeditions || window.gameState.expeditions;
        window.gameState.resources = msg.colony.resources;
        window.gameState.inventory = msg.colony.inventory || window.gameState.inventory;
        window.gameState._productionRates = msg.colony.productionRates || null;
        render();
      }
    });

    // Exchange result
    Network.on("exchange_result", function (msg) {
      if (msg.colony) {
        window.gameState.resources = msg.colony.resources;
        window.gameState.market = msg.colony.market || window.gameState.market;
        window.gameState._productionRates = msg.colony.productionRates || null;
        render();
      }
    });

    // Buy artifact result
    Network.on("buy_artifact_result", function (msg) {
      if (msg.colony) {
        window.gameState.resources = msg.colony.resources;
        window.gameState.inventory = msg.colony.inventory || window.gameState.inventory;
        window.gameState.market = msg.colony.market || window.gameState.market;
        window.gameState._productionRates = msg.colony.productionRates || null;
        render();
      }
    });
  }

  function init() {
    var loggedUser = null;
    try { loggedUser = localStorage.getItem("de_username"); } catch(e) {}

    window.gameState = {
      ui: { currentPage: "home", logPage: 0 },
      resources: { ore: { amount: 0, cap: 1200 }, solar: { amount: 0, cap: 1100 }, crystal: { amount: 0, cap: 900 }, isotopes: { amount: 0, cap: 700 } },
      buildings: {},
      troops: { counts: {}, queue: [] },
      research: { levels: {}, active: null, completedTotal: 0 },
      commander: { name: loggedUser ? "Commander " + loggedUser : "Commander Unknown", factionTitle: "Awaiting Server...", emblem: "\u25B3", theme: "cyan", planetName: "Unknown Planet" },
      universe: { galaxies: [], zoomLevel: "universe", activeGalaxyId: null, activeSectorId: null, activePlanetId: null, showUniverseView: false, fleets: [], discoveredPlanets: {}, hasWarpGate: false },
      events: { active: null, history: [] },
      combat: { scoutsCompleted: 0, attackWins: 0, defenseWins: 0, incomingAttacks: [], lastScouted: 0, raidHistory: [] },
      expeditions: { active: null, completed: [], queue: [] },
      inventory: { artifacts: [] },
      mailbox: { messages: [] },
      chat: { messages: [] },
      map: { nodes: [], scanProgress: 0, selectedNodeId: null, discoveredNodes: {}, scanPulses: [], camera: { zoom: 1, offsetX: 0, offsetY: 0 } },
      alliance: { joinedId: null },
      commanderStats: { rankPoints: 0 },
      log: [],
      market: { transactions: [], listings: [] },
      statusFlags: {},
      _productionRates: null,
      lastTick: Date.now(),
      tickCount: 0
    };

    // Initialize empty building entries so UI has something to render
    if (window.GameData && window.GameData.buildings) {
      Object.keys(window.GameData.buildings).forEach(function (key) {
        if (!window.gameState.buildings[key]) {
          window.gameState.buildings[key] = { level: 0, upgrading: null, integrity: 100 };
        }
      });
    }

    bindGlobalUI();
    render();
    setupNetwork();
  }

  return { init: init, render: render };
})();

window.addEventListener("DOMContentLoaded", function () {
  App.init();
});
