// js/wordbound/monsters.js
// Monster + boss definitions. Each has traitPhases: [{hpThreshold, traitId}]
// (descending hpThreshold, same phase-selection pattern as the old game's
// bosses -- see traits.js#activeTraitForHpRatio). Regular monsters have a
// single phase; bosses have 2-3, so the puzzle changes as you wear them down.
//
// PUBLIC API (window.Wordbound.Monsters):
//   MONSTER_DEFS[id] = { id, name, maxHp, attack, traitPhases, tier, goldDrop:[min,max] }
//   BOSS_DEFS[id]     = { id, name, maxHp, attack, traitPhases, floor }
//   createMonster(defId) -> fresh instance { defId, name, hp, maxHp, attack, traitPhases }
//   createBoss(defId)    -> same shape, isBoss:true

(function () {
  window.Wordbound = window.Wordbound || {};
  var Monsters = (window.Wordbound.Monsters = {});
  var MONSTER_DEFS = {};
  var BOSS_DEFS = {};
  Monsters.MONSTER_DEFS = MONSTER_DEFS;
  Monsters.BOSS_DEFS = BOSS_DEFS;

  function mdef(d) { MONSTER_DEFS[d.id] = d; }
  function bdef(d) { BOSS_DEFS[d.id] = d; }

  mdef({ id: 'slime', name: 'The Vowel Slurper', maxHp: 8, attack: 2, tier: 'weak', goldDrop: [1, 3], traitPhases: [{ hpThreshold: 1.0, traitId: 'vowelHungry' }] });
  mdef({ id: 'gremlin', name: 'The Fidget', maxHp: 7, attack: 2, tier: 'weak', goldDrop: [1, 3], traitPhases: [{ hpThreshold: 1.0, traitId: 'shortFuse' }] });
  mdef({ id: 'wisp', name: 'Filler Word', maxHp: 6, attack: 2, tier: 'weak', goldDrop: [1, 2], traitPhases: [{ hpThreshold: 1.0, traitId: 'plain' }] });
  mdef({ id: 'serpent', name: 'The Consonant Constrictor', maxHp: 14, attack: 4, tier: 'normal', goldDrop: [3, 6], traitPhases: [{ hpThreshold: 1.0, traitId: 'vowelless' }] });
  mdef({ id: 'golempup', name: 'Echo Pup', maxHp: 16, attack: 3, tier: 'normal', goldDrop: [3, 6], traitPhases: [{ hpThreshold: 1.0, traitId: 'doubled' }] });
  mdef({ id: 'raven', name: 'Quoth', maxHp: 12, attack: 4, tier: 'normal', goldDrop: [3, 6], traitPhases: [{ hpThreshold: 1.0, traitId: 'silentE' }] });
  mdef({ id: 'sentinel', name: 'The Card Catalog', maxHp: 22, attack: 6, tier: 'strong', goldDrop: [6, 10], traitPhases: [{ hpThreshold: 1.0, traitId: 'alphabetic' }] });
  mdef({ id: 'warden', name: 'The Hoarder', maxHp: 20, attack: 6, tier: 'strong', goldDrop: [6, 10], traitPhases: [{ hpThreshold: 1.0, traitId: 'rareSeeker' }] });
  mdef({ id: 'glossary', name: 'The Glossary', maxHp: 9, attack: 2, tier: 'weak', goldDrop: [1, 3], traitPhases: [{ hpThreshold: 1.0, traitId: 'vowelHungry' }] });
  mdef({ id: 'bindingstrap', name: 'Binding Strap', maxHp: 15, attack: 4, tier: 'normal', goldDrop: [3, 6], traitPhases: [{ hpThreshold: 1.0, traitId: 'alphabetic' }] });
  mdef({ id: 'appendix', name: 'The Appendix', maxHp: 13, attack: 4, tier: 'normal', goldDrop: [3, 6], traitPhases: [{ hpThreshold: 1.0, traitId: 'silentE' }] });
  mdef({ id: 'spinesplinter', name: 'Spine Splinter', maxHp: 19, attack: 5, tier: 'strong', goldDrop: [7, 11], traitPhases: [{ hpThreshold: 1.0, traitId: 'doubled' }] });

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
    id: 'boss_vowelmaw', name: 'The Vowelmaw', maxHp: 50, attack: 4, floor: 1, goldDrop: [15, 25],
    traitPhases: [
      { hpThreshold: 1.0, traitId: 'vowelHungry' }
    ]
  });
  bdef({
    id: 'boss_unabridged', name: 'The Unabridged Terror', maxHp: 80, attack: 6, floor: 2, goldDrop: [25, 40],
    traitPhases: [
      { hpThreshold: 1.0, traitId: 'lengthy' }
    ]
  });
  bdef({
    id: 'boss_sovereign', name: 'The Unabridged, Unbound', maxHp: 120, attack: 8, floor: 3, goldDrop: [40, 60],
    traitPhases: [
      { hpThreshold: 1.0, traitId: 'silentE' }
    ]
  });

  Monsters.createMonster = function (defId) {
    var def = MONSTER_DEFS[defId];
    if (!def) throw new Error('Monsters.createMonster: unknown defId "' + defId + '"');
    return {
      defId: defId, name: def.name, hp: def.maxHp, maxHp: def.maxHp,
      attack: def.attack, traitPhases: def.traitPhases, isBoss: false, tier: def.tier
    };
  };

  Monsters.createBoss = function (defId) {
    var def = BOSS_DEFS[defId];
    if (!def) throw new Error('Monsters.createBoss: unknown defId "' + defId + '"');
    return {
      defId: defId, name: def.name, hp: def.maxHp, maxHp: def.maxHp,
      attack: def.attack, traitPhases: def.traitPhases, isBoss: true
    };
  };
})();
