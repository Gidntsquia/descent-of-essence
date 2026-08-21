// test/orchestrator-qa-boss-reward.js
//
// Orchestrator real-browser QA pass (2026-08-20, post-v0.8): drives the game
// in headless Chromium with REAL Playwright clicks/typing (not jsdom event
// dispatch), focused on the boss-kill bonus item reward feature that landed
// in v0.8 plus an organic first-fight smoke test. This is the "heavier
// Playwright-based pass" ROADMAP.md assigns to the orchestrator, run against
// a local static server the same way verify-mobile-layout.js does.
//
// Coverage:
//   1. Organic path: main menu -> New Run -> character select -> node map ->
//      first combat, playing real words typed into #word-input, all via
//      Playwright's actionability-checked .click() (fails on hidden/covered
//      elements, unlike jsdom).
//   2. Boss kill -> tile reward (real click) -> boss item reward panel
//      (rare/legendary only) -> real click an item -> item chip appears,
//      floor advances. Panels asserted strictly sequential, never stacked.
//   3. Skip path on the next floor's boss, at a 375px mobile viewport, with
//      a horizontal-overflow and tap-target check on the new panel.
//   4. Zero console errors / page errors across the whole run.
//
// Test scaffolding notes (setup vs. interaction): jumping the run position
// to the boss node and topping up player ink go through Game._state -- that's
// setup, kept out of the assertions. Every INTERACTION being verified
// (entering nodes, playing words, picking rewards) is a real click or real
// typing on the visible UI.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

const PORT = 9881;
const ROOT = path.join(__dirname, '..');
let server;

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const filePath = path.join(ROOT, urlPath === '/' ? 'wordbound.html' : urlPath);
      if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        return res.end('not found');
      }
      const ext = path.extname(filePath);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(PORT, resolve);
  });
}

let failures = 0;
function check(label, cond) {
  console.log((cond ? 'OK   ' : 'FAIL ') + label);
  if (!cond) failures++;
}

// Page-side: build (once) a sorted-letters -> word index for short words,
// then find a playable word for the current rack by subset lookup. Returns
// the word string or null. Blanks are skipped (they only add options).
//
// Word novelty + combo streaks (GOALS.md "FUN OVERHAUL 1/8"): prefers a word
// NOT already played this fight (real per-fight state at
// Game._state.comboState.usedWords, same Set combat.js checks) over the
// otherwise-longest one, so this bot actually builds and exercises combo
// streaks instead of happily eating the x0.4 repeat penalty every fight
// (which it would, since "longest word for this rack shape" repeats often
// once the deck cycles back to a similar draw). Falls back to the best word
// overall (a repeat) only when every playable word this rack can form has
// already been used this fight -- better than NO_WORD_FOUND.
//
// Monster intents (GOALS.md "FUN OVERHAUL 2/8"): also excludes a Hex'd tile
// (Game._state.hexedTileId) from the candidate letter pool, matching the
// real UI constraint (a hexed tile is greyed out/unplayable for one turn --
// see game.js's own splice-guard in Game.submitWord). Found live: without
// this, a bot that picks the single "best" word for the rack's full letter
// set can get stuck submitting the SAME word every turn if that word
// happens to require the now-locked tile with no duplicate available --
// Combat.playWord correctly rejects it every time, which (also correctly)
// never cycles the rack, so the identical rejected word gets recomputed and
// resubmitted forever. Not a real softlock for a human player (any OTHER
// word from the same rack that avoids that one tile still works fine), but
// it stalls this bot's single-best-word strategy, which has no fallback.
const FIND_WORD_FN = `
(function findPlayableWord() {
  var W = window.Wordbound;
  if (!window.__anagramIndex) {
    var idx = new Map();
    var list = W.WORDLIST || [];
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (w.length < 2 || w.length > 8) continue;
      var key = w.split('').sort().join('');
      if (!idx.has(key)) idx.set(key, w);
    }
    window.__anagramIndex = idx;
  }
  var rack = W.Game._state.player.rack;
  var hexedTileId = W.Game._state.hexedTileId;
  var usedWords = (W.Game._state.comboState && W.Game._state.comboState.usedWords) || new Set();
  var letters = [];
  for (var r = 0; r < rack.length; r++) {
    if (rack[r].letter !== '?' && rack[r].id !== hexedTileId) letters.push(rack[r].letter);
  }
  var n = letters.length;
  var bestUnused = null;
  var bestAny = null;
  for (var mask = 1; mask < (1 << n); mask++) {
    var subset = [];
    for (var b = 0; b < n; b++) if (mask & (1 << b)) subset.push(letters[b]);
    if (subset.length < 2) continue;
    var word = window.__anagramIndex.get(subset.slice().sort().join(''));
    if (!word) continue;
    if (!bestAny || word.length > bestAny.length) bestAny = word;
    if (!usedWords.has(word) && (!bestUnused || word.length > bestUnused.length)) bestUnused = word;
  }
  return bestUnused || bestAny;
})()
`;

async function playOneWord(page) {
  const word = await page.evaluate(FIND_WORD_FN);
  if (!word) return null; // ensureRackIsPlayable should make this impossible
  await page.fill('#word-input', '');
  await page.type('#word-input', word);
  await page.click('#btn-submit-word');
  // TILE_PLAY_ANIM_MS (220ms) defers defeat/counterattack processing; a
  // killing blow additionally holds a MONSTER_DEATH_BEAT_MS (500ms) beat
  // before the screen actually switches away from combat -- wait past both,
  // not just the tile-play animation, or fightUntilOver's next-turn check
  // can see combatActive still true and submit into an already-dead monster.
  await page.waitForTimeout(800);
  return word;
}

async function fightUntilOver(page, maxTurns) {
  for (let t = 0; t < maxTurns; t++) {
    const st = await page.evaluate(
      '({ combatActive: window.Wordbound.Game._state.combatActive, screen: window.Wordbound.Game._state.screen })'
    );
    if (!st.combatActive) return st.screen;
    const word = await playOneWord(page);
    if (!word) return 'NO_WORD_FOUND';
  }
  return 'MAX_TURNS';
}

async function main() {
  await startServer();
  const sandboxChromiumPath = '/opt/pw-browsers/chromium';
  const launchOpts = { headless: true };
  if (fs.existsSync(sandboxChromiumPath)) launchOpts.executablePath = sandboxChromiumPath;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();

  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
  });
  page.on('requestfailed', (req) => {
    errors.push('requestfailed: ' + req.url());
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      errors.push('http ' + res.status() + ': ' + res.url());
    }
  });

  await page.goto(`http://localhost:${PORT}/wordbound.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.Wordbound && window.Wordbound.Game && window.Wordbound.Game._state');

  // ---- Phase 1: organic first-five-minutes with real clicks ----
  await page.click('#btn-new-run');
  await page.click('.character-option'); // first character
  check('run starts via real clicks (character select reachable and clickable)', true);

  // give the boss fights headroom so QA doesn't flake on player death (setup, not interaction)
  await page.evaluate('(function(){var p=window.Wordbound.Game._state.player;p.maxInk=200;p.ink=200;})()');

  await page.click('.node-pill.node-current');
  const firstNodeState = await page.evaluate(
    '({ combatActive: window.Wordbound.Game._state.combatActive, screen: window.Wordbound.Game._state.screen })'
  );
  // first node may be any type; if it's combat, fight it organically
  if (firstNodeState.combatActive) {
    // How to Play auto-shows once on a browser's very first-ever combat entry
    // (localStorage-gated) and intercepts pointer events over the combat
    // panel until dismissed -- clear it before trying to play a word.
    if (await page.isVisible('#howto-overlay')) {
      await page.click('#btn-close-howto');
    }
    const outcome = await fightUntilOver(page, 15);
    check('organic first combat resolves without stalling (outcome: ' + outcome + ')', outcome !== 'MAX_TURNS' && outcome !== 'NO_WORD_FOUND');
    if (outcome === 'TILE_REWARD') {
      check('non-boss kill: boss-reward panel stays hidden during tile reward', await page.isHidden('#boss-reward-panel'));
      await page.click('#btn-skip-tile-reward');
      check('non-boss kill: after tile reward, back to node map (no boss item screen)', await page.isVisible('#node-map'));
    }
  } else {
    console.log('INFO first node was type ' + firstNodeState.screen + ', combat smoke-test happens on the boss instead');
  }

  // ---- Phase 2: boss kill -> tile reward -> boss item reward (pick path) ----
  // BRANCHING MAP (GOALS.md, run 2/N): there's no flat index to jump to
  // anymore -- what makes a node "current"/clickable is availableNodeIds(),
  // which is graph-derived from state.mapPositionNodeId. Every node in the
  // floor's last encounter row has exactly one outgoing edge, straight to
  // the boss (see Floor.generateBranchingFloor), so standing on any one of
  // them makes the boss the sole available next node -- the branching
  // equivalent of "jump straight to the boss" for QA purposes.
  await page.evaluate(`(function () {
    var s = window.Wordbound.Game._state;
    var floor = s.floor;
    var lastRowNode = floor.nodes.find(function (n) { return n.row === floor.rows - 1; });
    floor.nodes.forEach(function (n) { if (n.type !== 'boss') n.cleared = true; });
    s.mapPositionNodeId = lastRowNode.id;
    s.currentNodeId = null;
    s.screen = 'RUN';
    window.Wordbound.Game._state.deckViewerOpen = false;
    window.Wordbound.Game.returnToMainMenu; // no-op reference, keep render via enter below
  })()`);
  // re-render the node map so the boss pill is the clickable current node
  await page.evaluate('window.Wordbound.Game.showCharacterSelect && void 0'); // no-op
  await page.evaluate('(function(){ var G = window.Wordbound.Game; G._state.screen = "RUN"; })()');
  // Force a render by toggling a harmless open/close (render() is module-internal)
  await page.evaluate('window.Wordbound.Game.openDeckViewer(); window.Wordbound.Game.closeDeckViewer();');

  const bossPill = await page.evaluate('document.querySelector(".node-pill.node-current") && document.querySelector(".node-pill.node-current").textContent');
  check('boss node pill is the clickable current node and shows a trait hint ("' + (bossPill || '') + '")', !!bossPill && /BOSS/.test(bossPill) && bossPill.indexOf('—') !== -1);

  await page.click('.node-pill.node-current');
  check('boss combat starts via real click', await page.evaluate('window.Wordbound.Game._state.combatActive === true && window.Wordbound.Game._state.monster.isBoss === true'));
  // Review F2 (2026-08-20): boss music never stopped after the boss died,
  // bleeding through the tile reward/hoard screens and the next floor's
  // map. Real Chromium (unlike jsdom, which has no Web Audio API) actually
  // creates an AudioContext, so this is the one place that can verify the
  // internal music-mode variable end to end.
  check('boss music mode switches to boss on fight start', await page.evaluate('window.Wordbound.Game._getMusicMode() === "boss"'));

  const floorBefore = await page.evaluate('window.Wordbound.Game._state.floorNumber');
  const bossOutcome = await fightUntilOver(page, 40);
  check('boss fight ends at the tile-reward screen (outcome: ' + bossOutcome + ')', bossOutcome === 'TILE_REWARD');
  check('boss music mode switches back to normal right after the kill', await page.evaluate('window.Wordbound.Game._getMusicMode() === "normal"'));

  check('tile-reward panel visible after boss kill', await page.isVisible('#tile-reward-panel'));
  check('boss-reward panel NOT visible yet (sequential, not stacked)', await page.isHidden('#boss-reward-panel'));

  await page.click('#tile-reward-choices .treasure-choice'); // real click: take a tile
  check('after tile pick: boss-reward panel visible', await page.isVisible('#boss-reward-panel'));
  check('after tile pick: tile-reward panel hidden again', await page.isHidden('#tile-reward-panel'));
  check('after tile pick: node map hidden while boss reward shows', await page.isHidden('#node-map'));

  const options = await page.evaluate(`(function () {
    var s = window.Wordbound.Game._state;
    var Items = window.Wordbound.Items;
    return (s.bossRewardOptions || []).map(function (id) { return Items.ITEM_DEFS[id].rarity; });
  })()`);
  check('boss reward offers only rare/legendary items (' + options.join(',') + ')', options.length > 0 && options.every((r) => r === 'rare' || r === 'legendary'));

  const chipCountBefore = await page.evaluate('document.querySelectorAll("#items-owned .item-chip").length');
  await page.click('#boss-reward-choices .treasure-choice'); // real click: claim the item
  await page.waitForTimeout(100);
  const floorAfter = await page.evaluate('window.Wordbound.Game._state.floorNumber');
  const chipCountAfter = await page.evaluate('document.querySelectorAll("#items-owned .item-chip").length');
  check('claiming the boss item advances the floor (' + floorBefore + ' -> ' + floorAfter + ')', floorAfter === floorBefore + 1);
  check('claimed item appears as a real chip in the items strip', chipCountAfter === chipCountBefore + 1);
  check('boss-reward panel hidden after claiming', await page.isHidden('#boss-reward-panel'));
  check('node map visible again on the new floor', await page.isVisible('#node-map'));

  // ---- Phase 3: skip path at 375px mobile viewport ----
  await page.setViewportSize({ width: 375, height: 720 });
  await page.evaluate(`(function () {
    var s = window.Wordbound.Game._state;
    var floor = s.floor;
    var lastRowNode = floor.nodes.find(function (n) { return n.row === floor.rows - 1; });
    floor.nodes.forEach(function (n) { if (n.type !== 'boss') n.cleared = true; });
    s.mapPositionNodeId = lastRowNode.id;
    s.currentNodeId = null;
    s.player.ink = 200;
  })()`);
  await page.evaluate('window.Wordbound.Game.openDeckViewer(); window.Wordbound.Game.closeDeckViewer();');
  await page.click('.node-pill.node-current');
  const boss2Outcome = await fightUntilOver(page, 40);
  check('second boss fight (375px viewport) ends at tile reward (outcome: ' + boss2Outcome + ')', boss2Outcome === 'TILE_REWARD');

  await page.click('#btn-skip-tile-reward');
  check('skip path: boss-reward panel visible after skipping the tile', await page.isVisible('#boss-reward-panel'));

  const layout = await page.evaluate(`(function () {
    var overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    var panel = document.getElementById('boss-reward-panel');
    var r = panel.getBoundingClientRect();
    var btns = panel.querySelectorAll('button');
    var minH = Infinity;
    btns.forEach(function (b) { var br = b.getBoundingClientRect(); if (br.height < minH) minH = br.height; });
    return { overflow: overflow, panelRight: r.right, viewport: document.documentElement.clientWidth, minBtnHeight: minH, btnCount: btns.length };
  })()`);
  check('375px: no horizontal overflow with boss-reward panel open (overflow=' + layout.overflow + 'px)', layout.overflow <= 0);
  check('375px: boss-reward panel fits the viewport (right edge ' + Math.round(layout.panelRight) + ' <= ' + layout.viewport + ')', layout.panelRight <= layout.viewport + 1);
  check('375px: boss-reward buttons are tappable-height (min ' + Math.round(layout.minBtnHeight) + 'px across ' + layout.btnCount + ' buttons)', layout.minBtnHeight >= 36);

  const floorBeforeSkip = await page.evaluate('window.Wordbound.Game._state.floorNumber');
  await page.click('#btn-skip-boss-reward');
  await page.waitForTimeout(100);
  const floorAfterSkip = await page.evaluate('window.Wordbound.Game._state.floorNumber');
  check('skip path: skipping the boss item still advances the floor (' + floorBeforeSkip + ' -> ' + floorAfterSkip + ')', floorAfterSkip === floorBeforeSkip + 1);

  // ---- Errors across the whole run ----
  check('zero console/page errors across the whole QA run', errors.length === 0);
  if (errors.length) errors.slice(0, 10).forEach((e) => console.log('  ERR:', e));

  await browser.close();
  server.close();

  console.log('');
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  if (server) server.close();
  process.exit(1);
});
