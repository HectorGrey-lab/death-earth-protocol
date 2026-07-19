window.CombatSystem = (function () {
  function scout(state, nodeId) {
    const node = MapSystem.getNodeById(nodeId);
    if (!node || node.type !== "enemy") return { ok: false, reason: "Target not scoutable" };
    const radar = state.buildings.radarArray.level;
    const profile = MapSystem.generateEnemyProfile(node);
    const accuracy = 0.12 * radar;

    const intel = {
      power: Math.max(1, Math.floor(profile.power * (1 + (Math.random() * accuracy - accuracy / 2)))),
      shield: Math.max(1, Math.floor(profile.shield * (1 + (Math.random() * accuracy - accuracy / 2)))),
      bunker: Math.max(1, Math.floor(profile.bunker * (1 + (Math.random() * accuracy - accuracy / 2)))),
      buildings: profile.buildings
    };

    state.combat.lastScoutedEnemyId = nodeId;
    state.combat.scoutingIntel[nodeId] = intel;
    state.combat.scoutsCompleted += 1;
    MailboxSystem.addMessage(state, "Attack", "Scout Report", `${node.name} scouted. Estimated Power ${intel.power}, Shield ${intel.shield}, Bunker ${intel.bunker}.`);
    return { ok: true };
  }

  function estimateArmyTraits(state) {
    const traits = { scout: 0, siege: 0, shieldBreak: 0, supportShield: 0 };
    Object.keys(state.troops.counts).forEach((key) => {
      const count = state.troops.counts[key];
      const def = GameData.troops[key];
      (def.traits || []).forEach(tr => traits[tr] += count);
    });
    return traits;
  }

  function raid(state, nodeId) {
    const node = MapSystem.getNodeById(nodeId);
    if (!node || node.type !== "enemy") return { ok: false, reason: "Invalid raid target" };

    const enemy = MapSystem.generateEnemyProfile(node);
    const armyPower = TroopSystem.getTotalPower(state);
    const armyDefense = TroopSystem.getTotalDefense(state);
    const traits = estimateArmyTraits(state);

    let effectivePower = armyPower;
    effectivePower += traits.siege * 2.5;
    effectivePower += traits.shieldBreak * 3;
    effectivePower -= enemy.shield * Math.max(0.25, 1 - traits.shieldBreak * 0.015);

    const enemyEffective = enemy.power + enemy.bunker * 1.1 + enemy.shield * 0.6;
    const success = effectivePower > enemyEffective * 0.92;

    const casualtyRate = success ? 0.08 + node.threatLevel * 0.03 : 0.18 + node.threatLevel * 0.05;
    const casualties = {};

    Object.keys(state.troops.counts).forEach((key) => {
      const count = state.troops.counts[key];
      casualties[key] = Math.min(count, Math.floor(count * casualtyRate * (GameData.troops[key].defense < 10 ? 1.1 : 0.9)));
    });

    TroopSystem.removeCasualties(state, casualties);

    let loot = { ore: 0, solar: 0, crystal: 0, isotopes: 0 };
    if (success) {
      loot = {
        ore: Utils.rand(70, 130) + node.threatLevel * 40,
        solar: Utils.rand(40, 90) + node.threatLevel * 30,
        crystal: Utils.rand(20, 60) + node.threatLevel * 18,
        isotopes: Utils.rand(10, 24) + node.threatLevel * 10
      };
      Utils.grantResources(state, loot);
      state.combat.attackWins += 1;
      CommanderSystem.addRankPoints(state, 1);
    }

    const siegeDamage = Math.floor(traits.siege * 0.8 + (success ? 10 : 4));
    const retaliationChance = 0.2 + node.threatLevel * 0.08 + (success ? 0.1 : 0);
    if (Utils.chance(retaliationChance)) {
      scheduleIncomingAttack(state, node.threatLevel + (success ? 0 : 1), true);
    }

    const body = [
      `Target: ${node.name}`,
      `Result: ${success ? "Raid Success" : "Raid Failed"}`,
      `Enemy Power: ${enemyEffective.toFixed(0)}`,
      `Your Power: ${effectivePower.toFixed(0)}`,
      `Siege Impact: ${siegeDamage}`,
      `Loot: ${Utils.costToHtml(loot)}`,
      `Casualties: ${Object.keys(casualties).map(k => `${GameData.troops[k].name} ${casualties[k]}`).join(", ")}`
    ].join("\n");

    MailboxSystem.addMessage(state, "Attack", "Raid Report", body);
    state.combat.raidHistory.unshift({ id: Utils.uid("raid"), target: node.name, success, time: Date.now() });
    state.combat.raidHistory = state.combat.raidHistory.slice(0, 20);

    return { ok: true, success };
  }

  function scheduleIncomingAttack(state, threatLevel, retaliation) {
    const eta = Utils.rand(35, 90);
    state.combat.incomingAttacks.push({
      id: Utils.uid("atk"),
      threatLevel,
      remaining: eta,
      retaliation: !!retaliation
    });
    MailboxSystem.addMessage(state, "Defense", "Incoming Attack Detected", `${retaliation ? "Retaliation force" : "Hostile strike group"} detected. ETA ${Utils.formatTime(eta)}.`);
  }

  function maybeSpawnRandomAttack(state, dt) {
    const event = state.events.active ? state.events.active.effect || {} : {};
    const pressure = event.attackPressure || 0;
    const chance = 0.01 * dt + pressure * 0.012 * dt;
    const radarReduction = (state.buildings.radarArray.level - 1) * 0.0015;
    if (Utils.chance(Math.max(0.002, chance - radarReduction))) {
      scheduleIncomingAttack(state, Utils.rand(1, 4), false);
    }
  }

  function resolveIncoming(state, attack) {
    const defense = TroopSystem.getTotalDefense(state) + state.buildings.defenseBunker.level * 40 + state.buildings.shieldGenerator.level * 25;
    const shield = BuildingSystem.getShieldStats(state).current;
    const enemyPower = 80 + attack.threatLevel * 65;

    const defended = defense + shield > enemyPower * 1.05;
    const casualties = {};

    Object.keys(state.troops.counts).forEach((key) => {
      const count = state.troops.counts[key];
      const rate = defended ? 0.05 + attack.threatLevel * 0.02 : 0.12 + attack.threatLevel * 0.05;
      casualties[key] = Math.min(count, Math.floor(count * rate * (GameData.troops[key].defense > 12 ? 0.75 : 1)));
    });
    TroopSystem.removeCasualties(state, casualties);

    const damageKeys = Object.keys(state.buildings);
    let damaged = [];
    if (!defended) {
      const hits = Utils.rand(1, 3);
      for (let i = 0; i < hits; i++) {
        const k = Utils.pick(damageKeys);
        state.buildings[k].integrity = Math.max(40, state.buildings[k].integrity - Utils.rand(8, 20));
        damaged.push(GameData.buildings[k].name);
      }
    }

    if (defended) state.combat.defenseWins += 1;

    const body = [
      `Enemy Strength: ${enemyPower}`,
      `Defense Result: ${defended ? "Attack Repelled" : "Defense Breached"}`,
      `Casualties: ${Object.keys(casualties).map(k => `${GameData.troops[k].name} ${casualties[k]}`).join(", ")}`,
      `Building Damage: ${damaged.length ? damaged.join(", ") : "None"}`
    ].join("\n");

    MailboxSystem.addMessage(state, "Defense", "Defense Report", body);
  }

  function tick(state, dt) {
    maybeSpawnRandomAttack(state, dt);
    state.combat.incomingAttacks.forEach(a => a.remaining -= dt);
    const due = state.combat.incomingAttacks.filter(a => a.remaining <= 0);
    due.forEach(a => resolveIncoming(state, a));
    state.combat.incomingAttacks = state.combat.incomingAttacks.filter(a => a.remaining > 0);
  }

  return {
    scout,
    raid,
    tick
  };
})();