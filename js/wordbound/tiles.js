// js/wordbound/tiles.js
// Deck-building layer: replaces the old "fresh random Scrabble bag every
// fight" model with a Slay the Spire-style persistent deck. The player
// starts with a fixed 12-tile deck, and after every fight picks 1 of 3
// random tiles to permanently add to it. Some reward tiles carry a rare
// bonus (flat damage when played, score multiplier when played, or score
// multiplier when held-but-not-played that turn). Others (mutually
// exclusive with a bonus, see rollRewardOptions) carry a named VARIANT
// (GOALS.md "FUN OVERHAUL 5/8", 2026-08-20): Gilded/Charged/Vampiric grant a
// small side effect when played (gold/damage/heal, resolved by game.js
// since they touch player state, not just the word's score) and Volatile
// doubles its own letter's score (resolved in lexicon.js scoreWord, since
// that's where letter values are summed) but has a chance to crack -- see
// game.js's crackedThisFight handling for how a cracked tile is kept out of
// this fight's draw/discard cycle without touching the persistent deck.
//
// PUBLIC API (window.Wordbound.Tiles):
//   BONUS_TYPES = { FLAT_ON_PLAY, MULT_ON_PLAY, MULT_ON_HOLD }
//   VARIANTS = { GILDED, CHARGED, VAMPIRIC, VOLATILE }
//   createTile(letter, bonus, variant) -> { id, letter, bonus, variant,
//       crackedThisFight: false } (bonus/variant may be null; a tile never
//       carries both, see rollRewardOptions/rollVariantTile)
//   createStarterDeck() -> fixed array of 12 plain tiles, same every run
//   rollRewardOptions(rng, count=3) -> array of `count` freshly rolled tiles,
//       ~25% carrying a variant, otherwise falling back to the legacy
//       (~18%-of-the-remainder) bonus roll
//   rollVariantTile(rng) -> a single freshly rolled tile GUARANTEED to carry
//       a variant (never a legacy bonus) -- used for the shop's premium
//       variant-tile offer, where "premium" implies the roll can't whiff
//   describeBonus(bonus) / describeVariant(variant) -> human-readable string
//       or null
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

  Tiles.VARIANTS = {
    GILDED: 'gilded',
    CHARGED: 'charged',
    VAMPIRIC: 'vampiric',
    VOLATILE: 'volatile'
  };

  var STARTER_DECK_LETTERS = ['A', 'E', 'I', 'O', 'U', 'N', 'R', 'S', 'T', 'L', 'D', 'G'];

  var nextTileId = 1;

  Tiles.createTile = function (letter, bonus, variant) {
    return { id: 'tile' + (nextTileId++), letter: letter, bonus: bonus || null, variant: variant || null, crackedThisFight: false };
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

  // FUN OVERHAUL 5/8 (GOALS.md, 2026-08-20): rolled BEFORE the legacy bonus
  // roll and mutually exclusive with it -- a tile that lands a variant never
  // also rolls a bonus, keeping "what does this tile do" readable as one
  // badge, not a stack of two. This makes the variant rate exactly
  // VARIANT_CHANCE (the ticket's own "roughly 25% of tile-reward offers")
  // rather than a rate conditioned on the legacy roll missing first.
  var VARIANT_CHANCE = 0.25;
  var VARIANT_LIST = [Tiles.VARIANTS.GILDED, Tiles.VARIANTS.CHARGED, Tiles.VARIANTS.VAMPIRIC, Tiles.VARIANTS.VOLATILE];

  function rollVariant(rng) {
    return rng.choice(VARIANT_LIST);
  }

  Tiles.rollRewardOptions = function (rng, count) {
    count = count || 3;
    var pool = getLetterFrequencyPool();
    var options = [];
    for (var i = 0; i < count; i++) {
      var letter = rng.choice(pool);
      var variant = rng.chance(VARIANT_CHANCE) ? rollVariant(rng) : null;
      var bonus = variant ? null : rollBonus(rng);
      options.push(Tiles.createTile(letter, bonus, variant));
    }
    return options;
  };

  // Guaranteed-variant roll for the shop's premium tile offer (see game.js
  // rollShopOptions) -- a "premium" offer that sometimes has no variant at
  // all would undercut the point of paying extra for one.
  Tiles.rollVariantTile = function (rng) {
    var pool = getLetterFrequencyPool();
    var letter = rng.choice(pool);
    return Tiles.createTile(letter, null, rollVariant(rng));
  };

  Tiles.describeBonus = function (bonus) {
    if (!bonus) return null;
    if (bonus.type === Tiles.BONUS_TYPES.FLAT_ON_PLAY) return '+' + bonus.amount + ' score when played';
    if (bonus.type === Tiles.BONUS_TYPES.MULT_ON_PLAY) return '×' + bonus.amount + ' score when played';
    if (bonus.type === Tiles.BONUS_TYPES.MULT_ON_HOLD) return '×' + bonus.amount + ' score when held (not played)';
    return null;
  };

  Tiles.describeVariant = function (variant) {
    if (!variant) return null;
    if (variant === Tiles.VARIANTS.GILDED) return 'Gilded: +2 gold when played';
    if (variant === Tiles.VARIANTS.CHARGED) return 'Charged: +4 damage when played';
    if (variant === Tiles.VARIANTS.VAMPIRIC) return 'Vampiric: heal 1 ink when played';
    if (variant === Tiles.VARIANTS.VOLATILE) return 'Volatile: letter scores ×2; 25% chance to crack when played (gone until next fight)';
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
