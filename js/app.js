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
      }
    }, 2000);

    Network.on("auth_error", function () {
      try { localStorage.removeItem("de_token"); localStorage.removeItem("de_username"); } catch(e) {}
      window.location.href = "/login";
    });

    Network.on("colony_state", function (msg) {
      if (msg.colony) {
        var c = msg.colony;
        window.gameState.resources = c.resources;
        window.gameState.buildings = c.buildings;
        window.gameState.troops = c.troops;
        window.gameState.research = c.research || { levels: { economy: 0, military: 0, defense: 0 }, active: null, completedTotal: 0 };
        if (window.gameState.research.levels) {
          if (window.gameState.research.levels.economy === undefined) window.gameState.research.levels.economy = 0;
          if (window.gameState.research.levels.military === undefined) window.gameState.research.levels.military = 0;
          if (window.gameState.research.levels.defense === undefined) window.gameState.research.levels.defense = 0;
        }
        window.gameState.commander.planetName = c.planetName;

        if (c.missions) {
          window.gameState.missions = c.missions;
        }
        if (c.inventory) {
          window.gameState.inventory = c.inventory;
        }
        if (c.combat) {
          window.gameState.combat = c.combat;
        }
        if (c.mailbox) {
          window.gameState.mailbox = c.mailbox;
        }

        if (window.gameState.troops && window.gameState.troops.fleets) {
          window.gameState.fleets = window.gameState.troops.fleets;
          FleetSystem.reconcile(window.gameState);
        }
        if (c.alliance) {
          window.gameState.alliance = c.alliance;
        }
        // Update global alliances list from server
        if (msg.alliances) {
          window.GameData.alliances = msg.alliances;
        }
        if (c.events) {
          window.gameState.events = c.events;
        }
        if (c.market) {
          window.gameState.market = c.market;
        }
        if (c.expeditions) {
          window.gameState.expeditions = c.expeditions;
        }

        window.gameState._productionRates = c.productionRates || null;

        if (!window._colonyInitialized) {
          window._colonyInitialized = true;
          if (c.homeGalaxy !== undefined) {
            window.gameState.universe.activeGalaxyId = c.homeGalaxy;
            window.gameState.universe.activeSectorId = c.homeSector;
            window.gameState.universe.activePlanetId = c.homePlanet;
            window.gameState.universe.zoomLevel = 'sector';
          }
        }

        if (msg.universe && msg.universe.galaxies && msg.universe.galaxies.length > 0) {
          window.gameState.universe.galaxies = msg.universe.galaxies;
          if (window.Universe && typeof window.Universe.fromJSON === 'function') {
            window.Universe.fromJSON(msg.universe.galaxies);
          }
          if (window.GalaxySystem) {
            if (c.homeGalaxy && c.homeSector && c.homePlanet) {
              GalaxySystem.markHomePlanet(c.homeGalaxy, c.homeSector, c.homePlanet);
            }
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

    Network.on("build_result", function (msg) {
      if (msg.colony) {
        window.gameState.resources = msg.colony.resources;
        window.gameState.buildings = msg.colony.buildings;
        window.gameState._productionRates = msg.colony.productionRates || null;
        render();
      }
    });

    Network.on("train_result", function (msg) {
      if (msg.colony) {
        window.gameState.resources = msg.colony.resources;
        window.gameState.troops = msg.colony.troops;
        window.gameState._productionRates = msg.colony.productionRates || null;
        render();
      }
    });

    Network.on("world_tick", function () {
      if (!window._tickCounter) window._tickCounter = 0;
      window._tickCounter++;
      if (window._tickCounter % 5 === 0) {
        Network.getColony();
      }
      UICore.renderTick(window.gameState);
    });

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

    Network.on("scout_result", function (msg) {
      if (msg.colony) {
        window.gameState.combat = msg.colony.combat || window.gameState.combat;
        window.gameState.resources = msg.colony.resources;
        window.gameState._productionRates = msg.colony.productionRates || null;
        if (msg.intel) {
          MailboxSystem.addMessage(window.gameState, "Attack", "Scout Report", "Intel received: Power " + msg.intel.power + ", Shield " + msg.intel.shield + ", Bunker " + msg.intel.bunker);
        }
        render();
      }
    });

    Network.on("raid_result", function (msg) {
      if (msg.colony) {
        window.gameState.combat = msg.colony.combat || window.gameState.combat;
        window.gameState.resources = msg.colony.resources;
        window.gameState._productionRates = msg.colony.productionRates || null;
        render();
      }
    });

    Network.on("expedition_result", function (msg) {
      if (msg.colony) {
        window.gameState.expeditions = msg.colony.expeditions || window.gameState.expeditions;
        window.gameState.resources = msg.colony.resources;
        window.gameState.inventory = msg.colony.inventory || window.gameState.inventory;
        window.gameState._productionRates = msg.colony.productionRates || null;
        render();
      }
    });

    Network.on("exchange_result", function (msg) {
      if (msg.colony) {
        window.gameState.resources = msg.colony.resources;
        window.gameState.market = msg.colony.market || window.gameState.market;
        window.gameState._productionRates = msg.colony.productionRates || null;
        render();
      }
    });

    Network.on("buy_artifact_result", function (msg) {
      if (msg.colony) {
        window.gameState.resources = msg.colony.resources;
        window.gameState.inventory = msg.colony.inventory || window.gameState.inventory;
        window.gameState.market = msg.colony.market || window.gameState.market;
        window.gameState._productionRates = msg.colony.productionRates || null;
        render();
      }
    });

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

    Network.on("mailbox_update", function (msg) {
      if (msg.message) {
        if (!window.gameState.mailbox) window.gameState.mailbox = { messages: [] };
        if (!window.gameState.mailbox.messages) window.gameState.mailbox.messages = [];
        window.gameState.mailbox.messages.unshift(msg.message);
        window.gameState.mailbox.messages = window.gameState.mailbox.messages.slice(0, 120);
        window.gameState.mailbox.selectedTab = 'Inbox';
        window.gameState.mailbox.selectedMessageId = msg.message.id;
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

    Network.on("alliance_result", function (msg) {
      var s = window.gameState;
      if (msg.colony) {
        s.alliance = msg.colony.alliance || s.alliance;
        s.mailbox = msg.colony.mailbox || s.mailbox;
        s._productionRates = msg.colony.productionRates || null;
      }
      if (msg.alliances) {
        GameData.alliances = msg.alliances;
      }
      if (!msg.ok) {
        if (!s.mailbox) s.mailbox = { messages: [], selectedTab: "System", selectedMessageId: null };
        MailboxSystem.addSystemMail(s, '⚠ Alliance update failed: ' + (msg.error || 'Unknown error'));
      }
      render();
    });

    Network.on("attack_launched", function (msg) {
      console.log('[ATTACK] attack_launched received:', JSON.stringify(msg).substring(0, 200));
      var s = window.gameState;
      if (!msg.ok) { console.log('[ATTACK] attack_launched ok=false'); return; }
      if (msg.fleetId && s.fleets[msg.fleetId]) {
        s.fleets[msg.fleetId].transit = {
          target: msg.target,
          arrivalTime: msg.arrivalTime,
          origin: null
        };
        FleetSystem._sync(s);
      }
      var eta = msg.eta;
      if (!eta && msg.arrivalTime) eta = Math.round((msg.arrivalTime - Date.now()) / 1000);
      if (!eta) eta = '?';
      MailboxSystem.addLog(s, '🚀 Fleet launched to ' + (msg.target || 'unknown') + '. ETA ' + eta + 's');
      s._selectedFleetId = null;
      render();
    });

    Network.on("incoming_attack", function (msg) {
      var s = window.gameState;
      if (!s.combat) s.combat = { scoutsCompleted: 0, attackWins: 0, defenseWins: 0, incomingAttacks: [], raidHistory: [] };
      if (!s.combat.incomingAttacks) s.combat.incomingAttacks = [];
      s.combat.incomingAttacks.push({
        threatLevel: '?',
        remaining: msg.eta,
        retaliation: false,
        attacker: msg.attacker,
        origin: msg.origin
      });
      if (!s._incomingAttacks) s._incomingAttacks = [];
      s._incomingAttacks.push({
        attacker: msg.attacker,
        eta: msg.eta,
        arrivalTime: msg.arrivalTime,
        origin: msg.origin
      });
      UICore.showAttackGlow();
      render();
    });

    Network.on("attack_result", function (msg) {
      console.log('[ATTACK] attack_result received:', JSON.stringify(msg).substring(0, 300));
      var s = window.gameState;
      if (!msg.ok) {
        console.log('[ATTACK] attack_result ok=false:', msg.error);
        MailboxSystem.addSystemMail(s, '⚠ Attack failed: ' + (msg.error || 'Unknown error'));
        render();
        return;
      }
      if (msg.colony) {
        var c = msg.colony;
        s.resources = c.resources;
        s.troops = c.troops;
        s.buildings = c.buildings;
        if (c.combat) s.combat = c.combat;
        if (c.research) s.research = c.research;
        if (s.troops && s.troops.fleets) {
          s.fleets = s.troops.fleets;
          FleetSystem.reconcile(s);
        }
      } else {
        if (msg.fleetId && msg.casualties && s.fleets[msg.fleetId]) {
          var ft = s.fleets[msg.fleetId].troops || {};
          Object.keys(msg.casualties).forEach(function (key) {
            ft[key] = Math.max(0, (ft[key] || 0) - msg.casualties[key]);
            if (ft[key] <= 0) delete ft[key];
          });
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
      if (s._incomingAttacks && msg.attackedBy) {
        s._incomingAttacks = s._incomingAttacks.filter(function(a) { return a.attacker !== msg.attackedBy; });
        if (s.combat && s.combat.incomingAttacks) {
          s.combat.incomingAttacks = s.combat.incomingAttacks.filter(function(a) { return a.attacker !== msg.attackedBy; });
        }
        if (!s._incomingAttacks.length) UICore.hideAttackGlow();
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