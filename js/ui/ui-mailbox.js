window.UIMailbox = (function () {
  const tabs = ["Attack", "Defense", "Inbox", "Alliance", "System"];

  function renderPage(state) {
    const filtered = state.mailbox.messages.filter(m => m.tab === state.mailbox.selectedTab);
    const selected = filtered.find(m => m.id === state.mailbox.selectedMessageId) || filtered[0] || null;

    return `
      <div class="mail-tabs" id="mailTabs">
        ${tabs.map(tab => `
          <button class="btn small ${state.mailbox.selectedTab === tab ? "success" : ""}" data-mail-tab="${tab}">${tab}</button>
        `).join("")}
      </div>
      <div class="mail-layout">
        <div class="mail-list" id="mailList">
          ${filtered.map(m => `
            <div class="mail-item ${selected && selected.id === m.id ? "selected" : ""}" data-mail-id="${m.id}">
              <strong>${m.subject}</strong>
              <div class="small">${new Date(m.time).toLocaleString()}</div>
            </div>
          `).join("") || `<div class="small">No messages in this tab.</div>`}
        </div>
        <div class="card" id="mailPreview">
          ${selected
            ? `<h3>${selected.subject}</h3><div class="small">${new Date(selected.time).toLocaleString()}</div><hr class="sep"><pre style="white-space:pre-wrap;font-family:inherit;">${selected.body}</pre>`
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
            preview.innerHTML = '<h3>' + selected.subject + '</h3><div class="small">' + new Date(selected.time).toLocaleString() + '</div><hr class="sep"><pre style="white-space:pre-wrap;font-family:inherit;">' + selected.body + '</pre>';
          } else {
            preview.innerHTML = '<div class="small">Select a message.</div>';
          }
        }
      });
    }
  }

  return { renderPage: renderPage, bind: bind };
})();
