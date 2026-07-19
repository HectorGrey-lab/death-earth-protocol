window.ExpeditionSystem = (function () {
  function launch(state, nodeId) {
    const node = MapSystem.getNodeById(nodeId);
    if (!node || node.type !== "resource") return { ok: false, reason: "Invalid expedition target" };

    const duration = Math.max(25, 70 - state.buildings.tradePodTerminal.level * 4 + node.threatLevel * 6);
    state.expeditions.queue.push({
      id: Utils.uid("exp"),
      nodeId,
      remaining: duration,
      returnsAt: Date.now() + duration * 1000
    });
    MailboxSystem.addMessage(state, "System", "Expedition Launched", `Expedition launched to ${node.name}. Estimated return: ${Utils.formatTime(duration)}.`);
    return { ok: true };
  }

  function resolveRewards(state, node) {
    const level = state.buildings.tradePodTerminal.level;
    const event = state.events.active ? state.events.active.effect || {} : {};
    const base = 1 + (level - 1) * 0.15;

    const rewards = {
      ore: Math.floor(Utils.rand(40, 85) * base),
      solar: Math.floor(Utils.rand(25, 60) * base),
      crystal: Math.floor(Utils.rand(18, 45) * base),
      isotopes: Math.floor(Utils.rand(10, 24) * base * (1 + (event.expeditionIsotopeBonus || 0)))
    };

    if (node.name.toLowerCase().includes("crystal")) rewards.crystal += 25;
    if (node.name.toLowerCase().includes("shale")) rewards.ore += 30;

    Utils.grantResources(state, rewards);

    let artifactFound = null;
    const artifactChance = 0.1 + (level - 1) * 0.04 + (event.artifactChanceBonus || 0);
    if (Utils.chance(artifactChance)) {
      artifactFound = Utils.pick(GameData.artifacts);
      state.inventory.artifacts.push({
        id: Utils.uid("artifact"),
        templateId: artifactFound.id,
        foundAt: Date.now()
      });
    }

    let body = `Expedition returned from ${node.name}. Yield: ${Utils.costToHtml(rewards)}.`;
    if (artifactFound) body += ` Artifact recovered: ${artifactFound.name} (${artifactFound.rarity}).`;

    MailboxSystem.addMessage(state, "Inbox", "Expedition Report", body);
  }

  function tick(state, dt) {
    state.expeditions.queue.forEach(item => item.remaining -= dt);
    const completed = state.expeditions.queue.filter(item => item.remaining <= 0);
    completed.forEach(item => {
      const node = MapSystem.getNodeById(item.nodeId);
      resolveRewards(state, node);
      CommanderSystem.addRankPoints(state, 1);
    });
    state.expeditions.queue = state.expeditions.queue.filter(item => item.remaining > 0);
  }

  return {
    launch,
    tick
  };
})();