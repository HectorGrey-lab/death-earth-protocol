window.UIForces = (function () {
  function renderRoster(state) {
    return Object.keys(GameData.troops).map(key => {
      const t = GameData.troops[key];
      return `
        <div class="card visual-card">
          <img class="troop-portrait" src="${t.image || ""}" alt="${t.name}">
          <div class="space-between">
            <strong>${t.name}</strong>
            <span class="badge">${state.troops.counts[key]}</span>
          </div>
          <div class="small">${t.role}</div>
          <div class="small">Power ${t.power} • Defense ${t.defense}</div>
          <div class="small">Upkeep ${t.upkeep}/s</div>
          <div class="small">Train Time ${Utils.formatTime(t.trainTime)}</div>
          <div class="small">Cost: ${Utils.costToHtml(t.cost)}</div>
          <div class="row" style="margin-top:8px;">
            <button class="btn small" onclick="Network.train('${key}', 1);">Train 1</button>
            <button class="btn small" onclick="Network.train('${key}', 5);">Train 5</button>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderQueue(state) {
    if (!state.troops.queue.length) return `<div class="small">No active troop training.</div>`;
    return state.troops.queue.map(q => `
      <div class="queue-item">
        <strong>${GameData.troops[q.troopKey].name} x${q.qty}</strong>
        <div class="small">ETA ${Utils.formatTime(q.remaining)}</div>
      </div>
    `).join("");
  }

  function render(state) {
    return `
      <div class="stack">
        <div class="four-col">
          <div class="card"><div class="small">Total Troops</div><h3>${TroopSystem.getTotalTroops(state)}</h3></div>
          <div class="card"><div class="small">Total Power</div><h3>${TroopSystem.getTotalPower(state)}</h3></div>
          <div class="card"><div class="small">Total Defense</div><h3>${TroopSystem.getTotalDefense(state)}</h3></div>
          <div class="card"><div class="small">Isotope Upkeep</div><h3>${Utils.format1(ResourceSystem.getUpkeep(state))}/s</h3></div>
        </div>

        <div class="two-col">
          <div class="card">
            <div class="panel-title">Training Command</div>
            <div class="card-grid cols-2">
              ${renderRoster(state)}
            </div>
          </div>
          <div class="card">
            <div class="panel-title">Training Queue</div>
            <div class="stack">
              ${renderQueue(state)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  return { render };
})();