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

  bdef({
    id: 'boss_vowelmaw', name: 'The Vowelmaw', maxHp: 50, attack: 6, floor: 1,
    traitPhases: [
      { hpThreshold: 1.0, traitId: 'vowelHungry' },
      { hpThreshold: 0.5, traitId: 'palindromic' }
    ]
  });
  bdef({
    id: 'boss_unabridged', name: 'The Unabridged Terror', maxHp: 80, attack: 8, floor: 2,
    traitPhases: [
      { hpThreshold: 1.0, traitId: 'lengthy' },
      { hpThreshold: 0.5, traitId: 'rareSeeker' }
    ]
  });
  bdef({
    id: 'boss_sovereign', name: 'The Unabridged, Unbound', maxHp: 120, attack: 10, floor: 3,
    traitPhases: [
      { hpThreshold: 1.0, traitId: 'silentE' },
      { hpThreshold: 0.6, traitId: 'shortFuse' },
      { hpThreshold: 0.3, traitId: 'palindromic' }
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
