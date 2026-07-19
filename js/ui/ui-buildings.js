window.UIBuildings = (function () {
  function getBuildingCardHtml(state, key) {
    const def = GameData.buildings[key];
    const b = state.buildings[key];
    return `
      <div class="card visual-card">
        <img class="building-visual" src="${def.image || ""}" alt="${def.name}">
        <div class="space-between">
          <strong>${def.name}</strong>
          <span class="badge">Lv ${b.level}</span>
        </div>
        <div class="small">${def.effectText}</div>
        <div class="small" style="margin-top:8px;">Integrity ${b.integrity}%</div>
        <div class="progress"><span style="width:${b.integrity}%"></span></div>
        <div class="small" style="margin-top:8px;">
          ${b.upgrading ? `Upgrade in progress • ${Utils.formatTime(b.upgrading.remaining)}` : "Operational"}
        </div>
        <div class="row" style="margin-top:8px;">
          <button class="btn small" data-open-building="${key}">Manage</button>
        </div>
      </div>
    `;
  }

  function renderInfrastructureSummary(state) {
    return `
      <div class="four-col">
        <div class="card"><div class="small">Total Building Levels</div><h3>${Object.values(state.buildings).reduce((a, b) => a + b.level, 0)}</h3></div>
        <div class="card"><div class="small">Average Integrity</div><h3>${Math.round(Object.values(state.buildings).reduce((a, b) => a + b.integrity, 0) / Object.values(state.buildings).length)}%</h3></div>
        <div class="card"><div class="small">Buildings Upgrading</div><h3>${Object.values(state.buildings).filter(b => b.upgrading).length}</h3></div>
        <div class="card"><div class="small">Shield Capacity</div><h3>${BuildingSystem.getShieldStats(state).max}</h3></div>
      </div>
    `;
  }

  function renderPage(state) {
    return `
      <div class="stack">
        <div class="card">
          <div class="panel-title">Infrastructure Summary</div>
          ${renderInfrastructureSummary(state)}
        </div>

        <div class="card">
          <div class="panel-title">Buildings Infrastructure</div>
          <div class="card-grid cols-3">
            ${Object.keys(GameData.buildings).map(key => getBuildingCardHtml(state, key)).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function bindPage() {
    document.querySelectorAll("[data-open-building]").forEach(btn => {
      btn.onclick = function () {
        UIModal.openBuilding(btn.dataset.openBuilding);
      };
    });
  }

  return {
    renderPage,
    bindPage
  };
})();