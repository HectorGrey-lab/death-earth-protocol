window.App = (function () {
  let tickHandle = null;

  function processTick(state, dt) {
    ResourceSystem.tick(state, dt);
    BuildingSystem.tick(state, dt);
    TroopSystem.tick(state, dt);
    ResearchSystem.tick(state, dt);
    ExpeditionSystem.tick(state, dt);
    EventSystem.tick(state, dt);
    CombatSystem.tick(state, dt);
    MapSystem.tickScanPulses(state, dt);
    TravelSystem.tick(state, dt);
    state.tickCount += 1;
  }

  function save(state) {
    state.lastAutosave = Date.now();
    GameState.save(state);
  }

  function render() {
    CommanderSystem.applyTheme(window.gameState);
    UICore.renderAll(window.gameState);
  }

  function bindNav() {
    document.querySelectorAll(".nav-btn").forEach(btn => {
      btn.onclick = function () {
        window.gameState.ui.currentPage = btn.dataset.page;
        render();
      };
    });
  }

  function bindGlobalUI() {
    Utils.el("saveBtn").onclick = function () {
      save(window.gameState);
      MailboxSystem.addSystemMail(window.gameState, "Manual save completed.");
      render();
    };

    Utils.el("resetSaveBtn").onclick = function () {
      if (!confirm("Reset Dead Earth Protocol save data?")) return;
      window.gameState = GameState.reset();
      CommanderSystem.applyTheme(window.gameState);
      save(window.gameState);
      render();
    };

    bindNav();
    UIModal.bind();
  }

  function gameLoop() {
    const now = Date.now();
    const elapsed = Math.max(1, Math.floor((now - window.gameState.lastTick) / 1000));
    window.gameState.lastTick = now;

    for (let i = 0; i < elapsed; i++) {
      processTick(window.gameState, 1);
    }

    if (now - window.gameState.lastAutosave > 10000) {
      save(window.gameState);
    }

    render();
  }

      function setupNetwork() {
    // Connect with saved credentials
    Network.init();
    
    setTimeout(function () {
      if (Network.isConnected) {
        // Render chat UI
        var container = document.getElementById('chatContainer');
        if (container) {
          container.innerHTML = UIChat.render();
          UIChat.bind();
        }
        // Wire up network events
        Network.on('chat', function (msg) {
          UIChat.addMessage(msg);
        });
        Network.on('presence', function (players) {
          UIChat.setOnlineCount(players.length);
          window._onlinePlayers = players;
        });
        Network.on('system', function (msg) {
          UIChat.addMessage(msg);
        });
        // Send initial position update
        if (window.gameState && window.gameState.universe) {
          Network.updatePosition(
            window.gameState.universe.activeGalaxyId,
            window.gameState.universe.activeSectorId,
            window.gameState.universe.activePlanetId
          );
        }
      }
    }, 2000);

    // Reconnect handler - if auth fails, redirect to login
    Network.on('auth_error', function () {
      try { localStorage.removeItem('de_token'); localStorage.removeItem('de_username'); } catch(e) {}
      window.location.href = '/login';
    });
    Network.on('disconnect', function () {
      // Will auto-reconnect
    });
  }

  function init() {
    window.gameState = GameState.load();
    window.gameState = GameState.normalizeState(window.gameState);
    // Override commander name with the logged-in user
    var loggedUser = null;
    try { loggedUser = localStorage.getItem('de_username'); } catch(e) {}
    if (loggedUser) {
      window.gameState.commander.name = 'Commander ' + loggedUser;
    }
    CommanderSystem.applyTheme(window.gameState);
    bindGlobalUI();
    render();
    
    // Setup multiplayer auth
    setupNetwork();

    if (tickHandle) clearInterval(tickHandle);
    tickHandle = setInterval(gameLoop, 1000);
  }

  return {
    init,
    render
  };
})();

window.addEventListener("DOMContentLoaded", function () {
  App.init();
});