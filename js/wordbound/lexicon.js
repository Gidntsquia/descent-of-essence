// js/wordbound/lexicon.js
// The core novel mechanic of Wordbound: turn a rack of letter tiles into a
// scored, dictionary-validated word. Self-contained, no dependency on the
// old Game.* namespace -- Wordbound is a separate global so it can be built
// additively alongside the existing (working) game without risk of breaking
// it, until a deliberate cutover.
//
// PUBLIC API (window.Wordbound.Lexicon):
//   LETTER_VALUES[letter] -> Scrabble point value (blank '?' = 0)
//   LETTER_POOL[letter]   -> standard 100-tile bag distribution (no blanks
//                            by default; items may add '?' tiles later)
//   createBag(rng)        -> shuffled array of single-char letter strings,
//                            built from LETTER_POOL, using the given
//                            Wordbound RNG instance (see rng.js)
//   drawTiles(bag, count) -> mutates `bag` (removes from the end), returns
//                            up to `count` drawn letters (fewer if bag runs low)
//   isValidWord(word)     -> bool, checks the bundled dictionary. Word must
//                            be >= 2 letters. Case-insensitive.
//   canFormFromRack(word, rack)
//       -> { possible: bool, tilesUsed: string[] }
//          tilesUsed are the SPECIFIC rack letters consumed (same length as
//          word), preferring exact letter matches over blanks so blanks are
//          only spent when necessary. rack is an array of single-char
//          strings, blanks represented as '?'. Does not mutate rack.
//   removeTiles(rack, tilesUsed) -> mutates rack, removing one occurrence of
//          each tile in tilesUsed (by value, first match).
//   scoreWord(word, tilesUsed)
//       -> { base, lengthBonus, bingoBonus, total }
//          base = sum of LETTER_VALUES for tilesUsed (blanks contribute 0
//          regardless of the letter they stand in for -- standard Scrabble
//          rule). lengthBonus = 3 points per letter beyond the 4th
//          (5-letter word: +3, 6-letter: +6, ...). bingoBonus = +15 if
//          tilesUsed.length === 7 (used the whole rack in one word, mirrors
//          Scrabble's "bingo").

(function () {
  window.Wordbound = window.Wordbound || {};
  var Lexicon = (window.Wordbound.Lexicon = {});

  var LETTER_VALUES = {
    A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1,
    M: 3, N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8,
    Y: 4, Z: 10, '?': 0
  };
  Lexicon.LETTER_VALUES = LETTER_VALUES;

  var LETTER_POOL = {
    A: 9, B: 2, C: 2, D: 4, E: 12, F: 2, G: 3, H: 2, I: 9, J: 1, K: 1, L: 4,
    M: 2, N: 6, O: 8, P: 2, Q: 1, R: 6, S: 4, T: 6, U: 4, V: 2, W: 2, X: 1,
    Y: 2, Z: 1
  };
  Lexicon.LETTER_POOL = LETTER_POOL;

  Lexicon.createBag = function (rng) {
    var bag = [];
    Object.keys(LETTER_POOL).forEach(function (letter) {
      for (var i = 0; i < LETTER_POOL[letter]; i++) bag.push(letter);
    });
    return rng && typeof rng.shuffle === 'function' ? rng.shuffle(bag) : bag;
  };

  Lexicon.drawTiles = function (bag, count) {
    var drawn = [];
    for (var i = 0; i < count && bag.length > 0; i++) {
      drawn.push(bag.pop());
    }
    return drawn;
  };

  Lexicon.isValidWord = function (word) {
    if (!word || word.length < 2) return false;
    var upper = word.toUpperCase();
    return window.Wordbound.WORD_SET.has(upper);
  };

  // Prefers exact-letter matches over blanks: for each letter in the word,
  // first try to consume a matching tile from the working rack copy; if
  // none left, fall back to a '?' blank if available; otherwise the word
  // cannot be formed.
  Lexicon.canFormFromRack = function (word, rack) {
    var upper = word.toUpperCase();
    var working = rack.slice();
    var tilesUsed = [];

    for (var i = 0; i < upper.length; i++) {
      var letter = upper[i];
      var idx = working.indexOf(letter);
      if (idx !== -1) {
        tilesUsed.push(letter);
        working.splice(idx, 1);
        continue;
      }
      var blankIdx = working.indexOf('?');
      if (blankIdx !== -1) {
        tilesUsed.push('?');
        working.splice(blankIdx, 1);
        continue;
      }
      return { possible: false, tilesUsed: null };
    }

    return { possible: true, tilesUsed: tilesUsed };
  };

  Lexicon.removeTiles = function (rack, tilesUsed) {
    tilesUsed.forEach(function (tile) {
      var idx = rack.indexOf(tile);
      if (idx !== -1) rack.splice(idx, 1);
    });
  };

  Lexicon.scoreWord = function (word, tilesUsed) {
    var base = 0;
    for (var i = 0; i < tilesUsed.length; i++) {
      base += LETTER_VALUES[tilesUsed[i]] || 0;
    }
    var lengthBonus = word.length > 4 ? (word.length - 4) * 3 : 0;
    var bingoBonus = tilesUsed.length === 7 ? 15 : 0;
    return {
      base: base,
      lengthBonus: lengthBonus,
      bingoBonus: bingoBonus,
      total: base + lengthBonus + bingoBonus
    };
  };
})();
