window.ResearchSystem = (function () {
  function getTimeReduction(state) {
    let reduction = (state.buildings.researchLab.level - 1) * 0.08;
    const alliance = AllianceSystem.getJoinedAlliance(state);
    if (alliance && alliance.perkType === "research") reduction += alliance.perkValue;
    const activeEvent = state.events.active ? state.events.active.effect || {} : {};
    reduction += activeEvent.researchTimeReduction || 0;
    return reduction;
  }

  function getResearchCost(category, level) {
    const def = GameData.research[category];
    const mult = 1 + level * 0.6;
    const cost = {};
    Object.keys(def.baseCost).forEach(k => cost[k] = Math.floor(def.baseCost[k] * mult));
    return cost;
  }

  function getResearchDuration(state, category, level) {
    const base = GameData.research[category].durationBase * (1 + level * 0.22);
    const reduction = getTimeReduction(state);
    return Math.max(10, Math.floor(base * (1 - reduction)));
  }

  function startResearch(state, category) {
    if (state.research.active) return { ok: false, reason: "Research already active" };
    const lvl = state.research.levels[category] || 0;
    const cost = getResearchCost(category, lvl);
    if (!Utils.payCost(state, cost)) return { ok: false, reason: "Insufficient resources" };

    state.research.active = {
      category,
      remaining: getResearchDuration(state, category, lvl),
      targetLevel: lvl + 1
    };
    MailboxSystem.addSystemMail(state, `${GameData.research[category].name} initiated.`);
    return { ok: true };
  }

  function tick(state, dt) {
    const active = state.research.active;
    if (!active) return;
    active.remaining -= dt;
    if (active.remaining <= 0) {
      state.research.levels[active.category] = active.targetLevel;
      state.research.active = null;
      state.research.completedTotal += 1;
      CommanderSystem.addRankPoints(state, 1);
      MailboxSystem.addSystemMail(state, `${GameData.research[active.category].name} advanced to level ${state.research.levels[active.category]}.`);
    }
  }

  return {
    getResearchCost,
    getResearchDuration,
    startResearch,
    tick
  };
})();