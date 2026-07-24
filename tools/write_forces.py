# Write ui-forces.js
import os

content = r'''window.UIForces = (function () {
  function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
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
    html += '<div class="row" style="margin-bottom:8px;">' +
      '<input id="fleetNameInput" type="text" placeholder="Fleet name..." class="input" style="flex:1;min-width:0;">' +
      '<button id="createFleetBtn" class="btn small">+ Create Fleet</button></div>';

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
          '<strong>' + esc(fleet.name || 'Unnamed Fleet') + '</strong>' +
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
    return '<div class="stack">' +
      '<div class="four-col">' +
        '<div class="card"><div class="small">Total Troops</div><h3>' + TroopSystem.getTotalTroops(state) + '</h3></div>' +
        '<div class="card"><div class="small">Total Power</div><h3>' + TroopSystem.getTotalPower(state) + '</h3></div>' +
        '<div class="card"><div class="small">Total Defense</div><h3>' + TroopSystem.getTotalDefense(state) + '</h3></div>' +
        '<div class="card"><div class="small">Isotope Upkeep</div><h3>' + Utils.format1(ResourceSystem.getUpkeep(state)) + '/s</h3></div></div>' +
      '<div class="two-col">' +
        '<div class="card"><div class="panel-title">Training Command</div><div class="card-grid cols-2">' + renderRoster(state) + '</div></div>' +
        '<div class="stack">' +
          '<div class="card"><div class="panel-title">Training Queue</div><div class="stack">' + renderQueue(state) + '</div></div>' +
          '<div class="card"><div class="panel-title">Fleets</div><div class="stack">' + renderFleets(state) + '</div></div></div></div></div>';
  }

  function bind(state) {
    var createBtn = document.getElementById('createFleetBtn');
    if (createBtn) {
      createBtn.onclick = function () {
        var input = document.getElementById('fleetNameInput');
        var name = input ? input.value.trim() : '';
        FleetSystem.createFleet(state, name || undefined);
        if (input) input.value = '';
        window.App.render();
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
'''

path = "C:/Users/byron/OneDrive/Desktop/death-earth-prototypeV1/js/ui/ui-forces.js"
with open(path, "w") as f:
    f.write(content)
print("Written", len(content), "bytes")
