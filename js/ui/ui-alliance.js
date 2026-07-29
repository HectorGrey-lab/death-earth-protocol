window.UIAlliance = (function () {
  function renderJoined(state, joined) {
    return `
      <div class="stack">
        <div class="card">
          <div class="space-between">
            <div>
              <div class="panel-title">${joined.name}</div>
              <div class="small">Founder: ${joined.founder}</div>
            </div>
            <button class="btn small danger" onclick="AllianceSystem.leaveAlliance(window.gameState); window.App.render();">Leave Alliance</button>
          </div>
        </div>
        <div class="card">
          <div class="panel-title">Members (${joined.members.length})</div>
          <div class="list-tight">
            ${joined.members.map(m => `<div class="log-item">${m}${m === joined.founder ? ' <span class="badge">Founder</span>' : ''}</div>`).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function renderCreateAllianceForm() {
    return `
      <div class="card">
        <div class="panel-title">Create an Alliance</div>
        <div class="row" style="gap:8px;">
          <input id="createAllianceInput" class="input" placeholder="Alliance name..." style="flex:1;" maxlength="32">
          <button class="btn success" onclick="AllianceSystem.createAlliance(window.gameState, document.getElementById('createAllianceInput').value); window.App.render();">Create</button>
        </div>
      </div>
    `;
  }

  function renderPool(state) {
    var alliances = AllianceSystem.getAlliancesList(state);
    if (alliances.length === 0) {
      return `<div class="small">No alliances exist yet. Create the first one!</div>`;
    }
    return `
      <div class="stack">
        ${alliances.map(a => `
          <div class="card">
            <div class="space-between">
              <div>
                <strong>${a.name}</strong>
                <div class="small">Founder: ${a.founder} — ${a.members.length} member${a.members.length !== 1 ? 's' : ''}</div>
              </div>
              <button class="btn small" onclick="AllianceSystem.joinAlliance(window.gameState, '${a.id}'); window.App.render();">Join</button>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function render(state) {
    const joined = AllianceSystem.getJoinedAlliance(state);
    const joinedData = joined && state.alliance && state.alliance.joinedId
      ? AllianceSystem.getAlliancesList(state).find(a => a.id === state.alliance.joinedId)
      : null;
    return `
      <div class="stack">
        <div class="card">
          <div class="panel-title">Alliance Link</div>
          ${joinedData
            ? `<div class="small">Connected to <strong>${joinedData.name}</strong>.</div>`
            : `<div class="small">No alliance joined. Create your own or join an existing one below.</div>`}
        </div>
        ${joinedData ? renderJoined(state, joinedData) : renderCreateAllianceForm()}
        ${!joinedData ? '<div class="card"><div class="panel-title">Available Alliances</div>' + renderPool(state) + '</div>' : ''}
      </div>
    `;
  }

  return { render };
})();
