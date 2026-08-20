// js/wordbound/monsters.js
// Monster + boss definitions. Each has traitPhases: [{hpThreshold, traitId}]
// (descending hpThreshold, same phase-selection pattern as the old game's
// bosses -- see traits.js#activeTraitForHpRatio). Regular monsters have a
// single phase; bosses have 2, so the puzzle changes as you wear them down
// (GOALS.md "FUN OVERHAUL 3/8", 2026-08-20 -- both phases are always simple
// bonus-on-match traits, 1x baseline, never the four 0.3x-floor resistance
// traits (vowelless/palindromic/shortFuse/alphabetic), which were removed
// from bosses deliberately in the 2026-08-19/20 balance pass).
//
// PUBLIC API (window.Wordbound.Monsters):
//   MONSTER_DEFS[id] = { id, name, maxHp, attack, traitPhases, tier, goldDrop:[min,max], intents? }
//   BOSS_DEFS[id]     = { id, name, maxHp, attack, traitPhases, floor, intents? }
//   createMonster(defId) -> fresh instance { defId, name, hp, maxHp, attack, traitPhases, intents, mendUsed, enrageStacks, devourUsed }
//   createBoss(defId)    -> same shape, isBoss:true
//   `intents` (GOALS.md "FUN OVERHAUL 2/8", js/wordbound/intents.js): a list
//   of signature-move ids (from Intents' shared pool: hex/devour/mend/
//   enrage) a def can roll ON TOP of Attack/Heavy Blow -- but only while the
//   instance is fighting as an elite or boss (Intents.rollIntent gates on
//   monster.isElite/isBoss, set by game.js's startCombat from the node
//   type). Regular (non-elite) fights against the same def never see them.

(function () {
  window.Wordbound = window.Wordbound || {};
  var Monsters = (window.Wordbound.Monsters = {});
  var MONSTER_DEFS = {};
  var BOSS_DEFS = {};
  Monsters.MONSTER_DEFS = MONSTER_DEFS;
  Monsters.BOSS_DEFS = BOSS_DEFS;

  function mdef(d) { MONSTER_DEFS[d.id] = d; }
  function bdef(d) { BOSS_DEFS[d.id] = d; }

  // HP bands raised 2026-08-20 (review N1/N2/N3 balance pass -- see
  // PROGRESS.md) well ABOVE this ticket's own suggested starting hypothesis
  // (weak 15-20/normal 28-38/strong 45-60), because that hypothesis turned
  // out to badly undershoot once measured against actual play: a diagnostic
  // sampling 60 real turn-1 racks (test run only, not committed) found a
  // "best"-strategy competent player's single-word damage against a
  // non-resistant monster averages ~30-36 (median 24-32, p90 42-60, max 74)
  // BEFORE any HP change -- because "best" play actively searches for and
  // favors weakness-multiplier words, not just raw score. The suggested
  // bands would still one-shot most fights. New bands: weak ~17-22 (kept
  // closer to 1-2 words per this ticket's own welcoming-early-game
  // allowance), normal ~52-60 (needs >1 hit against the measured ~30-36 avg
  // single-hit output), strong ~82-88 (needs 2-3 hits even against strong
  // rolls). Attack values, tiers, gold drops and traits are untouched --
  // this is an HP-only pass, per the ticket's own scope note (tuning, not a
  // mechanics rework).
  mdef({ id: 'slime', name: 'The Vowel Slurper', maxHp: 20, attack: 2, tier: 'weak', goldDrop: [1, 3], traitPhases: [{ hpThreshold: 1.0, traitId: 'vowelHungry' }] });
  mdef({ id: 'gremlin', name: 'The Fidget', maxHp: 18, attack: 2, tier: 'weak', goldDrop: [1, 3], traitPhases: [{ hpThreshold: 1.0, traitId: 'doubled' }] });
  mdef({ id: 'wisp', name: 'Filler Word', maxHp: 17, attack: 2, tier: 'weak', goldDrop: [1, 2], traitPhases: [{ hpThreshold: 1.0, traitId: 'plain' }] });
  mdef({ id: 'serpent', name: 'The Consonant Constrictor', maxHp: 56, attack: 4, tier: 'normal', goldDrop: [3, 6], traitPhases: [{ hpThreshold: 1.0, traitId: 'lengthy' }] });
  mdef({ id: 'golempup', name: 'Echo Pup', maxHp: 58, attack: 3, tier: 'normal', goldDrop: [3, 6], traitPhases: [{ hpThreshold: 1.0, traitId: 'doubled' }] });
  mdef({ id: 'raven', name: 'Quoth', maxHp: 52, attack: 4, tier: 'normal', goldDrop: [3, 6], traitPhases: [{ hpThreshold: 1.0, traitId: 'silentE' }] });
  // `intents` (GOALS.md "FUN OVERHAUL 2/8"): signature moves this monster
  // can roll on TOP of Attack/Heavy Blow, but ONLY when it's fighting as an
  // elite (node.type === 'elite') -- these are the same defs the floor also
  // uses for plain 'strong'-tier regular fights (floor.js pickCombatDefId),
  // where the extra signature pool stays dormant (Intents.buildPool only
  // consults `intents` when monster.isElite/isBoss). Flavor pairing is this
  // ticket's own judgment call, noted in PROGRESS.md: sentinel (a collector)
  // hoards a tile and gets tougher; warden (the Hoarder, thematically) eats
  // tiles and heals; spinesplinter binds and devours.
  // maxHp 88 -> 70 (2026-08-20 orchestrator gate-#2 outlier pass): the
  // gate-#2 balance-simulation data (PROGRESS.md) found this def alone
  // responsible for 3/14 regular deaths at the OLD number -- an outlier
  // among strong-tier peers, not a global strong-tier problem (see
  // PROGRESS.md for the full per-monster breakdown). Its intent pool
  // (hex/enrage, weight 1 each vs. attack's 3) was checked against sibling
  // strong defs warden/spinesplinter and found equally weighted, not
  // disproportionately signature-heavy, so no pool-weight shift applied --
  // HP-only per the orchestrator's own conditional.
  mdef({ id: 'sentinel', name: 'The Card Catalog', maxHp: 70, attack: 6, tier: 'strong', goldDrop: [6, 10], traitPhases: [{ hpThreshold: 1.0, traitId: 'rareSeeker' }], intents: ['hex', 'enrage'] });
  mdef({ id: 'warden', name: 'The Hoarder', maxHp: 82, attack: 6, tier: 'strong', goldDrop: [6, 10], traitPhases: [{ hpThreshold: 1.0, traitId: 'rareSeeker' }], intents: ['devour', 'mend'] });
  mdef({ id: 'glossary', name: 'The Glossary', maxHp: 21, attack: 2, tier: 'weak', goldDrop: [1, 3], traitPhases: [{ hpThreshold: 1.0, traitId: 'vowelHungry' }] });
  mdef({ id: 'bindingstrap', name: 'Binding Strap', maxHp: 57, attack: 4, tier: 'normal', goldDrop: [3, 6], traitPhases: [{ hpThreshold: 1.0, traitId: 'doubled' }] });
  mdef({ id: 'appendix', name: 'The Appendix', maxHp: 54, attack: 4, tier: 'normal', goldDrop: [3, 6], traitPhases: [{ hpThreshold: 1.0, traitId: 'silentE' }] });
  // maxHp 85 -> 68 (2026-08-20 orchestrator gate-#2 outlier pass): this def
  // alone accounted for 3/14 regular deaths PLUS all 3/3 regular-tier
  // stalls at the OLD number -- the single worst outlier in the gate-#2
  // data (PROGRESS.md). Same intent-pool check as Card Catalog above
  // (hex/devour, weight 1 each vs. attack's 3, matches sibling strong
  // defs) -- not disproportionately signature-heavy, HP-only fix.
  mdef({ id: 'spinesplinter', name: 'Spine Splinter', maxHp: 68, attack: 5, tier: 'strong', goldDrop: [7, 11], traitPhases: [{ hpThreshold: 1.0, traitId: 'doubled' }], intents: ['hex', 'devour'] });

  // Boss attack values tuned down from their original 6/8/10 on 2026-08-19 after
  // playtesting showed the player's fixed 20 max HP only survives 3-4 hits, which
  // is often not enough turns to whittle down a 50-120 HP boss while also adapting
  // to its trait-phase switches -- reported as "the boss fight doesn't work." HP
  // pools and trait puzzles are untouched; this only buys a bit more breathing room.
  bdef({
    // Attack 5 -> 4 on 2026-08-19 (test/balance-simulation.js, 30 runs): the
    // floor-1 boss ended 40% of skilled runs -- more than every other floor-1
    // monster combined (all zero) -- while the floor-2 boss ended none. Its
    // second phase (palindromic) deals 0x on any non-palindrome, and palindromes
    // are near-unformable from a 7-8 tile rack, so below half HP the fight is a
    // pure race against its attack. 20 player HP / 5 = 4 turns; /4 = 5 turns.
    // This widens that window without touching the trait; see PROGRESS.md --
    // the 0x-floor phase is the real cause and needs a design call, not a stat.
    // maxHp 50 -> 38 (2026-08-20 orchestrator decision, ~25% cut): monster
    // intents (Mend/Enrage/Devour/Heavy Blow) and 2-phase traits landed
    // after this HP number was picked, and simulation showed every extra
    // monster turn they bought was compounding the fight further -- the
    // fix is non-compounding signature costs (see intents.js) PLUS
    // shortening the sponge itself. See PROGRESS.md for before/after
    // balance-simulation numbers.
    id: 'boss_vowelmaw', name: 'The Vowelmaw', maxHp: 38, attack: 4, floor: 1, goldDrop: [15, 25],
    // Floor-1 boss, kept to a single defensive signature (Mend) rather than
    // an offensive one -- this ticket's own judgment call, per this file's
    // history of the floor-1 boss already being the hardest fight in the
    // game pre-retune (see the attack-tuning comment above); Hex/Devour/
    // Enrage stack extra pressure on top of a fight that's already tight.
    intents: ['mend'],
    // Two-phase trait arc (FUN OVERHAUL 3/8, 2026-08-20): vowel-hungry above
    // half HP, then switches to doubled-letter-hungry below it -- flavor
    // pick is this ticket's own call (a "vowelmaw" first gorging on vowels,
    // then latching onto anything it can repeat-bite as it weakens). Both
    // simple 1x-baseline traits, no resistance floor.
    traitPhases: [
      { hpThreshold: 1.0, traitId: 'vowelHungry' },
      { hpThreshold: 0.5, traitId: 'doubled' }
    ]
  });
  bdef({
    // maxHp 80 -> 60 -> 35 (2026-08-20 orchestrator decision: first cut was
    // ~25% uniform; a fresh n=30 sim gate after that cut plus the
    // Mend/Enrage/Devour knobs still measured this boss at 11.4 words/fight
    // (throughput ~5.3 HP/word) and the "best" strategy win rate at 17%,
    // both outside the decision's gate -- the decision explicitly sanctions
    // further boss-HP-only iterations before stopping. This second cut
    // targets ~6-7 words/fight at the same throughput. See PROGRESS.md for
    // the before/after sim numbers.
    id: 'boss_unabridged', name: 'The Unabridged Terror', maxHp: 35, attack: 6, floor: 2, goldDrop: [25, 40],
    intents: ['hex', 'devour'],
    // lengthy -> rareSeeker: starts savoring long words, then (as suggested
    // directly by the ticket) gets pickier and starts collecting rare
    // letters once wounded, mirroring warden/sentinel's rareSeeker theme
    // for the floor's other strong-tier defs.
    traitPhases: [
      { hpThreshold: 1.0, traitId: 'lengthy' },
      { hpThreshold: 0.5, traitId: 'rareSeeker' }
    ]
  });
  bdef({
    // maxHp 120 -> 90 -> 45 (2026-08-20 orchestrator decision: first cut was
    // ~25% uniform; a fresh n=30 sim gate after that cut plus the
    // Mend/Enrage/Devour knobs still measured this boss at 15.3 words/fight
    // (0/6 kills) against the gate's <8 words/fight target -- the decision
    // explicitly sanctions further boss-HP-only iterations before stopping.
    // This second cut targets ~7-8 words/fight at the same ~5.9 HP/word
    // throughput this boss measured at. See PROGRESS.md for the
    // before/after sim numbers.
    id: 'boss_sovereign', name: 'The Unabridged, Unbound', maxHp: 45, attack: 8, floor: 3, goldDrop: [40, 60],
    // Final boss: the only def with Enrage, so a run that drags this fight
    // out gets meaningfully harder over time -- the escalating-stakes finale
    // this ticket's design note asks for.
    intents: ['enrage', 'hex'],
    // silentE -> lengthy (ticket's own suggested pairing): opens on its
    // named weakness, then broadens to rewarding long words in general once
    // wounded, mirroring its floor-2 predecessor's escalating "harder to
    // pin down" arc.
    traitPhases: [
      { hpThreshold: 1.0, traitId: 'silentE' },
      { hpThreshold: 0.5, traitId: 'lengthy' }
    ]
  });

  Monsters.createMonster = function (defId) {
    var def = MONSTER_DEFS[defId];
    if (!def) throw new Error('Monsters.createMonster: unknown defId "' + defId + '"');
    return {
      defId: defId, name: def.name, hp: def.maxHp, maxHp: def.maxHp,
      attack: def.attack, traitPhases: def.traitPhases, isBoss: false, tier: def.tier,
      intents: def.intents || [], mendUsed: false, enrageStacks: 0
    };
  };

  Monsters.createBoss = function (defId) {
    var def = BOSS_DEFS[defId];
    if (!def) throw new Error('Monsters.createBoss: unknown defId "' + defId + '"');
    return {
      defId: defId, name: def.name, hp: def.maxHp, maxHp: def.maxHp,
      attack: def.attack, traitPhases: def.traitPhases, isBoss: true,
      intents: def.intents || [], mendUsed: false, enrageStacks: 0
    };
  };
})();
