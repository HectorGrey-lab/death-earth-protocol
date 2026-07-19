window.ResourceSystem = (function () {
  function getAllianceEconomyBonus(state) {
    const joined = AllianceSystem.getJoinedAlliance(state);
    return joined && joined.perkType === "economy" ? joined.perkValue : 0;
  }

  function getEventEffects(state) {
    return state.events.active ? state.events.active.effect || {} : {};
  }

  function getProductionRates(state) {
    const extLevel = state.buildings.extractionGrid.level;
    const ecoResearch = state.research.levels.economy || 0;
    const allianceBonus = getAllianceEconomyBonus(state);
    const event = getEventEffects(state);

    const mult = 1 + (extLevel - 1) * 0.12 + ecoResearch * 0.08 + allianceBonus;

    return {
      ore: 8 * mult,
      solar: 7 * mult,
      crystal: 5 * mult,
      isotopes: 3.2 * mult * (1 + (event.isotopeBoost || 0))
    };
  }

  function updateCaps(state) {
    const levelSum = Object.values(state.buildings).reduce((s, b) => s + b.level, 0);
    Object.keys(state.resources).forEach((key) => {
      const resDef = GameData.resources[key];
      if (!resDef) return;
      const baseCap = resDef.capBase;
      state.resources[key].cap = Math.floor(baseCap + levelSum * 35);
      state.resources[key].amount = Math.min(state.resources[key].cap, state.resources[key].amount);
    });
  }

  function getUpkeep(state) {
    let total = 0;
    Object.keys(state.troops.counts).forEach((key) => {
      total += state.troops.counts[key] * GameData.troops[key].upkeep;
    });
    return total;
  }

  function tick(state, dt) {
    updateCaps(state);
    const rates = getProductionRates(state);

    Object.keys(rates).forEach((key) => {
      state.resources[key].amount = Math.min(
        state.resources[key].cap,
        state.resources[key].amount + rates[key] * dt
      );
    });

    const upkeep = getUpkeep(state) * dt;
    state.resources.isotopes.amount = Math.max(0, state.resources.isotopes.amount - upkeep);

    const depletedNow = state.resources.isotopes.amount <= 0;

    if (depletedNow && !state.statusFlags.isotopeDepleted) {
      state.statusFlags.isotopeDepleted = true;
      MailboxSystem.addLog(state, "Isotope reserves depleted. Operational strain increasing.", "danger");
    }

    if (!depletedNow && state.statusFlags.isotopeDepleted) {
      state.statusFlags.isotopeDepleted = false;
      MailboxSystem.addLog(state, "Isotope reserves restored. Operational stability recovering.", "success");
    }
  }

  return {
    getProductionRates,
    getUpkeep,
    updateCaps,
    tick
  };
})();