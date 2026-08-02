/**
 * requirements.js — Client-side tech-tree prerequisite checker (mirror of server/systems/requirements.js)
 * Usage: RequirementsClient.check(state, reqObj)
 *   reqObj = { buildings: {key: level}, research: {category: level} }
 * Returns { ok:true } or { ok:false, reason:'...' } — first failing requirement.
 */
window.RequirementsClient = (function () {
  function check(state, reqObj) {
    if (!reqObj) return { ok: true };

    if (reqObj.buildings) {
      for (const key of Object.keys(reqObj.buildings)) {
        const need = reqObj.buildings[key];
        const b = state.buildings ? state.buildings[key] : null;
        const have = b ? b.level || 0 : 0;
        if (have < need) {
          const def = GameData.buildings[key];
          const name = (def && def.name) || key;
          return { ok: false, reason: "Requires " + name + " Lv" + need };
        }
      }
    }

    if (reqObj.research) {
      for (const cat of Object.keys(reqObj.research)) {
        const need = reqObj.research[cat];
        const have = state.research && state.research.levels ? state.research.levels[cat] || 0 : 0;
        if (have < need) {
          const def = GameData.research[cat];
          const name = (def && def.name) || cat;
          return { ok: false, reason: "Requires " + name + " Lv" + need };
        }
      }
    }

    return { ok: true };
  }

  // Helper: join multiple requirement objects (e.g. research tree root has no requirements).
  return { check: check };
})();
