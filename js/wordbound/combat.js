// js/wordbound/combat.js
// Ties lexicon.js (scoring) + traits.js (weakness/resistance) + a monster
// instance together into one resolved attack. This is the Wordbound
// equivalent of the old game's Combat.resolveAttack, but the "attack" is
// always a played word, never a stat.
//
// PUBLIC API (window.Wordbound.Combat):
//   playWord(player, monster, word, comboState)
//     -> null if the word isn't formable/valid (caller should reject before
//        spending a turn), otherwise:
//        { word, tilesUsed, score, holdMult, activeTraitId, multiplier,
//          comboMultiplier, comboAtPlay, isRepeat, damage, monsterDied }
//        tilesUsed is the array of tiles.js Tile objects spent. holdMult is
//        the combined MULT_ON_HOLD multiplier from tiles left in the rack.
//        multiplier is just the trait (weakness/resistance) multiplier.
//        damage = round(score.total * holdMult * multiplier * comboMultiplier),
//        then halved-ish (x0.4, rounded) if isRepeat.
//     comboState (optional, GOALS.md "FUN OVERHAUL 1/8"): { combo, usedWords }
//     tracked per-fight by the caller (reset at combat start). combo is the
//     number of consecutive DISTINCT words played so far this fight (capped
//     at 5 for the multiplier, +12%/stack); usedWords is a Set of words
//     (uppercased) already played this fight. Passing this in is optional --
//     omit it (or pass nothing) to get plain trait-multiplier damage with no
//     combo/repeat adjustment, e.g. for callers that don't track a fight
//     (tests, tools). When provided, playWord mutates it: a repeat resets
//     combo to 0, a distinct word increments it by 1 and adds the word to
//     usedWords -- both for the NEXT call, not this one (this call's bonus
//     uses the combo value as it was BEFORE this word).
//     On success, mutates player.rack (removes used tiles) and monster.hp.
//     Does NOT refill/discard the rack or advance the turn -- caller's job.
//
//   monsterAttack(player, monster)
//     -> { damage } and mutates player.ink (clamped at 0). Flat damage for
//        now (no player defense stat in this redesign -- deliberately
//        simpler than the old game).
//
// INK SPEND (GOALS.md "FEATURE, STRUCTURAL... replace player HP with INK",
// run 2/2-4): Overcharge is the "big plays can spend it" mana half of the
// ink resource. Pass { overcharge: true } as playWord/previewWord's 5th
// arg to spend Combat.OVERCHARGE_INK_COST ink (the CALLER's job -- this
// file only knows how to multiply damage, not deduct a resource) for
// Combat.OVERCHARGE_DAMAGE_MULTIPLIER extra damage on the word about to be
// played. Baseline word play is entirely unaffected when the flag is
// omitted/false, matching the ticket's "baseline word play stays FREE"
// requirement.

(function () {
  window.Wordbound = window.Wordbound || {};
  var Combat = (window.Wordbound.Combat = {});

  var COMBO_BONUS_PER_STACK = 0.12;
  var COMBO_MAX_STACKS = 5;
  var REPEAT_WORD_PENALTY = 0.4;

  // Balance knobs (also read directly by game.js for the spend/UI side and
  // by test/balance-simulation.js's bot policy -- single source of truth so
  // nothing duplicates these numbers).
  Combat.OVERCHARGE_INK_COST = 3;
  Combat.OVERCHARGE_DAMAGE_MULTIPLIER = 1.5;
  // Rewrite (the other ink spend, GOALS.md's "consumable-style activated
  // ability" candidate): discard the whole rack and redraw fresh, for ink,
  // without ending the turn. The redraw/discard mechanics live in game.js
  // (they touch the draw pile and rack, not combat resolution) -- this is
  // just the shared cost constant.
  Combat.REWRITE_INK_COST = 4;

  Combat.playWord = function (player, monster, word, comboState, options) {
    options = options || {};
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
    var upperWord = word.toUpperCase();
    var score = Lexicon.scoreWord(upperWord, formed.tilesUsed, rackCapacity);

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
    var traitMultiplier = trait ? trait.multiplier(upperWord, formed.tilesUsed) : 1;

    // Word novelty + combo streaks (GOALS.md "FUN OVERHAUL 1/8"): comboAtPlay
    // is the streak as it stood BEFORE this word (0 on a fresh fight or right
    // after a repeat), so a word never gets credit for the streak it itself
    // is building. isRepeat is checked against words already played THIS
    // fight, before this word is added to that set below.
    var comboAtPlay = comboState ? Math.min(comboState.combo || 0, COMBO_MAX_STACKS) : 0;
    var comboMultiplier = 1 + COMBO_BONUS_PER_STACK * comboAtPlay;
    var isRepeat = !!(comboState && comboState.usedWords && comboState.usedWords.has(upperWord));

    var boostedDamage = Math.round(score.total * holdMult * traitMultiplier * comboMultiplier);
    var damage = isRepeat ? Math.round(boostedDamage * REPEAT_WORD_PENALTY) : boostedDamage;

    var overcharged = !!options.overcharge;
    if (overcharged) damage = Math.round(damage * Combat.OVERCHARGE_DAMAGE_MULTIPLIER);

    monster.hp = Math.max(0, monster.hp - damage);

    if (comboState) {
      if (isRepeat) {
        comboState.combo = 0;
      } else {
        if (!comboState.usedWords) comboState.usedWords = new Set();
        comboState.usedWords.add(upperWord);
        comboState.combo = (comboState.combo || 0) + 1;
      }
    }

    return {
      word: upperWord,
      tilesUsed: formed.tilesUsed,
      score: score,
      holdMult: holdMult,
      activeTraitId: activeTraitId,
      multiplier: traitMultiplier,
      comboAtPlay: comboAtPlay,
      comboMultiplier: comboMultiplier,
      isRepeat: isRepeat,
      overcharged: overcharged,
      damage: damage,
      monsterDied: monster.hp <= 0
    };
  };

  // GOALS.md FEATURE (staged-word damage preview): compute the damage a word
  // WOULD deal if played right now, WITHOUT mutating any game state. Runs the
  // real playWord + item onWordPlayed hooks against shallow clones of the
  // player/monster/comboState, so the previewed number can never drift from
  // what submit actually deals -- no scoring/combo/item formula is duplicated
  // here. Returns { valid:false } for an unformable/invalid word (caller shows
  // a neutral state), else { valid:true, damage, isRepeat, multiplier,
  // comboAtPlay }.
  //   options: { previousWord, wordsPlayedThisFight, hexedTileId }
  //     previousWord/wordsPlayedThisFight are the per-fight sequence state the
  //     rule-changer item hooks read (previousWord for Illuminated Initial/
  //     Palimpsest, a 1-based play count for Errant Footnote/Gilded Bookmark).
  //     Pass wordsPlayedThisFight as the count BEFORE this word (what state
  //     holds now); previewWord adds 1 to match Game.submitWord, which
  //     increments before building the hook ctx. hexedTileId hides a locked
  //     tile from rack-matching exactly as submitWord does, so the preview
  //     reflects a word the player can't actually complete this turn.
  //     overcharge: true shows the amplified damage while the player has the
  //     Overcharge toggle armed, via the exact same playWord multiplier this
  //     file uses -- never a duplicated formula.
  // Mutates nothing: player.rack, monster.hp, player.ink, and comboState are all
  // cloned first, so this is safe to call on every keystroke/stage/render.
  Combat.previewWord = function (player, monster, word, comboState, options) {
    var Lexicon = window.Wordbound.Lexicon;
    var Items = window.Wordbound.Items;
    options = options || {};
    if (!player || !monster || !word) return { valid: false };
    var upper = String(word).trim().toUpperCase();
    if (!upper || !Lexicon.isValidWord(upper)) return { valid: false };

    // Clone every piece playWord + the item hooks mutate. Tile objects are
    // shared by reference (nothing in this path mutates a tile's own fields --
    // only the rack ARRAY is spliced by removeTiles, and hp/combo live on the
    // cloned wrappers).
    var rack = (player.rack || []).slice();
    if (options.hexedTileId) rack = rack.filter(function (t) { return t.id !== options.hexedTileId; });
    var playerClone = Object.assign({}, player, { rack: rack });
    var monsterClone = Object.assign({}, monster);
    var comboClone = comboState
      ? { combo: comboState.combo || 0, usedWords: new Set(comboState.usedWords || []) }
      : undefined;

    var result = Combat.playWord(playerClone, monsterClone, upper, comboClone, { overcharge: !!options.overcharge });
    if (!result) return { valid: false };

    if (Items) {
      var ctx = {
        player: playerClone, monster: monsterClone, word: result.word,
        tilesUsed: result.tilesUsed, result: result,
        previousWord: options.previousWord || null,
        wordsPlayedThisFight: (options.wordsPlayedThisFight || 0) + 1,
        messages: []
      };
      Items.runHook('onWordPlayed', ctx, playerClone);
    }

    return {
      valid: true,
      damage: result.damage,
      isRepeat: result.isRepeat,
      multiplier: result.multiplier,
      comboAtPlay: result.comboAtPlay,
      overcharged: result.overcharged
    };
  };

  Combat.monsterAttack = function (player, monster) {
    var damage = monster.attack || 0;
    player.ink = Math.max(0, player.ink - damage);
    return { damage: damage };
  };
})();
