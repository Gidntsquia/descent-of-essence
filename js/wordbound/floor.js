// js/wordbound/floor.js
// Node-map floor structure: replaces the old game's room-grid/tile-dungeon
// entirely. A floor is a single ordered path of nodes (Balatro's blind
// sequence, not a Slay-the-Spire branching graph) -- deliberately no choice
// of path, because the design mandate coming out of the old game's rework
// was "immediately obvious what the player needs to do." One node at a
// time, always ending in the floor's boss.
//
// PUBLIC API (window.Wordbound.Floor):
//   TOTAL_FLOORS = 3
//   ELITE_FLOOR_NUMBERS = [2, 3]
//   generateFloor(floorNumber, rng) -> {
//     floorNumber,
//     nodes: [{ id, type: 'combat'|'elite'|'treasure'|'rest'|'boss',
//               defId (monster/boss id, only for combat/elite/boss),
//               cleared: false }],
//   }
//     Node count is randInt(6,8) + 1 boss node appended. Exactly one
//     'treasure' node; a 'rest' node only on floor >= 2; an 'elite' node
//     only on ELITE_FLOOR_NUMBERS. First node is always 'combat' (eases the
//     player in rather than opening on a special room). Order of the
//     remaining special nodes among the combat filler is randomized, boss is
//     always last.

(function () {
  window.Wordbound = window.Wordbound || {};
  var Floor = (window.Wordbound.Floor = {});

  Floor.TOTAL_FLOORS = 3;
  Floor.ELITE_FLOOR_NUMBERS = [2, 3];

  // FUN OVERHAUL 6/8 (GOALS.md, 2026-08-20): the three RESISTANCE traits
  // (0.3x-floor: most words barely dent it, one specific pattern cuts deep).
  // These were pulled off regular monsters/bosses in the 2026-08-19/20
  // balance pass for being too punishing UNTELEGRAPHED -- which is exactly
  // what makes them right for a LABELED elite, whose node pill warns the
  // player of the exact weakness BEFORE they enter (see game.js
  // renderNodeMap). One is rolled per elite node at floor-generation time and
  // stored on the node so both the pre-entry warning and the in-fight monster
  // read the same trait.
  Floor.ELITE_RESISTANCE_TRAITS = ['vowelless', 'shortFuse', 'alphabetic'];

  function getAllowedTiers(floorNumber) {
    if (floorNumber <= 1) return ['weak', 'normal'];
    if (floorNumber === 2) return ['weak', 'normal', 'strong'];
    return ['normal', 'strong'];
  }

  function pickCombatDefId(floorNumber, rng) {
    var Monsters = window.Wordbound.Monsters;
    var allowed = getAllowedTiers(floorNumber);
    var pool = Object.keys(Monsters.MONSTER_DEFS).filter(function (id) {
      return allowed.indexOf(Monsters.MONSTER_DEFS[id].tier) !== -1;
    });
    return rng.choice(pool);
  }

  function pickEliteDefId(rng) {
    var Monsters = window.Wordbound.Monsters;
    var pool = Object.keys(Monsters.MONSTER_DEFS).filter(function (id) {
      return Monsters.MONSTER_DEFS[id].tier === 'strong';
    });
    return rng.choice(pool);
  }

  function pickBossDefId(floorNumber) {
    var Monsters = window.Wordbound.Monsters;
    var ids = Object.keys(Monsters.BOSS_DEFS).filter(function (id) {
      return Monsters.BOSS_DEFS[id].floor === floorNumber;
    });
    if (ids.length === 0) throw new Error('Floor.generateFloor: no boss def for floor ' + floorNumber);
    return ids[0];
  }

  var nextNodeId = 1;

  Floor.generateFloor = function (floorNumber, rng) {
    var nodeCount = rng.randInt(6, 8);
    var hasElite = Floor.ELITE_FLOOR_NUMBERS.indexOf(floorNumber) !== -1;
    // REVERTED (2026-08-20 rebalance ROUND 3, then reverted as 3c): tried
    // giving floor 1 a guaranteed rest node (same as floors 2-3) to ease
    // floor-2's death-share numbers, on the theory that some floor-2
    // deaths were really floor-1 damage landing a floor late. Tried at both
    // full (50% maxHp) and quarter (25%) heal strength -- BOTH overshot the
    // win-rate band badly (73% and 67% respectively, target 35-50%), and
    // fully re-trivialized the floor-1 boss both times (0/29 kills). Turns
    // out the heal amount wasn't the only lever: with nodeCount fixed at
    // 6-8, adding 'rest' to floor 1's specials list also TRADES AWAY one of
    // its filler combat encounters (see fillerCount below), so even the
    // diluted version was cutting both floor-1 damage exposure AND healing
    // it at the same time -- a much stronger combined effect than intended.
    // See PROGRESS.md for the full round-3/3b/3c trail. Reverted to the
    // original floor2+ threshold; pursuing floor2/floor3 balance through
    // monster/boss stats instead (round 2's approach, which landed in-band).
    var hasRest = floorNumber >= 2;
    var hasShop = true;
    var hasEvent = floorNumber >= 1; // events on all floors

    var specials = ['treasure'];
    if (hasElite) specials.push('elite');
    if (hasRest) specials.push('rest');
    if (hasShop) specials.push('shop');
    if (hasEvent && rng.chance(0.6)) specials.push('event'); // 60% chance per floor

    var fillerCount = nodeCount - 1 - specials.length; // -1 reserves the guaranteed first combat node
    if (fillerCount < 0) fillerCount = 0;

    var body = specials.slice();
    for (var i = 0; i < fillerCount; i++) body.push('combat');
    body = rng.shuffle(body);

    var types = ['combat'].concat(body).concat(['boss']);

    var nodes = types.map(function (type) {
      var defId = null;
      var eliteTraitId = null;
      if (type === 'combat') defId = pickCombatDefId(floorNumber, rng);
      else if (type === 'elite') {
        defId = pickEliteDefId(rng);
        // Roll the resistance trait here (not at fight start) so the node map
        // can warn the player before entry -- see game.js startCombat, which
        // applies this exact trait, and renderNodeMap, which shows its hint.
        eliteTraitId = rng.choice(Floor.ELITE_RESISTANCE_TRAITS);
      }
      else if (type === 'boss') defId = pickBossDefId(floorNumber);
      else if (type === 'event') defId = (window.Wordbound && window.Wordbound.Events) ? window.Wordbound.Events.pickRandomEvent(rng) : null;
      return { id: 'node' + (nextNodeId++), type: type, defId: defId, eliteTraitId: eliteTraitId, cleared: false };
    });

    return { floorNumber: floorNumber, nodes: nodes };
  };

  // ---------------------------------------------------------------------
  // BRANCHING MAP (GOALS.md FEATURE/STRUCTURAL ticket, started 2026-08-21):
  // a small DAG replacing the single linear path above, so the player
  // CHOOSES a route through each floor instead of walking one fixed
  // sequence. This function is new and purely additive -- game.js still
  // calls `generateFloor` above, so this run makes ZERO behavior change to
  // the shipped game. The generation algorithm (the part most likely to
  // have subtle correctness bugs: guaranteeing every path reaches the
  // boss, a shop+rest exist on some path, an elite is always avoidable) is
  // built and proven in isolation first, with its own seed-swept test
  // suite (test/verify-branching-map.js), before the riskier next step of
  // rewriting game.js's flow control and building the map UI -- see
  // PROGRESS.md and this ticket's own queue entry for the wiring plan.
  //
  // Shape returned:
  //   {
  //     floorNumber, lanes (2-3), rows (encounter rows before the boss),
  //     nodes: [{ id, row, lane, type, defId, eliteTraitId, cleared }],
  //     edges: [[fromId, toId], ...],  // directed, row N -> row N+1
  //     startNodeIds: [...],           // row-0 node ids, one per lane
  //     bossNodeId,
  //   }
  // Guarantees (see test/verify-branching-map.js for the actual checks):
  //   - every startNodeIds node can reach bossNodeId
  //   - 'shop', 'treasure', and (floors >= 2) 'rest' each appear once per
  //     GUARANTEED_LANES (min(2, lanes) -- see the balance-retune comment at
  //     their seating code below), each instance reachable from its own
  //     start lane. A 3-lane floor's third lane carries no such guarantee.
  //   - on elite floors, at most one 'elite' node, only ever placed in a
  //     row that has another node too, so a route to the boss that never
  //     visits it always exists (avoidable-at-a-cost, never mandatory)
  Floor.generateBranchingFloor = function (floorNumber, rng) {
    var LANES = rng.randInt(2, 3);
    var ROWS = rng.randInt(6, 8); // encounter rows; boss sits at row ROWS
    var hasElite = Floor.ELITE_FLOOR_NUMBERS.indexOf(floorNumber) !== -1;
    var hasRest = floorNumber >= 2;

    var nodeAt = {}; // 'row,lane' -> node object
    var edgeKeys = {}; // 'fromId>toId' -> true, dedupe
    var edges = [];

    function key(row, lane) { return row + ',' + lane; }

    function ensureNode(row, lane) {
      var k = key(row, lane);
      if (!nodeAt[k]) {
        nodeAt[k] = { id: 'node' + (nextNodeId++), row: row, lane: lane, type: null, defId: null, eliteTraitId: null, cleared: false };
      }
      return nodeAt[k];
    }

    function addEdge(fromNode, toNode) {
      var ek = fromNode.id + '>' + toNode.id;
      if (!edgeKeys[ek]) { edgeKeys[ek] = true; edges.push([fromNode.id, toNode.id]); }
    }

    var allPaths = [];
    for (var startLane = 0; startLane < LANES; startLane++) {
      var lane = startLane;
      var path = [{ row: 0, lane: lane }];
      ensureNode(0, lane);
      for (var r = 1; r < ROWS; r++) {
        var delta = rng.choice([-1, 0, 1]);
        var nextLane = Math.max(0, Math.min(LANES - 1, lane + delta));
        addEdge(ensureNode(r - 1, lane), ensureNode(r, nextLane));
        path.push({ row: r, lane: nextLane });
        lane = nextLane;
      }
      allPaths.push(path);
    }

    // Boss: single terminal node every row-(ROWS-1) node connects into.
    var bossNode = { id: 'node' + (nextNodeId++), row: ROWS, lane: 0, type: 'boss', defId: pickBossDefId(floorNumber), eliteTraitId: null, cleared: false };
    Object.keys(nodeAt).forEach(function (k) {
      var n = nodeAt[k];
      if (n.row === ROWS - 1) addEdge(n, bossNode);
    });

    // Row occupancy, needed for the "elite must be avoidable" placement rule.
    var rowNodes = {};
    Object.keys(nodeAt).forEach(function (k) {
      var n = nodeAt[k];
      rowNodes[n.row] = rowNodes[n.row] || [];
      rowNodes[n.row].push(n);
    });

    // Row 0 is always 'combat' (ease-in, matches the old linear design).
    rowNodes[0].forEach(function (n) { n.type = 'combat'; n.defId = pickCombatDefId(floorNumber, rng); });

    // Seat the required specials on GUARANTEED_LANES worth of paths (rows
    // 1..ROWS-1), one full required set per guaranteed lane, independently
    // seated -- not just the single lane-0 spine. RETUNE (GOALS.md
    // branching-map ticket, run 2/N): a 20-run balance-sim replay with a bot
    // choosing lanes uniformly at random (per the ticket's own "sanity-check
    // the win-rate band still holds" instruction) dropped the "best"-strategy
    // win rate from ~38% (pre-branching baseline, in the tuned 35-50% band)
    // to 5% once only ONE lane carried shop/treasure/rest -- a bot wandering
    // off that single lane, which most random walks do, permanently lost
    // ink/gold/item access for the rest of the floor. Guaranteeing
    // min(2, LANES) lanes (both lanes on a 2-lane floor, 2 of 3 on a 3-lane
    // floor) keeps genuine routing risk alive -- a 3-lane floor still has one
    // uncovered lane, and the elite-avoidance mechanic is untouched -- while
    // making the common case survivable. See PROGRESS.md for the full
    // before/after sim numbers.
    var GUARANTEED_LANES = Math.min(2, LANES);
    var required = ['treasure', 'shop'];
    if (hasRest) required.push('rest');
    for (var g = 0; g < GUARANTEED_LANES; g++) {
      // Two guaranteed lanes' walked paths can cross and merge into the same
      // cell (both lanes shuffle by -1/0/+1 per row, over a shared 2-3 lane
      // width) -- seating blindly by lane index without checking what's
      // already reachable would let the second lane's pass silently
      // OVERWRITE a type the first lane already seated at a shared node,
      // undercounting it floor-wide. Check true reachability first and only
      // seat what this lane doesn't already have.
      var startNode = nodeAt[key(0, g)];
      var reachableIds = Floor.reachableNodeIds({ edges: edges }, [startNode.id], null);
      var reachableIdSet = {};
      reachableIds.forEach(function (id) { reachableIdSet[id] = true; });
      var haveTypes = {};
      Object.keys(nodeAt).forEach(function (k) {
        var n = nodeAt[k];
        if (reachableIdSet[n.id] && n.type) haveTypes[n.type] = true;
      });
      var missing = required.filter(function (type) { return !haveTypes[type]; });
      if (missing.length === 0) continue;
      var candidateSlots = allPaths[g].slice(1)
        .map(function (p) { return nodeAt[key(p.row, p.lane)]; })
        .filter(function (n) { return !n.type; });
      missing = missing.slice(0, candidateSlots.length);
      var slotPicks = rng.shuffle(candidateSlots.map(function (_, i) { return i; })).slice(0, missing.length);
      missing.forEach(function (type, i) { candidateSlots[slotPicks[i]].type = type; });
    }

    // Elite: at most one, on a non-spine-required node whose row has
    // another node too (so a route that skips it always exists).
    if (hasElite) {
      var eliteCandidates = [];
      Object.keys(nodeAt).forEach(function (k) {
        var n = nodeAt[k];
        if (n.type || n.row === 0) return; // skip row0 and already-typed specials
        if (rowNodes[n.row].length < 2) return; // must be avoidable
        eliteCandidates.push(n);
      });
      if (eliteCandidates.length > 0) {
        var eliteNode = rng.choice(eliteCandidates);
        eliteNode.type = 'elite';
        eliteNode.defId = pickEliteDefId(rng);
        eliteNode.eliteTraitId = rng.choice(Floor.ELITE_RESISTANCE_TRAITS);
      }
    }

    // Everything still untyped: mostly combat, occasional event.
    Object.keys(nodeAt).forEach(function (k) {
      var n = nodeAt[k];
      if (n.type) return;
      if (rng.chance(0.25)) {
        var eventId = (window.Wordbound && window.Wordbound.Events) ? window.Wordbound.Events.pickRandomEvent(rng) : null;
        if (eventId) { n.type = 'event'; n.defId = eventId; return; }
      }
      n.type = 'combat';
      n.defId = pickCombatDefId(floorNumber, rng);
    });

    var nodes = Object.keys(nodeAt).map(function (k) { return nodeAt[k]; });
    nodes.push(bossNode);

    return {
      floorNumber: floorNumber,
      lanes: LANES,
      rows: ROWS,
      nodes: nodes,
      edges: edges,
      startNodeIds: rowNodes[0].map(function (n) { return n.id; }),
      bossNodeId: bossNode.id,
    };
  };

  // BFS helper over a branchingFloor's edge list, optionally excluding one
  // node id entirely (used to prove an elite node is avoidable). Shared
  // here rather than duplicated in tests because game.js's eventual map UI
  // will need the same "what's reachable from here" traversal to light up
  // choosable next nodes.
  // Immediate (one-hop) successors of a single node -- what the map UI
  // should actually offer as choosable next nodes. `reachableNodeIds` above
  // is a full BFS (used to prove avoidability), not what a player should be
  // able to jump to directly.
  Floor.directNextNodeIds = function (branchingFloor, fromNodeId) {
    var out = [];
    branchingFloor.edges.forEach(function (e) {
      if (e[0] === fromNodeId) out.push(e[1]);
    });
    return out;
  };

  Floor.reachableNodeIds = function (branchingFloor, fromNodeIds, excludeNodeId) {
    var adjacency = {};
    branchingFloor.edges.forEach(function (e) {
      if (excludeNodeId && (e[0] === excludeNodeId || e[1] === excludeNodeId)) return;
      adjacency[e[0]] = adjacency[e[0]] || [];
      adjacency[e[0]].push(e[1]);
    });
    var seen = {};
    var queue = [];
    fromNodeIds.forEach(function (id) { if (id !== excludeNodeId) { seen[id] = true; queue.push(id); } });
    while (queue.length) {
      var cur = queue.shift();
      (adjacency[cur] || []).forEach(function (next) {
        if (!seen[next]) { seen[next] = true; queue.push(next); }
      });
    }
    return Object.keys(seen);
  };
})();
