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
    const repairCost = BuildingSystem.getRepairCost(buildingKey, b.level);
    const canRepair = b.integrity < 100 && b.level > 0; // can't repair something not built
    const isConstruction = b.level < 1;
    const reqCheck = (def && def.requires) ? RequirementsClient.check(state, def.requires) : { ok: true };
    const locked = isConstruction && !reqCheck.ok && def.requires;

    let special = "";
    if (buildingKey === "extractionGrid") {
      const rates = ResourceSystem.getProductionRates(state);
      special = `
        <div class="card" style="margin-top:8px;">
          <div class="panel-title">Production Rates</div>
          <div class="small">Ore: ${Utils.format1(rates.ore * 3600)}/h</div>
          <div class="small">Solar: ${Utils.format1(rates.solar * 3600)}/h</div>
          <div class="small">Crystal: ${Utils.format1(rates.crystal * 3600)}/h</div>
          <div class="small">Isotopes: ${Utils.format1(rates.isotopes * 3600)}/h</div>
          <div class="small" style="margin-top:6px;color:#667;">All resources: +8%/level (~10k/h at L20)</div>
        </div>
      `;
    } else if (buildingKey === "communicationsHub") {
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
          <div class="small" style="margin-top:8px;">${isConstruction ? "Build cost" : "Upgrade cost"}: ${Utils.costToHtml(cost)}</div>
          <div class="small">${isConstruction ? "Build time" : "Upgrade time"}: ${Utils.formatTime(BuildingSystem.getUpgradeTime(buildingKey, b.level))}</div>
          <div class="small">Status: ${b.upgrading ? `Upgrading • ${Utils.formatTime(b.upgrading.remaining)}` : "Operational"}</div>
          ${locked ? `<div class="small" style="color:#e68a2e;margin-top:6px;">${reqCheck.reason}</div>` : ""}
          <div class="row" style="margin-top:10px;">
            <button class="btn" ${(b.upgrading || locked) ? "disabled" : ""} onclick="Network.build('${buildingKey}'); UIModal.close();">${isConstruction ? "Construct" : "Upgrade"}</button>
            ${canRepair ? `<button class="btn warn" onclick="Network.send({type:'building_repair',buildingId:'${buildingKey}'}); UIModal.close();">Repair (${Utils.costToHtml(repairCost)})</button>` : ""}
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