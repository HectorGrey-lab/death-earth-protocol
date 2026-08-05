window.App = (function () {
  // Preserve client-side read state when server replaces the mailbox object
  function _mergeMailboxReadState(oldBox, newBox) {
    if (!newBox) return newBox;
    var readIds = {};
    if (oldBox && oldBox.messages) {
      for (var i = 0; i < oldBox.messages.length; i++) {
        if (!oldBox.messages[i].isNew) readIds[oldBox.messages[i].id] = true;
      }
    }
    if (newBox.messages) {
      for (var j = 0; j < newBox.messages.length; j++) {
        if (readIds[newBox.messages[j].id]) newBox.messages[j].isNew = false;
      }
    }
    return newBox;
  }

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
    Network.on("presence", function (msg) {
      var players = (msg && msg.players) || [];
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
        UILeaderboard.setData(msg.data, msg.alliances || null);
        if (window.gameState && window.gameState.ui && window.gameState.ui.currentPage === 'leaderboard') {
          render();
        }
      }
    });

    Network.on('profile_update_result', function (msg) {
      var msgEl = Utils.el && Utils.el("optProfileMsg");
      if (msg && msg.ok) {
        if (msgEl) msgEl.textContent = '✓ Profile saved';
        window._loginUser = (window.gameState.profile && window.gameState.profile.displayName) || window._loginUser;
        if (msg.colony) {
          // Feed the fresh colony state through the same path as colony_state
          window.gameState.commander.planetName = msg.colony.planetName;
          window.gameState.profile = msg.colony.profile || window.gameState.profile;
          if (msg.colony.profile && msg.colony.profile.displayName) {
            window.gameState.commander.name = 'Commander ' + msg.colony.profile.displayName;
          }
        }
        if (msg.universe && msg.universe.galaxies) {
          window.gameState.universe.galaxies = msg.universe.galaxies;
        }
        if (msg.alliances) {
          window.GameData.alliances = msg.alliances;
        }
        var dnView = Utils.el && Utils.el("optDisplayNameView");
        var bnView = Utils.el && Utils.el("optBaseNameView");
        if (dnView && window.gameState.profile) dnView.textContent = window.gameState.profile.displayName;
        if (bnView) bnView.textContent = window.gameState.commander.planetName;
        if (window.UIModal && window.UIModal.close) window.UIModal.close();
        render();
      } else if (msgEl) {
        msgEl.textContent = '✗ ' + ((msg && msg.error) || 'Failed to save profile');
      }
    });

    Network.on('delete_account_result', function (msg) {
      if (msg && msg.ok) {
        try { localStorage.removeItem("de_token"); localStorage.removeItem("de_username"); } catch(e) {}
        window.location.href = "/login";
      } else {
        var msgEl = Utils.el && Utils.el("optDeleteMsg");
        if (msgEl) msgEl.textContent = '✗ ' + ((msg && msg.error) || 'Delete failed');
        var delBtn = Utils.el && Utils.el("optDeleteBtn");
        if (delBtn) delBtn.disabled = false;
      }
    });

    Network.on('logout_ok', function () {
      try { localStorage.removeItem("de_token"); localStorage.removeItem("de_username"); } catch(e) {}
      window.location.href = "/login";
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
        window.gameState.profile = c.profile || { displayName: '', baseName: c.planetName || '' };
        if (!window.gameState.commander.name || /^Commander /.test(window.gameState.commander.name)) {
          window.gameState.commander.name = 'Commander ' + (c.profile && c.profile.displayName ? c.profile.displayName : (window._loginUser || ''));
        }

        if (c.missions) {
          window.gameState.missions = c.missions;
        }
        if (c.inventory) {
          window.gameState.inventory = c.inventory;
        }
        if (c.combat) {
          window.gameState.combat = c.combat;
        }
        // Drain server-side colony.log entries (e.g. repelled NPC raids that skip mail) into the system log
        if (Array.isArray(c.log)) {
          if (!window._seenColonyLogs) window._seenColonyLogs = {};
          c.log.forEach(function (le) {
            if (!le || !le.text || !le.time) return;
            var fp = le.text + '@' + le.time;
            if (window._seenColonyLogs[fp]) return;
            window._seenColonyLogs[fp] = true;
            MailboxSystem.addLog(window.gameState, le.text, 'system');
          });
        }
        if (c.mailbox) {
          // On initial load, seed the mailbox from server. On periodic syncs (every ~5s),
          // skip it — push events (mailbox_update, private_message_result, alliance_result)
          // already deliver every change in real-time.
          if (!window._colonyInitialized) {
            window.gameState.mailbox = c.mailbox;
          }
        }
        // Default to Inbox tab so PMs are visible
        if (window.gameState.mailbox) {
          window.gameState.mailbox.selectedTab = 'Inbox';
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
        // Merge server truth for balance/definitions (costs, times, tech tree) into client GameData
        if (msg.gameData) {
          var gd = msg.gameData;
          if (gd.pacing) window.GameData.pacing = gd.pacing;
          if (gd.buildings) {
            Object.keys(gd.buildings).forEach(function (bk) {
              var srv = gd.buildings[bk];
              var cli = window.GameData.buildings[bk];
              if (!cli) return;
              if (srv.baseCost) cli.baseCost = srv.baseCost;
              if (srv.timeBase !== undefined) cli.timeBase = srv.timeBase;
              if (srv.requires) cli.requires = srv.requires;
              if (srv.startLevel !== undefined) cli.startLevel = srv.startLevel;
            });
          }
          if (gd.research) {
            Object.keys(gd.research).forEach(function (rk) {
              var srv = gd.research[rk];
              var cli = window.GameData.research[rk];
              if (!cli) return;
              if (srv.baseCost) cli.baseCost = srv.baseCost;
              if (srv.durationBase !== undefined) cli.durationBase = srv.durationBase;
              if (srv.requires) cli.requires = srv.requires;
            });
          }
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
      // Only fetch colony state every 15 ticks (30s) instead of 5 (10s)
      // to reduce bandwidth. Individual action results update on their own.
      if (window._tickCounter % 15 === 0) {
        Network.getColony();
      }
      UICore.renderTick(window.gameState);
    });

    Network.on("disconnect", function () {
      var el = document.getElementById("connectionStatus");
      if (el) {
        el.textContent = "⚠ Disconnected from server";
        el.className = "connection-status";
        el.style.background = "#ff4444";
        el.classList.remove("hidden");
      } else {
        var div = document.createElement("div");
        div.id = "connectionStatus";
        div.className = "connection-status";
        div.textContent = "⚠ Disconnected from server";
        div.style.background = "#ff4444";
        document.body.appendChild(div);
      }
    });

    // ── Reconnection progress ──
    Network.on("connecting", function (info) {
      var el = document.getElementById("connectionStatus");
      if (!el) return;
      if (info.attempt > 1) {
        el.textContent = "⟳ Reconnecting… attempt " + info.attempt;
        el.style.background = "#ff8800";
        el.className = "connection-status";
        el.classList.remove("hidden");
      }
    });

    // ── Reconnected successfully ──
    Network.on("auth_ok", function () {
      var el = document.getElementById("connectionStatus");
      if (el) {
        el.textContent = "✅ Reconnected";
        el.style.background = "#69f0ae";
        el.classList.remove("hidden");
        // Auto-hide after 2s
        setTimeout(function () { el.classList.add("hidden"); }, 2000);
      }
      // Re-request colony state on reconnection
      Network.getColony();
    });

    Network.on("research_result", function (msg) {
      if (msg.colony) {
        window.gameState.research = msg.colony.research || window.gameState.research;
        window.gameState.resources = msg.colony.resources;
        window.gameState._productionRates = msg.colony.productionRates || null;
      } else if (msg.error) {
        var s = window.gameState;
        if (!s.mailbox) s.mailbox = { messages: [], selectedTab: "Inbox", selectedMessageId: null };
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
        if (!state.mailbox) state.mailbox = { messages: [], selectedTab: 'Inbox', selectedMessageId: null };
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
        render();
      }
    });

    Network.on("private_message_result", function (msg) {
      if (!msg.ok) {
        var s = window.gameState;
        if (!s.mailbox) s.mailbox = { messages: [], selectedTab: "Inbox", selectedMessageId: null };
        MailboxSystem.addSystemMail(s, '⚠ PM failed: ' + (msg.error || 'Unknown error'));
      } else if (msg.colony) {
        window.gameState.mailbox = _mergeMailboxReadState(window.gameState.mailbox, msg.colony.mailbox) || window.gameState.mailbox;
        window.gameState._productionRates = msg.colony.productionRates || null;
        var s = window.gameState;
        if (!s.mailbox) s.mailbox = { messages: [], selectedTab: "Inbox", selectedMessageId: null };
        MailboxSystem.addSystemMail(s, '✅ Private message sent');
      }
      render();
    });

    Network.on("alliance_result", function (msg) {
      var s = window.gameState;
      if (msg.colony) {
        s.alliance = msg.colony.alliance || s.alliance;
        s.mailbox = _mergeMailboxReadState(s.mailbox, msg.colony.mailbox) || s.mailbox;
        s._productionRates = msg.colony.productionRates || null;
      }
      if (msg.alliances) {
        GameData.alliances = msg.alliances;
      }
      if (!msg.ok) {
        if (!s.mailbox) s.mailbox = { messages: [], selectedTab: "Inbox", selectedMessageId: null };
        MailboxSystem.addSystemMail(s, '⚠ Alliance update failed: ' + (msg.error || 'Unknown error'));
      } else if (msg.message) {
        if (!s.mailbox) s.mailbox = { messages: [], selectedTab: "Inbox", selectedMessageId: null };
        MailboxSystem.addSystemMail(s, '✅ ' + msg.message);
      }
      render();
    });

    // Alliance chat: history replay on connect, then live entries
    Network.on("alliance_chat_history", function (msg) {
      AllianceSystem.resetChat();
      (msg.alliance || []).forEach(function (e) { AllianceSystem.pushChat({ channel: 'alliance', username: e.username, text: e.text, time: e.time }); });
      (msg.officers || []).forEach(function (e) { AllianceSystem.pushChat({ channel: 'officers', username: e.username, text: e.text, time: e.time }); });
      render();
    });

    Network.on("alliance_chat", function (msg) {
      AllianceSystem.pushChat(msg);
      render();
    });

    // Live alliance object updates (motd / perms / membership changes / broadcasts)
    Network.on("alliance_update", function (msg) {
      var s = window.gameState;
      if (!msg.alliancePublic) return;
      var list = GameData.alliances || [];
      var idx = -1;
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === msg.alliancePublic.id) { idx = i; break; }
      }
      if (idx >= 0) list[idx] = msg.alliancePublic;
      else list.push(msg.alliancePublic);
      GameData.alliances = list;
      // If the current user was kicked, clear the local join state immediately
      if (s && s.alliance && s.alliance.joinedId === msg.alliancePublic.id) {
        var stillIn = (msg.alliancePublic.members || []).some(function (m) {
          return m.username === (window.Network ? Network.username : '');
        });
        if (!stillIn) {
          s.alliance = { joinedId: null };
          if (!s.mailbox) s.mailbox = { messages: [], selectedTab: "Inbox", selectedMessageId: null };
          MailboxSystem.addSystemMail(s, '⚠ You have been removed from the alliance.');
        }
      }
      render();
    });

    // Alliance audit log fetch result
    Network.on("alliance_audit", function (msg) {
      var s = window.gameState;
      if (!s.alliance) s.alliance = { joinedId: s.alliance ? s.alliance.joinedId : null };
      s.alliance.auditEntries = (msg && msg.entries) || [];
      render();
    });

    Network.on("attack_launched", function (msg) {
      console.log('[ATTACK] attack_launched received:', JSON.stringify(msg).substring(0, 200));
      var s = window.gameState;
      if (!msg.ok) { console.log('[ATTACK] attack_launched ok=false'); return; }
      if (msg.fleetId && s.fleets[msg.fleetId]) {
        s.fleets[msg.fleetId].transit = msg.transit || {
          mode: 'pvp_attack',
          returning: false,
          startTime: Date.now(),
          attacker: Network.username,
          defender: msg.target,
          target: msg.target,
          arrivalTime: msg.arrivalTime
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
      universe: { galaxies: [], zoomLevel: "universe", activeGalaxyId: null, activeSectorId: null, activePlanetId: null, showUniverseView: false, fleets: [], discoveredPlanets: {}, hasWarpGate: false, camera: { zoom: 1, panX: 0, panY: 0 } },
      events: { active: null, history: [] },
      combat: { scoutsCompleted: 0, attackWins: 0, defenseWins: 0, incomingAttacks: [], lastScouted: 0, raidHistory: [] },
      expeditions: { active: null, completed: [], queue: [] },
      inventory: { artifacts: [] },
      mailbox: { messages: [], selectedTab: 'Inbox' },
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
