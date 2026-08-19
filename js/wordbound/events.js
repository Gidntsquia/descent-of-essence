// js/wordbound/events.js
// Event node definitions: one-time decision points with 2-3 choices and different
// risk/reward tradeoffs. These are sprinkled into floors to give players agency
// without branching the node-map itself. Choice happens INSIDE the node, not in
// which node to visit.
//
// PUBLIC API (window.Wordbound.Events):
//   EVENT_DEFS = {
//     eventId: { name, text, choices: [{ text, effect(state) }] }
//   }
//   pickRandomEvent(rng) -> eventId

(function () {
  window.Wordbound = window.Wordbound || {};
  var Events = (window.Wordbound.Events = {});

  Events.EVENT_DEFS = {
    blood_bargain: {
      name: 'A Whispered Deal',
      text: 'A shadowy figure offers you a deal: trade health for gold.',
      choices: [
        {
          text: 'Accept: Lose 5 HP, gain 20 gold',
          effect: function (state) {
            state.player.hp = Math.max(0, state.player.hp - 5);
            state.player.gold += 20;
            return 'You made the deal. The shadows whisper their satisfaction.';
          }
        },
        {
          text: 'Refuse: Keep your health, lose nothing',
          effect: function (state) {
            return 'You step away. The figure dissipates into the Stacks.';
          }
        }
      ]
    },

    cursed_tome: {
      name: 'A Tempting Tome',
      text: 'An ancient book glows on a shelf. It promises knowledge, but at a cost.',
      choices: [
        {
          text: 'Take it: Gain a random item, but lose 3 HP',
          effect: function (state) {
            var Items = window.Wordbound && window.Wordbound.Items;
            if (!Items) {
              state.player.hp = Math.max(0, state.player.hp - 3);
              return 'The tome burns your hands as you grab it. But it\'s just an empty shell.';
            }
            var owned = state.player.items;
            var available = Object.keys(Items.ITEM_DEFS).filter(function (id) { return owned.indexOf(id) === -1; });
            if (available.length === 0) {
              state.player.hp = Math.max(0, state.player.hp - 3);
              return 'The tome burns your hands, but offers nothing new.';
            }
            var RNG = window.Wordbound && window.Wordbound.RNG;
            var itemId = RNG ? state.rng.choice(available) : available[Math.floor(Math.random() * available.length)];
            state.player.items.push(itemId);
            state.player.hp = Math.max(0, state.player.hp - 3);
            return 'You take ' + Items.ITEM_DEFS[itemId].name + '. The tome\'s pages sing.';
          }
        },
        {
          text: 'Leave it: Safe choice, gain nothing',
          effect: function (state) {
            return 'You leave the tome on its shelf. Better not to tempt fate.';
          }
        }
      ]
    },

    lucky_scroll: {
      name: 'A Loose Page',
      text: 'A yellowed page flutters to the ground. It seems to shimmer with potential.',
      choices: [
        {
          text: 'Read it: 50% chance to gain 25 gold, 50% chance to lose 2 HP',
          effect: function (state) {
            var RNG = window.Wordbound && window.Wordbound.RNG;
            var roll = RNG ? state.rng.chance(0.5) : Math.random() < 0.5;
            if (roll) {
              state.player.gold += 25;
              return 'The page shimmers and dissolves into gold dust in your hands.';
            } else {
              state.player.hp = Math.max(0, state.player.hp - 2);
              return 'The page cuts your fingers as it crumbles. A warning, perhaps.';
            }
          }
        },
        {
          text: 'Ignore it: Continue on safely',
          effect: function (state) {
            return 'You leave the page behind, unread.';
          }
        }
      ]
    },

    empty_shelf: {
      name: 'An Empty Shelf',
      text: 'A section of the Stacks stands bare. Time seems to pause here.',
      choices: [
        {
          text: 'Rest here: Restore 3 HP, skip the next combat',
          effect: function (state) {
            state.player.hp = Math.min(state.player.maxHp, state.player.hp + 3);
            state.pendingEventSkipNextCombat = true;
            return 'You rest among the empty shelves. The quiet is restorative.';
          }
        },
        {
          text: 'Search thoroughly: 50% chance for a free item',
          effect: function (state) {
            var RNG = window.Wordbound && window.Wordbound.RNG;
            var roll = RNG ? state.rng.chance(0.5) : Math.random() < 0.5;
            if (roll) {
              var Items = window.Wordbound && window.Wordbound.Items;
              if (Items) {
                var owned = state.player.items;
                var available = Object.keys(Items.ITEM_DEFS).filter(function (id) { return owned.indexOf(id) === -1; });
                if (available.length > 0) {
                  var itemId = RNG ? state.rng.choice(available) : available[Math.floor(Math.random() * available.length)];
                  state.player.items.push(itemId);
                  return 'Hidden in a forgotten corner, you find ' + Items.ITEM_DEFS[itemId].name + '.';
                }
              }
            }
            return roll ? 'You find nothing of value, but at least you tried.' : 'Your search turns up nothing.';
          }
        },
        {
          text: 'Move on: Safe, gain nothing',
          effect: function (state) {
            return 'You leave the empty shelf and press onward.';
          }
        }
      ]
    },

    mysterious_coin: {
      name: 'A Gleaming Coin',
      text: 'A single coin lies on the ground, warm to the touch.',
      choices: [
        {
          text: 'Spend it: Fully restore HP',
          effect: function (state) {
            state.player.hp = state.player.maxHp;
            return 'The coin dissolves as it restores your strength. Curious.';
          }
        },
        {
          text: 'Save it: Gain 10 gold',
          effect: function (state) {
            state.player.gold += 10;
            return 'You pocket the coin. It feels warm against your skin.';
          }
        }
      ]
    }
  };

  Events.pickRandomEvent = function (rng) {
    var ids = Object.keys(Events.EVENT_DEFS);
    return rng.choice(ids);
  };
})();
