window.UIHome = (function () {
  function renderAlertsPreview(state) {
    const alerts = [];

    if (state.events.active) {
      alerts.push(`<div class="alert-item"><strong>${state.events.active.name}</strong><div class="small">${state.events.active.desc}</div></div>`);
    }

    state.combat.incomingAttacks.slice(0, 2).forEach(a => {
      alerts.push(`<div class="alert-item"><strong>${a.retaliation ? "Retaliation Force" : "Incoming Attack"}</strong><div class="small">Threat ${a.threatLevel} • ETA ${Utils.formatTime(a.remaining)}</div></div>`);
    });

    if (state.research.active) {
      alerts.push(`<div class="alert-item"><strong>Research Active</strong><div class="small">${GameData.research[state.research.active.category].name} • ETA ${Utils.formatTime(state.research.active.remaining)}</div></div>`);
    }

    if (!alerts.length) {
      alerts.push(`<div class="alert-item"><strong>Operational Stability</strong><div class="small">No immediate command alerts.</div></div>`);
    }

    return alerts.join("");
  }

  function renderMissionPreview(state) {
    return GameData.missions.slice(0, 3).map(m => {
      const progress = MissionSystem.getProgress(state, m);
      const pct = Math.min(100, Math.floor((progress / m.target) * 100));
      return `
        <div class="mission-item">
          <div class="space-between">
            <strong>${m.name}</strong>
            <span class="badge">${progress}/${m.target}</span>
          </div>
          <div class="small">${m.desc}</div>
          <div class="progress" style="margin-top:8px;"><span style="width:${pct}%"></span></div>
        </div>
      `;
    }).join("");
  }

  function renderMailPreview(state) {
    const recent = state.mailbox.messages.slice(0, 4);
    if (!recent.length) return `<div class="small">No recent reports.</div>`;
    return recent.map(m => `
      <div class="log-item">
        <strong>${m.subject}</strong>
        <div class="small">${m.tab} • ${new Date(m.time).toLocaleString()}</div>
      </div>
    `).join("");
  }

  function renderCommanderSummary(state) {
    const theme = GameData.themes.find(t => t.id === state.commander.theme) || GameData.themes[0];
    return `
      <div class="card">
        <div class="space-between">
          <div>
            <div class="small">Commander</div>
            <h3>${state.commander.emblem} ${state.commander.name}</h3>
          </div>
          <span class="badge">${CommanderSystem.getRank(state)}</span>
        </div>
        <div class="small">Faction: ${state.commander.factionTitle}</div>
        <div class="small">Theme Accent: ${theme.name}</div>
      </div>
    `;
  }

  function renderBaseSummary(state) {
    const joined = AllianceSystem.getJoinedAlliance(state);
    return `
      <div class="card-grid cols-2">
        <div class="card">
          <div class="small">Base Power</div>
          <h3>${Utils.formatNumber(BuildingSystem.getBasePower(state))}</h3>
        </div>
        <div class="card">
          <div class="small">Population</div>
          <h3>${Utils.formatNumber(BuildingSystem.getPopulation(state))}</h3>
        </div>
        <div class="card">
          <div class="small">Alliance</div>
          <h3>${joined ? joined.name : "Unaligned"}</h3>
        </div>
        <div class="card">
          <div class="small">Artifacts</div>
          <h3>${state.inventory.artifacts.length}</h3>
        </div>
      </div>
    `;
  }

  function renderMiniMap(state) {
    const nodes = MapSystem.getRenderableNodes(state);
    const home = nodes.find(n => n.id === "n-home");
    return `
      <div class="minimap">
        <div class="minimap-label">Tactical Mini-Map</div>
        ${home ? `<div class="minimap-home-ring" style="left:${home.x}%; top:${home.y}%"></div>` : ""}
        ${nodes.map(node => `
          <div class="minimap-node ${node.type} ${state.map.selectedNodeId === node.id ? "selected" : ""}"
               style="left:${node.x}%; top:${node.y}%"></div>
        `).join("")}
      </div>
    `;
  }

  function renderQuickActions() {
    return `
      <div class="quick-actions">
        <button class="btn" data-goto="map">Open World Map</button>
        <button class="btn" data-goto="buildings">Manage Buildings</button>
        <button class="btn" data-goto="forces">Train Forces</button>
        <button class="btn" data-goto="research">Open Research</button>
        <button class="btn" data-goto="market">Open Market</button>
        <button class="btn" data-goto="mailbox">View Reports</button>
      </div>
    `;
  }

  function render(state) {
    return `
      <div class="home-grid">
        <div class="stack">
          ${renderCommanderSummary(state)}

          <div class="card">
            <div class="panel-title">Quick Actions</div>
            ${renderQuickActions()}
          </div>

          <div class="card">
            <div class="panel-title">Mission Preview</div>
            <div class="stack">${renderMissionPreview(state)}</div>
          </div>

          <div class="card">
            <div class="panel-title">Recent Reports</div>
            <div class="stack">${renderMailPreview(state)}</div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="panel-title">Colony Status</div>
            ${renderBaseSummary(state)}
          </div>

          <div class="card">
            <div class="panel-title">Operational Theater</div>
            ${renderMiniMap(state)}
          </div>

          <div class="card">
            <div class="panel-title">Command Alerts</div>
            <div class="stack">${renderAlertsPreview(state)}</div>
          </div>

          <div class="card">
            <div class="panel-title">Active Operations</div>
            <div class="small">Troop Queue: ${state.troops.queue.length}</div>
            <div class="small">Expeditions: ${state.expeditions.queue.length}</div>
            <div class="small">Incoming Attacks: ${state.combat.incomingAttacks.length}</div>
            <div class="small">Research Active: ${state.research.active ? "Yes" : "No"}</div>
          </div>
        </div>
      </div>
    `;
  }

  function bind(state) {
    document.querySelectorAll("[data-goto]").forEach(btn => {
      btn.onclick = function () {
        state.ui.currentPage = btn.dataset.goto;
        window.App.render();
      };
    });
  }

  return {
    render,
    bind
  };
})();