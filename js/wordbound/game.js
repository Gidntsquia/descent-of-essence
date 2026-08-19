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
    tileRewardOptions: null,
    pendingAfterTileReward: null, // 'advanceFloor' | 'nextNode'
    deckViewerOpen: false
  };
  Game._state = state; // exposed for headless/browser test inspection only

  function $(id) { return document.getElementById(id); }

  function newPlayer() {
    return { hp: 20, maxHp: 20, rack: [], items: [], usedSecondWind: false };
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

  // ---- combat ---------------------------------------------------------

  function startCombat(node) {
    state.monster = node.type === 'boss' ? Monsters.createBoss(node.defId) : Monsters.createMonster(node.defId);
    state.pile = { drawPile: Tiles.shuffleIntoDrawPile(state.deck, state.rng), discardPile: [] };
    state.player.rack = [];
    Items.runHook('onRunStart', { player: state.player, pileState: state.pile }, state.player);
    refillRack();
    state.combatActive = true;
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
  function cycleRackAfterWord(tilesUsed) {
    state.pile.discardPile = state.pile.discardPile.concat(tilesUsed, state.player.rack);
    state.player.rack = [];
    refillRack();
  }

  Game.submitWord = function (rawWord) {
    if (!state.combatActive) return;
    var word = (rawWord || '').trim().toUpperCase();
    if (!word) return;

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

    if (state.monster.hp <= 0) {
      onMonsterDefeated();
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
  };

  function onMonsterDefeated() {
    log('Defeated ' + state.monster.name + '!');
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
    var floorName = getFloorName(state.floorNumber);
    $('floor-label').textContent = 'Floor ' + state.floorNumber + ' / ' + Floor.TOTAL_FLOORS + (floorName ? ' — ' + floorName : '');
    renderItemsOwned();
    var log_ = $('message-log');
    log_.innerHTML = state.messages.map(function (m) { return '<div>' + escapeHtml(m) + '</div>'; }).join('');
    log_.scrollTop = log_.scrollHeight;

    $('deck-viewer-panel').classList.toggle('hidden', !state.deckViewerOpen);
    if (state.deckViewerOpen) {
      renderDeckViewer();
      return;
    }

    $('node-map').classList.toggle('hidden', state.combatActive || state.screen === 'TREASURE' || state.screen === 'TILE_REWARD');
    $('combat-panel').classList.toggle('hidden', !state.combatActive);
    $('treasure-panel').classList.toggle('hidden', state.screen !== 'TREASURE');
    $('tile-reward-panel').classList.toggle('hidden', state.screen !== 'TILE_REWARD');

    if (state.screen === 'TREASURE') {
      renderTreasure();
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
      el.appendChild(span);
    });
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

  function renderCombat() {
    var m = state.monster;
    var hpRatio = m.maxHp > 0 ? m.hp / m.maxHp : 0;
    var activeTraitId = Traits.activeTraitForHpRatio(m.traitPhases, hpRatio);
    var trait = Traits.TRAITS[activeTraitId];

    var info = $('monster-info');
    info.innerHTML =
      '<div class="monster-name' + (m.isBoss ? ' boss-name' : '') + '">' + escapeHtml(m.name) + '</div>' +
      '<div class="monster-hp-bar"><div class="monster-hp-fill" style="width:' + Math.max(0, hpRatio * 100) + '%"></div></div>' +
      '<div class="monster-hp-text">' + m.hp + ' / ' + m.maxHp + ' HP</div>' +
      '<div class="monster-weakness">Weakness: ' + escapeHtml(trait.hint) + '</div>';

    var rack = $('rack-display');
    rack.innerHTML = '';
    state.player.rack.forEach(function (tile) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'letter-tile' + (tile.bonus ? ' has-bonus' : '');
      var val = Lexicon.LETTER_VALUES[tile.letter] || 0;
      btn.innerHTML = (tile.letter === '?' ? '★' : tile.letter) + '<sub>' + val + '</sub>';
      if (tile.bonus) btn.title = Tiles.describeBonus(tile.bonus);
      btn.addEventListener('click', function () {
        $('word-input').value += (tile.letter === '?' ? '' : tile.letter);
        $('word-input').focus();
      });
      rack.appendChild(btn);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
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

    render();
  };
})();
