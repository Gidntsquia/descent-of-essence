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
    // floorNumber >= 2 -> >= 1 (2026-08-20 rebalance ROUND 3, GOALS.md
    // "BALANCE, high priority"): balance-simulation.js data showed several
    // floor-2 deaths were 1-word, single-digit-damage kills -- the player
    // arrived at floor 2 already critical from floor-1 attrition (floor 1
    // had NO checkpoint heal at all), so floor2's death-share numbers were
    // partly floor 1's damage landing a floor late. This is the "heal
    // availability" player-economy lever the ticket's hard constraints
    // explicitly sanction, applied via the existing rest-node mechanism
    // rather than a new one -- floor 1 simply gets the same guaranteed
    // checkpoint floor 2/3 already had.
    var hasRest = floorNumber >= 1;
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
})();
