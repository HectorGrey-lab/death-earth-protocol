window.ResearchSystem = (function () {
  function getTimeReduction(state) {
    let reduction = Math.max(0, (state.buildings.researchLab.level - 1) * 0.08);
    const alliance = AllianceSystem.getJoinedAlliance(state);
    if (alliance && alliance.perkType === "research") reduction += alliance.perkValue;
    const activeEvent = state.events.active ? state.events.active.effect || {} : {};
    reduction += activeEvent.researchTimeReduction || 0;
    return Math.max(0, reduction);
  }

  function getResearchCost(category, level) {
    const def = GameData.research[category];
    const mult = 1 + level * 0.6;
    const cost = {};
    Object.keys(def.baseCost).forEach(k => cost[k] = Math.floor(def.baseCost[k] * mult));
    return cost;
  }

  function getResearchDuration(state, category, level) {
    const def = GameData.research[category];
    const pacing = (GameData.pacing) || {};
    const minL1 = pacing.researchMinL1 || 60;
    const growth = pacing.researchGrowth || 1.32;
    const weightBase = pacing.researchWeightBase || 45;
    const effectiveLevel = (level || 0) + 1; // first research => level 0 => effective 1
    const weight = Math.max(0.7, Math.min(2.5, (def.durationBase || weightBase) / weightBase));
    const base = Math.max(minL1, Math.floor(minL1 * weight * Math.pow(growth, effectiveLevel - 1)));
    const reduction = Math.max(0, getTimeReduction(state));
    return Math.max(10, Math.floor(base * (1 - reduction)));
  }

  function startResearch(state, category) {
    if (state.research.active) return { ok: false, reason: "Research already active" };
    // Tech-tree prerequisites (mirror of server check)
    const def = GameData.research[category];
    if (def && def.requires) {
      const req = RequirementsClient.check(state, def.requires);
      if (!req.ok) return { ok: false, reason: req.reason };
    }
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