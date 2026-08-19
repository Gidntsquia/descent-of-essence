// js/data/consumables.js
//
// A small set of single-use consumable definitions on
// Game.Data.Consumables.CONSUMABLE_DEFS. Consumed via
// Game.Systems.Items.useConsumable(player, itemId, context), which calls
// `.use(player, context)` here and then handles quantity bookkeeping itself.
//
// CONSUMABLE DEF SHAPE:
//   { id, name, description, rarity, use(player, context) {...} }
//   context = { rng, log, room } (all optional).

(function () {
  const DEFS = window.Game.Data.Consumables.CONSUMABLE_DEFS;

  function def(d) {
    DEFS[d.id] = d;
  }

  def({
    id: 'healing_potion',
    name: 'Healing Potion',
    description: 'Restores 9 hp, capped at max hp.',
    rarity: 'common',
    use(player, context) {
      if (!player || typeof player.hp !== 'number') return;
      const maxHp = typeof player.maxHp === 'number' ? player.maxHp : player.hp;
      const rng = context && context.rng;
      const amount = rng && typeof rng.randInt === 'function' ? rng.randInt(8, 10) : 9;
      player.hp = Math.min(maxHp, player.hp + amount);
    }
  });

  def({
    id: 'bomb',
    name: 'Bomb',
    description: 'Deals a burst of 8 damage to every enemy in the current room.',
    rarity: 'rare',
    use(player, context) {
      if (!context || !context.room || !Array.isArray(context.room.enemies)) return;
      const enemies = context.room.enemies;
      for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        if (enemy && typeof enemy.hp === 'number') {
          enemy.hp = Math.max(0, enemy.hp - 8);
        }
      }
    }
  });

  def({
    id: 'elixir_of_might',
    name: 'Elixir of Might',
    description: 'Permanently increases attack by 1 for the rest of the run.',
    rarity: 'uncommon',
    use(player) {
      if (!player) return;
      if (!player.baseStats) player.baseStats = {};
      player.baseStats.attack = (player.baseStats.attack || 0) + 1;
      const Items = window.Game.Systems && window.Game.Systems.Items;
      if (Items && typeof Items.recomputeStats === 'function') {
        Items.recomputeStats(player);
      }
    }
  });
})();
