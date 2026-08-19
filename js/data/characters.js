// js/data/characters.js
//
// Starting character loadouts on Game.Data.Characters.CHARACTER_DEFS. All
// three are available from the start -- there is no unlock economy.
// Consumed by game-setup logic when starting a run: it should read
// startingHp/startingBaseStats to build the initial player object, then call
// Game.Systems.Items.addPassive(player, itemId, {}) for each id in
// startingItems and Game.Systems.Items.addConsumable(player, itemId, qty)
// for each entry in startingConsumables.
//
// CHARACTER DEF SHAPE:
//   { id, name, description, startingHp,
//     startingBaseStats: { attack, defense, speed, critChance, critMult },
//     startingItems: [itemId, ...],
//     startingConsumables: [{itemId, quantity}, ...] }

(function () {
  const DEFS = window.Game.Data.Characters.CHARACTER_DEFS;

  function def(d) {
    DEFS[d.id] = d;
  }

  def({
    id: 'warrior',
    name: 'Warrior',
    description: 'A balanced fighter with no glaring weaknesses. Starts with sharpened claws and a potion.',
    startingHp: 20,
    startingBaseStats: { attack: 2, defense: 1, speed: 5, critChance: 0.05, critMult: 1.5 },
    startingItems: ['sharp_fangs'],
    startingConsumables: [{ itemId: 'healing_potion', quantity: 1 }]
  });

  def({
    id: 'rogue',
    name: 'Rogue',
    description: 'A glass cannon: fast and precise, but fragile. Starts with a keen eye for weak points.',
    startingHp: 14,
    startingBaseStats: { attack: 2, defense: 0, speed: 7, critChance: 0.15, critMult: 2.0 },
    startingItems: ['crit_eye'],
    startingConsumables: [{ itemId: 'healing_potion', quantity: 1 }]
  });

  def({
    id: 'tank',
    name: 'Tank',
    description: 'High hp and defense at the cost of raw damage. Starts with reinforced skin.',
    startingHp: 28,
    startingBaseStats: { attack: 1, defense: 3, speed: 3, critChance: 0.03, critMult: 1.5 },
    startingItems: ['iron_skin'],
    startingConsumables: [{ itemId: 'healing_potion', quantity: 1 }]
  });
})();
