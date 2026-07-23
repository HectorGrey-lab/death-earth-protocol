window.UIResources = (function () {
  function render(state) {
    const el = Utils.el("resourcePanel");
    const rates = ResourceSystem.getProductionRates(state);
    el.innerHTML = Object.keys(GameData.resources).map(key => {
      const r = state.resources[key];
      const pct = r.cap ? Math.round((r.amount / r.cap) * 100) : 0;
      return `
        <div class="resource-row">
          <div class="space-between">
            <strong>${GameData.resources[key].name}</strong>
            <span>${Utils.formatNumber(r.amount)} / ${Utils.formatNumber(r.cap)}</span>
          </div>
          <div class="small">Production ${Utils.format1(rates[key])}/s</div>
          <div class="progress"><span style="width:${pct}%"></span></div>
        </div>
      `;
    }).join("");
  }

  return { render };
})();
