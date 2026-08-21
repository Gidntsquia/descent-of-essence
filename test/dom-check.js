// test/dom-check.js
//
// Fast, no-browser-download DOM sanity check for wordbound.html, using jsdom.
// Run with `npm test` (or `node test/dom-check.js`). No network access needed
// after `npm install` has been run once.
//
// WHY THIS EXISTS: on 2026-08-19, two real bugs shipped and got marked
// complete in GOALS.md despite passing code review and a Node-based logic
// harness, because neither ever actually executed the game in a DOM:
//   1. animateDamage() looked up an element by an id that didn't exist
//      (only a class did) -- every damage-dealing word threw an uncaught
//      exception and silently broke the rest of that turn (rack never
//      cycled, counterattack never applied, nothing re-rendered).
//   2. Even after fixing #1, render() was rebuilding monster-info's
//      innerHTML AFTER the damage-number element was appended, destroying
//      it before the browser ever painted a frame with it visible.
// Both are exactly the kind of bug this script exists to catch: run this
// BEFORE checking off any task that touches rendering, event handlers, or
// game-state transitions. It is not a substitute for a real playtest, and
// it CANNOT verify audio (jsdom has no Web Audio API) or drag-and-drop
// (jsdom's DataTransfer support is incomplete) -- those still need a real
// browser (Playwright), which is heavier and is the orchestrator's job to
// run periodically, not something to set up fresh every hourly task.
//
// Exit code 0 = all checks passed. Non-zero = something's actually broken;
// read the output, fix it, don't check the task off with this still failing.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log('OK   ' + label);
  } else {
    console.log('FAIL ' + label);
    failures++;
  }
}

async function main() {
  // Optional CLI arg: path to the HTML file to check (defaults to the repo's
  // own wordbound.html). Lets the itch.io build script point this same check
  // at a staged/unzipped index.html to prove the packaged file set is
  // complete and its relative paths resolve, without duplicating this file.
  const targetPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'wordbound.html');
  const html = fs.readFileSync(targetPath, 'utf8');
  const errors = [];

  const dom = new JSDOM(html, {
    url: 'file://' + targetPath,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
  });

  dom.window.addEventListener('error', (e) => {
    errors.push((e.error && e.error.stack) || e.message);
  });

  // wait for the page's own scripts (loaded via resources:"usable") to finish
  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
  });
  // give any queued microtasks/late script execution a moment
  await new Promise((r) => setTimeout(r, 300));

  const { document, window } = dom.window;
  check('page loaded with zero uncaught errors', errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log('  ERR:', e));

  check('window.Wordbound.Game exists', !!(window.Wordbound && window.Wordbound.Game));
  if (!(window.Wordbound && window.Wordbound.Game)) {
    console.log('\nCannot continue -- Game did not initialize. See errors above.');
    process.exit(1);
  }

  // Wordlist ENABLE1 union (Jaxon, 2026-08-20): ZITS was rejected live on his
  // phone. The base dictionary omitted informal/newer words; ENABLE1 (public
  // domain) was merged in, strictly additive. These probes were all MISSING
  // before the merge and must now validate; the pre-existing words confirm the
  // union didn't clobber anything, and the count guard confirms it only grew.
  {
    const Lexicon = window.Wordbound.Lexicon;
    const WORD_SET = window.Wordbound.WORD_SET;
    ['ZITS', 'ZIT', 'SNIT', 'LUTZ'].forEach((w) => {
      check('Wordlist union: "' + w + '" is now valid (was missing pre-ENABLE1)', Lexicon.isValidWord(w));
    });
    ['ZAGS', 'QUIZ', 'ADZE', 'WHIZ', 'CAT', 'GARDEN'].forEach((w) => {
      check('Wordlist union: pre-existing "' + w + '" still valid', Lexicon.isValidWord(w));
    });
    check('Wordlist union: list grew to > 500000 words (was 497871)', WORD_SET.size > 500000);
  }

  // Wordlist SUPPLEMENT (Jaxon, 2026-08-20): BORKS was rejected live on his
  // phone (BORK family is in Collins Scrabble Words but not ENABLE1). A small
  // hand-curated supplement of individually-verified modern/informal words was
  // added, strictly additive -- see js/wordbound/wordlist.js's own header
  // comment and SUPPLEMENT array for the full list and reasoning. These probes
  // were all MISSING before the supplement and must now validate; ZORKS was a
  // deliberate exclusion (proper noun, no dictionary support) and must still
  // be rejected.
  {
    const Lexicon = window.Wordbound.Lexicon;
    const WORD_SET = window.Wordbound.WORD_SET;
    ['BORK', 'BORKS', 'BORKED', 'BORKING', 'MEME', 'SELFIE', 'FOMO', 'SUS'].forEach((w) => {
      check('Wordlist supplement: "' + w + '" is now valid (was missing pre-supplement)', Lexicon.isValidWord(w));
    });
    check('Wordlist supplement: "ZORKS" deliberately excluded, still invalid', !Lexicon.isValidWord('ZORKS'));
    check('Wordlist supplement: list grew to > 548695 words (was 548635)', WORD_SET.size > 548695);
  }

  // Foreword item (review B2): its unused-tile-count bonus used to be
  // computed as `rack.length - tilesUsed.length`, but Combat.playWord
  // already removes played tiles from the rack BEFORE onWordPlayed hooks
  // run, so by hook time `rack.length` already IS the unused count and the
  // subtraction double-counted (undercounting or going negative). Isolated
  // check with a synthetic player/monster/rack, independent of the live run
  // state exercised below -- doesn't need a run in progress.
  {
    const Combat = window.Wordbound.Combat;
    const Tiles = window.Wordbound.Tiles;
    const Items = window.Wordbound.Items;
    const rack = ['C', 'A', 'T', 'D', 'G', 'L', 'N'].map((l) => Tiles.createTile(l, null));
    const player = { rack: rack, items: ['foreword'], ink: 20, maxInk: 20 };
    const monster = { hp: 100, maxHp: 100, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
    const result = Combat.playWord(player, monster, 'CAT');
    check('Foreword test setup: "CAT" is playable from the synthetic 7-tile rack', !!result);
    if (result) {
      const damageBeforeHook = result.damage;
      const ctx = { player: player, monster: monster, word: result.word, tilesUsed: result.tilesUsed, result: result };
      Items.runHook('onWordPlayed', ctx, player);
      // CAT uses 3 of the 7 rack tiles, leaving 4 unused -- Foreword should
      // add exactly +4 damage, not rack.length(4) - tilesUsed.length(3) = 1.
      check('Foreword (review B2): bonus damage equals unused tile count (4)', result.damage === damageBeforeHook + 4);
    }
  }

  // FUN OVERHAUL 4/8 (GOALS.md, 2026-08-20): 8 build-defining rule-changer
  // items. Same isolated Combat.playWord + Items.runHook pattern as the
  // Foreword check above -- exact damage/HP math per item, plus a positive
  // and a negative case where the item is conditional.
  {
    const Combat = window.Wordbound.Combat;
    const Tiles = window.Wordbound.Tiles;
    const Items = window.Wordbound.Items;
    const monster = { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
    const freshRack = () => ['C', 'A', 'T', 'D', 'G', 'L', 'N'].map((l) => Tiles.createTile(l, null));

    // 1. Illuminated Initial: word starts with the same letter as the
    // previous word -> +40%.
    {
      const player = { rack: freshRack(), items: ['illuminated_initial'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: 'CRAG', wordsPlayedThisFight: 2, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Illuminated Initial: +40% when the word shares its previous word\'s first letter', result.damage === before + Math.round(before * 0.4));
      check('Illuminated Initial: logs a proc message', ctx.messages.indexOf('Illuminated Initial: +40%!') !== -1);
    }
    {
      // Negative case: different first letter -> no bonus, no message.
      const player = { rack: freshRack(), items: ['illuminated_initial'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: 'DOG', wordsPlayedThisFight: 2, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Illuminated Initial: no bonus on a different first letter', result.damage === before && ctx.messages.length === 0);
    }

    // 2. Errant Footnote: every 3rd word played this fight deals x2 (+100%).
    {
      const player = { rack: freshRack(), items: ['errant_footnote'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 3, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Errant Footnote: doubles damage on the 3rd word this fight', result.damage === before * 2);
      check('Errant Footnote: logs a proc message', ctx.messages.indexOf('Errant Footnote: x2!') !== -1);
    }
    {
      const player = { rack: freshRack(), items: ['errant_footnote'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 2, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Errant Footnote: no bonus on the 2nd word this fight', result.damage === before);
    }

    // 3. Vowel Reliquary: vowels score triple their letter value (+2x
    // their base value, since base is already counted once).
    {
      const player = { rack: freshRack(), items: ['vowel_reliquary'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 1, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      // "CAT" has one vowel (A, LETTER_VALUES.A === 1) -> +2*1 = +2.
      check('Vowel Reliquary: +2 bonus for CAT\'s one vowel (A, value 1)', result.damage === before + 2);
    }

    // 4. Consonant Cluster: +2 damage per consonant in the word.
    {
      const player = { rack: freshRack(), items: ['consonant_cluster'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 1, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      // "CAT" has two consonants (C, T) -> +2*2 = +4.
      check('Consonant Cluster: +4 bonus for CAT\'s two consonants', result.damage === before + 4);
    }

    // 5. Long-S Ligature: 6+ letter words deal +25% and heal 1 ink.
    {
      const rack = ['G', 'A', 'R', 'D', 'E', 'N', 'X'].map((l) => Tiles.createTile(l, null));
      const player = { rack, items: ['long_s_ligature'], ink: 15, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'GARDEN');
      check('Long-S Ligature test setup: "GARDEN" (6 letters) is playable', !!result);
      if (result) {
        const before = result.damage;
        const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 1, messages: [] };
        Items.runHook('onWordPlayed', ctx, player);
        check('Long-S Ligature: +25% on a 6+ letter word', result.damage === before + Math.round(before * 0.25));
        check('Long-S Ligature: heals 1 ink on a 6+ letter word', player.ink === 16);
      }
    }
    {
      // Negative case: under 6 letters -> no bonus, no heal.
      const player = { rack: freshRack(), items: ['long_s_ligature'], ink: 15, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 1, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Long-S Ligature: no bonus/heal under 6 letters', result.damage === before && player.ink === 15);
    }

    // 6. Cursed Quill: +10 flat damage, 2 self-damage per word (can drop to
    // 0, deliberately no floor-at-1 guard -- "that's the deal").
    {
      const player = { rack: freshRack(), items: ['cursed_quill'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 1, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Cursed Quill: +10 flat damage', result.damage === before + 10);
      check('Cursed Quill: 2 self-damage applied', player.ink === 18);
    }
    {
      // Edge case: can actually kill the player (no floor).
      const player = { rack: freshRack(), items: ['cursed_quill'], ink: 1, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 1, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Cursed Quill: can drop the player to 0 ink (no floor)', player.ink === 0);
    }

    // 7. Gilded Bookmark: the fight's first word deals x2.
    {
      const player = { rack: freshRack(), items: ['gilded_bookmark'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 1, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Gilded Bookmark: doubles damage on the fight\'s first word', result.damage === before * 2);
    }
    {
      const player = { rack: freshRack(), items: ['gilded_bookmark'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: 'DOG', wordsPlayedThisFight: 2, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Gilded Bookmark: no bonus on the fight\'s second word', result.damage === before);
    }

    // 8. Palimpsest: word shares 3+ distinct letters with the previous word
    // -> +30%.
    {
      const player = { rack: freshRack(), items: ['palimpsest'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      // 'TACO' shares C, A, T with 'CAT' -- 3 distinct letters.
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: 'TACO', wordsPlayedThisFight: 2, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Palimpsest: +30% when sharing 3+ distinct letters with the previous word', result.damage === before + Math.round(before * 0.3));
    }
    {
      const player = { rack: freshRack(), items: ['palimpsest'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      // 'DOG' shares zero letters with 'CAT'.
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: 'DOG', wordsPlayedThisFight: 2, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Palimpsest: no bonus sharing fewer than 3 distinct letters', result.damage === before);
    }
  }

  // CONTENT ticket (GOALS.md, 2026-08-21): 9 new items filling the onDraw/
  // onRunStart/onPlayerDamaged/gold-economy/consumable-synergy/floor-
  // transition gaps. Same isolated Combat.playWord + Items.runHook pattern
  // as the blocks above, plus direct ctx construction for the hooks that
  // don't run through Combat.playWord at all (onDraw, onRunStart,
  // onPlayerDamaged, onFloorAdvance).
  {
    const Combat = window.Wordbound.Combat;
    const Tiles = window.Wordbound.Tiles;
    const Items = window.Wordbound.Items;
    const Lexicon = window.Wordbound.Lexicon;
    const monster = { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
    const freshRack = () => ['C', 'A', 'T', 'D', 'G', 'L', 'N'].map((l) => Tiles.createTile(l, null));

    // 1. Card Catalog Key: guarantees a 3+ value letter in the draw.
    {
      const player = { items: ['card_catalog_key'] };
      const drawnTiles = ['A', 'E', 'I'].map((l) => Tiles.createTile(l, null));
      const drawPile = ['N', 'B', 'O'].map((l) => Tiles.createTile(l, null)); // B is worth 3
      const pileState = { drawPile, discardPile: [] };
      const ctx = { player, drawnTiles, pileState, rng: { randInt: () => 0 } };
      Items.runHook('onDraw', ctx, player);
      const hasRare = ctx.drawnTiles.some((t) => (Lexicon.LETTER_VALUES[t.letter] || 0) >= 3);
      check('Card Catalog Key: a draw with no 3+ value letter gets one swapped in', hasRare);
      check('Card Catalog Key: the pulled tile leaves the draw pile, the displaced tile joins it', !pileState.drawPile.some((t) => t.letter === 'B') && pileState.drawPile.some((t) => t.letter === 'A'));
    }
    {
      const player = { items: ['card_catalog_key'] };
      const drawnTiles = ['B', 'E', 'I'].map((l) => Tiles.createTile(l, null));
      const drawPile = ['N', 'C', 'O'].map((l) => Tiles.createTile(l, null));
      const ctx = { player, drawnTiles, pileState: { drawPile, discardPile: [] }, rng: { randInt: () => 0 } };
      Items.runHook('onDraw', ctx, player);
      check('Card Catalog Key: no-op when the draw already has a 3+ value letter', drawnTiles.map((t) => t.letter).join(',') === 'B,E,I' && drawPile.length === 3);
    }

    // 2. Bookplate: adds one guaranteed Charged tile to the draw pile at
    // fight start.
    {
      const player = { items: ['bookplate'] };
      const pileState = { drawPile: [], discardPile: [] };
      Items.runHook('onRunStart', { player, pileState }, player);
      check('Bookplate: adds exactly one Charged tile to the draw pile', pileState.drawPile.length === 1 && pileState.drawPile[0].variant === Tiles.VARIANTS.CHARGED);
    }

    // 3. Ex Libris: +4 gold at the start of each fight.
    {
      const player = { items: ['ex_libris'], gold: 10 };
      Items.runHook('onRunStart', { player, pileState: { drawPile: [], discardPile: [] } }, player);
      check('Ex Libris: +4 gold at fight start (10 -> 14)', player.gold === 14);
    }

    // 4. Late Fee: gain floor(damage/2) gold when hit; damage itself is
    // untouched (it's a gold-economy item, not a reduction item).
    {
      const player = { items: ['late_fee'], gold: 0 };
      const ctx = { player, monster: {}, damage: 7 };
      Items.runHook('onPlayerDamaged', ctx, player);
      check('Late Fee: gains floor(damage/2) gold on hit (7 damage -> 3 gold)', player.gold === 3);
      check('Late Fee: does not alter the damage itself', ctx.damage === 7);
    }

    // 5. Interlibrary Loan: +3 flat damage while holding 2+ consumables.
    {
      const player = { rack: freshRack(), items: ['interlibrary_loan'], ink: 20, maxInk: 20, consumables: ['errata_slip', 'page_turn'] };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 1, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Interlibrary Loan: +3 while holding 2+ consumables', result.damage === before + 3);
      check('Interlibrary Loan: logs a proc message', ctx.messages.indexOf('Interlibrary Loan: +3!') !== -1);
    }
    {
      const player = { rack: freshRack(), items: ['interlibrary_loan'], ink: 20, maxInk: 20, consumables: ['errata_slip'] };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 1, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Interlibrary Loan: no bonus holding fewer than 2 consumables', result.damage === before);
    }

    // 6. Withdrawal Slip: +6 flat damage while holding ZERO consumables
    // (the mirror-image build to Interlibrary Loan above).
    {
      const player = { rack: freshRack(), items: ['withdrawal_slip'], ink: 20, maxInk: 20, consumables: [] };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 1, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Withdrawal Slip: +6 while holding zero consumables', result.damage === before + 6);
    }
    {
      const player = { rack: freshRack(), items: ['withdrawal_slip'], ink: 20, maxInk: 20, consumables: ['errata_slip'] };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 1, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Withdrawal Slip: no bonus while holding any consumable', result.damage === before);
    }

    // 7. Colophon: +2 damage per DISTINCT letter in the word (not per
    // length -- a rack with duplicate tiles proves the distinction).
    {
      const player = { rack: freshRack(), items: ['colophon'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 1, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Colophon: +2 per distinct letter (CAT = 3 distinct -> +6)', result.damage === before + 6);
    }
    {
      const rack = ['L', 'E', 'T', 'T', 'E', 'R', 'X'].map((l) => Tiles.createTile(l, null));
      const player = { rack, items: ['colophon'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'LETTER');
      check('Colophon test setup: "LETTER" is playable from a rack with duplicate E/T tiles', !!result);
      if (result) {
        const before = result.damage;
        const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: null, wordsPlayedThisFight: 1, messages: [] };
        Items.runHook('onWordPlayed', ctx, player);
        // LETTER has 4 distinct letters (L,E,T,R) despite being 6 long.
        check('Colophon: counts DISTINCT letters, not word length (LETTER = 4 distinct -> +8, not +12)', result.damage === before + 8);
      }
    }

    // 8. Bound Volume: +25% when the word's length matches the previous
    // word's length this fight.
    {
      const player = { rack: freshRack(), items: ['bound_volume'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: 'DOG', wordsPlayedThisFight: 2, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Bound Volume: +25% matching the previous word\'s length (CAT/DOG both 3)', result.damage === before + Math.round(before * 0.25));
    }
    {
      const player = { rack: freshRack(), items: ['bound_volume'], ink: 20, maxInk: 20 };
      const result = Combat.playWord(player, monster, 'CAT');
      const before = result.damage;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result, previousWord: 'GARDEN', wordsPlayedThisFight: 2, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      check('Bound Volume: no bonus on a different word length', result.damage === before);
    }

    // 9. Acquisitions Budget: flagship floor-transition item. Every 10 gold
    // held becomes +2 max ink (and heals the same amount) when a floor
    // advances; the new onFloorAdvance hook itself (see items.js/game.js).
    {
      const player = { items: ['acquisitions_budget'], gold: 25, maxInk: 20, ink: 15 };
      const ctx = { player, floorNumber: 2, messages: [] };
      Items.runHook('onFloorAdvance', ctx, player);
      // 25 gold -> 2 chunks of 10 spent (20), +4 max ink, +4 heal, 5 gold left.
      check('Acquisitions Budget: spends 10-gold chunks for +2 max ink each (25 -> 20 spent, +4 maxInk)', player.gold === 5 && player.maxInk === 24);
      check('Acquisitions Budget: heals by the same amount as the max ink gain', player.ink === 19);
      check('Acquisitions Budget: logs exactly one proc message', ctx.messages.length === 1);
    }
    {
      const player = { items: ['acquisitions_budget'], gold: 7, maxInk: 20, ink: 15 };
      const ctx = { player, floorNumber: 2, messages: [] };
      Items.runHook('onFloorAdvance', ctx, player);
      check('Acquisitions Budget: no-op under 10 gold (nothing to convert)', player.gold === 7 && player.maxInk === 20 && ctx.messages.length === 0);
    }
  }

  // FUN OVERHAUL 5/8 (GOALS.md, 2026-08-20): special tile variants. The two
  // SCORING variants (Charged +4 flat, Volatile letter-value x2) resolve in
  // Lexicon.scoreWord, so they're checked here in isolation against exact
  // arithmetic; Gilded's gold, Vampiric's heal, and Volatile's crack are
  // player/fight state rather than score, so those are driven through the
  // real Game.submitWord in the live-DOM section further down.
  {
    const Lexicon = window.Wordbound.Lexicon;
    const Tiles = window.Wordbound.Tiles;
    const V = Tiles.VARIANTS;

    // 'CAT' = C(3) + A(1) + T(1) = 5 base, no length/bingo bonus at 3 letters
    // from a 7-capacity rack. Every variant case below is measured against
    // that same 5, so any drift in LETTER_VALUES fails loudly rather than
    // silently rebasing the expected numbers.
    const plain = ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null));
    const plainScore = Lexicon.scoreWord('CAT', plain, 7);
    check('variant baseline: plain "CAT" scores 5 with no variant flat bonus', plainScore.total === 5 && plainScore.variantFlat === 0);

    // Charged: +4 flat per charged tile played, additive with a second one.
    const oneCharged = [Tiles.createTile('C', null, V.CHARGED), Tiles.createTile('A', null), Tiles.createTile('T', null)];
    const oneChargedScore = Lexicon.scoreWord('CAT', oneCharged, 7);
    check('Charged tile: +4 flat damage on the played word (5 -> 9)', oneChargedScore.total === 9 && oneChargedScore.variantFlat === 4);
    const twoCharged = [Tiles.createTile('C', null, V.CHARGED), Tiles.createTile('A', null, V.CHARGED), Tiles.createTile('T', null)];
    check('Charged tile: two charged tiles stack (+8, 5 -> 13)', Lexicon.scoreWord('CAT', twoCharged, 7).total === 13);

    // Volatile: doubles only ITS OWN letter's value, not the whole word.
    // C is worth 3, so a Volatile C adds exactly 3 (5 -> 8) -- if this ever
    // doubled the word total it would read 10 instead.
    const volatileC = [Tiles.createTile('C', null, V.VOLATILE), Tiles.createTile('A', null), Tiles.createTile('T', null)];
    check('Volatile tile: doubles only its own letter value (C 3->6, total 5 -> 8)', Lexicon.scoreWord('CAT', volatileC, 7).total === 8);
    const volatileA = [Tiles.createTile('C', null), Tiles.createTile('A', null, V.VOLATILE), Tiles.createTile('T', null)];
    check('Volatile tile: doubling a 1-point letter adds exactly 1 (5 -> 6)', Lexicon.scoreWord('CAT', volatileA, 7).total === 6);

    // Gilded/Vampiric are deliberately score-neutral -- their whole effect is
    // the side effect game.js applies, so a scoring change here would mean
    // they're double-dipping.
    const gilded = [Tiles.createTile('C', null, V.GILDED), Tiles.createTile('A', null), Tiles.createTile('T', null)];
    check('Gilded tile: no effect on the word score (side effect only)', Lexicon.scoreWord('CAT', gilded, 7).total === 5);
    const vampiric = [Tiles.createTile('C', null, V.VAMPIRIC), Tiles.createTile('A', null), Tiles.createTile('T', null)];
    check('Vampiric tile: no effect on the word score (side effect only)', Lexicon.scoreWord('CAT', vampiric, 7).total === 5);

    // Every variant needs player-readable text -- the badge colors alone
    // don't say what a tile does, and describeVariant feeds the rack tooltip,
    // the tile-reward line, the deck viewer, and the shop offer.
    const allDescribed = [V.GILDED, V.CHARGED, V.VAMPIRIC, V.VOLATILE].every((v) => {
      const d = Tiles.describeVariant(v);
      return typeof d === 'string' && d.length > 0;
    });
    check('describeVariant: all four variants have descriptive text', allDescribed);
    check('describeVariant: null variant describes as null (plain tiles stay plain)', Tiles.describeVariant(null) === null);

    // Roll distribution: variants and legacy bonuses must be MUTUALLY
    // EXCLUSIVE (one badge per tile, see tiles.js rollRewardOptions), and the
    // variant rate should land near the ticket's 25%. Uses a fixed seed so
    // this is a deterministic assertion, not a flaky statistical one.
    const rng = window.Game.RNG.create(12345);
    const rolled = [];
    for (let i = 0; i < 60; i++) rolled.push(...Tiles.rollRewardOptions(rng, 3));
    const withVariant = rolled.filter((t) => !!t.variant);
    check('rollRewardOptions: no tile carries both a variant and a legacy bonus', rolled.every((t) => !(t.variant && t.bonus)));
    check('rollRewardOptions: every rolled variant is one of the four known ids', withVariant.every((t) => Object.keys(V).map((k) => V[k]).indexOf(t.variant) !== -1));
    check('rollRewardOptions: variant rate is roughly 25% (10-40% over 180 rolls)', withVariant.length / rolled.length > 0.10 && withVariant.length / rolled.length < 0.40);
    check('rollRewardOptions: all four variants appear across 180 rolls', Object.keys(V).map((k) => V[k]).every((v) => withVariant.some((t) => t.variant === v)));
    check('rollRewardOptions: fresh tiles start uncracked', rolled.every((t) => t.crackedThisFight === false));

    // The shop's premium offer must never whiff into a plain tile.
    const shopTiles = [];
    for (let i = 0; i < 20; i++) shopTiles.push(Tiles.rollVariantTile(rng));
    check('rollVariantTile: always carries a variant (premium offer never whiffs)', shopTiles.every((t) => !!t.variant && !t.bonus));
  }

  // Word novelty + combo streaks (GOALS.md "FUN OVERHAUL 1/8"): three
  // distinct words should each get a bigger damage multiplier than the last
  // (+12%/stack off the streak BEFORE that word), and replaying an
  // already-used word this fight should both apply the x0.4 repeat penalty
  // and reset the combo for whatever comes next. Isolated synthetic setup
  // like the Foreword check above -- doesn't need a run in progress. High
  // monster HP and the 'plain' trait (multiplier always 1) keep the math
  // predictable (no kill, no weakness multiplier to account for).
  {
    const Combat = window.Wordbound.Combat;
    const Tiles = window.Wordbound.Tiles;
    // Enough tiles for CAT, DOG, PIG, then CAT again (a repeat).
    const rack = ['C', 'A', 'T', 'D', 'O', 'G', 'P', 'I', 'G', 'C', 'A', 'T'].map((l) => Tiles.createTile(l, null));
    const player = { rack: rack, items: [], ink: 20, maxInk: 20 };
    const monster = { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
    const comboState = { combo: 0, usedWords: new Set() };

    const r1 = Combat.playWord(player, monster, 'CAT', comboState);
    check('combo test setup: "CAT" is playable', !!r1);
    const r2 = r1 && Combat.playWord(player, monster, 'DOG', comboState);
    const r3 = r2 && Combat.playWord(player, monster, 'PIG', comboState);
    const r4 = r3 && Combat.playWord(player, monster, 'CAT', comboState); // repeat

    if (r1 && r2 && r3 && r4) {
      check('combo: 1st distinct word has no bonus yet (comboAtPlay 0, x1.00)', r1.comboAtPlay === 0 && r1.comboMultiplier === 1 && !r1.isRepeat);
      check('combo: 2nd distinct word gets +12% (comboAtPlay 1, x1.12)', r2.comboAtPlay === 1 && r2.comboMultiplier === 1.12 && !r2.isRepeat);
      check('combo: 3rd distinct word gets +24% (comboAtPlay 2, x1.24)', r3.comboAtPlay === 2 && r3.comboMultiplier === 1.24 && !r3.isRepeat);
      check('combo: multiplier strictly grows across 3 distinct words', r1.comboMultiplier < r2.comboMultiplier && r2.comboMultiplier < r3.comboMultiplier);
      check('combo: damage for each distinct word matches score * comboMultiplier', r1.damage === Math.round(r1.score.total * r1.comboMultiplier) && r2.damage === Math.round(r2.score.total * r2.comboMultiplier) && r3.damage === Math.round(r3.score.total * r3.comboMultiplier));

      check('combo: repeating "CAT" is flagged isRepeat', r4.isRepeat === true);
      // r4 still earns comboAtPlay 3's bonus (the streak going INTO this word)
      // before the x0.4 repeat penalty is applied on top.
      const r4Boosted = Math.round(r4.score.total * r4.comboMultiplier);
      check('combo: repeat damage is the combo-boosted damage x0.4, rounded', r4.damage === Math.round(r4Boosted * 0.4));
      check('combo: repeat penalty actually reduced the damage below the combo-boosted (pre-penalty) amount', r4Boosted > 0 && r4.damage < r4Boosted);
      check('combo: repeating a word resets the combo streak to 0', comboState.combo === 0);
    } else {
      console.log('SKIP combo checks -- synthetic rack could not form CAT/DOG/PIG (unexpected, check LETTER tiles)');
    }
  }

  // Staged-word damage preview (GOALS.md FEATURE): Combat.previewWord must
  // return the EXACT damage the real submit path would deal, and must not
  // mutate any state (it's called on every keystroke/stage/render). The
  // strongest anti-drift proof is to compare its number against an actual
  // playWord + item-hook run on an identical fresh setup -- if they ever
  // diverge, the preview is lying to the player. Isolated synthetic setup,
  // same style as the combo/Foreword blocks; the live-DOM end-to-end check
  // (preview == damage actually dealt on submit) is further down.
  {
    const Combat = window.Wordbound.Combat;
    const Tiles = window.Wordbound.Tiles;
    const Items = window.Wordbound.Items;
    const freshRack = () => ['C', 'A', 'T', 'D', 'G', 'L', 'N'].map((l) => Tiles.createTile(l, null));

    // Mirror the exact math submitWord does: playWord, then item onWordPlayed
    // hooks, on a throwaway setup, and read result.damage. previewWord must
    // equal this for the SAME inputs.
    const actualDamage = (items, word, prevWord, wordsPlayed, comboState) => {
      const player = { rack: freshRack(), items: items, ink: 20, maxInk: 20 };
      const monster = { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
      const result = Combat.playWord(player, monster, word, comboState);
      if (!result) return null;
      const ctx = { player, monster, word: result.word, tilesUsed: result.tilesUsed, result,
        previousWord: prevWord || null, wordsPlayedThisFight: (wordsPlayed || 0) + 1, messages: [] };
      Items.runHook('onWordPlayed', ctx, player);
      return result.damage;
    };

    // (a) plain word, no items -> preview matches actual.
    {
      const player = { rack: freshRack(), items: [], ink: 20, maxInk: 20 };
      const monster = { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
      const p = Combat.previewWord(player, monster, 'CAT', { combo: 0, usedWords: new Set() }, {});
      const actual = actualDamage([], 'CAT', null, 0, { combo: 0, usedWords: new Set() });
      check('preview: plain word is valid and matches actual submit damage', p.valid && p.damage === actual);
      // Non-mutation: the caller's player/monster/comboState are untouched.
      check('preview: does not remove tiles from the real rack', player.rack.length === 7);
      check('preview: does not mutate the real monster hp', monster.hp === 1000);
    }

    // (b) combo-active state (comboAtPlay 2 -> +24%) -> preview matches actual,
    // and previewing does NOT advance the real combo (still 2 after).
    {
      const player = { rack: freshRack(), items: [], ink: 20, maxInk: 20 };
      const monster = { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
      const combo = { combo: 2, usedWords: new Set(['DOG', 'PIG']) };
      const p = Combat.previewWord(player, monster, 'CAT', combo, {});
      const actual = actualDamage([], 'CAT', null, 0, { combo: 2, usedWords: new Set(['DOG', 'PIG']) });
      check('preview: combo-active word matches actual submit damage', p.valid && p.damage === actual && p.comboAtPlay === 2);
      check('preview: previewing does not advance the real combo streak', combo.combo === 2 && !combo.usedWords.has('CAT'));
    }

    // (c) a repeat word -> preview reports isRepeat and the x0.4 penalty, and
    // matches the actual repeat damage.
    {
      const player = { rack: freshRack(), items: [], ink: 20, maxInk: 20 };
      const monster = { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
      const combo = { combo: 3, usedWords: new Set(['CAT']) };
      const p = Combat.previewWord(player, monster, 'CAT', combo, {});
      const actual = actualDamage([], 'CAT', null, 0, { combo: 3, usedWords: new Set(['CAT']) });
      check('preview: repeat word flagged isRepeat and matches actual (penalized) damage', p.valid && p.isRepeat === true && p.damage === actual);
    }

    // (d) an item-modified word (Consonant Cluster, +2/consonant) -> preview
    // includes the item bonus (must run the hooks, not just base playWord).
    {
      const player = { rack: freshRack(), items: ['consonant_cluster'], ink: 20, maxInk: 20 };
      const monster = { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
      const p = Combat.previewWord(player, monster, 'CAT', { combo: 0, usedWords: new Set() }, {});
      const actual = actualDamage(['consonant_cluster'], 'CAT', null, 0, { combo: 0, usedWords: new Set() });
      const base = actualDamage([], 'CAT', null, 0, { combo: 0, usedWords: new Set() });
      check('preview: reflects item damage modifiers (Consonant Cluster +4 for CAT)', p.valid && p.damage === actual && p.damage === base + 4);
    }

    // (e) a sequence-sensitive item (Gilded Bookmark: first word x2) reads the
    // wordsPlayedThisFight option (previewWord adds 1, matching submit).
    {
      const player = { rack: freshRack(), items: ['gilded_bookmark'], ink: 20, maxInk: 20 };
      const monster = { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
      // wordsPlayedThisFight 0 -> previewWord treats this as the 1st word -> x2.
      const p1 = Combat.previewWord(player, monster, 'CAT', { combo: 0, usedWords: new Set() }, { wordsPlayedThisFight: 0 });
      const base = actualDamage([], 'CAT', null, 0, { combo: 0, usedWords: new Set() });
      check('preview: Gilded Bookmark doubles the previewed first word (wordsPlayed 0 -> word #1)', p1.valid && p1.damage === base * 2);
      // wordsPlayedThisFight 1 -> this is the 2nd word -> no doubling.
      const p2 = Combat.previewWord(player, monster, 'CAT', { combo: 0, usedWords: new Set() }, { wordsPlayedThisFight: 1 });
      check('preview: Gilded Bookmark does not double a later previewed word (wordsPlayed 1 -> word #2)', p2.valid && p2.damage === base);
    }

    // (f) invalid / unformable words -> neutral (valid:false), no throw.
    {
      const player = { rack: freshRack(), items: [], ink: 20, maxInk: 20 };
      const monster = { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
      check('preview: a non-word returns valid:false', Combat.previewWord(player, monster, 'ZZZZ', null, {}).valid === false);
      check('preview: an unformable word (not enough tiles) returns valid:false', Combat.previewWord(player, monster, 'CATTT', null, {}).valid === false);
      check('preview: an empty word returns valid:false', Combat.previewWord(player, monster, '', null, {}).valid === false);
    }

    // (g) hexedTileId option hides a locked tile from rack-matching, exactly as
    // submitWord does -- a word needing only the locked tile can't be previewed.
    {
      const rack = ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null));
      const player = { rack, items: [], ink: 20, maxInk: 20 };
      const monster = { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
      const tId = rack[0].id; // the 'C'
      check('preview: without a hex, CAT is previewable from a C/A/T rack', Combat.previewWord(player, monster, 'CAT', null, {}).valid === true);
      check('preview: with the C tile hexed, CAT is no longer previewable', Combat.previewWord(player, monster, 'CAT', null, { hexedTileId: tId }).valid === false);
    }

    // INK SPEND: Overcharge (GOALS.md INK ticket, run 2/2-4). playWord/
    // previewWord's { overcharge: true } must apply the exact same
    // multiplier -- previewed damage can never drift from what submit
    // actually deals, same anti-drift standard as every other option above.
    {
      const player = { rack: freshRack(), items: [], ink: 20, maxInk: 20 };
      const monster = { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
      const base = actualDamage([], 'CAT', null, 0, { combo: 0, usedWords: new Set() });
      const overchargedResult = Combat.playWord(
        { rack: freshRack(), items: [], ink: 20, maxInk: 20 }, { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] },
        'CAT', { combo: 0, usedWords: new Set() }, { overcharge: true }
      );
      check('overcharge: playWord applies OVERCHARGE_DAMAGE_MULTIPLIER', overchargedResult.damage === Math.round(base * Combat.OVERCHARGE_DAMAGE_MULTIPLIER));
      check('overcharge: playWord flags result.overcharged', overchargedResult.overcharged === true);
      const plainResult = Combat.playWord(
        { rack: freshRack(), items: [], ink: 20, maxInk: 20 }, { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] },
        'CAT', { combo: 0, usedWords: new Set() }
      );
      check('overcharge: omitting options entirely leaves damage/overcharged unaffected (baseline play stays free)', plainResult.damage === base && plainResult.overcharged === false);

      const p = Combat.previewWord(player, monster, 'CAT', { combo: 0, usedWords: new Set() }, { overcharge: true });
      check('overcharge: previewWord with overcharge:true matches the actual overcharged submit damage', p.valid && p.damage === overchargedResult.damage && p.overcharged === true);
      const pOff = Combat.previewWord(player, monster, 'CAT', { combo: 0, usedWords: new Set() }, {});
      check('overcharge: previewWord without the flag matches plain (non-amplified) damage', pOff.valid && pOff.damage === base && pOff.overcharged === false);
    }
  }

  // Multi-phase boss traits (GOALS.md "FUN OVERHAUL 3/8"): every boss should
  // have exactly 2 phases, both drawn from the SIMPLE (bonus-on-match, 1x
  // baseline) trait pool -- never the four 0.3x-floor resistance traits
  // (vowelless/palindromic/shortFuse/alphabetic), which were deliberately
  // removed from bosses in the 2026-08-19/20 balance pass and must not
  // silently come back via this ticket. Isolated math check against
  // Traits.activeTraitForHpRatio directly, same synthetic style as the
  // blocks above -- the live-DOM confirmation that the rendered weakness
  // text actually updates mid-fight is further down, once a run exists.
  {
    const Monsters = window.Wordbound.Monsters;
    const Traits = window.Wordbound.Traits;
    const RESISTANCE_TRAITS = ['vowelless', 'palindromic', 'shortFuse', 'alphabetic'];
    const bossIds = Object.keys(Monsters.BOSS_DEFS);
    check('boss phases: all 3 boss defs present', bossIds.length === 3);
    bossIds.forEach((id) => {
      const def = Monsters.BOSS_DEFS[id];
      const phases = def.traitPhases || [];
      check('boss phases: ' + id + ' has exactly 2 phases', phases.length === 2);
      if (phases.length === 2) {
        check('boss phases: ' + id + ' phase order is descending hpThreshold', phases[0].hpThreshold > phases[1].hpThreshold);
        phases.forEach((p, i) => {
          check('boss phases: ' + id + ' phase ' + i + ' (' + p.traitId + ') is not a resistance trait', RESISTANCE_TRAITS.indexOf(p.traitId) === -1);
        });
        const atFull = Traits.activeTraitForHpRatio(phases, 1.0);
        const atLow = Traits.activeTraitForHpRatio(phases, 0.3);
        check('boss phases: ' + id + ' at full HP uses phase 0 (' + phases[0].traitId + ')', atFull === phases[0].traitId);
        check('boss phases: ' + id + ' below the threshold switches to phase 1 (' + phases[1].traitId + ')', atLow === phases[1].traitId);
      }
    });
  }

  // Monster intents (GOALS.md "FUN OVERHAUL 2/8"): isolated, deterministic
  // checks of the Intents module's own logic -- same synthetic-setup style
  // as the Foreword/combo blocks above, independent of any run in progress.
  {
    const Intents = window.Wordbound.Intents;
    const Monsters = window.Wordbound.Monsters;
    const RNGModule = window.Game.RNG;
    const rng = RNGModule.create('intents-test-seed');

    // WEAK-tier monsters always roll plain Attack -- floor 1 stays welcoming,
    // no telegraphed variety needed.
    const weak = Monsters.createMonster('slime');
    let weakOk = true;
    for (let i = 0; i < 30; i++) {
      const intent = Intents.rollIntent(weak, rng);
      if (intent.type !== 'attack' || intent.value !== weak.attack) weakOk = false;
    }
    check('monster intents: WEAK-tier always rolls plain Attack (30/30)', weakOk);

    // A def with a non-empty `intents` list (sentinel: hex/enrage) fighting
    // as a REGULAR (non-elite, non-boss) monster must never roll a
    // signature move -- only the elite/boss instance of the same fight
    // should see them.
    const regularSentinel = Monsters.createMonster('sentinel');
    check('monster intents: regular-fight instance is not flagged elite/boss', !regularSentinel.isElite && !regularSentinel.isBoss);
    let regularSawSignature = false;
    for (let i = 0; i < 40; i++) {
      const intent = Intents.rollIntent(regularSentinel, rng);
      if (Intents.isSignatureIntent(intent)) regularSawSignature = true;
    }
    check('monster intents: regular (non-elite) strong-tier fight never rolls a signature move (40/40 attack/heavy only)', !regularSawSignature);

    // The SAME def, now flagged as an elite fight, should see its signature
    // pool (hex/enrage for sentinel) mixed in -- weight 1 each against
    // attack:3/heavy:1, so over 60 rolls the odds of never seeing either are
    // astronomically small; a real failure here means the elite gate broke.
    const eliteSentinel = Monsters.createMonster('sentinel');
    eliteSentinel.isElite = true;
    const seenTypes = new Set();
    for (let i = 0; i < 60; i++) {
      seenTypes.add(Intents.rollIntent(eliteSentinel, rng).type);
    }
    check('monster intents: elite fight can roll its def\'s signature moves', seenTypes.has('hex') || seenTypes.has('enrage'));
    check('monster intents: elite fight never rolls a signature NOT in its own def\'s list', !seenTypes.has('devour') && !seenTypes.has('mend'));

    // Heavy Blow's damage value.
    const serpent = Monsters.createMonster('serpent');
    let heavyIntent = null;
    for (let i = 0; i < 100 && !heavyIntent; i++) {
      const intent = Intents.rollIntent(serpent, rng);
      if (intent.type === 'heavy') heavyIntent = intent;
    }
    check('monster intents: Heavy Blow was rolled at least once in 100 tries', !!heavyIntent);
    if (heavyIntent) check('monster intents: Heavy Blow value is round(attack * HEAVY_MULTIPLIER)', heavyIntent.value === Math.round(serpent.attack * Intents.HEAVY_MULTIPLIER));

    // describeIntent / isSignatureIntent sanity.
    check('monster intents: describeIntent formats Attack', Intents.describeIntent({ type: 'attack', value: 5 }) === 'Next: Attack 5');
    check('monster intents: describeIntent formats Heavy Blow', Intents.describeIntent({ type: 'heavy', value: 8 }) === 'Next: Heavy Blow 8');
    check('monster intents: isSignatureIntent is false for attack/heavy, true for hex/devour/mend/enrage',
      !Intents.isSignatureIntent({ type: 'attack' }) && !Intents.isSignatureIntent({ type: 'heavy' }) &&
      Intents.isSignatureIntent({ type: 'hex' }) && Intents.isSignatureIntent({ type: 'devour' }) &&
      Intents.isSignatureIntent({ type: 'mend' }) && Intents.isSignatureIntent({ type: 'enrage' }));

    // executeIntent: Hex locks a tile without removing it from the rack.
    {
      const Tiles = window.Wordbound.Tiles;
      const player = { rack: ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null)) };
      const monster = { name: 'Test Monster' };
      const before = player.rack.map((t) => t.id);
      const result = Intents.executeIntent({ type: 'hex' }, { player, monster, rng });
      check('monster intents: Hex returns a locked tile id from the current rack', before.indexOf(result.tileLockedId) !== -1);
      check('monster intents: Hex does not remove the locked tile from the rack', player.rack.length === 3 && JSON.stringify(player.rack.map((t) => t.id)) === JSON.stringify(before));
      check('monster intents: Hex deals zero damage', result.damage === 0);
    }

    // executeIntent: Devour eats a tile only when the player's word dealt
    // less than the threshold; at/above it, the lunge is thwarted and the
    // rack is untouched.
    {
      const Tiles = window.Wordbound.Tiles;
      const monster = { name: 'Test Monster' };
      const weakHitPlayer = { rack: ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null)) };
      const weakHitResult = Intents.executeIntent({ type: 'devour' }, { player: weakHitPlayer, monster, turnDamage: Intents.DEVOUR_DAMAGE_THRESHOLD - 1, rng });
      check('monster intents: Devour eats a tile when turn damage is below the threshold', weakHitPlayer.rack.length === 2 && !!weakHitResult.tileDevouredLetter);

      const strongHitPlayer = { rack: ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null)) };
      const strongHitResult = Intents.executeIntent({ type: 'devour' }, { player: strongHitPlayer, monster, turnDamage: Intents.DEVOUR_DAMAGE_THRESHOLD, rng });
      check('monster intents: Devour is thwarted (skips) when turn damage meets the threshold', strongHitPlayer.rack.length === 3 && strongHitResult.tileDevouredLetter === null && strongHitResult.damage === 0);
      check('monster intents: a successful Devour sets devourUsed', monster.devourUsed === true);
    }

    // GOALS.md balance ticket (2026-08-20 orchestrator decision): Devour had
    // no per-fight cap, so a long fight (esp. boss_unabridged/spinesplinter)
    // could eat the whole rack over enough turns. Once devourUsed is true,
    // rollIntent must stop offering 'devour' -- same guard pattern as Mend.
    {
      const boss = Monsters.createBoss('boss_unabridged'); // intents: ['hex', 'devour']
      boss.isBoss = true;
      const Tiles = window.Wordbound.Tiles;
      const player = { rack: ['C', 'A', 'T', 'S'].map((l) => Tiles.createTile(l, null)) };
      Intents.executeIntent({ type: 'devour' }, { player, monster: boss, turnDamage: 0, rng });
      check('monster intents: Devour eaten tile is only removed from the in-fight rack, not the persistent deck', player.rack.length === 3);
      let devourSeenAfterUse = false;
      for (let i = 0; i < 60; i++) {
        if (Intents.rollIntent(boss, rng).type === 'devour') devourSeenAfterUse = true;
      }
      check('monster intents: Devour is never re-telegraphed after it\'s already fired this fight (60/60)', !devourSeenAfterUse);
      check('monster intents: hex (the def\'s other signature) still rolls once Devour is used', (() => {
        for (let i = 0; i < 60; i++) {
          if (Intents.rollIntent(boss, rng).type === 'hex') return true;
        }
        return false;
      })());
    }

    // executeIntent: Mend heals a fixed % of max HP, once per fight.
    {
      const boss = Monsters.createBoss('boss_vowelmaw'); // intents: ['mend']
      boss.hp = 10;
      const expectedHeal = Math.round(boss.maxHp * Intents.MEND_HEAL_RATIO);
      const mendResult = Intents.executeIntent({ type: 'mend' }, { monster: boss });
      check('monster intents: Mend heals maxHp * MEND_HEAL_RATIO', boss.hp === 10 + expectedHeal && mendResult.healed === expectedHeal);
      check('monster intents: Mend sets mendUsed', boss.mendUsed === true);
      let mendSeenAfterUse = false;
      for (let i = 0; i < 60; i++) {
        if (Intents.rollIntent(boss, rng).type === 'mend') mendSeenAfterUse = true;
      }
      check('monster intents: Mend is never re-telegraphed after it\'s already fired this fight (60/60)', !mendSeenAfterUse);
    }

    // GOALS.md bug (2026-08-20 QA pass): a Mend firing close to max HP used
    // to report the raw ratio-derived amount instead of the actual
    // post-clamp gain -- assert the clamped case reports the SMALLER real
    // number, and that the no-clamp case still reports the full raw amount.
    {
      const boss = Monsters.createBoss('boss_vowelmaw'); // intents: ['mend']
      const rawHeal = Math.round(boss.maxHp * Intents.MEND_HEAL_RATIO);
      boss.hp = boss.maxHp - Math.floor(rawHeal / 2); // less headroom than the raw heal amount
      const clampedHealResult = Intents.executeIntent({ type: 'mend' }, { monster: boss });
      const expectedClampedHeal = boss.maxHp - (boss.maxHp - Math.floor(rawHeal / 2));
      check('monster intents: Mend reports the actual post-clamp heal, not the raw ratio amount', clampedHealResult.healed === expectedClampedHeal && clampedHealResult.healed < rawHeal);
      check('monster intents: Mend message number matches the clamped heal', clampedHealResult.message.indexOf('healing ' + expectedClampedHeal + ' HP') !== -1);
      check('monster intents: post-Mend hp is exactly maxHp (clamped)', boss.hp === boss.maxHp);
    }

    // executeIntent: Enrage permanently increases attack and stacks.
    {
      const boss = Monsters.createBoss('boss_sovereign'); // intents: ['enrage', 'hex']
      const baseAttack = boss.attack;
      Intents.executeIntent({ type: 'enrage' }, { monster: boss });
      Intents.executeIntent({ type: 'enrage' }, { monster: boss });
      check('monster intents: Enrage stacks (+ENRAGE_ATTACK_BONUS per use)', boss.attack === baseAttack + 2 * Intents.ENRAGE_ATTACK_BONUS);
      check('monster intents: Enrage tracks enrageStacks', boss.enrageStacks === 2);
    }

    // GOALS.md balance ticket (2026-08-20): Enrage had no cap, letting a
    // dragged-out fight (esp. boss_sovereign) stack it indefinitely for an
    // unbounded attack spiral. Once enrageStacks reaches ENRAGE_MAX_STACKS,
    // rollIntent must stop offering 'enrage' -- same once-fired guard
    // pattern as Mend's mendUsed, but a counted cap instead of a boolean.
    {
      const boss = Monsters.createBoss('boss_sovereign'); // intents: ['enrage', 'hex']
      for (let i = 0; i < Intents.ENRAGE_MAX_STACKS; i++) {
        Intents.executeIntent({ type: 'enrage' }, { monster: boss });
      }
      check('monster intents: enrageStacks reaches ENRAGE_MAX_STACKS after that many uses', boss.enrageStacks === Intents.ENRAGE_MAX_STACKS);
      let enrageSeenAfterCap = false;
      boss.isBoss = true;
      for (let i = 0; i < 60; i++) {
        if (Intents.rollIntent(boss, rng).type === 'enrage') enrageSeenAfterCap = true;
      }
      check('monster intents: Enrage is never re-telegraphed once enrageStacks hits the cap (60/60)', !enrageSeenAfterCap);
      check('monster intents: hex (the def\'s other signature) still rolls once Enrage is capped', (() => {
        for (let i = 0; i < 60; i++) {
          if (Intents.rollIntent(boss, rng).type === 'hex') return true;
        }
        return false;
      })());
    }
  }

  document.getElementById('btn-new-run').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  check('starting a run produces zero errors', errors.length === 0);

  // Verify character select screen is actually visible (not hidden by show() function)
  const screenCharSelect = document.getElementById('screen-character-select');
  check('screen-character-select is not hidden after "New Run" click', screenCharSelect && !screenCharSelect.classList.contains('hidden'));

  // Character select screen is now shown; click on the first character option
  const firstCharacter = document.querySelector('.character-option');
  if (firstCharacter) {
    firstCharacter.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
  }

  // Verify game-over and victory screens are hidden (should never be visible at this point)
  const screenGameOver = document.getElementById('screen-game-over');
  const screenVictory = document.getElementById('screen-victory');
  check('screen-game-over is hidden after run starts', screenGameOver && screenGameOver.classList.contains('hidden'));
  check('screen-victory is hidden after run starts', screenVictory && screenVictory.classList.contains('hidden'));

  const nodePill = document.querySelector('.node-pill.node-current');
  check('a clickable current node exists after starting a run', !!nodePill);
  if (nodePill) {
    nodePill.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
  }
  check('entering the first node produces zero errors', errors.length === 0);

  const state = window.Wordbound.Game._state;
  check('combat is active after entering a combat node', state.combatActive === true);
  check('rack has tiles', state.player.rack.length > 0);

  // review B4: the fight-start log line used to read "A The Consonant
  // Constrictor appears!" (a hardcoded 'A ' prefix in front of names that
  // already carry their own article, or none at all for "Quoth").
  const appearsMsg = state.messages.find((m) => /appears!$/.test(m));
  check('fight-start log line exists', !!appearsMsg);
  check('fight-start log line has no doubled/spurious article ("A " prefix removed)', !!appearsMsg && !/^A /.test(appearsMsg));
  check('fight-start log line is exactly "<monster name> appears!"', appearsMsg === state.monster.name + ' appears!');

  // CONTENT ticket (GOALS.md, 2026-08-21), onFloorAdvance wiring: confirm
  // Game._advanceFloor() (test-only exposure, see game.js) actually invokes
  // Items.runHook('onFloorAdvance', ...) and logs its message end to end,
  // not just that the isolated hook function does the right math (covered
  // separately below). Every field touched is saved and restored so this
  // in-progress fight continues unaffected; the word submitted just below
  // triggers its own render(), resyncing the DOM with the restored state.
  {
    const savedFloorNumber = state.floorNumber;
    const savedFloor = state.floor;
    const savedCurrentNodeId = state.currentNodeId;
    const savedMapPositionNodeId = state.mapPositionNodeId;
    const savedPathNodeIds = state.pathNodeIds;
    const savedRunStats = Object.assign({}, state.runStats);
    const savedItems = state.player.items;
    const savedGold = state.player.gold;
    const savedMaxInk = state.player.maxInk;
    const savedInk = state.player.ink;
    const savedMessagesLength = state.messages.length;

    state.player.items = ['acquisitions_budget'];
    state.player.gold = 15;
    window.Wordbound.Game._advanceFloor();

    check('onFloorAdvance wiring: advanceFloor spent 10-gold chunks via Acquisitions Budget (15 -> 5)', state.player.gold === 5);
    check('onFloorAdvance wiring: advanceFloor granted +2 max ink for the one chunk spent', state.player.maxInk === savedMaxInk + 2);
    check('onFloorAdvance wiring: the proc message was logged to state.messages', state.messages.slice(savedMessagesLength).some((m) => /Acquisitions Budget/.test(m)));

    state.floorNumber = savedFloorNumber;
    state.floor = savedFloor;
    state.currentNodeId = savedCurrentNodeId;
    state.mapPositionNodeId = savedMapPositionNodeId;
    state.pathNodeIds = savedPathNodeIds;
    state.runStats = savedRunStats;
    state.player.items = savedItems;
    state.player.gold = savedGold;
    state.player.maxInk = savedMaxInk;
    state.player.ink = savedInk;
  }

  // Find a playable word that will actually deal damage > 0 -- not just any
  // playable word. A monster's trait can legitimately zero out damage (e.g.
  // "vowelless" is immune unless the word has zero vowels), and submitting
  // one of those isn't a bug, it just makes this check meaningless. Predict
  // damage the same way Combat.playWord does before picking a word.
  const Lexicon = window.Wordbound.Lexicon;
  const Traits = window.Wordbound.Traits;
  const WORDLIST = window.Wordbound.WORDLIST;
  const hpRatio = state.monster.maxHp > 0 ? state.monster.hp / state.monster.maxHp : 0;
  const activeTraitId = Traits.activeTraitForHpRatio(state.monster.traitPhases, hpRatio);
  const trait = Traits.TRAITS[activeTraitId];

  // Monster intents (GOALS.md "FUN OVERHAUL 2/8"), live integration check:
  // force THIS in-progress fight's monster into elite mode with only Hex
  // available, submit a real (survivable, first-turn) word, and confirm the
  // telegraphed "Next: Hex" line matches what then actually happens -- a
  // tile gets locked, greyed out and disabled in the real rendered rack,
  // and clicking it is a no-op. Resets back to a neutral, non-elite state
  // afterward so it doesn't affect the checks below, which assume a plain
  // fight (Devour/Mend/Enrage are covered deterministically in the isolated
  // Intents unit tests above instead of here, since predicting a real
  // word's exact damage well enough to force those specific branches
  // through a live run would be unreliably precise).
  {
    let safeWord = null;
    for (let i = 0; i < WORDLIST.length; i++) {
      const w = WORDLIST[i];
      if (w.length < 2 || w.length > state.player.rack.length) continue;
      if (!Lexicon.isValidWord(w)) continue;
      const formed = Lexicon.canFormFromRack(w, state.player.rack);
      if (!formed.possible) continue;
      const score = Lexicon.scoreWord(w, formed.tilesUsed);
      const mult = trait ? trait.multiplier(w, formed.tilesUsed) : 1;
      if (Math.round(score.total * mult) < state.monster.hp) { safeWord = w; break; } // must not kill it
    }
    if (!safeWord) {
      console.log('SKIP monster-intent Hex integration check -- no survivable word found from this rack (unexpected)');
    } else {
      state.monster.isElite = true;
      state.monster.intents = ['hex'];
      state.monster.intent = { type: 'hex' };
      window.Wordbound.Game.openDeckViewer(); // forces a real re-render (existing test convention)
      window.Wordbound.Game.closeDeckViewer();

      const intentEl = document.getElementById('monster-intent');
      check('monster intent: Hex is telegraphed before it fires ("Next: Hex...")', !!intentEl && intentEl.textContent.indexOf('Hex') !== -1);

      document.getElementById('word-input').value = safeWord;
      document.getElementById('btn-submit-word').dispatchEvent(new window.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));

      check('monster intent: Hex turn produces zero errors', errors.length === 0);

      // FUN OVERHAUL 4/8 (GOALS.md, 2026-08-20) plumbing check, piggybacked
      // on this fight's first-ever word submission (this is the earliest
      // btn-submit-word click in this whole script): Game.submitWord should
      // have populated the new previousWord/wordsPlayedThisFight tracking
      // fields the new rule-changer items read from ctx. Item-specific
      // damage math is covered by isolated Combat.playWord + Items.runHook
      // checks further up (same pattern as the Foreword check) -- this only
      // proves the live game.js wiring feeds them correctly end to end.
      check('FUN OVERHAUL 4/8: wordsPlayedThisFightCount is 1 after the fight\'s first word', state.wordsPlayedThisFightCount === 1);
      check('FUN OVERHAUL 4/8: previousWordThisFight records the word just played', state.previousWordThisFight === safeWord.toUpperCase());

      check('monster intent: telegraphed Hex actually locked a tile', !!state.hexedTileId);
      const hexedTile = state.player.rack.find((t) => t.id === state.hexedTileId);
      check('monster intent: the locked tile is still in the rack (locked, not removed)', !!hexedTile);
      const hexedBtn = hexedTile && document.querySelector('[data-tile-id="' + hexedTile.id + '"]');
      check('monster intent: the locked tile\'s button is disabled in the rendered rack', !!hexedBtn && hexedBtn.disabled === true);
      check('monster intent: the locked tile\'s button has the tile-hexed class', !!hexedBtn && hexedBtn.className.indexOf('tile-hexed') !== -1);
      if (hexedBtn) {
        const selectedBefore = state.selectedTileIds.length;
        hexedBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
        check('monster intent: clicking the locked tile does not stage it', state.selectedTileIds.length === selectedBefore);
      }

      state.monster.isElite = false;
      state.monster.intents = [];
      state.hexedTileId = null;
      state.monster.intent = { type: 'attack', value: state.monster.attack || 0 };
      window.Wordbound.Game.openDeckViewer();
      window.Wordbound.Game.closeDeckViewer();
    }
  }

  // UX (review B5): clicking an already-staged rack tile should DESELECT it
  // instead of appending a second copy of its letter. Live-DOM check using
  // real clicks on the actual rendered rack buttons (not synthetic state
  // pokes), since this is exactly a click-handler/render-order bug class.
  {
    state.selectedTileIds = [];
    document.getElementById('word-input').value = '';
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();

    const rackButtons = () => Array.from(document.querySelectorAll('#rack-display .letter-tile'));
    // Blanks are a separate no-op case (checked below) -- exclude them here
    // so this check only exercises the toggle-select/deselect behavior.
    const nonBlankButtons = () => rackButtons().filter((b) => {
      const t = state.player.rack.find((rt) => rt.id === b.getAttribute('data-tile-id'));
      return t && t.letter !== '?';
    });

    // MOBILE INPUT 2/3: a staged tile now renders as an empty outlined slot
    // (.rack-slot-empty) in its rack position -- the tile visually "lives" in
    // the staging area below, and the rack keeps its shape. Unstaging happens
    // by tapping that empty slot OR the staged tile itself. These checks
    // replace the old .selected-class-on-the-rack-tile model.
    const emptySlot = (id) => document.querySelector('#rack-display .rack-slot-empty[data-tile-id="' + id + '"]');
    const stagedTileEl = (id) => document.querySelector('#staging-area .staged-tile[data-tile-id="' + id + '"]');
    let candidates = nonBlankButtons();
    if (candidates.length < 2) {
      console.log('SKIP tile-toggle checks -- fewer than 2 non-blank rack tiles (unexpected)');
    } else {
      const firstId = candidates[0].getAttribute('data-tile-id');
      candidates[0].dispatchEvent(new window.Event('click', { bubbles: true }));
      check('tile click: staging a tile appends its letter exactly once', document.getElementById('word-input').value.length === 1);
      check('tile click: selectedTileIds gains exactly the clicked tile', state.selectedTileIds.length === 1 && state.selectedTileIds[0] === firstId);
      check('mobile 2/3: staged tile leaves an empty rack slot (rack keeps shape)', !!emptySlot(firstId));
      check('mobile 2/3: the staged tile no longer renders as a .letter-tile in the rack',
        !rackButtons().some((b) => b.getAttribute('data-tile-id') === firstId));
      check('mobile 2/3: the staged tile appears in the staging area', !!stagedTileEl(firstId));

      // Unstage by clicking the empty rack slot.
      emptySlot(firstId).dispatchEvent(new window.Event('click', { bubbles: true }));
      check('mobile 2/3: clicking the empty slot unstages the tile (input empty)', document.getElementById('word-input').value === '');
      check('mobile 2/3: selectedTileIds is empty again', state.selectedTileIds.length === 0);
      check('mobile 2/3: the tile is a normal rack .letter-tile again after unstage',
        rackButtons().some((b) => b.getAttribute('data-tile-id') === firstId));
      check('mobile 2/3: no empty slot lingers after unstage', !emptySlot(firstId));

      // Unstage by tapping the staged tile itself (the other unstage path).
      let againBtn = rackButtons().find((b) => b.getAttribute('data-tile-id') === firstId);
      againBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      check('mobile 2/3: re-staged for the staged-tile-tap check', state.selectedTileIds.indexOf(firstId) !== -1 && !!stagedTileEl(firstId));
      stagedTileEl(firstId).dispatchEvent(new window.Event('click', { bubbles: true }));
      check('mobile 2/3: tapping the staged tile unstages it', state.selectedTileIds.indexOf(firstId) === -1);
      check('mobile 2/3: staging area no longer shows that tile', !stagedTileEl(firstId));

      candidates = nonBlankButtons();
      const tileAId = candidates[0].getAttribute('data-tile-id');
      const tileALetter = state.player.rack.find((t) => t.id === tileAId).letter;
      candidates[0].dispatchEvent(new window.Event('click', { bubbles: true }));
      candidates = nonBlankButtons();
      const tileBBtn = candidates.find((b) => b.getAttribute('data-tile-id') !== tileAId);
      const tileBId = tileBBtn.getAttribute('data-tile-id');
      const tileBLetter = state.player.rack.find((t) => t.id === tileBId).letter;
      tileBBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      check('tile click: two distinct tiles stage in click order', document.getElementById('word-input').value === tileALetter + tileBLetter);

      // Unstage the first of the two by clicking its empty slot.
      emptySlot(tileAId).dispatchEvent(new window.Event('click', { bubbles: true }));
      check('tile click: unstaging the first of two leaves only the second letter', document.getElementById('word-input').value === tileBLetter);
      check('tile click: selectedTileIds now holds only the second tile', state.selectedTileIds.length === 1 && state.selectedTileIds[0] === tileBId);

      state.selectedTileIds = [];
      document.getElementById('word-input').value = '';
      window.Wordbound.Game.openDeckViewer();
      window.Wordbound.Game.closeDeckViewer();

      // MOBILE INPUT 2/3 Phase 2: drag-reorder + drag-out-to-remove STATE LOGIC.
      // The pointer-event glue (ghost follow, gap, threshold) is browser-only and
      // can't run in jsdom (no real pointer events, getBoundingClientRect is 0),
      // so these exercise the pure mutations the glue calls on release:
      // Game._reorderStagedTile (spec 4) and unstageTile (spec 5's drag-out).
      state.selectedTileIds = [];
      document.getElementById('word-input').value = '';
      const Game = window.Wordbound.Game;
      let dragCands = nonBlankButtons();
      if (dragCands.length < 3) {
        console.log('SKIP staging drag-reorder checks -- fewer than 3 non-blank rack tiles');
      } else {
        const id0 = dragCands[0].getAttribute('data-tile-id');
        const id1 = dragCands[1].getAttribute('data-tile-id');
        const id2 = dragCands[2].getAttribute('data-tile-id');
        const L = (id) => state.player.rack.find((t) => t.id === id).letter;
        dragCands[0].dispatchEvent(new window.Event('click', { bubbles: true }));
        nonBlankButtons().find((b) => b.getAttribute('data-tile-id') === id1)
          .dispatchEvent(new window.Event('click', { bubbles: true }));
        nonBlankButtons().find((b) => b.getAttribute('data-tile-id') === id2)
          .dispatchEvent(new window.Event('click', { bubbles: true }));
        check('mobile 2/3 phase2: three tiles staged in order (baseline)',
          state.selectedTileIds.join(',') === [id0, id1, id2].join(',') &&
          Game._stagedWord() === L(id0) + L(id1) + L(id2));

        // Reorder to the END: insertion index === length appends. [0,1,2] with
        // id0 inserted at index 3 -> [1,2,0]. (Insertion-index semantics let a
        // tile reach the final slot, which the rack's drop-onto convention can't.)
        Game._reorderStagedTile(id0, 3);
        check('mobile 2/3 phase2: dragging tile 0 to the end (insert index len) moves it last',
          state.selectedTileIds.join(',') === [id1, id2, id0].join(','));
        check('mobile 2/3 phase2: reorder rebuilds the staged word from the new order',
          Game._stagedWord() === L(id1) + L(id2) + L(id0) &&
          document.getElementById('word-input').value === L(id1) + L(id2) + L(id0));
        check('mobile 2/3 phase2: reorder does not add or drop any tile',
          state.selectedTileIds.length === 3);
        check('mobile 2/3 phase2: staging area re-rendered all three tiles after reorder',
          !!stagedTileEl(id0) && !!stagedTileEl(id1) && !!stagedTileEl(id2));

        // Reorder backward: insert the (now-last) id0 at index 0 -> back to front.
        Game._reorderStagedTile(id0, 0);
        check('mobile 2/3 phase2: inserting a tile at index 0 moves it to the front',
          state.selectedTileIds.join(',') === [id0, id1, id2].join(','));

        // Reorder to the MIDDLE: insert id0 at index 2 of [0,1,2] -> [1,0,2].
        Game._reorderStagedTile(id0, 2);
        check('mobile 2/3 phase2: inserting a tile at a middle index lands it there',
          state.selectedTileIds.join(',') === [id1, id0, id2].join(','));
        Game._reorderStagedTile(id0, 0); // restore [0,1,2]
        check('mobile 2/3 phase2: restored to [0,1,2] for the no-op checks',
          state.selectedTileIds.join(',') === [id0, id1, id2].join(','));

        // No-op cases: inserting before/after its own slot, or null/unknown target.
        const snapshot = state.selectedTileIds.join(',');
        Game._reorderStagedTile(id1, 1); // before itself
        Game._reorderStagedTile(id1, 2); // right after itself -> same order
        Game._reorderStagedTile(id1, null);
        Game._reorderStagedTile('no-such-tile', 0);
        check('mobile 2/3 phase2: insert-in-place / null / unknown target are no-ops',
          state.selectedTileIds.join(',') === snapshot);

        // Drag-out-to-remove: the release path calls unstageTile when the pointer
        // ends outside the play area. Remove the middle tile that way.
        const beforeLen = state.selectedTileIds.length;
        const midId = state.selectedTileIds[1];
        // unstageTile isn't exposed by name, but the staged-tile tap uses it and a
        // drag-out release calls the same function -- exercise it via the tap path,
        // which is the documented single source of truth for unstaging.
        stagedTileEl(midId).dispatchEvent(new window.Event('click', { bubbles: true }));
        check('mobile 2/3 phase2: drag-out (unstage) removes exactly the target tile',
          state.selectedTileIds.length === beforeLen - 1 &&
          state.selectedTileIds.indexOf(midId) === -1);
        check('mobile 2/3 phase2: the two other tiles stay staged in order',
          state.selectedTileIds.join(',') === [id0, id2].join(','));

        // suppressNextStagingClick guard: a click while the flag is set is eaten
        // once (the synthesized post-drag click), then normal taps resume.
        state.suppressNextStagingClick = true;
        const keepLen = state.selectedTileIds.length;
        stagedTileEl(id0).dispatchEvent(new window.Event('click', { bubbles: true }));
        check('mobile 2/3 phase2: a suppressed click does NOT unstage (post-drag guard)',
          state.selectedTileIds.length === keepLen && state.suppressNextStagingClick === false);
        stagedTileEl(id0).dispatchEvent(new window.Event('click', { bubbles: true }));
        check('mobile 2/3 phase2: the next click unstages normally (guard cleared)',
          state.selectedTileIds.indexOf(id0) === -1);

        // ---- STUCK-DRAG interruption checks (Jaxon's real-iPhone playtest of
        // v0.28: a staged tile froze mid-drag, overlapping its neighbor).
        // jsdom has no real pointer/touch input and getBoundingClientRect is all
        // zeros, so these can't test the FEEL of a drag -- what they DO test is
        // the state machine and the DOM it leaves behind when a gesture is
        // terminated by something other than a clean pointerup, which is exactly
        // the class of bug that shipped. A pointer event is faked with MouseEvent
        // (jsdom supports clientX/clientY on it); pointerId is defined only where
        // a check needs two distinct pointers.
        const pev = (type, opts) => {
          const o = opts || {};
          const e = new window.MouseEvent(type, {
            bubbles: true, cancelable: true, clientX: o.clientX || 0, clientY: o.clientY || 0,
          });
          if (o.pointerId !== undefined) Object.defineProperty(e, 'pointerId', { value: o.pointerId });
          return e;
        };
        const bareEvent = (type) => new window.Event(type, { bubbles: true, cancelable: true });
        const restage = (ids) => {
          state.selectedTileIds = [];
          state.blankAssignments = {};
          document.getElementById('word-input').value = '';
          Game.openDeckViewer(); Game.closeDeckViewer(); // force a clean render
          ids.forEach((id) => {
            const b = document.querySelector('#rack-display .letter-tile[data-tile-id="' + id + '"]');
            if (b) b.dispatchEvent(new window.Event('click', { bubbles: true }));
          });
        };
        // No staged tile anywhere may be left lifted, shifted or ghosted, and the
        // container must not keep its grabbing-cursor class.
        const noDragArtifacts = () => {
          const tiles = Array.from(document.querySelectorAll('#staging-area .staged-tile'));
          const area = document.getElementById('staging-area');
          return !area.classList.contains('staging-dragging') && tiles.every((t) =>
            !t.classList.contains('staging-drag-ghost') &&
            !t.classList.contains('staging-drag-out') &&
            !t.style.transform);
        };
        const dragTo = (el, x, y) => {
          el.dispatchEvent(pev('pointerdown', { clientX: 0, clientY: 0 }));
          document.dispatchEvent(pev('pointermove', { clientX: x, clientY: y }));
        };

        // (a) touchcancel -- iOS Safari's "the browser took your gesture" event.
        restage([id0, id1, id2]);
        let dragEl = stagedTileEl(id0);
        dragTo(dragEl, 20, 0);
        check('stuck-drag: a pointerdown + past-threshold move starts a live drag with a lifted ghost',
          !!state.stagingDrag && dragEl.classList.contains('staging-drag-ghost') &&
          !!dragEl.style.transform);
        document.dispatchEvent(bareEvent('touchcancel'));
        check('stuck-drag: touchcancel mid-drag clears the drag state machine',
          !state.stagingDrag);
        check('stuck-drag: touchcancel mid-drag strips the ghost styling off the dragged element',
          !dragEl.style.transform && !dragEl.classList.contains('staging-drag-ghost'));
        check('stuck-drag: touchcancel mid-drag leaves NO drag artifacts in the play area',
          noDragArtifacts());
        check('stuck-drag: touchcancel loses no tiles (all three still staged)',
          state.selectedTileIds.length === 3);

        // (d) a second touch landing mid-drag -- the exact shape of Jaxon's
        // screenshot (one tile frozen on top of another). The stale drag is torn
        // down instead of being silently replaced by the new one.
        restage([id0, id1, id2]);
        dragEl = stagedTileEl(id0);
        dragTo(dragEl, 20, 0);
        const secondEl = stagedTileEl(id1);
        secondEl.dispatchEvent(pev('pointerdown', { clientX: 0, clientY: 0 }));
        check('stuck-drag: a second pointerdown mid-drag tears the stale drag down',
          !state.stagingDrag);
        check('stuck-drag: the interrupted tile is not left frozen over its neighbor',
          !dragEl.style.transform && !dragEl.classList.contains('staging-drag-ghost') &&
          noDragArtifacts());

        // (c) the pointer released away from the tile still ends the drag --
        // move/up are bound at the document level, so this works even though the
        // element that started the gesture never sees the release.
        restage([id0, id1, id2]);
        dragEl = stagedTileEl(id0);
        dragTo(dragEl, 20, 0);
        document.dispatchEvent(pev('pointerup', { clientX: 20, clientY: 0 }));
        check('stuck-drag: a pointerup dispatched away from the tile still ends the drag',
          !state.stagingDrag && noDragArtifacts());
        check('stuck-drag: ending a drag off-element keeps all three tiles staged',
          state.selectedTileIds.length === 3);

        // window blur -- app switch / incoming call, where iOS may fire nothing else.
        restage([id0, id1, id2]);
        dragEl = stagedTileEl(id0);
        dragTo(dragEl, 20, 0);
        window.dispatchEvent(new window.Event('blur'));
        check('stuck-drag: losing window focus mid-drag ends the drag cleanly',
          !state.stagingDrag && !dragEl.style.transform && noDragArtifacts());

        // A render fired mid-gesture (e.g. the killing-blow death beat) destroys
        // the element being dragged -- no pointerup can ever reach a detached
        // node, so render() itself has to drop the orphaned drag.
        restage([id0, id1, id2]);
        dragEl = stagedTileEl(id0);
        dragTo(dragEl, 20, 0);
        Game.openDeckViewer(); Game.closeDeckViewer(); // forces a full re-render
        check('stuck-drag: a re-render mid-drag drops the now-orphaned drag state',
          !state.stagingDrag);
        check('stuck-drag: no drag artifact survives that re-render', noDragArtifacts());
        document.dispatchEvent(pev('pointermove', { clientX: 60, clientY: 0 }));
        check('stuck-drag: a stray move after the orphan sweep transforms nothing',
          noDragArtifacts());

        // Multi-touch identity: a foreign pointer's release must not end (or
        // corrupt) the drag the first pointer owns.
        restage([id0, id1, id2]);
        dragEl = stagedTileEl(id0);
        dragEl.dispatchEvent(pev('pointerdown', { clientX: 0, clientY: 0, pointerId: 1 }));
        document.dispatchEvent(pev('pointermove', { clientX: 20, clientY: 0, pointerId: 1 }));
        document.dispatchEvent(pev('pointerup', { clientX: 90, clientY: 90, pointerId: 2 }));
        check('stuck-drag: another finger lifting does not end this pointer\'s drag',
          !!state.stagingDrag);
        document.dispatchEvent(pev('pointerup', { clientX: 20, clientY: 0, pointerId: 1 }));
        check('stuck-drag: the owning pointer\'s release does end it, cleanly',
          !state.stagingDrag && noDragArtifacts());

        // ---- DRAG-TO-RACK (Jaxon real-device playtest): dragging a staged
        // tile ONTO THE RACK unstages it (return-to-rack), even when the drop
        // point sits INSIDE the staging area's 30px drag-out tolerance. jsdom
        // rects are all-zero, so stub the rack's rect to a known box and drop
        // the pointer inside it at (10,10) -- a point pointerOutsideStaging
        // reads as INSIDE (|10| < 30), proving the RACK zone (not the generic
        // drag-out-of-staging path) is what routes to unstage here.
        restage([id0, id1, id2]);
        const rackForDrop = document.getElementById('rack-display');
        const origRackRect = rackForDrop.getBoundingClientRect;
        rackForDrop.getBoundingClientRect = () =>
          ({ left: 0, right: 100, top: 0, bottom: 50, width: 100, height: 50 });
        dragEl = stagedTileEl(id0);
        dragEl.dispatchEvent(pev('pointerdown', { clientX: 0, clientY: 0 }));
        document.dispatchEvent(pev('pointermove', { clientX: 10, clientY: 10 }));
        check('drag-to-rack: hovering a staged tile over the rack marks it as an unstage target (inside staging tolerance)',
          !!state.stagingDrag && state.stagingDrag.overRack === true && state.stagingDrag.outside === true);
        check('drag-to-rack: the rack shows the drop-target highlight while hovered',
          rackForDrop.classList.contains('rack-drop-target'));
        document.dispatchEvent(pev('pointerup', { clientX: 10, clientY: 10 }));
        check('drag-to-rack: releasing over the rack unstages exactly that tile (returns it to the rack)',
          !state.stagingDrag && state.selectedTileIds.indexOf(id0) === -1 && state.selectedTileIds.length === 2);
        check('drag-to-rack: after the drop the rack highlight is cleared and no drag artifacts remain',
          !document.getElementById('rack-display').classList.contains('rack-drop-target') && noDragArtifacts());
        rackForDrop.getBoundingClientRect = origRackRect;

        // The rack's own touch-reorder state machine has the same failure mode
        // (state-only -- no transforms -- but a live machine makes the NEXT tap
        // resolve as a phantom reorder).
        restage([]);
        const rackBtn = () => document.querySelector('#rack-display .letter-tile');
        const tev = (type, touches) => {
          const e = new window.Event(type, { bubbles: true, cancelable: true });
          Object.defineProperty(e, 'touches', { value: touches });
          Object.defineProperty(e, 'changedTouches', { value: touches });
          return e;
        };
        const rb = rackBtn();
        rb.dispatchEvent(tev('touchstart', [{ clientX: 5, identifier: 1 }]));
        check('stuck-drag/rack: touchstart begins a rack drag', state.draggedTileId !== null);
        rb.dispatchEvent(tev('touchmove', [{ clientX: 60, identifier: 1 }]));
        check('stuck-drag/rack: a past-threshold touchmove crosses the drag threshold',
          state.touchDragThresholdCrossed === true);
        const ownerTile = state.draggedTileId;
        rb.dispatchEvent(tev('touchstart', [{ clientX: 5, identifier: 2 }]));
        check('stuck-drag/rack: a second finger does not hijack the live drag',
          state.draggedTileId === ownerTile);
        rb.dispatchEvent(tev('touchcancel', []));
        check('stuck-drag/rack: touchcancel fully resets the rack drag state machine',
          state.draggedTileId === null && state.touchStartIndex === null &&
          state.touchCurrentIndex === null && state.touchStartX === null &&
          state.touchDragThresholdCrossed === false && state.touchIdentifier === null);

        // A real staging drag above set suppressNextStagingClick; clear it so a
        // later block's genuine unstage-by-tap isn't silently eaten.
        state.suppressNextStagingClick = false;
      }

      state.selectedTileIds = [];
      document.getElementById('word-input').value = '';
      window.Wordbound.Game.openDeckViewer();
      window.Wordbound.Game.closeDeckViewer();
    }

    // MOBILE INPUT 3/3 (GOALS.md): input-feel juice. jsdom can't measure the
    // animation itself (no layout, no compositor), so these assert the STATE
    // wiring the CSS keys off: the one-shot .tile-settle class (added for
    // exactly one render when a tile lands, then cleared) and the haptic tick's
    // feature-check + reduced-motion gate. The pressed :active scale and the
    // actual animation feel are CSS-only / real-browser (see PROGRESS.md).
    {
      const Game = window.Wordbound.Game;
      state.selectedTileIds = [];
      state.settleTileIds = [];
      document.getElementById('word-input').value = '';
      Game.openDeckViewer(); Game.closeDeckViewer();

      const rackBtns = () => Array.from(document.querySelectorAll('#rack-display .letter-tile'));
      const nb = () => rackBtns().filter((b) => {
        const t = state.player.rack.find((rt) => rt.id === b.getAttribute('data-tile-id'));
        return t && t.letter !== '?';
      });
      const cands = nb();
      if (cands.length < 1) {
        console.log('SKIP mobile 3/3 settle checks -- no non-blank rack tile');
      } else {
        const sid = cands[0].getAttribute('data-tile-id');
        cands[0].dispatchEvent(new window.Event('click', { bubbles: true })); // stage it
        const stagedEl = () => document.querySelector('#staging-area .staged-tile[data-tile-id="' + sid + '"]');
        check('mobile 3/3: a just-staged tile carries the one-shot .tile-settle class',
          !!stagedEl() && stagedEl().className.indexOf('tile-settle') !== -1);
        check('mobile 3/3: the settle set is cleared after the render that consumed it',
          state.settleTileIds.length === 0);
        Game.openDeckViewer(); Game.closeDeckViewer(); // force another render
        check('mobile 3/3: .tile-settle is gone on the next render (one-shot, not sticky)',
          !!stagedEl() && stagedEl().className.indexOf('tile-settle') === -1);

        // Unstage: the tile lands back in the rack and settles there once.
        stagedEl().dispatchEvent(new window.Event('click', { bubbles: true }));
        const rackEl = () => document.querySelector('#rack-display .letter-tile[data-tile-id="' + sid + '"]');
        check('mobile 3/3: an unstaged tile settles as it lands back in the rack',
          !!rackEl() && rackEl().className.indexOf('tile-settle') !== -1);
        Game.openDeckViewer(); Game.closeDeckViewer();
        check('mobile 3/3: rack settle is one-shot too (cleared next render)',
          !!rackEl() && rackEl().className.indexOf('tile-settle') === -1);
      }

      // Haptic tick: feature-checked (navigator.vibrate) + reduced-motion gated.
      const realMM = window.matchMedia;
      let vibrateCalls = 0;
      let hadVibrate = 'vibrate' in window.navigator;
      const realVibrate = window.navigator.vibrate;
      try {
        Object.defineProperty(window.navigator, 'vibrate', {
          configurable: true, writable: true, value: function () { vibrateCalls++; return true; },
        });
      } catch (e) { /* some environments lock navigator; skip below */ }
      const vibrateStubbed = typeof window.navigator.vibrate === 'function' && window.navigator.vibrate !== realVibrate;
      if (!vibrateStubbed) {
        console.log('SKIP mobile 3/3 haptic checks -- navigator.vibrate not stubbable here');
      } else {
        // Motion allowed -> tick fires.
        window.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
        vibrateCalls = 0;
        Game._hapticTick();
        check('mobile 3/3: haptic tick calls navigator.vibrate when motion is allowed', vibrateCalls === 1);
        // Reduced motion -> tick is suppressed (haptics included, per the ticket).
        window.matchMedia = (q) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
        vibrateCalls = 0;
        Game._hapticTick();
        check('mobile 3/3: haptic tick is suppressed under prefers-reduced-motion', vibrateCalls === 0);
        // Restore navigator.vibrate.
        try {
          if (hadVibrate) Object.defineProperty(window.navigator, 'vibrate', { configurable: true, writable: true, value: realVibrate });
          else delete window.navigator.vibrate;
        } catch (e) { /* best-effort */ }
      }
      window.matchMedia = realMM;

      state.selectedTileIds = [];
      state.settleTileIds = [];
      document.getElementById('word-input').value = '';
      Game.openDeckViewer(); Game.closeDeckViewer();
    }

    // A blank (?) tile has no letter to stage -- clicking it must be a true
    // no-op (review B5's second finding), not a visible-but-empty selection.
    const blankTile = { id: 'test-blank-tile-b5', letter: '?' };
    state.player.rack.push(blankTile);
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
    const blankBtn = document.querySelector('[data-tile-id="test-blank-tile-b5"]');
    check('blank tile renders in the rack for this check', !!blankBtn);
    if (blankBtn) {
      const inputBefore = document.getElementById('word-input').value;
      const selectedCountBefore = state.selectedTileIds.length;
      blankBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      check('blank tile click: word-input unchanged', document.getElementById('word-input').value === inputBefore);
      check('blank tile click: selectedTileIds unchanged', state.selectedTileIds.length === selectedCountBefore);
      const blankBtnAfter = document.querySelector('[data-tile-id="test-blank-tile-b5"]');
      check('blank tile click: never gets the selected class', !!blankBtnAfter && blankBtnAfter.className.indexOf('selected') === -1);
    }
    state.player.rack = state.player.rack.filter((t) => t.id !== 'test-blank-tile-b5');
    state.selectedTileIds = [];
    document.getElementById('word-input').value = '';
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
  }

  // MOBILE INPUT 1/3 (GOALS.md, Jaxon 2026-08-20): on coarse-pointer (touch)
  // devices there must be NO typing -- tapping tiles is the only input, and
  // .focus() must never fire on the (hidden) word-input (that's what pops the
  // soft keyboard). jsdom has no matchMedia, so it's mocked coarse here, then
  // Game.applyTouchModeFromMedia() re-derives the mode after boot. jsdom can't
  // compute display:none from the external stylesheet, so the input's actual
  // visual hiding is asserted in npm run test:mobile (real browser); here we
  // assert the body.touch-mode class the CSS keys off, plus every behavioral
  // consequence (no focus, staged-word submit source, blank picker). Restores
  // desktop mode at the end so the later checks (which assume typing) are
  // unaffected.
  {
    const Game = window.Wordbound.Game;
    const input = document.getElementById('word-input');
    const realMatchMedia = window.matchMedia;

    // Spy on focus() so we can prove it's never called in touch-mode.
    let focusCalls = 0;
    const realFocus = input.focus.bind(input);
    input.focus = function () { focusCalls++; return realFocus(); };

    // --- enter touch-mode ---
    window.matchMedia = (q) => ({
      matches: /coarse/.test(q), media: q,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    });
    Game.applyTouchModeFromMedia();
    check('mobile 1/3: state.touchMode is true under a coarse pointer', state.touchMode === true);
    check('mobile 1/3: <body> gets the touch-mode class', document.body.classList.contains('touch-mode'));
    check('mobile 1/3: How-to-Play blank tip switches to tap-first wording',
      /tap the blank/i.test(document.getElementById('howto-blank-tip').textContent));

    // clean staging slate
    state.selectedTileIds = [];
    state.blankAssignments = {};
    input.value = '';
    Game.openDeckViewer(); Game.closeDeckViewer();

    const rackBtns = () => Array.from(document.querySelectorAll('#rack-display .letter-tile'));
    const nonBlank = () => rackBtns().filter((b) => {
      const t = state.player.rack.find((rt) => rt.id === b.getAttribute('data-tile-id'));
      return t && t.letter !== '?' && t.id !== state.hexedTileId;
    });

    // --- tapping two rack tiles stages them WITHOUT focusing the input, and
    // clicking Play Word submits the STAGED word (not the hidden, empty input).
    // The real submitWord is stubbed to capture its argument, so this proves
    // the submit SOURCE (stagedWord vs input.value) without actually playing a
    // word -- which keeps the in-progress fight pristine for the later variant/
    // stats checks. (End-to-end submitWord damage is already covered elsewhere
    // via the input path; the only touch-specific concern is the source.) ---
    focusCalls = 0;
    let cand = nonBlank();
    if (cand.length < 2) {
      console.log('SKIP mobile-1/3 tap checks -- fewer than 2 non-blank rack tiles (unexpected)');
    } else {
      const aId = cand[0].getAttribute('data-tile-id');
      const aLetter = state.player.rack.find((t) => t.id === aId).letter;
      cand[0].dispatchEvent(new window.Event('click', { bubbles: true }));
      cand = nonBlank();
      const bBtn = cand.find((b) => b.getAttribute('data-tile-id') !== aId);
      const bLetter = state.player.rack.find((t) => t.id === bBtn.getAttribute('data-tile-id')).letter;
      bBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      check('mobile 1/3: tapping tiles in touch-mode stages them (2 selected)', state.selectedTileIds.length === 2);
      check('mobile 1/3: stagedWord() reflects the two tapped letters', Game._stagedWord() === aLetter + bLetter);
      check('mobile 1/3: no focus() call on the input while staging (soft keyboard suppressed)', focusCalls === 0);

      // Prove submit reads the staged word, not the input. Stub submitWord to
      // capture its argument; the input is deliberately given a DIFFERENT value
      // so a regression that read input.value would be caught.
      const realSubmit = Game.submitWord;
      let submittedWith = null;
      Game.submitWord = function (w) { submittedWith = w; };
      input.value = 'ZZZZ'; // would-be word if the handler wrongly read the input
      document.getElementById('btn-submit-word').dispatchEvent(new window.Event('click', { bubbles: true }));
      Game.submitWord = realSubmit;
      check('mobile 1/3: Play Word submitted the staged word, not the input value', submittedWith === aLetter + bLetter);
      check('mobile 1/3: submitting never focused the input', focusCalls === 0);

      state.selectedTileIds = [];
      input.value = '';
      Game.openDeckViewer(); Game.closeDeckViewer();
    }

    // --- blank letter picker: tap a blank -> picker opens -> pick -> staged as that letter ---
    state.selectedTileIds = [];
    state.blankAssignments = {};
    input.value = '';
    focusCalls = 0;
    const blank = { id: 'test-touch-blank', letter: '?' };
    state.player.rack.push(blank);
    Game.openDeckViewer(); Game.closeDeckViewer();
    const blankBtn = document.querySelector('[data-tile-id="test-touch-blank"]');
    check('mobile 1/3: a blank tile renders in the rack for the picker check', !!blankBtn);
    if (blankBtn) {
      blankBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      const overlay = document.getElementById('blank-picker-overlay');
      check('mobile 1/3: tapping a blank in touch-mode opens the letter picker', state.blankPickerOpen === true && overlay && !overlay.classList.contains('hidden'));
      check('mobile 1/3: the picker targets the tapped blank', state.blankPickerTileId === 'test-touch-blank');
      const gridBtns = Array.from(document.querySelectorAll('#blank-picker-grid .blank-picker-letter'));
      check('mobile 1/3: the picker renders a full A-Z grid (26 letters)', gridBtns.length === 26);
      const qBtn = gridBtns.find((b) => b.getAttribute('data-blank-letter') === 'Q');
      qBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      check('mobile 1/3: picking a letter closes the picker', state.blankPickerOpen === false);
      check('mobile 1/3: the blank is now staged', state.selectedTileIds.indexOf('test-touch-blank') !== -1);
      check('mobile 1/3: the blank was assigned the chosen letter', state.blankAssignments['test-touch-blank'] === 'Q');
      check('mobile 1/3: stagedWord() spells the chosen letter for the blank', Game._stagedWord() === 'Q');
      check('mobile 1/3: opening/using the picker never focused the input', focusCalls === 0);

      // tapping the staged blank again unstages it and forgets its letter
      const blankBtn2 = document.querySelector('[data-tile-id="test-touch-blank"]');
      blankBtn2.dispatchEvent(new window.Event('click', { bubbles: true }));
      check('mobile 1/3: tapping the staged blank unstages it', state.selectedTileIds.indexOf('test-touch-blank') === -1);
      check('mobile 1/3: unstaging the blank forgets its assigned letter', !('test-touch-blank' in state.blankAssignments));
    }
    state.player.rack = state.player.rack.filter((t) => t.id !== 'test-touch-blank');

    // --- Clear in touch-mode empties staging without focusing ---
    state.selectedTileIds = ['x'];
    state.blankAssignments = { x: 'A' };
    focusCalls = 0;
    document.getElementById('btn-clear-word').dispatchEvent(new window.Event('click', { bubbles: true }));
    check('mobile 1/3: Clear empties selectedTileIds in touch-mode', state.selectedTileIds.length === 0);
    check('mobile 1/3: Clear empties blankAssignments in touch-mode', Object.keys(state.blankAssignments).length === 0);
    check('mobile 1/3: Clear never focused the input in touch-mode', focusCalls === 0);

    // --- back to desktop: mode flips off, class removed, typing/focus return ---
    window.matchMedia = (q) => ({
      matches: false, media: q,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    });
    Game.applyTouchModeFromMedia();
    check('mobile 1/3: leaving coarse pointer clears touch-mode', state.touchMode === false);
    check('mobile 1/3: <body> loses the touch-mode class off touch', !document.body.classList.contains('touch-mode'));
    check('mobile 1/3: How-to-Play blank tip reverts to type-first wording',
      /just type/i.test(document.getElementById('howto-blank-tip').textContent));

    // restore harness state for the later (desktop-assuming) checks. This
    // block never plays a real word (submitWord is stubbed during the one
    // submit test), so there's no fight state to rewind -- only the input
    // spy, the matchMedia mock, and the transient staging need clearing.
    input.focus = realFocus;
    window.matchMedia = realMatchMedia;
    state.selectedTileIds = [];
    state.blankAssignments = {};
    input.value = '';
    Game.openDeckViewer(); Game.closeDeckViewer();
  }

  // Multi-phase boss traits (GOALS.md "FUN OVERHAUL 3/8"), live-DOM check:
  // force the in-progress fight's monster onto the Vowelmaw boss's 2-phase
  // traitPhases and confirm the rendered ".monster-weakness" text actually
  // flips when HP crosses the phase threshold. renderCombat recomputes the
  // active trait from hp ratio on every render (confirmed by reading the
  // code, not assumed) -- this proves that end to end in a real DOM rather
  // than only against Traits.activeTraitForHpRatio in isolation (see the
  // isolated boss-phase math check above). Restores the monster's real
  // traitPhases/hp afterward so it doesn't affect the checks below.
  {
    const Monsters = window.Wordbound.Monsters;
    const bossPhases = Monsters.BOSS_DEFS['boss_vowelmaw'].traitPhases;
    const originalTraitPhases = state.monster.traitPhases;
    const originalHp = state.monster.hp;
    const originalMaxHp = state.monster.maxHp;

    state.monster.traitPhases = bossPhases;
    state.monster.maxHp = 100;
    state.monster.hp = 100; // full HP -> phase 0
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
    let weaknessEl = document.querySelector('.monster-weakness');
    const phase0Hint = Traits.TRAITS[bossPhases[0].traitId].hint;
    const phase1Hint = Traits.TRAITS[bossPhases[1].traitId].hint;
    check('boss phases (live): full HP shows phase 0 weakness text', !!weaknessEl && weaknessEl.textContent.indexOf(phase0Hint) !== -1);

    state.monster.hp = 30; // 0.3 ratio, below the 0.5 threshold -> phase 1
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
    weaknessEl = document.querySelector('.monster-weakness');
    check('boss phases (live): below-threshold HP switches to phase 1 weakness text', !!weaknessEl && weaknessEl.textContent.indexOf(phase1Hint) !== -1);
    check('boss phases (live): the two phase hints are actually different text', phase0Hint !== phase1Hint);

    state.monster.traitPhases = originalTraitPhases;
    state.monster.hp = originalHp;
    state.monster.maxHp = originalMaxHp;
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
  }

  // FUN OVERHAUL 5/8 (GOALS.md, 2026-08-20), live-DOM check: the three
  // variant effects that are NOT part of word scoring -- Gilded's gold,
  // Vampiric's heal, and Volatile's crack -- all resolve inside the real
  // Game.submitWord against real player/fight state, so they can only be
  // proven here, not in the isolated Lexicon.scoreWord checks above. Forces
  // variants onto the specific rack tiles a known-playable word will consume
  // (rather than hoping a variant rolls naturally), plays that word for
  // real, and reads the resulting gold/ink/pile state back.
  //
  // Volatile's crack is a 25% roll, so state.rng.chance is temporarily
  // wrapped to force TRUE for exactly p === 0.25 and delegate every other
  // probability to the real seeded RNG -- deterministic without disabling
  // randomness wholesale. Confirmed by grep that 0.25 is the only in-fight
  // chance() probability (events use 0.5, floor gen 0.6, the shop tile 0.4,
  // and tiles.js's own 0.25 variant roll only runs on monster defeat, which
  // this survivable word deliberately avoids).
  let volatileTileRef = null;
  {
    const V = window.Wordbound.Tiles.VARIANTS;
    let variantWord = null, variantTiles = null;
    for (let i = 0; i < WORDLIST.length; i++) {
      const w = WORDLIST[i];
      if (w.length < 3 || w.length > state.player.rack.length) continue;
      if (!Lexicon.isValidWord(w)) continue;
      const formed = Lexicon.canFormFromRack(w, state.player.rack);
      if (!formed.possible) continue;
      // Distinct tile instances only -- the three variants below are assigned
      // to tilesUsed[0..2], which must be three different tiles for the
      // per-effect assertions to be independent of each other.
      const ids = new Set(formed.tilesUsed.map((t) => t.id));
      if (ids.size < 3) continue;
      const score = Lexicon.scoreWord(w, formed.tilesUsed);
      const mult = trait ? trait.multiplier(w, formed.tilesUsed) : 1;
      if (Math.round(score.total * mult) > 0) { variantWord = w; variantTiles = formed.tilesUsed; break; }
    }

    if (!variantWord) {
      console.log('SKIP variant live-DOM checks -- no damage-dealing 3+-distinct-tile word available from this rack (likely a trait immunity, not a bug)');
    } else {
      // The monster MUST survive this word: a kill would end the fight, roll
      // fresh reward tiles, and bump runStats.monstersDefeated, breaking both
      // these reads and the later stats checks. Predicting the damage closely
      // enough to guarantee that is unreliable (the forced Volatile tile
      // doubles its own letter after the estimate is taken, and the combo
      // multiplier compounds it), so the monster's HP is temporarily raised
      // out of reach and restored right after instead of guessed at.
      const survivalHp = state.monster.hp;
      const survivalMaxHp = state.monster.maxHp;
      state.monster.maxHp = 100000;
      state.monster.hp = 100000;

      variantTiles[0].variant = V.GILDED;
      variantTiles[1].variant = V.VAMPIRIC;
      variantTiles[2].variant = V.VOLATILE;
      volatileTileRef = variantTiles[2];
      // Give the heal somewhere to land -- at full ink, Vampiric's +1 clamps
      // to a no-op and the check would pass vacuously.
      state.player.ink = Math.max(1, state.player.maxInk - 5);
      const goldBefore = state.player.gold;
      const inkBefore = state.player.ink;

      window.Wordbound.Game.openDeckViewer(); // forces a real re-render (existing test convention)
      window.Wordbound.Game.closeDeckViewer();

      // Badges must actually reach the rendered rack -- a variant the player
      // can't see is a variant that doesn't exist as a decision.
      const gildedBtn = document.querySelector('[data-tile-id="' + variantTiles[0].id + '"]');
      check('variant badge: a Gilded rack tile renders with the variant-gilded class', !!gildedBtn && gildedBtn.className.indexOf('variant-gilded') !== -1);
      check('variant badge: a Gilded rack tile still carries has-bonus (shared glow hook)', !!gildedBtn && gildedBtn.className.indexOf('has-bonus') !== -1);
      check('variant badge: the rack tile\'s tooltip describes the variant', !!gildedBtn && gildedBtn.title.indexOf('Gilded') !== -1);
      const volatileBtn = document.querySelector('[data-tile-id="' + variantTiles[2].id + '"]');
      const volatileVal = Lexicon.LETTER_VALUES[variantTiles[2].letter] || 0;
      const volatileSub = volatileBtn && volatileBtn.querySelector('sub');
      check('variant badge: a Volatile rack tile shows its DOUBLED point value', !!volatileSub && volatileSub.textContent.trim() === String(volatileVal * 2));

      const origChance = state.rng.chance;
      state.rng.chance = function (p) { return p === 0.25 ? true : origChance.call(state.rng, p); };

      document.getElementById('word-input').value = variantWord;
      document.getElementById('btn-submit-word').dispatchEvent(new window.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));
      state.rng.chance = origChance;

      check('variant play: playing variant tiles produces zero errors', errors.length === 0);
      if (errors.length) errors.forEach((e) => console.log('  ERR:', e));

      check('Gilded tile (live): playing it granted exactly +2 gold', state.player.gold === goldBefore + 2);
      check('Gilded tile (live): the gold gain is logged', state.messages.some((m) => m.indexOf('Gilded tile') !== -1 && m.indexOf('+2 gold') !== -1));
      // The monster's counterattack lands in the same turn, so ink can't be
      // compared to inkBefore directly -- assert on the logged heal instead,
      // plus that ink never exceeded max (the clamp).
      check('Vampiric tile (live): the 1 ink heal is logged', state.messages.some((m) => m.indexOf('Vampiric tile') !== -1 && m.indexOf('healed 1 ink') !== -1));
      check('Vampiric tile (live): heal stayed clamped at max ink', state.player.ink <= state.player.maxInk);
      check('Vampiric tile (live): test setup left real headroom to heal into', inkBefore < state.player.maxInk);

      check('Volatile tile (live): the forced 25% roll cracked the tile', volatileTileRef.crackedThisFight === true);
      check('Volatile tile (live): the crack is logged', state.messages.some((m) => m.indexOf('Volatile tile cracks') !== -1));
      // "Unusable for the rest of the fight" == absent from BOTH piles, so no
      // reshuffle can deal it back. The rack is rebuilt from the draw pile,
      // so being out of the piles is what keeps it out of the rack.
      const inDraw = state.pile.drawPile.some((t) => t.id === volatileTileRef.id);
      const inDiscard = state.pile.discardPile.some((t) => t.id === volatileTileRef.id);
      const inRack = state.player.rack.some((t) => t.id === volatileTileRef.id);
      check('Volatile tile (live): a cracked tile is not in the draw pile', !inDraw);
      check('Volatile tile (live): a cracked tile is not in the discard pile (cannot reshuffle back)', !inDiscard);
      check('Volatile tile (live): a cracked tile is not in the rack', !inRack);
      check('Volatile tile (live): the cracked tile is still in the persistent deck (fight-scoped, not destroyed)', state.deck.some((t) => t.id === volatileTileRef.id));

      // The Gilded/Vampiric tiles were consumed by the word and are NOT
      // cracked, so they must have gone to the discard pile normally --
      // proves cycleRackAfterWord's crack filter is precise, not a blanket
      // "drop everything played this turn."
      const gildedRecycled = state.pile.discardPile.some((t) => t.id === variantTiles[0].id) || state.pile.drawPile.some((t) => t.id === variantTiles[0].id) || state.player.rack.some((t) => t.id === variantTiles[0].id);
      check('variant play: an uncracked played tile still recycles normally', gildedRecycled);

      // Leave the fight in a clean state for the checks below: strip the
      // forced variants off any of these tiles still in play (the cracked
      // one keeps its flag on purpose -- the next-fight reset is asserted at
      // the very end of this script).
      variantTiles[0].variant = null;
      variantTiles[1].variant = null;
      state.monster.maxHp = survivalMaxHp;
      state.monster.hp = survivalHp;
      window.Wordbound.Game.openDeckViewer();
      window.Wordbound.Game.closeDeckViewer();
    }
  }

  let word = null;
  for (let i = 0; i < WORDLIST.length; i++) {
    const w = WORDLIST[i];
    if (w.length < 2 || w.length > state.player.rack.length) continue;
    if (!Lexicon.isValidWord(w)) continue;
    const formed = Lexicon.canFormFromRack(w, state.player.rack);
    if (!formed.possible) continue;
    const score = Lexicon.scoreWord(w, formed.tilesUsed);
    const mult = trait ? trait.multiplier(w, formed.tilesUsed) : 1;
    if (Math.round(score.total * mult) > 0) { word = w; break; }
  }
  if (!word) {
    // Not a bug: some monster traits (e.g. vowelless/"The Consonant") are
    // legitimately immune to whatever the starting 7-tile rack can form.
    // The rack still cycles on any valid play regardless of damage dealt,
    // so this isn't a softlock -- just an unlucky draw for this test run.
    // Skip the damage-specific checks rather than falsely failing them.
    console.log('SKIP damage checks -- no damage-dealing word possible against ' + state.monster.name + ' from this starting rack (likely a legitimate trait immunity, not a bug -- rerun if you want to double check)');
  } else {
    const before = { monsterHp: state.monster.hp, playerInk: state.player.ink, rackIds: state.player.rack.map((t) => t.id) };

    // Staged-word damage preview (GOALS.md FEATURE), live end-to-end check:
    // type the word into the real input, fire the same 'input' event the
    // browser would, and read the number the #damage-preview element actually
    // shows -- then submit and confirm that previewed number equals the HP the
    // monster ACTUALLY lost. This is the anti-drift guarantee end to end,
    // through the real game.js updateDamagePreview -> Combat.previewWord path
    // and the real DOM element, not just the isolated unit checks above.
    const previewEl = document.getElementById('damage-preview');
    check('damage-preview element exists (matches the id game.js looks up)', !!previewEl);
    document.getElementById('word-input').value = word;
    document.getElementById('word-input').dispatchEvent(new window.Event('input', { bubbles: true }));
    const previewText = previewEl ? previewEl.textContent : '';
    const previewNum = parseInt((previewText.match(/(\d+)/) || [])[1], 10);
    // Pre-existing test bug found while verifying an unrelated task (2026-08-20):
    // this used to also require previewText.indexOf('--') === -1, but the preview
    // legitimately appends " -- weak point!" / " -- repeat (x0.4)" suffixes
    // (game.js updateDamagePreview) whenever the auto-selected word happens to hit
    // the monster's weakness or repeat a word -- neither is the neutral "--" state
    // (that uses the distinct .preview-empty class, checked below instead), so the
    // old substring check spuriously failed on a real number about 1 in 3 runs
    // depending on which word/monster the test's own scan happened to land on.
    check('damage-preview shows a number for a valid staged word (not neutral)', !isNaN(previewNum) && previewEl.className.indexOf('preview-empty') === -1);

    document.getElementById('btn-submit-word').dispatchEvent(new window.Event('click', { bubbles: true }));
    // Rack cycling, the counterattack, and damage animations are deferred by
    // TILE_PLAY_ANIM_MS (game.js) so the tile-play animation is actually visible
    // before the rack redraws -- wait past that, not just past the click handler.
    await new Promise((r) => setTimeout(r, 300));

    check('playing a damage-dealing word produces zero errors', errors.length === 0);
    if (errors.length) errors.forEach((e) => console.log('  ERR:', e));

    const after = { monsterHp: state.monster.hp, playerInk: state.player.ink, rackIds: state.player.rack.map((t) => t.id) };
    check('monster HP decreased', after.monsterHp < before.monsterHp);
    // The previewed number must equal the damage actually dealt. Only assert
    // when the monster SURVIVED -- a killing blow clamps the HP drop at the
    // monster's remaining HP while the preview reports the full (unclamped)
    // damage, so the two legitimately differ on a kill. Preview correctness on
    // a kill is covered by the isolated unit checks above (same formula).
    if (after.monsterHp > 0) {
      check('damage-preview number equals the damage actually dealt on submit', !isNaN(previewNum) && previewNum === (before.monsterHp - after.monsterHp));
    } else {
      console.log('SKIP live preview-equals-dealt check -- the chosen word killed the monster (drop is HP-clamped; preview reports full damage, covered by isolated checks)');
    }
    check('rack cycled (discard + redraw ran)', JSON.stringify(before.rackIds) !== JSON.stringify(after.rackIds));
    check('a damage-number element appeared and was still present right after the hit', document.querySelectorAll('.damage-number').length > 0);
    const hpFill = document.getElementById('monster-hp-fill');
    check('monster-hp-fill element exists (matches the id game.js looks up)', !!hpFill);
    if (hpFill) check('monster-hp-fill got the flash-damage class', hpFill.className.indexOf('flash-damage') !== -1);
  }

  // Killing-blow feedback (review B3/F1): force the monster down to a sliver
  // of HP so the next damage-dealing word is a killing blow, and confirm the
  // death path still shows a damage number + HP-bar flash during its beat
  // instead of hard-cutting straight to the tile-reward screen.
  if (state.combatActive) {
    const hpRatio2 = state.monster.maxHp > 0 ? state.monster.hp / state.monster.maxHp : 0;
    const activeTraitId2 = Traits.activeTraitForHpRatio(state.monster.traitPhases, hpRatio2);
    const trait2 = Traits.TRAITS[activeTraitId2];
    let killWord = null;
    for (let i = 0; i < WORDLIST.length; i++) {
      const w = WORDLIST[i];
      if (w.length < 2 || w.length > state.player.rack.length) continue;
      if (!Lexicon.isValidWord(w)) continue;
      const formed = Lexicon.canFormFromRack(w, state.player.rack);
      if (!formed.possible) continue;
      const score = Lexicon.scoreWord(w, formed.tilesUsed);
      const mult = trait2 ? trait2.multiplier(w, formed.tilesUsed) : 1;
      if (Math.round(score.total * mult) > 0) { killWord = w; break; }
    }
    if (!killWord) {
      console.log('SKIP kill-blow-feedback checks -- no damage-dealing word possible from this rack (likely a trait immunity, not a bug)');
    } else {
      state.monster.hp = 1; // force this word to be a killing blow
      document.getElementById('word-input').value = killWord;
      document.getElementById('btn-submit-word').dispatchEvent(new window.Event('click', { bubbles: true }));
      // TILE_PLAY_ANIM_MS (220ms) defers processing; check partway into the
      // MONSTER_DEATH_BEAT_MS (500ms) beat that follows -- proves the
      // feedback actually renders and is visible, not just that the game
      // eventually reaches the reward screen afterward.
      await new Promise((r) => setTimeout(r, 400));
      check('killing blow produces zero errors', errors.length === 0);
      if (errors.length) errors.forEach((e) => console.log('  ERR:', e));
      check('killing blow: a damage-number element appeared during the death beat', document.querySelectorAll('.damage-number').length > 0);
      const hpFillAfterKill = document.getElementById('monster-hp-fill');
      check('killing blow: monster-hp-fill still exists during the death beat', !!hpFillAfterKill);
      if (hpFillAfterKill) check('killing blow: monster-hp-fill got the flash-damage class', hpFillAfterKill.className.indexOf('flash-damage') !== -1);
      check('killing blow: still on the combat screen mid-beat (no hard cut yet)', state.screen === 'RUN' && state.combatActive === true);
      const monsterInfoDuringBeat = document.getElementById('monster-info');
      check('killing blow: monster-info panel got the death-beat fade class', !!monsterInfoDuringBeat && monsterInfoDuringBeat.className.indexOf('monster-defeated') !== -1);

      await new Promise((r) => setTimeout(r, 500)); // past MONSTER_DEATH_BEAT_MS (500ms)
      check('killing blow: tile-reward screen arrives after the death beat', state.screen === 'TILE_REWARD');

      // Tile-reward restyle (GOALS.md POLISH review F4.5): choices should
      // render as letter-tile-shaped buttons (big letter + point-value sub,
      // bonus text underneath), not the old full-width text bars.
      if (state.screen === 'TILE_REWARD') {
        const tileChoiceButtons = Array.from(document.querySelectorAll('#tile-reward-choices .treasure-choice-tile'));
        check('tile reward: one .treasure-choice-tile button per offered option', tileChoiceButtons.length === (state.tileRewardOptions || []).length && tileChoiceButtons.length > 0);
        const firstLetterEl = tileChoiceButtons[0] && tileChoiceButtons[0].querySelector('.tile-reward-letter');
        check('tile reward: choice button contains a .tile-reward-letter element', !!firstLetterEl);
        const firstSub = firstLetterEl && firstLetterEl.querySelector('sub');
        check('tile reward: .tile-reward-letter has a point-value <sub>', !!firstSub && firstSub.textContent.trim() !== '');
        const deckSizeBefore = state.deck.length;
        tileChoiceButtons[0].dispatchEvent(new window.Event('click', { bubbles: true }));
        check('tile reward: clicking a tile choice adds it to the deck', state.deck.length === deckSizeBefore + 1);
        check('tile reward: picking a tile resolves off the TILE_REWARD screen', state.screen !== 'TILE_REWARD');
      }
    }
  }

  // End-of-run stats (GOALS.md review N6): submitWord/onMonsterDefeated
  // bookkeeping (state.runStats), and the stats block rendered on the
  // game-over/victory screens. By this point in the script at least one
  // word has been played and the one monster on this run has been killed
  // (tile-reward flow above), so these should all be populated.
  {
    const rs = state.runStats;
    check('run stats: wordsPlayed tracked the words submitted so far', !!rs && rs.wordsPlayed > 0);
    check('run stats: totalDamage tracked and positive', !!rs && rs.totalDamage > 0);
    check('run stats: bestWord recorded a word', !!rs && typeof rs.bestWord === 'string' && rs.bestWord.length > 0);
    check('run stats: bestWordDamage is positive and no more than totalDamage', !!rs && rs.bestWordDamage > 0 && rs.bestWordDamage <= rs.totalDamage);
    check('run stats: monstersDefeated incremented for the one kill so far', !!rs && rs.monstersDefeated === 1);
    check('run stats: goldEarned tracked from the kill\'s gold drop', !!rs && rs.goldEarned > 0);

    // Force the game-over/victory screens to render with these stats and
    // confirm the new stats block actually displays them, not just that
    // the underlying state updated.
    const savedScreen = state.screen;
    state.screen = 'GAME_OVER';
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
    const gameOverStatsBlock = document.getElementById('game-over-run-stats');
    check('game-over stats block rendered with rows', !!gameOverStatsBlock && gameOverStatsBlock.children.length > 0);
    check('game-over stats block shows the words-spelled count', !!gameOverStatsBlock && gameOverStatsBlock.textContent.indexOf(String(rs.wordsPlayed)) !== -1);
    check('game-over stats block shows the best word', !!gameOverStatsBlock && gameOverStatsBlock.textContent.indexOf(rs.bestWord) !== -1);
    check('game-over stats block has a Loose Words Defeated row', !!gameOverStatsBlock && gameOverStatsBlock.textContent.indexOf('Loose Words Defeated') !== -1);

    state.screen = 'VICTORY';
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
    const victoryStatsBlock = document.getElementById('victory-run-stats');
    check('victory stats block rendered with rows', !!victoryStatsBlock && victoryStatsBlock.children.length > 0);
    check('victory stats block has a Gold Earned row', !!victoryStatsBlock && victoryStatsBlock.textContent.indexOf('Gold Earned') !== -1);

    state.screen = savedScreen;
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
  }

  // Cleanup ticket (GOALS.md review B6, item 2): Game.useConsumable now
  // checks whether the monster died from a consumable's effect and routes
  // through the same onMonsterDefeated path submitWord uses, instead of
  // just re-rendering onto an already-dead monster. No shipped consumable
  // deals direct monster damage today, so this force-registers a
  // throwaway test-only consumable that does, to actually exercise the
  // guard rather than leave it unverified.
  {
    const Consumables = window.Wordbound.Consumables;
    const savedCombatActive = state.combatActive;
    const savedMonsterHp = state.monster.hp;
    const savedScreen2 = state.screen;
    const savedConsumables = state.player.consumables.slice();
    // BRANCHING MAP (GOALS.md, run 2/N): the previous combat's tile-reward
    // pick already resolved the map back to state.currentNodeId === null
    // (see advanceMapPosition in game.js) -- this block forces combatActive
    // directly rather than going through a real enterCurrentNode, so it
    // needs its own "current node" for onMonsterDefeated's currentNode()
    // lookup to have something to mark cleared, same pattern every other
    // synthetic-node block in this file uses.
    const lethalStrikeNode = { id: '_test-lethal-strike-node', type: 'combat', defId: state.monster.defId, cleared: false };
    state.floor.nodes.push(lethalStrikeNode);
    const savedCurrentNodeId2 = state.currentNodeId;
    state.currentNodeId = lethalStrikeNode.id;

    Consumables.CONSUMABLE_DEFS['_test_lethal_strike'] = {
      id: '_test_lethal_strike',
      name: 'Test Lethal Strike',
      hint: 'test-only, not a real consumable',
      rarity: 'common',
      effect: function (ctx) {
        ctx.monster.hp = 0;
        return { message: 'Test Lethal Strike used.' };
      }
    };

    state.combatActive = true;
    state.monster.hp = 1;
    state.screen = 'RUN';
    state.player.consumables.push('_test_lethal_strike');

    window.Wordbound.Game.useConsumable('_test_lethal_strike');

    check('useConsumable death guard: killing the monster via a consumable routes to TILE_REWARD (not left rendering a dead monster)', state.screen === 'TILE_REWARD');
    check('useConsumable death guard: combat is no longer active', state.combatActive === false);

    delete Consumables.CONSUMABLE_DEFS['_test_lethal_strike'];
    state.combatActive = savedCombatActive;
    state.monster.hp = savedMonsterHp;
    state.screen = savedScreen2;
    state.player.consumables = savedConsumables;
    state.currentNodeId = savedCurrentNodeId2;
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
  }

  // BALANCE (shop consumable odds): FUN OVERHAUL 4/8's eight new items grew the
  // item pool from 15 to 23 against a fixed 3 consumables, so a uniform
  // 4-of-26 draw left most shops with no consumable at all. rollShopOptions now
  // pins one slot to the consumable pool. 50 seeded rolls, each must contain
  // >= 1 consumable ('c:'-prefixed id), and the result must still be 4 distinct
  // string ids (the flat-string-array contract every consumer relies on).
  {
    const savedRng = state.rng;
    const savedItems = state.player.items;
    let allHaveConsumable = true;
    let allFourDistinctStrings = true;
    let sawANonConsumable = false;
    const firstSlotConsumableCount = [];

    state.player.items = [];
    for (let i = 0; i < 50; i++) {
      state.rng = window.Game.RNG.create('shop-odds-' + i);
      const opts = window.Wordbound.Game._rollShopOptions();
      const consumables = opts.filter((id) => typeof id === 'string' && id.indexOf('c:') === 0);
      if (consumables.length < 1) allHaveConsumable = false;
      if (opts.length !== 4 || !opts.every((id) => typeof id === 'string') || new Set(opts).size !== opts.length) {
        allFourDistinctStrings = false;
      }
      if (opts.some((id) => id.indexOf('c:') !== 0)) sawANonConsumable = true;
      firstSlotConsumableCount.push(opts[0].indexOf('c:') === 0 ? 1 : 0);
    }

    check('shop consumable odds: all 50 seeded shop rolls contain at least one consumable', allHaveConsumable);
    check('shop consumable odds: every roll is still 4 distinct string ids', allFourDistinctStrings);
    check('shop consumable odds: rolls still offer non-consumable items too', sawANonConsumable);
    // The pinned consumable must not always land in slot 0 -- the final shuffle
    // exists so the guaranteed slot isn't a visually predictable first row.
    const pinnedFirstCount = firstSlotConsumableCount.reduce((a, b) => a + b, 0);
    check('shop consumable odds: the guaranteed consumable is not always the first row (final shuffle applied)', pinnedFirstCount > 0 && pinnedFirstCount < 50);

    // Determinism: the same seed must produce the same shop, seeded runs depend on it.
    state.rng = window.Game.RNG.create('shop-odds-determinism');
    const rollA = window.Wordbound.Game._rollShopOptions();
    state.rng = window.Game.RNG.create('shop-odds-determinism');
    const rollB = window.Wordbound.Game._rollShopOptions();
    check('shop consumable odds: the same seed produces an identical shop roll', rollA.join(',') === rollB.join(','));

    state.rng = savedRng;
    state.player.items = savedItems;
  }

  // CONTENT ticket (GOALS.md, 2026-08-21): confirm all 9 new items actually
  // surface in shop rolls (they're drawn automatically from
  // Items.ITEM_DEFS, no separate pool-registration step -- this is the
  // check that proves that's really true rather than assumed). 300 seeded
  // rolls with an empty owned-items list is comfortably enough samples for
  // even the rarest (single-legendary) new item to appear at least once.
  {
    const savedRng = state.rng;
    const savedItems = state.player.items;
    const NEW_ITEM_IDS = [
      'card_catalog_key', 'bookplate', 'ex_libris', 'late_fee',
      'interlibrary_loan', 'withdrawal_slip', 'colophon', 'bound_volume',
      'acquisitions_budget'
    ];
    const seen = new Set();

    state.player.items = [];
    for (let i = 0; i < 300; i++) {
      state.rng = window.Game.RNG.create('content-ticket-shop-odds-' + i);
      window.Wordbound.Game._rollShopOptions().forEach((id) => seen.add(id));
    }

    NEW_ITEM_IDS.forEach((id) => {
      check('CONTENT ticket item "' + id + '" appears in shop rolls across 300 seeded samples', seen.has(id));
    });

    state.rng = savedRng;
    state.player.items = savedItems;
  }

  // FUN OVERHAUL 5/8: the shop's premium variant-tile offer. It lives in its
  // own state field (state.shopTileOffer, a Tile object) rather than in
  // shopOptions -- which stays a flat array of string ids so every consumer
  // of that array (renderShop's item loop, the balance sim's shopping bot)
  // can keep assuming strings. renderShop and Game.buyShopTile both read the
  // separate field; forced here so both are exercised every run.
  {
    const savedScreen = state.screen;
    const savedShopOptions = state.shopOptions;
    const savedShopTileOffer = state.shopTileOffer;
    const savedGold = state.player.gold;
    const savedCombatActive = state.combatActive;

    const premiumTile = window.Wordbound.Tiles.rollVariantTile(state.rng);
    state.combatActive = false;
    state.screen = 'SHOP';
    // A normal (string-id) shop list alongside the tile, to prove the two
    // render together and the item loop never chokes on the tile object.
    state.shopOptions = state.shopOptions && state.shopOptions.length ? state.shopOptions : ['thick_skin'];
    state.shopTileOffer = premiumTile;
    state.player.gold = 100;
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();

    const shopButtons = Array.from(document.querySelectorAll('#treasure-choices .treasure-choice'));
    const tileButton = shopButtons.find((b) => b.textContent.indexOf('Premium Tile') !== -1);
    check('shop variant tile: the premium tile offer renders as a shop row', !!tileButton);
    check('shop variant tile: the row is not disabled when affordable', !!tileButton && tileButton.disabled === false);
    check('shop variant tile: the row names what the variant does', !!tileButton && tileButton.textContent.indexOf(window.Wordbound.Tiles.describeVariant(premiumTile.variant)) !== -1);
    check('shop variant tile: the row carries the variant accent class', !!tileButton && tileButton.className.indexOf('variant-' + premiumTile.variant) !== -1);
    check('shop variant tile: the string-id item rows still render alongside it', shopButtons.some((b) => b.textContent.indexOf('Premium Tile') === -1));

    if (tileButton) {
      const deckBefore = state.deck.length;
      tileButton.dispatchEvent(new window.Event('click', { bubbles: true }));
      check('shop variant tile: buying it produces zero errors', errors.length === 0);
      check('shop variant tile: the bought tile lands in the deck', state.deck.length === deckBefore + 1 && state.deck.some((t) => t.id === premiumTile.id));
      check('shop variant tile: gold was deducted (45)', state.player.gold === 55);
      check('shop variant tile: the sold tile is cleared/re-rolled off the offer', state.shopTileOffer === null || state.shopTileOffer.id !== premiumTile.id);
    }

    // Cannot afford: the row must render disabled rather than allow a
    // negative-gold purchase.
    state.player.gold = 5;
    state.shopTileOffer = premiumTile;
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
    const poorButton = Array.from(document.querySelectorAll('#treasure-choices .treasure-choice')).find((b) => b.textContent.indexOf('Premium Tile') !== -1);
    check('shop variant tile: the row is disabled when the player cannot afford it', !!poorButton && poorButton.disabled === true);

    state.screen = savedScreen;
    state.shopOptions = savedShopOptions;
    state.shopTileOffer = savedShopTileOffer;
    state.player.gold = savedGold;
    state.combatActive = savedCombatActive;
    state.deck = state.deck.filter((t) => t.id !== premiumTile.id);
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
  }

  // FUN OVERHAUL 5/8, second half of the Volatile contract: a cracked tile is
  // gone for the rest of THAT fight only, and comes back for the next one.
  // Driven through a real second combat (Game.enterCurrentNode on the next
  // combat node) rather than by calling the reset directly, since startCombat
  // is module-private and the whole point is that the reset actually happens
  // on the real fight-start path. Runs last because it starts a new fight and
  // therefore replaces the monster/rack every check above depends on.
  if (volatileTileRef) {
    check('Volatile tile: still flagged cracked before the next fight begins', volatileTileRef.crackedThisFight === true);
    // Must be an UNCLEARED combat/elite node -- Game.enterCurrentNode returns
    // early on a cleared one, and an event earlier in the run may have armed
    // pendingEventSkipNextCombat, which would skip the fight instead of
    // starting it. Both make the reset silently not run.
    const nodes = (state.floor && state.floor.nodes) || [];
    const nextCombatIndex = nodes.findIndex((n) => !n.cleared && (n.type === 'combat' || n.type === 'elite'));
    if (nextCombatIndex === -1) {
      console.log('SKIP volatile next-fight-reset check -- no uncleared combat node left on this floor (layout-dependent, not a bug)');
    } else {
      state.currentNodeId = nodes[nextCombatIndex].id;
      state.screen = 'RUN';
      state.combatActive = false;
      state.pendingEventSkipNextCombat = false;
      window.Wordbound.Game.enterCurrentNode();
      await new Promise((r) => setTimeout(r, 100));
      check('volatile next-fight reset: entering a new combat node produces zero errors', errors.length === 0);
      check('volatile next-fight reset: a second fight actually started', state.combatActive === true);
      check('volatile next-fight reset: the cracked tile is usable again (flag cleared at fight start)', volatileTileRef.crackedThisFight === false);
      check('volatile next-fight reset: the tile is back in the new fight\'s draw pile or rack', state.pile.drawPile.some((t) => t.id === volatileTileRef.id) || state.player.rack.some((t) => t.id === volatileTileRef.id));
    }
  }

  // FUN OVERHAUL 7/8 (GOALS.md, 2026-08-20): gamble events. Drives each of
  // the three new events through the real Game.chooseEventOption flow after
  // splicing an event node onto the current floor, then checks the exact
  // state change (Forbidden Tome's grant + capped, non-lethal damage; the
  // Shredder's pick cap, deck floor, and permanent removal; the Wager's
  // stake/payout/forfeit both ways).
  {
    const Events = window.Wordbound.Events;
    const Items = window.Wordbound.Items;
    const Tiles = window.Wordbound.Tiles;

    // The three new events exist and are in the random pool.
    check('gamble: forbidden_tome / the_shredder / wager_with_the_stacks all defined',
      !!Events.EVENT_DEFS.forbidden_tome && !!Events.EVENT_DEFS.the_shredder && !!Events.EVENT_DEFS.wager_with_the_stacks);

    // Helper: reset to a clean RUN state and splice a single event node as the
    // current node so enterCurrentNode(startEvent) drives the real flow.
    function primeEvent(defId) {
      state.combatActive = false;
      state.screen = 'RUN';
      state.pendingEventSkipNextCombat = false;
      const node = { id: 'node-event-test-' + defId, type: 'event', defId: defId, cleared: false };
      state.floor.nodes.push(node);
      state.currentNodeId = node.id;
      window.Wordbound.Game.enterCurrentNode();
    }

    // -- Forbidden Tome --------------------------------------------------
    // Full-ink case: grants an unowned rule-changer, deals exactly 20% max ink.
    state.player.items = state.player.items.filter((id) => Items.RULE_CHANGER_IDS.indexOf(id) === -1);
    state.player.maxInk = 40;
    state.player.ink = 40;
    const itemsBeforeTome = state.player.items.length;
    primeEvent('forbidden_tome');
    check('gamble/tome: entering routes to the EVENT screen', state.screen === 'EVENT' && state.currentEvent && state.currentEvent.id === 'forbidden_tome');
    window.Wordbound.Game.chooseEventOption(0);
    check('gamble/tome: granted exactly one unowned rule-changer', state.player.items.length === itemsBeforeTome + 1 && Items.RULE_CHANGER_IDS.indexOf(state.player.items[state.player.items.length - 1]) !== -1);
    check('gamble/tome: dealt exactly 20% of max ink (40 -> 32)', state.player.ink === 32);
    check('gamble/tome: node cleared, back on RUN', state.screen === 'RUN' && state.currentEvent === null);

    // Cannot-kill floor: at 3 ink with a 40 maxInk (8 damage), it floors at 1.
    state.player.items = state.player.items.filter((id) => Items.RULE_CHANGER_IDS.indexOf(id) === -1);
    state.player.ink = 3;
    primeEvent('forbidden_tome');
    window.Wordbound.Game.chooseEventOption(0);
    check('gamble/tome: cannot kill -- ink floors at 1, never 0 or below', state.player.ink === 1);

    // Disabled when every rule-changer is already owned.
    Items.RULE_CHANGER_IDS.forEach((id) => { if (state.player.items.indexOf(id) === -1) state.player.items.push(id); });
    primeEvent('forbidden_tome');
    check('gamble/tome: read-choice is disabled once all rule-changers owned', !!state.currentEvent.choices[0].disabledReason(state));
    window.Wordbound.Game.chooseEventOption(0);
    check('gamble/tome: taking the disabled choice is a no-op (still on EVENT)', state.screen === 'EVENT');
    window.Wordbound.Game.chooseEventOption(1); // walk away to clear it
    state.player.items = state.player.items.filter((id) => Items.RULE_CHANGER_IDS.indexOf(id) === -1);

    // -- The Shredder ----------------------------------------------------
    // Give a comfortably-large deck so the pick budget is capped by MAX, not
    // the deck floor.
    state.deck = 'ABCDEFGHIJKLMN'.split('').map((l) => Tiles.createTile(l, null));
    const deckSizeBefore = state.deck.length;
    primeEvent('the_shredder');
    window.Wordbound.Game.chooseEventOption(0);
    check('gamble/shredder: feeding routes to the SHREDDER sub-screen', state.screen === 'SHREDDER');
    check('gamble/shredder: starts with an empty selection', state.shredderSelection.length === 0);
    const t0 = state.deck[0].id, t1 = state.deck[1].id, t2 = state.deck[2].id;
    window.Wordbound.Game.toggleShredderTile(t0);
    window.Wordbound.Game.toggleShredderTile(t1);
    check('gamble/shredder: can pick two tiles', state.shredderSelection.length === 2);
    window.Wordbound.Game.toggleShredderTile(t2);
    check('gamble/shredder: cannot pick a third (MAX_TILES = 2)', state.shredderSelection.length === 2 && state.shredderSelection.indexOf(t2) === -1);
    window.Wordbound.Game.toggleShredderTile(t0);
    check('gamble/shredder: a picked tile can be unpicked', state.shredderSelection.length === 1 && state.shredderSelection.indexOf(t0) === -1);
    window.Wordbound.Game.confirmShredder();
    check('gamble/shredder: confirming removes exactly the picked tiles from the deck permanently', state.deck.length === deckSizeBefore - 1 && !state.deck.some((t) => t.id === t1));
    check('gamble/shredder: node resolves back to RUN after confirm', state.screen === 'RUN' && state.currentEvent === null);

    // Deck-floor guard: at exactly the minimum deck size, the feed choice is
    // disabled (deck too thin), and the pick budget is 0 just above it.
    state.deck = 'ABCDEFGHIJ'.split('').map((l) => Tiles.createTile(l, null)); // 10 == SHREDDER_MIN_DECK_SIZE
    primeEvent('the_shredder');
    check('gamble/shredder: feed choice disabled when deck at the minimum size', !!state.currentEvent.choices[0].disabledReason(state));
    window.Wordbound.Game.chooseEventOption(1); // walk away

    state.deck = 'ABCDEFGHIJK'.split('').map((l) => Tiles.createTile(l, null)); // 11 == floor + 1
    primeEvent('the_shredder');
    window.Wordbound.Game.chooseEventOption(0);
    check('gamble/shredder: only one pick allowed one tile above the deck floor', window.Wordbound.Game._shredderRemainingPicks() === 1);
    window.Wordbound.Game.confirmShredder();

    // -- Wager with the Stacks ------------------------------------------
    // Stake deducted on accept; payout on a clean (no-repeat) win.
    state.player.gold = 100;
    primeEvent('wager_with_the_stacks');
    window.Wordbound.Game.chooseEventOption(0);
    check('gamble/wager: staking deducts the stake up front (100 -> 70)', state.player.gold === 70);
    check('gamble/wager: an active wager is now tracked', !!state.activeWager && state.activeWager.payout === Events.WAGER_PAYOUT);
    window.Wordbound.Game.chooseEventOption(1); // dismiss the still-open (already-accepted) event node cleanly

    // Disabled when the player can't afford the stake.
    state.activeWager = null;
    state.player.gold = 10;
    primeEvent('wager_with_the_stacks');
    check('gamble/wager: accept disabled when the player cannot afford the stake', !!state.currentEvent.choices[0].disabledReason(state));
    window.Wordbound.Game.chooseEventOption(1); // decline
    check('gamble/wager: declining leaves gold untouched and no wager active', state.player.gold === 10 && state.activeWager === null);
  }

  // FUN OVERHAUL 7/8 wager resolution through a real kill: accept a wager,
  // then win a spliced 1-HP fight without repeating a word and confirm the
  // payout lands; separately, a repeated word forfeits the stake. Kept apart
  // from the block above so the death-beat timeouts don't interleave with its
  // synchronous checks.
  {
    const Tiles = window.Wordbound.Tiles;
    const Monsters = window.Wordbound.Monsters;
    const Events = window.Wordbound.Events;

    async function killWith(word, setup) {
      state.combatActive = false;
      state.screen = 'RUN';
      state.pendingEventSkipNextCombat = false;
      const node = { id: 'node-wager-combat', type: 'combat', defId: 'slime', cleared: false };
      state.floor.nodes.push(node);
      state.currentNodeId = node.id;
      window.Wordbound.Game.enterCurrentNode();
      await new Promise((r) => setTimeout(r, 60));
      // Force a trivially-killable, plain monster and a known rack.
      state.monster.traitPhases = [{ hpThreshold: 1, traitId: 'plain' }];
      state.monster.hp = 1;
      state.monster.maxHp = 1;
      state.monster.intent = { type: 'attack', value: 0 };
      state.hexedTileId = null;
      state.player.ink = state.player.maxInk;
      state.player.rack = word.split('').map((l) => Tiles.createTile(l, null));
      if (setup) setup();
      window.Wordbound.Game.submitWord(word);
      await new Promise((r) => setTimeout(r, 800));
    }

    // Clean win pays out.
    state.player.gold = 0;
    state.activeWager = { stake: Events.WAGER_STAKE, payout: Events.WAGER_PAYOUT };
    state.repeatedWordThisFight = false;
    await killWith('CAT');
    check('gamble/wager: a clean (no-repeat) win pays out the full payout', state.player.gold >= Events.WAGER_PAYOUT);
    check('gamble/wager: the wager clears after resolving', state.activeWager === null);
    check('gamble/wager: payout win produced zero errors', errors.length === 0);
    if (errors.length) errors.forEach((e) => console.log('  ERR:', e));

    // A repeated word forfeits the stake (no payout). startCombat resets
    // repeatedWordThisFight, so set it in the setup callback (after the fight
    // starts, before the word is submitted) to simulate a repeat having
    // happened earlier this fight.
    state.player.gold = 0;
    state.activeWager = { stake: Events.WAGER_STAKE, payout: Events.WAGER_PAYOUT };
    await killWith('DOG', () => { state.repeatedWordThisFight = true; });
    // The kill still drops its own loot gold, but the 90 payout must NOT be
    // added -- so total gold stays well under the payout.
    check('gamble/wager: a repeated word forfeits -- no payout added', state.player.gold < Events.WAGER_PAYOUT);
    check('gamble/wager: the forfeited wager still clears', state.activeWager === null);
    check('gamble/wager: forfeit is announced in the log', state.messages.some((m) => /stays with the Stacks/.test(m)));
  }

  // FUN OVERHAUL 8/8 (GOALS.md, 2026-08-20): celebration juice. jsdom CAN
  // verify the state logic (proc tracking, MAGNIFICENT bonus gold) and the DOM
  // structure of the call-outs; it CANNOT verify the animation/shake TIMING or
  // FEEL (that needs a real browser -- noted in PROGRESS.md).
  {
    const Items = window.Wordbound.Items;
    const Tiles = window.Wordbound.Tiles;

    // (1) Item-proc tracking: Items.runHook collects the ids of items whose
    // onWordPlayed hook actually announced itself (pushed a ctx.message). This
    // is the exact signal renderItemsOwned uses to flash a chip. Consonant
    // Cluster procs on any word with a consonant; Illuminated Initial needs a
    // matching previous-word first letter, so with previousWord null it stays
    // silent -- a clean proc / non-proc pair from one hook run.
    {
      const player = { items: ['consonant_cluster', 'illuminated_initial'], rack: [] };
      const ctx = {
        player: player, monster: { hp: 100, maxHp: 100 },
        word: 'CAT', tilesUsed: [], result: { damage: 10 },
        previousWord: null, wordsPlayedThisFight: 2, messages: []
      };
      Items.runHook('onWordPlayed', ctx, player);
      check('8/8 proc-track: runHook exposes ctx.proccedItemIds', Array.isArray(ctx.proccedItemIds));
      check('8/8 proc-track: a proccing item (Consonant Cluster) is recorded', ctx.proccedItemIds.indexOf('consonant_cluster') !== -1);
      check('8/8 proc-track: a silent item (Illuminated Initial, no prev word) is NOT recorded', ctx.proccedItemIds.indexOf('illuminated_initial') === -1);
    }

    // (2) A message-less hook context (onPlayerDamaged / onRunStart) is not
    // tracked -- runHook only collects when ctx.messages is present.
    {
      const player = { items: ['consonant_cluster'], rack: [] };
      const ctx = { player: player, monster: { hp: 5, maxHp: 10 }, damage: 3 };
      Items.runHook('onPlayerDamaged', ctx, player);
      check('8/8 proc-track: a message-less hook context adds no proccedItemIds', ctx.proccedItemIds === undefined);
    }

    // (3) celebrateHit DOM: the CRUSHING floater + MAGNIFICENT banner are real
    // elements appended to the live combat DOM (their animation timing is not
    // checkable here, but their PRESENCE and placement are). Exposed via
    // Game._celebrateHit so this doesn't depend on landing an exact big hit.
    {
      const combatPanel = document.getElementById('combat-panel');
      const monsterInfo = document.getElementById('monster-info');
      // Big hit (>= 25): a CRUSHING floater lands on the monster panel.
      window.Wordbound.Game._celebrateHit(30, false);
      check('8/8 CRUSHING: a big hit appends a .crushing-floater to monster-info',
        !!(monsterInfo && monsterInfo.querySelector('.crushing-floater')));
      check('8/8 CRUSHING: the floater reads "CRUSHING!"',
        !!(monsterInfo && monsterInfo.querySelector('.crushing-floater') && monsterInfo.querySelector('.crushing-floater').textContent === 'CRUSHING!'));
      // Small hit (< 25): no floater.
      const crushBefore = monsterInfo ? monsterInfo.querySelectorAll('.crushing-floater').length : 0;
      window.Wordbound.Game._celebrateHit(10, false);
      check('8/8 CRUSHING: a small hit (< 25) adds no new floater',
        !monsterInfo || monsterInfo.querySelectorAll('.crushing-floater').length === crushBefore);
      // MAGNIFICENT banner on a long-word flag.
      window.Wordbound.Game._celebrateHit(10, true);
      check('8/8 MAGNIFICENT: the banner is appended to the combat panel',
        !!(combatPanel && combatPanel.querySelector('.magnificent-banner')));
      check('8/8 MAGNIFICENT: the banner reads "MAGNIFICENT!"',
        !!(combatPanel && combatPanel.querySelector('.magnificent-banner') && combatPanel.querySelector('.magnificent-banner').textContent === 'MAGNIFICENT!'));
      // clean the transient elements up so later DOM checks aren't confused
      if (monsterInfo) monsterInfo.querySelectorAll('.crushing-floater').forEach((n) => n.remove());
      if (combatPanel) combatPanel.querySelectorAll('.magnificent-banner').forEach((n) => n.remove());
    }

    // (4) item-chip-proc flash on render: renderItemsOwned reads
    // state.proccedItemIds, flashes exactly those chips for ONE render, then
    // clears the list. Driven through a real re-render (openDeckViewer/close,
    // the existing test convention) rather than calling the private renderer.
    {
      const savedItems = state.player.items;
      state.player.items = ['consonant_cluster', 'foreword'];
      state.proccedItemIds = ['consonant_cluster'];
      // renderItemsOwned runs (and consumes the flash) on the FIRST render --
      // openDeckViewer's render -- so read the strip before closing again.
      window.Wordbound.Game.openDeckViewer();
      const chips = Array.from(document.querySelectorAll('#items-owned .item-chip'));
      const proccedChip = chips.find((c) => c.textContent === Items.ITEM_DEFS['consonant_cluster'].name);
      const otherChip = chips.find((c) => c.textContent === Items.ITEM_DEFS['foreword'].name);
      check('8/8 chip-flash: the procced item chip renders with .item-chip-proc',
        !!proccedChip && proccedChip.className.indexOf('item-chip-proc') !== -1);
      check('8/8 chip-flash: a non-procced item chip does NOT get .item-chip-proc',
        !!otherChip && otherChip.className.indexOf('item-chip-proc') === -1);
      check('8/8 chip-flash: proccedItemIds is cleared after that one render', state.proccedItemIds.length === 0);
      // Next render: the flash is gone (one-shot).
      window.Wordbound.Game.closeDeckViewer();
      const chip2 = Array.from(document.querySelectorAll('#items-owned .item-chip')).find((c) => c.textContent === Items.ITEM_DEFS['consonant_cluster'].name);
      check('8/8 chip-flash: the flash is gone on the following render (one-shot)',
        !!chip2 && chip2.className.indexOf('item-chip-proc') === -1);
      state.player.items = savedItems;
    }

    // (5) MAGNIFICENT bonus gold (state logic) + combo-chip bump (DOM), driven
    // through the REAL Game.submitWord so it proves the wiring, not just the
    // constants. Enters a real uncleared combat node so a fight is live; SKIPs
    // (never falsely fails) if the floor layout has none left at this point.
    if (!state.combatActive) {
      const nodes = (state.floor && state.floor.nodes) || [];
      // Prefer an uncleared combat node; if the run has cleared them all by
      // this point, un-clear one so a real fight (real startCombat path)
      // starts -- fidelity over convenience.
      let idx = nodes.findIndex((n) => !n.cleared && (n.type === 'combat' || n.type === 'elite'));
      if (idx === -1) {
        idx = nodes.findIndex((n) => n.type === 'combat' || n.type === 'elite');
        if (idx !== -1) nodes[idx].cleared = false;
      }
      if (idx !== -1) {
        state.currentNodeId = nodes[idx].id;
        state.screen = 'RUN';
        state.pendingEventSkipNextCombat = false;
        window.Wordbound.Game.enterCurrentNode();
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (state.combatActive && state.monster) {
      const Lexicon = window.Wordbound.Lexicon;
      let longWord = null;
      for (let i = 0; i < WORDLIST.length; i++) {
        if (WORDLIST[i].length === 7 && Lexicon.isValidWord(WORDLIST[i])) { longWord = WORDLIST[i]; break; }
      }
      if (!longWord) {
        console.log('SKIP 8/8 magnificent-gold check -- no 7-letter word in the wordlist (should never happen)');
      } else {
        // Controlled rack that spells the word; monster raised out of reach so
        // the fight survives (a kill would end it and roll rewards). Plain
        // trait so the word actually deals damage (no immunity multiplier 0).
        state.player.rack = longWord.split('').map((l) => Tiles.createTile(l, null));
        state.monster.maxHp = 100000;
        state.monster.hp = 100000;
        state.monster.traitPhases = [{ hpThreshold: 1, traitId: 'plain' }];
        state.hexedTileId = null;
        state.selectedTileIds = [];
        state.blankAssignments = {};
        const goldBefore = state.player.gold;
        document.getElementById('word-input').value = longWord;
        document.getElementById('btn-submit-word').dispatchEvent(new window.Event('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 300));
        check('8/8 magnificent-gold: playing a 7-letter word produces zero errors', errors.length === 0);
        if (errors.length) errors.forEach((e) => console.log('  ERR:', e));
        check('8/8 magnificent-gold: a 7-letter word granted exactly +5 bonus gold', state.player.gold === goldBefore + 5);
        check('8/8 magnificent-gold: the bonus is announced with "MAGNIFICENT!"', state.messages.some((m) => m.indexOf('MAGNIFICENT!') !== -1));
        check('8/8 combo-bump: the (advanced) combo chip rendered with .combo-chip-bump', !!document.querySelector('.combo-chip.combo-chip-bump'));
      }
    } else {
      console.log('SKIP 8/8 magnificent-gold + combo-bump checks -- no live fight active at this point (layout-dependent, not a bug)');
    }
  }

  // FUN OVERHAUL 6/8 (GOALS.md, 2026-08-20): elites as opt-in risk/reward.
  // Runs last (it replaces the floor/monster). Isolated floor-generation
  // checks + a live elite fight driven to a kill to prove the resistance
  // trait, pre-entry warning, guaranteed rule-changer drop, and 1.5x gold.
  {
    const Floor = window.Wordbound.Floor;
    const Traits = window.Wordbound.Traits;
    const Items = window.Wordbound.Items;
    const Monsters = window.Wordbound.Monsters;
    const Tiles = window.Wordbound.Tiles;
    const rng = window.Game.RNG.create('elite-test-seed');

    // The rule-changer pool is exactly the 8 items from 4/8 and they all exist.
    check('elite: RULE_CHANGER_IDS has the 8 rule-changer items', Items.RULE_CHANGER_IDS.length === 8);
    check('elite: every RULE_CHANGER_ID is a real item def', Items.RULE_CHANGER_IDS.every((id) => !!Items.ITEM_DEFS[id]));
    check('elite: all three resistance traits exist in TRAITS', Floor.ELITE_RESISTANCE_TRAITS.every((t) => !!Traits.TRAITS[t]));

    // Floors 2 and 3 generate an elite node carrying a rolled resistance trait.
    let sawElite = false, allEliteTraitsValid = true;
    for (let f = 2; f <= 3; f++) {
      for (let i = 0; i < 20; i++) {
        const floor = Floor.generateFloor(f, rng);
        floor.nodes.filter((n) => n.type === 'elite').forEach((n) => {
          sawElite = true;
          if (Floor.ELITE_RESISTANCE_TRAITS.indexOf(n.eliteTraitId) === -1) allEliteTraitsValid = false;
        });
      }
    }
    check('elite: floors 2-3 generate elite nodes', sawElite);
    check('elite: every elite node carries a valid resistance trait id', allEliteTraitsValid);

    // Live: splice a synthetic elite node onto the current floor, enter it,
    // and confirm the resistance trait is applied and the node pill warns.
    state.combatActive = false;
    state.screen = 'RUN';
    state.pendingEventSkipNextCombat = false;
    const eliteNode = { id: 'node-elite-test', type: 'elite', defId: 'sentinel', eliteTraitId: 'alphabetic', cleared: false };
    state.floor.nodes.push(eliteNode);
    state.currentNodeId = eliteNode.id;

    // Pre-entry warning: while still on the map (BEFORE entering), the elite's
    // node pill shows its resistance trait hint. Force a RUN-screen render via
    // the deck-viewer close path (render() is module-private) so the freshly
    // spliced node is drawn, then read the pill text.
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
    const eliteHint = Traits.TRAITS['alphabetic'].hint;
    const nodePillText = Array.from(document.querySelectorAll('#node-map .node-pill')).map((p) => p.textContent).join(' | ');
    check('elite: the node-map pill warns with the resistance trait hint before entry', nodePillText.indexOf(eliteHint) !== -1);

    window.Wordbound.Game.enterCurrentNode();
    await new Promise((r) => setTimeout(r, 80));
    check('elite: entering an elite node starts combat', state.combatActive === true);
    check('elite: the monster is flagged as an elite', state.monster.isElite === true);
    check('elite: the elite fights with the node\'s rolled resistance trait', state.monster.traitPhases[0].traitId === 'alphabetic');

    // Live: kill the elite and confirm the guaranteed rule-changer drop +
    // 1.5x gold. Force a plain trait + 1 HP so the kill is deterministic (the
    // reward path doesn't depend on the trait), and strip any owned
    // rule-changers so the drop is guaranteed to have something to give.
    state.monster.traitPhases = [{ hpThreshold: 1, traitId: 'plain' }];
    state.monster.hp = 1;
    state.monster.maxHp = 1;
    state.monster.intent = { type: 'attack', value: 0 };
    state.hexedTileId = null;
    state.player.ink = state.player.maxInk;
    state.player.items = state.player.items.filter((id) => Items.RULE_CHANGER_IDS.indexOf(id) === -1);
    const itemsBefore = state.player.items.length;
    const goldBefore = state.player.gold;
    state.player.rack = ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null));
    window.Wordbound.Game.submitWord('CAT');
    // Killing blow runs onMonsterDefeated after TILE_PLAY_ANIM_MS (220) +
    // MONSTER_DEATH_BEAT_MS (500) -- wait past both.
    await new Promise((r) => setTimeout(r, 800));
    check('elite defeat: produced zero errors', errors.length === 0);
    if (errors.length) errors.forEach((e) => console.log('  ERR:', e));
    const gainedItems = state.player.items.slice(itemsBefore);
    check('elite defeat: granted exactly one guaranteed rule-changer item', gainedItems.length === 1 && Items.RULE_CHANGER_IDS.indexOf(gainedItems[0]) !== -1);
    check('elite defeat: gold increased (1.5x elite bonus applied)', state.player.gold > goldBefore);
    check('elite defeat: log announces the elite drop', state.messages.some((m) => /elite drops/i.test(m)));
    check('elite defeat: log flags the 1.5x elite gold', state.messages.some((m) => /1\.5x/.test(m)));
  }

  // AUDIO ticket (GOALS.md, 2026-08-21): interaction SFX for previously-silent
  // events (tile stage/unstage, invalid word, gold, purchase, consumable use,
  // heal, floor transition, boss entrance, victory/defeat). jsdom has no real
  // Web Audio API, so these can't confirm audibility -- they assert the
  // TRIGGER wiring via Game._sfxCallLog() (see game.js): which sound fired,
  // for which event, whether mute suppressed it, and whether the tile-tap
  // debounce ate a rapid-fire second call. Real audibility/mix still needs a
  // human with speakers (see PROGRESS.md).
  {
    const Game = window.Wordbound.Game;
    const Tiles = window.Wordbound.Tiles;
    const Monsters = window.Wordbound.Monsters;

    // Fresh regular (non-boss, non-elite) combat to work against.
    state.screen = 'RUN';
    state.combatActive = false;
    const regDefId = Object.keys(Monsters.MONSTER_DEFS)[0];
    const audioNode = { id: 'audio-test-combat', type: 'combat', defId: regDefId, cleared: false };
    state.floor.nodes.push(audioNode);
    state.currentNodeId = audioNode.id;
    Game.enterCurrentNode();
    await new Promise((r) => setTimeout(r, 60));
    check('audio setup: fresh combat is active', state.combatActive === true);
    Game._clearSfxCallLog();

    // -- tile stage / unstage, and the rapid-tap debounce --
    const rackBtns = () => Array.from(document.querySelectorAll('#rack-display .letter-tile'));
    const nonBlankCands = () => rackBtns().filter((b) => {
      const t = state.player.rack.find((rt) => rt.id === b.getAttribute('data-tile-id'));
      return t && t.letter !== '?';
    });
    const cands = nonBlankCands();
    if (cands.length < 2) {
      console.log('SKIP audio tile-tap checks -- fewer than 2 non-blank rack tiles');
    } else {
      const idA = cands[0].getAttribute('data-tile-id');
      cands[0].dispatchEvent(new window.Event('click', { bubbles: true })); // stage tile A
      check('audio: staging a tile logs a played tileStage call',
        Game._sfxCallLog().some((e) => e.name === 'tileStage' && e.played === true));

      // Stage a second tile immediately after -- inside the tileTap debounce
      // window (35ms), so this call should be LOGGED but marked not played.
      cands[1].dispatchEvent(new window.Event('click', { bubbles: true }));
      const tileStageCalls = Game._sfxCallLog().filter((e) => e.name === 'tileStage');
      check('audio: a rapid second tile-stage is logged but debounced (not played)',
        tileStageCalls.length === 2 && tileStageCalls.filter((e) => e.played).length === 1);

      Game._clearSfxCallLog();
      const stagedA = document.querySelector('#staging-area .staged-tile[data-tile-id="' + idA + '"]');
      if (stagedA) {
        stagedA.dispatchEvent(new window.Event('click', { bubbles: true })); // unstage tile A
        check('audio: unstaging a tile logs a played tileUnstage call',
          Game._sfxCallLog().some((e) => e.name === 'tileUnstage' && e.played === true));
      } else {
        console.log('SKIP audio tile-unstage check -- staged tile element not found');
      }
    }
    check('audio: a regular (non-boss) fight never logs bossEntrance',
      Game._sfxCallLog().every((e) => e.name !== 'bossEntrance'));

    // -- invalid word rejection, unmuted --
    state.selectedTileIds = [];
    state.blankAssignments = {};
    document.getElementById('word-input').value = '';
    Game._clearSfxCallLog();
    Game.submitWord('ZZZZQQQQ');
    check('audio: an unplayable word logs a played invalidWord call',
      Game._sfxCallLog().some((e) => e.name === 'invalidWord' && e.played === true));

    // -- mute suppresses new AND pre-existing sounds alike --
    const muteBtn = document.getElementById('btn-toggle-music');
    muteBtn.dispatchEvent(new window.Event('click', { bubbles: true })); // mute
    Game._clearSfxCallLog();
    Game.submitWord('ZZZZQQQQ');
    check('audio: muted -- invalidWord is logged but marked not played',
      Game._sfxCallLog().some((e) => e.name === 'invalidWord' && e.muted === true && e.played === false));
    // Also covers the pre-existing playCombatSound, which used to ignore mute
    // entirely (see the fix alongside this ticket in game.js): play a real
    // word against the still-healthy monster and confirm it's suppressed too.
    state.player.rack = ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null));
    Game.submitWord('CAT');
    await new Promise((r) => setTimeout(r, 400));
    check('audio: muted -- a real word\'s combatHit is logged but marked not played',
      Game._sfxCallLog().some((e) => e.name === 'combatHit' && e.muted === true && e.played === false));
    muteBtn.dispatchEvent(new window.Event('click', { bubbles: true })); // unmute
    check('audio: unmuted again -- a fresh combatHit plays', (() => {
      Game._clearSfxCallLog();
      state.player.rack = ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null));
      Game.submitWord('CAT');
      return true; // result checked just below, after the animation delay
    })());
    await new Promise((r) => setTimeout(r, 400));
    check('audio: unmuted -- combatHit is logged as played',
      Game._sfxCallLog().some((e) => e.name === 'combatHit' && e.played === true));

    // -- gold gain on a kill --
    state.selectedTileIds = [];
    state.blankAssignments = {};
    document.getElementById('word-input').value = '';
    state.monster.traitPhases = [{ hpThreshold: 1, traitId: 'plain' }];
    state.monster.hp = 1;
    state.monster.maxHp = 1;
    state.monster.intent = { type: 'attack', value: 0 };
    state.hexedTileId = null;
    state.player.ink = state.player.maxInk;
    state.player.rack = ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null));
    Game._clearSfxCallLog();
    Game.submitWord('CAT');
    await new Promise((r) => setTimeout(r, 800));
    check('audio: killing the monster for gold logs a played goldGain call',
      Game._sfxCallLog().some((e) => e.name === 'goldGain' && e.played === true));
    if (state.screen === 'TILE_REWARD') Game.skipTileReward();
    if (state.bossRewardOptions) Game.skipBossItemReward();

    // -- shop purchase --
    state.player.gold = 9999;
    const shopOptions = Game._rollShopOptions();
    Game._clearSfxCallLog();
    Game.buyItem(shopOptions[0]);
    check('audio: a shop purchase logs a played purchase call',
      Game._sfxCallLog().some((e) => e.name === 'purchase' && e.played === true));

    // -- consumable use (test-only no-op def, same pattern as the useConsumable
    // death-guard check above) --
    {
      const Consumables = window.Wordbound.Consumables;
      const savedCombatActive = state.combatActive;
      const savedScreen = state.screen;
      const savedConsumables = state.player.consumables.slice();
      Consumables.CONSUMABLE_DEFS['_test_audio_consumable'] = {
        id: '_test_audio_consumable', name: 'Test Audio Consumable', hint: 'test-only, not a real consumable',
        rarity: 'common', effect: function () { return { message: 'Test Audio Consumable used.' }; }
      };
      state.combatActive = true;
      state.screen = 'RUN';
      if (!state.monster) state.monster = Monsters.createMonster(regDefId);
      state.monster.hp = Math.max(state.monster.hp, 1);
      state.player.consumables.push('_test_audio_consumable');
      Game._clearSfxCallLog();
      Game.useConsumable('_test_audio_consumable');
      check('audio: using a consumable logs a played consumable call',
        Game._sfxCallLog().some((e) => e.name === 'consumable' && e.played === true));
      delete Consumables.CONSUMABLE_DEFS['_test_audio_consumable'];
      state.combatActive = savedCombatActive;
      state.screen = savedScreen;
      state.player.consumables = savedConsumables;
    }

    // -- rest-node heal --
    state.screen = 'RUN';
    state.combatActive = false;
    state.player.ink = Math.max(1, state.player.maxInk - 5);
    const restNode = { id: 'audio-test-rest', type: 'rest', cleared: false };
    state.floor.nodes.push(restNode);
    state.currentNodeId = restNode.id;
    Game._clearSfxCallLog();
    Game.enterCurrentNode();
    check('audio: resting at a rest node logs a played heal call',
      Game._sfxCallLog().some((e) => e.name === 'heal' && e.played === true));

    // -- floor transition via advanceFloor -- saved/restored the same way the
    // onFloorAdvance wiring check earlier in this file does.
    {
      const savedFloorNumber = state.floorNumber;
      const savedFloor = state.floor;
      const savedCurrentNodeId = state.currentNodeId;
      const savedMapPositionNodeId = state.mapPositionNodeId;
      const savedPathNodeIds = state.pathNodeIds;
      const savedRunStats = Object.assign({}, state.runStats);
      state.floorNumber = 1; // TOTAL_FLOORS is 3 -- 1 -> 2 is a real mid-run advance, not a victory
      Game._clearSfxCallLog();
      Game._advanceFloor();
      check('audio: a mid-run floor advance logs a played floorTransition call',
        Game._sfxCallLog().some((e) => e.name === 'floorTransition' && e.played === true));
      state.floorNumber = savedFloorNumber;
      state.floor = savedFloor;
      state.currentNodeId = savedCurrentNodeId;
      state.mapPositionNodeId = savedMapPositionNodeId;
      state.pathNodeIds = savedPathNodeIds;
      state.runStats = savedRunStats;
    }

    // -- boss entrance --
    state.screen = 'RUN';
    state.combatActive = false;
    const bossDefId = Object.keys(Monsters.BOSS_DEFS)[0];
    const audioBossNode = { id: 'audio-test-boss', type: 'boss', defId: bossDefId, cleared: false };
    state.floor.nodes.push(audioBossNode);
    state.currentNodeId = audioBossNode.id;
    Game._clearSfxCallLog();
    Game.enterCurrentNode();
    await new Promise((r) => setTimeout(r, 60));
    check('audio: entering a boss fight logs a played bossEntrance call',
      Game._sfxCallLog().some((e) => e.name === 'bossEntrance' && e.played === true));

    // -- defeat stinger: force a lethal counterattack --
    state.monster.traitPhases = [{ hpThreshold: 1, traitId: 'plain' }];
    state.monster.hp = 999999;
    state.monster.maxHp = 999999;
    state.monster.intent = { type: 'attack', value: 9999 };
    state.hexedTileId = null;
    state.player.ink = 1;
    state.player.rack = ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null));
    Game._clearSfxCallLog();
    Game.submitWord('CAT');
    await new Promise((r) => setTimeout(r, 400));
    check('audio: dying to a counterattack logs a played defeat call',
      Game._sfxCallLog().some((e) => e.name === 'defeat' && e.played === true));
    check('audio block: produced zero errors', errors.length === 0);
    if (errors.length) errors.forEach((e) => console.log('  ERR:', e));

    // Return to a neutral state -- the boss-skip block below resets
    // screen/combatActive itself before each of its own scenarios, same as
    // every other block in this file that ends mid-run, so no further
    // restoration is needed here.
  }

  // INK SPEND (GOALS.md INK ticket, run 2/2-4): Overcharge and Rewrite,
  // driven through the real buttons/click handlers (not direct state
  // mutation) against a live combat, on top of the isolated Combat-level
  // math checks earlier in this file. Forces the monster to effectively
  // unkillable/harmless (high hp, a 'plain' trait, a 0-damage intent) so
  // this block tests the SPEND wiring in isolation, not kill/counterattack
  // interactions covered elsewhere.
  {
    const Game = window.Wordbound.Game;
    const Combat = window.Wordbound.Combat;
    const Tiles = window.Wordbound.Tiles;
    const Items = window.Wordbound.Items;
    const Monsters = window.Wordbound.Monsters;

    // Strip whatever items this continuous test player has accumulated from
    // earlier blocks (elite drops, treasure, etc.) -- several real items hook
    // onWordPlayed and adjust player.ink themselves (heal-per-word effects),
    // which would silently throw off this block's exact ink-delta arithmetic
    // if left in place. Restored at the end, same courtesy the elite block
    // above pays for RULE_CHANGER_IDS.
    const savedItems = state.player.items.slice();
    state.player.items = [];

    // Ink is set BEFORE entering combat (not after) so the render
    // enterCurrentNode triggers already reflects it -- setting it afterward
    // would leave the just-rendered buttons' disabled/label state stale
    // until the next render, which is exactly the kind of drift this block
    // means to catch, not cause.
    state.player.maxInk = 20;
    state.player.ink = 20;

    state.screen = 'RUN';
    state.combatActive = false;
    const inkDefId = Object.keys(Monsters.MONSTER_DEFS)[0];
    const inkNode = { id: 'ink-spend-test-combat', type: 'combat', defId: inkDefId, cleared: false };
    state.floor.nodes.push(inkNode);
    state.currentNodeId = inkNode.id;
    Game.enterCurrentNode();
    await new Promise((r) => setTimeout(r, 60));
    check('ink spend setup: fresh combat is active', state.combatActive === true);

    state.monster.hp = 999999;
    state.monster.maxHp = 999999;
    state.monster.traitPhases = [{ hpThreshold: 1, traitId: 'plain' }];
    state.monster.intent = { type: 'attack', value: 0 };
    state.hexedTileId = null;
    state.player.rack = ['C', 'A', 'T', 'D', 'O', 'G', 'S'].map((l) => Tiles.createTile(l, null));

    const overchargeBtn = document.getElementById('btn-overcharge');
    const rewriteBtn = document.getElementById('btn-rewrite-rack');
    // "Every spend must show clear cost UI before committing" per the
    // ticket, checked at the DOM level (labels AND affordability), against
    // the real render enterCurrentNode already produced with ink=20 set.
    check('ink spend: overcharge button exists and shows its ink cost', !!overchargeBtn && overchargeBtn.textContent.indexOf('-' + Combat.OVERCHARGE_INK_COST + ' ink') !== -1);
    check('ink spend: rewrite button exists and shows its ink cost', !!rewriteBtn && rewriteBtn.textContent.indexOf('-' + Combat.REWRITE_INK_COST + ' ink') !== -1);
    check('ink spend: overcharge button is enabled with plenty of ink', overchargeBtn.disabled === false);
    check('ink spend: rewrite button is enabled with plenty of ink', rewriteBtn.disabled === false);

    // -- Overcharge: arm via the real click handler, check the live preview,
    // then submit and confirm the ink/damage/disarm all match what
    // Combat.previewWord itself predicts (the same anti-drift contract the
    // preview block earlier in this file already established).
    overchargeBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    check('ink spend: toggleOvercharge (via click) arms the flag', state.overchargeArmed === true);
    check('ink spend: the armed button gets the .armed class', overchargeBtn.classList.contains('armed'));
    check('ink spend: the armed button label reads "Overcharged!"', overchargeBtn.textContent.indexOf('Overcharged') !== -1);

    const wordInput = document.getElementById('word-input');
    wordInput.value = 'CAT';
    wordInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    const previewEl = document.getElementById('damage-preview');
    check('ink spend: the live preview flags "(overcharged)" while armed', previewEl.textContent.indexOf('(overcharged)') !== -1);

    const predicted = Combat.previewWord(state.player, state.monster, 'CAT', state.comboState, {
      previousWord: state.previousWordThisFight, wordsPlayedThisFight: state.wordsPlayedThisFightCount,
      hexedTileId: state.hexedTileId, overcharge: true
    });
    check('ink spend: predicted overcharged damage is valid and positive', predicted.valid && predicted.damage > 0);

    const inkBeforeOvercharge = state.player.ink;
    const monsterHpBeforeOvercharge = state.monster.hp;
    state.messages = [];
    Game.submitWord('CAT');
    wordInput.value = '';
    check('ink spend: submitting an armed word spends exactly OVERCHARGE_INK_COST ink', state.player.ink === inkBeforeOvercharge - Combat.OVERCHARGE_INK_COST);
    check('ink spend: the log announces the overcharge spend', state.messages.some((m) => /Overcharged!/.test(m)));
    check('ink spend: the toggle disarms itself after a successful play', state.overchargeArmed === false);
    check('ink spend: the monster took exactly the predicted (amplified) damage', state.monster.hp === monsterHpBeforeOvercharge - predicted.damage);
    await new Promise((r) => setTimeout(r, 800)); // let the deferred rack-cycle/counterattack settle before the next subtest

    // -- Overcharge is a single-use flag: a plain (unarmed) word right after
    // must NOT still be amplified.
    check('ink spend: overcharge does not persist to the next word (baseline play stays free)', state.overchargeArmed === false);

    // -- insufficient ink: the button refuses to arm and disables itself.
    state.player.ink = 1;
    state.messages = [];
    Game.toggleOvercharge();
    check('ink spend: toggleOvercharge refuses to arm below OVERCHARGE_INK_COST', state.overchargeArmed === false);
    check('ink spend: an unaffordable overcharge attempt logs a refusal', state.messages.some((m) => /Not enough ink/.test(m)));

    // -- Rewrite: discards the whole rack and draws a fresh one, spends ink,
    // but does NOT end the turn (no counterattack -- ink drops by EXACTLY
    // the rewrite cost, nothing else). Capacity compared against
    // Items.getRackCapacity, not a hardcoded 7 -- with items stripped above
    // it IS 7, but this stays correct if that ever changes.
    state.player.ink = 20;
    const capacity = Items.getRackCapacity(state.player);
    state.player.rack = ['Q', 'X', 'Z', 'J', 'V', 'W', 'K'].slice(0, capacity).map((l) => Tiles.createTile(l, null)); // a rough, low-play rack
    const rackIdsBefore = state.player.rack.map((t) => t.id).slice().sort();
    const inkBeforeRewrite = state.player.ink;
    state.messages = [];
    rewriteBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    const rackIdsAfter = state.player.rack.map((t) => t.id).slice().sort();
    check('ink spend: rewrite spends exactly REWRITE_INK_COST ink, nothing else', state.player.ink === inkBeforeRewrite - Combat.REWRITE_INK_COST);
    check('ink spend: rewrite fully replaces the rack (different tile ids)', rackIdsBefore.join(',') !== rackIdsAfter.join(','));
    check('ink spend: rewrite keeps the rack at its normal capacity', state.player.rack.length === capacity);
    check('ink spend: rewrite logs what happened', state.messages.some((m) => /rewrite your rack/.test(m)));
    check('ink spend: rewrite does not end the turn (combat still active)', state.combatActive === true);

    // -- Rewrite, insufficient ink: refuses, no state change.
    state.player.ink = 1;
    const rackIdsBeforeRefusal = state.player.rack.map((t) => t.id).slice().sort();
    state.messages = [];
    rewriteBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
    check('ink spend: an unaffordable rewrite is refused (ink unchanged)', state.player.ink === 1);
    check('ink spend: an unaffordable rewrite leaves the rack untouched', state.player.rack.map((t) => t.id).slice().sort().join(',') === rackIdsBeforeRefusal.join(','));
    check('ink spend: an unaffordable rewrite attempt logs a refusal', state.messages.some((m) => /Not enough ink/.test(m)));

    check('ink spend block: produced zero errors', errors.length === 0);
    if (errors.length) errors.forEach((e) => console.log('  ERR:', e));

    state.player.items = savedItems;
  }

  // BUG (QA polish pass, GOALS.md 2026-08-21): render()'s deck-viewer-panel/
  // item-inspector-panel/consumables-panel toggles used to early-return
  // BEFORE the node-map/combat-panel/overlay-panel toggles below them ever
  // ran, so whichever screen was visible on the PREVIOUS render (the node
  // map, or a live fight) stayed visible and stacked behind the newly
  // opened side panel -- a real-browser screenshot pass caught the node map
  // pills bleeding in above the deck viewer's tile list. Fixed by folding a
  // single sidePanelOpen flag into every other panel's hidden toggle so it
  // applies regardless of open order. Real Game.openDeckViewer()/
  // openConsumablesPanel() calls, not synthetic class edits, and checked
  // against BOTH contexts the bug reproduced in (idle on the node map, and
  // mid-combat).
  {
    const Game = window.Wordbound.Game;
    const Monsters = window.Wordbound.Monsters;

    // (a) idle on the node map (not in combat).
    state.screen = 'RUN';
    state.combatActive = false;
    state.deckViewerOpen = false;
    Game.openDeckViewer();
    check('panel-stacking: opening the deck viewer from the node map hides node-map',
      document.getElementById('node-map').classList.contains('hidden') === true &&
      document.getElementById('deck-viewer-panel').classList.contains('hidden') === false);
    Game.closeDeckViewer();
    check('panel-stacking: closing the deck viewer restores the node map',
      document.getElementById('node-map').classList.contains('hidden') === false);

    // (b) mid-combat -- the bug also reproduced here, not just on the node map.
    const stackDefId = Object.keys(Monsters.MONSTER_DEFS)[0];
    const stackNode = { id: 'panel-stack-test-combat', type: 'combat', defId: stackDefId, cleared: false };
    state.floor.nodes.push(stackNode);
    state.currentNodeId = stackNode.id;
    Game.enterCurrentNode();
    await new Promise((r) => setTimeout(r, 60));
    check('panel-stacking setup: fresh combat is active', state.combatActive === true);
    Game.openConsumablesPanel();
    check('panel-stacking: opening consumables mid-combat hides combat-panel',
      document.getElementById('combat-panel').classList.contains('hidden') === true &&
      document.getElementById('consumables-panel').classList.contains('hidden') === false);
    Game.closeConsumablesPanel();
    check('panel-stacking: closing consumables restores combat-panel',
      document.getElementById('combat-panel').classList.contains('hidden') === false);
    check('panel-stacking block: produced zero errors', errors.length === 0);
    if (errors.length) errors.forEach((e) => console.log('  ERR:', e));
  }

  // DESIGN FIX (GOALS.md, 2026-08-20, Jaxon's ruling): bosses cannot be
  // skipped via the Empty Shelf "sit and breathe" event. A pending skip must
  // still be honored for a regular combat, but a boss node starts the fight
  // anyway and KEEPS the flag pending so it applies to the next regular combat
  // on the following floor. Runs last -- the victory sub-check ends the run.
  {
    const Tiles = window.Wordbound.Tiles;

    // (d) the event choice text carries the new "bosses will not be avoided" wording.
    const emptyShelf = window.Wordbound.Events.EVENT_DEFS.empty_shelf;
    check('boss-skip: empty_shelf "sit and breathe" text warns bosses will not be avoided',
      emptyShelf.choices[0].text.indexOf('bosses will not be avoided') !== -1);

    // (a) pending skip + a REGULAR combat node: fight is skipped, flag cleared,
    // node cleared, no combat starts.
    state.screen = 'RUN';
    state.combatActive = false;
    state.pendingEventSkipNextCombat = true;
    const regDefId = Object.keys(window.Wordbound.Monsters.MONSTER_DEFS)[0];
    const regNode = { id: 'skip-test-combat', type: 'combat', defId: regDefId, cleared: false };
    state.floor.nodes.push(regNode);
    state.currentNodeId = regNode.id;
    window.Wordbound.Game.enterCurrentNode();
    await new Promise((r) => setTimeout(r, 60));
    check('boss-skip: a regular combat with a pending skip does NOT start combat', state.combatActive === false);
    check('boss-skip: a regular skip consumes the flag', state.pendingEventSkipNextCombat === false);
    check('boss-skip: a regular skip marks the node cleared', regNode.cleared === true);

    // Helper: drive a boss node to defeat from a pending-skip entry, asserting
    // the boss fight actually STARTS and the skip flag survives it. Returns
    // after the run has either advanced a floor or reached VICTORY.
    async function enterAndKillBoss(floorNumber, bossDefId, labelPrefix) {
      state.screen = 'RUN';
      state.combatActive = false;
      state.floorNumber = floorNumber;
      state.pendingEventSkipNextCombat = true;
      const bossNode = { id: 'skip-test-boss-' + floorNumber, type: 'boss', defId: bossDefId, cleared: false };
      state.floor.nodes.push(bossNode);
      state.currentNodeId = bossNode.id;
      window.Wordbound.Game.enterCurrentNode();
      await new Promise((r) => setTimeout(r, 60));
      check(labelPrefix + ': a boss node with a pending skip STARTS combat (not skipped)', state.combatActive === true);
      check(labelPrefix + ': the boss fight is against the boss', state.monster && state.monster.isBoss === true && state.monster.defId === bossDefId);
      check(labelPrefix + ': the skip flag survives boss entry (still pending)', state.pendingEventSkipNextCombat === true);
      check(labelPrefix + ': a flavor line explains the boss cannot be avoided', state.messages.some((m) => /will not be avoided/.test(m)));

      // Deterministic one-shot kill: plain trait, 1 HP, harmless intent.
      state.monster.traitPhases = [{ hpThreshold: 1, traitId: 'plain' }];
      state.monster.hp = 1;
      state.monster.maxHp = 1;
      state.monster.intent = { type: 'attack', value: 0 };
      state.hexedTileId = null;
      state.player.ink = state.player.maxInk;
      state.player.rack = ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null));
      window.Wordbound.Game.submitWord('CAT');
      // Killing blow runs onMonsterDefeated after TILE_PLAY_ANIM_MS (220) +
      // MONSTER_DEATH_BEAT_MS (500).
      await new Promise((r) => setTimeout(r, 800));
      // Drive through the boss's tile-reward, then its item-reward, screens.
      if (state.screen === 'TILE_REWARD') window.Wordbound.Game.skipTileReward();
      if (state.bossRewardOptions) window.Wordbound.Game.skipBossItemReward();
    }

    // (c) a NON-final boss (floor 1): the fight happens, the flag survives it,
    // and then skips the first regular combat on the following floor.
    await enterAndKillBoss(1, 'boss_vowelmaw', 'boss-skip/floor1');
    check('boss-skip/floor1: beating the boss advanced to floor 2', state.floorNumber === 2 && state.screen === 'RUN');
    // VISUAL (per-floor ambient tint, GOALS.md): <body> should carry exactly
    // one floor-N class, matching the CURRENT floor, and it should already
    // have flipped from floor-1 to floor-2 now that the boss kill advanced
    // the floor and re-rendered -- proves the wiring in Game.render()/
    // renderRun() actually runs end-to-end, not just in isolation.
    check('visual: <body> carries floor-2 (not floor-1) after advancing floors',
      document.body.classList.contains('floor-2') && !document.body.classList.contains('floor-1') && !document.body.classList.contains('floor-3'));
    check('boss-skip/floor1: the skip flag is STILL pending after the boss fight', state.pendingEventSkipNextCombat === true);
    // The next regular combat on floor 2 is now skipped by the surviving flag.
    state.combatActive = false;
    const followDefId = Object.keys(window.Wordbound.Monsters.MONSTER_DEFS)[0];
    const followNode = { id: 'skip-test-follow-combat', type: 'combat', defId: followDefId, cleared: false };
    state.floor.nodes.push(followNode);
    state.currentNodeId = followNode.id;
    window.Wordbound.Game.enterCurrentNode();
    await new Promise((r) => setTimeout(r, 60));
    check('boss-skip/floor1: the surviving flag skips the next regular combat', state.combatActive === false && followNode.cleared === true);
    check('boss-skip/floor1: the flag is finally consumed by that regular skip', state.pendingEventSkipNextCombat === false);

    // (b) the FINAL boss (floor 3): the fight happens and beating it still
    // triggers VICTORY (the skipped-boss advanceFloor branch was removed, so
    // this confirms the real kill path still wins the run).
    window.Wordbound.Game._clearSfxCallLog();
    await enterAndKillBoss(window.Wordbound.Floor.TOTAL_FLOORS, 'boss_sovereign', 'boss-skip/floor3');
    check('boss-skip/floor3: beating the final boss triggers VICTORY', state.screen === 'VICTORY');
    // AUDIO ticket (GOALS.md, 2026-08-21): confirm the victory stinger fires
    // on a REAL end-to-end victory (not just an isolated endRun(true) call).
    check('audio: reaching real VICTORY logs a played victory call',
      window.Wordbound.Game._sfxCallLog().some((e) => e.name === 'victory' && e.played === true));
    // VISUAL: leaving the run screen (VICTORY here) must clear the floor
    // tint classes -- they're only meaningful while state.screen === 'RUN'.
    check('visual: <body> has no floor-N class on the VICTORY screen',
      !document.body.classList.contains('floor-1') && !document.body.classList.contains('floor-2') && !document.body.classList.contains('floor-3'));
    check('boss-skip: the whole boss-skip flow produced zero errors', errors.length === 0);
    if (errors.length) errors.forEach((e) => console.log('  ERR:', e));
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('SCRIPT CRASHED:', e); process.exit(1); });
