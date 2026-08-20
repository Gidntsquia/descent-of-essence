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

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('SCRIPT CRASHED:', e); process.exit(1); });
