// test/verify-howto-panel.js
//
// Targeted jsdom check for the "How to Play" onboarding panel: it should be
// reachable from a main-menu button at any time, AND auto-show exactly once
// ever the first time a player enters combat (localStorage flag unset ->
// shows; flag set -> stays hidden on every later combat entry). Dismissing
// it (via the close button) must set the flag.
//
// NOTE on the ResourceLoader below: jsdom's real localStorage implementation
// refuses to work for file:// URLs ("opaque origins") -- game.js already
// defensively handles that (try/catch + typeof-undefined guards, same as
// dom-check.js's other localStorage-backed features), but it means a
// file://-loaded jsdom page can never actually persist the seen-flag, which
// would make this test unable to verify the "flag set -> stays hidden"
// behavior at all. Using a fake https:// origin with a ResourceLoader that
// redirects fetches back to the local checkout gives jsdom's real,
// non-opaque localStorage while still loading this repo's actual files.
//
// Run with `node test/verify-howto-panel.js`. Exit code 0 = pass.

const fs = require('fs');
const path = require('path');
const { JSDOM, ResourceLoader } = require('jsdom');

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log('OK   ' + label);
  } else {
    console.log('FAIL ' + label);
    failures++;
  }
}

class LocalResourceLoader extends ResourceLoader {
  fetch(url) {
    const parsed = new URL(url);
    const localPath = path.join(__dirname, '..', parsed.pathname);
    return Promise.resolve(fs.readFileSync(localPath));
  }
}

async function main() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'wordbound.html'), 'utf8');
  const errors = [];

  const dom = new JSDOM(html, {
    url: 'https://wordbound.local/wordbound.html',
    runScripts: 'dangerously',
    resources: new LocalResourceLoader(),
    pretendToBeVisual: true,
  });

  dom.window.addEventListener('error', (e) => {
    errors.push((e.error && e.error.stack) || e.message);
  });

  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
  });
  await new Promise((r) => setTimeout(r, 300));

  const { document, window } = dom.window;
  const Game = window.Wordbound.Game;

  check('window.Wordbound.Game exists', !!Game);
  check('page loaded with zero uncaught errors', errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log('  ERR:', e));

  // ---- Part 1: openable from the main menu at any time, before ever seeing it ----

  const overlay = document.getElementById('howto-overlay');
  check('howto-overlay hidden on fresh page load', overlay.classList.contains('hidden'));
  check('localStorage flag unset on fresh page load', window.localStorage.getItem('wordbound_seen_howto') === null);

  document.getElementById('btn-how-to-play').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('opens from the main-menu button', !overlay.classList.contains('hidden'));
  document.getElementById('btn-close-howto').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('closes via its own close button', overlay.classList.contains('hidden'));
  check('dismissing from the menu button already marks it seen', window.localStorage.getItem('wordbound_seen_howto') === '1');

  // Reset the flag so Part 2 can test the auto-show-on-first-combat path from
  // a clean "never seen it" state, same as a real first-time player.
  window.localStorage.removeItem('wordbound_seen_howto');
  check('flag reset for the auto-show test', window.localStorage.getItem('wordbound_seen_howto') === null);

  // ---- Part 2: auto-shows exactly once, on the first-ever combat entry ----

  document.getElementById('btn-new-run').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  document.querySelector('.character-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  check('run started with zero errors', errors.length === 0);

  const state = Game._state;
  const nodePill = document.querySelector('.node-pill.node-current');
  check('a clickable current node exists', !!nodePill);
  nodePill.dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));

  check('combat is active after entering the node', state.combatActive === true);
  check('auto-shows on first-ever combat entry (flag was unset)', !overlay.classList.contains('hidden'));
  check('flag still unset while the panel is up (not dismissed yet)', window.localStorage.getItem('wordbound_seen_howto') === null);

  document.getElementById('btn-close-howto').dispatchEvent(new window.Event('click', { bubbles: true }));
  check('dismiss hides the auto-shown panel', overlay.classList.contains('hidden'));
  check('dismiss sets the seen flag', window.localStorage.getItem('wordbound_seen_howto') === '1');

  // ---- Part 3: never auto-shows again once the flag is set ----
  // Re-enter the same (still uncleared, not-yet-defeated) combat node, which
  // re-runs startCombat's auto-show check a second time.

  state.combatActive = false;
  Game.enterCurrentNode();
  await new Promise((r) => setTimeout(r, 50));

  check('re-entering combat produced zero errors', errors.length === 0);
  check('combat is active again', state.combatActive === true);
  check('does NOT auto-show a second time (flag already set)', overlay.classList.contains('hidden'));

  // Manual open must still work at any time regardless of the seen flag.
  Game.openHowToPlay();
  check('manual open still works after the flag is set', !overlay.classList.contains('hidden'));
  Game.closeHowToPlay();
  check('manual close still works, panel hides again', overlay.classList.contains('hidden'));

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('SCRIPT CRASHED:', e); process.exit(1); });
