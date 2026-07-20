window.UIMarket = (function () {
  function renderArtifacts(state) {
    if (!state.inventory.artifacts.length) return `<div class="small">No artifacts in inventory.</div>`;

    return state.inventory.artifacts.map(item => {
      const art = GameData.artifacts.find(a => a.id === item.templateId);
      return `
        <div class="card">
          <div class="art-row">
            <img class="art-thumb small" src="${art.image || ""}" alt="${art.name}">
            <div>
              <strong>${art.name}</strong>
              <div class="small">${art.rarity} • ${art.type}</div>
            </div>
          </div>
        </div>
      `;
    }).join("");
  }

  function renderListings() {
    return GameData.marketListings.map(l => {
      const art = GameData.artifacts.find(a => a.id === l.artifactId);
      return `
        <div class="card visual-card">
          <img class="art-thumb" src="${art.image || ""}" alt="${art.name}">
          <div class="space-between">
            <strong>${art.name}</strong>
            <span class="badge">${art.rarity}</span>
          </div>
          <div class="small">${art.type}</div>
          <div class="small">Price: ${Utils.costToHtml(l.price)}</div>
          <button class="btn small" onclick="Network.send({type:'buy_artifact', listingId:'${l.id}'}); window.App.render();">Buy</button>
        </div>
      `;
    }).join("");
  }

  function renderLogs(state) {
    if (!state.market.transactions.length) return `<div class="small">No transactions recorded.</div>`;
    return state.market.transactions.map(t => `
      <div class="log-item">
        <div>${t.text}</div>
        <div class="small">${new Date(t.time).toLocaleTimeString()}</div>
      </div>
    `).join("");
  }

  function render(state) {
    return `
      <div class="stack">
        <div class="three-col">
          <div class="card">
            <div class="panel-title">Resource Exchange</div>
            <div class="stack">
              <select id="marketFrom" class="select">${Object.keys(GameData.resources).map(k => `<option value="${k}">${GameData.resources[k].name}</option>`).join("")}</select>
              <select id="marketTo" class="select">${Object.keys(GameData.resources).map(k => `<option value="${k}">${GameData.resources[k].name}</option>`).join("")}</select>
              <input id="marketAmount" class="input" type="number" min="10" value="50">
              <button id="marketExchangeBtn" class="btn">Execute Exchange</button>
            </div>
          </div>

          <div class="card">
            <div class="panel-title">Artifact Inventory</div>
            <div class="list-tight">${renderArtifacts(state)}</div>
          </div>

          <div class="card">
            <div class="panel-title">Transaction Log</div>
            <div class="list-tight">${renderLogs(state)}</div>
          </div>
        </div>

        <div class="card">
          <div class="panel-title">Artifact Listings</div>
          <div class="card-grid cols-2">
            ${renderListings()}
          </div>
        </div>
      </div>
    `;
  }

  function bind(state) {
    const btn = Utils.el("marketExchangeBtn");
    if (btn) {
      btn.onclick = function () {
        Network.send({
          type: 'exchange',
          from: Utils.el("marketFrom").value,
          to: Utils.el("marketTo").value,
          amount: parseInt(Utils.el("marketAmount").value, 10)
        });
        window.App.render();
      };
    }
  }

  return {
    render,
    bind
  };
})();