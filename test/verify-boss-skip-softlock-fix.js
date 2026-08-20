// test/verify-boss-skip-softlock-fix.js
//
// Regression check for the event-skip-on-boss softlock (found 2026-08-20 by a
// real-browser QA pass on e4d9120): the "Sit and breathe" event sets
// state.pendingEventSkipNextCombat, and the skip branch in Game.enterCurrentNode
// used to do a bare currentNodeIndex += 1 for ALL combat-type nodes. Since the
// boss is always a floor's LAST node (floor.js), skipping the boss walked the
// index one past the end of the array -- no current node, no combat, no valid
// action, run permanently stuck, no error thrown.
//
// After the fix, skipping a floor-1/2 boss advances to the next floor (with no
// tile/item reward -- the boss wasn't actually defeated), and skipping the
// floor-3 boss ends the run in VICTORY (advanceFloor's existing end-of-game
// path). Run with `node test/verify-boss-skip-softlock-fix.js`.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

async function main() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'wordbound.html'), 'utf8');
  const errors = [];
  const dom = new JSDOM(html, {
    url: 'file://' + path.join(__dirname, '..', 'wordbound.html'),
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
  });
  dom.window.addEventListener('error', (e) => errors.push((e.error && e.error.stack) || e.message));
  await new Promise((res) => {
    if (dom.window.document.readyState === 'complete') return res();
    dom.window.addEventListener('load', res);
  });
  await new Promise((r) => setTimeout(r, 300));

  const { document, window } = dom.window;
  const Game = window.Wordbound.Game;

  document.getElementById('btn-new-run').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  document.querySelector('.character-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  const s = Game._state;

  // ---- Floor 1: skip the boss, must land playable on floor 2 ----
  s.pendingEventSkipNextCombat = true;
  s.currentNodeIndex = s.floor.nodes.length - 1;
  check('setup: floor 1 last node is the boss', s.floor.nodes[s.currentNodeIndex].type === 'boss');
  const itemsBefore = s.player.items.length;
  const deckBefore = s.deck.length;
  Game.enterCurrentNode();
  await new Promise((r) => setTimeout(r, 50));

  check('skipping the floor-1 boss advances to floor 2 (was: stuck on floor 1)', s.floorNumber === 2);
  check('current node index reset to a valid node (0), not past the end', s.currentNodeIndex === 0 && s.floor.nodes[0] !== undefined);
  check('screen is RUN with a playable node map', s.screen === 'RUN' && !s.combatActive);
  check('a current-node pill exists in the DOM again', document.querySelectorAll('.node-pill.node-current').length === 1);
  check('no tile joined the deck (boss was skipped, not defeated)', s.deck.length === deckBefore);
  check('no item was granted (boss was skipped, not defeated)', s.player.items.length === itemsBefore);
  check('skip flag was consumed', s.pendingEventSkipNextCombat === false);

  // ---- Floor 2: same skip, floor 3 must be reachable ----
  s.pendingEventSkipNextCombat = true;
  s.currentNodeIndex = s.floor.nodes.length - 1;
  Game.enterCurrentNode();
  await new Promise((r) => setTimeout(r, 50));
  check('skipping the floor-2 boss lands playable on floor 3', s.floorNumber === 3 && s.currentNodeIndex === 0 && s.screen === 'RUN');

  // ---- Floor 3: skipping the final boss ends the run (VICTORY), not a strand ----
  s.pendingEventSkipNextCombat = true;
  s.currentNodeIndex = s.floor.nodes.length - 1;
  Game.enterCurrentNode();
  await new Promise((r) => setTimeout(r, 50));
  const victoryVisible = !document.getElementById('screen-victory').classList.contains('hidden');
  check('skipping the floor-3 boss ends the run at the victory screen (no strand)', victoryVisible);

  check('zero uncaught errors across all three skips', errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log('  ERR:', e));

  console.log('');
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
