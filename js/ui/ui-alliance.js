window.UIAlliance = (function () {
  var currentTab = 'overview';
  var _auditFetched = false;

  var ROLE_NAMES = { recruit: 'Recruit', member: 'Member', officer: 'Officer', commander: 'Commander', founder: 'Founder' };

  var PERM_LABELS = {
    canUseOfficerChat: 'Use officer chat',
    canEditMotd: 'Edit MOTD',
    canBroadcastOfficers: 'Broadcast to officers',
    canKickRecruits: 'Kick recruits',
    canViewAudit: 'View audit log',
    canKickMembers: 'Kick members',
    canPromoteToOfficer: 'Promote to officer'
  };

  function roleBadge(role) {
    return `<span class="badge role-${role}">${ROLE_NAMES[role] || role}</span>`;
  }

  function fmtTime(t) {
    if (!t) return '';
    var d = new Date(t);
    return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Tabs ──
  function tabBar(myRole) {
    var isOfficer = AllianceSystem.roleLevel(myRole) >= 2;
    var isFounder = myRole === 'founder';
    var canAudit = AllianceSystem.canViewAudit();
    var canBcast = AllianceSystem.canBroadcastOfficers();
    return `
      <div class="alliance-tabs">
        <button class="btn small ${currentTab === 'overview' ? 'active' : ''}" onclick="UIAlliance.setTab('overview')">Overview</button>
        <button class="btn small ${currentTab === 'chat' ? 'active' : ''}" onclick="UIAlliance.setTab('chat')">Chat</button>
        ${isOfficer ? `<button class="btn small ${currentTab === 'officers' ? 'active' : ''}" onclick="UIAlliance.setTab('officers')">Officers</button>` : ''}
        ${(isFounder || canBcast) ? `<button class="btn small ${currentTab === 'broadcast' ? 'active' : ''}" onclick="UIAlliance.setTab('broadcast')">Broadcast</button>` : ''}
        ${isFounder ? `<button class="btn small ${currentTab === 'settings' ? 'active' : ''}" onclick="UIAlliance.setTab('settings')">Settings</button>` : ''}
        ${canAudit ? `<button class="btn small ${currentTab === 'audit' ? 'active' : ''}" onclick="UIAlliance.setTab('audit')">Audit</button>` : ''}
      </div>
    `;
  }

  function renderOverview(state, joined) {
    var myRole = AllianceSystem.myRole();
    var isFounder = myRole === 'founder';
    var canEditMotd = AllianceSystem.canEditMotd();
    var members = joined.members || [];
    var rows = members.map(function (m) {
      var actions = '';
      if (isFounder && m.username !== (window.Network ? Network.username : '')) {
        var roleOpts = ['recruit', 'member', 'officer', 'commander'].map(function (r) {
          return `<option value="${r}" ${m.role === r ? 'selected' : ''}>${ROLE_NAMES[r]}</option>`;
        }).join('');
        actions = `
          <div class="row" style="gap:4px; margin-top:2px;">
            <select class="input small" style="width:110px;" onchange="AllianceSystem.setRole('${esc(m.username)}', this.value); window.App.render();">${roleOpts}</select>
            <span class="small faint">set role</span>
          </div>
        `;
      }
      var kickBtn = AllianceSystem.canKick(m.username)
        ? `<button class="btn tiny danger" title="Kick ${esc(m.username)}" onclick="if(confirm('Remove ${esc(m.username)} from the alliance?')){AllianceSystem.kick('${esc(m.username)}');}">✕</button>`
        : '';
      return `
        <div class="log-item space-between">
          <span>${esc(m.username)} ${roleBadge(m.role)}</span>
          <div class="row" style="gap:4px;">${actions}${kickBtn}</div>
        </div>
      `;
    }).join('');
    var motdBlock = joined.motd
      ? `<div class="small faint" style="margin-top:4px;">📜 ${joined.motd}</div>`
      : `<div class="small faint" style="margin-top:4px;">No message of the day set.</div>`;
    var motdEdit = canEditMotd
      ? `<button class="btn tiny" style="margin-left:6px;" onclick="UIAlliance.openMotdEditor()">✎ Edit</button>`
      : '';
    return `
      <div class="card">
        <div class="space-between">
          <div>
            <div class="panel-title">${esc(joined.name)}</div>
            <div class="small">Founder: ${esc(joined.founder)} — ${joined.memberCount || members.length} member${(joined.memberCount || members.length) !== 1 ? 's' : ''}</div>
            <div class="row" style="align-items:center; margin-top:4px;">${motdBlock}${motdEdit}</div>
          </div>
          <button class="btn small danger" onclick="if(confirm('Leave this alliance?')){AllianceSystem.leave(); window.App.render();}">Leave</button>
        </div>
      </div>
      <div class="card">
        <div class="panel-title">Members (${joined.memberCount || members.length})</div>
        <div class="list-tight">${rows || '<div class="small faint">No members.</div>'}</div>
      </div>
    `;
  }

  function renderChat(state, joined) {
    var myRole = AllianceSystem.myRole();
    var myLevel = AllianceSystem.roleLevel(myRole);
    var perms = AllianceSystem.perms();
    var canPostAll = myLevel >= 1;
    var canPostOfficers = myLevel >= 2 && (myRole === 'founder' || perms.officer.canUseOfficerChat);

    function chatBlock(channel, title, msgs, canUse) {
      var lines = (msgs || []).map(function (m) {
        var who = m.username === 'System' ? `<span class="faint">System</span>` : `<strong>${esc(m.username)}</strong>`;
        return `<div class="alliance-chat-line"><span class="chat-time">${fmtTime(m.time)}</span> ${who}: ${esc(m.text)}</div>`;
      }).join('');
      var input = canUse
        ? `<div class="row" style="gap:6px; margin-top:6px;">
            <input id="chatInput_${channel}" class="input" placeholder="Message..." style="flex:1;" maxlength="500"
              onkeydown="if(event.key==='Enter'){AllianceSystem.sendChat('${channel}', this.value); this.value='';}">
            <button class="btn small" onclick="AllianceSystem.sendChat('${channel}', document.getElementById('chatInput_${channel}').value); document.getElementById('chatInput_${channel}').value='';">Send</button>
          </div>`
        : (channel === 'officers'
            ? `<div class="small faint" style="margin-top:6px;">Officer channel — requires Officer rank or higher.</div>`
            : `<div class="small faint" style="margin-top:6px;">Recruits can read chat. Ask an officer to promote you to post.</div>`);
      return `
        <div class="card">
          <div class="panel-title">${title}</div>
          <div class="alliance-chat-log">${lines || '<div class="small faint">No messages yet.</div>'}</div>
          ${input}
        </div>
      `;
    }

    return `
      <div class="stack">
        ${chatBlock('alliance', 'Alliance Chat', AllianceSystem.chat.alliance, canPostAll)}
        ${canPostOfficers ? chatBlock('officers', 'Officer Chat', AllianceSystem.chat.officers, true) : ''}
      </div>
    `;
  }

  function renderOfficers(state, joined) {
    var myRole = AllianceSystem.myRole();
    var isFounder = myRole === 'founder';
    var members = joined.members || [];
    var officers = members.filter(function (m) { return AllianceSystem.roleLevel(m.role) >= 2; });
    var rows = officers.map(function (m) {
      var actions = '';
      if (isFounder && m.username !== (window.Network ? Network.username : '')) {
        var demoteOpts = ['member', 'recruit'].map(function (r) {
          return `<option value="${r}">${ROLE_NAMES[r]}</option>`;
        }).join('');
        actions = `
          <div class="row" style="gap:4px; margin-top:2px;">
            <select class="input small" style="width:110px;" onchange="AllianceSystem.setRole('${esc(m.username)}', this.value); window.App.render();">
              ${demoteOpts}
            </select>
            <span class="small faint">demote</span>
          </div>
        `;
      }
      var kickBtn = AllianceSystem.canKick(m.username)
        ? `<button class="btn tiny danger" title="Kick ${esc(m.username)}" onclick="if(confirm('Remove ${esc(m.username)} from the alliance?')){AllianceSystem.kick('${esc(m.username)}');}">✕</button>`
        : '';
      return `<div class="log-item space-between"><span>${esc(m.username)} ${roleBadge(m.role)}</span><div class="row" style="gap:4px;">${actions}${kickBtn}</div></div>`;
    }).join('');
    return `
      <div class="card">
        <div class="panel-title">Officer Roster (${officers.length})</div>
        <div class="small faint" style="margin-bottom:6px;">Officers can post in Officer Chat. Founders can promote/demote from Overview too.</div>
        <div class="list-tight">${rows || '<div class="small faint">No officers yet.</div>'}</div>
      </div>
    `;
  }

  function renderBroadcast() {
    var isFounder = AllianceSystem.myRole() === 'founder';
    var audienceOpts = isFounder
      ? `<option value="all">All members</option><option value="officers">Officers only</option>`
      : `<option value="officers" selected>Officers only</option>`;
    return `
      <div class="card">
        <div class="panel-title">📢 Alliance Broadcast</div>
        <div class="stack" style="gap:6px;">
          <div class="row" style="gap:6px;">
            <select id="bcastAudience" class="input small" style="width:140px;">
              ${audienceOpts}
            </select>
            <input id="bcastSubject" class="input" placeholder="Subject (required)" maxlength="80" style="flex:1;">
          </div>
          <textarea id="bcastBody" class="input" rows="4" placeholder="Message body..." maxlength="1500"></textarea>
          <button class="btn success" onclick="AllianceSystem.broadcast(document.getElementById('bcastSubject').value, document.getElementById('bcastBody').value, document.getElementById('bcastAudience').value); window.App.render();">Send Broadcast</button>
          <div class="small faint">Delivered as mail to every selected member's inbox. A system line is posted in Alliance Chat.</div>
        </div>
      </div>
    `;
  }

  function renderSettings() {
    var perms = AllianceSystem.perms();
    function permRow(rank, key) {
      return `
        <label class="log-item space-between" style="cursor:pointer;">
          <span>${PERM_LABELS[key] || key}</span>
          <input type="checkbox" id="perm_${rank}_${key}" ${perms[rank][key] ? 'checked' : ''}>
        </label>
      `;
    }
    function permCard(rank, title, extraKeys) {
      var keys = ['canUseOfficerChat', 'canEditMotd', 'canBroadcastOfficers', 'canKickRecruits', 'canViewAudit'].concat(extraKeys || []);
      return `
        <div class="card">
          <div class="panel-title">${title}</div>
          <div class="list-tight">${keys.map(function (k) { return permRow(rank, k); }).join('')}</div>
        </div>
      `;
    }
    return `
      <div class="stack">
        ${permCard('officer', 'Officer Permissions')}
        ${permCard('commander', 'Commander Permissions', ['canKickMembers', 'canPromoteToOfficer'])}
        <button class="btn success" onclick="UIAlliance.saveSettings()">Save Permissions</button>
        <div class="small faint">Founder can always do everything. Changes apply immediately to all members.</div>
      </div>
    `;
  }

  function renderAudit(state) {
    var entries = (state.alliance && state.alliance.auditEntries) || [];
    var rows = entries.map(function (e) {
      var tgt = e.target ? ` → <strong>${esc(e.target)}</strong>` : '';
      var metaStr = '';
      if (e.meta && e.meta.from && e.meta.to) metaStr = ` (${esc(e.meta.from)} → ${esc(e.meta.to)})`;
      if (e.meta && e.meta.audience) metaStr = ` (to ${esc(e.meta.audience)})`;
      return `<div class="log-item"><span class="chat-time">${fmtTime(e.time)}</span> <strong>${esc(e.actor)}</strong> ${esc(e.action)}${tgt}${metaStr}</div>`;
    }).join('');
    return `
      <div class="card">
        <div class="space-between">
          <div class="panel-title">Alliance Audit Log</div>
          <button class="btn small" onclick="AllianceSystem.getAudit(100);">Refresh Audit</button>
        </div>
        <div class="small faint" style="margin-bottom:6px;">Join/leave/promote/MOTD/broadcast/kick events, newest first.</div>
        <div class="alliance-chat-log" style="max-height:320px; overflow-y:auto;">${rows || '<div class="small faint">No audit entries yet.</div>'}</div>
      </div>
    `;
  }

  function renderJoined(state, joined) {
    var myRole = AllianceSystem.myRole();
    // Auto-fetch audit the first time the tab is opened
    if (currentTab === 'audit' && !_auditFetched) {
      _auditFetched = true;
      AllianceSystem.getAudit(100);
    }
    return `
      <div class="stack">
        ${tabBar(myRole)}
        ${currentTab === 'overview' ? renderOverview(state, joined) : ''}
        ${currentTab === 'chat' ? renderChat(state, joined) : ''}
        ${currentTab === 'officers' ? renderOfficers(state, joined) : ''}
        ${currentTab === 'broadcast' ? renderBroadcast() : ''}
        ${currentTab === 'settings' ? renderSettings() : ''}
        ${currentTab === 'audit' ? renderAudit(state) : ''}
      </div>
    `;
  }

  function renderCreateAllianceForm() {
    return `
      <div class="card">
        <div class="panel-title">Create an Alliance</div>
        <div class="row" style="gap:8px;">
          <input id="createAllianceInput" class="input" placeholder="Alliance name..." style="flex:1;" maxlength="32">
          <button class="btn success" onclick="AllianceSystem.create(document.getElementById('createAllianceInput').value); window.App.render();">Create</button>
        </div>
      </div>
    `;
  }

  function renderPool(state) {
    var alliances = AllianceSystem.all();
    if (alliances.length === 0) {
      return `<div class="small">No alliances exist yet. Create the first one!</div>`;
    }
    return `
      <div class="stack">
        ${alliances.map(function (a) {
          return `
          <div class="card">
            <div class="space-between">
              <div>
                <strong>${esc(a.name)}</strong>
                <div class="small">Founder: ${esc(a.founder)} — ${a.memberCount || a.members.length} member${(a.memberCount || a.members.length) !== 1 ? 's' : ''}</div>
                ${a.motd ? `<div class="small faint">📜 ${esc(a.motd)}</div>` : ''}
              </div>
              <button class="btn small" onclick="AllianceSystem.join('${esc(a.id)}'); window.App.render();">Join</button>
            </div>
          </div>
        `;
        }).join("")}
      </div>
    `;
  }

  function render(state) {
    const joinedData = AllianceSystem.joined();
    return `
      <div class="stack">
        <div class="card">
          <div class="panel-title">Alliance Link</div>
          ${joinedData
            ? `<div class="small">Connected to <strong>${esc(joinedData.name)}</strong>.</div>`
            : `<div class="small">No alliance joined. Create your own or join an existing one below.</div>`}
        </div>
        ${joinedData ? renderJoined(state, joinedData) : renderCreateAllianceForm()}
        ${!joinedData ? '<div class="card"><div class="panel-title">Available Alliances</div>' + renderPool(state) + '</div>' : ''}
      </div>
    `;
  }

  // ── MOTD editor modal ──
  function openMotdEditor() {
    var joined = AllianceSystem.joined();
    if (!joined) return;
    var html = `
      <input id="motdEditorInput" class="input" placeholder="Message of the day..." maxlength="240" style="width:100%;box-sizing:border-box;margin-bottom:12px;" value="${esc(joined.motd || '')}">
      <button id="motdEditorSave" class="btn success" style="width:100%;">Save MOTD</button>
    `;
    UIModal.open('Edit MOTD', html);
    document.getElementById('motdEditorSave').onclick = function () {
      AllianceSystem.setMotd(document.getElementById('motdEditorInput').value);
      UIModal.close();
      window.App.render();
    };
  }

  function saveSettings() {
    var perms = AllianceSystem.perms();
    ['officer', 'commander'].forEach(function (rank) {
      Object.keys(perms[rank]).forEach(function (key) {
        var el = document.getElementById('perm_' + rank + '_' + key);
        if (el) perms[rank][key] = el.checked;
      });
    });
    AllianceSystem.setPerms(perms);
    window.App.render();
  }

  return {
    render: render,
    setTab: function (t) { currentTab = t; _auditFetched = false; window.App.render(); },
    openMotdEditor: openMotdEditor,
    saveSettings: saveSettings
  };
})();
