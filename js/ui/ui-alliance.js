window.UIAlliance = (function () {
  function renderJoined(state, joined) {
    return `
      <div class="stack">
        <div class="card">
          <div class="art-row">
            <img class="alliance-badge-img" src="${joined.image || ""}" alt="${joined.name}">
            <div style="flex:1;">
              <div class="space-between">
                <strong>${joined.name}</strong>
                <button class="btn small danger" onclick="AllianceSystem.leaveAlliance(window.gameState); window.App.render();">Leave Alliance</button>
              </div>
              <div class="small">Perk Type: ${joined.perkType}</div>
              <div class="small">Perk Value: +${Math.round(joined.perkValue * 100)}%</div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="panel-title">Members</div>
          <div class="list-tight">
            ${joined.members.map(m => `<div class="log-item">${m}</div>`).join("")}
          </div>
        </div>

        <div class="card">
          <div class="panel-title">Notices</div>
          <div class="list-tight">
            ${joined.notices.map(n => `<div class="log-item">${n}</div>`).join("")}
          </div>
        </div>
      </div>
    `;
  }

  function renderPool() {
    return `
      <div class="card-grid cols-3">
        ${GameData.alliances.map(a => `
          <div class="card visual-card">
            <div class="art-row">
              <img class="alliance-badge-img" src="${a.image || ""}" alt="${a.name}">
              <div style="flex:1;">
                <div class="space-between">
                  <strong>${a.name}</strong>
                  <span class="badge">${a.perkType}</span>
                </div>
                <div class="small">Perk +${Math.round(a.perkValue * 100)}%</div>
              </div>
            </div>
            <div class="small" style="margin-top:8px;">Members: ${a.members.join(", ")}</div>
            <button class="btn small" style="margin-top:10px;" onclick="AllianceSystem.joinAlliance(window.gameState, '${a.id}'); window.App.render();">Join</button>
          </div>
        `).join("")}
      </div>
    `;
  }

  function render(state) {
    const joined = AllianceSystem.getJoinedAlliance(state);
    return `
      <div class="stack">
        <div class="card">
          <div class="panel-title">Alliance Link Status</div>
          ${joined
            ? `<div class="small">Connection stable. Passive perk currently active.</div>`
            : `<div class="small">No alliance currently linked. Select from available pacts below.</div>`}
        </div>

        ${joined ? renderJoined(state, joined) : renderPool()}
      </div>
    `;
  }

  return { render };
})();