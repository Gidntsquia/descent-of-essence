// js/game.js
// Orchestrator: state machine + canonical turn loop wiring Packages A-D
// together. Loaded after every other script, so (unlike the packages it
// wires up) it can grab direct references to their APIs at IIFE-execution
// time instead of deferring lookups into function bodies.
//
// Integration fixes applied here (discovered while wiring, not present in
// any single package in isolation):
//   1. dungeon.js's populateBossRoom instantiates a boss via
//      Entities.createEnemy(bossDefId, floor) -- but boss defs live in
//      Game.Data.Bosses.BOSS_DEFS, not ENEMY_DEFS, so createEnemy throws
//      (caught internally by dungeon.js's own try/catch) and the boss room
//      silently generates with room.bossId set but no actual boss entity.
//      Fixed by ensureBossInstances(), a post-generation pass that creates
//      any missing boss instance via the correct Entities.createBossInstance.
//   2. Package A's Room objects expose tile data as room.layout, but
//      Package B's ai.js (findOpenTilesNear, used by boss summon patterns)
//      reads room.tiles. Fixed by aliasing room.tiles = room.layout on every
//      room right after generation (prepareFloor()).
//
// Game.State (aliased below as `state`) is left as the single mutable
// runtime-state object so it can be inspected directly via
// javascript_tool eval of `Game.State` during browser verification.

(function () {
  var Game = window.Game;
  var C = Game.Constants;
  var GS = C.GAME_STATES;
  var Utils = Game.Utils;
  var Dungeon = Game.Systems.Dungeon;
  var Entities = Game.Systems.Entities;
  var Combat = Game.Systems.Combat;
  var AI = Game.Systems.AI;
  var Items = Game.Systems.Items;
  var Save = Game.Systems.Save;
  var Renderer = Game.UI.Renderer;
  var Hud = Game.UI.Hud;
  var MessageLog = Game.UI.MessageLog;
  var Input = Game.UI.Input;
  var Screens = Game.UI.Screens;

  var state = Game.State;
  state.currentGameState = GS.BOOT;
  state.saveData = null;
  state.player = null;
  state.floor = null;
  state.floorNumber = 0;
  state.currentRoomId = null;
  state.runSeed = null;
  state.rng = null;
  state.actionsRemaining = 1;

  function log(text) {
    MessageLog.add(text);
  }

  function enemyDisplayName(enemy) {
    var def = (Game.Data.Enemies.ENEMY_DEFS && Game.Data.Enemies.ENEMY_DEFS[enemy.defId]) ||
      (Game.Data.Bosses.BOSS_DEFS && Game.Data.Bosses.BOSS_DEFS[enemy.defId]);
    return def ? def.name : 'the creature';
  }

  function logAttackResult(attackerLabel, defenderLabel, result) {
    if (result.damage.cancelled) {
      log(attackerLabel + "'s attack is blocked!");
      return;
    }
    var msg = attackerLabel + ' hits ' + defenderLabel + ' for ' + result.damage.amount + ' damage';
    if (result.damage.isCrit) msg += ' (critical hit!)';
    msg += '.';
    log(msg);
    if (result.attackerHealed > 0) log(attackerLabel + ' heals ' + result.attackerHealed + ' hp.');
  }

  // ---------------------------------------------------------------------
  // Floor preparation (integration fixes -- see header comment)
  // ---------------------------------------------------------------------

  function ensureBossInstances(floor, floorNumber) {
    Object.keys(floor.rooms).forEach(function (roomId) {
      var room = floor.rooms[roomId];
      if (room.type !== C.ROOM_TYPES.BOSS || !room.bossId) return;
      var hasBoss = room.enemies.some(function (e) { return e.defId === room.bossId && e.isBoss; });
      if (hasBoss) return;
      var inst = Entities.createBossInstance(room.bossId, floorNumber);
      inst.x = Math.floor(C.ROOM_TILE_W / 2);
      inst.y = Math.floor(C.ROOM_TILE_H / 2);
      room.enemies.push(inst);
    });
  }

  function prepareFloor(floor, floorNumber) {
    // Must run BEFORE the cleared-check pass below: a boss room's enemies
    // array is empty until ensureBossInstances populates it, so checking
    // cleared status first would wrongly mark the boss room as pre-cleared.
    ensureBossInstances(floor, floorNumber);
    Object.keys(floor.rooms).forEach(function (roomId) {
      var room = floor.rooms[roomId];
      room.tiles = room.layout;
      if (room.enemies.length === 0) room.cleared = true;
    });
  }

  // ---------------------------------------------------------------------
  // Room/tile helpers
  // ---------------------------------------------------------------------

  function getCurrentRoom() {
    return state.floor ? state.floor.rooms[state.currentRoomId] : null;
  }

  function centerTile() {
    return { x: Math.floor(C.ROOM_TILE_W / 2), y: Math.floor(C.ROOM_TILE_H / 2) };
  }

  function entryTileFor(entryWall) {
    var W = C.ROOM_TILE_W, H = C.ROOM_TILE_H;
    var midX = Math.floor(W / 2), midY = Math.floor(H / 2);
    if (entryWall === 'south') return { x: midX, y: H - 2 };
    if (entryWall === 'north') return { x: midX, y: 1 };
    if (entryWall === 'west') return { x: 1, y: midY };
    if (entryWall === 'east') return { x: W - 2, y: midY };
    return centerTile();
  }

  function isOpenFloorTile(room, x, y) {
    var row = room.layout[y];
    if (!row || row[x] === undefined) return false;
    return row[x] === C.TILE_TYPES.FLOOR;
  }

  function pickUpItemsAt(room, x, y) {
    for (var i = room.items.length - 1; i >= 0; i--) {
      var drop = room.items[i];
      if (drop.x === x && drop.y === y) {
        var def = Game.Data.Items.ITEM_DEFS[drop.itemId];
        Items.addPassive(state.player, drop.itemId, { rng: state.rng, log: log });
        state.player.runStats.itemsCollected += 1;
        log('You pick up ' + (def ? def.name : drop.itemId) + '.');
        room.items.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  function renderAll() {
    var room = getCurrentRoom();
    Renderer.drawRoom(room, state.player);
    Hud.update(state.player, state.floorNumber, state.floor, room);
  }

  // ---------------------------------------------------------------------
  // Death / room-clear / floor-advance / victory / game-over
  // ---------------------------------------------------------------------

  function processRoomAfterAction(room) {
    if (!room) return;
    for (var i = room.enemies.length - 1; i >= 0; i--) {
      var enemy = room.enemies[i];
      if (enemy.hp <= 0 || enemy.isAlive === false) {
        enemy.isAlive = false;
        var def = (Game.Data.Enemies.ENEMY_DEFS && Game.Data.Enemies.ENEMY_DEFS[enemy.defId]) ||
          (Game.Data.Bosses.BOSS_DEFS && Game.Data.Bosses.BOSS_DEFS[enemy.defId]);
        if (def && def.onDeath && AI.enemyDeathEffects[def.onDeath]) {
          AI.enemyDeathEffects[def.onDeath](enemy, room, state.rng, state.floorNumber);
        }
        var goldRange = (def && def.goldDrop) || (enemy.isBoss ? [20, 40] : [1, 3]);
        var gold = state.rng.randInt(goldRange[0], goldRange[1]);
        state.player.gold += gold;
        state.player.runStats.goldEarned += gold;
        state.player.runStats.enemiesKilled += 1;
        log((def ? def.name : 'The creature') + ' dies. (+' + gold + 'g)');
        room.enemies.splice(i, 1);
      }
    }

    if (room.enemies.length === 0 && !room.cleared) {
      room.cleared = true;
      if (room.type !== C.ROOM_TYPES.START) log('Room cleared!');
      if (room.type === C.ROOM_TYPES.BOSS) {
        handleBossDefeated();
      }
    }
  }

  function handleBossDefeated() {
    log('The boss has been defeated!');
    state.player.runStats.floorsCleared += 1;
    if (state.floorNumber >= C.TOTAL_FLOORS) {
      triggerVictory();
    } else {
      advanceToFloor(state.floorNumber + 1);
    }
  }

  function advanceToFloor(floorNumber) {
    state.floorNumber = floorNumber;
    var floor = Dungeon.generateFloor(floorNumber, state.runSeed + ':floor' + floorNumber, undefined);
    prepareFloor(floor, floorNumber);
    state.floor = floor;
    state.currentRoomId = floor.startRoomId;

    var startRoom = floor.rooms[floor.startRoomId];
    startRoom.visited = true;
    var center = centerTile();
    state.player.x = center.x;
    state.player.y = center.y;
    state.player.floor = floorNumber;

    Renderer.clearTelegraph();
    resetActionCycle();
    Items.runHook('onFloorStart', { player: state.player, floorNumber: floorNumber, rng: state.rng, log: log });
    Items.runHook('onRoomEnter', { player: state.player, room: startRoom, rng: state.rng, log: log });
    log('You descend to floor ' + floorNumber + '.');
    renderAll();
  }

  function triggerVictory() {
    state.currentGameState = GS.VICTORY;
    Screens.show(GS.VICTORY);
    Screens.renderVictory(state.player);
  }

  function triggerGameOver() {
    state.currentGameState = GS.GAME_OVER;
    Screens.show(GS.GAME_OVER);
    Screens.renderGameOver(state.player);
  }

  // ---------------------------------------------------------------------
  // Turn cycle
  // ---------------------------------------------------------------------

  function resetActionCycle() {
    state.actionsRemaining = 1 + ((state.player.stats && state.player.stats.extraActions) || 0);
  }

  function tryMoveEnemy(enemy, room, dx, dy) {
    var tx = enemy.x + dx;
    var ty = enemy.y + dy;
    if (!isOpenFloorTile(room, tx, ty)) return;
    if (state.player.x === tx && state.player.y === ty) return;
    var occupied = room.enemies.some(function (e) {
      return e !== enemy && e.isAlive !== false && e.x === tx && e.y === ty;
    });
    if (occupied) return;
    enemy.x = tx;
    enemy.y = ty;
  }

  function runEnemyPhase(room) {
    var snapshot = room.enemies.slice();
    for (var i = 0; i < snapshot.length; i++) {
      var enemy = snapshot[i];
      if (enemy.isAlive === false || enemy.hp <= 0) continue;
      if (state.currentGameState !== GS.RUN_EXPLORE) return;

      if (enemy.isBoss) {
        AI.bossTakeTurn(enemy, state.player, room, state.rng, log);
        if (enemy.pendingTelegraph) {
          var bossDef = Game.Data.Bosses.BOSS_DEFS[enemy.defId];
          Renderer.showTelegraph((bossDef ? bossDef.name : 'The boss') + ' is preparing an attack!');
        } else {
          Renderer.clearTelegraph();
        }
      } else {
        var def = Game.Data.Enemies.ENEMY_DEFS[enemy.defId];
        var behaviorFn = def && AI.behaviors[def.behavior];
        var intent = behaviorFn ? behaviorFn(enemy, state.player, room, state.rng) : { action: 'wait' };

        if (intent.action === 'attack') {
          var isAdjacent = Utils.isAdjacent(enemy.x, enemy.y, state.player.x, state.player.y);
          var isRanged = def && def.behavior === 'ranged';
          if (isAdjacent || isRanged) {
            var result = Combat.resolveAttack(enemy, state.player, { room: room, rng: state.rng, log: log });
            logAttackResult(enemyDisplayName(enemy), 'you', result);
            if (result.defenderDied) { triggerGameOver(); return; }
          }
        } else if (intent.action === 'move') {
          tryMoveEnemy(enemy, room, intent.dx, intent.dy);
        }
      }

      if (!state.player.isAlive || state.player.hp <= 0) { triggerGameOver(); return; }
    }
    processRoomAfterAction(room);
  }

  function consumeAction(room) {
    state.actionsRemaining -= 1;
    if (state.actionsRemaining > 0) {
      renderAll();
      return;
    }

    runEnemyPhase(room);
    if (state.currentGameState !== GS.RUN_EXPLORE) { renderAll(); return; }

    Items.runHook('onTurnEnd', { player: state.player, rng: state.rng, log: log });
    Combat.tickStatusEffects(state.player, log);
    if (!state.player.isAlive || state.player.hp <= 0) { triggerGameOver(); renderAll(); return; }

    room.enemies.forEach(function (e) {
      if (e.isAlive !== false) Combat.tickStatusEffects(e, log);
    });

    state.player.runStats.turnsTaken += 1;
    resetActionCycle();
    renderAll();
  }

  // ---------------------------------------------------------------------
  // Room transitions
  // ---------------------------------------------------------------------

  function transitionToRoom(neighborRoom, travelDirection) {
    state.currentRoomId = neighborRoom.id;
    neighborRoom.visited = true;

    var entryWall = C.OPPOSITE_DIRECTION[travelDirection];
    var pos = entryTileFor(entryWall);
    state.player.x = pos.x;
    state.player.y = pos.y;

    if (neighborRoom.enemies.length === 0) neighborRoom.cleared = true;

    Renderer.clearTelegraph();
    Items.runHook('onRoomEnter', { player: state.player, room: neighborRoom, rng: state.rng, log: log });
    pickUpItemsAt(neighborRoom, pos.x, pos.y);

    renderAll();
  }

  // ---------------------------------------------------------------------
  // Player action handlers
  // ---------------------------------------------------------------------

  function handleMoveAction(direction) {
    var room = getCurrentRoom();
    var vec = C.DIRECTION_VECTORS[direction];
    var tx = state.player.x + vec.dx;
    var ty = state.player.y + vec.dy;
    var row = room.layout[ty];
    var tile = row ? row[tx] : undefined;

    if (tile === undefined || tile === C.TILE_TYPES.WALL) {
      return;
    }

    if (tile === C.TILE_TYPES.DOOR) {
      if (!room.cleared) {
        log('The way is barred until you clear this room!');
        return;
      }
      var neighbor = Dungeon.getNeighborRoom(state.floor, room.id, direction);
      if (!neighbor) return;
      transitionToRoom(neighbor, direction);
      return;
    }

    var targetEnemy = room.enemies.find(function (e) { return e.isAlive !== false && e.x === tx && e.y === ty; });
    if (targetEnemy) {
      var result = Combat.resolveAttack(state.player, targetEnemy, { room: room, rng: state.rng, log: log });
      logAttackResult('You', enemyDisplayName(targetEnemy), result);
      processRoomAfterAction(room);
      if (state.currentGameState !== GS.RUN_EXPLORE || state.currentRoomId !== room.id) { renderAll(); return; }
      consumeAction(room);
      return;
    }

    var moveCtx = {
      player: state.player,
      from: { x: state.player.x, y: state.player.y },
      to: { x: tx, y: ty },
      direction: direction,
      room: room,
      rng: state.rng,
      log: log,
      bonusMove: false
    };
    state.player.x = tx;
    state.player.y = ty;
    Items.runHook('onMove', moveCtx);
    pickUpItemsAt(room, tx, ty);

    if (moveCtx.bonusMove) {
      renderAll();
      return;
    }
    consumeAction(room);
  }

  function handleWaitAction() {
    var room = getCurrentRoom();
    consumeAction(room);
  }

  function handleUseConsumableAction(slotIndex) {
    var room = getCurrentRoom();
    var entry = state.player.inventory.consumables[slotIndex];
    if (!entry) return;

    var success = Items.useConsumable(state.player, entry.itemId, { rng: state.rng, log: log, room: room });
    if (!success) return;

    var def = Game.Data.Consumables.CONSUMABLE_DEFS[entry.itemId];
    log('You use ' + (def ? def.name : entry.itemId) + '.');

    processRoomAfterAction(room);
    if (state.currentGameState !== GS.RUN_EXPLORE || state.currentRoomId !== room.id) { renderAll(); return; }
    consumeAction(room);
  }

  function handleInputAction(action) {
    if (state.currentGameState !== GS.RUN_EXPLORE) return;
    if (action.type === C.ACTION_TYPES.MOVE) {
      handleMoveAction(action.direction);
    } else if (action.type === C.ACTION_TYPES.WAIT) {
      handleWaitAction();
    } else if (action.type === C.ACTION_TYPES.USE_CONSUMABLE) {
      handleUseConsumableAction(action.slotIndex);
    }
  }

  // ---------------------------------------------------------------------
  // Menu flow
  // ---------------------------------------------------------------------

  function goToCharacterSelect() {
    state.currentGameState = GS.CHARACTER_SELECT;
    Screens.show(GS.CHARACTER_SELECT);
    Screens.renderCharacterSelect(Game.Data.Characters.CHARACTER_DEFS);
  }

  function startRun(characterId) {
    var charDef = Game.Data.Characters.CHARACTER_DEFS[characterId];
    if (!charDef) return;

    var player = Entities.createPlayer(charDef);
    player.inventory = { passives: [], consumables: [] };
    (charDef.startingItems || []).forEach(function (itemId) { Items.addPassive(player, itemId, {}); });
    (charDef.startingConsumables || []).forEach(function (entry) { Items.addConsumable(player, entry.itemId, entry.quantity); });

    state.player = player;
    state.runSeed = Date.now();
    state.rng = Game.RNG.create(state.runSeed);
    state.floorNumber = 1;

    MessageLog.clear();
    Renderer.clearTelegraph();

    var floor = Dungeon.generateFloor(1, state.runSeed + ':floor1', undefined);
    prepareFloor(floor, 1);
    state.floor = floor;
    state.currentRoomId = floor.startRoomId;

    var startRoom = floor.rooms[floor.startRoomId];
    startRoom.visited = true;
    var center = centerTile();
    player.x = center.x;
    player.y = center.y;
    player.floor = 1;

    resetActionCycle();
    Items.runHook('onFloorStart', { player: player, floorNumber: 1, rng: state.rng, log: log });
    Items.runHook('onRoomEnter', { player: player, room: startRoom, rng: state.rng, log: log });

    state.currentGameState = GS.RUN_EXPLORE;
    Screens.show(GS.RUN_EXPLORE);
    log('Floor 1. Good luck, ' + charDef.name + '.');
    renderAll();
  }

  function returnToMainMenuAfterRun(victory) {
    Save.recordRunResult(state.saveData, state.player.runStats, victory);
    Save.persist(state.saveData);
    state.currentGameState = GS.MAIN_MENU;
    Screens.show(GS.MAIN_MENU);
    Screens.renderMainMenu(state.saveData);
  }

  function handleUiAction(payload) {
    var action = payload.action;

    if (action === 'new-run') {
      goToCharacterSelect();
    } else if (action === 'select-character') {
      startRun(payload.characterId);
    } else if (action === 'continue-gameover') {
      returnToMainMenuAfterRun(false);
    } else if (action === 'continue-victory') {
      returnToMainMenuAfterRun(true);
    }
  }

  // ---------------------------------------------------------------------
  // Bootstrap
  // ---------------------------------------------------------------------

  Game.init = function () {
    Hud.init('hud');
    MessageLog.init('message-log');
    Renderer.init('game-canvas');
    Screens.onAction(handleUiAction);
    Input.init(handleInputAction);

    state.saveData = Save.load();
    state.currentGameState = GS.MAIN_MENU;
    Screens.show(GS.MAIN_MENU);
    Screens.renderMainMenu(state.saveData);
  };
})();
