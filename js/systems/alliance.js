window.AllianceSystem = (function () {
  function getJoinedAlliance(state) {
    if (!state.alliance || !state.alliance.joinedId) return null;
    return GameData.alliances.find(a => a.id === state.alliance.joinedId) || null;
  }

  function joinAlliance(state, allianceId) {
    state.alliance.joinedId = allianceId;
    const alliance = getJoinedAlliance(state);
    MailboxSystem.addMessage(state, "Alliance", "Alliance Membership Updated", `You joined ${alliance.name}. Perk: ${alliance.perkType} +${Math.round(alliance.perkValue * 100)}%.`);
  }

  function leaveAlliance(state) {
    const prev = getJoinedAlliance(state);
    state.alliance.joinedId = null;
    if (prev) MailboxSystem.addMessage(state, "Alliance", "Alliance Membership Updated", `You left ${prev.name}.`);
  }

  return {
    getJoinedAlliance,
    joinAlliance,
    leaveAlliance
  };
})();