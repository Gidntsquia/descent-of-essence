// js/systems/entities.js
//
// Package B (systems: entities/combat/ai + enemy/boss data).
//
// PUBLIC API
//   Game.Systems.Entities.createPlayer(characterDef)
//     characterDef: either a full object (id, startingHp, startingBaseStats,
//     startingItems, startingConsumables, ...) OR a string id looked up in
//     Game.Data.Characters.CHARACTER_DEFS (Package C's data, accessed
//     defensively since it may not exist yet). Returns a fresh Player object
//     per the shared contract (see below).
//
//   Game.Systems.Entities.createEnemy(defId, floorNumber)
//     Looks up Game.Data.Enemies.ENEMY_DEFS[defId], applies floor scaling,
//     returns a fresh enemy instance. floorNumber defaults to 1.
//
//   Game.Systems.Entities.createBossInstance(bossDefId, floorNumber)
//     Looks up Game.Data.Bosses.BOSS_DEFS[bossDefId], applies the same floor
//     scaling as createEnemy (floorNumber defaults to the boss def's
//     minFloor, or 1), returns a fresh boss instance additionally tracking
//     phaseIndex/patternIndex/pendingTelegraph for Game.Systems.AI.bossTakeTurn.
//
// Player object shape:
//   { id:'player', characterId, x, y, floor, hp, maxHp, gold,
//     baseStats:{attack,defense,speed,critChance,critMult,...},
//     stats:{...baseStats, extraActions:0, range:1, lifestealPct:0, aoeRadius:0},
//     inventory:{passives:[], consumables:[]},
//     statusEffects:[], runStats:{enemiesKilled,itemsCollected,goldEarned,
//     floorsCleared,turnsTaken}, isAlive:true }
//   NOTE: `stats` is just a safe initial clone of baseStats + defaults here.
//   Package C's Items.recomputeStats (once loaded) is expected to recompute
//   `stats` from baseStats + equipped item modifiers whenever inventory
//   changes -- entities.js does not keep them in sync itself.
//
// Enemy instance shape:
//   { instanceId, defId, x, y, hp, maxHp, attack, defense, speed,
//     statusEffects:[], aiState:{mode:'idle', target:null}, isAlive:true }
//
// Boss instance shape: same as enemy instance plus
//   { isBoss:true, phaseIndex:0, patternIndex:0, pendingTelegraph:null }

(function () {
  var Entities = window.Game.Systems.Entities;

  function getCharacterDefs() {
    return (window.Game.Data.Characters && window.Game.Data.Characters.CHARACTER_DEFS) || {};
  }

  Entities.createPlayer = function (characterDef) {
    var def = characterDef;
    if (typeof characterDef === 'string') {
      def = getCharacterDefs()[characterDef] || {};
    }
    def = def || {};

    var startingHp = def.startingHp || 20;
    var baseStats = Object.assign(
      { attack: 2, defense: 0, speed: 1, critChance: 0.05, critMult: 2 },
      def.startingBaseStats || {}
    );
    var stats = Object.assign(
      {},
      baseStats,
      { extraActions: 0, range: 1, lifestealPct: 0, aoeRadius: 0 }
    );

    var player = {
      id: 'player',
      characterId: def.id || (typeof characterDef === 'string' ? characterDef : 'unknown'),
      x: 0,
      y: 0,
      floor: 1,
      hp: startingHp,
      maxHp: startingHp,
      gold: 0,
      baseStats: baseStats,
      stats: stats,
      inventory: { passives: [], consumables: [] },
      statusEffects: [],
      runStats: {
        enemiesKilled: 0,
        itemsCollected: 0,
        goldEarned: 0,
        floorsCleared: 0,
        turnsTaken: 0
      },
      isAlive: true
    };

    // Populate starting inventory defensively. Entries are stored exactly as
    // given by the character def (typically item/consumable id strings);
    // resolving them into full item state is Package C's responsibility
    // (e.g. during its own init pass / recomputeStats).
    if (Array.isArray(def.startingItems)) {
      def.startingItems.forEach(function (item) {
        player.inventory.passives.push(item);
      });
    }
    if (Array.isArray(def.startingConsumables)) {
      def.startingConsumables.forEach(function (item) {
        player.inventory.consumables.push(item);
      });
    }

    return player;
  };

  Entities.createEnemy = function (defId, floorNumber) {
    var C = window.Game.Constants;
    var U = window.Game.Utils;
    var defs = (window.Game.Data.Enemies && window.Game.Data.Enemies.ENEMY_DEFS) || {};
    var def = defs[defId];
    if (!def) {
      throw new Error('Entities.createEnemy: unknown enemy defId "' + defId + '"');
    }
    var floor = floorNumber || 1;
    var hp = Math.round(def.baseHp * (1 + C.ENEMY_HP_SCALE_PER_FLOOR * (floor - 1)));
    var attack = Math.round(def.attack * (1 + C.ENEMY_ATTACK_SCALE_PER_FLOOR * (floor - 1)));

    return {
      instanceId: U.uid('enemy'),
      defId: defId,
      x: 0,
      y: 0,
      hp: hp,
      maxHp: hp,
      attack: attack,
      defense: def.defense || 0,
      speed: def.speed || 1,
      statusEffects: [],
      aiState: { mode: 'idle', target: null },
      isAlive: true
    };
  };

  Entities.createBossInstance = function (bossDefId, floorNumber) {
    var C = window.Game.Constants;
    var U = window.Game.Utils;
    var defs = (window.Game.Data.Bosses && window.Game.Data.Bosses.BOSS_DEFS) || {};
    var def = defs[bossDefId];
    if (!def) {
      throw new Error('Entities.createBossInstance: unknown bossDefId "' + bossDefId + '"');
    }
    var floor = floorNumber || def.minFloor || 1;
    var hp = Math.round(def.hp * (1 + C.ENEMY_HP_SCALE_PER_FLOOR * (floor - 1)));
    var attack = Math.round(def.attack * (1 + C.ENEMY_ATTACK_SCALE_PER_FLOOR * (floor - 1)));

    return {
      instanceId: U.uid('boss'),
      defId: bossDefId,
      x: 0,
      y: 0,
      hp: hp,
      maxHp: hp,
      attack: attack,
      defense: def.defense || 0,
      speed: def.speed || 1,
      statusEffects: [],
      aiState: { mode: 'idle', target: null },
      isAlive: true,
      isBoss: true,
      phaseIndex: 0,
      patternIndex: 0,
      pendingTelegraph: null
    };
  };
})();
