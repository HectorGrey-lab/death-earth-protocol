window.UIResearch = (function () {
  function renderCard(state, key) {
    const lvl = state.research.levels[key];
    const def = GameData.research[key];
    const cost = ResearchSystem.getResearchCost(key, lvl);
    const dur = ResearchSystem.getResearchDuration(state, key, lvl);

    return `
      <div class="card">
        <div class="space-between">
          <strong>${def.name}</strong>
          <span class="badge purple">Lv ${lvl}</span>
        </div>
        <div class="small">${def.desc}</div>
        <div class="small">Cost: ${Utils.costToHtml(cost)}</div>
        <div class="small">Duration: ${Utils.formatTime(dur)}</div>
        <button class="btn small" ${state.research.active ? "disabled" : ""} onclick="Network.send({type:'research', category:'${key}'}); window.App.render();">Start Research</button>
      </div>
    `;
  }

  function renderActive(state) {
    if (!state.research.active) return `<div class="small">No active research.</div>`;
    return `
      <div class="card">
        <strong>${GameData.research[state.research.active.category].name}</strong>
        <div class="small">Target Level ${state.research.active.targetLevel}</div>
        <div class="small">ETA ${Utils.formatTime(state.research.active.remaining)}</div>
      </div>
    `;
  }

  function render(state) {
    return `
      <div class="stack">
        <div class="four-col">
          <div class="card"><div class="small">Economy Research</div><h3>${state.research.levels.economy}</h3></div>
          <div class="card"><div class="small">Military Research</div><h3>${state.research.levels.military}</h3></div>
          <div class="card"><div class="small">Defense Research</div><h3>${state.research.levels.defense}</h3></div>
          <div class="card"><div class="small">Completed Total</div><h3>${state.research.completedTotal}</h3></div>
        </div>

        <div class="card">
          <div class="panel-title">Active Research</div>
          ${renderActive(state)}
        </div>

        <div class="card">
          <div class="panel-title">Research Console</div>
          <div class="card-grid cols-3">
            ${Object.keys(GameData.research).map(key => renderCard(state, key)).join("")}
          </div>
        </div>
      </div>
    `;
  }

  return { render };
})();