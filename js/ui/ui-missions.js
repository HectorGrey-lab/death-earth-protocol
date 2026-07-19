window.UIMissions = (function () {
  function renderPage(state) {
    return `
      <div class="stack">
        ${GameData.missions.map(m => {
          const progress = MissionSystem.getProgress(state, m);
          const pct = Math.min(100, Math.floor((progress / m.target) * 100));
          const claimed = state.missions[m.id].claimed;
          return `
            <div class="mission-item">
              <div class="space-between">
                <strong>${m.name}</strong>
                <span class="badge ${claimed ? "green" : ""}">${claimed ? "Claimed" : `${progress}/${m.target}`}</span>
              </div>
              <div class="small">${m.desc}</div>
              <div class="progress" style="margin:8px 0;"><span style="width:${pct}%"></span></div>
              <div class="small">Reward: ${Utils.costToHtml(m.reward)}</div>
              <button class="btn small ${MissionSystem.canClaim(state, m) ? "success" : ""}" ${MissionSystem.canClaim(state, m) ? "" : "disabled"} onclick="MissionSystem.claim(window.gameState, '${m.id}'); window.App.render();">Claim</button>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  return { renderPage };
})();