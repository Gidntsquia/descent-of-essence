// js/wordbound/intents.js
// Telegraphed monster actions (GOALS.md "FUN OVERHAUL 2/8"). A monster's
// NEXT action is pre-rolled and shown to the player before they act, so a
// turn's word choice can answer a specific threat instead of reacting blind
// after the fact -- the load-bearing mechanic this ticket is chasing.
//
// PUBLIC API (window.Wordbound.Intents):
//   HEAVY_MULTIPLIER, ENRAGE_ATTACK_BONUS, MEND_HEAL_RATIO, DEVOUR_DAMAGE_THRESHOLD
//     -- exported so tests/tools can assert against the real numbers instead
//     of duplicating them.
//   rollIntent(monster, rng) -> { type, value }
//     type: 'attack' | 'heavy' | 'hex' | 'devour' | 'mend' | 'enrage'.
//     WEAK-tier monsters always roll plain 'attack' (floor-1 stays
//     welcoming). Regular (normal/strong) monsters weight Attack:3 /
//     Heavy Blow (a HEAVY_MULTIPLIER-x hit):1. Elites (monster.isElite) and
//     bosses (monster.isBoss) additionally weight 1 each toward every
//     signature id listed in the monster's own def-derived `intents` array
//     (e.g. ['hex', 'devour']) -- 'mend' drops out of the pool once
//     monster.mendUsed is true (once-per-fight, so it's never telegraphed
//     as available again after it fires). Uses `rng` (state.rng) so seeded
//     runs stay deterministic -- never Math.random.
//   describeIntent(intent) -> "Next: ..." display string.
//   executeIntent(intent, ctx) -> { damage, message, tileLockedId,
//                                   tileDevouredLetter, healed, enraged }
//     ctx: { player, monster, turnDamage, rng }. turnDamage is the damage
//     the player's word just dealt this turn (Devour's condition checks
//     it). Mutates player.rack / monster.hp / monster.attack /
//     monster.mendUsed as appropriate; never mutates player.hp directly
//     (caller applies `damage`, same as it always has, so item hooks like
//     Thick Skin/Second Wind that adjust ctx.damage still run normally).
//     Devour/Mend/Enrage/Hex all deal 0 `damage` -- they're a monster
//     "using their turn" on something other than a hit.

(function () {
  window.Wordbound = window.Wordbound || {};
  var Intents = (window.Wordbound.Intents = {});

  var HEAVY_MULTIPLIER = 1.6;
  var ENRAGE_ATTACK_BONUS = 2;
  var MEND_HEAL_RATIO = 0.15;
  var DEVOUR_DAMAGE_THRESHOLD = 12;

  Intents.HEAVY_MULTIPLIER = HEAVY_MULTIPLIER;
  Intents.ENRAGE_ATTACK_BONUS = ENRAGE_ATTACK_BONUS;
  Intents.MEND_HEAL_RATIO = MEND_HEAL_RATIO;
  Intents.DEVOUR_DAMAGE_THRESHOLD = DEVOUR_DAMAGE_THRESHOLD;

  function buildPool(monster) {
    if (monster.tier === 'weak') return [{ type: 'attack', weight: 1 }];

    var pool = [
      { type: 'attack', weight: 3 },
      { type: 'heavy', weight: 1 }
    ];

    if (monster.isElite || monster.isBoss) {
      (monster.intents || []).forEach(function (sig) {
        if (sig === 'mend' && monster.mendUsed) return; // once per fight, don't re-telegraph a spent move
        pool.push({ type: sig, weight: 1 });
      });
    }

    return pool;
  }

  Intents.rollIntent = function (monster, rng) {
    var pool = buildPool(monster);
    var picked = rng.weightedChoice(pool, function (it) { return it.weight; });
    var intent = { type: picked.type };
    if (picked.type === 'attack') intent.value = monster.attack || 0;
    else if (picked.type === 'heavy') intent.value = Math.round((monster.attack || 0) * HEAVY_MULTIPLIER);
    return intent;
  };

  Intents.describeIntent = function (intent) {
    if (!intent) return '';
    switch (intent.type) {
      case 'attack': return 'Next: Attack ' + intent.value;
      case 'heavy': return 'Next: Heavy Blow ' + intent.value;
      case 'hex': return 'Next: Hex — a tile will be bound';
      case 'devour': return 'Next: Devour — deal ' + DEVOUR_DAMAGE_THRESHOLD + '+ damage or lose a tile';
      case 'mend': return 'Next: Mend — it will heal';
      case 'enrage': return 'Next: Enrage — its attack will grow';
      default: return '';
    }
  };

  // Signature moves (hex/devour/mend/enrage) are a monster "spending" its
  // turn on something other than a hit -- these are the only intent types
  // NOT covered by the attack/heavy branch below, so grouping them here
  // keeps describeIntent/isSignatureIntent in sync by construction.
  Intents.isSignatureIntent = function (intent) {
    return !!intent && intent.type !== 'attack' && intent.type !== 'heavy';
  };

  Intents.executeIntent = function (intent, ctx) {
    var player = ctx.player, monster = ctx.monster, rng = ctx.rng;
    var result = { damage: 0, message: '', tileLockedId: null, tileDevouredLetter: null, healed: 0, enraged: false };

    if (intent.type === 'attack') {
      result.damage = intent.value;
      result.message = monster.name + ' hits you for ' + result.damage + '.';
      return result;
    }

    if (intent.type === 'heavy') {
      result.damage = intent.value;
      result.message = monster.name + ' lands a Heavy Blow for ' + result.damage + '!';
      return result;
    }

    if (intent.type === 'hex') {
      var hexTile = (player.rack && player.rack.length) ? rng.choice(player.rack) : null;
      if (hexTile) {
        result.tileLockedId = hexTile.id;
        result.message = monster.name + ' hexes your ' + hexTile.letter + ' tile — bound for your next turn.';
      } else {
        result.message = monster.name + ' reaches for a tile, but your rack is empty.';
      }
      return result;
    }

    if (intent.type === 'devour') {
      if ((ctx.turnDamage || 0) < DEVOUR_DAMAGE_THRESHOLD) {
        var idx = (player.rack && player.rack.length) ? rng.randInt(0, player.rack.length - 1) : -1;
        if (idx >= 0) {
          var eaten = player.rack.splice(idx, 1)[0];
          result.tileDevouredLetter = eaten.letter;
          result.message = monster.name + ' devours your ' + eaten.letter + ' tile — gone for the rest of the fight.';
        } else {
          result.message = monster.name + ' lunges for a tile, but finds nothing to eat.';
        }
      } else {
        result.message = monster.name + ' lunges for a tile, but your strike drove it back.';
      }
      return result;
    }

    if (intent.type === 'mend') {
      var healAmt = Math.round((monster.maxHp || 0) * MEND_HEAL_RATIO);
      monster.hp = Math.min(monster.maxHp, monster.hp + healAmt);
      monster.mendUsed = true;
      result.healed = healAmt;
      result.message = monster.name + ' mends its wounds, healing ' + healAmt + ' HP.';
      return result;
    }

    if (intent.type === 'enrage') {
      monster.attack = (monster.attack || 0) + ENRAGE_ATTACK_BONUS;
      result.enraged = true;
      result.message = monster.name + ' enrages — its attack grows!';
      return result;
    }

    return result;
  };
})();
