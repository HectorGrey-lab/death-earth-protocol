window.MissionSystem = (function () {
  function getProgress(state, mission) {
    switch (mission.type) {
      case "buildingLevel":
        return state.buildings[mission.targetKey].level;
      case "troopCount":
        return TroopSystem.getTotalTroops(state);
      case "researchCount":
        return state.research.completedTotal;
      case "scoutCount":
        return state.combat.scoutsCompleted;
      case "attackWins":
        return state.combat.attackWins;
      case "defenseWins":
        return state.combat.defenseWins;
      default:
        return 0;
    }
  }

  function canClaim(state, mission) {
    var m = state.missions && state.missions[mission.id];
    return m && !m.claimed && getProgress(state, mission) >= mission.target;
  }

  function claim(state, missionId) {
    // Optimistically mark as claimed locally for instant feedback
    if (state.missions && state.missions[missionId]) {
      state.missions[missionId].claimed = true;
    }
    if (window.Network) {
      Network.send({ type: 'claim_mission', missionId: missionId });
    }
  }

  return {
    getProgress: getProgress,
    canClaim: canClaim,
    claim: claim
  };
})();
