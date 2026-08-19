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
    hint: 'Your rack holds 8 tiles instead of 7.',
    rarity: 'common',
    shopPrice: 25,
    statMods: { rackCapacityBonus: 1 }
  });

  def({
    id: 'lucky_vowel',
    name: 'Lucky Vowel',
    hint: "Every draw is guaranteed at least one vowel.",
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
    hint: 'Adds 2 extra blank tiles to your draw pile at the start of every fight.',
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
    hint: "Your word's single highest-value tile counts double.",
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
    hint: 'Deal +3 bonus damage when your word contains a 4+ point letter.',
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
    hint: 'Heal 1 HP per vowel in each word you play.',
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
    hint: 'Reduce all incoming damage by 2 (minimum 1).',
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
    hint: 'The first time you would drop to 0 HP, survive with 1 HP instead. Once per run.',
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
    hint: 'Gain +2 bonus damage for each tile with a bonus that you play.',
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
    hint: 'Heal 2 HP whenever you play a word with 5+ letters.',
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
    hint: 'Gain +2 bonus damage when you play an alphabetical word.',
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
})();
