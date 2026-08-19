// js/systems/ai.js
//
// Package B (systems: entities/combat/ai + enemy/boss data).
//
// PUBLIC API
//   Game.Systems.AI.behaviors[name](enemy, player, room, rng)
//     -> { action: 'move'|'attack'|'wait', dx, dy }
//     Decides what a single non-boss living enemy wants to do on its turn.
//     dx/dy are only meaningful when action==='move' and are a single-step
//     delta (one of -1/0/1 on each axis, movement is 4-directional/cardinal
//     -- never both axes nonzero at once). The caller (game.js turn loop) is
//     responsible for: executing a melee attack via Combat.resolveAttack
//     when action==='attack' and the enemy is adjacent (chase/erratic/
//     chase_flee); validating the destination tile before applying a 'move'
//     intent. Registered behaviors: chase, erratic, ranged, chase_flee,
//     support.
//
//     SPECIAL CASE -- 'ranged': its 'attack' intent does NOT require
//     adjacency (unlike chase/erratic/chase_flee). The caller should call
//     Combat.resolveAttack for a ranged enemy's attack intent as long as the
//     enemy is within its def's `range` (default 4), regardless of distance.
//
//   Game.Systems.AI.enemyDeathEffects[name](deadEnemy, room, rng, floorNumber)
//     Registered: splitOnDeath(deadEnemy, room, rng, floorNumber=1) -- if
//     deadEnemy.maxHp >= 4, spawns 2 slime instances (each ~half of
//     deadEnemy.maxHp) at open tiles adjacent to deadEnemy's position, pushes
//     them into room.enemies, and returns the spawned array. floorNumber is
//     OPTIONAL and defaults to 1 -- integration should pass the enemy's
//     actual floor for correct scaling of the spawned slimes.
//
//   Game.Systems.AI.bossTakeTurn(bossInstance, player, room, rng, log)
//     Orchestrates one boss turn: phase selection, telegraph countdown, and
//     pattern execution/advancement. See in-line comments below for the
//     exact algorithm. The attack-pattern *effect* functions themselves live
//     on the boss def (Game.Data.Bosses.BOSS_DEFS[bossInstance.defId]
//     .attackPatterns), not here.
//
//   Game.Systems.AI.findOpenTileNear(x, y, room, excludeEntity)
//     Utility: returns the first open, unoccupied cardinal-neighbor tile of
//     (x,y) as {x,y}, or a best-effort neighbor if no validated tile exists
//     (e.g. room.tiles isn't in the expected shape). Consults room.tiles
//     (if present, either raw TILE_TYPES strings or {type:...} objects) and
//     room.enemies for occupancy. Exposed publicly so bosses.js's `summon`
//     patterns can reuse it.

(function () {
  var AI = window.Game.Systems.AI;
  AI.behaviors = AI.behaviors || {};
  AI.enemyDeathEffects = AI.enemyDeathEffects || {};

  // -----------------------------------------------------------------------
  // Shared helpers
  // -----------------------------------------------------------------------

  // Single cardinal step that reduces Manhattan distance from (x,y) toward
  // (tx,ty), preferring the axis with the larger remaining distance first.
  function greedyStepToward(x, y, tx, ty) {
    var distX = tx - x;
    var distY = ty - y;
    var absX = Math.abs(distX);
    var absY = Math.abs(distY);
    if (absX === 0 && absY === 0) return { dx: 0, dy: 0 };
    if (absX >= absY) {
      if (distX !== 0) return { dx: distX > 0 ? 1 : -1, dy: 0 };
      return { dx: 0, dy: distY > 0 ? 1 : -1 };
    }
    if (distY !== 0) return { dx: 0, dy: distY > 0 ? 1 : -1 };
    return { dx: distX > 0 ? 1 : -1, dy: 0 };
  }

  function stepAway(x, y, tx, ty) {
    var step = greedyStepToward(x, y, tx, ty);
    return { dx: -step.dx, dy: -step.dy };
  }

  function randomStep(rng) {
    var dirs = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
    return rng.choice(dirs);
  }

  function findOpenTilesNear(x, y, room, excludeEntity, limit) {
    limit = limit || 1;
    var C = window.Game.Constants;
    var U = window.Game.Utils;
    var neighbors = U.neighborCells(x, y);
    var results = [];

    for (var i = 0; i < neighbors.length; i++) {
      var n = neighbors[i];
      if (room && Array.isArray(room.tiles)) {
        var row = room.tiles[n.y];
        var tile = row ? row[n.x] : undefined;
        var tileType = tile && typeof tile === 'object' ? tile.type : tile;
        if (tileType !== undefined && tileType !== C.TILE_TYPES.FLOOR) continue;
      }
      var occupied = room && Array.isArray(room.enemies) && room.enemies.some(function (e) {
        return e !== excludeEntity && e.isAlive !== false && e.x === n.x && e.y === n.y;
      });
      if (occupied) continue;
      results.push({ x: n.x, y: n.y });
      if (results.length >= limit) break;
    }

    if (results.length === 0) {
      // No validated open tile found (e.g. unknown room.tiles shape, or
      // everything occupied) -- fall back to raw neighbor positions.
      return neighbors.slice(0, limit).map(function (n) { return { x: n.x, y: n.y }; });
    }
    return results;
  }

  AI.findOpenTileNear = function (x, y, room, excludeEntity) {
    var tiles = findOpenTilesNear(x, y, room, excludeEntity, 1);
    return tiles.length ? tiles[0] : null;
  };

  // -----------------------------------------------------------------------
  // Behaviors
  // -----------------------------------------------------------------------

  AI.behaviors.chase = function (enemy, player, room, rng) {
    var U = window.Game.Utils;
    if (U.isAdjacent(enemy.x, enemy.y, player.x, player.y)) {
      return { action: 'attack' };
    }
    var step = greedyStepToward(enemy.x, enemy.y, player.x, player.y);
    return { action: 'move', dx: step.dx, dy: step.dy };
  };

  AI.behaviors.erratic = function (enemy, player, room, rng) {
    var U = window.Game.Utils;
    if (U.isAdjacent(enemy.x, enemy.y, player.x, player.y)) {
      if (rng.chance(0.5)) return { action: 'attack' };
      var flee = randomStep(rng);
      return { action: 'move', dx: flee.dx, dy: flee.dy };
    }
    if (rng.chance(0.5)) {
      var step = greedyStepToward(enemy.x, enemy.y, player.x, player.y);
      return { action: 'move', dx: step.dx, dy: step.dy };
    }
    var rand = randomStep(rng);
    return { action: 'move', dx: rand.dx, dy: rand.dy };
  };

  // NOTE: 'attack' from this behavior does NOT require adjacency -- see the
  // public API doc comment above. Algorithm: if the player is right next to
  // the enemy (distance < 2), kite away one step; else if within `range`,
  // shoot; else close the distance.
  AI.behaviors.ranged = function (enemy, player, room, rng) {
    var U = window.Game.Utils;
    var enemyDefs = (window.Game.Data.Enemies && window.Game.Data.Enemies.ENEMY_DEFS) || {};
    var def = enemyDefs[enemy.defId] || {};
    var range = def.range || 4;
    var dist = U.manhattan(enemy.x, enemy.y, player.x, player.y);

    if (dist < 2) {
      var away = stepAway(enemy.x, enemy.y, player.x, player.y);
      return { action: 'move', dx: away.dx, dy: away.dy };
    }
    if (dist <= range) {
      return { action: 'attack' };
    }
    var step = greedyStepToward(enemy.x, enemy.y, player.x, player.y);
    return { action: 'move', dx: step.dx, dy: step.dy };
  };

  AI.behaviors.chase_flee = function (enemy, player, room, rng) {
    if (enemy.hp / enemy.maxHp < 0.3) {
      var away = stepAway(enemy.x, enemy.y, player.x, player.y);
      return { action: 'move', dx: away.dx, dy: away.dy };
    }
    return AI.behaviors.chase(enemy, player, room, rng);
  };

  AI.behaviors.support = function (enemy, player, room, rng) {
    var U = window.Game.Utils;
    var allies = (room && Array.isArray(room.enemies)) ? room.enemies : [];
    var healTarget = null;

    for (var i = 0; i < allies.length; i++) {
      var other = allies[i];
      if (other === enemy || other.isAlive === false) continue;
      if (U.manhattan(enemy.x, enemy.y, other.x, other.y) <= 2 && other.hp / other.maxHp < 0.5) {
        healTarget = other;
        break;
      }
    }

    if (healTarget) {
      var healAmount = Math.max(1, Math.round(healTarget.maxHp * 0.2));
      healTarget.hp = Math.min(healTarget.maxHp, healTarget.hp + healAmount);
      return { action: 'wait' };
    }

    // Deliberately does not summon reinforcements -- a mid-fight enemy count
    // that can grow (like the old slime split-on-death) makes room clears
    // unpredictable and drags fights out. Support enemies only heal allies.
    return AI.behaviors.chase(enemy, player, room, rng);
  };

  // -----------------------------------------------------------------------
  // Enemy death effects
  // -----------------------------------------------------------------------

  AI.enemyDeathEffects.splitOnDeath = function (deadEnemy, room, rng, floorNumber) {
    if (!deadEnemy || deadEnemy.maxHp < 4) return [];
    var Entities = window.Game.Systems.Entities;
    if (!Entities || typeof Entities.createEnemy !== 'function') return [];

    var floor = floorNumber || 1;
    var spots = findOpenTilesNear(deadEnemy.x, deadEnemy.y, room, deadEnemy, 2);
    var halfHp = Math.max(1, Math.round(deadEnemy.maxHp / 2));
    var spawned = [];

    for (var i = 0; i < 2; i++) {
      var spot = spots[i] || { x: deadEnemy.x, y: deadEnemy.y };
      var child = Entities.createEnemy('slime', floor);
      child.hp = halfHp;
      child.maxHp = halfHp;
      child.x = spot.x;
      child.y = spot.y;
      spawned.push(child);
    }

    if (room && Array.isArray(room.enemies)) {
      spawned.forEach(function (c) { room.enemies.push(c); });
    }
    return spawned;
  };

  // -----------------------------------------------------------------------
  // Boss turn orchestration
  // -----------------------------------------------------------------------

  AI.bossTakeTurn = function (bossInstance, player, room, rng, log) {
    var bossDefs = (window.Game.Data.Bosses && window.Game.Data.Bosses.BOSS_DEFS) || {};
    var bossDef = bossDefs[bossInstance.defId];
    var logFn = typeof log === 'function' ? log : function () {};

    if (!bossDef || !Array.isArray(bossDef.phases) || bossDef.phases.length === 0) {
      logFn('The boss has no defined behavior.');
      return;
    }

    // Re-derive the active phase fresh every turn (rather than only ever
    // incrementing) so a big hit can jump straight to a later phase. phases
    // are sorted descending by hpThreshold in the data; pick the
    // highest-index phase whose threshold the current hp ratio is
    // at-or-below.
    var hpRatio = bossInstance.maxHp > 0 ? bossInstance.hp / bossInstance.maxHp : 0;
    var phaseIndex = 0;
    for (var i = 0; i < bossDef.phases.length; i++) {
      if (hpRatio <= bossDef.phases[i].hpThreshold) {
        phaseIndex = i;
      }
    }
    bossInstance.phaseIndex = phaseIndex;
    var phase = bossDef.phases[phaseIndex];
    var seq = phase.patternSequence || [];

    if (bossInstance.pendingTelegraph) {
      bossInstance.pendingTelegraph.turnsRemaining -= 1;
      if (bossInstance.pendingTelegraph.turnsRemaining <= 0) {
        var patternName = bossInstance.pendingTelegraph.pattern;
        var patternFn = bossDef.attackPatterns && bossDef.attackPatterns[patternName];
        bossInstance.pendingTelegraph = null;

        if (typeof patternFn === 'function') {
          patternFn({ boss: bossInstance, player: player, room: room, rng: rng, log: logFn });
        } else {
          logFn(bossDef.name + ' fumbles its attack.');
        }

        if (seq.length > 0) {
          bossInstance.patternIndex = (bossInstance.patternIndex + 1) % seq.length;
        } else {
          bossInstance.patternIndex = 0;
        }
      }
      return;
    }

    if (seq.length === 0) return;
    var idx = bossInstance.patternIndex % seq.length;
    var nextPattern = seq[idx];
    bossInstance.pendingTelegraph = { pattern: nextPattern, turnsRemaining: bossDef.telegraphTurns || 1 };

    var message = (bossDef.telegraphMessages && bossDef.telegraphMessages[nextPattern]) ||
      (bossDef.name + ' prepares ' + nextPattern + '!');
    logFn(message);
  };
})();
