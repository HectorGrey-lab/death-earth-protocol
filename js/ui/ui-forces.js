window.UIForces = (function () {
  var _createData = { name: '', qty: {} };

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
    // Create Fleet button — opens a modal
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
            '<button class="btn tiny btn-info rename-fleet" data-fid="' + fid + '">\u270E</button>' +
            '<button class="btn tiny btn-danger delete-fleet" data-fid="' + fid + '">\u2715</button></div></div>' +
        '<div class="fleet-stats">' +
          '<span>\u2694\uFE0F ' + fp + '</span>' +
          '<span>\uD83D\uDEE1\uFE0F ' + fd + '</span>' +
          '<span>\uD83D\uDCE6 ' + fc + '</span>' +
          '<span>\uD83D\uDC65 ' + fz + '</span></div>' +
        '<div class="small" style="margin-top:4px;">Composition:</div>' +
        '<div class="fleet-composition">';

      Object.keys(GameData.troops).forEach(function (key) {
        var t = GameData.troops[key];
        var inFleet = fleet.troops[key] || 0;
        var avail = state.troops.counts[key] || 0;
        if (inFleet === 0 && avail === 0) return;
        html += '<div class="fleet-troop-row">' +
          '<span class="fleet-troop-label">' + t.name + '</span>' +
          '<div class="fleet-troop-controls">' +
            '<button class="btn tiny fleet-remove" data-fid="' + fid + '" data-key="' + key + '">\u2212</button>' +
            '<span class="fleet-troop-count">' + inFleet + '</span>' +
            '<button class="btn tiny fleet-add" data-fid="' + fid + '" data-key="' + key + '"' + (avail <= 0 ? ' disabled' : '') + '>+</button>' +
            '<span class="small muted" style="margin-left:6px;">(' + avail + ')</span></div></div>';
      });
      html += '</div></div>';
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
      var inFleet = state.fleets && Object.keys(state.fleets).reduce(function (sum, fid) {
        return sum + ((state.fleets[fid].troops[key] || 0));
      }, 0);
      var total = avail + inFleet;
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

    // Bind modal inputs
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
      // Add selected troops
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

  function bind(state) {
    var openBtn = document.getElementById('openCreateFleetBtn');
    if (openBtn) {
      openBtn.onclick = function () {
        showCreateFleetModal(state);
      };
    }

    document.querySelectorAll('.delete-fleet').forEach(function (btn) {
      btn.onclick = function () {
        if (!confirm('Delete this fleet? Troops return to reserve.')) return;
        FleetSystem.deleteFleet(state, this.dataset.fid);
        window.App.render();
      };
    });

    document.querySelectorAll('.rename-fleet').forEach(function (btn) {
      btn.onclick = function () {
        var fid = this.dataset.fid;
        var fleet = FleetSystem.getFleet(state, fid);
        if (!fleet) return;
        var name = prompt('Rename fleet:', fleet.name || '');
        if (name && name.trim()) {
          FleetSystem.renameFleet(state, fid, name.trim());
          window.App.render();
        }
      };
    });

    document.querySelectorAll('.fleet-add').forEach(function (btn) {
      btn.onclick = function () {
        var fid = this.dataset.fid;
        var key = this.dataset.key;
        var avail = state.troops.counts[key] || 0;
        if (avail <= 0) return;
        var qty = prompt('Add how many ' + GameData.troops[key].name + '? (' + avail + ' available)', '1');
        if (qty) {
          var n = parseInt(qty, 10);
          if (n > 0) {
            FleetSystem.addToFleet(state, fid, key, n);
            window.App.render();
          }
        }
      };
    });

    document.querySelectorAll('.fleet-remove').forEach(function (btn) {
      btn.onclick = function () {
        var fid = this.dataset.fid;
        var key = this.dataset.key;
        var fleet = FleetSystem.getFleet(state, fid);
        if (!fleet) return;
        var inFleet = fleet.troops[key] || 0;
        if (inFleet <= 0) return;
        var qty = prompt('Remove how many ' + GameData.troops[key].name + '? (' + inFleet + ' in fleet)', '1');
        if (qty) {
          var n = parseInt(qty, 10);
          if (n > 0) {
            FleetSystem.removeFromFleet(state, fid, key, n);
            window.App.render();
          }
        }
      };
    });
  }

  return { render: render, bind: bind };
})();
