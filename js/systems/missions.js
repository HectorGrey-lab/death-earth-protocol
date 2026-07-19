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
    return !state.missions[mission.id].claimed && getProgress(state, mission) >= mission.target;
  }

  function claim(state, missionId) {
    const mission = GameData.missions.find(m => m.id === missionId);
    if (!mission) return { ok: false, reason: "Mission not found" };
    if (!canClaim(state, mission)) return { ok: false, reason: "Mission incomplete" };

    state.missions[missionId].claimed = true;
    Utils.grantResources(state, mission.reward);
    MailboxSystem.addMessage(state, "System", "Mission Reward Claimed", `${mission.name} completed. Reward: ${Utils.costToHtml(mission.reward)}.`);
    CommanderSystem.addRankPoints(state, 1);
    return { ok: true };
  }

  return {
    getProgress,
    canClaim,
    claim
  };
})();