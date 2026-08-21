// test/verify-boss-item-reward.js
//
// Targeted jsdom check for the boss-kill bonus item-reward feature: after
// defeating a boss, the player should see the normal tile-reward screen,
// THEN a separate rare/legendary item-choice screen, and picking an item
// there should add it to state.player.items before the floor advances.
// A regular (non-boss) kill must NOT show the bonus item screen at all.
//
// Run with `node test/verify-boss-item-reward.js`. Exit code 0 = pass.

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
  const html = fs.readFileSync(path.join(__dirname, '..', 'wordbound.html'), 'utf8');
  const errors = [];

  const dom = new JSDOM(html, {
    url: 'file://' + path.join(__dirname, '..', 'wordbound.html'),
    runScripts: 'dangerously',
    resources: 'usable',
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
  const Tiles = window.Wordbound.Tiles;
  const Monsters = window.Wordbound.Monsters;

  document.getElementById('btn-new-run').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  document.querySelector('.character-option').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));

  const state = Game._state;
  check('run started with zero errors', errors.length === 0);

  // ---- Part 1: boss kill shows tile reward, THEN a separate item-reward screen ----

  // Branching map (GOALS.md, run 2/N): no floor node has been entered yet
  // (the map is showing 2-3 lane choices, nothing selected) -- this test
  // bypasses enterCurrentNode entirely and drives combat state directly, so
  // it needs to both pick a node to mutate into a boss AND mark it as the
  // "current" node itself (state.currentNodeId), same as every other
  // synthetic-node test scenario in this repo.
  const node = state.floor.nodes[0];
  node.type = 'boss';
  node.defId = 'boss_vowelmaw';
  node.cleared = false;
  state.currentNodeId = node.id;
  state.combatActive = true;
  state.monster = Monsters.createBoss('boss_vowelmaw');
  state.monster.hp = 1; // one hit from defeat
  state.player.rack = ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null));

  Game.submitWord('CAT');
  await new Promise((r) => setTimeout(r, 400)); // TILE_PLAY_ANIM_MS delay before the defeat path runs

  check('boss kill produced zero errors', errors.length === 0);
  check('screen is TILE_REWARD immediately after a boss kill', state.screen === 'TILE_REWARD');
  check('tile-reward-panel is visible', !document.getElementById('tile-reward-panel').classList.contains('hidden'));
  check('boss-reward-panel is NOT visible yet (sequential, not stacked)', document.getElementById('boss-reward-panel').classList.contains('hidden'));

  const floorBefore = state.floorNumber;
  Game.skipTileReward();
  await new Promise((r) => setTimeout(r, 50));

  check('after tile reward, screen moves to BOSS_ITEM_REWARD (not straight to next floor)', state.screen === 'BOSS_ITEM_REWARD');
  check('tile-reward-panel is hidden again', document.getElementById('tile-reward-panel').classList.contains('hidden'));
  check('boss-reward-panel is now visible', !document.getElementById('boss-reward-panel').classList.contains('hidden'));
  check('floor has NOT advanced yet (item choice comes first)', state.floorNumber === floorBefore);
  check('bossRewardOptions is a non-empty array of rare/legendary items', Array.isArray(state.bossRewardOptions) && state.bossRewardOptions.length > 0);
  if (state.bossRewardOptions) {
    const Items = window.Wordbound.Items;
    const allRareOrLegendary = state.bossRewardOptions.every((id) => {
      const def = Items.ITEM_DEFS[id];
      return def && (def.rarity === 'rare' || def.rarity === 'legendary');
    });
    check('every offered boss-reward option is rarity rare/legendary', allRareOrLegendary);
  }

  const chosenId = state.bossRewardOptions[0];
  const itemsBefore = state.player.items.length;
  Game.pickBossItemReward(chosenId);
  await new Promise((r) => setTimeout(r, 50));

  check('picking a boss-reward item produces zero errors', errors.length === 0);
  check('picked item was added to state.player.items', state.player.items.length === itemsBefore + 1 && state.player.items.indexOf(chosenId) !== -1);
  check('floor advanced after the item choice was resolved', state.floorNumber === floorBefore + 1);
  check('boss-reward-panel is hidden again after resolving', document.getElementById('boss-reward-panel').classList.contains('hidden'));
  check('screen is back to RUN (node map), not stuck on a reward screen', state.screen === 'RUN');

  // ---- Part 2: a regular (non-boss) kill never shows the item-reward screen ----

  // advanceFloor() (triggered by resolving the boss-item reward above)
  // generated an entirely new state.floor for the next floor, with nothing
  // entered yet -- same situation as the boss node above.
  const node2 = state.floor.nodes[0];
  node2.type = 'combat';
  node2.defId = 'gremlin';
  node2.cleared = false;
  state.currentNodeId = node2.id;
  state.combatActive = true;
  state.monster = Monsters.createMonster('gremlin');
  state.monster.hp = 1;
  state.player.rack = ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null));

  Game.submitWord('CAT');
  await new Promise((r) => setTimeout(r, 400));
  check('regular kill produced zero errors', errors.length === 0);
  check('regular kill goes to TILE_REWARD, same as always', state.screen === 'TILE_REWARD');

  const enteredNodeId = state.currentNodeId;
  Game.skipTileReward();
  await new Promise((r) => setTimeout(r, 50));

  check('after a regular kill\'s tile reward, screen returns straight to RUN (no item-reward detour)', state.screen === 'RUN');
  check('boss-reward-panel stayed hidden the whole time for a non-boss kill', document.getElementById('boss-reward-panel').classList.contains('hidden'));
  check('map position advanced normally for a regular kill', state.mapPositionNodeId === enteredNodeId && state.currentNodeId === null);

  console.log('');
  if (failures === 0) {
    console.log('ALL CHECKS PASSED');
    process.exit(0);
  } else {
    console.log(failures + ' CHECK(S) FAILED');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
