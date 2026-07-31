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

  // ── Module-scope refs for once-bound document handlers ──
  // (Universe view)
  let _uvDocBound = false;
  let _uvRefs = { state: null, viewport: null, stage: null };
  let _uvDrag = { active: false, startX: 0, startY: 0 };
  // (Tactical view)
  let _tacBound = false;
  let _tacRefs = { state: null, surface: null };

  // ── Universe camera helpers ──
  function ensureUniverseCamera(state) {
    if (!state.universe) state.universe = {};
    if (!state.universe.camera) state.universe.camera = { zoom: 1, panX: 0, panY: 0 };
    const cam = state.universe.camera;
    if (typeof cam.zoom !== 'number' || isNaN(cam.zoom)) cam.zoom = 1;
    if (typeof cam.panX !== 'number' || isNaN(cam.panX)) cam.panX = 0;
    if (typeof cam.panY !== 'number' || isNaN(cam.panY)) cam.panY = 0;
    return cam;
  }

  function applyUniverseTransform(state) {
    const stage = _uvRefs.stage;
    if (!stage) return;
    const cam = ensureUniverseCamera(state);
    stage.style.transformOrigin = '0 0';
    stage.style.transform = 'translate(' + cam.panX + 'px,' + cam.panY + 'px) scale(' + cam.zoom + ')';
  }

  function bindUniverseDocHandlersOnce() {
    if (_uvDocBound) return;
    _uvDocBound = true;

    document.addEventListener('mousemove', function (e) {
      const state = _uvRefs.state;
      if (!state || !state.universe || !state.universe.showUniverseView) return;
      if (!_uvDrag.active) return;
      const cam = ensureUniverseCamera(state);
      cam.panX = e.clientX - _uvDrag.startX;
      cam.panY = e.clientY - _uvDrag.startY;
      applyUniverseTransform(state);
    });

    document.addEventListener('mouseup', function () {
      const state = _uvRefs.state;
      if (!state || !state.universe || !state.universe.showUniverseView) return;
      if (_uvDrag.active) {
        _uvDrag.active = false;
        if (_uvRefs.viewport) _uvRefs.viewport.style.cursor = 'grab';
      }
    });

    document.addEventListener('touchmove', function (e) {
      const state = _uvRefs.state;
      if (!state || !state.universe || !state.universe.showUniverseView) return;
      if (!_uvDrag.active) return;
      if (!e.touches || e.touches.length !== 1) return;
      const cam = ensureUniverseCamera(state);
      cam.panX = e.touches[0].clientX - _uvDrag.startX;
      cam.panY = e.touches[0].clientY - _uvDrag.startY;
      applyUniverseTransform(state);
    }, { passive: false });

    document.addEventListener('touchend', function () {
      const state = _uvRefs.state;
      if (!state || !state.universe || !state.universe.showUniverseView) return;
      _uvDrag.active = false;
    });
  }

  // ── Tactical camera helpers ──
  function applyTacticalTransform(state) {
    const stage = document.getElementById('mapStage');
    if (!stage) return;
    stage.style.transform = 'translate(' + state.map.camera.offsetX + 'px, ' + state.map.camera.offsetY + 'px) scale(' + state.map.camera.zoom + ')';
  }

  function bindTacticalDocHandlersOnce() {
    if (_tacBound) return;
    _tacBound = true;

    window.addEventListener('mousemove', function (e) {
      const state = _tacRefs.state;
      if (!state) return;
      if (!dragState.active) return;
      // Only pan in tactical mode
      if (state.universe && state.universe.showUniverseView) return;

      state.map.camera.offsetX = dragState.originX + (e.clientX - dragState.startX);
      state.map.camera.offsetY = dragState.originY + (e.clientY - dragState.startY);
      applyTacticalTransform(state);
    });

    window.addEventListener('mouseup', function () {
      const state = _tacRefs.state;
      if (!state) return;
      if (!dragState.active) return;
      dragState.active = false;
      if (_tacRefs.surface) _tacRefs.surface.classList.remove('dragging');
      const stage = document.getElementById('mapStage');
      if (stage) stage.classList.remove('dragging');
    });

    window.addEventListener('touchmove', function (e) {
      const state = _tacRefs.state;
      if (!state) return;
      if (!dragState.active) return;
      if (state.universe && state.universe.showUniverseView) return;
      if (!e.touches || e.touches.length !== 1) return;

      state.map.camera.offsetX = dragState.originX + (e.touches[0].clientX - dragState.startX);
      state.map.camera.offsetY = dragState.originY + (e.touches[0].clientY - dragState.startY);
      applyTacticalTransform(state);
    }, { passive: false });

    window.addEventListener('touchend', function () {
      const state = _tacRefs.state;
      if (!state) return;
      if (!dragState.active) return;
      dragState.active = false;
      if (_tacRefs.surface) _tacRefs.surface.classList.remove('dragging');
      const stage = document.getElementById('mapStage');
      if (stage) stage.classList.remove('dragging');
    });
  }

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
            <div class="map-nebula"></div>
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
      const occupied = !!p.isColonized && !!p.colonizedBy && !isPlayer;
      const color = planetTypeColor(p.type);

      return `
        <div class="galaxy-node planet ${isActive ? 'selected' : ''} ${!discovered ? 'fogged' : ''} ${isPlayer ? 'player' : ''} ${occupied ? 'occupied' : ''}"
             data-galaxy-id="${p.galaxyId}"
             data-sector-id="${p.sectorId}"
             data-planet-id="${p.id}"
             style="left:${p.x}%; top:${p.y}%;">
          <div class="planet-core" style="
            background: radial-gradient(circle at 35% 35%, ${color}, ${color}66);
            border-color: ${color}aa;
            box-shadow: 0 0 ${isPlayer ? '18' : '8'}px ${color}44;
          ">
            ${isPlayer ? '⌂' : (occupied ? '⚑' : '')}
          </div>
          ${occupied ? `<div class="planet-occupant">${discovered ? esc(p.colonizedBy) : 'Signal'}</div>` : ''}
          <div class="galaxy-name">${discovered ? p.name : '???'}</div>
          <div class="galaxy-meta">${discovered ? p.typeName : 'Unknown'}</div>
        </div>
      `;
    }).join('') + renderPlayerMarkers(state, 'sector');
  }

  // ── Sound: opt-in WebAudio ticks (localStorage-persisted) ──
  const SoundSystem = {
    ctx: null,
    enabled: false,

    init() {
      try {
        this.enabled = localStorage.getItem('de_sound_enabled') === '1';
      } catch (e) { this.enabled = false; }
    },

    ensureCtx() {
      if (!this.ctx) {
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return null;
          this.ctx = new AC();
        } catch (e) { return null; }
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    },

    toggle() {
      this.enabled = !this.enabled;
      try { localStorage.setItem('de_sound_enabled', this.enabled ? '1' : '0'); } catch (e) {}
      const btn = document.getElementById('uvSoundBtn');
      if (btn) btn.classList.toggle('active-sound', this.enabled);
      if (this.enabled) {
        // Unlock audio on first enable (user gesture)
        this.ensureCtx();
        this.tick(880, 0.08);
      }
      return this.enabled;
    },

    // Simple blip: freq (Hz), dur (s), type
    tick(freq, dur, type) {
      if (!this.enabled) return;
      const ctx = this.ensureCtx();
      if (!ctx) return;
      try {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = type || 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (dur || 0.12));
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + (dur || 0.12) + 0.05);
      } catch (e) { /* audio is best-effort */ }
    },

    select() { this.tick(660, 0.09, 'triangle'); },      // planet select
    arrival() { this.tick(180, 0.35, 'sawtooth'); },     // impact ring
    return() { this.tick(520, 0.25, 'triangle'); }       // fleet return
  };
  SoundSystem.init();

  // ── Player markers on universe view ──
  // Deterministic per-user offset so markers don't stack on the same point
  function stableOffset(username, amp) {
    var h = 0;
    var s = String(username || '');
    for (var i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    var angle = (h % 360) * Math.PI / 180;
    var dist = amp * (0.4 + ((h >>> 8) % 60) / 100);
    return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist };
  }

  function renderPlayerMarkers(state, zoom) {
    var players = window._onlinePlayers || [];
    if (!players.length) return '';
    var galId = state.universe.activeGalaxyId;
    var secId = state.universe.activeSectorId;
    var html = '';
    var myName = window.Network ? Network.username : '';
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      if (!p || !p.username || p.username === myName) continue;
      if (!p.galaxyId) continue;
      var left = 50, top = 50, found = false;

      if (zoom === 'sector' && p.galaxyId === galId && p.sectorId === secId && p.planetId) {
        var pl = Universe.getPlanet(p.galaxyId, p.sectorId, p.planetId);
        if (pl) {
          var off = stableOffset(p.username, 1.6);
          left = pl.x + off.dx;
          top = pl.y + off.dy;
          found = true;
        }
      } else if (zoom === 'galaxy' && p.galaxyId === galId && p.sectorId) {
        var sec = Universe.getSector(p.galaxyId, p.sectorId);
        if (sec) {
          var off2 = stableOffset(p.username, 1.2);
          left = sec.x + off2.dx;
          top = sec.y + off2.dy;
          found = true;
        }
      } else if (zoom === 'universe') {
        var gal = Universe.getGalaxy(p.galaxyId);
        if (gal) {
          // Same grid layout as renderUniverseView()
          var col = (gal.index % 3);
          var row = Math.floor(gal.index / 3);
          var off3 = stableOffset(p.username, 2.2);
          left = 5 + col * 33 + off3.dx;
          top = 5 + row * 30 + off3.dy;
          found = true;
        }
      }

      if (!found) continue;
      html += '<div class="player-marker other" title="' + esc(p.username) + '" style="left:' + left + '%; top:' + top + '%;"></div>';
    }
    return html;
  }

  // ── Player profile helpers ──
  function getPlayerRankings(state, username) {
    var lb = state.leaderboard;
    var cats = ['population', 'raider', 'attacker', 'defence'];
    var result = {};
    cats.forEach(function (cat) {
      var list = lb && lb[cat];
      if (list && Array.isArray(list)) {
        var idx = -1;
        for (var i = 0; i < list.length; i++) {
          if (String(list[i].username).toLowerCase() === String(username).toLowerCase()) { idx = i; break; }
        }
        result[cat] = idx >= 0 ? idx + 1 : null;
      } else {
        result[cat] = null;
      }
    });
    return result;
  }

  function esc(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderPlayerProfile(state, username) {
    var ranks = getPlayerRankings(state, username);
    var catInfo = [
      { key: 'population', label: 'Population', icon: '👥' },
      { key: 'raider', label: 'Raider', icon: '⚔' },
      { key: 'attacker', label: 'Attacker', icon: '🎯' },
      { key: 'defence', label: 'Defence', icon: '🛡' }
    ];
    var rankHtml = '';
    catInfo.forEach(function (cat) {
      var r = ranks[cat.key];
      rankHtml += '<div class="lb-mini-row"><span>' + cat.icon + ' ' + cat.label + '</span><span' + (r === 1 ? ' style="color:#ffd700;font-weight:bold;"' : '') + '>' + (r ? '#' + r : '—') + '</span></div>';
    });
    var fleetMsg = '';
    var fleetBtn = '';
    if (state._selectedFleetId && state.fleets[state._selectedFleetId]) {
      var selFleet = state.fleets[state._selectedFleetId];
      if (selFleet.transit) {
        fleetMsg = '<div class="small" style="color:var(--muted);margin:6px 0;">⏳ Fleet <strong>' + esc(selFleet.name) + '</strong> is already in transit</div>';
      } else {
        var fz = FleetSystem.getFleetSize(selFleet);
        fleetMsg = '<div class="small" style="color:var(--yellow);margin:6px 0;">⚔ Attacking with <strong>' + esc(selFleet.name) + '</strong> (' + fz + ' units)</div>';
        // Check for siege mechs — offer building target selection
        var siegeCount = (selFleet.troops && selFleet.troops.siegeMech) || 0;
        if (siegeCount > 0) {
          var bldgOptions = [
            {key:'any', name:'Any Building (random)'},
            {key:'extractionGrid', name:'Extraction Grid'},
            {key:'trainingFacility', name:'Training Facility'},
            {key:'communicationsHub', name:'Comms Hub'},
            {key:'radarArray', name:'Radar Array'},
            {key:'defenseBunker', name:'Defense Bunker'},
            {key:'shieldGenerator', name:'Shield Generator'},
            {key:'researchLab', name:'Research Lab'},
            {key:'marketNexus', name:'Market Nexus'},
            {key:'tradePodTerminal', name:'Trade Pod Terminal'}
          ];
          fleetMsg += '<div class="small" style="margin-top:6px;color:var(--orange);">🏗 Siege mechs detected — target building:</div>' +
            '<select id="siegeTargetBuilding" style="width:100%;margin:4px 0 8px 0;padding:4px;border-radius:4px;background:var(--bg);color:var(--fg);border:1px solid var(--border);">';
          bldgOptions.forEach(function(b) {
            fleetMsg += '<option value="' + b.key + '">' + b.name + '</option>';
          });
          fleetMsg += '</select>';
        }
        fleetBtn = '<button class="btn small success" id="launchFleetAttackBtn" data-player="' + esc(username) + '" data-fid="' + state._selectedFleetId + '">⚔ Launch Attack</button>';
      }
    }
    return '' +
      '<div class="card player-profile-card">' +
        '<div class="panel-title">🏛 Player Profile</div>' +
        '<h3 style="margin:4px 0;">' + esc(username) + '</h3>' +
        '<div class="small" style="color:var(--muted);margin-bottom:8px;">Leaderboard Rankings</div>' +
        '<div class="lb-mini-grid">' + rankHtml + '</div>' +
        fleetMsg +
        '<div class="row" style="margin-top:10px;">' +
          '<button class="btn small" id="msgPlayerBtn" data-player="' + esc(username) + '">💬 Message</button>' +
          fleetBtn +
        '</div>' +
      '</div>';
  }
  // ── End player profile helpers ──

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

  // ── PvP attack fleet markers (colony fleets in transit) ──
  let _pvpRaf = null;

  // Collect PvP transits from colony fleet sync (state.fleets = colony.troops.fleets)
  function getPvPTransitFleetsFromColony(state) {
    const out = [];
    const fleets = state.fleets || {};
    Object.keys(fleets).forEach(function (fid) {
      const f = fleets[fid];
      if (!f || !f.transit || f.transit.mode !== 'pvp_attack') return;
      const t = f.transit;
      const o = t.origin || {};
      const d = t.targetPos || {};
      if (!o.galaxyId || !d.galaxyId) return;
      out.push({
        id: 'pvp_' + fid,
        type: 'pvp',
        name: f.name || 'Fleet',
        startTime: t.startTime || Date.now(),
        arrivalTime: t.arrivalTime || Date.now(),
        returning: !!t.returning,
        originGalaxyId: o.galaxyId,
        originSectorId: o.sectorId,
        originPlanetId: o.planetId,
        destGalaxyId: d.galaxyId,
        destSectorId: d.sectorId,
        destPlanetId: d.planetId,
        attacker: t.attacker || '',
        defender: t.defender || ''
      });
    });
    return out;
  }

  function pvpProgress(f) {
    const total = Math.max(1000, f.arrivalTime - f.startTime);
    const t = (Date.now() - f.startTime) / total;
    return Math.max(0, Math.min(1, t));
  }

  function pvpFleetPosition(f) {
    const o = TravelSystem.getUniverseCoords(f.originGalaxyId, f.originSectorId, f.originPlanetId);
    const d = TravelSystem.getUniverseCoords(f.destGalaxyId, f.destSectorId, f.destPlanetId);
    const p = pvpProgress(f);
    return { x: o.x + (d.x - o.x) * p, y: o.y + (d.y - o.y) * p };
  }

  function renderPvPFleetMarkers(state) {
    const fleets = getPvPTransitFleetsFromColony(state);
    if (!fleets.length) return '';
    const zoom = state.universe.zoomLevel;
    const gal = GalaxySystem.getCurrentGalaxy(state);

    // Keep RAF loop alive while markers are on screen
    startPvPAnimLoop();

    return fleets.map(f => {
      const pos = pvpFleetPosition(f);
      const vp = universeToViewport(pos.x, pos.y, zoom, gal);
      const title = (f.returning ? '↩ Returning: ' : '⚔ Attacking: ') + (f.returning ? f.attacker + "'s base" : f.defender + "'s base");
      return `
        <div class="fleet-marker pvp" data-pvp-id="${f.id}" style="left:${vp.x}%; top:${vp.y}%;">
          <div class="fleet-marker-dot pvp ${f.returning ? 'returning' : ''}" title="${title}"></div>
          <div class="fleet-marker-label">${f.returning ? '↩' : '⚔️'}</div>
        </div>
      `;
    }).join('');
  }

  // Lightweight RAF loop — moves existing PvP markers without re-rendering
  let _pvpArrivalFx = {}; // fleetId -> true (ring already spawned)
  let _pvpRingSeq = 0;

  function spawnImpactRingAtPlanet(galaxyId, sectorId, planetId, isReturn) {
    // Only when the destination sector is on screen
    const state = window.gameState;
    if (!state || !state.universe || !state.universe.showUniverseView) return;
    if (state.universe.zoomLevel !== 'sector') return;
    if (state.universe.activeGalaxyId !== galaxyId || state.universe.activeSectorId !== sectorId) return;
    const p = Universe.getPlanet(galaxyId, sectorId, planetId);
    if (!p) return;
    const stage = document.getElementById('galaxyStage');
    if (!stage) return;

    const id = 'pvp-ring-' + (_pvpRingSeq++);
    const el = document.createElement('div');
    el.className = 'impact-ring' + (isReturn ? ' returning' : '');
    el.style.left = p.x + '%';
    el.style.top = p.y + '%';
    stage.appendChild(el);
    if (isReturn) SoundSystem.return(); else SoundSystem.arrival();
    // Remove after animation (700ms + margin)
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 900);
  }

  function startPvPAnimLoop() {
    if (_pvpRaf) return;
    function frame() {
      const markers = document.querySelectorAll('.fleet-marker.pvp');
      const state = window.gameState;
      const inUniverse = !!(state && state.universe && state.universe.showUniverseView);
      if (!markers.length && !inUniverse) { _pvpRaf = null; return; }
      if (!inUniverse) { _pvpRaf = null; return; }
      const zoom = state.universe.zoomLevel;
      const gal = GalaxySystem.getCurrentGalaxy(state);
      const byId = {};
      getPvPTransitFleetsFromColony(state).forEach(f => { byId[f.id] = f; });
      markers.forEach(function (el) {
        const f = byId[el.dataset.pvpId];
        if (!f) { el.style.display = 'none'; return; }
        const pos = pvpFleetPosition(f);
        const vp = universeToViewport(pos.x, pos.y, zoom, gal);
        el.style.display = '';
        el.style.left = vp.x + '%';
        el.style.top = vp.y + '%';

        // Arrival impact ring — fire once per fleet per direction
        const p = pvpProgress(f);
        if (p >= 1) {
          const key = f.id + (f.returning ? ':return' : '');
          if (!_pvpArrivalFx[key]) {
            _pvpArrivalFx[key] = true;
            spawnImpactRingAtPlanet(f.destGalaxyId, f.destSectorId, f.destPlanetId, f.returning);
          }
        }
      });
      _pvpRaf = requestAnimationFrame(frame);
    }
    _pvpRaf = requestAnimationFrame(frame);
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
    const currentUser = window.Network ? Network.username : '';
    const isOtherPlayer = p.colonizedBy && p.colonizedBy !== currentUser && !isHome;

    return `
      <div class="card">
        <div class="panel-title">${p.name} — ${p.typeName}</div>
        <div class="small">Ore: ${p.oreBonus > 0 ? '+' : ''}${Math.round(p.oreBonus)}% |
          Solar: ${p.solarBonus > 0 ? '+' : ''}${Math.round(p.solarBonus)}% |
          Crystal: ${p.crystalBonus > 0 ? '+' : ''}${Math.round(p.crystalBonus)}%</div>
        ${p.colonizedBy && !isHome ? `<div class="small" style="color:var(--accent);margin-top:6px;">🏛 Colonized by ${p.colonizedBy}</div>` : ''}
        ${!isHome ? `
          <hr class="sep">
          <div class="small">Distance from home: ${dist.toFixed(0)} units</div>
          <div class="small">Travel time: ${TravelSystem.formatTravelTime(travelTime)}</div>
          <div class="small" style="margin-top:4px;">${renderRouteEta(state)}</div>
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
      ${isOtherPlayer ? renderPlayerProfile(state, p.colonizedBy) : ''}
    `;
  }

  // ── Route preview: projected travel line from home to selected planet ──
  function renderRoutePreview(state) {
    const zoom = state.universe.zoomLevel;
    if (zoom !== 'sector' || !state.universe.activePlanetId) return '';
    const home = GalaxySystem.getHomePlanet(state);
    if (!home || !home.x) return '';
    const target = Universe.getPlanet(state.universe.activeGalaxyId, state.universe.activeSectorId, state.universe.activePlanetId);
    if (!target || target.id === home.id) return '';

    const hx = home.x, hy = home.y;
    const tx = target.x, ty = target.y;
    const dx = tx - hx, dy = ty - hy;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.5) return '';
    const ang = Math.atan2(dy, dx) * 180 / Math.PI;

    return `
      <div class="route-preview" style="left:${hx}%; top:${hy}%; width:${len}%; transform: rotate(${ang}deg);">
        <div class="route-preview-flow"></div>
      </div>
    `;
  }

  // ── Projected ETA for selected planet (panel text) ──
  function renderRouteEta(state) {
    const zoom = state.universe.zoomLevel;
    if (zoom !== 'sector' || !state.universe.activePlanetId) return '';
    const home = GalaxySystem.getHomePlanet(state);
    if (!home) return '';
    const target = Universe.getPlanet(state.universe.activeGalaxyId, state.universe.activeSectorId, state.universe.activePlanetId);
    if (!target || target.id === home.id) return '';

    const origin = { galaxyId: home.galaxyId, sectorId: home.sectorId, planetId: home.id };
    const dest = { galaxyId: target.galaxyId, sectorId: target.sectorId, planetId: target.id };
    let secs;
    try {
      secs = TravelSystem.getTravelTime(origin, dest, !!state.universe.hasWarpGate);
    } catch (e) {
      // Fallback: rough Euclidean estimate (clamped 15..120s)
      const dx = target.x - home.x, dy = target.y - home.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      secs = Math.max(15, Math.min(120, Math.round(dist * 2)));
    }
    const arrive = new Date(Date.now() + secs * 1000);
    const etaClock = arrive.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Projected ETA: <strong>${TravelSystem.formatTravelTime(secs)}</strong> <span class="small">(~${etaClock})</span>`;
  }

  // Universe mode sidebar
  // Incoming attack banner
  function renderIncomingAttacks(state) {
    if (!state._incomingAttacks || !state._incomingAttacks.length) return '';
    var html = '';
    var now = Date.now();
    state._incomingAttacks.forEach(function(a) {
      var remaining = Math.max(0, Math.floor((a.arrivalTime - now) / 1000));
      var mins = Math.floor(remaining / 60);
      var secs = remaining % 60;
      html += '<div class="card" style="border-left:3px solid var(--orange);margin-bottom:8px;">' +
        '<div class="small" style="color:var(--red);font-weight:bold;">⚠ INCOMING ATTACK</div>' +
        '<div><strong>' + esc(a.attacker) + '</strong> — ETA: ' + mins + 'm' + secs + 's</div>' +
        '<div class="small">Origin: S' + (a.origin ? a.origin.sector : '?') + ' P' + (a.origin ? a.origin.planet : '?') + '</div>' +
        '</div>';
    });
    return html;
  }

  function renderUniverseSidebar(state) {
    const zoom = state.universe.zoomLevel;

    // Incoming attack warnings (shown at top regardless of zoom)
    var incHtml = renderIncomingAttacks(state);

    // Show planet details if a planet is selected
    if (zoom === 'sector' && state.universe.activePlanetId) {
      const p = Universe.getPlanet(state.universe.activeGalaxyId, state.universe.activeSectorId, state.universe.activePlanetId);
      if (p) return incHtml + renderPlanetTravelInfo(state, p) + renderTravelQueue(state);
    }

    // Sector report
    if (zoom === 'sector' && state.universe.activeSectorId) {
      const sec = Universe.getSector(state.universe.activeGalaxyId, state.universe.activeSectorId);
      if (!sec) return incHtml;
      const players = sec.planets.filter(p => p.isPlayerBase);
      return incHtml + `
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
      if (!gal) return incHtml;
      const playerPlanets = gal.sectors.reduce((sum, s) => sum + s.planets.filter(p => p.isPlayerBase).length, 0);
      return incHtml + `
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
    return incHtml + `
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
      layerHtml = renderUniverseView(state) + renderPlayerMarkers(state, 'universe') + renderUniverseFleetMarkers(state) + renderPvPFleetMarkers(state);
    } else if (zoom === 'galaxy') {
      const gal = Universe.getGalaxy(state.universe.activeGalaxyId);
      if (gal) {
        layerHtml = `
          <div class="galaxy-region" style="
            border-color: ${gal.color}44;
            background: radial-gradient(circle at 50% 50%, ${gal.color}11, transparent 70%);
          "></div>
          ${renderGalaxyView(state)}
          ${renderPlayerMarkers(state, 'galaxy')}
          ${renderUniverseFleetTrails(state)}
          ${renderUniverseFleetMarkers(state)}
          ${renderPvPFleetMarkers(state)}
        `;
      } else {
        state.universe.zoomLevel = 'universe';
        layerHtml = renderUniverseView(state);
      }
    } else if (zoom === 'sector') {
      layerHtml = renderSectorView2(state) + renderRoutePreview(state) + renderUniverseFleetMarkers(state) + renderPvPFleetMarkers(state);
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
            <button class="btn small ${SoundSystem.enabled ? 'active-sound' : ''}" id="uvSoundBtn" title="Toggle map sounds">🔊 ${SoundSystem.enabled ? 'On' : 'Off'}</button>
            <span class="small" style="margin-left:10px;font-weight:bold;">${getViewLabel(state)}</span>
          </div>

          <div class="galaxy-viewport" id="galaxyViewport">
            <div class="galaxy-nebula"></div>
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
    // Camera refs — bind doc handlers once, apply persisted transform
    _uvRefs.state = state;
    _uvRefs.viewport = document.getElementById('galaxyViewport');
    _uvRefs.stage = document.getElementById('galaxyStage');
    _uvDrag.active = false;
    bindUniverseDocHandlersOnce();
    applyUniverseTransform(state);

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

    // Sound toggle
    const soundBtn = document.getElementById('uvSoundBtn');
    if (soundBtn) {
      soundBtn.onclick = function (e) {
        e.stopPropagation();
        const on = SoundSystem.toggle();
        this.textContent = '🔊 ' + (on ? 'On' : 'Off');
      };
    }

    // Planet node clicks (sector level → select planet)
    document.querySelectorAll('.galaxy-node.planet').forEach(el => {
      el.onclick = function (e) {
        e.stopPropagation();
        const planetId = this.dataset.planetId;
        if (!GalaxySystem.isDiscovered(state, planetId)) {
          GalaxySystem.discoverPlanet(state, planetId);
        }
        state.universe.activePlanetId = planetId;
        SoundSystem.select();
        window.App.render();
      };
    });

    // ── Player profile actions ──
    const msgBtn = document.getElementById('msgPlayerBtn');
    if (msgBtn) {
      msgBtn.onclick = function () {
        var target = this.dataset.player;
        var text = prompt('Send private message to ' + target + ':');
        if (text && text.trim()) {
          if (window.Network) {
            Network.send({ type: 'private_message', target: target, text: text.trim() });
          }
        }
      };
    }
    // Attack from fleet
    const launchBtn = document.getElementById('launchFleetAttackBtn');
    if (launchBtn) {
      launchBtn.onclick = function () {
        var target = this.dataset.player;
        var fleetId = this.dataset.fid;
        var targetBuilding = document.getElementById('siegeTargetBuilding') ? document.getElementById('siegeTargetBuilding').value : 'any';
        console.log('[ATTACK] Launch clicked: target=' + target + ' fleetId=' + fleetId);
        if (confirm('Launch attack with your fleet against ' + target + '?' + (targetBuilding !== 'any' ? ' Targeting: ' + targetBuilding : ''))) {
          console.log('[ATTACK] Confirm OK, sending...');
          Network.send({ type: 'attack_fleet', fleetId: fleetId, target: target, targetBuilding: targetBuilding });
        } else {
          console.log('[ATTACK] Confirm cancelled');
        }
      };
    }

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
        // Reset zoom/pan via persisted camera
        const cam = ensureUniverseCamera(state);
        cam.zoom = 1; cam.panX = 0; cam.panY = 0;
        applyUniverseTransform(state);
        window.App.render();
      };
    }

    // Go Home button — zoom to your home planet with highlight
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

        // After DOM renders, zoom viewport to center on home planet and pulse it
        setTimeout(function () {
          var stage = document.getElementById('galaxyStage');
          var viewport = document.getElementById('galaxyViewport');
          if (stage && viewport && home && home.x !== undefined) {
            var targetZoom = 2.5;
            var vpW = viewport.clientWidth;
            var vpH = viewport.clientHeight;
            // Planet logical pixel position (at scale=1, translate=0)
            var px = (home.x / 100) * vpW;
            var py = (home.y / 100) * vpH;
            // Pan so the planet is centered in viewport (persisted camera)
            var cam = ensureUniverseCamera(state);
            cam.zoom = targetZoom;
            cam.panX = (vpW / 2) - px * targetZoom;
            cam.panY = (vpH / 2) - py * targetZoom;
            applyUniverseTransform(state);
          }
          // Flash highlight on the home planet
          var homeEl = document.querySelector('.galaxy-node.planet.selected');
          if (homeEl) {
            homeEl.classList.add('home-pulse');
            setTimeout(function () { homeEl.classList.remove('home-pulse'); }, 2200);
          }
        }, 60);
      };
    }

    // ── Universe viewport: wheel zoom (around cursor) + drag pan ──
    const viewport = _uvRefs.viewport;
    const stage = _uvRefs.stage;

    if (viewport && stage) {
      // Wheel zoom — zoom around cursor point
      viewport.addEventListener('wheel', function (e) {
        e.preventDefault();
        const cam = ensureUniverseCamera(state);
        const rect = viewport.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const oldZoom = cam.zoom;
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const newZoom = Math.max(0.3, Math.min(5, oldZoom + delta));

        // Keep the point under the mouse stable:
        const worldX = (mx - cam.panX) / oldZoom;
        const worldY = (my - cam.panY) / oldZoom;

        cam.zoom = newZoom;
        cam.panX = mx - worldX * newZoom;
        cam.panY = my - worldY * newZoom;

        applyUniverseTransform(state);
      }, { passive: false });

      // Click-drag pan (don't start drag if clicking a node)
      viewport.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        if (e.target.closest('.galaxy-node')) return;
        const cam = ensureUniverseCamera(state);
        _uvDrag.active = true;
        _uvDrag.startX = e.clientX - cam.panX;
        _uvDrag.startY = e.clientY - cam.panY;
        viewport.style.cursor = 'grabbing';
      });

      // Touch drag pan
      viewport.addEventListener('touchstart', function (e) {
        if (e.target.closest('.galaxy-node')) return;
        if (!e.touches || e.touches.length !== 1) return;
        const cam = ensureUniverseCamera(state);
        _uvDrag.active = true;
        _uvDrag.startX = e.touches[0].clientX - cam.panX;
        _uvDrag.startY = e.touches[0].clientY - cam.panY;
      }, { passive: false });

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
    _tacRefs.state = state;
    _tacRefs.surface = document.getElementById('mapSurface');
    bindTacticalDocHandlersOnce();

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
      const stage = document.getElementById("mapStage");

      surface.onmousedown = function (e) {
        if (e.target.closest("[data-node-id]")) return;
        dragState.active = true;
        dragState.startX = e.clientX;
        dragState.startY = e.clientY;
        dragState.originX = state.map.camera.offsetX;
        dragState.originY = state.map.camera.offsetY;
        surface.classList.add("dragging");
        if (stage) stage.classList.add("dragging");
      };

      // mousemove/mouseup/touchmove/touchend are bound ONCE on window
      // (see bindTacticalDocHandlersOnce) — never stack duplicates here.
      surface.addEventListener('touchstart', function (e) {
        if (e.target.closest("[data-node-id]")) return;
        if (e.touches.length === 1) {
          dragState.active = true;
          dragState.startX = e.touches[0].clientX;
          dragState.startY = e.touches[0].clientY;
          dragState.originX = state.map.camera.offsetX;
          dragState.originY = state.map.camera.offsetY;
          surface.classList.add("dragging");
          if (stage) stage.classList.add("dragging");
        }
      }, { passive: false });
    }
  }

  return {
    render,
    bind
  };
})();
