window.EventSystem = (function () {
  function activateEvent(state, eventId) {
    if (state.events.active) return { ok: false, reason: "An event is already active" };
    const ev = GameData.events.find(e => e.id === eventId);
    if (!ev) return { ok: false, reason: "Event not found" };
    state.events.active = Utils.deepClone(ev);
    state.events.active.remaining = ev.duration;
    state.events.history.unshift({ name: ev.name, time: Date.now() });
    state.events.history = state.events.history.slice(0, 20);
    MailboxSystem.addMessage(state, "System", "Event Activated", `${ev.name} is now active. ${ev.desc}`);
    return { ok: true };
  }

  function tick(state, dt) {
    if (!state.events.active) return;
    state.events.active.remaining -= dt;

    if (state.events.active.effect && state.events.active.effect.reliefDrops && Utils.chance(0.03 * dt)) {
      const rewards = { ore: 40, solar: 40, crystal: 20, isotopes: 12 };
      Utils.grantResources(state, rewards);
      MailboxSystem.addMessage(state, "Alliance", "Relief Package Received", `Alliance relief delivered: ${Utils.costToHtml(rewards)}.`);
    }

    if (state.events.active.remaining <= 0) {
      MailboxSystem.addMessage(state, "System", "Event Ended", `${state.events.active.name} has concluded.`);
      state.events.active = null;
    }
  }

  return {
    activateEvent,
    tick
  };
})();