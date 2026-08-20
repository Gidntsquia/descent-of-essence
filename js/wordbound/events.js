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
      name: 'A Dusty Proposition',
      text: 'A tome whispers from the shelf: "Lend me some essence, and I\'ll pay you handsomely in coin."',
      choices: [
        {
          text: 'Strike the deal: Lose 5 HP, gain 20 gold 🪙',
          effect: function (state) {
            state.player.hp = Math.max(0, state.player.hp - 5);
            state.player.gold += 20;
            return 'The tome glows warmly. A fair exchange, it seems.';
          }
        },
        {
          text: 'Politely decline: Invest in health',
          effect: function (state) {
            return 'The tome shrugs (metaphorically) and returns to its shelf.';
          }
        }
      ]
    },

    cursed_tome: {
      name: 'Reserved for the Bold',
      text: 'A rare book sits on the Reserve shelf, cordoned off. "Help yourself," the Archive whispers.',
      choices: [
        {
          text: 'Take a chance: Snag it despite the hazard (−3 HP for a random item)',
          effect: function (state) {
            var Items = window.Wordbound && window.Wordbound.Items;
            if (!Items) {
              state.player.hp = Math.max(0, state.player.hp - 3);
              return 'The pages are sharp. Worth it? You\'re not sure yet.';
            }
            var owned = state.player.items;
            var available = Object.keys(Items.ITEM_DEFS).filter(function (id) { return owned.indexOf(id) === -1; });
            if (available.length === 0) {
              state.player.hp = Math.max(0, state.player.hp - 3);
              return 'The pages cut deep, but offer nothing you don\'t already own.';
            }
            var itemId = state.rng.choice(available);
            state.player.items.push(itemId);
            state.player.hp = Math.max(0, state.player.hp - 3);
            return 'You claim ' + Items.ITEM_DEFS[itemId].name + '. The pages settle, content.';
          }
        },
        {
          text: 'Read the sign: Respect the rope',
          effect: function (state) {
            return 'Some books are reserved for a reason. You wisely press on.';
          }
        }
      ]
    },

    lucky_scroll: {
      name: 'A Loose Page',
      text: 'A page flutters down from the chaos above. "Read me?" it whispers hopefully.',
      choices: [
        {
          text: 'Take the risk: Read it (50% chance: +25 gold or −2 HP)',
          effect: function (state) {
            var roll = state.rng.chance(0.5);
            if (roll) {
              state.player.gold += 25;
              return 'A fascinating passage! You pocket the page—and somehow it becomes gold.';
            } else {
              state.player.hp = Math.max(0, state.player.hp - 2);
              return 'Ouch! Paper cut. The page apologizes profusely as it crumbles away.';
            }
          }
        },
        {
          text: 'Play it safe: Leave it behind',
          effect: function (state) {
            return 'You wisely keep both hands and health intact.';
          }
        }
      ]
    },

    empty_shelf: {
      name: 'A Suspiciously Bare Shelf',
      text: 'The shelves here gape empty, library dust thick and undisturbed. Something feels... restful.',
      choices: [
        {
          text: 'Sit and breathe: Recover 3 HP, skip the next fight',
          effect: function (state) {
            state.player.hp = Math.min(state.player.maxHp, state.player.hp + 3);
            state.pendingEventSkipNextCombat = true;
            return 'Silence wraps around you like a bookmark. You feel renewed.';
          }
        },
        {
          text: 'Hunt for forgotten treasures: 50% chance to find an item',
          effect: function (state) {
            var roll = state.rng.chance(0.5);
            if (roll) {
              var Items = window.Wordbound && window.Wordbound.Items;
              if (Items) {
                var owned = state.player.items;
                var available = Object.keys(Items.ITEM_DEFS).filter(function (id) { return owned.indexOf(id) === -1; });
                if (available.length > 0) {
                  var itemId = state.rng.choice(available);
                  state.player.items.push(itemId);
                  return 'Deep in a forgotten corner, you discover ' + Items.ITEM_DEFS[itemId].name + '. How did it get here?';
                }
              }
            }
            return roll ? 'You find dust. Lots of dust. Just dust.' : 'Nothing but phantom imprints on the shelves.';
          }
        },
        {
          text: 'Move on: The silence makes you uneasy',
          effect: function (state) {
            return 'You hurry past. Empty shelves shouldn\'t exist in the Archive.';
          }
        }
      ]
    },

    mysterious_coin: {
      name: 'A Cataloger\'s Lost Coin',
      text: 'A glimmering coin sits on the floor—Library currency, by the looks of it. Stamped with the Archive\'s seal.',
      choices: [
        {
          text: 'Spend it at the Archive\'s font: Fully restore HP',
          effect: function (state) {
            state.player.hp = state.player.maxHp;
            return 'The coin glows and channels its warmth through you. You feel whole again.';
          }
        },
        {
          text: 'Save it: Pocket the coin for 10 gold later',
          effect: function (state) {
            state.player.gold += 10;
            return 'You pocket the warm coin. The Archive always takes its currency back, eventually.';
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
