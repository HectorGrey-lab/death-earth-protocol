/* UIOptions — Options tab: Help/Starter Guide, Edit Profile, Logout, Delete Account */
window.UIOptions = (function () {
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;'); }

  // ── Help / Starter Guide data (driven by GameData) ──────────────
  function helpSections() {
    var gd = window.GameData || {};
    var sections = [];
    sections.push({
      title: "🚀 Getting Started",
      body: "<p><b>1. Claim your colony.</b> Your command center is your home base. Build Extraction Grids first to raise resource production.</p>" +
        "<p><b>2. Train forces.</b> Use the Forces tab to train Recon Scouts and Rifle Units — they defend your colony and let you raid.</p>" +
        "<p><b>3. Scout & raid.</b> Open the World Map, scan sectors, and scout neighbors. Raid abandoned or weak colonies for resources.</p>" +
        "<p><b>4. Research.</b> Economy research boosts production; Military and Defense research power up your troops and shields.</p>" +
        "<p><b>5. Join an alliance.</b> Alliances share intel, coordinate attacks, and protect members. Check the Alliance tab.</p>" +
        "<p><b>6. Watch your shield.</b> Keep shield energy up — when it drops, your defenses are weaker. NPC raids and player attacks reduce it.</p>"
    });
    if (gd.missions && gd.missions.length) {
      sections.push({
        title: "🎯 Missions (" + gd.missions.length + ")",
        body: "<ul class='opt-list'>" + gd.missions.map(function (m) {
          return "<li><b>" + esc(m.name) + "</b> — " + esc(m.desc || '') + " <span class='opt-meta'>Reward: " + rewardStr(m.reward) + "</span></li>";
        }).join("") + "</ul>"
      });
    }
    var b = gd.buildings || {};
    var bKeys = Object.keys(b);
    if (bKeys.length) {
      sections.push({
        title: "🏗️ Buildings (" + bKeys.length + ")",
        body: "<ul class='opt-list'>" + bKeys.map(function (k) {
          var d = b[k];
          return "<li><b>" + esc(d.name) + "</b> — " + esc(d.desc || '') + " <span class='opt-meta'>" + costStr(d.baseCost) + "</span></li>";
        }).join("") + "</ul>"
      });
    }
    var t = gd.troops || {};
    var tKeys = Object.keys(t);
    if (tKeys.length) {
      sections.push({
        title: "🪖 Forces (" + tKeys.length + ")",
        body: "<ul class='opt-list'>" + tKeys.map(function (k) {
          var d = t[k];
          return "<li><b>" + esc(d.name) + "</b> — " + esc(d.desc || d.role || '') + " <span class='opt-meta'>PWR " + esc(d.power) + " / DEF " + esc(d.defense) + " / " + costStr(d.cost) + "</span></li>";
        }).join("") + "</ul>"
      });
    }
    var r = gd.research || {};
    var rKeys = Object.keys(r);
    if (rKeys.length) {
      sections.push({
        title: "🔬 Research (" + rKeys.length + ")",
        body: "<ul class='opt-list'>" + rKeys.map(function (k) {
          var d = r[k];
          return "<li><b>" + esc(d.name) + "</b> — " + esc(d.desc || '') + " <span class='opt-meta'>" + costStr(d.baseCost) + "</span></li>";
        }).join("") + "</ul>"
      });
    }
    sections.push({
      title: "🛡️ Defence & PvP",
      body: "<p><b>Shield.</b> Regenerates over time. When it hits zero, incoming attacks hit your troops directly.</p>" +
        "<p><b>Incoming attacks.</b> A red border alert appears when a player attacks you. Defend with troops, or check the Mailbox for the combat report.</p>" +
        "<p><b>NPC raids.</b> Hostile NPCs raid periodically. Strong defence reduces damage; the System Log records repelled raids.</p>"
    });
    sections.push({
      title: "⚙️ Gameplay Tips",
      body: "<p><b>Idle time.</b> Resources keep producing while you're away — check back to upgrade and expand.</p>" +
        "<p><b>Queue Relay.</b> Left panel shows active construction, training, and research timers.</p>" +
        "<p><b>Market.</b> Trade surplus resources or list artifacts for other commanders.</p>" +
        "<p><b>Mailbox.</b> Combat reports and system notices arrive here — read them to learn from every battle.</p>"
    });
    return sections;
  }

  function rewardStr(reward) {
    if (!reward) return '';
    var parts = [];
    if (reward.ore) parts.push(esc(reward.ore) + ' Ore');
    if (reward.solar) parts.push(esc(reward.solar) + ' Solar');
    if (reward.crystal) parts.push(esc(reward.crystal) + ' Crystal');
    if (reward.isotopes) parts.push(esc(reward.isotopes) + ' Isotopes');
    return parts.join(', ');
  }

  function costStr(cost) {
    if (!cost) return '';
    var parts = [];
    if (cost.ore) parts.push(esc(cost.ore) + ' Ore');
    if (cost.solar) parts.push(esc(cost.solar) + ' Solar');
    if (cost.crystal) parts.push(esc(cost.crystal) + ' Crystal');
    if (cost.isotopes) parts.push(esc(cost.isotopes) + ' Iso');
    return 'Cost: ' + parts.join(', ');
  }

  // ── Render ──────────────────────────────────────────────────────
  function render(state) {
    var profile = state.profile || {};
    var displayName = profile.displayName || '';
    var baseName = (state.commander && state.commander.planetName) || '';
    var username = (state.commander && state.commander.name || '').replace(/^Commander\s*/, '') || '';
    if (!username && state._username) username = state._username;

    var help = helpSections().map(function (s, i) {
      return "<div class='opt-acc-item'>" +
        "<button class='opt-acc-head' data-acc='" + i + "' aria-expanded='false'>" + s.title + " <span class='opt-acc-caret'>▸</span></button>" +
        "<div class='opt-acc-body' id='optAccBody" + i + "' style='display:none;'>" + s.body + "</div>" +
        "</div>";
    }).join("");

    return "" +
      "<div class='opt-grid'>" +
      "  <section class='panel opt-section'>" +
      "    <div class='panel-title'>Help & Starter Guide</div>" +
      "    <div class='opt-acc' id='optHelpAcc'>" + help + "</div>" +
      "  </section>" +
      "  <section class='panel opt-section'>" +
      "    <div class='panel-title'>Profile</div>" +
      "    <div class='opt-form'>" +
      "      <div class='opt-meta'>Display Name: <b id='optDisplayNameView'>" + esc(displayName) + "</b></div>" +
      "      <div class='opt-meta'>Base / Planet Name: <b id='optBaseNameView'>" + esc(baseName) + "</b></div>" +
      "      <div class='opt-meta'>Login: <b>" + esc(username) + "</b> — your login name cannot be changed.</div>" +
      "      <button class='btn' id='optEditProfileBtn'>Edit Profile</button> " +
      "      <span id='optProfileMsg' class='opt-msg'></span>" +
      "    </div>" +
      "  </section>" +
      "  <section class='panel opt-section'>" +
      "    <div class='panel-title'>Session</div>" +
      "    <div class='opt-form'>" +
      "      <p class='opt-meta'>End your session on this device. Your colony keeps running while you're away.</p>" +
      "      <button class='btn' id='optLogoutBtn'>Log Out</button>" +
      "    </div>" +
      "  </section>" +
      "  <section class='panel opt-section opt-danger'>" +
      "    <div class='panel-title'>Danger Zone</div>" +
      "    <div class='opt-form'>" +
      "      <p class='opt-meta'>Deleting your account permanently removes your colony, troops, research, and alliances. This cannot be undone.</p>" +
      "      <label class='opt-label'>Type <b>DELETE</b> to confirm<br>" +
      "        <input type='text' id='optDeleteConfirm' maxlength='12' placeholder='DELETE'></label>" +
      "      <button class='btn danger' id='optDeleteBtn' disabled>Delete Account</button> " +
      "      <span id='optDeleteMsg' class='opt-msg'></span>" +
      "    </div>" +
      "  </section>" +
      "</div>";
  }

  // ── Bind ────────────────────────────────────────────────────────
  function bind(state) {
    // Help accordion
    document.querySelectorAll(".opt-acc-head").forEach(function (head) {
      head.onclick = function () {
        var idx = head.dataset.acc;
        var body = Utils.el("optAccBody" + idx);
        var open = body.style.display !== 'none';
        body.style.display = open ? 'none' : 'block';
        head.setAttribute('aria-expanded', String(!open));
        head.querySelector('.opt-acc-caret').textContent = open ? '▸' : '▾';
      };
    });

    // Delete confirm gate
    var delInput = Utils.el("optDeleteConfirm");
    var delBtn = Utils.el("optDeleteBtn");
    if (delInput && delBtn) {
      delInput.oninput = function () {
        delBtn.disabled = delInput.value !== 'DELETE';
      };
      delBtn.onclick = function () {
        delBtn.disabled = true;
        Utils.el("optDeleteMsg").textContent = 'Deleting…';
        if (window.Network && Network.send) {
          Network.send({ type: 'delete_account', confirm: delInput.value });
        }
      };
    }

    // Edit Profile → modal with Display Name + Base Name inputs
    var editBtn = Utils.el("optEditProfileBtn");
    if (editBtn) {
      editBtn.onclick = function () {
        var profile = state.profile || {};
        var curDn = profile.displayName || '';
        var curBn = (state.commander && state.commander.planetName) || profile.baseName || '';
        UIModal.open("Edit Profile", "" +
          "<label class='opt-label' style='display:block;margin-bottom:10px;'>Display Name (3-20 chars, letters/numbers/spaces/_-)<br>" +
          "<input type='text' id='optDisplayName' maxlength='20' value='" + esc(curDn) + "' style='width:100%;margin-top:4px;box-sizing:border-box;'></label>" +
          "<label class='opt-label' style='display:block;margin-bottom:10px;'>Base / Planet Name (3-24 chars)<br>" +
          "<input type='text' id='optBaseName' maxlength='24' value='" + esc(curBn) + "' style='width:100%;margin-top:4px;box-sizing:border-box;'></label>" +
          "<div class='opt-meta' style='margin-bottom:10px;'>Login name cannot be changed.</div>" +
          "<button class='btn' id='optSaveProfile'>Save</button> " +
          "<span id='optProfileMsg' class='opt-msg'></span>");
        var saveBtn = Utils.el("optSaveProfile");
        if (saveBtn) {
          saveBtn.onclick = function () {
            var dn = (Utils.el("optDisplayName").value || '').trim().replace(/\s+/g, ' ');
            var bn = (Utils.el("optBaseName").value || '').trim().replace(/\s+/g, ' ');
            var msgEl = Utils.el("optProfileMsg");
            if (dn.length < 3 || dn.length > 20) { msgEl.textContent = 'Display name must be 3-20 characters.'; return; }
            if (bn.length < 3 || bn.length > 24) { msgEl.textContent = 'Base name must be 3-24 characters.'; return; }
            if (!/^[A-Za-z0-9 _-]+$/.test(dn) || !/^[A-Za-z0-9 _-]+$/.test(bn)) { msgEl.textContent = 'Only letters, numbers, spaces, _ and - allowed.'; return; }
            msgEl.textContent = 'Saving…';
            if (window.Network && Network.send) {
              Network.send({ type: 'profile_update', displayName: dn, baseName: bn });
            }
          };
        }
      };
    }

    // Logout
    var logoutBtn = Utils.el("optLogoutBtn");
    if (logoutBtn) {
      logoutBtn.onclick = function () {
        if (window.Network && Network.send) {
          try { Network.send({ type: 'logout' }); } catch (e) {}
        }
        try {
          localStorage.removeItem("de_token");
          localStorage.removeItem("de_username");
        } catch (e) {}
        window.location.href = "/login";
      };
    }
  }

  return {
    render: render,
    bind: bind
  };
})();
