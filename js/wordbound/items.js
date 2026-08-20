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
//                            player.hp. See applyBonusDamage below.
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
        if (healed > 0) ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + healed);
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
        if (ctx.damage < ctx.player.hp) return;
        ctx.damage = ctx.player.hp - 1;
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
          ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + 2);
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
        ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + 1);
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
        // you, that's the deal." Game.submitWord checks player.hp right
        // after onWordPlayed hooks run specifically so this self-damage
        // (which lands on the player's OWN turn, before any monster
        // counterattack) can end the run even on a word that also kills
        // the monster in the same blow.
        ctx.player.hp = Math.max(0, ctx.player.hp - 2);
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

  Items.getRackCapacity = function (player) {
    var capacity = 7;
    (player.items || []).forEach(function (itemId) {
      var d = ITEM_DEFS[itemId];
      if (d && d.statMods.rackCapacityBonus) capacity += d.statMods.rackCapacityBonus;
    });
    return capacity;
  };

  Items.runHook = function (hookName, ctx, player) {
    (player.items || []).forEach(function (itemId) {
      var d = ITEM_DEFS[itemId];
      if (d && d.hooks[hookName]) d.hooks[hookName](ctx);
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
