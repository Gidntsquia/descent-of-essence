// js/wordbound/characters.js
// Character loadout definitions. Each character has a different starting deck
// composition and/or starting items, creating different playstyles within the
// same run structure.

(function () {
  window.Wordbound = window.Wordbound || {};
  var Characters = (window.Wordbound.Characters = {});

  Characters.CHARACTER_DEFS = {
    archivist: {
      id: 'archivist',
      name: 'The Archivist',
      description: 'A balanced approach. Steady hand, versatile toolkit.',
      deckLetters: ['A', 'E', 'I', 'O', 'U', 'N', 'R', 'S', 'T', 'L', 'D', 'G'],
      startingItems: ['spare_satchel']
    },
    scribe: {
      id: 'scribe',
      name: 'The Scribe',
      description: 'High-risk, high-reward. Powerful consonants, fewer vowels.',
      // Was 3 vowels (E,I,A) vs 9 consonants -- balance-simulation.js (2026-08-19,
      // 30 runs) found this made the Scribe hit an unplayable-rack softlock in
      // ~25% of its runs (see the ensureRackIsPlayable() safety net in game.js,
      // added as the primary fix). Swapped L for O here too, to make that safety
      // net trigger less often in the first place -- 4 vowels vs 8 consonants,
      // still meaningfully vowel-poor and keeps every rare/powerful letter
      // (X, Z, K, B) that defines the character, just not quite starved.
      deckLetters: ['E', 'I', 'A', 'O', 'R', 'S', 'T', 'N', 'X', 'Z', 'K', 'B'],
      startingItems: ['heavy_ink', 'folio_mark']
    },
    keeper: {
      id: 'keeper',
      name: 'The Keeper',
      description: 'Defensive specialist. Vowel-rich deck, guaranteed consistency.',
      deckLetters: ['A', 'E', 'I', 'O', 'U', 'U', 'N', 'R', 'S', 'T', 'L', 'Y'],
      startingItems: ['lucky_vowel', 'thick_skin']
    }
  };

  Characters.getCharacterIds = function () {
    return Object.keys(Characters.CHARACTER_DEFS);
  };

  Characters.getCharacter = function (id) {
    return Characters.CHARACTER_DEFS[id];
  };
})();
