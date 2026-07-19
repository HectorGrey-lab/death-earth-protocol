window.UIMailbox = (function () {
  const tabs = ["Attack", "Defense", "Inbox", "Alliance", "System"];

  function renderPage(state) {
    const filtered = state.mailbox.messages.filter(m => m.tab === state.mailbox.selectedTab);
    const selected = filtered.find(m => m.id === state.mailbox.selectedMessageId) || filtered[0] || null;

    return `
      <div class="mail-tabs">
        ${tabs.map(tab => `
          <button class="btn small ${state.mailbox.selectedTab === tab ? "success" : ""}" onclick="window.gameState.mailbox.selectedTab='${tab}'; window.App.render();">${tab}</button>
        `).join("")}
      </div>
      <div class="mail-layout">
        <div class="mail-list">
          ${filtered.map(m => `
            <div class="mail-item ${selected && selected.id === m.id ? "selected" : ""}" onclick="window.gameState.mailbox.selectedMessageId='${m.id}'; window.App.render();">
              <strong>${m.subject}</strong>
              <div class="small">${new Date(m.time).toLocaleString()}</div>
            </div>
          `).join("") || `<div class="small">No messages in this tab.</div>`}
        </div>
        <div class="card">
          ${selected
            ? `<h3>${selected.subject}</h3><div class="small">${new Date(selected.time).toLocaleString()}</div><hr class="sep"><pre style="white-space:pre-wrap;font-family:inherit;">${selected.body}</pre>`
            : `<div class="small">Select a message.</div>`}
        </div>
      </div>
    `;
  }

  return { renderPage };
})();