window.CommanderSystem = (function () {
  function saveProfile(state, profile) {
    state.commander.name = profile.name || state.commander.name;
    state.commander.factionTitle = profile.factionTitle || state.commander.factionTitle;
    state.commander.emblem = profile.emblem || state.commander.emblem;
    state.commander.theme = profile.theme || state.commander.theme;
  }

  function addRankPoints(state, amount) {
    state.commanderStats.rankPoints += amount;
  }

  function getRank(state) {
    const pts = state.commanderStats.rankPoints;
    let rank = GameData.ranks[0].name;
    GameData.ranks.forEach(r => {
      if (pts >= r.threshold) rank = r.name;
    });
    return rank;
  }

  function applyTheme(state) {
    const theme = GameData.themes.find(t => t.id === state.commander.theme) || GameData.themes[0];
    Utils.setAccent(theme.color);
  }

  return {
    saveProfile,
    addRankPoints,
    getRank,
    applyTheme
  };
})();