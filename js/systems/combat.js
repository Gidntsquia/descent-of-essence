// js/systems/combat.js
//
// Package B (systems: entities/combat/ai + enemy/boss data).
//
// PUBLIC API
//   Game.Systems.Combat.resolveAttack(attacker, defender, options)
//     options (all optional): { room, log, rng }
//       room: the current Room object (used for AoE splash lookups against
//             room.enemies; degrades gracefully if omitted)
//       log:  function(text) for message-log output; degrades to a no-op
//       rng:  a Game.RNG.create(...) instance. If omitted, one is created ad
//             hoc via Game.RNG.create(Date.now()) -- integration SHOULD pass
//             a shared run-level rng here for determinism/replay, but combat
//             will not throw if it's missing.
//     Called uniformly for BOTH player-attacks-enemy and enemy-attacks-player
//     (never enemy-vs-enemy -- that never dispatches item hooks per the core
//     design decision).
//
//     PLAYER MARKER CHECK: an entity is "the player" iff `entity.inventory
//     !== undefined`. Only Entities.createPlayer produces objects with an
//     `inventory` field, so this is used consistently for both attacker and
//     defender. Integration code constructing calls should rely on this same
//     check (do not use `attacker.id === 'player'` as the primary signal --
//     inventory presence is authoritative here).
//
//     Returns:
//       { damage: damageInfo, defenderDied: bool, attackerHealed: number,
//         aoeTargets: [{instanceId, damage}] }
//     `damageInfo` is the same object passed through the onAttack/onDamaged/
//     onHit hooks, mutated in place so its final `.amount` reflects the real
//     post-defense damage dealt.
//
//   Game.Systems.Combat.tickStatusEffects(entity, log)
//     Iterates entity.statusEffects, applies each effect's per-turn impact
//     (currently: 'poison' subtracts `magnitude` from hp), decrements
//     turnsRemaining, and filters out expired effects. NOT called internally
//     by resolveAttack -- the turn loop (game.js) is expected to call this
//     once per turn for every living entity that should tick.
//
// Enemy-on-hit special effects:
//   Spider (or any enemy def with `onHitEffect: 'poison'`, checked via
//   Game.Data.Enemies.ENEMY_DEFS[attacker.defId]) pushes a poison status
//   effect ({type:'poison', turnsRemaining:3, magnitude:1}) onto the
//   defending player's statusEffects whenever it lands a hit that deals > 0
//   damage. This check happens right after defense is applied (step 4 below)
//   since it only cares about attacker-is-enemy / defender-is-player hits.
//
// AoE splash (step 7): enemies other than the primary defender within
// damageInfo.aoeRadius tiles (Manhattan, from the defender's position) take
// 50% of the primary hit's final damage, further reduced by half their own
// defense (still clamped to a minimum of 1). This fraction is a combat.js
// design choice, documented here for integration's awareness.

(function () {
  var Combat = window.Game.Systems.Combat;

  function isPlayerEntity(entity) {
    return !!(entity && entity.inventory !== undefined);
  }

  function getRng(options) {
    if (options && options.rng) return options.rng;
    return window.Game.RNG.create(Date.now());
  }

  function runHook(name, ctx) {
    var Items = window.Game.Systems.Items;
    if (Items && typeof Items.runHook === 'function') {
      try {
        Items.runHook(name, ctx);
      } catch (e) {
        if (ctx && typeof ctx.log === 'function') {
          ctx.log('(something interferes with an item effect...)');
        }
      }
    }
  }

  Combat.resolveAttack = function (attacker, defender, options) {
    options = options || {};
    var room = options.room;
    var log = typeof options.log === 'function' ? options.log : function () {};
    var rng = getRng(options);

    var attackerIsPlayer = isPlayerEntity(attacker);
    var defenderIsPlayer = isPlayerEntity(defender);

    // --- 1. Base damage + crit (player only) ---
    var baseDamage = attackerIsPlayer ? attacker.stats.attack : attacker.attack;
    var isCrit = attackerIsPlayer ? rng.chance(attacker.stats.critChance || 0) : false;

    // --- 2. damageInfo ---
    var damageInfo = {
      amount: baseDamage * (isCrit ? (attacker.stats.critMult || 2) : 1),
      isCrit: isCrit,
      piercing: false,
      lifestealPct: (attackerIsPlayer && attacker.stats && attacker.stats.lifestealPct) || 0,
      aoeRadius: (attackerIsPlayer && attacker.stats && attacker.stats.aoeRadius) || 0,
      cancelled: false,
      sourceId: attacker.id || attacker.instanceId,
      targetId: defender.id || defender.instanceId
    };

    // --- 3. onAttack / onDamaged hooks (mutually exclusive) ---
    if (attackerIsPlayer) {
      runHook('onAttack', { player: attacker, target: defender, damage: damageInfo, rng: rng, log: log });
    } else if (defenderIsPlayer) {
      runHook('onDamaged', { player: defender, attacker: attacker, damage: damageInfo, rng: rng, log: log });
    }

    // --- 4. Apply defense ---
    var defenderDefense = defender.stats ? (defender.stats.defense || 0) : (defender.defense || 0);
    var finalAmount = damageInfo.cancelled ? 0 : Math.max(1, Math.round(damageInfo.amount - defenderDefense));
    defender.hp = Math.max(0, defender.hp - finalAmount);
    damageInfo.amount = finalAmount;

    // Spider / onHitEffect poison special-case (enemy -> player only).
    if (!attackerIsPlayer && defenderIsPlayer && finalAmount > 0) {
      var enemyDefs = (window.Game.Data.Enemies && window.Game.Data.Enemies.ENEMY_DEFS) || {};
      var atkDef = enemyDefs[attacker.defId];
      if (atkDef && (atkDef.onHitEffect === 'poison' || atkDef.id === 'spider')) {
        defender.statusEffects = defender.statusEffects || [];
        defender.statusEffects.push({ type: 'poison', turnsRemaining: 3, magnitude: 1 });
        log((atkDef.name || 'The creature') + "'s venom sinks in -- you're poisoned!");
      }
    }

    // --- 5. Lifesteal (player attacker only) ---
    var attackerHealed = 0;
    if (attackerIsPlayer && damageInfo.lifestealPct > 0 && finalAmount > 0) {
      var healAmt = Math.round(finalAmount * damageInfo.lifestealPct);
      var before = attacker.hp;
      attacker.hp = Math.min(attacker.maxHp, attacker.hp + healAmt);
      attackerHealed = attacker.hp - before;
    }

    // --- 6. onHit hook (player attacker only) ---
    if (attackerIsPlayer) {
      runHook('onHit', {
        player: attacker,
        target: defender,
        damage: damageInfo,
        targetDied: defender.hp <= 0,
        rng: rng,
        log: log
      });
    }

    // --- 7. AoE splash (player attacker only) ---
    var aoeTargets = [];
    if (attackerIsPlayer && damageInfo.aoeRadius > 0 && room && Array.isArray(room.enemies) && finalAmount > 0) {
      var U = window.Game.Utils;
      room.enemies.forEach(function (other) {
        if (other === defender) return;
        if (!other || other.isAlive === false || other.hp === undefined || other.hp <= 0) return;
        var dist = U.manhattan(defender.x, defender.y, other.x, other.y);
        if (dist <= damageInfo.aoeRadius) {
          var otherDefense = other.stats ? (other.stats.defense || 0) : (other.defense || 0);
          var splashDamage = Math.max(1, Math.round(finalAmount * 0.5 - otherDefense * 0.5));
          other.hp = Math.max(0, other.hp - splashDamage);
          if (other.hp <= 0) other.isAlive = false;
          aoeTargets.push({ instanceId: other.instanceId, damage: splashDamage });
        }
      });
    }

    // --- 8. Death handling ---
    var defenderDied = false;
    if (defender.hp <= 0) {
      if (defenderIsPlayer) {
        var deathCtx = { player: defender, rng: rng, log: log, prevented: false };
        runHook('onDeath', deathCtx);
        if (deathCtx.prevented) {
          // The responsible item's own onDeath hook is expected to remove
          // itself from the player's inventory (single-use revive, etc.).
          defender.hp = Math.round(defender.maxHp * 0.5);
          defenderDied = false;
        } else {
          defender.isAlive = false;
          defenderDied = true;
        }
      } else {
        defender.isAlive = false;
        defenderDied = true;
        if (attackerIsPlayer) {
          runHook('onKill', { player: attacker, target: defender, rng: rng, log: log });
        }
      }
    }

    // --- 9. Result ---
    return {
      damage: damageInfo,
      defenderDied: defenderDied,
      attackerHealed: attackerHealed,
      aoeTargets: aoeTargets
    };
  };

  Combat.tickStatusEffects = function (entity, log) {
    if (!entity || !Array.isArray(entity.statusEffects) || entity.statusEffects.length === 0) return;
    var logFn = typeof log === 'function' ? log : function () {};
    var isPlayer = isPlayerEntity(entity);
    var remaining = [];

    entity.statusEffects.forEach(function (effect) {
      if (effect.type === 'poison') {
        var dmg = effect.magnitude || 1;
        entity.hp = Math.max(0, entity.hp - dmg);
        logFn((isPlayer ? 'You take' : 'It takes') + ' ' + dmg + ' poison damage.');
        if (entity.hp <= 0) entity.isAlive = false;
      }
      // Additional effect types can be added here (e.g. burn, stun) following
      // the same { type, turnsRemaining, magnitude } shape.
      effect.turnsRemaining -= 1;
      if (effect.turnsRemaining > 0) remaining.push(effect);
    });

    entity.statusEffects = remaining;
  };
})();
