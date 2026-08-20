// js/wordbound/game.js
// Orchestrator + state machine for Wordbound. Wires lexicon/traits/monsters/
// combat/items/floor together into a playable loop. This is the only
// Wordbound file allowed to touch the DOM.
//
// Screens: MAIN_MENU -> RUN (node-map <-> combat <-> treasure <-> rest) ->
//          GAME_OVER | VICTORY -> MAIN_MENU
//
// Character select: 3 distinct starting loadouts with different deck compositions
// and items. Run structure (3 floors, node map) identical across characters --
// only starting state differs. Shop and currency implemented (see tasks).

(function () {
  window.Wordbound = window.Wordbound || {};
  var Game = (window.Wordbound.Game = {});

  var Lexicon, Traits, Monsters, Combat, Items, Floor, Tiles, RNG, Characters, Achievements;

  var audioContext = null;
  var musicOscillators = [];
  var musicGainNode = null;
  var isPlayingMusic = false;
  var currentMusicMode = null; // 'normal' or 'boss'

  // Audio settings (volume + mute) persisted separately from achievements.js's
  // save -- otherwise every fresh page load silently reset the player's chosen
  // volume/mute back to the 10% default, even if they'd explicitly changed it.
  var AUDIO_SETTINGS_KEY = 'wordbound_audio_settings';
  var audioSettings = { volume: 0.1, muted: false };
  (function loadAudioSettings() {
    try {
      if (typeof localStorage === 'undefined') return;
      var stored = localStorage.getItem(AUDIO_SETTINGS_KEY);
      if (!stored) return;
      var parsed = JSON.parse(stored);
      if (typeof parsed.volume === 'number') audioSettings.volume = Math.max(0, Math.min(1, parsed.volume));
      if (typeof parsed.muted === 'boolean') audioSettings.muted = parsed.muted;
    } catch (e) {
      // localStorage unavailable or corrupt saved value -- fall back to defaults
    }
  })();
  function saveAudioSettings() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(audioSettings));
    } catch (e) {
      // localStorage unavailable (private browsing, storage full, etc.) -- not fatal
    }
  }

  // How to Play panel: shown on demand from the main menu, and automatically
  // (once ever) the first time a player starts combat.
  var HOWTO_SEEN_KEY = 'wordbound_seen_howto';
  function hasSeenHowToPlay() {
    try {
      if (typeof localStorage === 'undefined') return false;
      return localStorage.getItem(HOWTO_SEEN_KEY) === '1';
    } catch (e) {
      return false;
    }
  }
  function markHowToPlaySeen() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(HOWTO_SEEN_KEY, '1');
    } catch (e) {
      // localStorage unavailable -- not fatal, just means it may auto-show again
    }
  }

  var state = {
    screen: 'MAIN_MENU',
    selectedCharacter: null,
    player: null,
    rng: null,
    deck: [],
    pile: null, // { drawPile, discardPile } -- reset at the start of every fight
    floorNumber: 1,
    floor: null,
    currentNodeIndex: 0,
    monster: null,
    combatActive: false,
    messages: [],
    treasureOptions: null,
    shopOptions: null,
    tileRewardOptions: null,
    bossRewardOptions: null, // rare/legendary item choices offered after a boss kill, see rollBossRewardOptions
    pendingAfterTileReward: null, // 'bossItemReward' | 'nextNode'
    currentEvent: null, // { id, def: EventDef, name, text, choices }
    pendingEventSkipNextCombat: false, // if true, skip next combat node
    deckViewerOpen: false,
    itemInspectorOpen: false,
    itemInspectorId: null,
    consumablesPanelOpen: false,
    howToPlayOpen: false,
    lastRackTileIds: [], // track tile IDs from previous render to detect new tiles
    rackJustRefilled: false, // true right after a full discard+redraw -- animate the whole rack,
                              // not just tiles that happen to be a different instance than before
                              // (with a small deck, refills often reuse the same tile object, which
                              // would otherwise skip the slide-in animation despite being a fresh deal)
    draggedTileId: null, // track which tile is being dragged for reordering
    dragOverIndex: null, // track which position we're hovering over
    touchStartIndex: null, // for touch-based reordering
    touchCurrentIndex: null, // track position during touch drag
    touchStartX: null, // track initial touch X position for drag threshold detection
    touchDragThresholdCrossed: false, // true once drag distance exceeds 10px threshold
    selectedTileIds: [] // tiles selected for staging (in click order)
  };
  Game._state = state; // exposed for headless/browser test inspection only

  function $(id) { return document.getElementById(id); }

  function newPlayer(characterDef) {
    var player = {
      hp: 20, maxHp: 20, gold: 0, rack: [], items: [], consumables: [], usedSecondWind: false,
      bonusDamageUntilEndOfTurn: 0, skipDiscardNextTurn: false, bonusTilesToDraw: 0
    };
    if (characterDef && characterDef.startingItems) {
      player.items = characterDef.startingItems.slice();
    }
    return player;
  }

  function log(msg) {
    state.messages.push(msg);
    if (state.messages.length > 6) state.messages.shift();
  }

  // ---- run lifecycle ----------------------------------------------------

  function createCharacterDeck(characterDef) {
    if (!characterDef || !characterDef.deckLetters) {
      return Tiles.createStarterDeck();
    }
    return characterDef.deckLetters.map(function (letter) {
      return Tiles.createTile(letter, null);
    });
  }

  Game.startRun = function (characterId, seedInput) {
    var characterDef = characterId ? Characters.getCharacter(characterId) : Characters.getCharacter('archivist');
    state.selectedCharacter = characterId || 'archivist';
    state.player = newPlayer(characterDef);
    // Seeds are always hashed as strings (RNG.hashStringToSeed), even an
    // auto-generated random one -- so typing a displayed seed back into the
    // seed input later reproduces the same run. Feeding RNG.create a raw JS
    // number instead would hash differently than typing those same digits
    // into a text input (RNG.create treats a number as already-a-seed, but
    // hashes a string), which would silently break "type this seed back in"
    // for the common case of a random run someone wants to share afterward.
    var trimmedSeed = seedInput ? String(seedInput).trim() : '';
    state.runSeed = trimmedSeed || String(RNG.randomSeed());
    // Same seed + character reproduces the same floors/monsters/rewards --
    // but treasure/shop pools are filtered by which items are unlocked
    // (Achievements.getUnlockedAchievements/UNLOCKABLE_ITEMS), which differs
    // per player and can change over time on the same browser. So identical
    // runs are only guaranteed at identical unlock state; that's an accepted
    // v1 caveat, not something this feature tries to fix.
    state.rng = RNG.create(state.runSeed);
    state.deck = createCharacterDeck(characterDef);
    state.floorNumber = 1;
    state.floor = Floor.generateFloor(state.floorNumber, state.rng);
    state.currentNodeIndex = 0;
    state.messages = [];
    state.screen = 'RUN';
    if (Achievements) Achievements.resetRunState();
    startBackgroundMusic(false);
    render();
  };

  function advanceFloor() {
    state.floorNumber += 1;
    if (state.floorNumber > Floor.TOTAL_FLOORS) {
      endRun(true);
      return;
    }
    state.floor = Floor.generateFloor(state.floorNumber, state.rng);
    state.currentNodeIndex = 0;
    render();
  }

  function endRun(victory) {
    stopBackgroundMusic();
    if (victory && Achievements) Achievements.trackRunCompletion();
    state.screen = victory ? 'VICTORY' : 'GAME_OVER';
    render();
  }

  Game.returnToMainMenu = function () {
    state.screen = 'MAIN_MENU';
    render();
  };

  Game.showCharacterSelect = function () {
    state.screen = 'CHARACTER_SELECT';
    render();
  };

  // ---- node entry ---------------------------------------------------------

  function currentNode() {
    return state.floor.nodes[state.currentNodeIndex];
  }

  Game.enterCurrentNode = function () {
    var node = currentNode();
    if (!node || node.cleared) return;

    if (node.type === 'combat' || node.type === 'elite' || node.type === 'boss') {
      // Check if an event (like Empty Shelf) skipped this combat
      if (state.pendingEventSkipNextCombat) {
        state.pendingEventSkipNextCombat = false;
        log('You skip the next encounter.');
        node.cleared = true;
        if (node.type === 'boss') {
          // The boss is always the floor's last node (see floor.js), so a bare
          // index bump here walks past the end of the array and strands the
          // run with no current node -- route through the same floor-advance
          // a real boss kill ends in. No tile/item reward on this path: the
          // boss wasn't actually defeated, so no kill loot is granted.
          advanceFloor();
          return;
        }
        state.currentNodeIndex += 1;
        render();
        return;
      }
      startCombat(node);
    } else if (node.type === 'treasure') {
      state.screen = 'TREASURE';
      state.treasureOptions = rollTreasureOptions();
      render();
    } else if (node.type === 'shop') {
      state.screen = 'SHOP';
      state.shopOptions = rollShopOptions();
      render();
    } else if (node.type === 'event') {
      startEvent(node);
    } else if (node.type === 'rest') {
      var healed = Math.round(state.player.maxHp * 0.5);
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + healed);
      log('You rest and recover ' + healed + ' HP.');
      node.cleared = true;
      state.currentNodeIndex += 1;
      render();
    }
  };

  function rollTreasureOptions() {
    var owned = state.player.items;
    var pool = Object.keys(Items.ITEM_DEFS).filter(function (id) { return owned.indexOf(id) === -1; });
    var shuffled = state.rng.shuffle(pool);
    return shuffled.slice(0, 3);
  }

  // Boss-kill bonus reward: a second, higher-value item choice on top of the
  // normal tile reward, so beating a boss feels distinctly more rewarding
  // than a regular kill. Pool is restricted to items already marked
  // rarity 'rare'/'legendary' (see items.js) rather than the whole item
  // pool, so this is a genuine step up from a treasure-node pick, not just
  // a second roll of the same odds.
  function rollBossRewardOptions() {
    var owned = state.player.items;
    var pool = Object.keys(Items.ITEM_DEFS).filter(function (id) {
      var def = Items.ITEM_DEFS[id];
      return owned.indexOf(id) === -1 && (def.rarity === 'rare' || def.rarity === 'legendary');
    });
    var shuffled = state.rng.shuffle(pool);
    return shuffled.slice(0, 3);
  }

  Game.pickTreasureItem = function (itemId) {
    state.player.items.push(itemId);
    log('You take ' + Items.ITEM_DEFS[itemId].name + '.');
    currentNode().cleared = true;
    state.currentNodeIndex += 1;
    state.screen = 'RUN';
    render();
  };

  function rollShopOptions() {
    var owned = state.player.items;
    var itemPool = Object.keys(Items.ITEM_DEFS).filter(function (id) {
      return owned.indexOf(id) === -1;
    });
    var consumablePool = Wordbound.Consumables ? Object.keys(Wordbound.Consumables.CONSUMABLE_DEFS).map(function (id) { return 'c:' + id; }) : [];
    var combined = itemPool.concat(consumablePool);
    var shuffled = state.rng.shuffle(combined);
    return shuffled.slice(0, 4);
  }

  Game.buyItem = function (itemId) {
    var isConsumable = itemId.indexOf('c:') === 0;
    var actualId = isConsumable ? itemId.substring(2) : itemId;
    var def = isConsumable ? (Wordbound.Consumables ? Wordbound.Consumables.CONSUMABLE_DEFS[actualId] : null) : Items.ITEM_DEFS[actualId];

    if (!def || !def.shopPrice) {
      log('ERROR: Item not purchasable');
      return;
    }
    if (state.player.gold < def.shopPrice) {
      log('Not enough gold! Need ' + def.shopPrice + ', have ' + state.player.gold + '.');
      return;
    }
    if (!isConsumable && state.player.items.indexOf(actualId) !== -1) {
      log('You already own ' + def.name + '!');
      return;
    }
    state.player.gold -= def.shopPrice;
    if (isConsumable) {
      state.player.consumables.push(actualId);
    } else {
      state.player.items.push(actualId);
      // Re-roll shop options so the bought item is replaced with a new option
      state.shopOptions = rollShopOptions();
    }
    log('You bought ' + def.name + ' for ' + def.shopPrice + ' gold.');
    render();
  };

  Game.leaveShop = function () {
    currentNode().cleared = true;
    state.currentNodeIndex += 1;
    state.screen = 'RUN';
    state.shopOptions = null;
    render();
  };

  // ---- events ---------------------------------------------------------

  function startEvent(node) {
    var Events = window.Wordbound && window.Wordbound.Events;
    if (!Events || !Events.EVENT_DEFS[node.defId]) return;
    var eventDef = Events.EVENT_DEFS[node.defId];
    state.currentEvent = {
      id: node.defId,
      def: eventDef,
      name: eventDef.name,
      text: eventDef.text,
      choices: eventDef.choices
    };
    state.screen = 'EVENT';
    render();
  }

  Game.chooseEventOption = function (choiceIndex) {
    if (!state.currentEvent || !state.currentEvent.choices || choiceIndex < 0 || choiceIndex >= state.currentEvent.choices.length) return;
    var choice = state.currentEvent.choices[choiceIndex];
    var result = choice.effect(state);
    if (result) log(result);

    currentNode().cleared = true;
    state.currentNodeIndex += 1;
    state.currentEvent = null;
    state.screen = 'RUN';
    render();
  };

  // ---- combat ---------------------------------------------------------

  function startCombat(node) {
    state.monster = node.type === 'boss' ? Monsters.createBoss(node.defId) : Monsters.createMonster(node.defId);
    state.pile = { drawPile: Tiles.shuffleIntoDrawPile(state.deck, state.rng), discardPile: [] };
    state.player.rack = [];
    Items.runHook('onRunStart', { player: state.player, pileState: state.pile }, state.player);
    refillRack();
    ensureRackIsPlayable();
    state.combatActive = true;
    var isBoss = node.type === 'boss';
    startBackgroundMusic(isBoss);
    log('A ' + state.monster.name + ' appears!');
    render();
    if (!hasSeenHowToPlay()) {
      Game.openHowToPlay();
    }
  }

  function refillRack() {
    var capacity = Items.getRackCapacity(state.player);
    var needed = capacity - state.player.rack.length;
    if (needed <= 0) return;
    var drawn = Tiles.draw(state.pile, needed, state.rng);
    var ctx = { player: state.player, drawnTiles: drawn, pileState: state.pile, rng: state.rng };
    Items.runHook('onDraw', ctx, state.player);
    state.player.rack = state.player.rack.concat(ctx.drawnTiles);
    state.rackJustRefilled = true;
  }

  // A rack that can spell nothing is a permanent dead end: combat only offers
  // "play a word," and the rack only ever cycles after a word is actually
  // played, so an unplayable rack leaves the player with no possible action,
  // forever. balance-simulation.js (2026-08-19, 30 runs) found this hit ~25%
  // of runs with the Scribe character specifically (its deck is vowel-poor).
  // Rather than add a new discard/redraw mechanic, silently reshuffle and
  // redraw when this happens -- bounded attempts as a safety net against a
  // pathological near-empty pool; in practice one retry is always enough.
  var UNPLAYABLE_RACK_RETRY_LIMIT = 5;
  function ensureRackIsPlayable() {
    var attempts = 0;
    while (!Lexicon.hasPlayableWord(state.player.rack) && attempts < UNPLAYABLE_RACK_RETRY_LIMIT) {
      state.pile.discardPile = state.pile.discardPile.concat(state.player.rack);
      state.player.rack = [];
      refillRack();
      attempts++;
    }
    if (attempts > 0) {
      log('Your hand had no playable words -- the shelves rearranged themselves.');
    }
  }

  // Slay the Spire-style rack: whatever's left in the rack after a word is
  // played (used AND unused tiles) goes to the discard pile, then the rack
  // is fully redrawn. Tiles.draw reshuffles the discard pile back in when
  // the draw pile runs dry, so this never stalls mid-fight.
  // Page Turn consumable can change this: if active, unused tiles stay in hand
  // instead of being discarded.
  function cycleRackAfterWord(tilesUsed) {
    var unusedTiles = state.player.rack;

    // If Page Turn is active, keep unused tiles; otherwise discard them
    if (!state.player.skipDiscardNextTurn) {
      state.pile.discardPile = state.pile.discardPile.concat(unusedTiles);
    }

    // Always discard the used tiles
    state.pile.discardPile = state.pile.discardPile.concat(tilesUsed);

    // Clear the rack
    if (state.player.skipDiscardNextTurn) {
      // Page Turn: keep unused tiles, refill to full capacity, then draw bonus
      var bonusCount = state.player.bonusTilesToDraw || 0;
      var targetRackSize = Items.getRackCapacity(state.player) + bonusCount;
      var tilesToDraw = targetRackSize - unusedTiles.length;

      if (tilesToDraw > 0) {
        var drawn = Tiles.draw(state.pile, tilesToDraw, state.rng);
        var ctx = { player: state.player, drawnTiles: drawn, pileState: state.pile, rng: state.rng };
        Items.runHook('onDraw', ctx, state.player);
        state.player.rack = unusedTiles.concat(ctx.drawnTiles);
      }
      // Note: deliberately NOT setting rackJustRefilled here -- Page Turn keeps some
      // tiles in place (they shouldn't re-animate), only the newly drawn bonus tiles
      // should slide in, which the normal per-tile-id diff below already handles correctly.

      // Reset Page Turn flags
      state.player.skipDiscardNextTurn = false;
      state.player.bonusTilesToDraw = 0;
    } else {
      // Normal path: clear and refill
      state.player.rack = [];
      refillRack();
    }

    ensureRackIsPlayable();
  }

  var TILE_PLAY_ANIM_MS = 220; // matches .tile-played's animation-duration in wordbound.css

  function markTilesPlayed(tilesUsed) {
    var rack = $('rack-display');
    if (!rack) return;
    tilesUsed.forEach(function (tile) {
      var btn = rack.querySelector('[data-tile-id="' + tile.id + '"]');
      if (btn) btn.classList.add('tile-played');
    });
  }

  Game.submitWord = function (rawWord) {
    if (!state.combatActive) return;
    var word = (rawWord || '').trim().toUpperCase();
    if (!word) return;

    var monsterHpBefore = state.monster.hp;
    var result = Combat.playWord(state.player, state.monster, word);
    if (!result) {
      log('"' + word + '" is not playable -- not a word you know, or you don\'t have those tiles.');
      render();
      return;
    }

    // Clear staging area since word was submitted
    state.selectedTileIds = [];

    // Flag the played tiles' existing DOM elements right away, before anything
    // else touches the rack -- render() rebuilds rack-display's innerHTML
    // wholesale, which would otherwise destroy these elements before the
    // browser ever paints a frame with the animation running.
    markTilesPlayed(result.tilesUsed);

    var ctx = { player: state.player, monster: state.monster, word: result.word, tilesUsed: result.tilesUsed, result: result };
    Items.runHook('onWordPlayed', ctx, state.player);

    var tag = result.multiplier === 0 ? ' -- no effect!' : result.multiplier > 1 ? ' -- weak point!' : '';
    log('You play "' + result.word + '" for ' + result.damage + ' damage' + tag);

    if (Achievements) Achievements.trackDamage(result.damage);

    // Apply Index Card Shard bonus damage if active
    if (state.player.bonusDamageUntilEndOfTurn > 0) {
      var bonusDmg = state.player.bonusDamageUntilEndOfTurn;
      state.monster.hp = Math.max(0, state.monster.hp - bonusDmg);
      result.damage += bonusDmg;
      log('Index Card Shard bonus: +' + bonusDmg + ' damage!');
      state.player.bonusDamageUntilEndOfTurn = 0;
    }

    // Everything from here on rebuilds the rack (directly or via render()),
    // which would cut the tile-play animation short -- deferred by
    // TILE_PLAY_ANIM_MS so it's actually visible before that happens.
    setTimeout(function () {
      if (state.monster.hp <= 0) {
        onMonsterDefeated(result.damage, monsterHpBefore);
        return;
      }

      cycleRackAfterWord(result.tilesUsed);

      var dmgCtx = { player: state.player, monster: state.monster, damage: state.monster.attack || 0 };
      Items.runHook('onPlayerDamaged', dmgCtx, state.player);
      state.player.hp = Math.max(0, state.player.hp - dmgCtx.damage);
      log(state.monster.name + ' hits you for ' + dmgCtx.damage + '.');

      if (state.player.hp <= 0) {
        state.combatActive = false;
        endRun(false);
        return;
      }

      render();

      // Animations run AFTER render(), not before: render() rebuilds
      // monster-info's innerHTML wholesale, which would instantly destroy any
      // damage-number element or flash-damage class applied beforehand -- the
      // browser never gets a paint frame to show it. Running these after
      // render() means they act on the freshly-rendered elements and persist
      // until their own timeouts clean them up.
      animateDamage(result.damage);
      if (result.damage > 0) playCombatSound(result.damage);
      if (dmgCtx.damage > 0) {
        animatePlayerDamage();
        playCounterattackSound(dmgCtx.damage, state.monster.isBoss);
      }
    }, TILE_PLAY_ANIM_MS);
  };

  function onMonsterDefeated(damageDealt, monsterHpBefore) {
    var goldDrop = [0, 0];
    if (state.monster.isBoss) {
      var bossDef = Monsters.BOSS_DEFS[state.monster.defId];
      goldDrop = (bossDef && bossDef.goldDrop) || [0, 0];
    } else {
      var def = Monsters.MONSTER_DEFS[state.monster.defId];
      goldDrop = (def && def.goldDrop) || [0, 0];
    }

    var baseGold = state.rng.randInt(goldDrop[0], goldDrop[1]);
    var overkill = Math.max(0, damageDealt - monsterHpBefore);
    var bonusGold = Math.floor(overkill * 0.5);
    var totalGold = baseGold + bonusGold;
    state.player.gold += totalGold;

    var goldMsg = 'Defeated ' + state.monster.name + '! Gained ' + totalGold + ' gold';
    if (bonusGold > 0) goldMsg += ' (including ' + bonusGold + ' overkill bonus)';
    goldMsg += '.';
    log(goldMsg);

    // Small chance to drop a consumable item
    if (Wordbound.Consumables && state.rng.next() < Wordbound.Consumables.getConsumableDropChance()) {
      var droppedConsumable = Wordbound.Consumables.rollConsumableDrop(state.rng);
      if (droppedConsumable) {
        state.player.consumables.push(droppedConsumable);
        var consumableName = Wordbound.Consumables.CONSUMABLE_DEFS[droppedConsumable].name;
        log('You found an ' + consumableName + '!');
      }
    }

    state.combatActive = false;
    currentNode().cleared = true;
    var wasBoss = currentNode().type === 'boss';

    // Track achievements
    if (Achievements) {
      if (wasBoss) {
        Achievements.trackBossDefeatedWithoutDamage(state.monster.defId, state.player.hp < state.player.maxHp);
      }
      Achievements.trackOverkill(overkill);
      Achievements.trackItemsCollected(state.player.items.length);
    }

    state.player.rack = [];
    state.pendingAfterTileReward = wasBoss ? 'bossItemReward' : 'nextNode';
    state.tileRewardOptions = Tiles.rollRewardOptions(state.rng, 3);
    state.screen = 'TILE_REWARD';
    render();
  }

  Game.pickTileReward = function (tileId) {
    var chosen = null;
    state.tileRewardOptions.forEach(function (t) { if (t.id === tileId) chosen = t; });
    if (chosen) {
      state.deck.push(chosen);
      var bonusDesc = Tiles.describeBonus(chosen.bonus);
      log('Added ' + chosen.letter + (bonusDesc ? ' (' + bonusDesc + ')' : '') + ' to your deck.');
    }
    resolveTileReward();
  };

  Game.skipTileReward = function () {
    resolveTileReward();
  };

  function resolveTileReward() {
    state.tileRewardOptions = null;
    var pending = state.pendingAfterTileReward;
    state.pendingAfterTileReward = null;
    if (pending === 'bossItemReward') {
      var options = rollBossRewardOptions();
      if (options.length === 0) {
        // Every rare/legendary item is already owned -- nothing left to offer,
        // skip straight to the floor advance rather than show an empty panel.
        state.screen = 'RUN';
        advanceFloor();
        return;
      }
      state.bossRewardOptions = options;
      state.screen = 'BOSS_ITEM_REWARD';
      render();
      return;
    }
    state.screen = 'RUN';
    state.currentNodeIndex += 1;
    render();
  }

  Game.pickBossItemReward = function (itemId) {
    state.player.items.push(itemId);
    log('You claim ' + Items.ITEM_DEFS[itemId].name + ' from the boss\'s hoard.');
    resolveBossItemReward();
  };

  Game.skipBossItemReward = function () {
    resolveBossItemReward();
  };

  function resolveBossItemReward() {
    state.bossRewardOptions = null;
    state.screen = 'RUN';
    advanceFloor();
  }

  // ---- deck viewer --------------------------------------------------------

  function closeAllSidePanels() {
    state.deckViewerOpen = false;
    state.itemInspectorOpen = false;
    state.itemInspectorId = null;
    state.consumablesPanelOpen = false;
  }

  Game.openDeckViewer = function () {
    closeAllSidePanels();
    state.deckViewerOpen = true;
    render();
  };

  Game.closeDeckViewer = function () {
    state.deckViewerOpen = false;
    render();
  };

  Game.openItemInspector = function (itemId) {
    closeAllSidePanels();
    state.itemInspectorOpen = true;
    state.itemInspectorId = itemId;
    render();
  };

  Game.closeItemInspector = function () {
    state.itemInspectorOpen = false;
    state.itemInspectorId = null;
    render();
  };

  Game.openConsumablesPanel = function () {
    closeAllSidePanels();
    state.consumablesPanelOpen = true;
    render();
  };

  Game.closeConsumablesPanel = function () {
    state.consumablesPanelOpen = false;
    render();
  };

  // ---- how to play ---------------------------------------------------------

  Game.openHowToPlay = function () {
    state.howToPlayOpen = true;
    render();
  };

  Game.closeHowToPlay = function () {
    state.howToPlayOpen = false;
    markHowToPlaySeen();
    render();
  };

  Game.useConsumable = function (consumableId) {
    if (!state.combatActive || !state.monster) {
      log('ERROR: Can only use consumables during combat');
      return;
    }
    var def = Wordbound.Consumables.CONSUMABLE_DEFS[consumableId];
    if (!def) {
      log('ERROR: Consumable not found');
      return;
    }
    var idx = state.player.consumables.indexOf(consumableId);
    if (idx === -1) {
      log('ERROR: You don\'t have this consumable');
      return;
    }
    state.player.consumables.splice(idx, 1);
    var result = Wordbound.Consumables.useConsumable(consumableId, { player: state.player, monster: state.monster });
    if (result.message) log(result.message);
    render();
  };

  // ---- combat animations --------------------------------------------------------

  function animateDamage(damage) {
    if (damage <= 0) return;
    var hpFill = $('monster-hp-fill');
    hpFill.classList.remove('flash-damage');
    void hpFill.offsetWidth; // trigger reflow to restart animation
    hpFill.classList.add('flash-damage');
    setTimeout(function () { hpFill.classList.remove('flash-damage'); }, 300);

    var monsterInfo = $('monster-info');
    var dmgNum = document.createElement('div');
    dmgNum.className = 'damage-number';
    if (damage > 30) dmgNum.classList.add('critical');
    else if (damage < 5) dmgNum.classList.add('weak');
    else dmgNum.classList.add('normal');
    dmgNum.textContent = damage;
    dmgNum.style.left = '50%';
    dmgNum.style.top = '50%';
    dmgNum.style.transform = 'translate(-50%, -50%)';
    monsterInfo.appendChild(dmgNum);
    setTimeout(function () { dmgNum.remove(); }, 1000);
  }

  function animatePlayerDamage() {
    var hpDisplay = $('player-hp-display');
    hpDisplay.classList.remove('take-damage');
    void hpDisplay.offsetWidth; // trigger reflow to restart animation
    hpDisplay.classList.add('take-damage');
    setTimeout(function () { hpDisplay.classList.remove('take-damage'); }, 400);
  }

  // ---- sound effects --------------------------------------------------------

  function initAudioContext() {
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
  }

  function playCombatSound(damage) {
    try {
      var ctx = initAudioContext();
      var now = ctx.currentTime;
      var intensity = Math.min(damage / 40, 1); // normalize damage to 0-1
      var duration = 0.15 + (intensity * 0.1);

      if (damage > 30) {
        // critical hit: high-pitched punchy tone
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + duration);
        gain.gain.setValueAtTime(0.3 * intensity, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
        osc.start(now);
        osc.stop(now + duration);
      } else if (damage < 5) {
        // weak hit: soft, low tone
        var osc2 = ctx.createOscillator();
        var gain2 = ctx.createGain();
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.frequency.setValueAtTime(150, now);
        osc2.frequency.linearRampToValueAtTime(100, now + duration);
        gain2.gain.setValueAtTime(0.1, now);
        gain2.gain.linearRampToValueAtTime(0, now + duration);
        osc2.start(now);
        osc2.stop(now + duration);
      } else {
        // normal hit: mid-range punchy tone
        var osc3 = ctx.createOscillator();
        var gain3 = ctx.createGain();
        osc3.connect(gain3);
        gain3.connect(ctx.destination);
        osc3.frequency.setValueAtTime(400, now);
        osc3.frequency.exponentialRampToValueAtTime(250, now + duration);
        gain3.gain.setValueAtTime(0.2 * intensity, now);
        gain3.gain.exponentialRampToValueAtTime(0.01, now + duration);
        osc3.start(now);
        osc3.stop(now + duration);
      }
    } catch (e) {
      // audio context not supported, silently fail
    }
  }

  function playCounterattackSound(damage, isBoss) {
    try {
      var ctx = initAudioContext();
      var now = ctx.currentTime;
      var intensity = Math.min(damage / 10, 1);
      var duration = isBoss ? 0.35 : 0.2;
      var baseFreq = isBoss ? 65 : 100;
      var endFreq = isBoss ? 50 : 80;
      var gain = isBoss ? 0.2 : 0.15;

      // monster counterattack: ominous low tone (more ominous for bosses)
      var osc = ctx.createOscillator();
      var gainNode = ctx.createGain();
      osc.connect(gainNode);
      gainNode.connect(ctx.destination);
      osc.frequency.setValueAtTime(baseFreq, now);
      osc.frequency.linearRampToValueAtTime(endFreq, now + duration);
      gainNode.gain.setValueAtTime(gain * intensity, now);
      gainNode.gain.linearRampToValueAtTime(0, now + duration);
      osc.start(now);
      osc.stop(now + duration);
    } catch (e) {
      // audio context not supported, silently fail
    }
  }

  function startBackgroundMusic(isBoss) {
    try {
      stopBackgroundMusic();
      var ctx = initAudioContext();
      if (!musicGainNode) {
        musicGainNode = ctx.createGain();
        musicGainNode.connect(ctx.destination);
        musicGainNode.gain.setValueAtTime(audioSettings.muted ? 0 : audioSettings.volume, ctx.currentTime);
      }

      currentMusicMode = isBoss ? 'boss' : 'normal';
      isPlayingMusic = true;

      if (isBoss) {
        playBossMusic(ctx);
      } else {
        playNormalMusic(ctx);
      }
    } catch (e) {
      // audio context not supported
    }
  }

  function playNormalMusic(ctx) {
    var baseFreq = 130.81; // C3
    var notes = [130.81, 146.83, 164.81, 146.83]; // C, D, E, D
    var beatDuration = 1;
    var now = ctx.currentTime;

    function playLoop(startTime) {
      if (!isPlayingMusic || currentMusicMode !== 'normal') return;

      for (var i = 0; i < notes.length; i++) {
        var noteStart = startTime + (i * beatDuration);
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(musicGainNode);

        osc.type = 'sine';
        osc.frequency.setValueAtTime(notes[i], noteStart);
        gain.gain.setValueAtTime(0.25, noteStart);
        gain.gain.linearRampToValueAtTime(0.08, noteStart + beatDuration * 0.7);
        // Fade fully to silence before stop() -- stopping an oscillator while its
        // gain is still non-zero creates an audible click (a hard discontinuity in
        // the waveform). Ramping to ~0 first makes the cutoff inaudible.
        gain.gain.linearRampToValueAtTime(0.0001, noteStart + beatDuration * 0.95);

        osc.start(noteStart);
        osc.stop(noteStart + beatDuration * 0.95);
        musicOscillators.push({ osc: osc, gain: gain });
      }

      setTimeout(function () { playLoop(startTime + (notes.length * beatDuration)); }, notes.length * beatDuration * 1000);
    }

    playLoop(now);
  }

  function playBossMusic(ctx) {
    var notes = [82.41, 98.00, 82.41, 98.00, 110.00, 98.00]; // E2, G2, E2, G2, A2, G2 (one octave lower than original)
    var beatDuration = 0.5;
    var now = ctx.currentTime;

    function playLoop(startTime) {
      if (!isPlayingMusic || currentMusicMode !== 'boss') return;

      for (var i = 0; i < notes.length; i++) {
        var noteStart = startTime + (i * beatDuration);
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(musicGainNode);

        osc.type = 'square';
        osc.frequency.setValueAtTime(notes[i], noteStart);
        gain.gain.setValueAtTime(0.30, noteStart);
        gain.gain.linearRampToValueAtTime(0.10, noteStart + beatDuration * 0.6);
        // Same click-avoidance as playNormalMusic: reach silence before stop().
        // Square waves make an un-faded stop click even more noticeable than sine.
        gain.gain.linearRampToValueAtTime(0.0001, noteStart + beatDuration * 0.9);

        osc.start(noteStart);
        osc.stop(noteStart + beatDuration * 0.9);
        musicOscillators.push({ osc: osc, gain: gain });
      }

      setTimeout(function () { playLoop(startTime + (notes.length * beatDuration)); }, notes.length * beatDuration * 1000);
    }

    playLoop(now);
  }

  function stopBackgroundMusic() {
    isPlayingMusic = false;
    // Fade each still-playing note to silence before stopping it, rather than
    // cutting it off mid-note -- this runs on every combat transition (including
    // normal<->boss music switches), so a hard stop() here clicked audibly on
    // nearly every fight start/end.
    musicOscillators.forEach(function (pair) {
      try {
        var now = audioContext ? audioContext.currentTime : 0;
        pair.gain.gain.cancelScheduledValues(now);
        pair.gain.gain.setValueAtTime(pair.gain.gain.value, now);
        pair.gain.gain.linearRampToValueAtTime(0.0001, now + 0.03);
        pair.osc.stop(now + 0.03);
      } catch (e) {}
    });
    musicOscillators = [];
  }

  function setMusicVolume(volume) {
    audioSettings.volume = Math.max(0, Math.min(1, volume));
    audioSettings.muted = false; // moving the slider implies "I want sound"
    saveAudioSettings();
    if (musicGainNode) {
      musicGainNode.gain.setValueAtTime(audioSettings.volume, audioContext.currentTime);
    }
  }

  function toggleMusicMute() {
    audioSettings.muted = !audioSettings.muted;
    saveAudioSettings();
    if (musicGainNode) {
      // Restore the actual chosen volume on unmute, not a hardcoded default --
      // previously this reset to 0.1 regardless of what the slider was set to.
      musicGainNode.gain.setValueAtTime(audioSettings.muted ? 0 : audioSettings.volume, audioContext.currentTime);
    }
    return !audioSettings.muted;
  }

  // ---- rack reordering --------------------------------------------------------

  function startTileDrag(tileId) {
    state.draggedTileId = tileId;
  }

  function endTileDrag() {
    state.draggedTileId = null;
    state.dragOverIndex = null;
  }

  function reorderRackOnDrop(dropIndex) {
    if (state.draggedTileId === null || dropIndex === null) return;
    var dragIndex = -1;
    for (var i = 0; i < state.player.rack.length; i++) {
      if (state.player.rack[i].id === state.draggedTileId) {
        dragIndex = i;
        break;
      }
    }
    if (dragIndex === -1) return;
    if (dragIndex === dropIndex) return; // no change
    var tile = state.player.rack[dragIndex];
    state.player.rack.splice(dragIndex, 1);
    var insertIndex = dropIndex > dragIndex ? dropIndex - 1 : dropIndex;
    state.player.rack.splice(insertIndex, 0, tile);
    render();
  }

  // Touch reordering support for mobile/tablet
  function selectTileForWord(tile) {
    state.selectedTileIds.push(tile.id);
    $('word-input').value += (tile.letter === '?' ? '' : tile.letter);
    $('word-input').focus();
    render();
  }

  function getTileAtPosition(x) {
    var buttons = $('rack-display').querySelectorAll('.letter-tile');
    var closestButton = null;
    var closestDistance = Infinity;
    for (var i = 0; i < buttons.length; i++) {
      var rect = buttons[i].getBoundingClientRect();
      var center = rect.left + rect.width / 2;
      var distance = Math.abs(x - center);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestButton = buttons[i];
      }
    }
    if (closestButton && closestButton.getAttribute('data-tile-index')) {
      return parseInt(closestButton.getAttribute('data-tile-index'));
    }
    return null;
  }

  function startTouchReorder(tileId, index, touchX) {
    state.draggedTileId = tileId;
    state.touchStartIndex = index;
    state.touchCurrentIndex = index;
    state.touchStartX = touchX;
    state.touchDragThresholdCrossed = false;
  }

  function updateTouchReorder(touchX) {
    if (state.draggedTileId === null) return;

    // Check if drag threshold has been crossed
    if (!state.touchDragThresholdCrossed) {
      var distance = Math.abs(touchX - state.touchStartX);
      if (distance > 10) {
        state.touchDragThresholdCrossed = true;
      }
    }

    if (state.touchDragThresholdCrossed) {
      var newIndex = getTileAtPosition(touchX);
      if (newIndex !== null) {
        state.touchCurrentIndex = newIndex;
      }
    }
  }

  function endTouchReorder(tappedTile) {
    if (state.draggedTileId === null) {
      state.touchStartX = null;
      return;
    }

    // If drag threshold was crossed, do the reorder
    if (state.touchDragThresholdCrossed &&
        state.touchStartIndex !== null && state.touchCurrentIndex !== null &&
        state.touchCurrentIndex !== state.touchStartIndex) {
      reorderRackOnDrop(state.touchCurrentIndex);
    } else if (!state.touchDragThresholdCrossed && tappedTile) {
      // No drag happened: treat as a tap and play the letter
      selectTileForWord(tappedTile);
    }

    state.draggedTileId = null;
    state.touchStartIndex = null;
    state.touchCurrentIndex = null;
    state.touchStartX = null;
    state.touchDragThresholdCrossed = false;
  }

  // ---- rendering ---------------------------------------------------------

  function show(id) {
    ['screen-main-menu', 'screen-character-select', 'screen-run', 'screen-game-over', 'screen-victory'].forEach(function (s) {
      $(s).classList.toggle('hidden', s !== id);
    });
  }

  function render() {
    $('howto-overlay').classList.toggle('hidden', !state.howToPlayOpen);
    if (state.screen === 'MAIN_MENU') { show('screen-main-menu'); renderMainMenu(); return; }
    if (state.screen === 'CHARACTER_SELECT') { show('screen-character-select'); renderCharacterSelect(); return; }
    if (state.screen === 'GAME_OVER') { show('screen-game-over'); renderGameOver(); return; }
    if (state.screen === 'VICTORY') { show('screen-victory'); renderVictory(); return; }
    show('screen-run');
    renderRun();
  }

  function renderMainMenu() {
    var achvDisplay = $('achievements-display');
    if (Achievements) {
      var unlockedIds = Achievements.getUnlockedAchievements();
      var totalCount = Object.keys(Achievements.ACHIEVEMENTS).length;
      var progressText = 'Achievements unlocked: ' + unlockedIds.length + ' / ' + totalCount;
      if (unlockedIds.length > 0) {
        var achvNames = unlockedIds.map(function (id) {
          var ach = Achievements.ACHIEVEMENTS[id];
          return ach ? ach.name : id;
        }).join(', ');
        progressText += '<br><span style="font-size: 0.85rem;">✓ ' + achvNames + '</span>';
      }
      achvDisplay.innerHTML = progressText;
    }
  }

  function renderGameOver() {
    $('game-over-stats').textContent = 'You reached floor ' + state.floorNumber + '.';
    $('game-over-seed').textContent = 'Seed: ' + state.runSeed;
  }

  function renderVictory() {
    $('victory-stats').textContent = 'You cleared all ' + Floor.TOTAL_FLOORS + ' floors. Wordbound complete.';
    $('victory-seed').textContent = 'Seed: ' + state.runSeed;
  }

  function renderCharacterSelect() {
    var choices = $('character-choices');
    choices.innerHTML = '';
    var characterIds = Characters.getCharacterIds();
    characterIds.forEach(function (id) {
      var characterDef = Characters.getCharacter(id);
      var button = document.createElement('div');
      button.className = 'character-option';
      button.innerHTML = '<p class="character-name">' + characterDef.name + '</p>' +
                         '<p class="character-description">' + characterDef.description + '</p>';
      button.addEventListener('click', function () {
        Game.startRun(id, $('run-seed-input').value);
      });
      choices.appendChild(button);
    });
  }

  function getFloorName(floorNumber) {
    var names = { 1: 'The Overdue Aisles', 2: 'The Reference Wing', 3: 'The Binding' };
    return names[floorNumber] || '';
  }

  function renderRun() {
    $('player-hp-display').textContent = 'HP ' + state.player.hp + ' / ' + state.player.maxHp;
    $('gold-display').textContent = state.player.gold + ' 🪙';
    var floorName = getFloorName(state.floorNumber);
    $('floor-label').textContent = 'Floor ' + state.floorNumber + ' / ' + Floor.TOTAL_FLOORS + (floorName ? ' — ' + floorName : '');
    $('run-seed-display').textContent = 'Seed: ' + state.runSeed;
    renderItemsOwned();
    var log_ = $('message-log');
    log_.innerHTML = state.messages.map(function (m) { return '<div>' + escapeHtml(m) + '</div>'; }).join('');
    log_.scrollTop = log_.scrollHeight;

    $('deck-viewer-panel').classList.toggle('hidden', !state.deckViewerOpen);
    $('item-inspector-panel').classList.toggle('hidden', !state.itemInspectorOpen);
    $('consumables-panel').classList.toggle('hidden', !state.consumablesPanelOpen);
    if (state.deckViewerOpen) {
      renderDeckViewer();
      return;
    }
    if (state.itemInspectorOpen) {
      renderItemInspector();
      return;
    }
    if (state.consumablesPanelOpen) {
      renderConsumablesPanel();
      return;
    }

    $('node-map').classList.toggle('hidden', state.combatActive || state.screen === 'TREASURE' || state.screen === 'SHOP' || state.screen === 'TILE_REWARD' || state.screen === 'BOSS_ITEM_REWARD' || state.screen === 'EVENT');
    $('combat-panel').classList.toggle('hidden', !state.combatActive);
    $('combat-panel').classList.toggle('boss-combat', state.combatActive && state.monster && state.monster.isBoss);
    $('treasure-panel').classList.toggle('hidden', state.screen !== 'TREASURE' && state.screen !== 'SHOP');
    $('tile-reward-panel').classList.toggle('hidden', state.screen !== 'TILE_REWARD');
    $('boss-reward-panel').classList.toggle('hidden', state.screen !== 'BOSS_ITEM_REWARD');
    $('event-panel').classList.toggle('hidden', state.screen !== 'EVENT');

    if (state.screen === 'TREASURE') {
      renderTreasure();
      return;
    }
    if (state.screen === 'SHOP') {
      renderShop();
      return;
    }
    if (state.screen === 'TILE_REWARD') {
      renderTileReward();
      return;
    }
    if (state.screen === 'BOSS_ITEM_REWARD') {
      renderBossReward();
      return;
    }
    if (state.screen === 'EVENT') {
      renderEvent();
      return;
    }
    if (state.combatActive) {
      renderCombat();
      return;
    }
    renderNodeMap();
  }

  function renderItemsOwned() {
    var el = $('items-owned');
    el.innerHTML = '';
    state.player.items.forEach(function (itemId) {
      var def = Items.ITEM_DEFS[itemId];
      var span = document.createElement('span');
      span.className = 'item-chip';
      span.textContent = def.name;
      span.title = def.hint;
      span.style.cursor = 'pointer';
      span.addEventListener('click', function () { Game.openItemInspector(itemId); });
      el.appendChild(span);
    });
  }

  function renderItemInspector() {
    if (!state.itemInspectorId) return;
    var def = Items.ITEM_DEFS[state.itemInspectorId];
    if (!def) return;
    $('inspector-item-name').textContent = def.name;
    $('inspector-item-hint').textContent = def.hint;
  }

  function renderNodeMap() {
    var el = $('node-map');
    el.innerHTML = '';
    var labels = { combat: 'Foe', elite: 'Elite', treasure: 'Treasure', rest: 'Rest', shop: 'Shop', event: 'Event', boss: 'BOSS' };
    state.floor.nodes.forEach(function (node, i) {
      var pill = document.createElement('div');
      pill.className = 'node-pill node-' + node.type;
      if (node.cleared) pill.classList.add('node-cleared');
      if (i === state.currentNodeIndex && !node.cleared) pill.classList.add('node-current');
      if (i > state.currentNodeIndex) pill.classList.add('node-locked');
      var label = (node.cleared ? '✓ ' : '') + labels[node.type];

      // For boss nodes, append the trait hint
      if (node.type === 'boss') {
        var bossDef = Monsters.BOSS_DEFS[node.defId];
        if (bossDef && bossDef.traitPhases && bossDef.traitPhases.length > 0) {
          var traitId = bossDef.traitPhases[0].traitId;
          var traitDef = Traits.TRAITS[traitId];
          if (traitDef && traitDef.hint) {
            label += ' — ' + traitDef.hint;
          }
        }
      }

      pill.textContent = label;
      if (i === state.currentNodeIndex && !node.cleared) {
        pill.addEventListener('click', Game.enterCurrentNode);
      }
      el.appendChild(pill);
    });
  }

  function renderTreasure() {
    $('treasure-panel-heading').textContent = 'Choose an item';
    var el = $('treasure-choices');
    el.innerHTML = '';
    state.treasureOptions.forEach(function (itemId) {
      var def = Items.ITEM_DEFS[itemId];
      var btn = document.createElement('button');
      btn.className = 'treasure-choice';
      btn.innerHTML = '<strong>' + escapeHtml(def.name) + '</strong><br>' + escapeHtml(def.hint);
      btn.addEventListener('click', function () { Game.pickTreasureItem(itemId); });
      el.appendChild(btn);
    });
  }

  function renderShop() {
    $('treasure-panel-heading').textContent = 'Shop — Gold: ' + state.player.gold + ' 🪙';
    var el = $('treasure-choices');
    el.innerHTML = '';
    if (!state.shopOptions || state.shopOptions.length === 0) {
      el.innerHTML = '<p style="text-align: center;">No items available in shop</p>';
      return;
    }
    state.shopOptions.forEach(function (itemId) {
      var isConsumable = itemId.indexOf('c:') === 0;
      var actualId = isConsumable ? itemId.substring(2) : itemId;
      var def = isConsumable ? (Wordbound.Consumables ? Wordbound.Consumables.CONSUMABLE_DEFS[actualId] : null) : Items.ITEM_DEFS[actualId];
      if (!def) return;
      var canAfford = state.player.gold >= (def.shopPrice || 0);
      var btn = document.createElement('button');
      btn.className = 'treasure-choice' + (canAfford ? '' : ' shop-unavailable');
      btn.style.opacity = canAfford ? '1' : '0.6';
      btn.disabled = !canAfford;
      var priceColor = canAfford ? '#f0d789' : '#8b7355';
      var typeLabel = isConsumable ? ' [Consumable]' : '';
      btn.innerHTML = '<strong>' + escapeHtml(def.name) + '</strong><span style="font-size: 0.8rem; color: #9a8b6f;">' + typeLabel + '</span><br>' + escapeHtml(def.hint) + '<br><span style="color: ' + priceColor + ';">Cost: ' + (def.shopPrice || 0) + ' 🪙</span>';
      if (canAfford) {
        btn.addEventListener('click', function () { Game.buyItem(itemId); });
      }
      el.appendChild(btn);
    });
    var leaveBtn = document.createElement('button');
    leaveBtn.className = 'btn btn-secondary';
    leaveBtn.textContent = 'Leave Shop';
    leaveBtn.style.marginTop = '10px';
    leaveBtn.addEventListener('click', function () { Game.leaveShop(); });
    el.appendChild(leaveBtn);
  }

  function renderTileReward() {
    var el = $('tile-reward-choices');
    el.innerHTML = '';
    state.tileRewardOptions.forEach(function (tile) {
      var btn = document.createElement('button');
      btn.className = 'treasure-choice';
      var bonusDesc = Tiles.describeBonus(tile.bonus);
      btn.innerHTML = '<strong>' + escapeHtml(tile.letter) + '</strong>' + (bonusDesc ? '<br>' + escapeHtml(bonusDesc) : '');
      btn.addEventListener('click', function () { Game.pickTileReward(tile.id); });
      el.appendChild(btn);
    });
  }

  function renderBossReward() {
    var el = $('boss-reward-choices');
    el.innerHTML = '';
    state.bossRewardOptions.forEach(function (itemId) {
      var def = Items.ITEM_DEFS[itemId];
      var btn = document.createElement('button');
      btn.className = 'treasure-choice';
      btn.innerHTML = '<strong>' + escapeHtml(def.name) + '</strong><br>' + escapeHtml(def.hint);
      btn.addEventListener('click', function () { Game.pickBossItemReward(itemId); });
      el.appendChild(btn);
    });
  }

  function renderDeckViewer() {
    var el = $('deck-tiles-list');
    el.innerHTML = '';
    if (!state.deck || state.deck.length === 0) {
      el.innerHTML = '<p style="text-align: center; color: #b8ac8a;">Deck is empty</p>';
      return;
    }
    var sorted = state.deck.slice().sort(function (a, b) {
      return a.letter.localeCompare(b.letter);
    });
    sorted.forEach(function (tile) {
      var div = document.createElement('div');
      div.className = 'treasure-choice';
      var bonusDesc = Tiles.describeBonus(tile.bonus);
      div.innerHTML = '<strong>' + escapeHtml(tile.letter) + '</strong>' + (bonusDesc ? '<br>' + escapeHtml(bonusDesc) : '');
      div.style.cursor = 'default';
      el.appendChild(div);
    });
  }

  function renderConsumablesPanel() {
    var el = $('consumables-list');
    el.innerHTML = '';
    if (!state.player.consumables || state.player.consumables.length === 0) {
      el.innerHTML = '<p style="text-align: center;">You have no consumables</p>';
    } else {
      state.player.consumables.forEach(function (consumableId) {
        var def = Wordbound.Consumables.CONSUMABLE_DEFS[consumableId];
        if (!def) return;
        var btn = document.createElement('button');
        btn.className = 'treasure-choice';
        btn.innerHTML = '<strong>' + escapeHtml(def.name) + '</strong><br>' + escapeHtml(def.hint);
        if (state.combatActive) {
          btn.addEventListener('click', function () { Game.useConsumable(consumableId); });
        } else {
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';
        }
        el.appendChild(btn);
      });
    }
  }

  function renderEvent() {
    if (!state.currentEvent) return;
    $('event-panel-heading').textContent = state.currentEvent.name;
    $('event-panel-text').textContent = state.currentEvent.text;
    var el = $('event-choices');
    el.innerHTML = '';
    state.currentEvent.choices.forEach(function (choice, index) {
      var btn = document.createElement('button');
      btn.className = 'treasure-choice';
      btn.textContent = choice.text;
      btn.addEventListener('click', function () { Game.chooseEventOption(index); });
      el.appendChild(btn);
    });
  }

  function renderCombat() {
    var m = state.monster;
    var hpRatio = m.maxHp > 0 ? m.hp / m.maxHp : 0;
    var activeTraitId = Traits.activeTraitForHpRatio(m.traitPhases, hpRatio);
    var trait = Traits.TRAITS[activeTraitId];

    var info = $('monster-info');
    var tierClass = m.isBoss ? 'boss-tier' : (m.tier ? 'tier-' + m.tier : '');
    var tierGlyph = getTierGlyph(m.isBoss, m.tier);
    info.innerHTML =
      '<div class="monster-name ' + tierClass + '">' + tierGlyph + ' ' + escapeHtml(m.name) + '</div>' +
      '<div class="monster-hp-bar"><div id="monster-hp-fill" class="monster-hp-fill" style="width:' + Math.max(0, hpRatio * 100) + '%"></div></div>' +
      '<div class="monster-hp-text">' + m.hp + ' / ' + m.maxHp + ' HP</div>' +
      '<div class="monster-weakness">Weakness: ' + escapeHtml(trait.hint) + '</div>';

    var rack = $('rack-display');
    rack.innerHTML = '';
    var currentRackIds = [];
    state.player.rack.forEach(function (tile, index) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.draggable = true;
      btn.setAttribute('data-tile-id', tile.id);
      btn.setAttribute('data-tile-index', index);
      var isNewTile = state.rackJustRefilled || state.lastRackTileIds.indexOf(tile.id) === -1;
      var isSelected = state.selectedTileIds.indexOf(tile.id) !== -1;
      var bonusClass = '';
      if (tile.bonus) {
        bonusClass = ' has-bonus';
        if (tile.bonus.type === 'flatOnPlay') bonusClass += ' bonus-flat';
        else if (tile.bonus.type === 'multOnPlay') bonusClass += ' bonus-mult-play';
        else if (tile.bonus.type === 'multOnHold') bonusClass += ' bonus-mult-hold';
      }
      btn.className = 'letter-tile' + bonusClass + (isNewTile ? ' new-tile' : '') + (isSelected ? ' selected' : '');
      var val = Lexicon.LETTER_VALUES[tile.letter] || 0;
      btn.innerHTML = (tile.letter === '?' ? '★' : tile.letter) + '<sub>' + val + '</sub>';
      if (tile.bonus) btn.title = Tiles.describeBonus(tile.bonus);
      btn.addEventListener('click', function () {
        selectTileForWord(tile);
      });
      btn.addEventListener('dragstart', function (e) {
        startTileDrag(tile.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      btn.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        state.dragOverIndex = index;
      });
      btn.addEventListener('dragleave', function () {
        state.dragOverIndex = null;
      });
      btn.addEventListener('drop', function (e) {
        e.preventDefault();
        reorderRackOnDrop(index);
      });
      btn.addEventListener('dragend', endTileDrag);

      // Touch reordering for mobile/tablet devices
      btn.addEventListener('touchstart', function (e) {
        if (e.touches.length > 0) {
          startTouchReorder(tile.id, index, e.touches[0].clientX);
        }
      });
      btn.addEventListener('touchmove', function (e) {
        if (state.draggedTileId !== null && e.touches.length > 0) {
          updateTouchReorder(e.touches[0].clientX);
          if (state.touchDragThresholdCrossed) {
            e.preventDefault(); // prevent scrolling while dragging
          }
        }
      });
      btn.addEventListener('touchend', function () {
        endTouchReorder(tile);
      });

      rack.appendChild(btn);
      currentRackIds.push(tile.id);
    });
    state.lastRackTileIds = currentRackIds;
    state.rackJustRefilled = false;

    renderStagingArea();
  }

  function renderStagingArea() {
    var stagingArea = $('staging-area');
    if (!stagingArea) return;
    stagingArea.innerHTML = '';
    if (state.selectedTileIds.length === 0) return;

    state.selectedTileIds.forEach(function (tileId) {
      var tile = state.player.rack.find(function (t) { return t.id === tileId; });
      if (!tile) return;
      var stageTile = document.createElement('div');
      var bonusClass = '';
      if (tile.bonus) {
        bonusClass = ' has-bonus';
        if (tile.bonus.type === 'flatOnPlay') bonusClass += ' bonus-flat';
        else if (tile.bonus.type === 'multOnPlay') bonusClass += ' bonus-mult-play';
        else if (tile.bonus.type === 'multOnHold') bonusClass += ' bonus-mult-hold';
      }
      stageTile.className = 'staged-tile' + bonusClass;
      var val = Lexicon.LETTER_VALUES[tile.letter] || 0;
      stageTile.innerHTML = (tile.letter === '?' ? '★' : tile.letter) + '<sub>' + val + '</sub>';
      if (tile.bonus) stageTile.title = Tiles.describeBonus(tile.bonus);
      stagingArea.appendChild(stageTile);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function getTierGlyph(isBoss, tier) {
    if (isBoss) return '👑';
    if (tier === 'weak') return '📄';
    if (tier === 'normal') return '📖';
    if (tier === 'strong') return '📚';
    return '📖';
  }

  // ---- boot ---------------------------------------------------------

  Game.init = function () {
    Lexicon = window.Wordbound.Lexicon;
    Traits = window.Wordbound.Traits;
    Monsters = window.Wordbound.Monsters;
    Combat = window.Wordbound.Combat;
    Items = window.Wordbound.Items;
    Floor = window.Wordbound.Floor;
    Tiles = window.Wordbound.Tiles;
    RNG = window.Game.RNG;
    Characters = window.Wordbound.Characters;
    Achievements = window.Wordbound.Achievements;

    $('btn-new-run').addEventListener('click', Game.showCharacterSelect);
    $('btn-gameover-continue').addEventListener('click', Game.returnToMainMenu);
    $('btn-victory-continue').addEventListener('click', Game.returnToMainMenu);
    $('btn-skip-tile-reward').addEventListener('click', Game.skipTileReward);
    $('btn-skip-boss-reward').addEventListener('click', Game.skipBossItemReward);
    $('btn-view-deck').addEventListener('click', Game.openDeckViewer);
    $('btn-close-deck-viewer').addEventListener('click', Game.closeDeckViewer);
    $('btn-close-item-inspector').addEventListener('click', Game.closeItemInspector);
    $('btn-view-consumables').addEventListener('click', Game.openConsumablesPanel);
    $('btn-close-consumables').addEventListener('click', Game.closeConsumablesPanel);
    $('btn-back-to-menu').addEventListener('click', Game.returnToMainMenu);
    $('btn-how-to-play').addEventListener('click', Game.openHowToPlay);
    $('btn-close-howto').addEventListener('click', Game.closeHowToPlay);

    $('btn-submit-word').addEventListener('click', function () {
      var input = $('word-input');
      Game.submitWord(input.value);
      input.value = '';
    });
    $('word-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        Game.submitWord(this.value);
        this.value = '';
      }
    });
    $('btn-clear-word').addEventListener('click', function () {
      $('word-input').value = '';
      state.selectedTileIds = [];
      $('word-input').focus();
      render();
    });

    $('btn-toggle-music').addEventListener('click', function () {
      var isMuted = toggleMusicMute();
      $('btn-toggle-music').textContent = isMuted ? '🔊' : '🔇';
    });

    $('music-volume').addEventListener('input', function () {
      var volume = this.value / 100;
      setMusicVolume(volume);
    });

    // Reflect the loaded (persisted) audio settings in the UI immediately,
    // rather than always showing the 10%/unmuted defaults on a fresh page load.
    $('music-volume').value = Math.round(audioSettings.volume * 100);
    $('btn-toggle-music').textContent = audioSettings.muted ? '🔇' : '🔊';

    // Hide the dictionary loading indicator now that all scripts are loaded
    var loadingIndicator = $('dictionary-loading-indicator');
    if (loadingIndicator) {
      loadingIndicator.classList.add('hidden');
    }

    render();
  };
})();
