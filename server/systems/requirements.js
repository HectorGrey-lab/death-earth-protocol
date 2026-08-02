/**
 * requirements.js — Shared tech-tree prerequisite checker (server-side)
 * Usage: Requirements.checkRequirements(colony, reqObj)
 *   reqObj = { buildings: {key: level}, research: {category: level} }
 * Returns { ok:true } or { ok:false, reason:'...' } — first failing requirement.
 */
const GAME = require('../game-data.json');

function checkRequirements(colony, reqObj) {
  if (!reqObj) return { ok: true };

  if (reqObj.buildings) {
    for (const key of Object.keys(reqObj.buildings)) {
      const need = reqObj.buildings[key];
      const have = colony.buildings && colony.buildings[key] ? colony.buildings[key].level || 0 : 0;
      if (have < need) {
        const name = (GAME.buildings[key] && GAME.buildings[key].name) || key;
        return { ok: false, reason: 'Requires ' + name + ' Lv' + need };
      }
    }
  }

  if (reqObj.research) {
    for (const cat of Object.keys(reqObj.research)) {
      const need = reqObj.research[cat];
      const have = colony.research && colony.research.levels ? colony.research.levels[cat] || 0 : 0;
      if (have < need) {
        const name = (GAME.research[cat] && GAME.research[cat].name) || cat;
        return { ok: false, reason: 'Requires ' + name + ' Lv' + need };
      }
    }
  }

  return { ok: true };
}

module.exports = { checkRequirements };
