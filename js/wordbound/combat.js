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
//        { word, tilesUsed, score, holdMult, activeTraitId, multiplier,
//          damage, monsterDied }
//        tilesUsed is the array of tiles.js Tile objects spent. holdMult is
//        the combined MULT_ON_HOLD multiplier from tiles left in the rack.
//        multiplier is just the trait (weakness/resistance) multiplier.
//        damage = round(score.total * holdMult * multiplier).
//     On success, mutates player.rack (removes used tiles) and monster.hp.
//     Does NOT refill/discard the rack or advance the turn -- caller's job.
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
    var Tiles = window.Wordbound.Tiles;
    var Items = window.Wordbound.Items;

    if (!Lexicon.isValidWord(word)) return null;
    var formed = Lexicon.canFormFromRack(word, player.rack);
    if (!formed.possible) return null;

    // Capacity read BEFORE removeTiles below mutates the rack -- the bingo
    // bonus is "used your whole rack in one word," gated to the player's
    // actual capacity (e.g. 8 with Spare Satchel), not a hardcoded 7.
    var rackCapacity = Items ? Items.getRackCapacity(player) : 7;
    var score = Lexicon.scoreWord(word.toUpperCase(), formed.tilesUsed, rackCapacity);

    Lexicon.removeTiles(player.rack, formed.tilesUsed);

    // MULT_ON_HOLD bonuses come from tiles left in the rack after the played
    // ones are removed -- Lexicon.scoreWord never sees those, only combat.js
    // has the full rack.
    var holdMult = 1;
    player.rack.forEach(function (tile) {
      if (tile.bonus && tile.bonus.type === Tiles.BONUS_TYPES.MULT_ON_HOLD) holdMult *= tile.bonus.amount;
    });

    var hpRatio = monster.maxHp > 0 ? monster.hp / monster.maxHp : 0;
    var activeTraitId = Traits.activeTraitForHpRatio(monster.traitPhases, hpRatio);
    var trait = Traits.TRAITS[activeTraitId];
    var traitMultiplier = trait ? trait.multiplier(word.toUpperCase(), formed.tilesUsed) : 1;
    var damage = Math.round(score.total * holdMult * traitMultiplier);

    monster.hp = Math.max(0, monster.hp - damage);

    return {
      word: word.toUpperCase(),
      tilesUsed: formed.tilesUsed,
      score: score,
      holdMult: holdMult,
      activeTraitId: activeTraitId,
      multiplier: traitMultiplier,
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
