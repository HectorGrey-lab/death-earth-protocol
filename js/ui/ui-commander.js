window.UICommander = (function () {
  function renderArtifacts(state) {
    if (!state.inventory.artifacts.length) return `<div class="small">No artifacts recovered.</div>`;
    return state.inventory.artifacts.slice(0, 8).map(item => {
      const art = GameData.artifacts.find(a => a.id === item.templateId);
      return `<div class="card"><strong>${art.name}</strong><div class="small">${art.rarity} • ${art.type}</div></div>`;
    }).join("");
  }

  function renderAllianceControls(state) {
    const joined = AllianceSystem.getJoinedAlliance(state);
    if (joined) {
      return `
        <div class="card">
          <div class="space-between">
            <strong>${joined.name}</strong>
            <button class="btn small danger" onclick="AllianceSystem.leaveAlliance(window.gameState); window.App.render();">Leave</button>
          </div>
          <div class="small">Perk: ${joined.perkType} +${Math.round(joined.perkValue * 100)}%</div>
          <div class="small">Members: ${joined.members.join(", ")}</div>
          <div class="list-tight" style="margin-top:8px;">
            ${joined.notices.map(n => `<div class="small">• ${n}</div>`).join("")}
          </div>
        </div>
      `;
    }

    return GameData.alliances.map(a => `
      <div class="card">
        <div class="space-between">
          <strong>${a.name}</strong>
          <button class="btn small" onclick="AllianceSystem.joinAlliance(window.gameState, '${a.id}'); window.App.render();">Join</button>
        </div>
        <div class="small">Perk: ${a.perkType} +${Math.round(a.perkValue * 100)}%</div>
        <div class="small">Members: ${a.members.length + 1}</div>
      </div>
    `).join("");
  }

  function render(state) {
    const el = Utils.el("commanderPanel");
    const activeTheme = GameData.themes.find(t => t.id === state.commander.theme) || GameData.themes[0];

    el.innerHTML = `
      <div class="two-col">
        <div class="stack">
          <div class="card">
            <div class="space-between">
              <div>
                <div class="small">Commander</div>
                <h3>${state.commander.emblem} ${state.commander.name}</h3>
              </div>
              <span class="badge">${CommanderSystem.getRank(state)}</span>
            </div>
            <div class="small">Faction: ${state.commander.factionTitle}</div>
            <hr class="sep">
            <div class="stack">
              <input id="cmdNameInput" class="input" value="${state.commander.name}">
              <input id="cmdFactionInput" class="input" value="${state.commander.factionTitle}">
              <div class="row">
                <select id="cmdEmblemSelect" class="select">
                  ${GameData.emblems.map(e => `<option value="${e}" ${state.commander.emblem === e ? "selected" : ""}>${e}</option>`).join("")}
                </select>
                <select id="cmdThemeSelect" class="select">
                  ${GameData.themes.map(t => `<option value="${t.id}" ${state.commander.theme === t.id ? "selected" : ""}>${t.name}</option>`).join("")}
                </select>
              </div>
              <button id="saveCommanderBtn" class="btn success">Save Commander Profile</button>
              <div class="small">Theme Accent: ${activeTheme.name}</div>
            </div>
          </div>

          <div class="card">
            <div class="panel-title">Alliance Link</div>
            <div class="stack">${renderAllianceControls(state)}</div>
          </div>
        </div>

        <div class="stack">
          <div class="card">
            <div class="panel-title">Research Console</div>
            ${Object.keys(GameData.research).map(key => {
              const lvl = state.research.levels[key];
              const cost = ResearchSystem.getResearchCost(key, lvl);
              const dur = ResearchSystem.getResearchDuration(state, key, lvl);
              return `
                <div class="card" style="margin-bottom:8px;">
                  <div class="space-between">
                    <strong>${GameData.research[key].name}</strong>
                    <span class="badge purple">Lv ${lvl}</span>
                  </div>
                  <div class="small">${GameData.research[key].desc}</div>
                  <div class="small">Cost: ${Utils.costToHtml(cost)}</div>
                  <div class="small">Duration: ${Utils.formatTime(dur)}</div>
                  <button class="btn small" ${state.research.active ? "disabled" : ""} onclick="ResearchSystem.startResearch(window.gameState, '${key}'); window.App.render();">Start</button>
                </div>
              `;
            }).join("")}
          </div>

          <div class="card">
            <div class="panel-title">Artifacts</div>
            <div class="card-grid cols-2">${renderArtifacts(state)}</div>
          </div>
        </div>
      </div>
    `;

    const saveBtn = Utils.el("saveCommanderBtn");
    if (saveBtn) {
      saveBtn.onclick = function () {
        CommanderSystem.saveProfile(state, {
          name: Utils.el("cmdNameInput").value,
          factionTitle: Utils.el("cmdFactionInput").value,
          emblem: Utils.el("cmdEmblemSelect").value,
          theme: Utils.el("cmdThemeSelect").value
        });
        CommanderSystem.applyTheme(state);
        window.App.render();
      };
    }
  }

  return { render };
})();