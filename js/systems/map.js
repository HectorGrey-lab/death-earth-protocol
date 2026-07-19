window.MapSystem = (function () {
  function getNodes() {
    return GameData.mapNodes;
  }

  function getNodeById(id) {
    return GameData.mapNodes.find(n => n.id === id) || null;
  }

  function selectNode(state, id) {
    state.map.selectedNodeId = id;
  }

  function isDiscovered(state, nodeId) {
    return !!state.map.discoveredNodes[nodeId];
  }

  function addScanPulse(state, nodeId) {
    const node = getNodeById(nodeId);
    if (!node) return;
    state.map.scanPulses.push({
      id: Utils.uid("scan"),
      nodeId,
      x: node.x,
      y: node.y,
      life: 2.2
    });
  }

  function tickScanPulses(state, dt) {
    state.map.scanPulses.forEach(p => p.life -= dt);
    state.map.scanPulses = state.map.scanPulses.filter(p => p.life > 0);
  }

  function discoverNode(state, nodeId) {
    if (!nodeId) return;
    if (!state.map.discoveredNodes[nodeId]) {
      state.map.discoveredNodes[nodeId] = true;
      addScanPulse(state, nodeId);
      const node = getNodeById(nodeId);
      if (node) {
        MailboxSystem.addMessage(state, "System", "Sector Contact Revealed", `${node.name} has been added to command map visibility.`);
      }
    }
  }

  function discoverConnected(state, nodeId) {
    const node = getNodeById(nodeId);
    if (!node || !node.connections) return;
    node.connections.forEach(id => discoverNode(state, id));
  }

  function getVisibleNodes(state) {
    return GameData.mapNodes.filter(node => isDiscovered(state, node.id));
  }

  function getRenderableNodes(state) {
    return GameData.mapNodes.map(node => {
      const discovered = isDiscovered(state, node.id);
      if (discovered) return Object.assign({}, node, { discovered: true });

      return {
        id: node.id,
        type: "unknown",
        region: node.region,
        regionName: "Unknown Region",
        sector: "??",
        threatLevel: "?",
        icon: "?",
        name: "Unknown Contact",
        desc: "Long-range scan interference prevents positive identification.",
        x: node.x,
        y: node.y,
        connections: node.connections || [],
        discovered: false,
        realType: node.type
      };
    });
  }

  function generateEnemyProfile(node) {
    const t = node.threatLevel;
    return {
      power: 60 + t * 55,
      shield: 40 + t * 35,
      bunker: 30 + t * 20,
      buildings: 3 + t
    };
  }

  return {
    getNodes,
    getVisibleNodes,
    getRenderableNodes,
    getNodeById,
    selectNode,
    isDiscovered,
    discoverNode,
    discoverConnected,
    addScanPulse,
    tickScanPulses,
    generateEnemyProfile
  };
})();