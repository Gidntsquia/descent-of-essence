// js/wordbound/consumables.js
// One-time-use consumable items (Errata Slips and variants).
// Separate from permanent items.js -- consumables are used up and removed from inventory.
//
// PUBLIC API (window.Wordbound.Consumables):
//   CONSUMABLE_DEFS[id] = {
//     id, name, hint, rarity, effect
//   }
//   useConsumable(consumableId, ctx) -> applies effect (heal, damage boost, etc.)
//       ctx = { player, monster } during combat
//   getConsumableDropChance() -> returns probability (0-1) that an enemy drop includes a consumable

(function () {
  window.Wordbound = window.Wordbound || {};
  var Consumables = (window.Wordbound.Consumables = {});
  var CONSUMABLE_DEFS = {};
  Consumables.CONSUMABLE_DEFS = CONSUMABLE_DEFS;

  function def(d) {
    CONSUMABLE_DEFS[d.id] = d;
  }

  // Errata Slip: Heal 8 ink (or to max, whichever is less)
  def({
    id: 'errata_slip',
    name: 'Errata Slip',
    hint: 'Restore 8 ink (or to max). A correction slip from the Archive.',
    rarity: 'common',
    shopPrice: 15,
    effect: function (ctx) {
      var healed = Math.min(8, ctx.player.maxInk - ctx.player.ink);
      ctx.player.ink += healed;
      return {
        message: 'Errata Slip: Restored ' + healed + ' ink!',
        healed: healed
      };
    }
  });

  // Index Card Shard: +15 damage to next word this turn only
  def({
    id: 'index_card_shard',
    name: 'Index Card Shard',
    hint: 'Next word deals +15 damage this turn. Knowledge is power.',
    rarity: 'uncommon',
    shopPrice: 25,
    effect: function (ctx) {
      ctx.player.bonusDamageUntilEndOfTurn = (ctx.player.bonusDamageUntilEndOfTurn || 0) + 15;
      return {
        message: 'Index Card Shard: Next word gets +15 damage!',
        bonusDamage: 15
      };
    }
  });

  // Page Turn: Draw 3 bonus tiles, skip discard cycle this turn
  def({
    id: 'page_turn',
    name: 'Page Turn',
    hint: 'Draw 3 bonus tiles, skip discard cycle. Read ahead.',
    rarity: 'rare',
    shopPrice: 40,
    effect: function (ctx) {
      // Mark that we should draw extra tiles and skip discard
      ctx.player.skipDiscardNextTurn = true;
      ctx.player.bonusTilesToDraw = (ctx.player.bonusTilesToDraw || 0) + 3;
      return {
        message: 'Page Turn: You\'ll draw 3 bonus tiles and skip the discard!',
        bonusTiles: 3
      };
    }
  });

  // Use a consumable and remove it from inventory
  Consumables.useConsumable = function (consumableId, ctx) {
    var def = CONSUMABLE_DEFS[consumableId];
    if (!def) return { message: 'Item not found', error: true };

    var result = def.effect(ctx);
    return result;
  };

  // Chance of consumable drop from defeated enemy: 20%
  Consumables.getConsumableDropChance = function () {
    return 0.20;
  };

  // Roll a random consumable drop (uniform among all defs, not rarity-weighted)
  Consumables.rollConsumableDrop = function (rng) {
    var ids = Object.keys(CONSUMABLE_DEFS);
    if (ids.length === 0) return null;
    return ids[Math.floor(rng.next() * ids.length)];
  };

  // Expose definitions for shop/display purposes
  Consumables.getAllIds = function () {
    return Object.keys(CONSUMABLE_DEFS);
  };
})();
