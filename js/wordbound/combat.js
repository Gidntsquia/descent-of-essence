// js/wordbound/combat.js
// Ties lexicon.js (scoring) + traits.js (weakness/resistance) + a monster
// instance together into one resolved attack. This is the Wordbound
// equivalent of the old game's Combat.resolveAttack, but the "attack" is
// always a played word, never a stat.
//
// PUBLIC API (window.Wordbound.Combat):
//   playWord(player, monster, word, wordHistory)
//     -> null if the word isn't formable/valid (caller should reject before
//        spending a turn), otherwise:
//        { word, tilesUsed, score, holdMult, activeTraitId, multiplier,
//          isRepeat, damage, monsterDied }
//        tilesUsed is the array of tiles.js Tile objects spent. holdMult is
//        the combined MULT_ON_HOLD multiplier from tiles left in the rack.
//        multiplier is just the trait (weakness/resistance) multiplier.
//        damage = round(score.total * holdMult * multiplier), then
//        halved-ish (x0.4, rounded) if isRepeat.
//     wordHistory (optional, GOALS.md "FUN OVERHAUL 1/8", combo mechanic
//     removed 2026-08-21 -- see GOALS.md batch item 2/7): { usedWords }
//     tracked per-fight by the caller (reset at combat start). usedWords is
//     a Set of words (uppercased) already played this fight, used only for
//     the repeat-word novelty penalty below. Passing this in is optional --
//     omit it (or pass nothing) to get plain trait-multiplier damage with no
//     repeat adjustment, e.g. for callers that don't track a fight (tests,
//     tools). When provided, playWord mutates it: a non-repeat word is added
//     to usedWords for the NEXT call, not this one.
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

  var REPEAT_WORD_PENALTY = 0.4;

  // Balance knobs (also read directly by game.js for the spend/UI side and
  // by test/balance-simulation.js's bot policy -- single source of truth so
  // nothing duplicates these numbers).
  //
  // RETUNE (GOALS.md DESIGN/BALANCE ticket, Jaxon directive 2026-08-21,
  // verbatim: "Rewrite should be way cheaper, overcharge should be cheaper
  // and have a more powerful effect"). Old values: OVERCHARGE_INK_COST=3,
  // OVERCHARGE_DAMAGE_MULTIPLIER=1.5, REWRITE_INK_COST=4. Picked the exact
  // numbers the ticket itself named as examples (3->2 cheaper + 1.5x->2x
  // stronger for Overcharge; 4->2 for Rewrite) rather than going further --
  // 4->2 keeps one point of headroom above the items.js 1-ink floor so
  // Steady Transcription (rewriteCostReduction:1) still does something
  // post-unlock; 4->1 would make that item dead on arrival. Same logic for
  // Overcharge's 3->2 vs. Frugal Bookmark's overchargeCostReduction:1.
  Combat.OVERCHARGE_INK_COST = 2;
  Combat.OVERCHARGE_DAMAGE_MULTIPLIER = 2.0;
  // Rewrite (the other ink spend, GOALS.md's "consumable-style activated
  // ability" candidate): discard the whole rack and redraw fresh, for ink,
  // without ending the turn. The redraw/discard mechanics live in game.js
  // (they touch the draw pile and rack, not combat resolution) -- this is
  // just the shared cost constant.
  Combat.REWRITE_INK_COST = 2;

  Combat.playWord = function (player, monster, word, wordHistory, options) {
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

    // Word novelty (GOALS.md "FUN OVERHAUL 1/8"; combo streak bonus removed
    // 2026-08-21, batch item 2/7 -- see combat.js header). isRepeat is
    // checked against words already played THIS fight, before this word is
    // added to that set below.
    var isRepeat = !!(wordHistory && wordHistory.usedWords && wordHistory.usedWords.has(upperWord));

    var baseDamage = Math.round(score.total * holdMult * traitMultiplier);
    var damage = isRepeat ? Math.round(baseDamage * REPEAT_WORD_PENALTY) : baseDamage;

    var overcharged = !!options.overcharge;
    if (overcharged) damage = Math.round(damage * Combat.OVERCHARGE_DAMAGE_MULTIPLIER);

    monster.hp = Math.max(0, monster.hp - damage);

    if (wordHistory && !isRepeat) {
      if (!wordHistory.usedWords) wordHistory.usedWords = new Set();
      wordHistory.usedWords.add(upperWord);
    }

    return {
      word: upperWord,
      tilesUsed: formed.tilesUsed,
      score: score,
      holdMult: holdMult,
      activeTraitId: activeTraitId,
      multiplier: traitMultiplier,
      isRepeat: isRepeat,
      overcharged: overcharged,
      damage: damage,
      monsterDied: monster.hp <= 0
    };
  };

  // GOALS.md FEATURE (staged-word damage preview): compute the damage a word
  // WOULD deal if played right now, WITHOUT mutating any game state. Runs the
  // real playWord + item onWordPlayed hooks against shallow clones of the
  // player/monster/wordHistory, so the previewed number can never drift from
  // what submit actually deals -- no scoring/item formula is duplicated
  // here. Returns { valid:false } for an unformable/invalid word (caller shows
  // a neutral state), else { valid:true, damage, isRepeat, multiplier }.
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
  // Mutates nothing: player.rack, monster.hp, player.ink, and wordHistory are
  // all cloned first, so this is safe to call on every keystroke/stage/render.
  Combat.previewWord = function (player, monster, word, wordHistory, options) {
    var Lexicon = window.Wordbound.Lexicon;
    var Items = window.Wordbound.Items;
    options = options || {};
    if (!player || !monster || !word) return { valid: false };
    var upper = String(word).trim().toUpperCase();
    if (!upper || !Lexicon.isValidWord(upper)) return { valid: false };

    // Clone every piece playWord + the item hooks mutate. Tile objects are
    // shared by reference (nothing in this path mutates a tile's own fields --
    // only the rack ARRAY is spliced by removeTiles, and hp lives on the
    // cloned wrapper).
    var rack = (player.rack || []).slice();
    if (options.hexedTileId) rack = rack.filter(function (t) { return t.id !== options.hexedTileId; });
    var playerClone = Object.assign({}, player, { rack: rack });
    var monsterClone = Object.assign({}, monster);
    var historyClone = wordHistory
      ? { usedWords: new Set(wordHistory.usedWords || []) }
      : undefined;

    var result = Combat.playWord(playerClone, monsterClone, upper, historyClone, { overcharge: !!options.overcharge });
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
      overcharged: result.overcharged
    };
  };

  Combat.monsterAttack = function (player, monster) {
    var damage = monster.attack || 0;
    player.ink = Math.max(0, player.ink - damage);
    return { damage: damage };
  };
})();
