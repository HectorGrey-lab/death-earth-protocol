window.UICore = (function () {
  const PAGE_META = {
    home: { title: "Command Center", subtitle: "Strategic overview of colony operations." },
    map: { title: "World Map", subtitle: "Sector intelligence, scouting, expeditions, and galactic overview." },
    buildings: { title: "Buildings", subtitle: "Infrastructure status, upgrades, repairs, and specialization." },
    forces: { title: "Forces", subtitle: "Troop roster, readiness, and training command." },
    research: { title: "Research", subtitle: "Technology development and strategic advancement." },
    missions: { title: "Mission Control", subtitle: "Tracked objectives and command rewards." },
    alliance: { title: "Alliance Link", subtitle: "Join pacts, review member networks, and apply passive perks." },
    market: { title: "Market Nexus", subtitle: "Resource exchange, artifact trade, and transaction activity." },
    chat: { title: "Global Chat", subtitle: "Communicate with all players across the galaxy." },
    mailbox: { title: "Mailbox", subtitle: "Combat reports, system notices, alliance messages, and logs." },
    leaderboard: { title: "Leaderboard", subtitle: "Top commanders across population, raids, attacks, and defence." }
  };

  // ── Mobile detection ──
  function isMobile() {
    return window.innerWidth < 768;
  }

  // ── Collapsible panels (mobile accordion for sidebar) ──
  function initCollapsiblePanels() {
    if (!isMobile()) return;
    var panels = document.querySelectorAll('.sidebar > .panel');
    panels.forEach(function(panel) {
      var title = panel.querySelector('.panel-title');
      var body = panel.querySelector('.collapsible-body') || (function() {
        // Wrap all child nodes after .panel-title into a .collapsible-body div
        var children = Array.from(panel.childNodes);
        var afterTitle = false;
        var contentNodes = [];
        children.forEach(function(node) {
          if (afterTitle) contentNodes.push(node);
          if (node === title || (node.classList && node.classList.contains('panel-title'))) afterTitle = true;
        });
        if (contentNodes.length === 0) return null;
        var wrapper = document.createElement('div');
        wrapper.className = 'collapsible-body';
        contentNodes.forEach(function(n) { wrapper.appendChild(n); });
        panel.appendChild(wrapper);
        return wrapper;
      })();

      if (!body) return;
      // If panel-title is already clickable, skip
      if (title._collapsibleBound) return;
      title._collapsibleBound = true;

      title.classList.add('collapsible-header');
      // First panel (resources) stays open; others start collapsed
      var isFirst = panel === panels[0];
      if (!isFirst) {
        body.classList.add('collapsed');
        title.classList.add('collapsed');
      }

      title.addEventListener('click', function(e) {
        e.stopPropagation();
        body.classList.toggle('collapsed');
        title.classList.toggle('collapsed');
      });
    });
  }

  // ── Connection status ──
  function showConnectionStatus(text, type) {
    var el = document.getElementById('connectionStatus');
    if (!el) return;
    el.textContent = text;
    el.className = 'connection-status';
    if (type === 'error') el.style.background = '#ff4444';
    else if (type === 'ok') el.style.background = '#69f0ae';
    else el.style.background = '#ffd166';
    el.classList.remove('hidden');
  }

  function hideConnectionStatus() {
    var el = document.getElementById('connectionStatus');
    if (el) el.classList.add('hidden');
  }

  function renderHeader(state) {
    Utils.el("headerBasePower").textContent = Utils.formatNumber(BuildingSystem.getBasePower(state));
    Utils.el("headerPopulation").textContent = Utils.formatNumber(BuildingSystem.getPopulation(state));
    Utils.el("headerUpkeep").textContent = `${Utils.format1(ResourceSystem.getUpkeep(state) * 3600)}/h`;
    Utils.el("headerRank").textContent = CommanderSystem.getRank(state);
  }

  function renderNav(state) {
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.page === state.ui.currentPage);
    });
    // Mailbox message count badge
    var countEl = document.getElementById('mailCount');
    if (countEl) {
      var total = (state.mailbox && state.mailbox.messages) ? state.mailbox.messages.filter(function(m) { return m.isNew; }).length : 0;
      if (total > 0) {
        countEl.textContent = total;
        countEl.style.display = 'inline';
      } else {
        countEl.style.display = 'none';
      }
    }
  }

  function renderShield(state) {
    const el = Utils.el("shieldPanel");
    const shield = BuildingSystem.getShieldStats(state);
    const pct = shield.max ? Math.round((shield.current / shield.max) * 100) : 0;
    el.innerHTML = `
      <div class="shield-ring" style="--pct:${pct}">
        <div class="shield-ring-inner">
          <div>
            <div style="text-align:center;font-size:22px;font-weight:bold;">${pct}%</div>
            <div class="small" style="text-align:center;">Shield</div>
          </div>
        </div>
      </div>
      <div class="space-between">
        <span class="small">Capacity</span>
        <strong>${shield.current}/${shield.max}</strong>
      </div>
    `;
  }

  function renderQueues(state) {
    const el = Utils.el("queuePanel");
    const troopQueue = state.troops.queue.map(q => `
      <div class="queue-item">
        <div><strong>Training</strong> • ${GameData.troops[q.troopKey].name} x${q.qty}</div>
        <div class="small">ETA ${Utils.formatTime(q.remaining)}</div>
      </div>
    `).join("");

    const expQueue = state.expeditions.queue.map(q => {
      const node = MapSystem.getNodeById(q.nodeId);
      return `
        <div class="queue-item">
          <div><strong>Expedition</strong> • ${node ? node.name : q.nodeId}</div>
          <div class="small">ETA ${Utils.formatTime(q.remaining)}</div>
        </div>
      `;
    }).join("");

    const research = state.research.active ? `
      <div class="queue-item">
        <div><strong>Research</strong> • ${GameData.research[state.research.active.category].name}</div>
        <div class="small">ETA ${Utils.formatTime(state.research.active.remaining)}</div>
      </div>
    ` : "";

    el.innerHTML = troopQueue || expQueue || research
      ? `${research}${troopQueue}${expQueue}`
      : `<div class="small">No active queue items.</div>`;
  }

  function renderSystemLog(state) {
    const el = Utils.el("systemLogPanel");
    const pageSize = 5;
    const totalLogs = state.log.length;
    const maxPage = Math.max(0, Math.ceil(totalLogs / pageSize) - 1);

    if (state.ui.logPage > maxPage) {
      state.ui.logPage = maxPage;
    }

    const start = state.ui.logPage * pageSize;
    const visible = state.log.slice(start, start + pageSize);

    el.innerHTML = `
      <div class="list-tight">
        ${visible.map(item => `
  <div class="log-item log-${item.type || "system"}">
    <div>
      ${item.text}
      ${(item.count || 1) > 1 ? `<span class="log-count">x${item.count}</span>` : ""}
    </div>
    <div class="small">${new Date(item.time).toLocaleTimeString()}</div>
  </div>
`).join("") || `<div class="small">No log entries.</div>`}
      </div>

      <div class="row" style="margin-top:10px; justify-content:space-between;">
        <button id="logPrevBtn" class="btn small" ${state.ui.logPage <= 0 ? "disabled" : ""}>Previous</button>
        <span class="small">Page ${totalLogs ? state.ui.logPage + 1 : 0} / ${Math.max(1, maxPage + 1)}</span>
        <button id="logNextBtn" class="btn small" ${state.ui.logPage >= maxPage ? "disabled" : ""}>Next</button>
      </div>
    `;

    const prevBtn = Utils.el("logPrevBtn");
    const nextBtn = Utils.el("logNextBtn");

    if (prevBtn) {
      prevBtn.onclick = function () {
        state.ui.logPage = Math.max(0, state.ui.logPage - 1);
        renderSystemLog(state);
      };
    }

    if (nextBtn) {
      nextBtn.onclick = function () {
        state.ui.logPage = Math.min(maxPage, state.ui.logPage + 1);
        renderSystemLog(state);
      };
    }
  }

  function renderPageFrame(state) {
    const meta = PAGE_META[state.ui.currentPage] || PAGE_META.home;
    Utils.el("pageTitle").textContent = meta.title;
    Utils.el("pageSubtitle").textContent = meta.subtitle;
  }

  function renderActivePage(state) {
    const target = Utils.el("pageContent");
    switch (state.ui.currentPage) {
      case "home":
        target.innerHTML = UIHome.render(state);
        UIHome.bind(state);
        break;
      case "map":
        target.innerHTML = UIMap.render(state);
        UIMap.bind(state);
        break;
      case "buildings":
        target.innerHTML = UIBuildings.renderPage(state);
        UIBuildings.bindPage(state);
        break;
      case "forces":
        target.innerHTML = UIForces.render(state);
        setTimeout(function() { UIForces.bind(state); }, 0);
        break;
      case "research":
        target.innerHTML = UIResearch.render(state);
        break;
      case "missions":
        target.innerHTML = UIMissions.renderPage(state);
        break;
      case "alliance":
        target.innerHTML = UIAlliance.render(state);
        break;
      case "market":
        target.innerHTML = UIMarket.render(state);
        UIMarket.bind(state);
        break;
      case "chat":
        target.innerHTML = UIChat.renderPage(state);
        setTimeout(function() { UIChat.bindPage(state); }, 0);
        break;
      case "mailbox":
        target.innerHTML = UIMailbox.renderPage(state);
        state._hasNewMail = false;
        renderNav(state);
        setTimeout(function() { UIMailbox.bind(state); }, 0);
        break;
      case "leaderboard":
        target.innerHTML = UILeaderboard.renderPage(state);
        setTimeout(function() { UILeaderboard.bindPage(state); }, 0);
        break;
      default:
        target.innerHTML = UIHome.render(state);
        UIHome.bind(state);
        break;
    }
  }

  function updateAttackGlow(state) {
    // Red border overlay when a PLAYER (PvP) attack is incoming — NPC attacks have no attacker field
    var hasPvPIncoming = !!(state.combat && state.combat.incomingAttacks && state.combat.incomingAttacks.some(function (a) { return !!a.attacker; }));
    if (hasPvPIncoming) {
      showAttackGlow();
    } else {
      hideAttackGlow();
    }
  }

  function renderAll(state) {
    renderHeader(state);
    renderNav(state);
    renderShield(state);
    renderQueues(state);
    renderSystemLog(state);
    UIResources.render(state);
    renderPageFrame(state);
    renderActivePage(state);
    updateAttackGlow(state);
    // Set up collapsible sidebar panels on mobile after content is rendered
    setTimeout(initCollapsiblePanels, 0);
    // Re-bind window resize for collapsible
    window._uiCoreResize = window._uiCoreResize || function() {
      // On resize to desktop, remove collapsible modifications (next render handles it)
    };
  }

  function renderTick(state) {
    renderHeader(state);
    renderNav(state);
    renderShield(state);
    renderQueues(state);
    renderSystemLog(state);
    UIResources.render(state);
    updateAttackGlow(state);
  }

  function showAttackGlow() {
    var overlay = document.getElementById('attack-glow-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'attack-glow-overlay';
      overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:9999;border:4px solid rgba(255,0,0,0.7);box-shadow:inset 0 0 60px rgba(255,0,0,0.3),inset 0 0 120px rgba(255,0,0,0.1);transition:opacity 0.5s;opacity:1;';
      document.body.appendChild(overlay);
    } else {
      overlay.style.opacity = '1';
    }
  }

  function hideAttackGlow() {
    var overlay = document.getElementById('attack-glow-overlay');
    if (overlay) overlay.style.opacity = '0';
  }

  return {
    renderAll,
    renderTick,
    showAttackGlow,
    hideAttackGlow,
    showConnectionStatus,
    hideConnectionStatus,
    isMobile
  };
})();