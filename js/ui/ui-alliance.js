window.UIAlliance = (function () {
  var currentTab = 'overview';

  var ROLE_NAMES = { recruit: 'Recruit', member: 'Member', officer: 'Officer', commander: 'Commander', founder: 'Founder' };

  function roleBadge(role) {
    return `<span class="badge role-${role}">${ROLE_NAMES[role] || role}</span>`;
  }

  function fmtTime(t) {
    if (!t) return '';
    var d = new Date(t);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ── Tabs ──
  function tabBar(myRole) {
    var isOfficer = AllianceSystem.roleLevel(myRole) >= 2;
    var isFounder = myRole === 'founder';
    return `
      <div class="alliance-tabs">
        <button class="btn small ${currentTab === 'overview' ? 'active' : ''}" onclick="UIAlliance.setTab('overview')">Overview</button>
        <button class="btn small ${currentTab === 'chat' ? 'active' : ''}" onclick="UIAlliance.setTab('chat')">Chat</button>
        ${isOfficer ? `<button class="btn small ${currentTab === 'officers' ? 'active' : ''}" onclick="UIAlliance.setTab('officers')">Officers</button>` : ''}
        ${isFounder ? `<button class="btn small ${currentTab === 'broadcast' ? 'active' : ''}" onclick="UIAlliance.setTab('broadcast')">Broadcast</button>` : ''}
      </div>
    `;
  }

  function renderOverview(state, joined) {
    var myRole = AllianceSystem.myRole();
    var isFounder = myRole === 'founder';
    var members = joined.members || [];
    var rows = members.map(function (m) {
      var actions = '';
      if (isFounder && m.username !== (window.Network ? Network.username : '')) {
        var roleOpts = ['recruit', 'member', 'officer', 'commander'].map(function (r) {
          return `<option value="${r}" ${m.role === r ? 'selected' : ''}>${ROLE_NAMES[r]}</option>`;
        }).join('');
        actions = `
          <div class="row" style="gap:4px; margin-top:2px;">
            <select class="input small" style="width:110px;" onchange="AllianceSystem.setRole('${m.username}', this.value); window.App.render();">${roleOpts}</select>
            <span class="small faint">set role</span>
          </div>
        `;
      }
      return `
        <div class="log-item space-between">
          <span>${m.username} ${roleBadge(m.role)}</span>
          ${actions}
        </div>
      `;
    }).join('');
    return `
      <div class="card">
        <div class="space-between">
          <div>
            <div class="panel-title">${joined.name}</div>
            <div class="small">Founder: ${joined.founder} — ${joined.memberCount || members.length} member${(joined.memberCount || members.length) !== 1 ? 's' : ''}</div>
            ${joined.motd ? `<div class="small faint" style="margin-top:4px;">📜 ${joined.motd}</div>` : ''}
          </div>
          <button class="btn small danger" onclick="AllianceSystem.leave(); window.App.render();">Leave</button>
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
    var canPost = myLevel >= 1;
    var isOfficer = myLevel >= 2;

    function chatBlock(channel, title, msgs, canUse) {
      var lines = (msgs || []).map(function (m) {
        var who = m.username === 'System' ? `<span class="faint">System</span>` : `<strong>${m.username}</strong>`;
        return `<div class="alliance-chat-line"><span class="chat-time">${fmtTime(m.time)}</span> ${who}: ${m.text}</div>`;
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
        ${chatBlock('alliance', 'Alliance Chat', AllianceSystem.chat.alliance, canPost)}
        ${isOfficer ? chatBlock('officers', 'Officer Chat', AllianceSystem.chat.officers, true) : ''}
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
            <select class="input small" style="width:110px;" onchange="AllianceSystem.setRole('${m.username}', this.value); window.App.render();">
              ${demoteOpts}
            </select>
            <span class="small faint">demote</span>
          </div>
        `;
      }
      return `<div class="log-item space-between"><span>${m.username} ${roleBadge(m.role)}</span>${actions}</div>`;
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
    return `
      <div class="card">
        <div class="panel-title">📢 Founder Broadcast</div>
        <div class="stack" style="gap:6px;">
          <div class="row" style="gap:6px;">
            <select id="bcastAudience" class="input small" style="width:140px;">
              <option value="all">All members</option>
              <option value="officers">Officers only</option>
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

  function renderJoined(state, joined) {
    var myRole = AllianceSystem.myRole();
    return `
      <div class="stack">
        ${tabBar(myRole)}
        ${currentTab === 'overview' ? renderOverview(state, joined) : ''}
        ${currentTab === 'chat' ? renderChat(state, joined) : ''}
        ${currentTab === 'officers' ? renderOfficers(state, joined) : ''}
        ${currentTab === 'broadcast' ? renderBroadcast() : ''}
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
                <strong>${a.name}</strong>
                <div class="small">Founder: ${a.founder} — ${a.memberCount || a.members.length} member${(a.memberCount || a.members.length) !== 1 ? 's' : ''}</div>
                ${a.motd ? `<div class="small faint">📜 ${a.motd}</div>` : ''}
              </div>
              <button class="btn small" onclick="AllianceSystem.join('${a.id}'); window.App.render();">Join</button>
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
            ? `<div class="small">Connected to <strong>${joinedData.name}</strong>.</div>`
            : `<div class="small">No alliance joined. Create your own or join an existing one below.</div>`}
        </div>
        ${joinedData ? renderJoined(state, joinedData) : renderCreateAllianceForm()}
        ${!joinedData ? '<div class="card"><div class="panel-title">Available Alliances</div>' + renderPool(state) + '</div>' : ''}
      </div>
    `;
  }

  return {
    render: render,
    setTab: function (t) { currentTab = t; window.App.render(); }
  };
})();
