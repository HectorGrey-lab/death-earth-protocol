window.ResourceSystem = (function () {
  // Use server-provided production rates if available
  function getProductionRates(state) {
    if (state._productionRates) {
      return state._productionRates;
    }
    // Fallback: calculate from building levels
    var rates = { ore: 0, solar: 0, crystal: 0, isotopes: 0 };
    if (state.buildings.extractionGrid) {
      rates.ore = state.buildings.extractionGrid.level * 5;
    }
    if (state.buildings.solarCollector) {
      rates.solar = state.buildings.solarCollector.level * 4;
    }
    if (state.buildings.crystalLab) {
      rates.crystal = state.buildings.crystalLab.level * 3;
    }
    return rates;
  }

  function getUpkeep(state) {
    var total = 0;
    if (state.troops && state.troops.counts) {
      Object.keys(state.troops.counts).forEach(function (key) {
        var tData = window.GameData && window.GameData.troops && window.GameData.troops[key];
        total += state.troops.counts[key] * (tData ? tData.upkeep : 1);
      });
    }
    return total;
  }

  function updateCaps(state) {
    // Caps are managed server-side, but update from building levels as fallback
    if (!state.buildings || !state.resources) return;
    var oreBonus = (state.buildings.extractionGrid ? state.buildings.extractionGrid.level * 50 : 0);
    var solarBonus = (state.buildings.solarCollector ? state.buildings.solarCollector.level * 40 : 0);
    var crystalBonus = (state.buildings.crystalLab ? state.buildings.crystalLab.level * 30 : 0);
    if (state.resources.ore) state.resources.ore.cap = 1200 + oreBonus;
    if (state.resources.solar) state.resources.solar.cap = 1100 + solarBonus;
    if (state.resources.crystal) state.resources.crystal.cap = 900 + crystalBonus;
  }

  function tick(state, dt) {
    // Client-side tick is disabled — server handles all production
    // This function is kept as a no-op for compatibility
  }

  return {
    getProductionRates: getProductionRates,
    getUpkeep: getUpkeep,
    updateCaps: updateCaps,
    tick: tick
  };
})();
