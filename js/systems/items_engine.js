// js/systems/items_engine.js
//
// Package C -- the item/synergy engine. This is the decoupling seam other
// packages (combat.js, dungeon.js, entities.js) call into without needing to
// know which items exist. All cross-package calls happen lazily inside
// function bodies (never at load time), and are defensive (typeof checks)
// since this file may load before/without those other packages existing.
//
// PUBLIC API (Game.Systems.Items):
//   Items.runHook(hookName, ctx)
//     -> invokes hooks[hookName] on every passive the player owns, in
//        inventory order. ctx must include ctx.player. Sets ctx.itemId and
//        ctx.stackCount before each call. Returns ctx (mutated in place --
//        hook implementations communicate results back via ctx, e.g.
//        ctx.prevented, ctx.damage.piercing, etc).
//   Items.recomputeStats(player)
//     -> rebuilds player.stats from player.baseStats + all passive statMods.
//   Items.addPassive(player, itemId, options)
//     -> options = { rng, log } (both optional). Adds/stacks a passive item,
//        recomputes stats, fires onPickup. Respects maxStacks (see below).
//   Items.removePassive(player, itemId)
//     -> removes a passive entirely (e.g. a one-shot revive consuming
//        itself from inside its own onDeath hook) and recomputes stats.
//   Items.addConsumable(player, itemId, quantity)
//     -> adds/increments a consumable stack in player.inventory.consumables.
//   Items.useConsumable(player, itemId, context)
//     -> looks up CONSUMABLE_DEFS[itemId], calls .use(player, context),
//        decrements/removes the stack. Returns true/false for success.
//
// Player contract this file expects (owned by Package B's entities.js, but
// documented here since we read/write it heavily):
//   player.baseStats = { attack, defense, speed, critChance, critMult, ... }
//   player.stats = {} -- rebuilt wholesale by recomputeStats
//   player.hp, player.maxHp, player.gold
//   player.inventory = { passives: [{itemId, stackCount}], consumables: [{itemId, quantity}] }
//   player.statusEffects = [{type, turnsRemaining, magnitude}, ...]
//
// DESIGN NOTE on maxStacks: when a player picks up a passive already at its
// maxStacks cap, we still record the pickup (so onPickup fires and any UI/
// pickup-consuming logic behaves normally) but we do NOT increment
// stackCount past the cap. This is documented behavior per the spec's
// "your call" -- picking up a maxed item is a (minor) wasted pickup rather
// than a hard block, which is friendlier for random floor generation that
// doesn't know a player's current stacks.

(function () {
  const Items = window.Game.Systems.Items;

  function getItemDefs() {
    return (window.Game.Data.Items && window.Game.Data.Items.ITEM_DEFS) || {};
  }

  function getConsumableDefs() {
    return (window.Game.Data.Consumables && window.Game.Data.Consumables.CONSUMABLE_DEFS) || {};
  }

  Items.runHook = function (hookName, ctx) {
    if (!ctx || !ctx.player) return ctx;
    const player = ctx.player;
    const inv = player.inventory && player.inventory.passives;
    if (!inv || inv.length === 0) return ctx;

    // Snapshot so a hook mutating inventory mid-dispatch (e.g. a revive item
    // removing itself) doesn't break iteration.
    const snapshot = inv.slice();
    const defs = getItemDefs();

    for (let i = 0; i < snapshot.length; i++) {
      const entry = snapshot[i];
      const def = defs[entry.itemId];
      if (!def || !def.hooks || typeof def.hooks[hookName] !== 'function') continue;
      ctx.stackCount = entry.stackCount;
      ctx.itemId = entry.itemId;
      def.hooks[hookName](ctx);
    }

    return ctx;
  };

  Items.recomputeStats = function (player) {
    if (!player) return;
    const base = player.baseStats || {};
    const stats = Object.assign(
      { extraActions: 0, range: 1, lifestealPct: 0, aoeRadius: 0 },
      base
    );

    const passives = (player.inventory && player.inventory.passives) || [];
    const defs = getItemDefs();

    for (let i = 0; i < passives.length; i++) {
      const entry = passives[i];
      const def = defs[entry.itemId];
      if (!def || !def.statMods) continue;
      const mods = def.statMods;
      const keys = Object.keys(mods);
      for (let k = 0; k < keys.length; k++) {
        const key = keys[k];
        if (typeof stats[key] !== 'number') stats[key] = 0;
        stats[key] += mods[key] * entry.stackCount;
      }
    }

    player.stats = stats;
  };

  Items.addPassive = function (player, itemId, options) {
    if (!player) return;
    const opts = options || {};
    if (!player.inventory) player.inventory = { passives: [], consumables: [] };
    if (!player.inventory.passives) player.inventory.passives = [];

    const defs = getItemDefs();
    const def = defs[itemId];
    const passives = player.inventory.passives;
    let entry = null;
    for (let i = 0; i < passives.length; i++) {
      if (passives[i].itemId === itemId) { entry = passives[i]; break; }
    }

    if (entry) {
      const cap = def && typeof def.maxStacks === 'number' ? def.maxStacks : null;
      if (cap === null || entry.stackCount < cap) {
        entry.stackCount += 1;
      }
      // else: already at cap -- pickup still "happens" (onPickup fires below)
      // but the stack does not increase further. See DESIGN NOTE above.
    } else {
      passives.push({ itemId: itemId, stackCount: 1 });
    }

    Items.recomputeStats(player);

    Items.runHook('onPickup', {
      player: player,
      itemId: itemId,
      rng: opts.rng,
      log: opts.log
    });
  };

  Items.removePassive = function (player, itemId) {
    if (!player || !player.inventory || !player.inventory.passives) return;
    const passives = player.inventory.passives;
    for (let i = 0; i < passives.length; i++) {
      if (passives[i].itemId === itemId) {
        passives.splice(i, 1);
        break;
      }
    }
    Items.recomputeStats(player);
  };

  Items.addConsumable = function (player, itemId, quantity) {
    if (!player) return;
    const qty = typeof quantity === 'number' ? quantity : 1;
    if (!player.inventory) player.inventory = { passives: [], consumables: [] };
    if (!player.inventory.consumables) player.inventory.consumables = [];

    const consumables = player.inventory.consumables;
    for (let i = 0; i < consumables.length; i++) {
      if (consumables[i].itemId === itemId) {
        consumables[i].quantity += qty;
        return;
      }
    }
    consumables.push({ itemId: itemId, quantity: qty });
  };

  Items.useConsumable = function (player, itemId, context) {
    if (!player || !player.inventory || !player.inventory.consumables) return false;
    const consumables = player.inventory.consumables;
    let idx = -1;
    for (let i = 0; i < consumables.length; i++) {
      if (consumables[i].itemId === itemId) { idx = i; break; }
    }
    if (idx === -1) return false;

    const def = getConsumableDefs()[itemId];
    if (!def || typeof def.use !== 'function') return false;

    def.use(player, context || {});

    consumables[idx].quantity -= 1;
    if (consumables[idx].quantity <= 0) {
      consumables.splice(idx, 1);
    }

    return true;
  };
})();
