// js/wordbound/events.js
// Event node definitions: one-time decision points with 2-3 choices and different
// risk/reward tradeoffs. These are sprinkled into floors to give players agency
// without branching the node-map itself. Choice happens INSIDE the node, not in
// which node to visit.
//
// PUBLIC API (window.Wordbound.Events):
//   EVENT_DEFS = {
//     eventId: { name, text, choices: [{ text, disabledReason?, effect(state) }] }
//   }
//   pickRandomEvent(rng) -> eventId
//
// A choice's optional `disabledReason(state)` returns a short string when the
// choice can't be taken right now (not enough gold, deck too thin, nothing
// left to give) or null when it can -- renderEvent greys the button out and
// shows the reason, so a gamble the player can't afford reads as unavailable
// instead of silently doing nothing when clicked.
//
// `effect(state)` returns either a log message string (the common case) or
// { message, hold } -- `hold` names a sub-screen that takes over instead of
// the node resolving immediately (currently only 'SHREDDER'). game.js's
// chooseEventOption interprets it; only that file may touch screens/DOM.

(function () {
  window.Wordbound = window.Wordbound || {};
  var Events = (window.Wordbound.Events = {});

  // GOALS.md "FUN OVERHAUL 7/8" gamble-event tuning knobs.
  Events.FORBIDDEN_TOME_INK_RATIO = 0.2;
  Events.FORBIDDEN_TOME_MIN_DAMAGE = 5;
  Events.SHREDDER_MAX_TILES = 2;
  // Never let the Shredder thin a deck below a full rack plus headroom: rack
  // capacity is 7, or 8 with Spare Satchel (items.js), and a deck that can't
  // fill the rack would quietly starve every fight after this one.
  Events.SHREDDER_MIN_DECK_SIZE = 10;
  Events.WAGER_STAKE = 30;
  Events.WAGER_PAYOUT = 90;

  Events.EVENT_DEFS = {
    blood_bargain: {
      name: 'A Dusty Proposition',
      text: 'A tome whispers from the shelf: "Lend me some essence, and I\'ll pay you handsomely in coin."',
      choices: [
        {
          text: 'Strike the deal: Lose 5 ink, gain 20 gold 🪙',
          effect: function (state) {
            state.player.ink = Math.max(0, state.player.ink - 5);
            state.player.gold += 20;
            if (state.runStats) state.runStats.goldEarned += 20;
            return 'The tome glows warmly. A fair exchange, it seems.';
          }
        },
        {
          text: 'Politely decline: Keep your ink',
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
          text: 'Take a chance: Snag it despite the hazard (−3 ink for a random item)',
          effect: function (state) {
            var Items = window.Wordbound && window.Wordbound.Items;
            if (!Items) {
              state.player.ink = Math.max(0, state.player.ink - 3);
              return 'The pages are sharp. Worth it? You\'re not sure yet.';
            }
            var owned = state.player.items;
            var available = Object.keys(Items.ITEM_DEFS).filter(function (id) { return owned.indexOf(id) === -1; });
            if (available.length === 0) {
              state.player.ink = Math.max(0, state.player.ink - 3);
              return 'The pages cut deep, but offer nothing you don\'t already own.';
            }
            var itemId = state.rng.choice(available);
            state.player.items.push(itemId);
            state.player.ink = Math.max(0, state.player.ink - 3);
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
          text: 'Take the risk: Read it (50% chance: +25 gold or −2 ink)',
          effect: function (state) {
            var roll = state.rng.chance(0.5);
            if (roll) {
              state.player.gold += 25;
              if (state.runStats) state.runStats.goldEarned += 25;
              return 'A fascinating passage! You pocket the page—and somehow it becomes gold.';
            } else {
              state.player.ink = Math.max(0, state.player.ink - 2);
              return 'Ouch! Paper cut. The page apologizes profusely as it crumbles away.';
            }
          }
        },
        {
          text: 'Play it safe: Leave it behind',
          effect: function (state) {
            return 'You wisely keep both hands and ink intact.';
          }
        }
      ]
    },

    empty_shelf: {
      name: 'A Suspiciously Bare Shelf',
      text: 'The shelves here gape empty, library dust thick and undisturbed. Something feels... restful.',
      choices: [
        {
          text: 'Sit and breathe: Recover 3 ink, skip the next fight (bosses will not be avoided)',
          effect: function (state) {
            state.player.ink = Math.min(state.player.maxInk, state.player.ink + 3);
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

    // ---- gamble events (GOALS.md "FUN OVERHAUL 7/8") --------------------
    // Each is a real "do I dare" with a stated cost, and each keeps a
    // walk-away choice so the node is never a forced loss.

    forbidden_tome: {
      name: 'The Forbidden Tome',
      text: 'A tome sits chained to a lectern, bristling with rules it plainly intends to break. The chain, on closer inspection, is decorative.',
      choices: [
        {
          text: 'Read it anyway: gain a rule-changer, lose 20% of your max ink (it can\'t kill you)',
          disabledReason: function (state) {
            var Items = window.Wordbound && window.Wordbound.Items;
            if (!Items || !Items.RULE_CHANGER_IDS) return 'the tome is illegible today';
            var unowned = Items.RULE_CHANGER_IDS.filter(function (id) {
              return state.player.items.indexOf(id) === -1;
            });
            return unowned.length === 0 ? 'you have already read every forbidden page' : null;
          },
          effect: function (state) {
            var Items = window.Wordbound.Items;
            var unowned = Items.RULE_CHANGER_IDS.filter(function (id) {
              return state.player.items.indexOf(id) === -1;
            });
            var granted = state.rng.choice(unowned);
            state.player.items.push(granted);
            var damage = Math.max(
              Events.FORBIDDEN_TOME_MIN_DAMAGE,
              Math.round(state.player.maxInk * Events.FORBIDDEN_TOME_INK_RATIO)
            );
            // Floored at 1, not 0: the ticket is explicit that this gamble
            // costs you dearly but never ends the run outright.
            state.player.ink = Math.max(1, state.player.ink - damage);
            return 'The rules rearrange themselves painfully around you (−' + damage +
              ' ink). You now own ' + Items.ITEM_DEFS[granted].name + '.';
          }
        },
        {
          text: 'Leave it chained: some rules are load-bearing',
          effect: function (state) {
            return 'You leave the tome to its lectern. It rattles, disappointed.';
          }
        }
      ]
    },

    the_shredder: {
      name: 'The Shredder',
      text: 'A brass contraption crouches in the corner, all teeth and enthusiasm. A hand-lettered sign reads: "FEED ME THE BAD ONES."',
      choices: [
        {
          text: 'Feed it: destroy up to 2 tiles from your deck, permanently',
          disabledReason: function (state) {
            return (state.deck || []).length <= Events.SHREDDER_MIN_DECK_SIZE
              ? 'your deck is already too thin to feed it'
              : null;
          },
          effect: function (state) {
            return { message: 'The Shredder whirs expectantly.', hold: 'SHREDDER' };
          }
        },
        {
          text: 'Keep your letters: every tile has its day',
          effect: function (state) {
            return 'You pocket your tiles. The Shredder\'s teeth click, unfed.';
          }
        }
      ]
    },

    wager_with_the_stacks: {
      name: 'A Wager with the Stacks',
      text: 'A bookmark-thin voice drifts from between the shelves: "Thirty gold says you can\'t clear your next foe without repeating yourself."',
      choices: [
        {
          text: 'Take the wager: stake 30 gold, win the next fight with no repeated word for 90 🪙',
          disabledReason: function (state) {
            return state.player.gold < Events.WAGER_STAKE
              ? 'you don\'t have ' + Events.WAGER_STAKE + ' gold'
              : null;
          },
          effect: function (state) {
            state.player.gold -= Events.WAGER_STAKE;
            state.activeWager = { stake: Events.WAGER_STAKE, payout: Events.WAGER_PAYOUT };
            return 'You stake ' + Events.WAGER_STAKE + ' gold. The Stacks are listening -- don\'t repeat yourself.';
          }
        },
        {
          text: 'Decline: the Stacks always know something you don\'t',
          effect: function (state) {
            return 'You keep your coin. The voice tuts and returns to its shelf.';
          }
        }
      ]
    },

    mysterious_coin: {
      name: 'A Cataloger\'s Lost Coin',
      text: 'A glimmering coin sits on the floor—Library currency, by the looks of it. Stamped with the Archive\'s seal.',
      choices: [
        {
          text: 'Spend it at the Archive\'s font: Fully restore ink',
          effect: function (state) {
            state.player.ink = state.player.maxInk;
            return 'The coin glows and channels its warmth through you. You feel whole again.';
          }
        },
        {
          text: 'Save it: Pocket the coin for 10 gold later',
          effect: function (state) {
            state.player.gold += 10;
            if (state.runStats) state.runStats.goldEarned += 10;
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
