// js/data/bosses.js
//
// Package B (systems: entities/combat/ai + enemy/boss data).
//
// PUBLIC API
//   Game.Data.Bosses.BOSS_DEFS[id] = {
//     id, name, glyph, color,
//     hp, attack, defense,
//     minFloor, maxFloor,   // inclusive floor range this boss is eligible for;
//                            // Package A picks an eligible boss per floor.
//     telegraphTurns,        // turns of warning before a telegraphed pattern fires
//     phases: [
//       { hpThreshold: 1.0, patternSequence: ['name', ...] },
//       ...  // sorted DESCENDING by hpThreshold; see ai.js#bossTakeTurn for
//            // how the active phase is re-derived every turn from current hp.
//     ],
//     telegraphMessages: { patternName: 'flavor text shown while telegraphing' },
//     attackPatterns: {
//       patternName(ctx) { ... }   // ctx = { boss, player, room, rng, log }
//     }
//   }
//
// Every attackPatterns[name](ctx) function applies its effect directly and
// calls ctx.log(...) with a flavorful message. Turn orchestration (deciding
// when to telegraph vs. execute a pattern, and tracking phase/pattern index)
// lives in ai.js as Game.Systems.AI.bossTakeTurn -- that is really an AI-turn
// concern even though the pattern *effects* live here with the boss data.
//
// Damage-dealing patterns route through Game.Systems.Combat.resolveAttack
// (attacker = boss instance, defender = player) so that player defense,
// item onDamaged/onDeath hooks, and death handling all behave identically to
// a normal enemy attack. Patterns temporarily scale boss.attack to vary
// damage per-pattern, then restore it. This call is made from inside a
// function body (never at load time), so combat.js does not need to exist
// yet when this file is parsed -- only by the time a pattern actually runs.
//
// One boss per floor, 3 floors total -- no ambiguity about which boss shows
// up where:
//   floor 1: Rat King    floor 2: Golem    floor 3: Void Heart (final)

(function () {
  var Bosses = window.Game.Data.Bosses;
  var DEFS = Bosses.BOSS_DEFS;

  function dealDamageToPlayer(ctx, attackMultiplier, flavorText) {
    var Combat = window.Game.Systems.Combat;
    var boss = ctx.boss;
    var result = null;
    if (Combat && typeof Combat.resolveAttack === 'function') {
      var originalAttack = boss.attack;
      boss.attack = Math.max(1, Math.round(originalAttack * attackMultiplier));
      result = Combat.resolveAttack(boss, ctx.player, { room: ctx.room, rng: ctx.rng, log: ctx.log });
      boss.attack = originalAttack;
    } else {
      // Fallback if combat.js somehow isn't loaded: apply damage directly.
      var defense = (ctx.player.stats && ctx.player.stats.defense) || 0;
      var dmg = Math.max(1, Math.round(boss.attack * attackMultiplier - defense));
      ctx.player.hp = Math.max(0, ctx.player.hp - dmg);
    }
    if (flavorText && typeof ctx.log === 'function') ctx.log(flavorText);
    return result;
  }

  function findOpenTileNear(x, y, room, player) {
    var AI = window.Game.Systems.AI;
    if (AI && typeof AI.findOpenTileNear === 'function') {
      return AI.findOpenTileNear(x, y, room, player);
    }
    // Minimal local fallback (mirrors ai.js's helper) in case AI hasn't
    // loaded / isn't available for some reason.
    var U = window.Game.Utils;
    var neighbors = U.neighborCells(x, y);
    for (var i = 0; i < neighbors.length; i++) {
      var n = neighbors[i];
      var occupied = room && Array.isArray(room.enemies) && room.enemies.some(function (e) {
        return e.isAlive !== false && e.x === n.x && e.y === n.y;
      });
      if (!occupied) return { x: n.x, y: n.y };
    }
    return { x: x, y: y };
  }

  function summonAdd(ctx, defId, flavorText) {
    var Entities = window.Game.Systems.Entities;
    if (!Entities || typeof Entities.createEnemy !== 'function') return null;
    var spot = findOpenTileNear(ctx.boss.x, ctx.boss.y, ctx.room, ctx.player);
    var add = Entities.createEnemy(defId, 1);
    add.x = spot.x;
    add.y = spot.y;
    if (ctx.room && Array.isArray(ctx.room.enemies)) ctx.room.enemies.push(add);
    if (flavorText && typeof ctx.log === 'function') ctx.log(flavorText);
    return add;
  }

  // ---------------------------------------------------------------------
  // Rat King -- floor 1. Summons weak adds, alternates charge/slam.
  // ---------------------------------------------------------------------
  DEFS.boss_ratking = {
    id: 'boss_ratking',
    name: 'The Rat King',
    glyph: 'R',
    color: '#c62828',
    hp: 60,
    attack: 5,
    defense: 1,
    minFloor: 1,
    maxFloor: 1,
    telegraphTurns: 1,
    phases: [
      { hpThreshold: 1.0, patternSequence: ['summon', 'chargeAttack', 'chargeAttack', 'slam'] },
      { hpThreshold: 0.5, patternSequence: ['enrageSlam', 'summon', 'enrageSlam'] }
    ],
    telegraphMessages: {
      summon: 'The Rat King lets out a shrill screech, calling for reinforcements!',
      chargeAttack: 'The Rat King digs in its claws, ready to charge!',
      slam: 'The Rat King raises its claws -- a slam is coming!',
      enrageSlam: 'The Rat King, enraged and bleeding, rears back for a furious slam!'
    },
    attackPatterns: {
      chargeAttack: function (ctx) {
        dealDamageToPlayer(ctx, 1.0, 'The Rat King charges into you!');
      },
      slam: function (ctx) {
        dealDamageToPlayer(ctx, 1.4, 'The Rat King slams down with both claws!');
      },
      summon: function (ctx) {
        summonAdd(ctx, 'slime', 'A rat-slime scurries out from the Rat King\'s fur!');
      },
      enrageSlam: function (ctx) {
        dealDamageToPlayer(ctx, 1.8, 'The Rat King, enraged, delivers a brutal slam!');
      }
    }
  };

  // ---------------------------------------------------------------------
  // Golem -- floor 2. Heavy single-target slam + ground-pound flavor.
  // ---------------------------------------------------------------------
  DEFS.boss_golem = {
    id: 'boss_golem',
    name: 'The Golem',
    glyph: 'G',
    color: '#6d4c41',
    hp: 90,
    attack: 6,
    defense: 3,
    minFloor: 2,
    maxFloor: 2,
    telegraphTurns: 1,
    phases: [
      { hpThreshold: 1.0, patternSequence: ['heavySlam', 'groundPound', 'heavySlam'] },
      { hpThreshold: 0.4, patternSequence: ['groundPound', 'groundPound', 'heavySlam'] }
    ],
    telegraphMessages: {
      heavySlam: 'The Golem winds up an enormous stone fist!',
      groundPound: 'The Golem raises both arms high -- the ground itself will shake!'
    },
    attackPatterns: {
      heavySlam: function (ctx) {
        dealDamageToPlayer(ctx, 1.5, 'The Golem\'s fist crashes down on you!');
      },
      groundPound: function (ctx) {
        dealDamageToPlayer(ctx, 1.2, 'The Golem pounds the ground, sending shockwaves through the room!');
      }
    }
  };

  // ---------------------------------------------------------------------
  // Void Heart -- floors 4-5. Hardest boss, multi-phase with an enrage nova.
  // ---------------------------------------------------------------------
  DEFS.boss_voidheart = {
    id: 'boss_voidheart',
    name: 'The Void Heart',
    glyph: 'V',
    color: '#212121',
    hp: 120,
    attack: 9,
    defense: 2,
    minFloor: 3,
    maxFloor: 3,
    telegraphTurns: 1,
    phases: [
      { hpThreshold: 1.0, patternSequence: ['voidLance', 'summon', 'voidLance'] },
      { hpThreshold: 0.6, patternSequence: ['voidLance', 'voidLance', 'summon'] },
      { hpThreshold: 0.25, patternSequence: ['enrageNova', 'enrageNova', 'summon'] }
    ],
    telegraphMessages: {
      voidLance: 'A lance of pure void energy coalesces before the Void Heart!',
      summon: 'The Void Heart tears open a small rift in reality!',
      enrageNova: 'The Void Heart pulses violently -- reality bends around it!'
    },
    attackPatterns: {
      voidLance: function (ctx) {
        dealDamageToPlayer(ctx, 1.0, 'The void lance pierces straight through you!');
      },
      summon: function (ctx) {
        summonAdd(ctx, 'bat', 'A shrieking shade claws its way out of the rift!');
      },
      enrageNova: function (ctx) {
        dealDamageToPlayer(ctx, 2.0, 'The Void Heart erupts in a nova of raw entropy!');
      }
    }
  };
})();
