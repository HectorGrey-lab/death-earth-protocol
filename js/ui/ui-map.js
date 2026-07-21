/**
 * ui-map.js — World Map UI Renderer
 * 
 * Renders the primary World Map with two modes:
 *   1. Tactical Mode (default) — original node-based tactical map with regions, scouts, raids
 *   2. Universe Mode — galaxy/sector/planet hierarchy on top of the tactical data
 * 
 * CHANGELOG:
 *   2026-07-18: Phase 2 — Added universe view alongside tactical map
 *     - Universe toggle button switches between "Tactical View" and "Universe View"
 *     - Three zoom tiers: Universe (9 galaxies) → Galaxy (15 sectors) → Sector (30-50 planets)
 *     - Fleet markers and travel queue visible in universe mode
 *     - Sector→planet click navigation fixed
 *   2026-07-18: Phase 3 — Added fleet markers, travel queue, planet travel info
 *     - Moving fleet markers with trails in universe view
 *     - Send Scout button on planet selection
 *     - Distance and travel time displayed when clicking a planet
 *     - Fleet queue panel in sidebar
 */

window.UIMap = (function () {
  'use strict';

  // ══════════════════════════════════════════════
  //  TACTICAL MAP MODE (original unchanged code)
  // ══════════════════════════════════════════════

  const REGION_LAYOUTS = {
    r1: { left: 4, top: 48, width: 35, height: 42, label: "Ash Meridian" },
    r2: { left: 40, top: 38, width: 34, height: 45, label: "Glass Barrens" },
    r3: { left: 72, top: 8, width: 24, height: 36, label: "Black Scar" }
  };

  let dragState = {
    active: false,
    startX: 0,
    startY: 0,
    originX: 0,
    originY: 0
  };

  function threatBadge(level) {
    if (level === "?") return `<span class="badge">Unknown</span>`;
    if (level <= 1) return `<span class="badge green">Low</span>`;
    if (level <= 2) return `<span class="badge yellow">Elevated</span>`;
    if (level <= 3) return `<span class="badge red">High</span>`;
    return `<span class="badge purple">Severe</span>`;
  }

  function nodeTypeLabel(type) {
    if (type === "player") return "Colony Base";
    if (type === "enemy") return "Enemy Stronghold";
    if (type === "resource") return "Resource Sector";
    if (type === "alliance") return "Alliance Relay";
    if (type === "unknown") return "Unknown Contact";
    return type;
  }

  function getSelectedNode(state, nodes) {
    return nodes.find(n => n.id === state.map.selectedNodeId) || nodes[0] || null;
  }

  function isNodeRelatedToSelected(state, node) {
    const selected = MapSystem.getNodeById(state.map.selectedNodeId);
    if (!selected) return false;
    if (selected.id === node.id) return true;
    return (selected.connections || []).includes(node.id);
  }

  function drawConnections(state, nodes) {
    const lines = [];
    const seen = {};
    const selected = MapSystem.getNodeById(state.map.selectedNodeId);

    nodes.forEach(node => {
      (node.connections || []).forEach(targetId => {
        const key = [node.id, targetId].sort().join("--");
        if (seen[key]) return;
        seen[key] = true;

        const target = nodes.find(n => n.id === targetId);
        if (!target) return;

        const dx = target.x - node.x;
        const dy = target.y - node.y;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;

        let cls = "dim";
        if (selected && (selected.id === node.id || selected.id === target.id || (selected.connections || []).includes(node.id) || (selected.connections || []).includes(target.id))) {
          cls = "highlight";
        }

        lines.push(`
          <div class="map-connection ${cls}"
            style="
              left:${node.x}%;
              top:${node.y}%;
              width:${length}%;
              transform: rotate(${angle}deg);
            "></div>
        `);
      });
    });

    return lines.join("");
  }

  function getFleetPosition(fromNode, toNode, progress) {
    const x = fromNode.x + (toNode.x - fromNode.x) * progress;
    const y = fromNode.y + (toNode.y - fromNode.y) * progress;
    return { x, y };
  }

  function getTrailStyle(x1, y1, x2, y2, cls) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    return `
      <div class="fleet-trail ${cls}"
        style="
          left:${x1}%;
          top:${y1}%;
          width:${length}%;
          transform: rotate(${angle}deg);
        "></div>
    `;
  }

  function renderScanPulses(state) {
    return state.map.scanPulses.map(p => `
      <div class="scan-pulse" style="left:${p.x}%; top:${p.y}%"></div>
    `).join("");
  }

  function renderInfluence(nodes, state) {
    return nodes.map(node => {
      const related = isNodeRelatedToSelected(state, node);
      const cls = `${node.type} ${related ? "" : "unrelated"}`;
      return `<div class="map-influence ${cls}" style="left:${node.x}%; top:${node.y}%"></div>`;
    }).join("");
  }

  function renderAlertOverlays(state) {
    const overlays = [];
    const home = MapSystem.getNodeById("n-home");

    if (state.combat.incomingAttacks.length && home) {
      overlays.push(`<div class="map-alert-ring home-threat" style="left:${home.x}%; top:${home.y}%"></div>`);
    }

    state.expeditions.queue.forEach(item => {
      const node = MapSystem.getNodeById(item.toNodeId);
      if (node) overlays.push(`<div class="map-alert-ring expedition-target" style="left:${node.x}%; top:${node.y}%"></div>`);
    });

    state.combat.incomingAttacks.forEach(item => {
      const node = MapSystem.getNodeById(item.fromNodeId);
      if (node) overlays.push(`<div class="map-alert-ring hostile-origin" style="left:${node.x}%; top:${node.y}%"></div>`);
    });

    return overlays.join("");
  }

  function renderFleets(state) {
    const html = [];

    state.expeditions.queue.forEach(item => {
      const fromNode = MapSystem.getNodeById(item.fromNodeId);
      const toNode = MapSystem.getNodeById(item.toNodeId);
      if (!fromNode || !toNode || !item.totalDuration) return;

      const elapsedRatio = 1 - (item.remaining / item.totalDuration);

      if (elapsedRatio <= 0.5) {
        const outboundProgress = elapsedRatio / 0.5;
        const pos = getFleetPosition(fromNode, toNode, outboundProgress);
        html.push(getTrailStyle(fromNode.x, fromNode.y, pos.x, pos.y, "expedition"));
        html.push(`<div class="fleet-marker expedition" style="left:${pos.x}%; top:${pos.y}%;" title="Outbound Expedition Fleet">⇢</div>`);
      } else {
        const returnProgress = (elapsedRatio - 0.5) / 0.5;
        const pos = getFleetPosition(toNode, fromNode, returnProgress);
        html.push(getTrailStyle(toNode.x, toNode.y, pos.x, pos.y, "returning"));
        html.push(`<div class="fleet-marker returning" style="left:${pos.x}%; top:${pos.y}%;" title="Returning Expedition Fleet">⇠</div>`);
      }
    });

    state.combat.incomingAttacks.forEach(item => {
      const fromNode = MapSystem.getNodeById(item.fromNodeId || "n-enemy-1");
      const toNode = MapSystem.getNodeById(item.toNodeId || "n-home");
      if (!fromNode || !toNode || !item.totalDuration) return;

      const progress = 1 - (item.remaining / item.totalDuration);
      const pos = getFleetPosition(fromNode, toNode, progress);

      html.push(getTrailStyle(fromNode.x, fromNode.y, pos.x, pos.y, "hostile"));
      html.push(`<div class="fleet-marker hostile" style="left:${pos.x}%; top:${pos.y}%;" title="Incoming Hostile Force">⚔</div>`);
    });

    return html.join("");
  }

  function getNodeStatuses(state, node) {
    const statuses = [];
    if (state.map.selectedNodeId === node.id) statuses.push({ cls: "selected", icon: "◎", title: "Selected Node" });
    if (state.expeditions.queue.some(q => q.toNodeId === node.id)) statuses.push({ cls: "expedition", icon: "⇢", title: "Active Expedition Target" });
    if (state.combat.incomingAttacks.some(a => a.fromNodeId === node.id)) statuses.push({ cls: "hostile", icon: "⚠", title: "Hostile Origin" });
    return statuses;
  }

  function renderNodeTooltip(node) {
    const desc = node.discovered ? node.desc : "Long-range scan interference prevents positive identification.";
    return `
      <div class="map-tooltip">
        <div class="map-tooltip-title">${node.icon} ${node.name}</div>
        <div class="map-tooltip-meta">${node.regionName} • Sector ${node.sector} • ${nodeTypeLabel(node.type)}</div>
        <div class="map-tooltip-desc">${desc}</div>
      </div>
    `;
  }

  function getRegionControlStats(state, regionKey) {
    const nodes = MapSystem.getRenderableNodes(state).filter(n => n.region === regionKey);
    return {
      player: nodes.filter(n => n.type === "player").length,
      enemy: nodes.filter(n => n.type === "enemy").length,
      alliance: nodes.filter(n => n.type === "alliance").length,
      resource: nodes.filter(n => n.type === "resource").length,
      unknown: nodes.filter(n => n.type === "unknown").length
    };
  }

  function renderRegionControl(state) {
    return `
      <div class="card">
        <div class="panel-title">Regional Control</div>
        <div class="region-control-grid">
          ${Object.keys(REGION_LAYOUTS).map(regionKey => {
            const region = REGION_LAYOUTS[regionKey];
            const stats = getRegionControlStats(state, regionKey);
            return `
              <div class="region-control-card">
                <strong>${region.label}</strong>
                <div class="region-control-row"><span>Player</span><span>${stats.player}</span></div>
                <div class="region-control-row"><span>Enemy</span><span>${stats.enemy}</span></div>
                <div class="region-control-row"><span>Alliance</span><span>${stats.alliance}</span></div>
                <div class="region-control-row"><span>Resource</span><span>${stats.resource}</span></div>
                <div class="region-control-row"><span>Unknown</span><span>${stats.unknown}</span></div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  function renderNodeDetails(state, node) {
    if (!node) return `<div class="small">No node selected.</div>`;

    if (!node.discovered) {
      return `
        <div class="card">
          <div class="space-between">
            <h3>? Unknown Contact</h3>
            <span class="badge">Unresolved</span>
          </div>
          <div class="small">Sector ${node.sector}</div>
          <p>Signal distortion prevents full identification. Additional scouting or regional expansion required.</p>
        </div>
      `;
    }

    const profile = node.type === "enemy" ? MapSystem.generateEnemyProfile(node) : null;
    const intel = state.combat.scoutingIntel[node.id];

    let actions = "";
    if (node.type === "enemy") {
      actions = `
        <div class="row">
          <button class="btn" data-scout="${node.id}">Scout</button>
          <button class="btn warn" data-raid="${node.id}">Launch Raid</button>
        </div>
        <div class="intel-panel-block">
          <div class="panel-title">Recon Status</div>
          ${intel
            ? `
              <div class="intel-stat-grid">
                <div class="intel-stat"><div class="k">Power</div><div class="v">${intel.power}</div></div>
                <div class="intel-stat"><div class="k">Shield</div><div class="v">${intel.shield}</div></div>
                <div class="intel-stat"><div class="k">Bunker</div><div class="v">${intel.bunker}</div></div>
                <div class="intel-stat"><div class="k">Structures</div><div class="v">${intel.buildings}</div></div>
              </div>
            `
            : `
              <div class="small">No confirmed reconnaissance package. Estimated hostile presence detected.</div>
              <div class="intel-stat-grid" style="margin-top:10px;">
                <div class="intel-stat"><div class="k">Estimated Power</div><div class="v">${profile.power}</div></div>
                <div class="intel-stat"><div class="k">Estimated Shield</div><div class="v">${profile.shield}</div></div>
                <div class="intel-stat"><div class="k">Estimated Bunker</div><div class="v">${profile.bunker}</div></div>
                <div class="intel-stat"><div class="k">Threat</div><div class="v">${node.threatLevel}</div></div>
              </div>
            `}
        </div>
      `;
    } else if (node.type === "resource") {
      actions = `
        <div class="row">
          <button class="btn success" data-expedition="${node.id}">Launch Expedition</button>
        </div>
        <div class="intel-panel-block">
          <div class="panel-title">Recovery Outlook</div>
          <div class="small">Trade Pod Terminal level improves extraction return and artifact chance.</div>
          <div class="intel-stat-grid" style="margin-top:10px;">
            <div class="intel-stat"><div class="k">Threat</div><div class="v">${node.threatLevel}</div></div>
            <div class="intel-stat"><div class="k">Return Bias</div><div class="v">${node.name.includes("Crystal") ? "Crystal" : "Ore"}</div></div>
          </div>
        </div>
      `;
    } else if (node.type === "alliance") {
      actions = `<div class="intel-panel-block"><div class="panel-title">Diplomatic Relay</div><div class="small">Neutral route exchange point for alliance communication, convoy routing, and passive support access.</div></div>`;
    } else if (node.type === "player") {
      actions = `<div class="intel-panel-block"><div class="panel-title">Home Sector</div><div class="small">Primary colony core. Infrastructure command, shield grid, and defense coordination originate here.</div></div>`;
    } else {
      actions = `<div class="intel-panel-block"><div class="panel-title">Unknown Signal</div><div class="small">Long-range telemetry is incomplete. Recon activity recommended.</div></div>`;
    }

    const connections = (MapSystem.getNodeById(node.id)?.connections || []).length;

    return `
      <div class="card">
        <div class="space-between">
          <h3>${node.icon} ${node.name}</h3>
          ${threatBadge(node.threatLevel)}
        </div>
        <div class="small">${node.regionName} • Sector ${node.sector}</div>
        <div class="small">${nodeTypeLabel(node.type)}</div>
        <p>${node.desc}</p>
        <div class="intel-stat-grid" style="margin-bottom:12px;">
          <div class="intel-stat"><div class="k">Threat</div><div class="v">${node.threatLevel}</div></div>
          <div class="intel-stat"><div class="k">Routes</div><div class="v">${connections}</div></div>
        </div>
        ${actions}
      </div>
    `;
  }

  function renderLegend() {
    return `
      <div class="card">
        <div class="panel-title">Map Legend</div>
        <div class="map-legend">
          <div class="legend-row"><span class="legend-dot player"></span><span class="small">Player Base</span></div>
          <div class="legend-row"><span class="legend-dot enemy"></span><span class="small">Enemy Base</span></div>
          <div class="legend-row"><span class="legend-dot resource"></span><span class="small">Resource Node</span></div>
          <div class="legend-row"><span class="legend-dot alliance"></span><span class="small">Alliance Outpost</span></div>
          <div class="legend-row"><span class="legend-dot unknown"></span><span class="small">Unknown Contact</span></div>
        </div>
      </div>
    `;
  }

  function renderSummary(state) {
    const discovered = Object.values(state.map.discoveredNodes).filter(Boolean).length;
    return `
      <div class="card">
        <div class="panel-title">Operational Summary</div>
        <div class="intel-stat-grid">
          <div class="intel-stat"><div class="k">Scouts</div><div class="v">${state.combat.scoutsCompleted}</div></div>
          <div class="intel-stat"><div class="k">Raid Wins</div><div class="v">${state.combat.attackWins}</div></div>
          <div class="intel-stat"><div class="k">Defense Wins</div><div class="v">${state.combat.defenseWins}</div></div>
          <div class="intel-stat"><div class="k">Visible Nodes</div><div class="v">${discovered}</div></div>
        </div>
      </div>
    `;
  }

  function renderTacticalMap(state) {
    const nodes = MapSystem.getRenderableNodes(state);
    const selected = getSelectedNode(state, nodes);
    const cam = state.map.camera || { zoom: 1, offsetX: 0, offsetY: 0 };

    const regionsHtml = Object.keys(REGION_LAYOUTS).map(key => {
      const r = REGION_LAYOUTS[key];
      return `<div class="region-overlay region-${key}" style="left:${r.left}%; top:${r.top}%; width:${r.width}%; height:${r.height}%;">
          <div class="region-label">${r.label}</div>
        </div>`;
    }).join("");

    const nodesHtml = nodes.map(node => {
      const related = isNodeRelatedToSelected(state, node);
      const statuses = getNodeStatuses(state, node);
      return `
        <div
          class="map-node ${node.type} ${state.map.selectedNodeId === node.id ? "selected" : ""} ${node.discovered ? "" : "fogged"} ${related ? "connected" : "unrelated"}"
          data-node-id="${node.id}"
          style="left:${node.x}%; top:${node.y}%;">
          ${statuses.map(s => `<div class="map-node-status ${s.cls}" title="${s.title}">${s.icon}</div>`).join("")}
          <div class="map-node-core">${node.icon}</div>
          <div class="map-node-name">${node.name}</div>
          <div class="map-node-meta">${node.sector}</div>
          ${renderNodeTooltip(node)}
        </div>
      `;
    }).join("");

    return `
      <div class="tactical-map-layout">
        <div class="stack">
          <div class="map-camera-controls">
            <button class="btn small" id="mapZoomInBtn">Zoom In</button>
            <button class="btn small" id="mapZoomOutBtn">Zoom Out</button>
            <button class="btn small" id="mapResetViewBtn">Reset View</button>
            <span class="small">Zoom ${Math.round(cam.zoom * 100)}%</span>
          </div>

          <div class="map-stage-viewport" id="mapViewport">
            <div
              class="map-stage focus-mode"
              id="mapStage"
              style="transform: translate(${cam.offsetX}px, ${cam.offsetY}px) scale(${cam.zoom});">
              <div class="map-surface" id="mapSurface">
                <div class="map-scan-sweep"></div>
                ${regionsHtml}
                ${renderInfluence(nodes, state)}
                ${renderAlertOverlays(state)}
                ${drawConnections(state, nodes)}
                ${renderFleets(state)}
                ${renderScanPulses(state)}
                ${nodesHtml}
              </div>
            </div>
          </div>
        </div>

        <div class="stack">
          ${renderNodeDetails(state, selected)}
          ${renderSummary(state)}
          ${renderRegionControl(state)}
          ${renderLegend()}
        </div>
      </div>
    `;
  }

  // ══════════════════════════════════════════════
  //  UNIVERSE VIEW MODE — Galaxy/Sector/Planet
  // ══════════════════════════════════════════════

  function planetTypeColor(typeId) {
    const t = Universe.PLANET_TYPES.find(pt => pt.id === typeId);
    return t ? t.color : '#aaa';
  }

  function sectorBadge(idx) {
    if (idx < 5) return `<span class="badge green">Core</span>`;
    if (idx < 10) return `<span class="badge yellow">Mid</span>`;
    return `<span class="badge red">Fringe</span>`;
  }

  // Universe view: 9 galaxy clusters
  function renderUniverseView(state) {
    const galaxies = Universe.getGalaxies();
    if (!galaxies || !galaxies.length) return '<div class="small">Universe not initialized.</div>';

    return galaxies.map(gal => {
      const isActive = state.universe.activeGalaxyId === gal.id;
      const col = (gal.index % 3);
      const row = Math.floor(gal.index / 3);
      const left = 5 + col * 33;
      const top = 5 + row * 30;

      return `
        <div class="galaxy-node universe ${isActive ? 'selected' : ''}"
             data-galaxy-id="${gal.id}"
             data-uv-zoom="galaxy"
             style="left:${left}%; top:${top}%;">
          <div class="galaxy-core" style="
            background: radial-gradient(circle at 40% 40%, ${gal.color}88, ${gal.color}22);
            box-shadow: 0 0 40px ${gal.color}44, inset 0 0 30px ${gal.color}22;
            border-color: ${gal.color}88;
          ">
            <div class="galaxy-core-inner" style="border-color:${gal.color}44"></div>
          </div>
          <div class="galaxy-name">${gal.name}</div>
          <div class="galaxy-meta">${gal.sectors.length} sectors</div>
        </div>
      `;
    }).join('');
  }

  // Galaxy view: 15 sectors
  function renderGalaxyView(state) {
    const gal = Universe.getGalaxy(state.universe.activeGalaxyId);
    if (!gal) return '';

    return gal.sectors.map(sec => {
      const isActive = state.universe.activeSectorId === sec.id;
      return `
        <div class="galaxy-node sector ${isActive ? 'selected' : ''}"
             data-galaxy-id="${gal.id}"
             data-sector-id="${sec.id}"
             data-uv-zoom="sector"
             style="left:${sec.x}%; top:${sec.y}%;">
          <div class="sector-core ${isActive ? 'selected' : ''}">
            ${sec.label}
          </div>
          <div class="galaxy-name">${sec.name}</div>
          <div class="galaxy-meta">${sec.planets.length} planets</div>
          ${sectorBadge(sec.index)}
        </div>
      `;
    }).join('');
  }

  // Sector view: 30-50 planets
  function renderSectorView2(state) {
    const sec = Universe.getSector(state.universe.activeGalaxyId, state.universe.activeSectorId);
    if (!sec) return '';

    return sec.planets.map(p => {
      const isActive = state.universe.activePlanetId === p.id;
      const discovered = GalaxySystem.isDiscovered(state, p.id);
      const isPlayer = p.isPlayerBase;
      const isColonized = p.colonizedBy && !isPlayer;
      const color = planetTypeColor(p.type);

      return `
        <div class="galaxy-node planet ${isActive ? 'selected' : ''} ${!discovered ? 'fogged' : ''} ${isPlayer ? 'player' : ''}"
             data-galaxy-id="${p.galaxyId}"
             data-sector-id="${p.sectorId}"
             data-planet-id="${p.id}"
             style="left:${p.x}%; top:${p.y}%;">
          <div class="planet-core" style="
            background: radial-gradient(circle at 35% 35%, ${color}, ${color}66);
            border-color: ${color}aa;
            box-shadow: 0 0 ${isPlayer ? '18' : '8'}px ${color}44;
          ">
            ${isPlayer ? '⌂' : ''}
          </div>
          <div class="galaxy-name">${discovered ? p.name : '???'}</div>
          <div class="galaxy-meta">${discovered ? p.typeName : 'Unknown'}</div>
        </div>
      `;
    }).join('') + renderPlayerMarkers(state, 'sector');
  }

  // ── Player markers on universe view ──
  function renderPlayerMarkers(state, zoom) {
    var players = window._onlinePlayers || [];
    if (!players.length) return '';
    var galId = state.universe.activeGalaxyId;
    var secId = state.universe.activeSectorId;
    var html = '';
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (p.username === (window.Network ? Network.username : '')) continue;
      if (!p.galaxyId) continue;
      if (zoom === 'galaxy' && p.galaxyId === galId) {
        html += '<div class="player-marker other" title="' + p.username + '" style="left:50%; top:10%;"></div>';
      } else if (zoom === 'sector' && p.galaxyId === galId && p.sectorId === secId) {
        html += '<div class="player-marker other" title="' + p.username + '" style="left:50%; top:10%;"></div>';
      } else if (zoom === 'universe') {
        html += '<div class="player-marker other" title="' + p.username + '" style="left:50%; top:10%;"></div>';
      }
    }
    return html;
  }

  // Fleet markers on universe view
  function renderUniverseFleetMarkers(state) {
    const fleets = TravelSystem.getActiveFleets(state);
    if (!fleets.length) return '';
    const zoom = state.universe.zoomLevel;
    const gal = GalaxySystem.getCurrentGalaxy(state);

    return fleets.map(f => {
      const pos = TravelSystem.getInterpolatedPosition(f);
      const vp = universeToViewport(pos.x, pos.y, zoom, gal);
      return `
        <div class="fleet-marker" style="left:${vp.x}%; top:${vp.y}%;">
          <div class="fleet-marker-dot ${f.type}" title="${f.name}"></div>
          <div class="fleet-marker-label">${f.type === 'scout' ? '🔭' : '🚀'}</div>
        </div>
      `;
    }).join('');
  }

  // Fleet trails on universe view
  function renderUniverseFleetTrails(state) {
    const fleets = TravelSystem.getActiveFleets(state);
    if (!fleets.length) return '';
    const zoom = state.universe.zoomLevel;
    const gal = GalaxySystem.getCurrentGalaxy(state);

    return fleets.map(f => {
      const o = TravelSystem.getUniverseCoords(f.originGalaxyId, f.originSectorId, f.originPlanetId);
      const d = TravelSystem.getUniverseCoords(f.destGalaxyId, f.destSectorId, f.destPlanetId);
      const ovp = universeToViewport(o.x, o.y, zoom, gal);
      const dvp = universeToViewport(d.x, d.y, zoom, gal);
      const dx = dvp.x - ovp.x;
      const dy = dvp.y - ovp.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      if (length < 2) return '';
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      return `
        <div class="fleet-trail ${f.type}" style="
          left:${ovp.x}%;
          top:${ovp.y}%;
          width:${length}%;
          transform: rotate(${angle}deg);
        "></div>
      `;
    }).join('');
  }

  // Convert universe coordinates to viewport percentage for rendering
  function universeToViewport(ux, uy, zoom, centerGal) {
    const galSpacing = 1000;
    if (zoom === 'universe') {
      return { x: 5 + ((ux + galSpacing) / (galSpacing * 2)) * 90, y: 5 + ((uy + galSpacing) / (galSpacing * 2)) * 90 };
    }
    if (zoom === 'galaxy' && centerGal) {
      return { x: 50 + (ux - centerGal.universeX) / 4, y: 50 + (uy - centerGal.universeY) / 4 };
    }
    if (zoom === 'sector') {
      return { x: 50 + ux * 0.02, y: 50 + uy * 0.02 };
    }
    return { x: 50, y: 50 };
  }

  // Travel queue panel (universe mode sidebar)
  function renderTravelQueue(state) {
    const fleets = TravelSystem.getActiveFleets(state);
    if (!fleets.length) {
      return `
        <div class="card">
          <div class="panel-title">Fleet Movements</div>
          <div class="small">No active fleet transits.</div>
        </div>
      `;
    }
    return `
      <div class="card">
        <div class="panel-title">Fleet Movements (${fleets.length})</div>
        <div class="stack">
          ${fleets.map(f => {
            const destName = TravelSystem.getPlanetName(f.destGalaxyId, f.destSectorId, f.destPlanetId);
            return `
              <div class="fleet-queue-item">
                <div class="space-between">
                  <strong>${f.name}</strong>
                  <span class="badge ${f.type === 'scout' ? 'purple' : 'green'}">${f.type}</span>
                </div>
                <div class="small">→ ${destName}</div>
                <div class="small">ETA ${TravelSystem.formatTravelTime(f.remainingTime)}</div>
                <div class="progress" style="margin-top:4px;">
                  <span style="width:${(1 - f.remainingTime / f.totalTravelTime) * 100}%"></span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  // Planet travel info when a planet is selected in sector view
  function renderPlanetTravelInfo(state, p) {
    const home = GalaxySystem.getHomePlanet(state);
    if (!home) return `
      <div class="card">
        <div class="panel-title">${p.name}</div>
        <div class="small">${p.typeName} planet</div>
        <div class="small">No home base established.</div>
      </div>
    `;

    const origin = { galaxyId: home.galaxyId, sectorId: home.sectorId, planetId: home.id };
    const dest = { galaxyId: p.galaxyId, sectorId: p.sectorId, planetId: p.id };
    const dist = TravelSystem.getDistance(origin, dest);
    const travelTime = TravelSystem.getTravelTime(origin, dest, false);
    const alreadyFleet = GalaxySystem.hasActiveFleetTo(state, p.id);
    const isHome = p.id === home.id;

    return `
      <div class="card">
        <div class="panel-title">${p.name} — ${p.typeName}</div>
        <div class="small">Ore: ${p.oreBonus > 0 ? '+' : ''}${Math.round(p.oreBonus)}% |
          Solar: ${p.solarBonus > 0 ? '+' : ''}${Math.round(p.solarBonus)}% |
          Crystal: ${p.crystalBonus > 0 ? '+' : ''}${Math.round(p.crystalBonus)}%</div>
        ${!isHome ? `
          <hr class="sep">
          <div class="small">Distance from home: ${dist.toFixed(0)} units</div>
          <div class="small">Travel time: ${TravelSystem.formatTravelTime(travelTime)}</div>
          <div class="row" style="margin-top:8px;">
            <button class="btn small" id="sendScoutBtn"
              ${alreadyFleet ? 'disabled' : ''}
              data-galaxy-id="${p.galaxyId}"
              data-sector-id="${p.sectorId}"
              data-planet-id="${p.id}">
              ${alreadyFleet ? 'Fleet en route' : '🔭 Send Scout'}
            </button>
          </div>
        ` : '<div class="small" style="color:var(--green);margin-top:4px;">⌂ Your home base</div>'}
      </div>
    `;
  }

  // Universe mode sidebar
  function renderUniverseSidebar(state) {
    const zoom = state.universe.zoomLevel;

    // Show planet details if a planet is selected
    if (zoom === 'sector' && state.universe.activePlanetId) {
      const p = Universe.getPlanet(state.universe.activeGalaxyId, state.universe.activeSectorId, state.universe.activePlanetId);
      if (p) return renderPlanetTravelInfo(state, p) + renderTravelQueue(state);
    }

    // Sector report
    if (zoom === 'sector' && state.universe.activeSectorId) {
      const sec = Universe.getSector(state.universe.activeGalaxyId, state.universe.activeSectorId);
      if (!sec) return '';
      const players = sec.planets.filter(p => p.isPlayerBase);
      return `
        <div class="card">
          <div class="panel-title">Sector Report</div>
          <h3>${sec.name}</h3>
          <div class="small">Sector ${sec.label}</div>
          <div class="small">Planets: ${sec.planets.length}</div>
          <div class="small" style="color:var(--green)">Your Colonies: ${players.length}</div>
          ${players.length > 0 ? '<div class="small">' + players.map(p => '⌂ ' + p.name).join('<br>') + '</div>' : ''}
        </div>
      ` + renderTravelQueue(state);
    }

    // Galaxy report
    if (zoom === 'galaxy' && state.universe.activeGalaxyId) {
      const gal = Universe.getGalaxy(state.universe.activeGalaxyId);
      if (!gal) return '';
      const playerPlanets = gal.sectors.reduce((sum, s) => sum + s.planets.filter(p => p.isPlayerBase).length, 0);
      return `
        <div class="card">
          <div class="panel-title">Galaxy Report</div>
          <h3 style="color:${gal.color}">${gal.name}</h3>
          <div class="small">Sectors: ${gal.sectors.length}</div>
          <div class="small">Total Planets: ${gal.sectors.reduce((s, sec) => s + sec.planets.length, 0)}</div>
          <div class="small" style="color:var(--green)">Your Colonies: ${playerPlanets}</div>
        </div>
      ` + renderTravelQueue(state);
    }

    // Universe census
    const total = Universe.getGalaxies().reduce((s, g) => s + g.sectors.reduce((s2, sec) => s2 + sec.planets.length, 0), 0);
    return `
      <div class="card">
        <div class="panel-title">Universe Census</div>
        <h3>Known Space</h3>
        <div class="small">Galaxies: ${Universe.getGalaxies().length}</div>
        <div class="small">Total Planets: ${total.toLocaleString()}</div>
        <div class="small">Click a galaxy to explore its sectors.</div>
      </div>
    ` + renderTravelQueue(state);
  }

  function renderPlayerLocation(state) {
    const home = GalaxySystem.getHomePlanet(state);
    if (!home) {
      const nodes = MapSystem.getRenderableNodes(state);
      const baseNode = nodes.find(n => n.id === 'n-home');
      if (!baseNode) return '';
      return `
        <div class="card">
          <div class="panel-title">Your Position</div>
          <div class="small">Base: ${baseNode.name}</div>
          <div class="small">Region: ${baseNode.regionName}</div>
        </div>
      `;
    }
    const gal = Universe.getGalaxy(home.galaxyId);
    return `
      <div class="card">
        <div class="panel-title">Your Position</div>
        <div class="small">Galaxy: ${gal ? gal.name : 'Unknown'}</div>
        <div class="small">Planet: ${home.name} (${home.typeName})</div>
      </div>
    `;
  }

  function getViewLabel(state) {
    const zoom = state.universe.zoomLevel;
    if (zoom === 'universe') return '🌌 UNIVERSE VIEW';
    const gal = Universe.getGalaxy(state.universe.activeGalaxyId);
    if (zoom === 'galaxy') return '⭐ ' + (gal ? gal.name : 'GALAXY VIEW');
    const sec = Universe.getSector(state.universe.activeGalaxyId, state.universe.activeSectorId);
    return '🪐 ' + (sec ? sec.name : 'SECTOR VIEW');
  }

  function renderUniverseViewport(state) {
    // Initialize universe if needed
    if (!Universe.getGalaxies().length) {
      Universe.init(42);
    }

    const zoom = state.universe.zoomLevel;

    let layerHtml = '';
    if (zoom === 'universe') {
      layerHtml = renderUniverseView(state) + renderUniverseFleetMarkers(state);
    } else if (zoom === 'galaxy') {
      const gal = Universe.getGalaxy(state.universe.activeGalaxyId);
      if (gal) {
        layerHtml = `
          <div class="galaxy-region" style="
            border-color: ${gal.color}44;
            background: radial-gradient(circle at 50% 50%, ${gal.color}11, transparent 70%);
          "></div>
          ${renderGalaxyView(state)}
          ${renderUniverseFleetTrails(state)}
          ${renderUniverseFleetMarkers(state)}
        `;
      } else {
        state.universe.zoomLevel = 'universe';
        layerHtml = renderUniverseView(state);
      }
    } else if (zoom === 'sector') {
      layerHtml = renderSectorView2(state) + renderUniverseFleetMarkers(state);
    }

    const canGalZoomIn = (zoom === 'universe' && !!state.universe.activeGalaxyId) ||
                         (zoom === 'galaxy' && !!state.universe.activeSectorId);
    const canGalZoomOut = zoom !== 'universe';

    return `
      <div class="galaxy-map-layout">
        <div class="stack">
          <div class="galaxy-camera-controls">
            <button class="btn small" id="uvZoomInBtn" ${canGalZoomIn ? '' : 'disabled'}>Zoom In</button>
            <button class="btn small" id="uvZoomOutBtn" ${canGalZoomOut ? '' : 'disabled'}>◀ Back</button>
            <button class="btn small" id="uvGoHomeBtn">⌂ Home</button>
            <button class="btn small" id="uvResetBtn">Reset</button>
            <span class="small" style="margin-left:10px;font-weight:bold;">${getViewLabel(state)}</span>
          </div>

          <div class="galaxy-viewport" id="galaxyViewport">
            <div class="galaxy-stage" id="galaxyStage">
              <div class="galaxy-surface" id="galaxySurface">
                <div class="galaxy-scan-sweep"></div>
                ${layerHtml}
              </div>
            </div>
          </div>
        </div>

        <div class="stack">
          ${renderUniverseSidebar(state)}
          ${renderPlayerLocation(state)}
          <div class="card">
            <div class="panel-title">Galaxy Legend</div>
            <div class="map-legend">
              <div class="legend-row"><span class="legend-dot" style="background:var(--green)"></span><span class="small">Your Colony</span></div>
              <div class="legend-row"><span class="legend-dot" style="background:var(--accent)"></span><span class="small">Colonized Planet</span></div>
              <div class="legend-row"><span class="legend-dot" style="background:var(--muted)"></span><span class="small">Unexplored</span></div>
              <div class="legend-row"><span class="legend-dot" style="background:var(--purple)"></span><span class="small">Fleet in Transit</span></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ══════════════════════════════════════════════
  //  MAIN RENDER — switches between Tactical and Universe modes
  // ══════════════════════════════════════════════

  function render(state) {
    const showUniverse = state.universe && state.universe.showUniverseView;

    // Toggle button is rendered in both modes
    const toggleBtn = `
      <div class="map-mode-toggle">
        <button class="btn small" id="toggleUniverseView" style="margin-bottom:8px;">
          ${showUniverse ? '◄ Back to Tactical Map' : '🌌 Explore Universe'}
        </button>
      </div>
    `;

    if (showUniverse) {
      return toggleBtn + renderUniverseViewport(state);
    } else {
      return toggleBtn + renderTacticalMap(state);
    }
  }

  // ══════════════════════════════════════════════
  //  BIND — both modes
  // ══════════════════════════════════════════════

  function bind(state) {
    // ── Mode toggle ──
    const toggleBtn = document.getElementById('toggleUniverseView');
    if (toggleBtn) {
      toggleBtn.onclick = function () {
        state.universe.showUniverseView = !state.universe.showUniverseView;
        window.App.render();
      };
    }

    if (state.universe && state.universe.showUniverseView) {
      bindUniverseView(state);
    } else {
      bindTacticalMap(state);
    }
  }

  // ── Bind universe view ──
  function bindUniverseView(state) {
    // Galaxy node clicks (universe level → zoom to galaxy)
    document.querySelectorAll('.galaxy-node.universe').forEach(el => {
      el.onclick = function (e) {
        e.stopPropagation();
        state.universe.activeGalaxyId = this.dataset.galaxyId;
        state.universe.zoomLevel = 'galaxy';
        state.universe.activeSectorId = null;
        state.universe.activePlanetId = null;
        window.App.render();
      };
    });

    // Sector node clicks (galaxy level → zoom to sector/planets)
    document.querySelectorAll('.galaxy-node.sector').forEach(el => {
      el.onclick = function (e) {
        e.stopPropagation();
        state.universe.activeGalaxyId = this.dataset.galaxyId;
        state.universe.activeSectorId = this.dataset.sectorId;
        state.universe.zoomLevel = 'sector';
        state.universe.activePlanetId = null;
        window.App.render();
      };
    });

    // Planet node clicks (sector level → select planet)
    document.querySelectorAll('.galaxy-node.planet').forEach(el => {
      el.onclick = function (e) {
        e.stopPropagation();
        const planetId = this.dataset.planetId;
        if (!GalaxySystem.isDiscovered(state, planetId)) {
          GalaxySystem.discoverPlanet(state, planetId);
        }
        state.universe.activePlanetId = planetId;
        window.App.render();
      };
    });

    // Universe zoom controls
    const zoomInBtn = document.getElementById('uvZoomInBtn');
    const zoomOutBtn = document.getElementById('uvZoomOutBtn');
    const resetBtn = document.getElementById('uvResetBtn');

    if (zoomInBtn) {
      zoomInBtn.onclick = function () {
        if (state.universe.zoomLevel === 'universe' && state.universe.activeGalaxyId) {
          state.universe.zoomLevel = 'galaxy';
        } else if (state.universe.zoomLevel === 'galaxy' && state.universe.activeSectorId) {
          state.universe.zoomLevel = 'sector';
        }
        window.App.render();
      };
    }

    if (zoomOutBtn) {
      zoomOutBtn.onclick = function () {
        if (state.universe.zoomLevel === 'sector') {
          state.universe.zoomLevel = 'galaxy';
          state.universe.activePlanetId = null;
        } else if (state.universe.zoomLevel === 'galaxy') {
          state.universe.zoomLevel = 'universe';
          state.universe.activeGalaxyId = null;
          state.universe.activeSectorId = null;
        }
        window.App.render();
      };
    }

    if (resetBtn) {
      resetBtn.onclick = function () {
        state.universe.zoomLevel = 'universe';
        state.universe.activeGalaxyId = null;
        state.universe.activeSectorId = null;
        state.universe.activePlanetId = null;
        // Reset zoom/pan
        const stage = document.getElementById('galaxyStage');
        if (stage) { stage.style.transform = 'scale(1) translate(0,0)'; }
        uvZoom = 1; uvPanX = 0; uvPanY = 0;
        window.App.render();
      };
    }

    // Go Home button — zoom to your home planet
    const goHomeBtn = document.getElementById('uvGoHomeBtn');
    if (goHomeBtn) {
      goHomeBtn.onclick = function () {
        const home = GalaxySystem.getHomePlanet(state);
        if (home) {
          state.universe.activeGalaxyId = home.galaxyId;
          state.universe.activeSectorId = home.sectorId;
          state.universe.activePlanetId = home.id;
          state.universe.zoomLevel = 'sector';
        }
        window.App.render();
      };
    }

    // ── Mouse wheel zoom for universe viewport ──
    const viewport = document.getElementById('galaxyViewport');
    const stage = document.getElementById('galaxyStage');
    let uvZoom = 1, uvPanX = 0, uvPanY = 0;
    let isDragging = false, dragStartX = 0, dragStartY = 0;

    if (viewport && stage) {
      // Wheel zoom
      viewport.addEventListener('wheel', function (e) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        uvZoom = Math.max(0.3, Math.min(5, uvZoom + delta));
        stage.style.transform = 'scale(' + uvZoom + ') translate(' + uvPanX + 'px, ' + uvPanY + 'px)';
        stage.style.transformOrigin = '0 0';
      }, { passive: false });

      // Click-drag pan
      viewport.addEventListener('mousedown', function (e) {
        isDragging = true;
        dragStartX = e.clientX - uvPanX;
        dragStartY = e.clientY - uvPanY;
        viewport.style.cursor = 'grabbing';
      });

      document.addEventListener('mousemove', function (e) {
        if (!isDragging) return;
        uvPanX = e.clientX - dragStartX;
        uvPanY = e.clientY - dragStartY;
        stage.style.transform = 'scale(' + uvZoom + ') translate(' + uvPanX + 'px, ' + uvPanY + 'px)';
        stage.style.transformOrigin = '0 0';
      });

      document.addEventListener('mouseup', function () {
        if (isDragging) {
          isDragging = false;
          viewport.style.cursor = 'grab';
        }
      });

      // Touch support for mobile pan (universe view)
      viewport.addEventListener('touchstart', function (e) {
        if (e.touches.length === 1) {
          isDragging = true;
          dragStartX = e.touches[0].clientX - uvPanX;
          dragStartY = e.touches[0].clientY - uvPanY;
        }
      }, { passive: false });

      document.addEventListener('touchmove', function (e) {
        if (!isDragging) return;
        if (e.touches.length === 1) {
          uvPanX = e.touches[0].clientX - dragStartX;
          uvPanY = e.touches[0].clientY - dragStartY;
          stage.style.transform = 'scale(' + uvZoom + ') translate(' + uvPanX + 'px, ' + uvPanY + 'px)';
          stage.style.transformOrigin = '0 0';
        }
      }, { passive: false });

      document.addEventListener('touchend', function () {
        if (isDragging) {
          isDragging = false;
        }
      });

      viewport.style.cursor = 'grab';
    }

    // Send Scout button
    const scoutBtn = document.getElementById('sendScoutBtn');
    if (scoutBtn) {
      scoutBtn.onclick = function () {
        const result = GalaxySystem.sendScout(state, this.dataset.galaxyId, this.dataset.sectorId, this.dataset.planetId);
        if (result.ok) {
          window.App.render();
        }
      };
    }
  }

  // ── Bind tactical map (original) ──
  function bindTacticalMap(state) {
    document.querySelectorAll(".map-tooltip").forEach(el => {
      el.style.display = "none";
    });

    document.querySelectorAll("[data-node-id]").forEach(el => {
      const tooltip = el.querySelector(".map-tooltip");

      el.onclick = function (e) {
        e.stopPropagation();
        state.map.selectedNodeId = el.dataset.nodeId;
        window.App.render();
      };

      el.onmouseenter = function () {
        if (tooltip) tooltip.style.display = "block";
      };

      el.onmouseleave = function () {
        if (tooltip) tooltip.style.display = "none";
      };
    });

    document.querySelectorAll("[data-scout]").forEach(el => {
      el.onclick = function () {
        Network.send({ type: 'scout', nodeId: el.dataset.scout });
        window.App.render();
      };
    });

    document.querySelectorAll("[data-raid]").forEach(el => {
      el.onclick = function () {
        Network.send({ type: 'raid', nodeId: el.dataset.raid });
        window.App.render();
      };
    });

    document.querySelectorAll("[data-expedition]").forEach(el => {
      el.onclick = function () {
        Network.send({ type: 'expedition', nodeId: el.dataset.expedition });
        window.App.render();
      };
    });

    const zoomIn = document.getElementById("mapZoomInBtn");
    const zoomOut = document.getElementById("mapZoomOutBtn");
    const resetBtn = document.getElementById("mapResetViewBtn");
    const surface = document.getElementById("mapSurface");

    if (zoomIn) {
      zoomIn.onclick = function () {
        state.map.camera.zoom = Math.min(2.2, state.map.camera.zoom + 0.15);
        window.App.render();
      };
    }

    if (zoomOut) {
      zoomOut.onclick = function () {
        state.map.camera.zoom = Math.max(0.7, state.map.camera.zoom - 0.15);
        window.App.render();
      };
    }

    if (resetBtn) {
      resetBtn.onclick = function () {
        state.map.camera.zoom = 1;
        state.map.camera.offsetX = 0;
        state.map.camera.offsetY = 0;
        window.App.render();
      };
    }

    if (surface) {
      surface.onmousedown = function (e) {
        if (e.target.closest("[data-node-id]")) return;
        dragState.active = true;
        dragState.startX = e.clientX;
        dragState.startY = e.clientY;
        dragState.originX = state.map.camera.offsetX;
        dragState.originY = state.map.camera.offsetY;
        surface.classList.add("dragging");
      };

      window.onmousemove = function (e) {
        if (!dragState.active) return;
        state.map.camera.offsetX = dragState.originX + (e.clientX - dragState.startX);
        state.map.camera.offsetY = dragState.originY + (e.clientY - dragState.startY);
        const stage = document.getElementById("mapStage");
        if (stage) {
          stage.style.transform = `translate(${state.map.camera.offsetX}px, ${state.map.camera.offsetY}px) scale(${state.map.camera.zoom})`;
        }
      };

      window.onmouseup = function () {
        dragState.active = false;
        if (surface) surface.classList.remove("dragging");
      };

      // Touch support for tactical map pan
      surface.addEventListener('touchstart', function (e) {
        if (e.target.closest("[data-node-id]")) return;
        if (e.touches.length === 1) {
          dragState.active = true;
          dragState.startX = e.touches[0].clientX;
          dragState.startY = e.touches[0].clientY;
          dragState.originX = state.map.camera.offsetX;
          dragState.originY = state.map.camera.offsetY;
          surface.classList.add("dragging");
        }
      }, { passive: false });

      window.addEventListener('touchmove', function (e) {
        if (!dragState.active) return;
        if (e.touches.length === 1) {
          state.map.camera.offsetX = dragState.originX + (e.touches[0].clientX - dragState.startX);
          state.map.camera.offsetY = dragState.originY + (e.touches[0].clientY - dragState.startY);
          const stage = document.getElementById("mapStage");
          if (stage) {
            stage.style.transform = `translate(${state.map.camera.offsetX}px, ${state.map.camera.offsetY}px) scale(${state.map.camera.zoom})`;
          }
        }
      }, { passive: false });

      window.addEventListener('touchend', function () {
        dragState.active = false;
        if (surface) surface.classList.remove("dragging");
      });
    }
  }

  return {
    render,
    bind
  };
})();
