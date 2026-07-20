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
        var container = document.getElementById("chatContainer");
        if (container) {
          container.innerHTML = UIChat.render();
          UIChat.bind();
        }
        Network.on("chat", function (msg) { UIChat.addMessage(msg); });
        Network.on("presence", function (players) {
          UIChat.setOnlineCount(players.length);
          window._onlinePlayers = players;
        });
        Network.on("system", function (msg) { UIChat.addMessage(msg); });
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
        window.gameState.research = c.research || { levels: {}, active: null, completedTotal: 0 };
        window.gameState.commander.planetName = c.planetName;
        if (msg.universe && msg.universe.galaxies) {
          window.gameState.universe.galaxies = msg.universe.galaxies;
        }
        render();
      }
    });

    Network.on("build_result", function (msg) {
      if (msg.colony) {
        window.gameState.resources = msg.colony.resources;
        window.gameState.buildings = msg.colony.buildings;
        render();
      }
    });

    Network.on("train_result", function (msg) {
      if (msg.colony) {
        window.gameState.resources = msg.colony.resources;
        window.gameState.troops = msg.colony.troops;
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
      commander: { name: loggedUser ? "Commander " + loggedUser : "Commander Unknown", factionTitle: "Awaiting Server...", emblem: "\u25B3", theme: "cyan" },
      universe: { galaxies: [], zoomLevel: "universe", activeGalaxyId: null, activeSectorId: null, activePlanetId: null, showUniverseView: false, fleets: [], discoveredPlanets: {}, hasWarpGate: false },
      events: { active: null, history: [] },
      combat: { scoutsCompleted: 0, attackWins: 0, defenseWins: 0, incomingAttacks: [], lastScouted: 0, raidHistory: [] },
      expeditions: { active: null, completed: [], queue: [] },
      inventory: { artifacts: [] },
      mailbox: { messages: [] },
      map: { nodes: [], scanProgress: 0, selectedNodeId: null, discoveredNodes: {}, scanPulses: [], camera: { zoom: 1, offsetX: 0, offsetY: 0 } },
      alliance: { joinedId: null },
      commanderStats: { rankPoints: 0 },
      log: [],
      market: { transactions: [], listings: [] },
      statusFlags: {},
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
