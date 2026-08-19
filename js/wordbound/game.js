// js/wordbound/game.js
// Orchestrator + state machine for Wordbound. Wires lexicon/traits/monsters/
// combat/items/floor together into a playable loop. This is the only
// Wordbound file allowed to touch the DOM.
//
// Screens: MAIN_MENU -> RUN (node-map <-> combat <-> treasure <-> rest) ->
//          GAME_OVER | VICTORY -> MAIN_MENU
//
// Deliberately no character select, no shop, no currency -- single fixed
// starting loadout, items are free picks at Treasure nodes. Matches the
// design mandate from the old game's rework: make the next action obvious.

(function () {
  window.Wordbound = window.Wordbound || {};
  var Game = (window.Wordbound.Game = {});

  var Lexicon, Traits, Monsters, Combat, Items, Floor, Tiles, RNG;

  var audioContext = null;
  var musicOscillators = [];
  var musicGainNode = null;
  var isPlayingMusic = false;
  var currentMusicMode = null; // 'normal' or 'boss'

  var state = {
    screen: 'MAIN_MENU',
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
    pendingAfterTileReward: null, // 'advanceFloor' | 'nextNode'
    deckViewerOpen: false,
    itemInspectorOpen: false,
    itemInspectorId: null,
    consumablesPanelOpen: false,
    lastRackTileIds: [], // track tile IDs from previous render to detect new tiles
    draggedTileId: null, // track which tile is being dragged for reordering
    dragOverIndex: null, // track which position we're hovering over
    touchStartIndex: null, // for touch-based reordering
    touchCurrentIndex: null // track position during touch drag
  };
  Game._state = state; // exposed for headless/browser test inspection only

  function $(id) { return document.getElementById(id); }

  function newPlayer() {
    return {
      hp: 20, maxHp: 20, gold: 0, rack: [], items: [], consumables: [], usedSecondWind: false,
      bonusDamageUntilEndOfTurn: 0, skipDiscardNextTurn: false, bonusTilesToDraw: 0
    };
  }

  function log(msg) {
    state.messages.push(msg);
    if (state.messages.length > 6) state.messages.shift();
  }

  // ---- run lifecycle ----------------------------------------------------

  Game.startRun = function () {
    state.player = newPlayer();
    state.rng = RNG.create(RNG.randomSeed());
    state.deck = Tiles.createStarterDeck();
    state.floorNumber = 1;
    state.floor = Floor.generateFloor(state.floorNumber, state.rng);
    state.currentNodeIndex = 0;
    state.messages = [];
    state.screen = 'RUN';
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
    state.screen = victory ? 'VICTORY' : 'GAME_OVER';
    render();
  }

  Game.returnToMainMenu = function () {
    state.screen = 'MAIN_MENU';
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
      startCombat(node);
    } else if (node.type === 'treasure') {
      state.screen = 'TREASURE';
      state.treasureOptions = rollTreasureOptions();
      render();
    } else if (node.type === 'shop') {
      state.screen = 'SHOP';
      state.shopOptions = rollShopOptions();
      render();
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
    var itemPool = Object.keys(Items.ITEM_DEFS).filter(function (id) { return owned.indexOf(id) === -1; });
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
    state.player.gold -= def.shopPrice;
    if (isConsumable) {
      state.player.consumables.push(actualId);
    } else {
      state.player.items.push(actualId);
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

  // ---- combat ---------------------------------------------------------

  function startCombat(node) {
    state.monster = node.type === 'boss' ? Monsters.createBoss(node.defId) : Monsters.createMonster(node.defId);
    state.pile = { drawPile: Tiles.shuffleIntoDrawPile(state.deck, state.rng), discardPile: [] };
    state.player.rack = [];
    Items.runHook('onRunStart', { player: state.player, pileState: state.pile }, state.player);
    refillRack();
    state.combatActive = true;
    var isBoss = node.type === 'boss';
    startBackgroundMusic(isBoss);
    log('A ' + state.monster.name + ' appears!');
    render();
  }

  function refillRack() {
    var capacity = Items.getRackCapacity(state.player);
    var needed = capacity - state.player.rack.length;
    if (needed <= 0) return;
    var drawn = Tiles.draw(state.pile, needed, state.rng);
    var ctx = { player: state.player, drawnTiles: drawn, pileState: state.pile, rng: state.rng };
    Items.runHook('onDraw', ctx, state.player);
    state.player.rack = state.player.rack.concat(ctx.drawnTiles);
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
      var targetRackSize = 7 + bonusCount; // normal rack is 7
      var tilesToDraw = targetRackSize - unusedTiles.length;

      if (tilesToDraw > 0) {
        var drawn = Tiles.draw(tilesToDraw, state.pile, state.deck, state.rng);
        var ctx = { player: state.player, drawnTiles: drawn, pileState: state.pile, rng: state.rng };
        Items.runHook('onDraw', ctx, state.player);
        state.player.rack = unusedTiles.concat(ctx.drawnTiles);
      }

      // Reset Page Turn flags
      state.player.skipDiscardNextTurn = false;
      state.player.bonusTilesToDraw = 0;
    } else {
      // Normal path: clear and refill
      state.player.rack = [];
      refillRack();
    }
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

    var ctx = { player: state.player, monster: state.monster, word: result.word, tilesUsed: result.tilesUsed, result: result };
    Items.runHook('onWordPlayed', ctx, state.player);

    var tag = result.multiplier === 0 ? ' -- no effect!' : result.multiplier > 1 ? ' -- weak point!' : '';
    log('You play "' + result.word + '" for ' + result.damage + ' damage' + tag);

    // Apply Index Card Shard bonus damage if active
    if (state.player.bonusDamageUntilEndOfTurn > 0) {
      var bonusDmg = state.player.bonusDamageUntilEndOfTurn;
      state.monster.hp = Math.max(0, state.monster.hp - bonusDmg);
      result.damage += bonusDmg;
      log('Index Card Shard bonus: +' + bonusDmg + ' damage!');
      state.player.bonusDamageUntilEndOfTurn = 0;
    }

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
      playCounterattackSound(dmgCtx.damage);
    }
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
    state.player.rack = [];
    state.pendingAfterTileReward = wasBoss ? 'advanceFloor' : 'nextNode';
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
    state.screen = 'RUN';
    if (pending === 'advanceFloor') {
      advanceFloor();
    } else {
      state.currentNodeIndex += 1;
      render();
    }
  }

  // ---- deck viewer --------------------------------------------------------

  Game.openDeckViewer = function () {
    state.deckViewerOpen = true;
    render();
  };

  Game.closeDeckViewer = function () {
    state.deckViewerOpen = false;
    render();
  };

  Game.openItemInspector = function (itemId) {
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
    state.consumablesPanelOpen = true;
    render();
  };

  Game.closeConsumablesPanel = function () {
    state.consumablesPanelOpen = false;
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

  function playCounterattackSound(damage) {
    try {
      var ctx = initAudioContext();
      var now = ctx.currentTime;
      var intensity = Math.min(damage / 10, 1);
      var duration = 0.2;

      // monster counterattack: ominous low tone
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(100, now);
      osc.frequency.linearRampToValueAtTime(80, now + duration);
      gain.gain.setValueAtTime(0.15 * intensity, now);
      gain.gain.linearRampToValueAtTime(0, now + duration);
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
        musicGainNode.gain.setValueAtTime(0.1, ctx.currentTime);
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
        gain.gain.linearRampToValueAtTime(0.08, noteStart + beatDuration * 0.9);

        osc.start(noteStart);
        osc.stop(noteStart + beatDuration * 0.95);
        musicOscillators.push(osc);
      }

      setTimeout(function () { playLoop(startTime + (notes.length * beatDuration)); }, notes.length * beatDuration * 1000);
    }

    playLoop(now);
  }

  function playBossMusic(ctx) {
    var notes = [164.81, 196.00, 164.81, 196.00, 220.00, 196.00]; // E, G, E, G, A, G
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
        gain.gain.linearRampToValueAtTime(0.10, noteStart + beatDuration * 0.85);

        osc.start(noteStart);
        osc.stop(noteStart + beatDuration * 0.9);
        musicOscillators.push(osc);
      }

      setTimeout(function () { playLoop(startTime + (notes.length * beatDuration)); }, notes.length * beatDuration * 1000);
    }

    playLoop(now);
  }

  function stopBackgroundMusic() {
    isPlayingMusic = false;
    musicOscillators.forEach(function (osc) {
      try { osc.stop(); } catch (e) {}
    });
    musicOscillators = [];
  }

  function setMusicVolume(volume) {
    if (musicGainNode) {
      musicGainNode.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), audioContext.currentTime);
    }
  }

  function toggleMusicMute() {
    if (!musicGainNode) return;
    var currentVolume = musicGainNode.gain.value;
    musicGainNode.gain.setValueAtTime(currentVolume > 0 ? 0 : 0.1, audioContext.currentTime);
    return musicGainNode.gain.value > 0;
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

  function startTouchReorder(tileId, index) {
    state.draggedTileId = tileId;
    state.touchStartIndex = index;
    state.touchCurrentIndex = index;
  }

  function updateTouchReorder(touchX) {
    var newIndex = getTileAtPosition(touchX);
    if (newIndex !== null) {
      state.touchCurrentIndex = newIndex;
    }
  }

  function endTouchReorder() {
    if (state.touchStartIndex !== null && state.touchCurrentIndex !== null &&
        state.touchCurrentIndex !== state.touchStartIndex) {
      reorderRackOnDrop(state.touchCurrentIndex);
    }
    state.draggedTileId = null;
    state.touchStartIndex = null;
    state.touchCurrentIndex = null;
  }

  // ---- rendering ---------------------------------------------------------

  function show(id) {
    ['screen-main-menu', 'screen-run', 'screen-game-over', 'screen-victory'].forEach(function (s) {
      $(s).classList.toggle('hidden', s !== id);
    });
  }

  function render() {
    if (state.screen === 'MAIN_MENU') { show('screen-main-menu'); return; }
    if (state.screen === 'GAME_OVER') { show('screen-game-over'); renderGameOver(); return; }
    if (state.screen === 'VICTORY') { show('screen-victory'); renderVictory(); return; }
    show('screen-run');
    renderRun();
  }

  function renderGameOver() {
    $('game-over-stats').textContent = 'You reached floor ' + state.floorNumber + '.';
  }

  function renderVictory() {
    $('victory-stats').textContent = 'You cleared all ' + Floor.TOTAL_FLOORS + ' floors. Wordbound complete.';
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

    $('node-map').classList.toggle('hidden', state.combatActive || state.screen === 'TREASURE' || state.screen === 'SHOP' || state.screen === 'TILE_REWARD');
    $('combat-panel').classList.toggle('hidden', !state.combatActive);
    $('treasure-panel').classList.toggle('hidden', state.screen !== 'TREASURE' && state.screen !== 'SHOP');
    $('tile-reward-panel').classList.toggle('hidden', state.screen !== 'TILE_REWARD');

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
    var labels = { combat: 'Foe', elite: 'Elite', treasure: 'Treasure', rest: 'Rest', boss: 'BOSS' };
    state.floor.nodes.forEach(function (node, i) {
      var pill = document.createElement('div');
      pill.className = 'node-pill node-' + node.type;
      if (node.cleared) pill.classList.add('node-cleared');
      if (i === state.currentNodeIndex && !node.cleared) pill.classList.add('node-current');
      if (i > state.currentNodeIndex) pill.classList.add('node-locked');
      pill.textContent = (node.cleared ? '✓ ' : '') + labels[node.type];
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
      var isNewTile = state.lastRackTileIds.indexOf(tile.id) === -1;
      btn.className = 'letter-tile' + (tile.bonus ? ' has-bonus' : '') + (isNewTile ? ' new-tile' : '');
      var val = Lexicon.LETTER_VALUES[tile.letter] || 0;
      btn.innerHTML = (tile.letter === '?' ? '★' : tile.letter) + '<sub>' + val + '</sub>';
      if (tile.bonus) btn.title = Tiles.describeBonus(tile.bonus);
      btn.addEventListener('click', function () {
        $('word-input').value += (tile.letter === '?' ? '' : tile.letter);
        $('word-input').focus();
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
        startTouchReorder(tile.id, index);
        e.preventDefault(); // prevent scrolling while dragging
      });
      btn.addEventListener('touchmove', function (e) {
        if (state.draggedTileId !== null && e.touches.length > 0) {
          updateTouchReorder(e.touches[0].clientX);
        }
        e.preventDefault();
      });
      btn.addEventListener('touchend', function () {
        endTouchReorder();
      });

      rack.appendChild(btn);
      currentRackIds.push(tile.id);
    });
    state.lastRackTileIds = currentRackIds;
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

    $('btn-new-run').addEventListener('click', Game.startRun);
    $('btn-gameover-continue').addEventListener('click', Game.returnToMainMenu);
    $('btn-victory-continue').addEventListener('click', Game.returnToMainMenu);
    $('btn-skip-tile-reward').addEventListener('click', Game.skipTileReward);
    $('btn-view-deck').addEventListener('click', Game.openDeckViewer);
    $('btn-close-deck-viewer').addEventListener('click', Game.closeDeckViewer);
    $('btn-close-item-inspector').addEventListener('click', Game.closeItemInspector);
    $('btn-view-consumables').addEventListener('click', Game.openConsumablesPanel);
    $('btn-close-consumables').addEventListener('click', Game.closeConsumablesPanel);

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
      $('word-input').focus();
    });

    $('btn-toggle-music').addEventListener('click', function () {
      var isMuted = toggleMusicMute();
      $('btn-toggle-music').textContent = isMuted ? '🔊' : '🔇';
    });

    $('music-volume').addEventListener('input', function () {
      var volume = this.value / 100;
      setMusicVolume(volume);
    });

    render();
  };
})();
