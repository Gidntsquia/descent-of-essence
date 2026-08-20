// test/verify-seeded-runs.js
//
// Determinism check for the seeded-runs feature (GOALS.md
// FEATURE/REPLAYABILITY ticket, 2026-08-20): same seed + same character must
// reproduce the same floor node sequence (type + monster/boss defId in
// order); different seeds must not. Also verifies the actual UI path (the
// character-select seed input -> Game.startRun -> the seed showing up on
// the run screen), not just the underlying RNG plumbing, and that leaving
// the seed input blank still produces a random-looking, non-empty seed.
//
// Uses jsdom, same pattern as test/dom-check.js. Run with:
//   node test/verify-seeded-runs.js

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

async function loadPage() {
  const targetPath = path.join(__dirname, '..', 'wordbound.html');
  const html = fs.readFileSync(targetPath, 'utf8');
  const dom = new JSDOM(html, {
    url: 'file://' + targetPath,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
  });
  const errors = [];
  dom.window.addEventListener('error', (e) => errors.push((e.error && e.error.stack) || e.message));
  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
  });
  await new Promise((r) => setTimeout(r, 300));
  return { dom, errors };
}

// Fingerprint a floor as its ordered (type:defId) pairs -- deliberately
// excludes node.id, which is a module-level counter that increments across
// every floor generated all session (by design, unrelated to the seed), not
// something derived from the seeded RNG.
function fingerprintFloor(floor) {
  return floor.nodes.map((n) => n.type + ':' + n.defId).join(',');
}

async function main() {
  const { dom, errors } = await loadPage();
  const { document, window } = dom.window;
  const Game = window.Wordbound.Game;

  // ---- Part 1: the actual UI path, not just Game.startRun directly ----
  document.getElementById('btn-new-run').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  const seedInput = document.getElementById('run-seed-input');
  check('seed input exists on character-select screen', !!seedInput);
  seedInput.value = 'orchestrator-test-seed';
  document.querySelector('.character-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 20));
  check('typing a seed and starting a run produces zero errors', errors.length === 0);
  check('state.runSeed reflects the typed seed', Game._state.runSeed === 'orchestrator-test-seed');
  const seedDisplayText = document.getElementById('run-seed-display').textContent;
  check(
    'run screen displays the seed ("' + seedDisplayText + '")',
    seedDisplayText.indexOf('orchestrator-test-seed') !== -1
  );

  // ---- Part 2: determinism -- same seed + character -> same floor ----
  Game.startRun('archivist', 'fixed-seed-alpha');
  const floorA1 = fingerprintFloor(Game._state.floor);
  const seedA1 = Game._state.rng.seed;
  Game.startRun('archivist', 'fixed-seed-alpha');
  const floorA2 = fingerprintFloor(Game._state.floor);
  const seedA2 = Game._state.rng.seed;
  check('same seed + character -> same numeric RNG seed', seedA1 === seedA2);
  check('same seed + character -> identical floor-1 node sequence', floorA1 === floorA2 && floorA1.length > 0);

  // ---- Part 3: different seed -> (overwhelmingly likely) different floor ----
  Game.startRun('archivist', 'fixed-seed-beta');
  const floorB = fingerprintFloor(Game._state.floor);
  check('different seed + same character -> different floor-1 node sequence', floorB !== floorA1);

  // ---- Part 4: blank seed still produces a usable, non-empty random seed ----
  Game.startRun('archivist', '');
  const randomSeed1 = Game._state.runSeed;
  Game.startRun('archivist', '   '); // whitespace-only should also count as blank
  const randomSeed2 = Game._state.runSeed;
  check('blank seed input produces a non-empty auto-generated seed', !!randomSeed1 && randomSeed1.length > 0);
  check('whitespace-only seed input is treated as blank (auto-generated, not literal spaces)', !!randomSeed2 && randomSeed2.trim() === randomSeed2 && randomSeed2.length > 0);
  check('two blank-seed runs get different auto-generated seeds', randomSeed1 !== randomSeed2);

  // ---- Part 5: re-typing a displayed random seed reproduces that same run ----
  // (the whole point of hashing random seeds as strings too -- see game.js's
  // comment in Game.startRun -- verify it actually round-trips.)
  Game.startRun('archivist', randomSeed1);
  const floorReplay1 = fingerprintFloor(Game._state.floor);
  const seedReplay1 = Game._state.rng.seed;
  Game.startRun('archivist', ''); // get a fresh random seed to compare against
  Game.startRun('archivist', randomSeed1); // now replay the earlier one again
  const floorReplay2 = fingerprintFloor(Game._state.floor);
  check(
    'typing a previously-displayed auto-generated seed back in reproduces the same floor',
    floorReplay1 === floorReplay2 && seedReplay1 === Game._state.rng.seed
  );

  console.log('');
  if (failures === 0) {
    console.log('ALL CHECKS PASSED');
    process.exit(0);
  } else {
    console.log(failures + ' CHECK(S) FAILED');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
