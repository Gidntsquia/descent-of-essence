// js/data/enemies.js
//
// Package B (systems: entities/combat/ai + enemy/boss data).
//
// PUBLIC API
//   Game.Data.Enemies.ENEMY_DEFS[id] = {
//     id, name, glyph, color,
//     baseHp, attack, defense, speed,
//     behavior,       // key into Game.Systems.AI.behaviors
//     aggroRange,     // tiles; informational for callers (dungeon/game.js), not
//                      // consulted by the behaviors themselves in v1
//     range,          // ranged-only: attack range in tiles (Skeleton Archer)
//     goldDrop: [min, max],
//     onDeath,        // optional: key into Game.Systems.AI.enemyDeathEffects
//     onHitEffect,     // optional: 'poison' -- combat.js special-cases this to
//                      // apply a poison status effect to the player on hit.
//                      // (Spider also matches via def.id === 'spider' as a
//                      // belt-and-suspenders check in combat.js.)
//     tags: [...]      // exactly one of 'weak'|'normal'|'strong', optionally
//                      // plus 'elite'. Consumed by Package A's dungeon
//                      // generator to gate which enemies appear on which floor.
//   }
//
// Floor scaling (applied by Entities.createEnemy, not here):
//   hp = round(baseHp * (1 + ENEMY_HP_SCALE_PER_FLOOR * (floor-1)))
//   attack = round(attack * (1 + ENEMY_ATTACK_SCALE_PER_FLOOR * (floor-1)))
//
// Balance target: player starts around ~20 hp.
//   weak   ~4-8 hp / 1-2 attack
//   normal ~8-15 hp / 2-4 attack
//   strong ~15-25 hp / 4-6 attack

(function () {
  var Enemies = window.Game.Data.Enemies;
  var DEFS = Enemies.ENEMY_DEFS;

  DEFS.slime = {
    id: 'slime',
    name: 'Slime',
    glyph: 'S',
    color: '#4caf50',
    baseHp: 5,
    attack: 1,
    defense: 0,
    speed: 1,
    behavior: 'chase',
    aggroRange: 5,
    goldDrop: [1, 3],
    tags: ['weak']
  };

  DEFS.bat = {
    id: 'bat',
    name: 'Bat',
    glyph: 'b',
    color: '#7e57c2',
    baseHp: 4,
    attack: 1,
    defense: 0,
    speed: 2,
    behavior: 'erratic',
    aggroRange: 6,
    goldDrop: [1, 2],
    tags: ['weak']
  };

  DEFS.goblin = {
    id: 'goblin',
    name: 'Goblin',
    glyph: 'g',
    color: '#8d6e63',
    baseHp: 10,
    attack: 3,
    defense: 0,
    speed: 1,
    behavior: 'chase_flee',
    aggroRange: 5,
    goldDrop: [2, 5],
    tags: ['normal']
  };

  DEFS.skeleton_archer = {
    id: 'skeleton_archer',
    name: 'Skeleton Archer',
    glyph: 'k',
    color: '#cfd8dc',
    baseHp: 8,
    attack: 2,
    defense: 0,
    speed: 1,
    behavior: 'ranged',
    range: 4,
    aggroRange: 6,
    goldDrop: [3, 5],
    tags: ['normal']
  };

  DEFS.spider = {
    id: 'spider',
    name: 'Spider',
    glyph: 'x',
    color: '#5d4037',
    baseHp: 9,
    attack: 2,
    defense: 0,
    speed: 1,
    behavior: 'chase',
    onHitEffect: 'poison',
    aggroRange: 5,
    goldDrop: [2, 4],
    tags: ['normal']
  };

  DEFS.armored_knight = {
    id: 'armored_knight',
    name: 'Armored Knight',
    glyph: 'K',
    color: '#90a4ae',
    baseHp: 20,
    attack: 4,
    defense: 3,
    speed: 0,
    behavior: 'chase',
    aggroRange: 4,
    goldDrop: [4, 7],
    tags: ['strong', 'elite']
  };

  DEFS.cultist = {
    id: 'cultist',
    name: 'Cultist',
    glyph: 'c',
    color: '#ab47bc',
    baseHp: 16,
    attack: 3,
    defense: 1,
    speed: 1,
    behavior: 'support',
    aggroRange: 6,
    goldDrop: [5, 9],
    tags: ['strong', 'elite']
  };
})();
