window.UIMailbox = (function () {
  const tabs = ["Attack", "Defense", "Inbox", "Alliance", "System"];

  function esc(m) { return String(m == null ? '' : m).replace(/[&<>"']/g, function(c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  // Render a structured combat report card (combat_report_v2) with full HTML escaping.
  function renderCombatCard(m) {
    const d = m.data || {};
    const isPvp = d.kind === 'pvp';
    const win = !!d.attackerWins;
    const perspective = d.perspective || 'defender';
    const outcome = isPvp
      ? (perspective === 'attacker' ? (win ? 'VICTORY' : 'DEFEAT') : (win ? 'COLONY RAIDED' : 'DEFENDER VICTORY'))
      : (d.defended ? 'DEFENDED' : 'DAMAGE TAKEN');
    const outcomeClass = isPvp ? (win ? 'victory' : 'defeat') : (d.defended ? 'victory' : 'defeat');

    function casRows(cas) {
      const keys = Object.keys(cas || {});
      if (keys.length === 0) return '<tr><td colspan="2" class="small">None</td></tr>';
      return keys.map(k => `<tr><td>${esc(k)}</td><td>× ${esc(cas[k])}</td></tr>`).join('');
    }

    function lootRows(loot) {
      const keys = ['ore', 'solar', 'crystal', 'isotopes'].filter(k => (loot[k] || 0) > 0);
      if (keys.length === 0) return '<tr><td colspan="2" class="small">None</td></tr>';
      return keys.map(k => `<tr><td>${esc(k)}</td><td>${esc(loot[k])}</td></tr>`).join('');
    }

    function bldgRows(bd) {
      if (!bd || bd.length === 0) return '<tr><td colspan="2" class="small">None</td></tr>';
      return bd.map(b => {
        const lvl = (b.levelAfter !== undefined && b.levelBefore !== undefined && b.levelAfter < b.levelBefore)
          ? ` (level ${esc(b.levelBefore)} → ${esc(b.levelAfter)})` : '';
        return `<tr><td>${esc(b.key)}${lvl}</td><td>${esc(b.before)} → ${esc(b.after)}</td></tr>`;
      }).join('');
    }

    return `
      <div class="combat-report">
        <div class="cr-header ${outcomeClass}"><strong>⚔ ${isPvp ? 'PvP BATTLE REPORT' : 'DEFENSE REPORT'}</strong> — ${esc(outcome)}</div>
        <div class="small">${esc(new Date(m.time).toLocaleString())} · ID: ${esc(d.reportId || '')}</div>
        <div class="cr-route">${esc(d.attackerPlanet || '?')} → ${esc(d.defenderPlanet || '?')}</div>
        <table class="cr-table">
          <tr><th colspan="2">Power</th></tr>
          <tr><td>Attacker Power</td><td>${esc(d.attackerPower)}</td></tr>
          <tr><td>Defender Power</td><td>${esc(d.defenderPower)}</td></tr>
          <tr><td>Defender Shield</td><td>${esc(d.shieldNow)}</td></tr>
          <tr><td>Ratio</td><td>${esc((d.ratio || 0).toFixed(3))} (threshold 0.330)</td></tr>
        </table>
        <table class="cr-table">
          <tr><th colspan="2">Losses</th></tr>
          ${casRows(d.attackerCasualties)}
          ${casRows(d.defenderCasualties)}
        </table>
        <table class="cr-table">
          <tr><th colspan="2">Loot (Carry Cap: ${esc(d.carryCap || 0)})</th></tr>
          ${lootRows(d.loot)}
        </table>
        <table class="cr-table">
          <tr><th colspan="2">Building Damage</th></tr>
          ${bldgRows(d.buildingDamage)}
        </table>
        <div class="small cr-fleet">Fleet: ${d.survivorsReturning ? `Survivors returning (ETA ${esc(d.returnEta)}s)` : 'No survivors returning'}</div>
      </div>`;
  }

  // Render a message body: structured card for combat_report_v2, <pre> fallback otherwise.
  function renderBody(m) {
    if (m.type === 'combat_report_v2' && m.data) {
      return renderCombatCard(m);
    }
    return `<pre style="white-space:pre-wrap;font-family:inherit;">${esc(m.body)}</pre>`;
  }

  function renderPage(state) {
    // Mark all messages as read when mailbox is opened
    if (state.mailbox && state.mailbox.messages) {
      for (var i = 0; i < state.mailbox.messages.length; i++) {
        state.mailbox.messages[i].isNew = false;
      }
    }
    // Per-tab counts: how many messages live in each tab (0 shown only for the active tab)
    var counts = { Attack: 0, Defense: 0, Inbox: 0, Alliance: 0, System: 0 };
    if (state.mailbox && state.mailbox.messages) {
      for (var c = 0; c < state.mailbox.messages.length; c++) {
        var t = state.mailbox.messages[c].tab;
        if (counts[t] !== undefined) counts[t]++;
      }
    }
    const filtered = state.mailbox.messages.filter(m => m.tab === state.mailbox.selectedTab);
    const selected = filtered.find(m => m.id === state.mailbox.selectedMessageId) || filtered[0] || null;

    return `
      <div class="mail-tabs" id="mailTabs">
        ${tabs.map(tab => `
          <button class="btn small ${state.mailbox.selectedTab === tab ? "success" : ""}" data-mail-tab="${tab}">
            ${tab}${counts[tab] > 0 ? ` <span class="mail-tab-count">${counts[tab]}</span>` : ""}
          </button>
        `).join("")}
      </div>
      <div class="mail-layout">
        <div class="mail-list" id="mailList">
          ${filtered.map(m => `
            <div class="mail-item ${selected && selected.id === m.id ? "selected" : ""}" data-mail-id="${m.id}">
              <strong>${esc(m.subject)}</strong>
              <div class="small">${new Date(m.time).toLocaleString()}</div>
            </div>
          `).join("") || `<div class="small">No messages in this tab.</div>`}
        </div>
        <div class="card" id="mailPreview">
          ${selected
            ? `<h3>${esc(selected.subject)}</h3><div class="small">${new Date(selected.time).toLocaleString()}</div><hr class="sep">${renderBody(selected)}`
            : `<div class="small">Select a message.</div>`}
        </div>
      </div>
    `;
  }

  function bind(state) {
    // Tab switching — full re-render needed (different filtered list)
    var tabContainer = document.getElementById('mailTabs');
    if (tabContainer) {
      tabContainer.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-mail-tab]');
        if (btn) {
          state.mailbox.selectedTab = btn.dataset.mailTab;
          window.App.render();
        }
      });
    }

    // Message selection — targeted preview update only (no page re-render)
    var list = document.getElementById('mailList');
    if (list) {
      list.addEventListener('click', function (e) {
        var item = e.target.closest('[data-mail-id]');
        if (!item) return;

        var id = item.dataset.mailId;
        state.mailbox.selectedMessageId = id;

        // Find the selected message
        var filtered = state.mailbox.messages.filter(function (m) { return m.tab === state.mailbox.selectedTab; });
        var selected = null;
        for (var i = 0; i < filtered.length; i++) {
          if (filtered[i].id === id) { selected = filtered[i]; break; }
        }

        // Update selected class on list items
        var items = list.querySelectorAll('.mail-item');
        for (var j = 0; j < items.length; j++) {
          items[j].classList.toggle('selected', items[j].dataset.mailId === id);
        }

        // Update preview card content
        var preview = document.getElementById('mailPreview');
        if (preview) {
          if (selected) {
            preview.innerHTML = '<h3>' + esc(selected.subject) + '</h3><div class="small">' + new Date(selected.time).toLocaleString() + '</div><hr class="sep">' + renderBody(selected);
          } else {
            preview.innerHTML = '<div class="small">Select a message.</div>';
          }
        }
      });
    }
  }

  return { renderPage: renderPage, bind: bind };
})();
