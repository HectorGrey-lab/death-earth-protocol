window.UILeaderboard = (function () {
  var categories = [
    { id: 'population', label: 'Population', icon: '👥' },
    { id: 'raider', label: 'Raider', icon: '⚔️' },
    { id: 'attacker', label: 'Attacker', icon: '💥' },
    { id: 'defence', label: 'Defence', icon: '🛡️' }
  ];

  var activeCategory = 'population';
  var activeScope = 'players'; // 'players' | 'alliances'

  function renderPage(state) {
    var data = activeScope === 'alliances' ? (state.allianceLeaderboard || {}) : (state.leaderboard || {});
    var cat = activeCategory;
    var entries = data[cat] || [];
    var header = categories.find(function(c) { return c.id === cat; }) || categories[0];

    var scopeTabs = [
      { id: 'players', label: 'Commanders' },
      { id: 'alliances', label: 'Alliances' }
    ].map(function(s) {
      var active = s.id === activeScope ? ' active' : '';
      return '<button class="lb-scope' + active + '" data-lb-scope="' + s.id + '">' + s.label + '</button>';
    }).join('');

    var tabs = categories.map(function(c) {
      var active = c.id === cat ? ' active' : '';
      return '<button class="lb-tab' + active + '" data-lb-cat="' + c.id + '">' + c.icon + ' ' + c.label + '</button>';
    }).join('');

    var rows = entries.length ? entries.map(function(e, i) {
      var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
      var cls = e.isYou ? ' lb-row-you' : '';
      var members = (activeScope === 'alliances' && e.members != null)
        ? '<span class="lb-members">' + e.members + ' member' + (e.members === 1 ? '' : 's') + '</span>'
        : '';
      return '<div class="lb-row' + cls + '">' +
        '<span class="lb-rank">' + (medal || '#' + (i + 1)) + '</span>' +
        '<span class="lb-name">' + escLB(e.name) + members + '</span>' +
        '<span class="lb-score">' + formatScore(e.score) + '</span>' +
        '</div>';
    }).join('') : '<div class="small" style="padding:20px;text-align:center;">No data yet.</div>';

    return '<div class="lb-container" id="lbContainer">' +
      '<div class="lb-scopes">' + scopeTabs + '</div>' +
      '<div class="lb-tabs">' + tabs + '</div>' +
      '<div class="lb-header"><strong>' + header.icon + ' ' + header.label + '</strong>' +
      '<span class="small">' + (activeScope === 'alliances' ? 'Combined team totals' :
        header.id === 'population' ? 'Largest colonies' :
        header.id === 'raider' ? 'Most successful raids' :
        header.id === 'attacker' ? 'Highest attack power' :
        'Strongest defences') + '</span></div>' +
      '<div class="lb-entries">' + rows + '</div>' +
      '</div>';
  }

  function bindPage(state) {
    document.querySelectorAll('.lb-tab').forEach(function(btn) {
      btn.onclick = function() {
        activeCategory = btn.dataset.lbCat;
        if (window.App) window.App.render();
      };
    });
    document.querySelectorAll('.lb-scope').forEach(function(btn) {
      btn.onclick = function() {
        activeScope = btn.dataset.lbScope;
        if (window.App) window.App.render();
      };
    });
  }

  function setData(playerData, allianceData) {
    // playerData: { population: [...], raider: [...], attacker: [...], defence: [...] }
    // allianceData: same shape with { name, score, allianceId, members }
    if (window.gameState) {
      window.gameState.leaderboard = playerData;
      if (allianceData) window.gameState.allianceLeaderboard = allianceData;
    }
  }

  function formatScore(val) {
    if (typeof val === 'number') {
      if (val >= 1000000) return (val / 1000000).toFixed(1) + 'M';
      if (val >= 1000) return (val / 1000).toFixed(1) + 'K';
      return Math.floor(val).toString();
    }
    return val || '0';
  }

  function escLB(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  return {
    renderPage: renderPage,
    bindPage: bindPage,
    setData: setData
  };
})();
