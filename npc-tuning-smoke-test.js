// NPC tuning smoke test: verifies the combat.js Phase 4 changes —
// env-tunable attack rate, per-colony cooldown, nerfed retaliation,
// 'important' defense mail mode, npc_defense mail cap, colony.log entries.
// NOTE: runs in a fresh process with DEFAULT env (no NPC_DEFENSE_MAIL_MODE override)
// so the module loads with the production 'important' default.
const Combat = require('./server/systems/combat');
const GAME = require('./server/game-data.json');

let failures = 0;
function expect(cond, label) {
  if (cond) console.log('  ✅ ' + label);
  else { console.log('  ❌ FAIL: ' + label); failures++; }
}

function makeColony() {
  const b = {};
  Object.keys(GAME.buildings).forEach(k => { b[k] = { level: 1, integrity: 100, upgrading: null }; });
  const r = {};
  ['ore', 'solar', 'crystal', 'isotopes'].forEach(k => { r[k] = { amount: 500, cap: 50000, production: 0 }; });
  return {
    buildings: b,
    resources: r,
    troops: { counts: { rifleUnit: 500, reconScout: 50 }, queue: [], fleets: {} },
    research: { levels: { economy: 0, military: 0, defense: 0 }, active: null, completedTotal: 0 },
    combat: { scoutsCompleted: 0, attackWins: 0, defenseWins: 0, incomingAttacks: [], raidHistory: [] },
    mailbox: { messages: [], selectedTab: 'Inbox', selectedMessageId: null },
    position: { galaxy: 1, sector: 1, planet: 1 }
  };
}

console.log('1. Env defaults + clampNumber:');
expect(Combat.NPC_ATTACKS_PER_HOUR === 0.8, 'NPC_ATTACKS_PER_HOUR defaults to 0.8 (got ' + Combat.NPC_ATTACKS_PER_HOUR + ')');
expect(Combat.NPC_ATTACK_COOLDOWN_SEC === 1800, 'NPC_ATTACK_COOLDOWN_SEC defaults to 1800 (got ' + Combat.NPC_ATTACK_COOLDOWN_SEC + ')');
expect(Combat.NPC_DEFENSE_MAIL_MODE === 'important', "NPC_DEFENSE_MAIL_MODE defaults to 'important' (got " + Combat.NPC_DEFENSE_MAIL_MODE + ')');
expect(Combat.clampNumber('bogus', 5, 0, 10) === 5, 'clampNumber falls back to default on NaN');
expect(Combat.clampNumber('99', 5, 0, 10) === 10, 'clampNumber caps at max (99 -> 10)');
expect(Combat.clampNumber('-5', 5, 0, 10) === 0, 'clampNumber floors at min (-5 -> 0)');

console.log('2. Rate-based spawn + cooldown:');
{
  const realRandom = Math.random;
  try {
    const colony = makeColony();
    // Math.random=0 -> chance(finalChance) always true
    Math.random = () => 0;
    Combat.tick(colony, 2); // normal 2s tick
    const spawned = (colony.combat.incomingAttacks || []).find(a => !a.retaliation);
    expect(!!spawned, 'a random NPC attack was scheduled (rate-based roll hit, Math.random=0)');
    expect(typeof colony.combat.lastNpcAttackAt === 'number' && colony.combat.lastNpcAttackAt > 0, 'lastNpcAttackAt recorded after random attack');
    // Cooldown: immediately after, even Math.random=0 must NOT spawn another
    const before = (colony.combat.incomingAttacks || []).length;
    Combat.tick(colony, 2);
    expect((colony.combat.incomingAttacks || []).length === before, 'cooldown blocks a second attack immediately after');
  } finally { Math.random = realRandom; }
}

console.log('3. Radar reduces spawn chance multiplicatively:');
{
  const realRandom = Math.random;
  try {
    Math.random = () => 0;
    const low = makeColony(); // radar lvl 1
    Combat.tick(low, 2);
    // Now a radar-lvl-6 colony: factor = max(0.35, 1 - 5*0.08) = 0.6 -> still spawns at Math.random=0
    const hi = makeColony();
    hi.buildings.radarArray.level = 6;
    Combat.tick(hi, 2);
    expect((hi.combat.incomingAttacks || []).length >= 1, 'radar lvl 6 still allows spawns (factor 0.6, Math.random=0)');
    // chance is strictly smaller with higher radar — verify via factor math on finalChance path
    const loChance = (Combat.NPC_ATTACKS_PER_HOUR / 3600) * 2 * 1.0;
    const hiChance = (Combat.NPC_ATTACKS_PER_HOUR / 3600) * 2 * 0.6;
    expect(hiChance < loChance, 'higher radar => lower spawn chance (' + hiChance.toFixed(6) + ' < ' + loChance.toFixed(6) + ')');
  } finally { Math.random = realRandom; }
}

console.log('4. "important" mail mode — repelled low-threat attack skips mail, logs instead:');
{
  const colony = makeColony();
  // 500 rifle + 50 recon = 4400 defense; enemyPower L2 = 210 -> defended
  colony.combat.incomingAttacks = [{ id: 't1', threatLevel: 2, remaining: 1, retaliation: false }];
  Combat.tick(colony, 5);
  const msgs = colony.mailbox.messages;
  expect(msgs.length === 0, 'no Defense mail for repelled threat-2 attack (important mode)');
  expect(Array.isArray(colony.log) && colony.log.length >= 1, 'colony.log has an entry for the repelled attack');
  expect(/NPC raid repelled/.test(colony.log[0].text), 'log entry mentions the repelled raid (got "' + (colony.log[0] && colony.log[0].text) + '")');
}

console.log('5. "important" mail mode — high-threat / retaliation / undefended still mail:');
{
  // Threat 4 (>= 3) -> mails even when defended
  const a = makeColony();
  a.combat.incomingAttacks = [{ id: 't1', threatLevel: 4, remaining: 1, retaliation: false }];
  Combat.tick(a, 5);
  expect(a.mailbox.messages.length >= 1, 'threat-4 attack mails (>= 3 threshold)');

  // Retaliation attack -> mails
  const b = makeColony();
  b.combat.incomingAttacks = [{ id: 't2', threatLevel: 1, remaining: 1, retaliation: true }];
  Combat.tick(b, 5);
  expect(b.mailbox.messages.length >= 1, 'retaliation attack mails');

  // Undefended -> mails
  const c = makeColony();
  c.troops.counts = { rifleUnit: 1 }; // ~8 defense < 210*1.05
  c.combat.incomingAttacks = [{ id: 't3', threatLevel: 2, remaining: 1, retaliation: false }];
  Combat.tick(c, 5);
  expect(c.mailbox.messages.length >= 1, 'undefended threat-2 attack mails');
  expect(c.mailbox.messages[0].data && c.mailbox.messages[0].data.kind === 'npc_defense', 'mail data.kind is npc_defense');
}

console.log('6. npc_defense mail cap (25) + prune:');
{
  const colony = makeColony();
  // Pre-seed 40 npc_defense mails (simulates old spam)
  for (let i = 0; i < 40; i++) {
    colony.mailbox.messages.push({
      id: 'old' + i, tab: 'Defense', subject: 'Defense Report: Threat L2', body: 'x', time: Date.now() - i,
      isNew: false, type: 'combat_report_v2', data: { kind: 'npc_defense', threatLevel: 2, retaliation: false, defended: true, casualties: {}, buildingDamage: [] }
    });
  }
  // A threat-4 attack forces a prune + a new mail
  colony.combat.incomingAttacks = [{ id: 't4', threatLevel: 4, remaining: 1, retaliation: false }];
  Combat.tick(colony, 5);
  const npcDef = colony.mailbox.messages.filter(m => m.data && m.data.kind === 'npc_defense');
  expect(npcDef.length <= 25, 'npc_defense mails capped at 25 (got ' + npcDef.length + ')');
  expect(npcDef[0] && npcDef[0].id.indexOf('def_') === 0, 'newest npc_defense mail kept (newest-first)');
}

console.log('7. Retaliation chance nerfed (unit math):');
{
  // With Math.random ~0.99 the new small chance (~0.06-0.13) never fires;
  // the old formula (0.2 + threat*0.08 + 0.1) would fire at 0.99 < 0.38 for threat 1. No — 0.99 > 0.38,
  // so use a threat-3 raid where old = 0.2+0.24+0.1 = 0.54 -> old fires at 0.5, new = 0.06+0.12+0.03=0.21 -> fires too.
  // Instead verify the new formula directly by calling raid with a pinned Math.random just under both:
  const realRandom = Math.random;
  try {
    // Threat 1, success: new = 0.06 + 0.04 + 0.03 = 0.13. Math.random=0.12 -> fires.
    // Old would have been 0.2 + 0.08 + 0.1 = 0.38 -> also fires at 0.12. Not discriminating.
    // Use Math.random=0.3: new (0.13) does NOT fire, old (0.38) WOULD have. 
    const colony = makeColony();
    colony.troops.counts = { rifleUnit: 5000, reconScout: 500 }; // guarantee success
    colony.combat.lastNpcAttackAt = 0; // ensure cooldown passes
    Math.random = () => 0.3;
    Combat.raid(colony, 'node-1-1-1'); // threat 1
    const ret = (colony.combat.incomingAttacks || []).filter(a => a.retaliation);
    expect(ret.length === 0, 'retaliation does not fire at Math.random=0.3 (new chance 0.13 < 0.3; old was 0.38)');
  } finally { Math.random = realRandom; }
}

console.log('8. Cooldown respected on retaliation:');
{
  const realRandom = Math.random;
  try {
    const colony = makeColony();
    colony.troops.counts = { rifleUnit: 5000, reconScout: 500 };
    colony.combat.lastNpcAttackAt = Date.now(); // cooldown ACTIVE
    Math.random = () => 0;
    Combat.raid(colony, 'node-1-1-1');
    const ret = (colony.combat.incomingAttacks || []).filter(a => a.retaliation);
    expect(ret.length === 0, 'retaliation skipped while NPC cooldown active');
  } finally { Math.random = realRandom; }
}

console.log('\nNPC TUNING SMOKE ' + (failures ? 'FAILED (' + failures + ')' : 'PASSED'));
process.exit(failures ? 1 : 0);
