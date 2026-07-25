window.UIForces = (function () {
  var _createData = { name: '', qty: {} };
  var _editData = { name: '', qty: {} };

  function renderRoster(state) {
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
        '<div class="row" style="margin-top:8px;">' +
          '<button class="btn small" onclick="Network.train(\'' + key + '\', 1);">Train 1</button>' +
          '<button class="btn small" onclick="Network.train(\'' + key + '\', 5);">Train 5</button>' +
        '</div></div>';
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

      html += '<div class="card fleet-card">' +
        '<div class="space-between">' +
          '<strong>' + (fleet.name || 'Unnamed Fleet').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</strong>' +
          '<div class="row">' +
            '<button class="btn tiny btn-attack attack-fleet" data-fid="' + fid + '" title="Attack with this fleet">\u2694\uFE0F</button>' +
            '<button class="btn tiny btn-info edit-fleet" data-fid="' + fid + '" title="Edit fleet">\u270E</button>' +
            '<button class="btn tiny btn-danger delete-fleet" data-fid="' + fid + '">\u2715</button></div></div>' +
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

  function showCreateFleetModal(state) {
    _createData.name = '';
    _createData.qty = {};

    var nameHtml = '<input id="createFleetModalName" type="text" placeholder="Fleet name..." class="input" style="width:100%;box-sizing:border-box;margin-bottom:12px;">';

    var troopsHtml = Object.keys(GameData.troops).map(function (key) {
      var t = GameData.troops[key];
      var avail = state.troops.counts[key] || 0;
      return '<div class="fleet-troop-row">' +
        '<span class="fleet-troop-label">' + t.name + ' <span class="muted">(P' + t.power + ' D' + t.defense + ' C' + t.carryCapacity + ')</span></span>' +
        '<div class="fleet-troop-controls">' +
          '<button class="btn tiny create-fleet-qty-minus" data-key="' + key + '">\u2212</button>' +
          '<span id="createQty_' + key + '" class="fleet-troop-count">0</span>' +
          '<button class="btn tiny create-fleet-qty-plus" data-key="' + key + '">+</button>' +
          '<span class="small muted" style="margin-left:6px;">avail ' + avail + '</span></div></div>';
    }).join('');

    var saveBtn = '<button id="saveFleetFromModalBtn" class="btn success" style="margin-top:12px;">Save Fleet</button>';

    UIModal.open('Create Fleet', nameHtml + '<div style="max-height:400px;overflow-y:auto;">' + troopsHtml + '</div>' + saveBtn);

    document.getElementById('createFleetModalName').oninput = function () {
      _createData.name = this.value;
    };

    document.querySelectorAll('.create-fleet-qty-plus').forEach(function (btn) {
      btn.onclick = function () {
        var key = this.dataset.key;
        var avail = state.troops.counts[key] || 0;
        var current = _createData.qty[key] || 0;
        if (current < avail) {
          _createData.qty[key] = current + 1;
          Utils.el('createQty_' + key).textContent = _createData.qty[key];
        }
      };
    });

    document.querySelectorAll('.create-fleet-qty-minus').forEach(function (btn) {
      btn.onclick = function () {
        var key = this.dataset.key;
        var current = _createData.qty[key] || 0;
        if (current > 0) {
          _createData.qty[key] = current - 1;
          Utils.el('createQty_' + key).textContent = _createData.qty[key];
        }
      };
    });

    document.getElementById('saveFleetFromModalBtn').onclick = function () {
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

    _editData.name = fleet.name || '';
    _editData.qty = {};
    Object.keys(GameData.troops).forEach(function (key) {
      _editData.qty[key] = fleet.troops[key] || 0;
    });

    var nameHtml = '<input id="editFleetModalName" type="text" placeholder="Fleet name..." class="input" style="width:100%;box-sizing:border-box;margin-bottom:12px;" value="' + fleet.name.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;') + '">';

    var troopsHtml = Object.keys(GameData.troops).map(function (key) {
      var t = GameData.troops[key];
      var currentQty = _editData.qty[key] || 0;
      var avail = state.troops.counts[key] || 0;
      return '<div class="fleet-troop-row">' +
        '<span class="fleet-troop-label">' + t.name + ' <span class="muted">(P' + t.power + ' D' + t.defense + ' C' + t.carryCapacity + ')</span></span>' +
        '<div class="fleet-troop-controls">' +
          '<button class="btn tiny edit-fleet-qty-minus" data-key="' + key + '">\u2212</button>' +
          '<span id="editQty_' + key + '" class="fleet-troop-count">' + currentQty + '</span>' +
          '<button class="btn tiny edit-fleet-qty-plus" data-key="' + key + '">+</button>' +
          '<span class="small muted" style="margin-left:6px;">avail ' + avail + '</span></div></div>';
    }).join('');

    var saveBtn = '<button id="saveEditFleetBtn" class="btn success" style="margin-top:12px;">Save Changes</button>';

    UIModal.open('Edit Fleet', nameHtml + '<div style="max-height:400px;overflow-y:auto;">' + troopsHtml + '</div>' + saveBtn);

    document.getElementById('editFleetModalName').oninput = function () {
      _editData.name = this.value;
    };

    document.querySelectorAll('.edit-fleet-qty-plus').forEach(function (btn) {
      btn.onclick = function () {
        var key = this.dataset.key;
        var t = GameData.troops[key];
        var fleetIn = fleet.troops[key] || 0;
        var current = _editData.qty[key] || 0;
        var avail = state.troops.counts[key] || 0;
        var canAdd = Math.max(0, avail - (current - fleetIn));
        if (canAdd > 0) {
          _editData.qty[key] = current + 1;
          Utils.el('editQty_' + key).textContent = _editData.qty[key];
        }
      };
    });

    document.querySelectorAll('.edit-fleet-qty-minus').forEach(function (btn) {
      btn.onclick = function () {
        var key = this.dataset.key;
        var current = _editData.qty[key] || 0;
        if (current > 0) {
          _editData.qty[key] = current - 1;
          Utils.el('editQty_' + key).textContent = _editData.qty[key];
        }
      };
    });

    document.getElementById('saveEditFleetBtn').onclick = function () {
      var newName = _editData.name.trim() || 'Unnamed Fleet';
      FleetSystem.renameFleet(state, fleetId, newName);

      // Return all current fleet troops to reserve
      FleetSystem.deleteFleet(state, fleetId);

      // Re-create the fleet with updated composition
      var newFleetId = FleetSystem.createFleet(state, newName);
      Object.keys(_editData.qty).forEach(function (key) {
        var qty = _editData.qty[key];
        if (qty > 0) {
          FleetSystem.addToFleet(state, newFleetId, key, qty);
        }
      });

      UIModal.close();
      window.App.render();
    };
  }

  function bind(state) {
    var openBtn = document.getElementById('openCreateFleetBtn');
    if (openBtn) {
      openBtn.onclick = function () {
        showCreateFleetModal(state);
      };
    }

    document.querySelectorAll('.edit-fleet').forEach(function (btn) {
      btn.onclick = function () {
        showEditFleetModal(state, this.dataset.fid);
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
        if (!confirm('Delete this fleet? Troops return to reserve.')) return;
        FleetSystem.deleteFleet(state, this.dataset.fid);
        window.App.render();
      };
    });
  }

  return { render: render, bind: bind };
})();
