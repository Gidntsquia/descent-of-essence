// js/wordbound/items.js
// Rack-modifier items. No shop, no currency -- items are found as a free
// pick-one-of-3 at Treasure nodes (see items scoped work in Task #10). This
// mirrors the old game's statMods+hooks split (Data.Items) but trimmed to
// exactly the hook points Wordbound's combat loop actually needs.
//
// PUBLIC API (window.Wordbound.Items):
//   ITEM_DEFS[id] = {
//     id, name, hint, rarity,
//     statMods: { rackCapacityBonus, damageReductionFlat },
//     hooks: {
//       onRunStart(ctx)      ctx = { player, pileState } -- fires at the
//                            start of every fight; pileState is that fight's
//                            { drawPile, discardPile } (see tiles.js), still
//                            empty of a drawn rack at this point.
//       onDraw(ctx)          ctx = { player, drawnTiles, pileState, rng }
//                            drawnTiles is the array of Tile objects just
//                            drawn (tiles.js); hooks may mutate it in place.
//       onWordPlayed(ctx)    ctx = { player, monster, word, tilesUsed, result,
//                            previousWord, wordsPlayedThisFight, messages }.
//                            tilesUsed is the array of Tile objects played.
//                            result is the object Combat.playWord returned;
//                            hooks may add to result.damage (already applied
//                            to monster.hp by the caller's follow-up) or heal
//                            player.ink. See applyBonusDamage below.
//                            previousWord (GOALS.md "FUN OVERHAUL 4/8") is the
//                            upper-cased word played immediately before this
//                            one THIS FIGHT, or null on the fight's first word
//                            (repeats count as their own previous word too --
//                            this just tracks sequence, independent of
//                            combo/novelty). wordsPlayedThisFight is a 1-based
//                            count of words played so far this fight,
//                            INCLUDING this one and any repeats (so ===1 means
//                            "this is the fight's first word"). messages is an
//                            array hooks can push user-facing strings onto
//                            (e.g. "Gilded Bookmark: x2!") -- the caller logs
//                            each one after all hooks run. Silent modifiers
//                            don't create builds; every new proc should push
//                            a message here.
//       onPlayerDamaged(ctx) ctx = { player, monster, damage } -- damage is
//                            mutable; caller applies ctx.damage, not the
//                            original amount.
//       onFloorAdvance(ctx) ctx = { player, floorNumber, messages } -- fires
//                            once when a floor is cleared and the run
//                            advances to the next one (game.js
//                            advanceFloor), BEFORE the new floor is
//                            generated. floorNumber is the floor just
//                            entered. messages works like onWordPlayed's:
//                            push a user-facing string to have the caller
//                            log it. Added for CONTENT ticket (GOALS.md,
//                            2026-08-21)'s Acquisitions Budget -- the only
//                            item using this hook so far.
//     }
//   }
//   getRackCapacity(player) -> 7 + sum of owned rackCapacityBonus
//   runHook(hookName, ctx, player) -> iterates player.items (array of item
//       ids, pickup order) and invokes any matching hook, mutating ctx.
//   applyBonusDamage(ctx, amount) -> helper hooks call to add extra damage
//       to a monster mid-onWordPlayed (mutates ctx.monster.hp directly since
//       Combat.playWord has already returned by the time hooks run).
//   applyPercentBonus(ctx, pct) -> helper for percentage-of-current-damage
//       items (e.g. 0.4 for +40%, 1.0 for a flat x2 -- "x2" is "+100%" of the
//       current total, not a multiply-in-place, so it stacks additively with
//       any other percent bonus that already fired this same word, same as
//       every other onWordPlayed hook). Returns the rounded bonus applied.

(function () {
  window.Wordbound = window.Wordbound || {};
  var Items = (window.Wordbound.Items = {});
  var ITEM_DEFS = {};
  Items.ITEM_DEFS = ITEM_DEFS;

  function def(d) {
    d.statMods = d.statMods || {};
    d.hooks = d.hooks || {};
    ITEM_DEFS[d.id] = d;
  }

  def({
    id: 'spare_satchel',
    name: 'Spare Satchel',
    hint: 'Extra pockets for your words—one more tile per hand.',
    rarity: 'common',
    shopPrice: 25,
    statMods: { rackCapacityBonus: 1 }
  });

  def({
    id: 'lucky_vowel',
    name: 'Lucky Vowel',
    hint: "Fortune favors the vocal—never a draw without one.",
    rarity: 'common',
    shopPrice: 20,
    hooks: {
      onDraw: function (ctx) {
        var VOWELS = ['A', 'E', 'I', 'O', 'U'];
        var hasVowel = ctx.drawnTiles.some(function (t) { return VOWELS.indexOf(t.letter) !== -1; });
        if (hasVowel || ctx.drawnTiles.length === 0) return;
        var pool = ctx.pileState.drawPile;
        var vowelIdx = -1;
        for (var i = pool.length - 1; i >= 0; i--) {
          if (VOWELS.indexOf(pool[i].letter) !== -1) { vowelIdx = i; break; }
        }
        if (vowelIdx === -1) return;
        var vowelTile = pool.splice(vowelIdx, 1)[0];
        var swapIdx = ctx.rng ? ctx.rng.randInt(0, ctx.drawnTiles.length - 1) : 0;
        var displaced = ctx.drawnTiles[swapIdx];
        ctx.drawnTiles[swapIdx] = vowelTile;
        pool.push(displaced);
      }
    }
  });

  def({
    id: 'wildcard_pouch',
    name: 'Wildcard Pouch',
    hint: 'Unwritten possibilities—two blanks in every hand, waiting to become anything.',
    rarity: 'uncommon',
    shopPrice: 35,
    hooks: {
      onRunStart: function (ctx) {
        var Tiles = window.Wordbound.Tiles;
        ctx.pileState.drawPile.push(Tiles.createTile('?', null), Tiles.createTile('?', null));
      }
    }
  });

  def({
    id: 'heavy_ink',
    name: 'Heavy Ink',
    hint: "That precious letter? It leaves its mark twice.",
    rarity: 'uncommon',
    shopPrice: 30,
    hooks: {
      onWordPlayed: function (ctx) {
        var Lexicon = window.Wordbound.Lexicon;
        var best = 0;
        ctx.tilesUsed.forEach(function (t) {
          var v = Lexicon.LETTER_VALUES[t.letter] || 0;
          if (v > best) best = v;
        });
        if (best > 0) Items.applyBonusDamage(ctx, best);
      }
    }
  });

  def({
    id: 'rare_hunter',
    name: 'Rare Hunter',
    hint: 'Spot a prize letter and strike while it gleams.',
    rarity: 'uncommon',
    shopPrice: 40,
    hooks: {
      onWordPlayed: function (ctx) {
        var Lexicon = window.Wordbound.Lexicon;
        var hasRare = ctx.word.split('').some(function (l) { return (Lexicon.LETTER_VALUES[l] || 0) >= 4; });
        if (hasRare) Items.applyBonusDamage(ctx, 3);
      }
    }
  });

  def({
    id: 'vowel_leech',
    name: 'Vowel Leech',
    hint: 'Each A, E, I, O, U feeds your wounds. The more you speak, the more you mend.',
    rarity: 'rare',
    shopPrice: 35,
    hooks: {
      onWordPlayed: function (ctx) {
        var VOWELS = ['A', 'E', 'I', 'O', 'U'];
        var healed = ctx.word.split('').filter(function (l) { return VOWELS.indexOf(l) !== -1; }).length;
        if (healed > 0) ctx.player.ink = Math.min(ctx.player.maxInk, ctx.player.ink + healed);
      }
    }
  });

  def({
    id: 'thick_skin',
    name: 'Thick Skin',
    hint: 'Hardened. Weathered. Words bounce off you like rain.',
    rarity: 'common',
    shopPrice: 45,
    statMods: { damageReductionFlat: 2 },
    hooks: {
      onPlayerDamaged: function (ctx) {
        ctx.damage = Math.max(1, ctx.damage - 2);
      }
    }
  });

  def({
    id: 'second_wind',
    name: 'Second Wind',
    hint: 'Not over yet. One last breath, when it matters most.',
    rarity: 'legendary',
    shopPrice: 60,
    hooks: {
      onPlayerDamaged: function (ctx) {
        if (ctx.player.usedSecondWind) return;
        if (ctx.damage < ctx.player.ink) return;
        ctx.damage = ctx.player.ink - 1;
        ctx.player.usedSecondWind = true;
      }
    }
  });

  def({
    id: 'folio_mark',
    name: 'Folio Mark',
    hint: 'Those marked tiles sing louder when you play them.',
    rarity: 'uncommon',
    shopPrice: 40,
    hooks: {
      onWordPlayed: function (ctx) {
        var bonusCount = 0;
        ctx.tilesUsed.forEach(function (t) {
          if (t.bonus) bonusCount++;
        });
        if (bonusCount > 0) Items.applyBonusDamage(ctx, bonusCount * 2);
      }
    }
  });

  def({
    id: 'marginalia',
    name: 'Marginalia',
    hint: 'Notes in the margins have a way of healing old wounds.',
    rarity: 'uncommon',
    shopPrice: 35,
    hooks: {
      onWordPlayed: function (ctx) {
        if (ctx.word.length >= 5) {
          ctx.player.ink = Math.min(ctx.player.maxInk, ctx.player.ink + 2);
        }
      }
    }
  });

  def({
    id: 'catalog_tab',
    name: 'Catalog Tab',
    hint: 'A perfect sequence—organized, precise, and devastating.',
    rarity: 'uncommon',
    shopPrice: 35,
    hooks: {
      onWordPlayed: function (ctx) {
        var isAlphabetical = true;
        for (var i = 1; i < ctx.word.length; i++) {
          if (ctx.word[i] < ctx.word[i - 1]) { isAlphabetical = false; break; }
        }
        if (isAlphabetical) Items.applyBonusDamage(ctx, 2);
      }
    }
  });

  def({
    id: 'blank_slate',
    name: 'Blank Slate',
    hint: 'An unwritten tile becomes whatever the moment needs.',
    rarity: 'uncommon',
    shopPrice: 40,
    hooks: {
      onWordPlayed: function (ctx) {
        var blankCount = 0;
        ctx.tilesUsed.forEach(function (t) {
          if (t.letter === '?') blankCount++;
        });
        if (blankCount > 0) Items.applyBonusDamage(ctx, blankCount * 2);
      }
    }
  });

  def({
    id: 'dust_jacket',
    name: 'Dust Jacket',
    hint: 'Every marked tile shelters you like a page held close.',
    rarity: 'uncommon',
    shopPrice: 35,
    hooks: {
      onPlayerDamaged: function (ctx) {
        var bonusCount = 0;
        (ctx.player.rack || []).forEach(function (t) {
          if (t.bonus) bonusCount++;
        });
        var reduction = Math.min(ctx.damage - 1, bonusCount);
        ctx.damage = Math.max(1, ctx.damage - reduction);
      }
    }
  });

  def({
    id: 'rare_tome',
    name: 'Rare Tome',
    hint: 'X, Q, Z—the alphabet\'s rarest treasures, and this book knows them all.',
    rarity: 'uncommon',
    shopPrice: 40,
    hooks: {
      onWordPlayed: function (ctx) {
        var hasRare = ctx.word.split('').some(function (l) { return l === 'X' || l === 'Q' || l === 'Z'; });
        if (hasRare) Items.applyBonusDamage(ctx, 2);
      }
    }
  });

  def({
    id: 'foreword',
    name: 'Foreword',
    hint: 'The words you don\'t say echo loudest. Unused tiles sharpen the blow.',
    rarity: 'rare',
    shopPrice: 45,
    hooks: {
      onWordPlayed: function (ctx) {
        var unusedCount = (ctx.player.rack || []).length;
        if (unusedCount > 0) Items.applyBonusDamage(ctx, unusedCount);
      }
    }
  });

  // ---- FUN OVERHAUL 4/8 (GOALS.md, 2026-08-20): build-defining rule-changer
  // items. All 8 hook onWordPlayed and read the new ctx fields
  // (previousWord, wordsPlayedThisFight) game.js's Game.submitWord now
  // provides. Every proc pushes a message onto ctx.messages -- silent
  // modifiers don't create builds, per the ticket's own instruction.

  def({
    id: 'illuminated_initial',
    name: 'Illuminated Initial',
    hint: 'The first letter, gilded -- echo it and the page catches fire.',
    rarity: 'rare',
    shopPrice: 45,
    hooks: {
      onWordPlayed: function (ctx) {
        if (!ctx.previousWord || !ctx.word) return;
        if (ctx.word[0] !== ctx.previousWord[0]) return;
        Items.applyPercentBonus(ctx, 0.4);
        ctx.messages.push('Illuminated Initial: +40%!');
      }
    }
  });

  def({
    id: 'errant_footnote',
    name: 'Errant Footnote',
    hint: 'Every third mark in the margin lands twice as hard.',
    rarity: 'rare',
    shopPrice: 45,
    hooks: {
      onWordPlayed: function (ctx) {
        if (!ctx.wordsPlayedThisFight || ctx.wordsPlayedThisFight % 3 !== 0) return;
        Items.applyPercentBonus(ctx, 1.0);
        ctx.messages.push('Errant Footnote: x2!');
      }
    }
  });

  def({
    id: 'vowel_reliquary',
    name: 'Vowel Reliquary',
    hint: 'Sacred vowels, kept behind glass -- speak them and they blaze.',
    rarity: 'rare',
    shopPrice: 45,
    hooks: {
      onWordPlayed: function (ctx) {
        var VOWELS = ['A', 'E', 'I', 'O', 'U'];
        var Lexicon = window.Wordbound.Lexicon;
        var bonus = 0;
        ctx.word.split('').forEach(function (l) {
          if (VOWELS.indexOf(l) !== -1) bonus += 2 * (Lexicon.LETTER_VALUES[l] || 0);
        });
        if (bonus > 0) {
          Items.applyBonusDamage(ctx, bonus);
          ctx.messages.push('Vowel Reliquary: +' + bonus + '!');
        }
      }
    }
  });

  def({
    id: 'consonant_cluster',
    name: 'Consonant Cluster',
    hint: 'Hard sounds, harder blows -- every consonant adds its weight.',
    rarity: 'uncommon',
    shopPrice: 35,
    hooks: {
      onWordPlayed: function (ctx) {
        var VOWELS = ['A', 'E', 'I', 'O', 'U'];
        var consonantCount = ctx.word.split('').filter(function (l) { return VOWELS.indexOf(l) === -1; }).length;
        if (consonantCount > 0) {
          var bonus = consonantCount * 2;
          Items.applyBonusDamage(ctx, bonus);
          ctx.messages.push('Consonant Cluster: +' + bonus + '!');
        }
      }
    }
  });

  def({
    id: 'long_s_ligature',
    name: 'Long-S Ligature',
    hint: 'An old, elegant stroke -- the longer the word, the deeper it cuts, and mends.',
    rarity: 'rare',
    shopPrice: 45,
    hooks: {
      onWordPlayed: function (ctx) {
        if (ctx.word.length < 6) return;
        Items.applyPercentBonus(ctx, 0.25);
        ctx.player.ink = Math.min(ctx.player.maxInk, ctx.player.ink + 1);
        ctx.messages.push('Long-S Ligature: +25% and mended!');
      }
    }
  });

  def({
    id: 'cursed_quill',
    name: 'Cursed Quill',
    hint: 'It writes on its own terms -- power for a price paid in your own blood.',
    rarity: 'rare',
    shopPrice: 40,
    hooks: {
      onWordPlayed: function (ctx) {
        Items.applyBonusDamage(ctx, 10);
        // Deliberately no floor here (unlike Thick Skin/Second Wind's
        // damage-reduction hooks) -- the ticket's own wording is "can kill
        // you, that's the deal." Game.submitWord checks player.ink right
        // after onWordPlayed hooks run specifically so this self-damage
        // (which lands on the player's OWN turn, before any monster
        // counterattack) can end the run even on a word that also kills
        // the monster in the same blow.
        ctx.player.ink = Math.max(0, ctx.player.ink - 2);
        ctx.messages.push('Cursed Quill: +10, and it costs you 2.');
      }
    }
  });

  def({
    id: 'gilded_bookmark',
    name: 'Gilded Bookmark',
    hint: 'Marks where you started -- the first word of a fight always rings loudest.',
    rarity: 'uncommon',
    shopPrice: 35,
    hooks: {
      onWordPlayed: function (ctx) {
        if (ctx.wordsPlayedThisFight !== 1) return;
        Items.applyPercentBonus(ctx, 1.0);
        ctx.messages.push('Gilded Bookmark: x2!');
      }
    }
  });

  def({
    id: 'palimpsest',
    name: 'Palimpsest',
    hint: 'Old text bleeds through the new -- echo enough of it and the page erupts.',
    rarity: 'rare',
    shopPrice: 45,
    hooks: {
      onWordPlayed: function (ctx) {
        if (!ctx.previousWord) return;
        var prevLetters = {};
        ctx.previousWord.split('').forEach(function (l) { prevLetters[l] = true; });
        var shared = 0;
        var seen = {};
        ctx.word.split('').forEach(function (l) {
          if (prevLetters[l] && !seen[l]) { shared++; seen[l] = true; }
        });
        if (shared >= 3) {
          Items.applyPercentBonus(ctx, 0.3);
          ctx.messages.push('Palimpsest: +30%!');
        }
      }
    }
  });

  // The 8 build-defining rule-changer items from GOALS.md "FUN OVERHAUL 4/8".
  // Kept as one named list so the elite guaranteed-drop (FUN OVERHAUL 6/8)
  // draws from exactly this pool rather than duplicating the id list or
  // re-deriving it from rarity (rarity alone would also pull in unrelated
  // rares like Foreword/Vowel Leech). Order is the ticket's own numbering.
  Items.RULE_CHANGER_IDS = [
    'illuminated_initial',
    'errant_footnote',
    'vowel_reliquary',
    'consonant_cluster',
    'long_s_ligature',
    'cursed_quill',
    'gilded_bookmark',
    'palimpsest'
  ];

  // ---- CONTENT ticket (GOALS.md, 2026-08-20/21): 9 new items filling gaps
  // the FUN OVERHAUL 4/8 batch left -- onDraw and onRunStart each had exactly
  // 1 item, onPlayerDamaged had 3, and gold-economy / consumable-synergy /
  // floor-transition were entirely unaddressed. THEME.md library/archive
  // naming throughout. At least 4 of these (Interlibrary Loan, Withdrawal
  // Slip, Bound Volume, Acquisitions Budget) are genuinely build-defining --
  // they change which words/consumables/gold habits are correct play, not
  // just add a stat.

  def({
    id: 'card_catalog_key',
    name: 'Card Catalog Key',
    hint: 'Unlocks the good drawer -- a valuable letter turns up more often than chance.',
    rarity: 'common',
    shopPrice: 25,
    hooks: {
      onDraw: function (ctx) {
        var Lexicon = window.Wordbound.Lexicon;
        var hasRareLetter = ctx.drawnTiles.some(function (t) { return (Lexicon.LETTER_VALUES[t.letter] || 0) >= 3; });
        if (hasRareLetter || ctx.drawnTiles.length === 0) return;
        var pool = ctx.pileState.drawPile;
        var idx = -1;
        for (var i = pool.length - 1; i >= 0; i--) {
          if ((Lexicon.LETTER_VALUES[pool[i].letter] || 0) >= 3) { idx = i; break; }
        }
        if (idx === -1) return;
        var rareTile = pool.splice(idx, 1)[0];
        var swapIdx = ctx.rng ? ctx.rng.randInt(0, ctx.drawnTiles.length - 1) : 0;
        var displaced = ctx.drawnTiles[swapIdx];
        ctx.drawnTiles[swapIdx] = rareTile;
        pool.push(displaced);
      }
    }
  });

  def({
    id: 'bookplate',
    name: 'Bookplate',
    hint: 'A small mark stamped inside the cover, charged with the collector\'s intent.',
    rarity: 'common',
    shopPrice: 25,
    hooks: {
      onRunStart: function (ctx) {
        var Tiles = window.Wordbound.Tiles;
        ctx.pileState.drawPile.push(Tiles.createTile('E', null, Tiles.VARIANTS.CHARGED));
      }
    }
  });

  def({
    id: 'ex_libris',
    name: 'Ex Libris',
    hint: 'This copy belongs to you now -- and it pays dividends.',
    rarity: 'uncommon',
    shopPrice: 30,
    hooks: {
      onRunStart: function (ctx) {
        ctx.player.gold = (ctx.player.gold || 0) + 4;
      }
    }
  });

  def({
    id: 'late_fee',
    name: 'Late Fee',
    hint: 'Every overdue blow gets billed -- to them.',
    rarity: 'uncommon',
    shopPrice: 30,
    hooks: {
      onPlayerDamaged: function (ctx) {
        var gained = Math.floor(ctx.damage / 2);
        if (gained > 0) ctx.player.gold = (ctx.player.gold || 0) + gained;
      }
    }
  });

  def({
    id: 'interlibrary_loan',
    name: 'Interlibrary Loan',
    hint: 'A well-stocked shelf lends its weight to every word -- hold onto what you\'ve borrowed.',
    rarity: 'uncommon',
    shopPrice: 35,
    hooks: {
      onWordPlayed: function (ctx) {
        if ((ctx.player.consumables || []).length < 2) return;
        Items.applyBonusDamage(ctx, 3);
        ctx.messages.push('Interlibrary Loan: +3!');
      }
    }
  });

  def({
    id: 'withdrawal_slip',
    name: 'Withdrawal Slip',
    hint: 'Nothing left to check out -- travel light and strike harder.',
    rarity: 'rare',
    shopPrice: 45,
    hooks: {
      onWordPlayed: function (ctx) {
        if ((ctx.player.consumables || []).length > 0) return;
        Items.applyBonusDamage(ctx, 6);
        ctx.messages.push('Withdrawal Slip: +6!');
      }
    }
  });

  def({
    id: 'colophon',
    name: 'Colophon',
    hint: 'The printer\'s mark rewards a page with nothing repeated on it.',
    rarity: 'uncommon',
    shopPrice: 35,
    hooks: {
      onWordPlayed: function (ctx) {
        var seen = {};
        var distinctCount = 0;
        ctx.word.split('').forEach(function (l) { if (!seen[l]) { seen[l] = true; distinctCount++; } });
        if (distinctCount > 0) {
          var bonus = distinctCount * 2;
          Items.applyBonusDamage(ctx, bonus);
          ctx.messages.push('Colophon: +' + bonus + '!');
        }
      }
    }
  });

  def({
    id: 'bound_volume',
    name: 'Bound Volume',
    hint: 'Matched signatures bind tighter -- echo your last word\'s length and the seam holds true.',
    rarity: 'rare',
    shopPrice: 45,
    hooks: {
      onWordPlayed: function (ctx) {
        if (!ctx.previousWord) return;
        if (ctx.word.length !== ctx.previousWord.length) return;
        Items.applyPercentBonus(ctx, 0.25);
        ctx.messages.push('Bound Volume: +25%!');
      }
    }
  });

  def({
    id: 'acquisitions_budget',
    name: 'Acquisitions Budget',
    hint: 'Spend where it counts -- gold set aside becomes strength before you descend.',
    rarity: 'legendary',
    shopPrice: 65,
    hooks: {
      // FLAGSHIP, floor-transition. The only item in the pool using this
      // hook -- earns the new engine machinery (Game.advanceFloor calling
      // Items.runHook('onFloorAdvance', ...), see game.js) by turning
      // gold-hoarding into a genuine strategic choice against shop-spending.
      onFloorAdvance: function (ctx) {
        var chunks = Math.floor((ctx.player.gold || 0) / 10);
        if (chunks <= 0) return;
        var spent = chunks * 10;
        var inkGain = chunks * 2;
        ctx.player.gold -= spent;
        ctx.player.maxInk += inkGain;
        ctx.player.ink += inkGain;
        ctx.messages.push('Acquisitions Budget: spent ' + spent + ' gold for +' + inkGain + ' max ink!');
      }
    }
  });

  Items.getRackCapacity = function (player) {
    var capacity = 7;
    (player.items || []).forEach(function (itemId) {
      var d = ITEM_DEFS[itemId];
      if (d && d.statMods.rackCapacityBonus) capacity += d.statMods.rackCapacityBonus;
    });
    return capacity;
  };

  // An item "procced" if its hook announced itself on ctx.messages -- the same
  // signal the rule-changer items already use ("silent modifiers don't create
  // builds", above), so nothing here needs a per-item opt-in. Collected into
  // ctx.proccedItemIds so the caller can flash those chips (FUN OVERHAUL 8/8).
  // Hooks called with a message-less ctx (onPlayerDamaged, onRunStart) are
  // untracked.
  Items.runHook = function (hookName, ctx, player) {
    var tracks = !!(ctx && Array.isArray(ctx.messages));
    if (tracks && !ctx.proccedItemIds) ctx.proccedItemIds = [];
    (player.items || []).forEach(function (itemId) {
      var d = ITEM_DEFS[itemId];
      if (!d || !d.hooks[hookName]) return;
      var messagesBefore = tracks ? ctx.messages.length : 0;
      d.hooks[hookName](ctx);
      if (tracks && ctx.messages.length > messagesBefore) ctx.proccedItemIds.push(itemId);
    });
  };

  // Hooks running inside onWordPlayed fire after Combat.playWord already
  // mutated monster.hp, so bonus damage is applied directly here rather than
  // returned -- keeps combat.js ignorant of items entirely.
  Items.applyBonusDamage = function (ctx, amount) {
    ctx.monster.hp = Math.max(0, ctx.monster.hp - amount);
    ctx.result.damage += amount;
    ctx.result.monsterDied = ctx.monster.hp <= 0;
  };

  Items.applyPercentBonus = function (ctx, pct) {
    var bonus = Math.round(ctx.result.damage * pct);
    if (bonus > 0) Items.applyBonusDamage(ctx, bonus);
    return bonus;
  };

  // Load unlockable items from achievements module
  Items.loadUnlockableItems = function () {
    var Achievements = window.Wordbound.Achievements;
    if (!Achievements) return;
    var unlockedItems = Achievements.UNLOCKABLE_ITEMS;
    if (!unlockedItems) return;
    Object.keys(unlockedItems).forEach(function (itemId) {
      if (!ITEM_DEFS[itemId]) {
        var itemDef = unlockedItems[itemId];
        itemDef.statMods = itemDef.statMods || {};
        itemDef.hooks = itemDef.hooks || {};
        ITEM_DEFS[itemId] = itemDef;
      }
    });
  };

  // Call this once at startup
  Items.loadUnlockableItems();
})();
