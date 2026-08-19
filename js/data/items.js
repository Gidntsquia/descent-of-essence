// js/data/items.js
//
// A small, curated set of passive item definitions on
// Game.Data.Items.ITEM_DEFS. Trimmed deliberately to a handful of clearly
// distinct build directions (raw damage, crit variance, lifesteal sustain,
// extra actions/tempo, defense, retaliation, a one-time safety net, and
// passive healing) rather than a large pool of similar-feeling items -- the
// goal is that every item you find is an easy, legible decision, not one
// entry in a long list you have to read carefully to tell apart.
//
// ITEM DEF SHAPE:
//   { id, name, description, rarity, type: 'passive',
//     stackable: bool, maxStacks: number|null,
//     statMods: { <statKey>: <perStackDelta>, ... },
//     hooks: { <hookName>(ctx) {...}, ... } }
// Only hooks an item actually uses are present on `hooks`.
//
// ctx SHAPES (see items_engine.js / combat.js for the authoritative contract):
//   onAttack   { player, target, damage: {amount, piercing, aoeRadius}, rng, log }
//   onHit      { player, target, damage, targetDied, rng, log }
//   onKill     { player, target, rng, log }
//   onDamaged  { player, attacker, damage: {amount}, rng, log }
//   onTurnEnd  { player, rng, log }
//   onDeath    { player, rng, log, prevented }  -- hook sets ctx.prevented=true to cancel death

(function () {
  const DEFS = window.Game.Data.Items.ITEM_DEFS;

  function def(d) {
    DEFS[d.id] = d;
  }

  def({
    id: 'sharp_fangs',
    name: 'Sharp Fangs',
    description: 'Your attacks bite deeper. +1 attack per stack.',
    rarity: 'common',
    type: 'passive',
    stackable: true,
    maxStacks: null,
    statMods: { attack: 1 }
  });

  def({
    id: 'crit_eye',
    name: 'Crit Eye',
    description: '+8% critical hit chance per stack.',
    rarity: 'common',
    type: 'passive',
    stackable: true,
    maxStacks: 5,
    statMods: { critChance: 0.08 }
  });

  def({
    id: 'vampiric_tooth',
    name: 'Vampiric Tooth',
    description: 'Heal for 10% of damage dealt, per stack.',
    rarity: 'uncommon',
    type: 'passive',
    stackable: true,
    maxStacks: 5,
    statMods: { lifestealPct: 0.10 }
  });

  def({
    id: 'adrenaline_rush',
    name: 'Adrenaline Rush',
    description: 'Grants an extra action per turn, per stack.',
    rarity: 'legendary',
    type: 'passive',
    stackable: true,
    maxStacks: 2,
    statMods: { extraActions: 1 }
  });

  def({
    id: 'iron_skin',
    name: 'Iron Skin',
    description: '+1 defense per stack.',
    rarity: 'common',
    type: 'passive',
    stackable: true,
    maxStacks: null,
    statMods: { defense: 1 }
  });

  def({
    id: 'thorns',
    name: 'Thorns',
    description: 'Reflects a portion of incoming damage back at the attacker.',
    rarity: 'common',
    type: 'passive',
    stackable: true,
    maxStacks: 5,
    statMods: {},
    hooks: {
      onDamaged(ctx) {
        if (!ctx || !ctx.damage || !ctx.attacker) return;
        const amount = ctx.damage.amount || 0;
        const reflected = amount * 0.15 * ctx.stackCount;
        if (reflected <= 0) return;
        if (typeof ctx.attacker.hp === 'number') {
          ctx.attacker.hp = Math.max(0, ctx.attacker.hp - reflected);
        }
      }
    }
  });

  def({
    id: 'guardian_angel',
    name: 'Guardian Angel',
    description: 'The first time you would die, survive with a sliver of hp instead. Consumed on use.',
    rarity: 'legendary',
    type: 'passive',
    stackable: false,
    maxStacks: 1,
    statMods: {},
    hooks: {
      onDeath(ctx) {
        if (!ctx || !ctx.player) return;
        ctx.prevented = true;
        const maxHp = ctx.player.maxHp;
        if (typeof maxHp === 'number') {
          ctx.player.hp = Math.max(1, Math.round(maxHp * 0.3));
        }
        if (window.Game.Systems.Items && typeof window.Game.Systems.Items.removePassive === 'function') {
          window.Game.Systems.Items.removePassive(ctx.player, ctx.itemId);
        }
      }
    }
  });

  def({
    id: 'regeneration_charm',
    name: 'Regeneration Charm',
    description: 'Heal 1 hp per stack at the end of every turn.',
    rarity: 'uncommon',
    type: 'passive',
    stackable: true,
    maxStacks: null,
    statMods: {},
    hooks: {
      onTurnEnd(ctx) {
        if (!ctx || !ctx.player) return;
        if (typeof ctx.player.hp !== 'number' || typeof ctx.player.maxHp !== 'number') return;
        ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + 1 * ctx.stackCount);
      }
    }
  });
})();
