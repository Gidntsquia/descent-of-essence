// js/wordbound/intents.js
// Telegraphed monster actions (GOALS.md "FUN OVERHAUL 2/8"). A monster's
// NEXT action is pre-rolled and shown to the player before they act, so a
// turn's word choice can answer a specific threat instead of reacting blind
// after the fact -- the load-bearing mechanic this ticket is chasing.
//
// PUBLIC API (window.Wordbound.Intents):
//   HEAVY_MULTIPLIER, ENRAGE_ATTACK_BONUS, ENRAGE_MAX_STACKS, MEND_HEAL_RATIO,
//   DEVOUR_DAMAGE_THRESHOLD
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
//     as available again after it fires), same as 'enrage' drops out once
//     monster.enrageStacks reaches ENRAGE_MAX_STACKS and 'devour' drops out
//     once monster.devourUsed is true (also once-per-fight, added in the
//     same pass as the ratio/bonus cuts below) (GOALS.md balance ticket,
//     2026-08-20: Enrage had no cap at all, letting a long fight spiral
//     into an ever-growing attack stat; a follow-up orchestrator decision
//     the same day found the cap alone wasn't enough and also cut Enrage's
//     per-stack bonus, Mend's heal ratio, and added Devour's cap -- see
//     that ticket and PROGRESS.md for the win-rate data behind both
//     passes). Uses `rng`
//     (state.rng) so seeded runs stay deterministic -- never Math.random.
//   describeIntent(intent) -> "Next: ..." display string.
//   executeIntent(intent, ctx) -> { damage, message, tileLockedId,
//                                   tileDevouredLetter, healed, enraged }
//     ctx: { player, monster, turnDamage, rng }. turnDamage is the damage
//     the player's word just dealt this turn (Devour's condition checks
//     it). Mutates player.rack / monster.hp / monster.attack /
//     monster.mendUsed as appropriate; never mutates player.ink directly
//     (caller applies `damage`, same as it always has, so item hooks like
//     Thick Skin/Second Wind that adjust ctx.damage still run normally).
//     Devour/Mend/Enrage/Hex all deal 0 `damage` -- they're a monster
//     "using their turn" on something other than a hit. Attack/Heavy Blow
//     damage spills the player's ink (see ctx.player.ink in game.js).

(function () {
  window.Wordbound = window.Wordbound || {};
  var Intents = (window.Wordbound.Intents = {});

  var HEAVY_MULTIPLIER = 1.6;
  // Enrage/Mend/Devour tuning (GOALS.md balance ticket, 2026-08-20
  // "orchestrator decision"): the original numbers (ENRAGE_ATTACK_BONUS=2,
  // MEND_HEAL_RATIO=0.15, Devour with no per-fight cap) were sized before
  // multi-phase bosses existed, and simulation showed they turned every
  // extra monster turn into a compounding advantage -- fights got longer,
  // which let Enrage/Mend/Devour fire more times, which made fights longer
  // still. These are the non-compounding versions: Enrage's cap was added
  // in a prior pass (ENRAGE_MAX_STACKS) but the per-stack bonus was still
  // too strong even capped; this pass halves it. Mend heals less. Devour
  // gets the same once-per-fight guard Mend already had (see
  // monster.devourUsed below) -- see PROGRESS.md for the sim data.
  var ENRAGE_ATTACK_BONUS = 1;
  var ENRAGE_MAX_STACKS = 3;
  var MEND_HEAL_RATIO = 0.10;
  var DEVOUR_DAMAGE_THRESHOLD = 12;

  Intents.HEAVY_MULTIPLIER = HEAVY_MULTIPLIER;
  Intents.ENRAGE_ATTACK_BONUS = ENRAGE_ATTACK_BONUS;
  Intents.ENRAGE_MAX_STACKS = ENRAGE_MAX_STACKS;
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
        if (sig === 'enrage' && (monster.enrageStacks || 0) >= ENRAGE_MAX_STACKS) return; // capped, don't re-telegraph a spent move
        if (sig === 'devour' && monster.devourUsed) return; // once per fight (2026-08-20 balance pass): an uncapped Devour in a long fight could eat the whole rack
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
      result.message = monster.name + ' hits you, spilling ' + result.damage + ' ink.';
      return result;
    }

    if (intent.type === 'heavy') {
      result.damage = intent.value;
      result.message = monster.name + ' lands a Heavy Blow, spilling ' + result.damage + ' ink!';
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
          // Splices the tile object out of the in-fight rack array only --
          // it was never removed from state.deck, so it's already
          // fight-scoped (a fresh pile gets shuffled from the deck at the
          // start of the NEXT fight and the eaten tile is back in
          // rotation). monster.devourUsed caps this to once per fight so a
          // long fight can't eat the whole rack.
          var eaten = player.rack.splice(idx, 1)[0];
          monster.devourUsed = true;
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
      // GOALS.md bug (2026-08-20 QA pass): report the actual post-clamp
      // delta, not the raw ratio-derived amount -- a monster within
      // healAmt of its max HP was previously reporting a bigger number
      // than it actually gained.
      var healAmt = Math.round((monster.maxHp || 0) * MEND_HEAL_RATIO);
      var actualHeal = Math.min(monster.maxHp, monster.hp + healAmt) - monster.hp;
      monster.hp += actualHeal;
      monster.mendUsed = true;
      result.healed = actualHeal;
      result.message = monster.name + ' mends its wounds, healing ' + actualHeal + ' HP.';
      return result;
    }

    if (intent.type === 'enrage') {
      monster.attack = (monster.attack || 0) + ENRAGE_ATTACK_BONUS;
      monster.enrageStacks = (monster.enrageStacks || 0) + 1;
      result.enraged = true;
      result.message = monster.name + ' enrages — its attack grows!';
      return result;
    }

    return result;
  };
})();
