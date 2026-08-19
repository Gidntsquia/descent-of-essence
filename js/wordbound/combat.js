// js/wordbound/combat.js
// Ties lexicon.js (scoring) + traits.js (weakness/resistance) + a monster
// instance together into one resolved attack. This is the Wordbound
// equivalent of the old game's Combat.resolveAttack, but the "attack" is
// always a played word, never a stat.
//
// PUBLIC API (window.Wordbound.Combat):
//   playWord(player, monster, word, rng)
//     -> null if the word isn't formable/valid (caller should reject before
//        spending a turn), otherwise:
//        { word, tilesUsed, score, activeTraitId, multiplier, damage,
//          monsterDied }
//     On success, mutates player.rack (removes used tiles) and monster.hp.
//     Does NOT refill the rack or advance the turn -- caller's job.
//
//   monsterAttack(player, monster)
//     -> { damage } and mutates player.hp (clamped at 0). Flat damage for
//        now (no player defense stat in this redesign -- deliberately
//        simpler than the old game).

(function () {
  window.Wordbound = window.Wordbound || {};
  var Combat = (window.Wordbound.Combat = {});

  Combat.playWord = function (player, monster, word) {
    var Lexicon = window.Wordbound.Lexicon;
    var Traits = window.Wordbound.Traits;

    if (!Lexicon.isValidWord(word)) return null;
    var formed = Lexicon.canFormFromRack(word, player.rack);
    if (!formed.possible) return null;

    var score = Lexicon.scoreWord(word.toUpperCase(), formed.tilesUsed);
    var hpRatio = monster.maxHp > 0 ? monster.hp / monster.maxHp : 0;
    var activeTraitId = Traits.activeTraitForHpRatio(monster.traitPhases, hpRatio);
    var trait = Traits.TRAITS[activeTraitId];
    var multiplier = trait ? trait.multiplier(word.toUpperCase(), formed.tilesUsed) : 1;
    var damage = Math.round(score.total * multiplier);

    Lexicon.removeTiles(player.rack, formed.tilesUsed);
    monster.hp = Math.max(0, monster.hp - damage);

    return {
      word: word.toUpperCase(),
      tilesUsed: formed.tilesUsed,
      score: score,
      activeTraitId: activeTraitId,
      multiplier: multiplier,
      damage: damage,
      monsterDied: monster.hp <= 0
    };
  };

  Combat.monsterAttack = function (player, monster) {
    var damage = monster.attack || 0;
    player.hp = Math.max(0, player.hp - damage);
    return { damage: damage };
  };
})();
