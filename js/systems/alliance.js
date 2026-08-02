// AllianceSystem — client-side wrapper for alliance actions (server-authoritative)
const AllianceSystem = {
  create(name) {
    Network.send({ type: 'alliance_create', name: name });
  },
  join(allianceId) {
    Network.send({ type: 'alliance_join', allianceId: allianceId });
  },
  leave() {
    Network.send({ type: 'alliance_leave' });
  },
  setRole(targetUsername, role) {
    Network.send({ type: 'alliance_set_role', targetUsername: targetUsername, role: role });
  },
  sendChat(channel, text) {
    Network.send({ type: 'alliance_chat_send', channel: channel, text: text });
  },
  broadcast(subject, body, audience) {
    Network.send({ type: 'alliance_broadcast', subject: subject, body: body, audience: audience || 'all' });
  },
  setMotd(motd) {
    Network.send({ type: 'alliance_set_motd', motd: motd });
  },
  setPerms(perms) {
    Network.send({ type: 'alliance_set_perms', perms: perms });
  },
  getAudit(limit) {
    Network.send({ type: 'alliance_get_audit', limit: limit || 100 });
  },
  kick(target) {
    Network.send({ type: 'alliance_kick', targetUsername: target });
  },
  // ── Local helpers over GameData.alliances (server-pushed) ──
  all() {
    return (window.GameData && GameData.alliances) || [];
  },
  getJoinedId() {
    return window.gameState && window.gameState.alliance
      ? window.gameState.alliance.joinedId : null;
  },
  joined() {
    const id = this.getJoinedId();
    if (!id) return null;
    return this.all().find(a => a.id === id) || null;
  },
  roleOf(username) {
    const joined = this.joined();
    if (!joined) return null;
    const m = (joined.members || []).find(m => m.username === username);
    return m ? m.role : null;
  },
  myRole() {
    return this.roleOf(window.Network ? Network.username : null);
  },
  roleLevel(role) {
    const levels = { recruit: 0, member: 1, officer: 2, commander: 3, founder: 4 };
    return levels[role] !== undefined ? levels[role] : 0;
  },
  // Granular perms (server-authoritative; convenience for UI gating)
  DEFAULT_PERMS: {
    officer: { canUseOfficerChat: true, canEditMotd: false, canBroadcastOfficers: false, canKickRecruits: false, canViewAudit: true },
    commander: { canUseOfficerChat: true, canEditMotd: false, canBroadcastOfficers: false, canKickRecruits: false, canViewAudit: true, canKickMembers: false, canPromoteToOfficer: false }
  },
  perms() {
    const joined = this.joined();
    const p = (joined && joined.perms) || null;
    if (!p) return JSON.parse(JSON.stringify(this.DEFAULT_PERMS));
    const merged = JSON.parse(JSON.stringify(this.DEFAULT_PERMS));
    ['officer', 'commander'].forEach(function (rank) {
      if (p[rank] && typeof p[rank] === 'object') {
        Object.keys(merged[rank]).forEach(function (key) {
          if (typeof p[rank][key] === 'boolean') merged[rank][key] = p[rank][key];
        });
      }
    });
    return merged;
  },
  canEditMotd() {
    const myRole = this.myRole();
    if (myRole === 'founder') return true;
    return this.roleLevel(myRole) >= 2 && this.perms().officer.canEditMotd;
  },
  canViewAudit() {
    const myRole = this.myRole();
    if (myRole === 'founder') return true;
    return this.roleLevel(myRole) >= 2 && this.perms().officer.canViewAudit;
  },
  canBroadcastOfficers() {
    const myRole = this.myRole();
    if (myRole === 'founder') return true;
    return this.roleLevel(myRole) >= 2 && this.perms().officer.canBroadcastOfficers;
  },
  canKick(targetUsername) {
    const joined = this.joined();
    if (!joined) return false;
    const myRole = this.myRole();
    const myLvl = this.roleLevel(myRole);
    if (myRole === 'founder') return !!targetUsername && targetUsername !== (window.Network ? Network.username : '');
    const tgt = (joined.members || []).find(function (m) { return m.username === targetUsername; });
    if (!tgt) return false;
    const tgtLvl = this.roleLevel(tgt.role);
    const perms = this.perms();
    if (myLvl >= 3) {
      if (tgtLvl <= 0) return perms.commander.canKickRecruits;
      if (tgtLvl === 1) return perms.commander.canKickMembers;
      return false;
    }
    if (myLvl >= 2) return tgtLvl <= 0 && perms.officer.canKickRecruits;
    return false;
  },
  // Chat cache filled by alliance_chat_history / alliance_chat events
  chat: { alliance: [], officers: [] },
  resetChat() {
    this.chat = { alliance: [], officers: [] };
  },
  pushChat(entry) {
    const ch = entry.channel === 'officers' ? 'officers' : 'alliance';
    if (!Array.isArray(this.chat[ch])) this.chat[ch] = [];
    this.chat[ch].push(entry);
    if (this.chat[ch].length > 60) this.chat[ch] = this.chat[ch].slice(-60);
  }
};
