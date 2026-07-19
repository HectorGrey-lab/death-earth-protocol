window.MarketSystem = (function () {
  function getRateModifier(state) {
    const lvl = state.buildings.marketNexus.level;
    return 1 - (lvl - 1) * 0.04;
  }

  function exchange(state, fromKey, toKey, amount) {
    amount = Math.max(10, parseInt(amount, 10) || 0);
    if (fromKey === toKey) return { ok: false, reason: "Invalid pair" };
    if (state.resources[fromKey].amount < amount) return { ok: false, reason: "Insufficient source resource" };

    const mod = getRateModifier(state);
    const gain = Math.floor(amount * 0.72 / mod);
    state.resources[fromKey].amount -= amount;
    state.resources[toKey].amount = Math.min(state.resources[toKey].cap, state.resources[toKey].amount + gain);

    const line = `Exchanged ${amount} ${GameData.resources[fromKey].name} for ${gain} ${GameData.resources[toKey].name}.`;
    state.market.transactions.unshift({ id: Utils.uid("tx"), text: line, time: Date.now() });
    state.market.transactions = state.market.transactions.slice(0, 20);
    MailboxSystem.addMessage(state, "System", "Market Transaction", line);
    return { ok: true };
  }

  function buyArtifact(state, listingId) {
    const listing = GameData.marketListings.find(l => l.id === listingId);
    if (!listing) return { ok: false, reason: "Listing not found" };
    if (!Utils.payCost(state, listing.price)) return { ok: false, reason: "Insufficient resources" };

    state.inventory.artifacts.push({
      id: Utils.uid("artifact"),
      templateId: listing.artifactId,
      foundAt: Date.now()
    });

    const art = GameData.artifacts.find(a => a.id === listing.artifactId);
    const text = `Purchased artifact ${art.name} for ${Utils.costToHtml(listing.price)}.`;
    state.market.transactions.unshift({ id: Utils.uid("tx"), text, time: Date.now() });
    state.market.transactions = state.market.transactions.slice(0, 20);
    MailboxSystem.addMessage(state, "Inbox", "Market Acquisition", text);
    return { ok: true };
  }

  return {
    exchange,
    buyArtifact,
    getRateModifier
  };
})();