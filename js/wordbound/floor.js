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
    var hasRest = floorNumber >= 2;

    var specials = ['treasure'];
    if (hasElite) specials.push('elite');
    if (hasRest) specials.push('rest');

    var fillerCount = nodeCount - 1 - specials.length; // -1 reserves the guaranteed first combat node
    if (fillerCount < 0) fillerCount = 0;

    var body = specials.slice();
    for (var i = 0; i < fillerCount; i++) body.push('combat');
    body = rng.shuffle(body);

    var types = ['combat'].concat(body).concat(['boss']);

    var nodes = types.map(function (type) {
      var defId = null;
      if (type === 'combat') defId = pickCombatDefId(floorNumber, rng);
      else if (type === 'elite') defId = pickEliteDefId(rng);
      else if (type === 'boss') defId = pickBossDefId(floorNumber);
      return { id: 'node' + (nextNodeId++), type: type, defId: defId, cleared: false };
    });

    return { floorNumber: floorNumber, nodes: nodes };
  };
})();
