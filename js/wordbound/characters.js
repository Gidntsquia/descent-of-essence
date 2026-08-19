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
      deckLetters: ['E', 'I', 'A', 'R', 'S', 'T', 'L', 'N', 'X', 'Z', 'K', 'B'],
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
