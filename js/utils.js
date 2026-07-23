window.Utils = {
  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  },

  round(value, places) {
    const p = Math.pow(10, places || 0);
    return Math.round(value * p) / p;
  },

  formatNumber(value) {
    return Math.floor(value).toLocaleString();
  },

  format1(value) {
    if (value === 0) return '0.0';
    if (value < 0.001) return this.round(value, 6).toFixed(6);
    if (value < 0.01) return this.round(value, 4).toFixed(4);
    if (value < 1) return this.round(value, 3).toFixed(3);
    return this.round(value, 1).toFixed(1);
  },

  formatPercent(value) {
    return `${Math.round(value * 100)}%`;
  },

  now() {
    return Date.now();
  },

  uid(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  },

  deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  },

  rand(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },

  chance(prob) {
    return Math.random() < prob;
  },

  pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  },

  weightedPick(items, getWeight) {
    const total = items.reduce((sum, item) => sum + getWeight(item), 0);
    let roll = Math.random() * total;
    for (let i = 0; i < items.length; i++) {
      roll -= getWeight(items[i]);
      if (roll <= 0) return items[i];
    }
    return items[0];
  },

  formatTime(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const m = Math.floor(s / 60);
    const r = s % 60;
    if (m > 0) return `${m}m ${r}s`;
    return `${r}s`;
  },

  costToHtml(cost) {
    return Object.keys(cost).map(k => `${GameData.resources[k].name}: ${this.formatNumber(cost[k])}`).join(" • ");
  },

  hasCost(state, cost) {
    return Object.keys(cost).every(k => (state.resources[k]?.amount || 0) >= cost[k]);
  },

  payCost(state, cost) {
    if (!this.hasCost(state, cost)) return false;
    Object.keys(cost).forEach(k => state.resources[k].amount -= cost[k]);
    return true;
  },

  grantResources(state, rewards) {
    Object.keys(rewards).forEach(k => {
      if (!state.resources[k]) return;
      state.resources[k].amount = Math.min(state.resources[k].cap, state.resources[k].amount + rewards[k]);
    });
  },

  el(id) {
    return document.getElementById(id);
  },

  setAccent(color) {
    document.documentElement.style.setProperty("--accent", color);
    document.documentElement.style.setProperty("--accent-soft", `${color}22`);
  }
};