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

    function setupAuth() {
    var authOverlay = document.getElementById('authOverlay');
    var authError = document.getElementById('authError');
    var authUsername = document.getElementById('authUsername');
    var authPassword = document.getElementById('authPassword');
    var authActionBtn = document.getElementById('authActionBtn');
    var authToggleBtn = document.getElementById('authToggleBtn');
    var authStatus = document.getElementById('authStatus');
    var isLogin = true;

    function showError(msg) {
      if (authError) { authError.textContent = msg; authError.style.display = 'block'; }
    }
    function hideError() {
      if (authError) { authError.style.display = 'none'; }
    }
    function onAuthSuccess() {
      if (authOverlay) authOverlay.style.display = 'none';
      if (authStatus) authStatus.textContent = 'Connected as ' + Network.username;
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

    if (authToggleBtn) {
      authToggleBtn.onclick = function () {
        isLogin = !isLogin;
        authActionBtn.textContent = isLogin ? 'Login' : 'Register';
        authToggleBtn.textContent = isLogin ? 'Create New Account' : 'Back to Login';
        hideError();
      };
    }

    if (authActionBtn) {
      authActionBtn.onclick = function () {
        var u = authUsername ? authUsername.value.trim() : '';
        var p = authPassword ? authPassword.value : '';
        if (!u || !p) { showError('Please fill in all fields'); return; }
        hideError();
        if (authStatus) authStatus.textContent = 'Connecting...';
        var cb = function (err, res) {
          if (err) {
            showError(err);
            if (authStatus) authStatus.textContent = 'Failed';
            return;
          }
          onAuthSuccess();
        };
        if (isLogin) {
          Network.login(u, p, cb);
        } else {
          Network.register(u, p, cb);
        }
      };
    }

    // Try auto-login with saved credentials
    Network.init();
    setTimeout(function () {
      if (Network.isConnected) {
        onAuthSuccess();
      } else if (authStatus) {
        authStatus.textContent = 'Server offline — enter credentials to connect';
      }
    }, 2000);
  }

  function init() {
    window.gameState = GameState.load();
    window.gameState = GameState.normalizeState(window.gameState);
    CommanderSystem.applyTheme(window.gameState);
    bindGlobalUI();
    render();
    
    // Setup multiplayer auth
    setupAuth();

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