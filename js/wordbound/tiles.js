// js/wordbound/tiles.js
// Deck-building layer: replaces the old "fresh random Scrabble bag every
// fight" model with a Slay the Spire-style persistent deck. The player
// starts with a fixed 12-tile deck, and after every fight picks 1 of 3
// random tiles to permanently add to it. Some reward tiles carry a rare
// bonus (flat damage when played, score multiplier when played, or score
// multiplier when held-but-not-played that turn).
//
// PUBLIC API (window.Wordbound.Tiles):
//   BONUS_TYPES = { FLAT_ON_PLAY, MULT_ON_PLAY, MULT_ON_HOLD }
//   createTile(letter, bonus) -> { id, letter, bonus } (bonus may be null)
//   createStarterDeck() -> fixed array of 12 plain tiles, same every run
//   rollRewardOptions(rng, count=3) -> array of `count` freshly rolled tiles
//   shuffleIntoDrawPile(deck, rng) -> shuffled copy of deck (start-of-fight)
//   draw(pileState, count, rng) -> draws up to `count` tiles from
//       pileState.drawPile, reshuffling pileState.discardPile back into the
//       draw pile when it runs dry. Mutates pileState.drawPile/discardPile.
//       Returns the drawn tile array (may be shorter than count if the
//       combined piles are exhausted).

(function () {
  window.Wordbound = window.Wordbound || {};
  var Tiles = (window.Wordbound.Tiles = {});

  Tiles.BONUS_TYPES = {
    FLAT_ON_PLAY: 'flatOnPlay',
    MULT_ON_PLAY: 'multOnPlay',
    MULT_ON_HOLD: 'multOnHold'
  };

  var STARTER_DECK_LETTERS = ['A', 'E', 'I', 'O', 'U', 'N', 'R', 'S', 'T', 'L', 'D', 'G'];

  var nextTileId = 1;

  Tiles.createTile = function (letter, bonus) {
    return { id: 'tile' + (nextTileId++), letter: letter, bonus: bonus || null };
  };

  Tiles.createStarterDeck = function () {
    return STARTER_DECK_LETTERS.map(function (letter) { return Tiles.createTile(letter, null); });
  };

  // Weighted by standard Scrabble letter frequency (Lexicon.LETTER_POOL),
  // blanks excluded -- reward tiles are always a real letter, occasionally
  // with a bonus attached.
  var letterFrequencyPool = null;
  function getLetterFrequencyPool() {
    if (letterFrequencyPool) return letterFrequencyPool;
    var Lexicon = window.Wordbound.Lexicon;
    letterFrequencyPool = [];
    Object.keys(Lexicon.LETTER_POOL).forEach(function (letter) {
      for (var i = 0; i < Lexicon.LETTER_POOL[letter]; i++) letterFrequencyPool.push(letter);
    });
    return letterFrequencyPool;
  }

  var BONUS_CHANCE = 0.18;

  function rollBonus(rng) {
    if (!rng.chance(BONUS_CHANCE)) return null;
    var type = rng.choice([Tiles.BONUS_TYPES.FLAT_ON_PLAY, Tiles.BONUS_TYPES.MULT_ON_PLAY, Tiles.BONUS_TYPES.MULT_ON_HOLD]);
    if (type === Tiles.BONUS_TYPES.FLAT_ON_PLAY) return { type: type, amount: rng.randInt(3, 6) };
    return { type: type, amount: rng.choice([1.5, 2]) };
  }

  Tiles.rollRewardOptions = function (rng, count) {
    count = count || 3;
    var pool = getLetterFrequencyPool();
    var options = [];
    for (var i = 0; i < count; i++) {
      var letter = rng.choice(pool);
      options.push(Tiles.createTile(letter, rollBonus(rng)));
    }
    return options;
  };

  Tiles.describeBonus = function (bonus) {
    if (!bonus) return null;
    if (bonus.type === Tiles.BONUS_TYPES.FLAT_ON_PLAY) return '+' + bonus.amount + ' score when played';
    if (bonus.type === Tiles.BONUS_TYPES.MULT_ON_PLAY) return '×' + bonus.amount + ' score when played';
    if (bonus.type === Tiles.BONUS_TYPES.MULT_ON_HOLD) return '×' + bonus.amount + ' score when held (not played)';
    return null;
  };

  Tiles.shuffleIntoDrawPile = function (deck, rng) {
    return rng.shuffle(deck);
  };

  Tiles.draw = function (pileState, count, rng) {
    var drawn = [];
    while (drawn.length < count) {
      if (pileState.drawPile.length === 0) {
        if (pileState.discardPile.length === 0) break;
        pileState.drawPile = rng.shuffle(pileState.discardPile);
        pileState.discardPile = [];
      }
      drawn.push(pileState.drawPile.pop());
    }
    return drawn;
  };
})();
