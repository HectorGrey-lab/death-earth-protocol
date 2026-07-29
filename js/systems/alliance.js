window.AllianceSystem = (function () {
  function getJoinedAlliance(state) {
    if (!state.alliance || !state.alliance.joinedId) return null;
    return GameData.alliances.find(a => a.id === state.alliance.joinedId) || null;
  }

  function getAlliancesList(state) {
    return GameData.alliances || [];
  }

  function createAlliance(state, name) {
    Network.send({ type: 'alliance_create', name: name });
  }

  function joinAlliance(state, allianceId) {
    Network.send({ type: 'alliance_join', allianceId: allianceId });
  }

  function leaveAlliance(state) {
    Network.send({ type: 'alliance_leave' });
  }

  return {
    getJoinedAlliance,
    getAlliancesList,
    createAlliance,
    joinAlliance,
    leaveAlliance
  };
})();
