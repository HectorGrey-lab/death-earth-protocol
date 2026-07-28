window.App = (function () {
  function render() {
    // Skip full re-render on chat ONLY if already rendered (preserves input)
    if (window.gameState && window.gameState.ui && 
        window.gameState.ui.currentPage === 'chat' &&
        document.getElementById('chatPageMsgs')) {
      return;
    }
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
    // Register chat handlers BEFORE connecting to avoid race condition
    Network.on("chat", function (msg) { UIChat.addMessage(msg); });
    Network.on("presence", function (players) {
      UIChat.setOnlineCount(players.length);
      window._onlinePlayers = players;
    });
    Network.on('chat_history', function (msg) {
      if (msg.messages && msg.messages.length) {
        UIChat.loadHistory(msg.messages);
      }
    });
    Network.on('leaderboard', function (msg) {
      if (msg.data) {
        UILeaderboard.setData(msg.data);
        if (window.gameState && window.gameState.ui && window.gameState.ui.currentPage === 'leaderboard') {
          render();
        }
      }
    });

    Network.init();

    setTimeout(function () {
      if (Network.isConnected) {
        // (chat handlers moved above — no race condition)
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
        window.gameState.research = c.research || { levels: { economy: 0, military: 0, defense: 0 }, active: null, completedTotal: 0 };
        // Ensure all 3 research categories exist (handles old saves with empty levels)
        if (window.gameState.research.levels) {
          if (window.gameState.research.levels.economy === undefined) window.gameState.research.levels.economy = 0;
          if (window.gameState.research.levels.military === undefined) window.gameState.research.levels.military = 0;
          if (window.gameState.research.levels.defense === undefined) window.gameState.research.levels.defense = 0;
        }
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

        // Restore fleets from server data (sent inside troops)
        if (window.gameState.troops && window.gameState.troops.fleets) {
          window.gameState.fleets = window.gameState.troops.fleets;
          FleetSystem.reconcile(window.gameState);
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

        UICore.renderTick(window.gameState);
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

    // World tick — update live panels only (header, nav, shield, queues, log, resources)
    Network.on("world_tick", function () {
      // Periodically request fresh colony state (every 10 ticks = ~10s)
      if (!window._tickCounter) window._tickCounter = 0;
      window._tickCounter++;
      if (window._tickCounter % 5 === 0) {
        Network.getColony();
      }
      UICore.renderTick(window.gameState);
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
      } else if (msg.error) {
        var s = window.gameState;
        if (!s.mailbox) s.mailbox = { messages: [], selectedTab: "System", selectedMessageId: null };
        MailboxSystem.addSystemMail(s, '⚠ Research failed: ' + msg.error);
      }
      render();
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


    // ── Claim Mission Result ──
    Network.on("claim_result", function (msg) {
      if (msg.colony) {
        window.gameState.missions = msg.colony.missions || window.gameState.missions;
        window.gameState.resources = msg.colony.resources;
        window.gameState._productionRates = msg.colony.productionRates || null;
      } else if (msg.error) {
        var state = window.gameState;
        if (!state.mailbox) state.mailbox = { messages: [], selectedTab: 'System', selectedMessageId: null };
        MailboxSystem.addSystemMail(state, '⚠ Mission claim failed: ' + msg.error);
      }
      window.App.render();
    });

    // ── Private Messaging ──
    Network.on("mailbox_update", function (msg) {
      if (msg.message) {
        if (!window.gameState.mailbox) window.gameState.mailbox = { messages: [] };
        if (!window.gameState.mailbox.messages) window.gameState.mailbox.messages = [];
        window.gameState.mailbox.messages.unshift(msg.message);
        window.gameState.mailbox.messages = window.gameState.mailbox.messages.slice(0, 120);
        window.gameState.mailbox.selectedTab = 'Inbox';
        window.gameState.mailbox.selectedMessageId = msg.message.id;
        // Flash the inbox tab indicator if user is not on mailbox page
        if (window.gameState.ui.currentPage !== 'mailbox') {
          window.gameState._hasNewMail = true;
        }
      }
    });

    Network.on("private_message_result", function (msg) {
      if (!msg.ok) {
        var s = window.gameState;
        if (!s.mailbox) s.mailbox = { messages: [], selectedTab: "System", selectedMessageId: null };
        MailboxSystem.addSystemMail(s, '⚠ PM failed: ' + (msg.error || 'Unknown error'));
      } else if (msg.colony) {
        window.gameState.mailbox = msg.colony.mailbox || window.gameState.mailbox;
        window.gameState._productionRates = msg.colony.productionRates || null;
        var s = window.gameState;
        if (!s.mailbox) s.mailbox = { messages: [], selectedTab: "System", selectedMessageId: null };
        MailboxSystem.addSystemMail(s, '✅ Private message sent');
      }
      render();
    });

    Network.on("attack_launched", function (msg) {
      var s = window.gameState;
      if (!msg.ok) return;
      // Update fleet with transit state
      if (msg.fleetId && s.fleets[msg.fleetId]) {
        s.fleets[msg.fleetId].transit = {
          target: msg.target,
          arrivalTime: msg.arrivalTime,
          origin: null
        };
        FleetSystem._sync(s);
      }
      // Provide visual feedback — log + clear selection
      var eta = msg.eta || '?';
      MailboxSystem.addLog(s, '🚀 Fleet launched to ' + (msg.target || 'unknown') + '. ETA ' + eta + 's');
      s._selectedFleetId = null;
      render();
    });

    Network.on("incoming_attack", function (msg) {
      var s = window.gameState;
      if (!s._incomingAttacks) s._incomingAttacks = [];
      s._incomingAttacks.push({
        attacker: msg.attacker,
        eta: msg.eta,
        arrivalTime: msg.arrivalTime,
        origin: msg.origin
      });
      render();
    });

    Network.on("attack_result", function (msg) {
      var s = window.gameState;
      if (!msg.ok) {
        MailboxSystem.addSystemMail(s, '⚠ Attack failed: ' + (msg.error || 'Unknown error'));
        render();
        return;
      }
      // Apply full colony state if provided (server sends this for both sides)
      if (msg.colony) {
        var c = msg.colony;
        s.resources = c.resources;
        s.troops = c.troops;
        s.buildings = c.buildings;
        if (c.combat) s.combat = c.combat;
        if (c.research) s.research = c.research;
        // Restore fleets from colony data (server has authoritative fleet state)
        if (s.troops && s.troops.fleets) {
          s.fleets = s.troops.fleets;
          FleetSystem.reconcile(s);
        }
      } else {
        // Fallback: apply casualties/fleet changes manually (old format)
        if (msg.fleetId && msg.casualties && s.fleets[msg.fleetId]) {
          var ft = s.fleets[msg.fleetId].troops || {};
          Object.keys(msg.casualties).forEach(function (key) {
            ft[key] = Math.max(0, (ft[key] || 0) - msg.casualties[key]);
            if (ft[key] <= 0) delete ft[key];
          });
          // Clear transit state
          delete s.fleets[msg.fleetId].transit;
          if (Object.keys(ft).length === 0) delete s.fleets[msg.fleetId];
        }
        if (msg.attackedBy && msg.casualties) {
          Object.keys(msg.casualties).forEach(function (key) {
            s.troops.counts[key] = Math.max(0, (s.troops.counts[key] || 0) - msg.casualties[key]);
          });
        }
        if (msg.loot && Object.keys(msg.loot).length) {
          Object.keys(msg.loot).forEach(function (rt) {
            if (s.resources[rt]) {
              s.resources[rt].amount = Math.min(s.resources[rt].cap || 100000, (s.resources[rt].amount || 0) + msg.loot[rt]);
            }
          });
        }
      }
      // Clear incoming attacks from this attacker
      if (s._incomingAttacks && msg.attackedBy) {
        s._incomingAttacks = s._incomingAttacks.filter(function(a) { return a.attacker !== msg.attackedBy; });
      }
      s._selectedFleetId = null;
      var logMsg = '⚔ ' + (msg.victory ? 'Victory' : 'Defeat') + ' against ' + (msg.target || msg.attackedBy || 'unknown');
      if (Object.keys(msg.loot || {}).length) {
        logMsg += '. Looted ' + Object.keys(msg.loot).map(function (k) { return msg.loot[k] + ' ' + k; }).join(', ');
      }
      if (msg.log && msg.log.length) {
        logMsg += ' | ' + msg.log.join(' | ');
      }
      MailboxSystem.addSystemMail(s, logMsg);
      render();
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
      fleets: {},
      research: { levels: { economy: 0, military: 0, defense: 0 }, active: null, completedTotal: 0 },
      commander: { name: loggedUser ? "Commander " + loggedUser : "Commander Unknown", factionTitle: "No Faction", emblem: "\u25B3", theme: "cyan", planetName: "Unknown Planet" },
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
      _incomingAttacks: [],
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
