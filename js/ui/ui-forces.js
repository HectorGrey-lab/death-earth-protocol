window.UIForces = (function () {
  var _createData = { name: '', qty: {} };
  var _editData = { name: '', qty: {}, fleetId: null };
  var _lastState = null;

  // Live countdown timer for transit fleets
  var _transitTimer = null;
  function _startTransitTimer(state) {
    if (_transitTimer) clearInterval(_transitTimer);
    _transitTimer = null;
    var hasTransit = false;
    Object.keys(state.fleets || {}).forEach(function(fid) {
      if (state.fleets[fid].transit) hasTransit = true;
    });
    if (hasTransit) {
      _transitTimer = setInterval(function() {
        window.App.render();
      }, 1000);
    }
  }

  function renderRoster(state) {
    var trainingLevel = state.buildings && state.buildings.trainingFacility ? state.buildings.trainingFacility.level || 0 : 0;
    var trainingLocked = trainingLevel < 1;
    return Object.keys(GameData.troops).map(function (key) {
      var t = GameData.troops[key];
      var count = state.troops.counts[key] || 0;
      return '<div class="card visual-card">' +
        '<img class="troop-portrait" src="' + (t.image || '') + '" alt="' + t.name + '">' +
        '<div class="space-between"><strong>' + t.name + '</strong><span class="badge">' + count + '</span></div>' +
        '<div class="small">' + t.role + '</div>' +
        '<div class="small">Power ' + t.power + ' \u2022 Defense ' + t.defense + ' \u2022 Carry ' + t.carryCapacity + '</div>' +
        '<div class="small">Upkeep ' + t.upkeep + '/s</div>' +
        '<div class="small">Train Time ' + Utils.formatTime(t.trainTime) + '</div>' +
        '<div class="small">' + Utils.costToHtml(t.cost) + '</div>' +
        '<div class="row" style="margin-top:8px; gap:6px; flex-wrap:wrap;">' +
          '<button class="btn small" ' + (trainingLocked ? 'disabled' : '') + ' onclick="Network.train(\'' + key + '\', 1);">Train 1</button>' +
          '<button class="btn small" ' + (trainingLocked ? 'disabled' : '') + ' onclick="Network.train(\'' + key + '\', 5);">Train 5</button>' +
          '<input type="number" min="1" max="9999" value="10" id="trainQty_' + key + '" class="input small fleet-qty-input" style="width:64px;" ' + (trainingLocked ? 'disabled' : '') + '>' +
          '<button class="btn small" ' + (trainingLocked ? 'disabled' : '') + ' onclick="var el=document.getElementById(\'trainQty_' + key + '\');var v=parseInt(el.value,10);if(isNaN(v)||v<1)v=1;if(v>9999)v=9999;Network.train(\'' + key + '\', v);">Train</button>' +
        '</div>' +
        (trainingLocked ? '<div class="small" style="color:#e68a2e;margin-top:6px;">Requires Training Facility Lv1</div>' : '') +
        '</div>';
    }).join('');
  }

  function renderQueue(state) {
    if (!state.troops.queue.length) return '<div class="small">No active troop training.</div>';
    return state.troops.queue.map(function (q) {
      return '<div class="queue-item">' +
        '<strong>' + GameData.troops[q.troopKey].name + ' x' + q.qty + '</strong>' +
        '<div class="small">ETA ' + Utils.formatTime(q.remaining) + '</div></div>';
    }).join('');
  }

  function renderFleets(state) {
    var html = '';
    html += '<button id="openCreateFleetBtn" class="btn small" style="margin-bottom:8px;">+ Create Fleet</button>';

    var fleetIds = Object.keys(state.fleets || {});
    if (!fleetIds.length) {
      html += '<div class="small">No fleets yet. Create one to organise your forces.</div>';
      return html;
    }

    fleetIds.forEach(function (fid) {
      var fleet = state.fleets[fid];
      var fp = FleetSystem.getFleetPower(state, fleet);
      var fd = FleetSystem.getFleetDefense(state, fleet);
      var fc = FleetSystem.getFleetCarry(fleet);
      var fz = FleetSystem.getFleetSize(fleet);

      // Build transit label with live countdown
      var transitLabel = '';
      if (fleet.transit) {
        var remaining = Math.max(0, Math.floor((fleet.transit.arrivalTime - Date.now()) / 1000));
        var mins = Math.floor(remaining / 60);
        var secs = remaining % 60;
        var label = fleet.transit.returning
          ? '\u21A9 Returning home'
          : '\uD83D\uDE80 En route \u2014 ' + (fleet.transit.target || '?');
        transitLabel = '<div class="small" style="color:var(--orange);margin-top:2px;">' + label + ' \u2014 ' + mins + 'm ' + (secs < 10 ? '0' : '') + secs + 's</div>';
      }

      html += '<div class="card fleet-card">' +
        '<div class="space-between">' +
          '<div>' +
            '<strong>' + (fleet.name || 'Unnamed Fleet').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</strong>' +
            transitLabel +
          '</div>' +
          '<div class="row">' +
            '<button class="btn tiny btn-attack attack-fleet' + (fleet.transit ? ' disabled' : '') + '" data-fid="' + fid + '" title="Attack with this fleet"' + (fleet.transit ? ' disabled' : '') + '>⚔️</button>' +
            '<button class="btn tiny btn-info edit-fleet' + (fleet.transit ? ' disabled' : '') + '" data-fid="' + fid + '" title="' + (fleet.transit ? 'Fleet is in transit — cannot edit' : 'Edit fleet') + '"' + (fleet.transit ? ' disabled' : '') + '>✎</button>' +
            '<button class="btn tiny btn-danger delete-fleet' + (fleet.transit ? ' disabled' : '') + '" data-fid="' + fid + '" title="' + (fleet.transit ? 'Fleet is in transit — cannot delete' : 'Delete fleet') + '"' + (fleet.transit ? ' disabled' : '') + '>✕</button></div></div>' +
        '<div class="fleet-stats">' +
          '<span>\u2694\uFE0F ' + fp + '</span>' +
          '<span>\uD83D\uDEE1\uFE0F ' + fd + '</span>' +
          '<span>\uD83D\uDCE6 ' + fc + '</span>' +
          '<span>\uD83D\uDC65 ' + fz + '</span></div></div>';
    });
    return html;
  }

  function render(state) {
    return '<div style="display:flex;flex-direction:column;">' +
      '<div class="four-col">' +
        '<div class="card"><div class="small">Total Troops</div><h3>' + TroopSystem.getTotalTroops(state) + '</h3></div>' +
        '<div class="card"><div class="small">Total Power</div><h3>' + TroopSystem.getTotalPower(state) + '</h3></div>' +
        '<div class="card"><div class="small">Total Defense</div><h3>' + TroopSystem.getTotalDefense(state) + '</h3></div>' +
        '<div class="card"><div class="small">Isotope Upkeep</div><h3>' + Utils.format1(ResourceSystem.getUpkeep(state)) + '/s</h3></div></div>' +
      '<div class="two-col">' +
        '<div class="card"><div class="panel-title">Training Command</div><div class="card-grid cols-2">' + renderRoster(state) + '</div></div>' +
        '<div style="display:flex;flex-direction:column;">' +
          '<div class="card" style="max-height:260px; overflow-y:auto; padding:8px 8px 0 8px;border-bottom-left-radius:0;border-bottom-right-radius:0;"><div class="panel-title">Training Queue</div><div style="display:flex;flex-direction:column;">' + renderQueue(state) + '</div></div>' +
          '<div class="card" style="margin-top:-1px;padding:0 12px 8px 12px;border-top:none;border-top-left-radius:0;border-top-right-radius:0;"><div class="panel-title">Fleets</div><div style="display:flex;flex-direction:column;">' + renderFleets(state) + '</div></div></div></div></div>';
  }

  function clampQty(v) {
    if (isNaN(v) || v < 0) return 0;
    if (v > 99999) return 99999;
    return Math.floor(v);
  }

  /** Same modifiers as FleetSystem.getFleetPower/getFleetDefense — used for live draft preview */
  function computeDraftStats(state, qtyObj) {
    var modP = 1 + (state.research.levels.military || 0) * 0.08;
    var modD = 1 + (state.research.levels.defense || 0) * 0.06;
    var size = 0, power = 0, defense = 0, carry = 0;
    Object.keys(qtyObj || {}).forEach(function (key) {
      var count = qtyObj[key] || 0;
      if (count <= 0) return;
      var t = GameData.troops[key];
      if (!t) return;
      size += count;
      power += count * t.power * modP;
      defense += count * t.defense * modD;
      carry += count * (t.carryCapacity || 10);
    });
    return { size: size, power: Math.floor(power), defense: Math.floor(defense), carry: carry };
  }

  function rerenderDraftSummary(elId, stats) {
    var el = document.getElementById(elId);
    if (!el) return;
    el.innerHTML =
      '<span>\u2694\uFE0F ' + stats.power + '</span>' +
      '<span>\uD83D\uDEE1\uFE0F ' + stats.defense + '</span>' +
      '<span>\uD83D\uDCE6 ' + stats.carry + '</span>' +
      '<span>\uD83D\uDC65 ' + stats.size + '</span>';
  }

  /** Per-key availability ceiling (create: reserve only; edit: reserve + troops already in fleet) */
  function maxFor(mode, key, state, fleet) {
    var reserve = state.troops.counts[key] || 0;
    if (mode === 'edit') return reserve + ((fleet && fleet.troops && fleet.troops[key]) || 0);
    return reserve;
  }

  function buildDraftRow(mode, key, state, fleet) {
    var t = GameData.troops[key];
    var idPrefix = mode === 'edit' ? 'edit' : 'create';
    var store = mode === 'edit' ? _editData : _createData;
    var target = store.qty[key] || 0;
    var max = maxFor(mode, key, state, fleet);
    return '<div class="fleet-troop-row">' +
      '<span class="fleet-troop-label">' + t.name + ' <span class="muted">(P' + t.power + ' D' + t.defense + ' C' + t.carryCapacity + ')</span></span>' +
      '<div class="fleet-troop-controls">' +
        '<button class="btn tiny ' + idPrefix + '-fleet-qty-minus" data-key="' + key + '" type="button">\u2212</button>' +
        '<input type="number" min="0" max="' + max + '" id="' + idPrefix + 'Qty_' + key + '" class="input small fleet-qty-input" value="' + target + '">' +
        '<button class="btn tiny ' + idPrefix + '-fleet-qty-plus" data-key="' + key + '" type="button">+</button>' +
        '<button class="btn tiny fleet-quick-btn" data-key="' + key + '" data-amt="5" type="button">+5</button>' +
        '<button class="btn tiny fleet-quick-btn" data-key="' + key + '" data-amt="25" type="button">+25</button>' +
        '<button class="btn tiny fleet-quick-btn" data-key="' + key + '" data-amt="max" type="button">Max</button>' +
        '<button class="btn tiny fleet-quick-btn" data-key="' + key + '" data-amt="0" type="button">Clear</button>' +
        '<span class="small muted" style="margin-left:4px;">avail ' + max + '</span>' +
      '</div></div>';
  }

  /** Re-read every draft input, clamp into the qty store, refresh summary + empty-fleet warning */
  function updateDraftUI(mode) {
    var idPrefix = mode === 'edit' ? 'edit' : 'create';
    var store = mode === 'edit' ? _editData : _createData;
    Object.keys(GameData.troops).forEach(function (key) {
      var el = document.getElementById(idPrefix + 'Qty_' + key);
      if (el) store.qty[key] = clampQty(parseInt(el.value, 10));
    });
    var stats = computeDraftStats(_lastState, store.qty);
    rerenderDraftSummary(idPrefix + 'DraftSummary', stats);
    var warn = document.getElementById(idPrefix + 'DraftWarn');
    if (warn) warn.style.display = stats.size > 0 ? 'none' : 'block';
  }

  function setDraftQty(mode, key, val) {
    var idPrefix = mode === 'edit' ? 'edit' : 'create';
    var store = mode === 'edit' ? _editData : _createData;
    var fleet = mode === 'edit' ? FleetSystem.getFleet(_lastState, _editData.fleetId) : null;
    var max = maxFor(mode, key, _lastState, fleet);
    store.qty[key] = clampQty(Math.min(val, max));
    var el = document.getElementById(idPrefix + 'Qty_' + key);
    if (el) el.value = store.qty[key];
    updateDraftUI(mode);
  }

  function showCreateFleetModal(state) {
    _lastState = state;
    _createData.name = '';
    _createData.qty = {};

    var nameHtml = '<input id="createFleetModalName" type="text" placeholder="Fleet name..." class="input" style="width:100%;box-sizing:border-box;margin-bottom:12px;">';

    var troopsHtml = Object.keys(GameData.troops).map(function (key) {
      return buildDraftRow('create', key, state, null);
    }).join('');

    var summaryHtml = '<div id="createDraftSummary" class="fleet-summary"></div>';
    var warnHtml = '<div id="createDraftWarn" class="small" style="color:#e05a4e;display:none;margin-top:6px;">Fleet must contain at least one troop.</div>';
    var saveBtn = '<button id="saveFleetFromModalBtn" class="btn success" style="margin-top:12px;">Save Fleet</button>';

    UIModal.open('Create Fleet', nameHtml + summaryHtml + '<div style="max-height:400px;overflow-y:auto;">' + troopsHtml + '</div>' + warnHtml + saveBtn);

    document.getElementById('createFleetModalName').oninput = function () {
      _createData.name = this.value;
    };

    // Typing directly into an input sets the exact target quantity
    Object.keys(GameData.troops).forEach(function (key) {
      var el = document.getElementById('createQty_' + key);
      if (el) el.oninput = function () {
        _createData.qty[key] = clampQty(Math.min(parseInt(this.value, 10), maxFor('create', key, state, null)));
        this.value = _createData.qty[key];
        updateDraftUI('create');
      };
    });

    document.querySelectorAll('.create-fleet-qty-plus').forEach(function (btn) {
      btn.onclick = function () {
        var key = this.dataset.key;
        setDraftQty('create', key, (_createData.qty[key] || 0) + 1);
      };
    });

    document.querySelectorAll('.create-fleet-qty-minus').forEach(function (btn) {
      btn.onclick = function () {
        var key = this.dataset.key;
        setDraftQty('create', key, (_createData.qty[key] || 0) - 1);
      };
    });

    document.querySelectorAll('#modalBody .fleet-quick-btn').forEach(function (btn) {
      btn.onclick = function () {
        var key = this.dataset.key;
        var amt = this.dataset.amt;
        if (amt === 'max') setDraftQty('create', key, maxFor('create', key, state, null));
        else setDraftQty('create', key, (_createData.qty[key] || 0) + parseInt(amt, 10));
      };
    });

    updateDraftUI('create');

    document.getElementById('saveFleetFromModalBtn').onclick = function () {
      updateDraftUI('create');
      var stats = computeDraftStats(state, _createData.qty);
      if (stats.size <= 0) return; // warning shown by updateDraftUI
      var name = _createData.name.trim() || 'Unnamed Fleet';
      var fleetId = FleetSystem.createFleet(state, name);
      Object.keys(_createData.qty).forEach(function (key) {
        var qty = _createData.qty[key];
        if (qty > 0) {
          FleetSystem.addToFleet(state, fleetId, key, qty);
        }
      });
      UIModal.close();
      window.App.render();
    };
  }

  function showEditFleetModal(state, fleetId) {
    var fleet = FleetSystem.getFleet(state, fleetId);
    if (!fleet) return;
    if (fleet.transit) return; // transit safety: no editing fleets mid-flight

    _lastState = state;
    _editData.fleetId = fleetId;
    _editData.name = fleet.name || '';
    _editData.qty = {};
    Object.keys(GameData.troops).forEach(function (key) {
      _editData.qty[key] = fleet.troops[key] || 0;
    });

    var nameHtml = '<input id="editFleetModalName" type="text" placeholder="Fleet name..." class="input" style="width:100%;box-sizing:border-box;margin-bottom:12px;" value="' + fleet.name.replace(/&/g,'&amp;').replace(/\"/g,'&quot;').replace(/</g,'&lt;') + '">';

    var troopsHtml = Object.keys(GameData.troops).map(function (key) {
      return buildDraftRow('edit', key, state, fleet);
    }).join('');

    var summaryHtml = '<div id="editDraftSummary" class="fleet-summary"></div>';
    var warnHtml = '<div id="editDraftWarn" class="small" style="color:#e05a4e;display:none;margin-top:6px;">Fleet must contain at least one troop.</div>';
    var saveBtn = '<button id="saveEditFleetBtn" class="btn success" style="margin-top:12px;">Save Changes</button>';

    UIModal.open('Edit Fleet', nameHtml + summaryHtml + '<div style="max-height:400px;overflow-y:auto;">' + troopsHtml + '</div>' + warnHtml + saveBtn);

    document.getElementById('editFleetModalName').oninput = function () {
      _editData.name = this.value;
    };

    Object.keys(GameData.troops).forEach(function (key) {
      var el = document.getElementById('editQty_' + key);
      if (el) el.oninput = function () {
        _editData.qty[key] = clampQty(Math.min(parseInt(this.value, 10), maxFor('edit', key, state, fleet)));
        this.value = _editData.qty[key];
        updateDraftUI('edit');
      };
    });

    document.querySelectorAll('.edit-fleet-qty-plus').forEach(function (btn) {
      btn.onclick = function () {
        var key = this.dataset.key;
        setDraftQty('edit', key, (_editData.qty[key] || 0) + 1);
      };
    });

    document.querySelectorAll('.edit-fleet-qty-minus').forEach(function (btn) {
      btn.onclick = function () {
        var key = this.dataset.key;
        setDraftQty('edit', key, (_editData.qty[key] || 0) - 1);
      };
    });

    document.querySelectorAll('#modalBody .fleet-quick-btn').forEach(function (btn) {
      btn.onclick = function () {
        var key = this.dataset.key;
        var amt = this.dataset.amt;
        if (amt === 'max') setDraftQty('edit', key, maxFor('edit', key, state, fleet));
        else setDraftQty('edit', key, (_editData.qty[key] || 0) + parseInt(amt, 10));
      };
    });

    updateDraftUI('edit');

    document.getElementById('saveEditFleetBtn').onclick = function () {
      updateDraftUI('edit');
      var stats = computeDraftStats(state, _editData.qty);
      if (stats.size <= 0) return; // warning shown by updateDraftUI

      var newName = _editData.name.trim() || 'Unnamed Fleet';
      var target = FleetSystem.getFleet(state, fleetId);

      // Diff-based edit: apply only the delta per troop type, preserving the fleet id
      Object.keys(_editData.qty).forEach(function (key) {
        var desired = _editData.qty[key] || 0;
        var current = (target.troops && target.troops[key]) || 0;
        if (desired > current) {
          FleetSystem.addToFleet(state, fleetId, key, desired - current);
        } else if (desired < current) {
          FleetSystem.removeFromFleet(state, fleetId, key, current - desired);
        }
      });
      if (newName !== (target.name || '')) {
        FleetSystem.renameFleet(state, fleetId, newName);
      }

      UIModal.close();
      window.App.render();
    };
  }

  function bind(state) {
    _startTransitTimer(state);

    var openBtn = document.getElementById('openCreateFleetBtn');
    if (openBtn) {
      openBtn.onclick = function () {
        showCreateFleetModal(state);
      };
    }

    document.querySelectorAll('.edit-fleet').forEach(function (btn) {
      btn.onclick = function () {
        var fid = this.dataset.fid;
        if (state.fleets[fid] && state.fleets[fid].transit) return; // transit safety
        showEditFleetModal(state, fid);
      };
    });

    document.querySelectorAll('.attack-fleet').forEach(function (btn) {
      btn.onclick = function () {
        state._selectedFleetId = this.dataset.fid;
        state.ui.currentPage = 'map';
        window.App.render();
      };
    });

    document.querySelectorAll('.delete-fleet').forEach(function (btn) {
      btn.onclick = function () {
        var fid = this.dataset.fid;
        if (state.fleets[fid] && state.fleets[fid].transit) return; // transit safety
        if (!confirm('Delete this fleet? Troops return to reserve.')) return;
        FleetSystem.deleteFleet(state, fid);
        window.App.render();
      };
    });
  }

  return {
    render: render,
    bind: bind,
    // Exposed for smoke tests / devtools
    computeDraftStats: computeDraftStats,
    maxFor: maxFor,
    clampQty: clampQty
  };
})();
