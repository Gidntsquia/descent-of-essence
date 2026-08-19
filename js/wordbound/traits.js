// js/wordbound/traits.js
// Linguistic traits: the thing that replaces "enemy stats/AI" from the old
// game. Each trait is a pure function (word, tilesUsed) -> damage
// multiplier. 0 = immune this turn, 1 = normal, >1 = bonus/weak-point hit.
// Monsters/bosses reference traits by id; a monster can have one active
// trait (regular enemies) or a phase list of traits keyed by hp threshold
// (bosses -- mirrors the old boss phase-selection pattern: sorted
// descending by hpThreshold, pick the highest-index phase whose threshold
// the current hp ratio is at-or-below).
//
// PUBLIC API (window.Wordbound.Traits):
//   TRAITS[id] = { id, name, hint, multiplier(word, tilesUsed) }
//   activeTraitForHpRatio(traitPhases, hpRatio) -> traitId
//       traitPhases: [{ hpThreshold, traitId }, ...]

(function () {
  window.Wordbound = window.Wordbound || {};
  var Traits = (window.Wordbound.Traits = {});
  var TRAITS = {};
  Traits.TRAITS = TRAITS;

  var VOWELS = ['A', 'E', 'I', 'O', 'U'];
  function vowelCount(word) {
    var n = 0;
    for (var i = 0; i < word.length; i++) if (VOWELS.indexOf(word[i]) !== -1) n++;
    return n;
  }
  function isPalindrome(word) {
    var rev = word.split('').reverse().join('');
    return rev === word;
  }
  function hasDoubleLetter(word) {
    for (var i = 0; i < word.length - 1; i++) if (word[i] === word[i + 1]) return true;
    return false;
  }
  function hasRareLetter(word) {
    var Lexicon = window.Wordbound.Lexicon;
    for (var i = 0; i < word.length; i++) {
      if ((Lexicon.LETTER_VALUES[word[i]] || 0) >= 4) return true;
    }
    return false;
  }
  function isAlphabetical(word) {
    for (var i = 1; i < word.length; i++) if (word[i] < word[i - 1]) return false;
    return true;
  }

  function def(t) { TRAITS[t.id] = t; }

  def({
    id: 'vowelHungry',
    name: 'Vowel-Hungry',
    hint: 'Takes bonus damage from words with 3+ vowels.',
    multiplier: function (word) { return vowelCount(word) >= 3 ? 2 : 1; }
  });

  def({
    id: 'vowelless',
    name: 'The Consonant',
    hint: 'Takes bonus damage from words with zero vowels, resists other words.',
    // Zero-vowel English words are genuinely rare (SKY, CRY, MYTH...) and a
    // player's rack won't always be able to form one -- a hard 0x here made
    // this fight literally unwinnable on an unlucky draw. Heavily discouraged
    // (0.3x) rather than impossible, so the weakness still matters but doesn't
    // hard-lock the fight.
    multiplier: function (word) { return vowelCount(word) === 0 ? 1.5 : 0.3; }
  });

  def({
    id: 'palindromic',
    name: 'The Mirror',
    hint: 'Only damaged by palindromes (reads the same backwards).',
    multiplier: function (word) { return isPalindrome(word) ? 2 : 0; }
  });

  def({
    id: 'shortFuse',
    name: 'Short Fuse',
    hint: 'Immune to words longer than 4 letters.',
    multiplier: function (word) { return word.length <= 4 ? 1.5 : 0; }
  });

  def({
    id: 'lengthy',
    name: 'The Unabridged',
    hint: 'Takes bonus damage from words 6+ letters long.',
    multiplier: function (word) { return word.length >= 6 ? 2 : 1; }
  });

  def({
    id: 'doubled',
    name: 'The Echo',
    hint: 'Takes bonus damage from words with a doubled letter (e.g. LETTER).',
    multiplier: function (word) { return hasDoubleLetter(word) ? 2 : 1; }
  });

  def({
    id: 'rareSeeker',
    name: 'The Collector',
    hint: 'Takes bonus damage from words containing a high-value letter (4+ points).',
    multiplier: function (word) { return hasRareLetter(word) ? 2 : 1; }
  });

  def({
    id: 'alphabetic',
    name: 'The Sorted',
    hint: 'Only damaged by words whose letters are in alphabetical order (e.g. ABORT).',
    multiplier: function (word) { return isAlphabetical(word) ? 2 : 0; }
  });

  def({
    id: 'silentE',
    name: "Fool's Vowel",
    hint: 'Takes bonus damage from words ending in E.',
    multiplier: function (word) { return word[word.length - 1] === 'E' ? 2 : 1; }
  });

  def({
    id: 'plain',
    name: 'Unremarkable',
    hint: 'No weakness or resistance -- every word deals normal damage.',
    multiplier: function () { return 1; }
  });

  Traits.activeTraitForHpRatio = function (traitPhases, hpRatio) {
    var chosen = traitPhases[0].traitId;
    for (var i = 0; i < traitPhases.length; i++) {
      if (hpRatio <= traitPhases[i].hpThreshold) chosen = traitPhases[i].traitId;
    }
    return chosen;
  };
})();
