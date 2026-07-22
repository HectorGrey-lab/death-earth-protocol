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



  function renderCommanderSummary(state) {
    const theme = GameData.themes.find(t => t.id === state.commander.theme) || GameData.themes[0];
    return `
      <div class="card">
        <div class="space-between">
          <div>
            <div class="small">Commander</div>
            <h3>${state.commander.emblem} ${state.commander.name}</h3>
          </div>
          <div class="small">Planet: ${state.commander.planetName || "Unknown"}</div>
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





  function render(state) {
    return `
      <div class="home-grid">
        <div class="stack">
          ${renderCommanderSummary(state)}

          <div class="card">
            <div class="panel-title">Mission Preview</div>
            <div class="stack">${renderMissionPreview(state)}</div>
          </div>

          <div class="card">
            <div class="panel-title">Command Alerts</div>
            <div class="stack">${renderAlertsPreview(state)}</div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="panel-title">Colony Status</div>
            ${renderBaseSummary(state)}
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