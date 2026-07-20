window.UIModal = (function () {
  function open(title, html) {
    Utils.el("modalTitle").textContent = title;
    Utils.el("modalBody").innerHTML = html;
    Utils.el("modalOverlay").classList.remove("hidden");
  }

  function close() {
    Utils.el("modalOverlay").classList.add("hidden");
  }

  function openBuilding(buildingKey) {
    const state = window.gameState;
    const def = GameData.buildings[buildingKey];
    const b = state.buildings[buildingKey];
    const cost = BuildingSystem.getUpgradeCost(buildingKey, b.level);

    let special = "";
    if (buildingKey === "communicationsHub") {
      special = `
        <div class="panel-title">Event Activation</div>
        <div class="card-grid cols-2">
          ${GameData.events.map(ev => `
            <div class="card">
              <strong>${ev.name}</strong>
              <div class="small">${ev.desc}</div>
              <div class="small">Duration ${Utils.formatTime(ev.duration)}</div>
              <button class="btn small" ${state.events.active ? "disabled" : ""} onclick="EventSystem.activateEvent(window.gameState, '${ev.id}'); UIModal.close(); window.App.render();">Activate</button>
            </div>
          `).join("")}
        </div>
      `;
    }

    const html = `
      <div class="stack">
        <div class="card">
          <div class="space-between">
            <strong>${def.name}</strong>
            <span class="badge">Level ${b.level}</span>
          </div>
          <p>${def.effectText}</p>
          <div class="small">Integrity ${b.integrity}%</div>
          <div class="progress"><span style="width:${b.integrity}%"></span></div>
          <div class="small" style="margin-top:8px;">Upgrade cost: ${Utils.costToHtml(cost)}</div>
          <div class="small">Upgrade time: ${Utils.formatTime(BuildingSystem.getUpgradeTime(buildingKey, b.level))}</div>
          <div class="small">Status: ${b.upgrading ? `Upgrading • ${Utils.formatTime(b.upgrading.remaining)}` : "Operational"}</div>
          <div class="row" style="margin-top:10px;">
            <button class="btn" ${b.upgrading ? "disabled" : ""} onclick="Network.build('${buildingKey}'); UIModal.close();">Upgrade</button>
            <button class="btn warn" onclick="UIModal.close();">Repair</button>
          </div>
        </div>
        ${special}
      </div>
    `;

    open(def.name, html);
  }

  function bind() {
    Utils.el("modalCloseBtn").onclick = close;
    Utils.el("modalOverlay").addEventListener("click", function (e) {
      if (e.target.id === "modalOverlay") close();
    });
  }

  return {
    open,
    close,
    openBuilding,
    bind
  };
})();