// test/verify-branching-map.js
//
// Invariant sweep for Floor.generateBranchingFloor (GOALS.md FEATURE/
// STRUCTURAL "branching floor map" ticket, in progress since 2026-08-21).
// This function is NOT wired into game.js yet (game.js still calls the
// old linear Floor.generateFloor) -- this script exists purely to prove
// the generation algorithm's guarantees hold across many seeds BEFORE the
// riskier next step of rewiring game.js's flow control and building the
// map UI. Same jsdom-loading pattern as test/verify-seeded-runs.js.
//
// Run with: node test/verify-branching-map.js

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

// node.id is a module-level counter that increments across every floor
// generated all session (by design, unrelated to the seed -- same caveat
// test/verify-seeded-runs.js documents for the linear generator's own
// fingerprint), so identify nodes/edges by (row,lane) instead of raw id.
function fingerprint(bf) {
  const posById = {};
  bf.nodes.forEach((n) => { posById[n.id] = n.row + ',' + n.lane; });
  return bf.lanes + '|' + bf.rows + '|' +
    bf.nodes.map((n) => n.row + ',' + n.lane + ',' + n.type + ',' + n.defId).sort().join(';') + '|' +
    bf.edges.map((e) => posById[e[0]] + '->' + posById[e[1]]).sort().join(';');
}

async function main() {
  const { dom, errors } = await loadPage();
  const { window } = dom.window;
  check('page loads with zero console errors', errors.length === 0);

  const Floor = window.Wordbound.Floor;
  const RNG = window.Game.RNG;
  check('Floor.generateBranchingFloor exists', typeof Floor.generateBranchingFloor === 'function');
  check('Floor.reachableNodeIds exists', typeof Floor.reachableNodeIds === 'function');

  const N = 60; // seeds per floor number, well past the "50+ seeds" the ticket asks for
  const typeCounts = { treasure: 0, shop: 0, rest: 0, elite: 0 };
  let allBossReachableFromEveryStart = true;
  let allLanesInRange = true;
  let allRowsInRange = true;
  let allExactlyOneTreasure = true;
  let allExactlyOneShop = true;
  let floor1EverHasRest = false;
  let floor2PlusAlwaysHasRest = true;
  let floor1NeverHasElite = true;
  let eliteFloorsSometimesHaveElite = false;
  let eliteAlwaysAtMostOne = true;
  let eliteAlwaysAvoidable = true;
  let allNodesReachableFromSomeStart = true;

  for (let floorNumber = 1; floorNumber <= 3; floorNumber++) {
    for (let i = 0; i < N; i++) {
      const rng = RNG.create('branching-map-test-f' + floorNumber + '-' + i);
      const bf = Floor.generateBranchingFloor(floorNumber, rng);

      if (bf.lanes < 2 || bf.lanes > 3) allLanesInRange = false;
      if (bf.rows < 6 || bf.rows > 8) allRowsInRange = false;

      const reachable = Floor.reachableNodeIds(bf, bf.startNodeIds, null);
      if (reachable.indexOf(bf.bossNodeId) === -1) allBossReachableFromEveryStart = false;
      // stronger: boss reachable from EVERY individual start lane, not just the union
      bf.startNodeIds.forEach((startId) => {
        const r = Floor.reachableNodeIds(bf, [startId], null);
        if (r.indexOf(bf.bossNodeId) === -1) allBossReachableFromEveryStart = false;
      });
      bf.nodes.forEach((n) => {
        if (reachable.indexOf(n.id) === -1) allNodesReachableFromSomeStart = false;
      });

      const byType = {};
      bf.nodes.forEach((n) => { byType[n.type] = (byType[n.type] || 0) + 1; });
      typeCounts.treasure += byType.treasure || 0;
      typeCounts.shop += byType.shop || 0;
      typeCounts.rest += byType.rest || 0;
      typeCounts.elite += byType.elite || 0;

      if ((byType.treasure || 0) !== 1) allExactlyOneTreasure = false;
      if ((byType.shop || 0) !== 1) allExactlyOneShop = false;

      if (floorNumber === 1 && (byType.rest || 0) > 0) floor1EverHasRest = true;
      if (floorNumber >= 2 && (byType.rest || 0) !== 1) floor2PlusAlwaysHasRest = false;

      if (floorNumber === 1 && (byType.elite || 0) > 0) floor1NeverHasElite = false;
      if (floorNumber >= 2) {
        if ((byType.elite || 0) > 1) eliteAlwaysAtMostOne = false;
        if ((byType.elite || 0) === 1) {
          eliteFloorsSometimesHaveElite = true;
          const eliteNode = bf.nodes.filter((n) => n.type === 'elite')[0];
          // Avoidable-at-a-cost: a route to the boss must exist from some
          // start node that never passes through the elite node.
          let avoidable = false;
          bf.startNodeIds.forEach((startId) => {
            if (startId === eliteNode.id) return;
            const r = Floor.reachableNodeIds(bf, [startId], eliteNode.id);
            if (r.indexOf(bf.bossNodeId) !== -1) avoidable = true;
          });
          if (!avoidable) eliteAlwaysAvoidable = false;
        }
      }

      // Determinism: same seed -> byte-identical structure.
      const rng2 = RNG.create('branching-map-test-f' + floorNumber + '-' + i);
      const bf2 = Floor.generateBranchingFloor(floorNumber, rng2);
      if (fingerprint(bf) !== fingerprint(bf2)) {
        check('determinism holds for floor ' + floorNumber + ' seed index ' + i, false);
      }
    }
  }

  check('lanes always in [2,3]', allLanesInRange);
  check('rows always in [6,8]', allRowsInRange);
  check('boss reachable from every individual start node, every seed/floor', allBossReachableFromEveryStart);
  check('every generated node is reachable from some start node (no orphans)', allNodesReachableFromSomeStart);
  check('exactly one treasure node every seed/floor (' + typeCounts.treasure + ' total across ' + (N * 3) + ' floors)', allExactlyOneTreasure);
  check('exactly one shop node every seed/floor (' + typeCounts.shop + ' total across ' + (N * 3) + ' floors)', allExactlyOneShop);
  check('floor 1 never generates a rest node', !floor1EverHasRest);
  check('floors 2-3 always generate exactly one rest node', floor2PlusAlwaysHasRest);
  check('floor 1 never generates an elite node', floor1NeverHasElite);
  check('elite floors (2-3) generate an elite node at least sometimes (' + typeCounts.elite + '/' + (N * 2) + ')', eliteFloorsSometimesHaveElite);
  check('elite floors never generate more than one elite node', eliteAlwaysAtMostOne);
  check('whenever an elite node exists, a route to the boss avoiding it also exists', eliteAlwaysAvoidable);

  // Different seeds -> different maps (sanity the generator isn't degenerate).
  const rngX = RNG.create('branching-map-variety-x');
  const rngY = RNG.create('branching-map-variety-y');
  const bfX = Floor.generateBranchingFloor(2, rngX);
  const bfY = Floor.generateBranchingFloor(2, rngY);
  check('different seeds produce different maps', fingerprint(bfX) !== fingerprint(bfY));

  // Old linear generator must be completely untouched by this addition.
  const rngOld = RNG.create('branching-map-linear-regression-check');
  const oldFloor = Floor.generateFloor(1, rngOld);
  check('old Floor.generateFloor (linear) still works unchanged', Array.isArray(oldFloor.nodes) && oldFloor.nodes.length > 0 && oldFloor.nodes[oldFloor.nodes.length - 1].type === 'boss');

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
