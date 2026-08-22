// js/wordbound/lexicon.js
// The core novel mechanic of Wordbound: turn a rack of letter tiles into a
// scored, dictionary-validated word. Self-contained, no dependency on the
// old Game.* namespace -- Wordbound is a separate global so it can be built
// additively alongside the existing (working) game without risk of breaking
// it, until a deliberate cutover.
//
// PUBLIC API (window.Wordbound.Lexicon):
//   LETTER_VALUES[letter] -> Scrabble point value (blank '?' = 0)
//   LETTER_POOL[letter]   -> standard letter-frequency weights, used by
//                            tiles.js to roll reward tiles (no blanks here;
//                            blanks come from specific item effects)
//   isValidWord(word)     -> bool, checks the bundled dictionary. Word must
//                            be >= 2 letters. Case-insensitive.
//   canFormFromRack(word, rack)
//       -> { possible: bool, tilesUsed: Tile[] }
//          rack/tilesUsed are arrays of tiles.js Tile objects
//          ({ id, letter, bonus }). tilesUsed are the SPECIFIC rack tile
//          instances consumed (same length as word, in word order),
//          preferring exact letter matches over blank ('?') tiles so blanks
//          are only spent when necessary. Does not mutate rack.
//   removeTiles(rack, tilesUsed) -> mutates rack, removing each tile in
//          tilesUsed by matching `.id` (removes the exact instance played,
//          not just any tile sharing its letter).
//   scoreWord(word, tilesUsed, rackCapacity)
//       -> { base, lengthBonus, bingoBonus, bonusFlat, bonusMult, variantFlat, total }
//          base = sum of LETTER_VALUES for tilesUsed (blanks contribute 0;
//          a Volatile tile's own letter value is doubled here, see tiles.js
//          VARIANTS -- GOALS.md "FUN OVERHAUL 5/8").
//          lengthBonus: 0 for length<=4, +2 at length 5 (unchanged), then a
//          superlinear jump from length 6 on -- see LENGTH_BONUS_TABLE below
//          for the exact curve (Jaxon desktop-playtest follow-up filed
//          2026-08-21, GOALS.md: "longer words should deal a noticeably
//          larger damage bonus, especially 6+ letters" -- the old flat
//          (len-4)*2 formula only gave +4 at 6 letters, barely felt next to
//          letter values).
//          bingoBonus = +15 if tilesUsed.length === rackCapacity (using the
//          WHOLE rack in one word, not a hardcoded 7 -- callers pass the
//          player's actual capacity from Items.getRackCapacity; rackCapacity
//          defaults to 7 when omitted, e.g. from callers with no player
//          reference). bonusFlat/bonusMult roll up each played tile's
//          on-play bonus (see tiles.js BONUS_TYPES); variantFlat rolls up
//          each played tile's Charged variant (+4 each, see tiles.js
//          VARIANTS); total =
//          round((base+lengthBonus+bingoBonus+bonusFlat+variantFlat) * bonusMult).
//          MULT_ON_HOLD bonuses are NOT included here -- those depend on
//          tiles left in the rack, which combat.js resolves. Gilded/Vampiric
//          variants (gold/heal) aren't part of scoring at all -- game.js
//          resolves those directly from a played word's tilesUsed.

(function () {
  window.Wordbound = window.Wordbound || {};
  var Lexicon = (window.Wordbound.Lexicon = {});

  var LETTER_VALUES = {
    A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1,
    M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8,
    Y: 4, Z: 10, '?': 0
  };
  Lexicon.LETTER_VALUES = LETTER_VALUES;

  // Word-length damage bonus (scoreWord's lengthBonus field). Word length is
  // THE skill-expression damage lever now that the combo mechanic is gone
  // (GOALS.md, 2026-08-21 Jaxon-batch follow-up). Length 5 stays at the old
  // +2 (a bare improvement over a 4-letter word shouldn't feel huge); from
  // length 6 on the curve jumps and then grows superlinearly (each extra
  // letter's marginal bonus is itself larger than the last: +6, +8, +10,
  // +12, ...) so a 6+ letter word reads as a clear power spike rather than
  // "a little more damage":
  //   len:    4   5   6   7   8   9   10
  //   bonus:  0   2   8  14  22  32   44
  // len>=6 bonus = len*len - 7*len + 14 (quadratic fit through the table
  // above); continues past 10 at the same growth rate (11 -> 58, 12 -> 74)
  // rather than capping, since the dictionary supports longer words and
  // finding one that long is already its own reward.
  function lengthBonusFor(len) {
    if (len <= 4) return 0;
    if (len === 5) return 2;
    return len * len - 7 * len + 14;
  }
  Lexicon.lengthBonusFor = lengthBonusFor;

  var LETTER_POOL = {
    A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4,
    M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1,
    Y: 2, Z: 1
  };
  Lexicon.LETTER_POOL = LETTER_POOL;

  Lexicon.isValidWord = function (word) {
    if (!word || word.length < 2) return false;
    var upper = word.toUpperCase();
    return window.Wordbound.WORD_SET.has(upper);
  };

  // Prefers exact-letter matches over blanks: for each letter in the word,
  // first try to consume a matching tile from the working rack copy; if
  // none left, fall back to a '?' blank tile if available; otherwise the
  // word cannot be formed. rack is an array of tiles.js Tile objects.
  Lexicon.canFormFromRack = function (word, rack) {
    var upper = word.toUpperCase();
    var working = rack.slice();
    var tilesUsed = [];

    for (var i = 0; i < upper.length; i++) {
      var letter = upper[i];
      var idx = -1;
      for (var j = 0; j < working.length; j++) {
        if (working[j].letter === letter) { idx = j; break; }
      }
      if (idx === -1) {
        for (var k = 0; k < working.length; k++) {
          if (working[k].letter === '?') { idx = k; break; }
        }
      }
      if (idx === -1) return { possible: false, tilesUsed: null };
      tilesUsed.push(working[idx]);
      working.splice(idx, 1);
    }

    return { possible: true, tilesUsed: tilesUsed };
  };

  Lexicon.removeTiles = function (rack, tilesUsed) {
    tilesUsed.forEach(function (tile) {
      var idx = -1;
      for (var i = 0; i < rack.length; i++) {
        if (rack[i].id === tile.id) { idx = i; break; }
      }
      if (idx !== -1) rack.splice(idx, 1);
    });
  };

  // tilesUsed: array of tiles.js Tile objects, in the order they spell the
  // word. Rolls up each tile's on-play bonus (see tiles.js BONUS_TYPES);
  // on-hold bonuses depend on tiles NOT played, so combat.js resolves those.
  Lexicon.scoreWord = function (word, tilesUsed, rackCapacity) {
    var Tiles = window.Wordbound.Tiles;
    var base = 0;
    var bonusFlat = 0;
    var bonusMult = 1;
    var variantFlat = 0;
    for (var i = 0; i < tilesUsed.length; i++) {
      var tile = tilesUsed[i];
      var letterValue = LETTER_VALUES[tile.letter] || 0;
      if (tile.variant === Tiles.VARIANTS.VOLATILE) letterValue *= 2;
      base += letterValue;
      if (tile.bonus) {
        if (tile.bonus.type === Tiles.BONUS_TYPES.FLAT_ON_PLAY) bonusFlat += tile.bonus.amount;
        else if (tile.bonus.type === Tiles.BONUS_TYPES.MULT_ON_PLAY) bonusMult *= tile.bonus.amount;
      }
      if (tile.variant === Tiles.VARIANTS.CHARGED) variantFlat += 4;
    }
    var lengthBonus = lengthBonusFor(word.length);
    var capacity = rackCapacity || 7;
    var bingoBonus = tilesUsed.length === capacity ? 15 : 0;
    var total = Math.round((base + lengthBonus + bingoBonus + bonusFlat + variantFlat) * bonusMult);
    return {
      base: base,
      lengthBonus: lengthBonus,
      bingoBonus: bingoBonus,
      bonusFlat: bonusFlat,
      bonusMult: bonusMult,
      variantFlat: variantFlat,
      total: total
    };
  };

  // sorted-letters -> true, built once and cached. Lets hasPlayableWord check
  // "does any subset of this rack spell a word" without testing 200k+ words
  // against the rack every time -- same approach as test/balance-simulation.js's
  // buildAnagramMap, just a Set of keys since we only need existence here.
  var anagramKeySet = null;
  function getAnagramKeySet() {
    if (anagramKeySet) return anagramKeySet;
    anagramKeySet = new Set();
    var wordlist = window.Wordbound.WORDLIST || [];
    for (var i = 0; i < wordlist.length; i++) {
      var w = wordlist[i];
      if (w.length < 2) continue;
      anagramKeySet.add(w.split('').sort().join(''));
    }
    return anagramKeySet;
  }

  // Is there ANY word this rack can form? Used to detect and avoid a hard
  // softlock: if a rack can spell nothing, the player has no possible action
  // (there's no discard/redraw), and the rack only ever cycles after a word
  // is actually played -- so an unplayable rack is a permanent dead end.
  // Ignores blank ('?') tiles for this fast check (treats a rack containing
  // one as always playable) -- a blank only ever ADDS options, and checking
  // its wildcard substitutions properly would need the slower canFormFromRack
  // path this function exists to avoid running on every subset.
  Lexicon.hasPlayableWord = function (rack) {
    var usable = [];
    for (var i = 0; i < rack.length; i++) {
      if (rack[i].letter === '?') return true;
      usable.push(rack[i].letter);
    }
    var n = usable.length;
    if (n < 2) return false;
    var keys = getAnagramKeySet();
    for (var mask = 1; mask < (1 << n); mask++) {
      var subset = [];
      for (var bit = 0; bit < n; bit++) {
        if (mask & (1 << bit)) subset.push(usable[bit]);
      }
      if (subset.length < 2) continue;
      var key = subset.slice().sort().join('');
      if (keys.has(key)) return true;
    }
    return false;
  };
})();
