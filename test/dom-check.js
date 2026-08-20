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
    const player = { rack: rack, items: ['foreword'], hp: 20, maxHp: 20 };
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
    const player = { rack: rack, items: [], hp: 20, maxHp: 20 };
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
    const before = { monsterHp: state.monster.hp, playerHp: state.player.hp, rackIds: state.player.rack.map((t) => t.id) };
    document.getElementById('word-input').value = word;
    document.getElementById('btn-submit-word').dispatchEvent(new window.Event('click', { bubbles: true }));
    // Rack cycling, the counterattack, and damage animations are deferred by
    // TILE_PLAY_ANIM_MS (game.js) so the tile-play animation is actually visible
    // before the rack redraws -- wait past that, not just past the click handler.
    await new Promise((r) => setTimeout(r, 300));

    check('playing a damage-dealing word produces zero errors', errors.length === 0);
    if (errors.length) errors.forEach((e) => console.log('  ERR:', e));

    const after = { monsterHp: state.monster.hp, playerHp: state.player.hp, rackIds: state.player.rack.map((t) => t.id) };
    check('monster HP decreased', after.monsterHp < before.monsterHp);
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
    }
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('SCRIPT CRASHED:', e); process.exit(1); });
