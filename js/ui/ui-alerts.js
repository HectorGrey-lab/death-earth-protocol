window.UIAlerts = (function () {
  function render(state) {
    const el = Utils.el("alertsPanel");
    const alerts = [];

    if (state.events.active) {
      alerts.push({
        title: state.events.active.name,
        body: `${state.events.active.desc} • Remaining ${Utils.formatTime(state.events.active.remaining)}`,
        tone: "purple"
      });
    }

    state.combat.incomingAttacks.forEach(a => {
      const label = a.retaliation ? "Retaliation Force" : "Incoming Hostile Attack";
      const eta = a.remaining ? `ETA ${Utils.formatTime(a.remaining)}` : '';
      const from = a.attacker ? `From ${a.attacker}` : '';
      const threat = a.threatLevel && a.threatLevel !== '?' ? `Threat ${a.threatLevel}` : '';
      alerts.push({
        title: label,
        body: [from, threat, eta].filter(Boolean).join(' • '),
        tone: "red"
      });
    });

    if (state.research.active) {
      alerts.push({
        title: "Research In Progress",
        body: `${GameData.research[state.research.active.category].name} • ETA ${Utils.formatTime(state.research.active.remaining)}`,
        tone: "yellow"
      });
    }

    if (!alerts.length) {
      alerts.push({
        title: "Operational Stability",
        body: "No immediate command alerts.",
        tone: "green"
      });
    }

    el.innerHTML = `
      <div class="stack">
        ${alerts.map(a => `
          <div class="alert-item">
            <div class="space-between">
              <strong>${a.title}</strong>
              <span class="badge ${a.tone}">${a.tone}</span>
            </div>
            <div class="small">${a.body}</div>
          </div>
        `).join("")}
      </div>
    `;
  }

  return { render };
})();