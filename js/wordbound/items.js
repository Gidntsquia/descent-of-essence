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
//       onWordPlayed(ctx)    ctx = { player, monster, word, tilesUsed, result }
//                            tilesUsed is the array of Tile objects played.
//                            result is the object Combat.playWord returned;
//                            hooks may add to result.damage (already applied
//                            to monster.hp by the caller's follow-up) or heal
//                            player.hp. See applyBonusDamage below.
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
        var unusedCount = (ctx.player.rack || []).length - ctx.tilesUsed.length;
        if (unusedCount > 0) Items.applyBonusDamage(ctx, unusedCount);
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
