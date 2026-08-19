(function () {
  const C = window.Game.Constants;

  C.GAME_STATES = {
    BOOT: 'BOOT',
    MAIN_MENU: 'MAIN_MENU',
    CHARACTER_SELECT: 'CHARACTER_SELECT',
    RUN_EXPLORE: 'RUN_EXPLORE',
    GAME_OVER: 'GAME_OVER',
    VICTORY: 'VICTORY'
  };

  C.ROOM_TYPES = {
    START: 'start',
    COMBAT: 'combat',
    TREASURE: 'treasure',
    ELITE: 'elite',
    BOSS: 'boss'
  };

  C.TILE_TYPES = {
    FLOOR: 'floor',
    WALL: 'wall',
    DOOR: 'door'
  };

  C.DIRECTIONS = {
    NORTH: 'north',
    SOUTH: 'south',
    EAST: 'east',
    WEST: 'west'
  };

  C.DIRECTION_VECTORS = {
    north: { dx: 0, dy: -1 },
    south: { dx: 0, dy: 1 },
    east: { dx: 1, dy: 0 },
    west: { dx: -1, dy: 0 }
  };

  C.OPPOSITE_DIRECTION = {
    north: 'south',
    south: 'north',
    east: 'west',
    west: 'east'
  };

  // Player action shape emitted by UI.Input and consumed by game.js:
  //   { type: 'move', direction: 'north'|'south'|'east'|'west' }
  //   { type: 'wait' }
  //   { type: 'useConsumable', itemId: string }
  C.ACTION_TYPES = {
    MOVE: 'move',
    WAIT: 'wait',
    USE_CONSUMABLE: 'useConsumable'
  };

  // Item def hook names, invoked via Game.Systems.Items.runHook(name, ctx).
  // Fixed list for v1 -- do not add ad hoc hook names in content files.
  C.HOOK_NAMES = [
    'onPickup', 'onAttack', 'onHit', 'onKill', 'onDamaged',
    'onMove', 'onTurnEnd', 'onRoomEnter', 'onFloorStart', 'onDeath'
  ];

  C.ITEM_RARITIES = {
    COMMON: 'common',
    UNCOMMON: 'uncommon',
    RARE: 'rare',
    LEGENDARY: 'legendary'
  };

  // Coarse room-grid (map of rooms per floor), per the Isaac-style generator.
  C.ROOM_GRID_W = 7;
  C.ROOM_GRID_H = 7;
  C.MIN_ROOMS_PER_FLOOR = 6;
  C.MAX_ROOMS_PER_FLOOR = 9;
  C.MAX_BRANCHES_PER_ROOM = 3;
  C.MAX_GENERATION_ATTEMPTS = 10;
  C.MAX_GENERATION_ITERATIONS = 500;

  // Room interior tile grid (fixed size for every room in v1).
  C.ROOM_TILE_W = 11;
  C.ROOM_TILE_H = 9;
  C.TILE_SIZE = 56; // px, used by renderer.js

  C.TOTAL_FLOORS = 3;
  C.ELITE_FLOOR_NUMBERS = [2];

  // Per-floor scaling applied at Entities.createEnemy(defId, floorNumber).
  C.ENEMY_HP_SCALE_PER_FLOOR = 0.15;
  C.ENEMY_ATTACK_SCALE_PER_FLOOR = 0.10;

  C.SAVE_KEY = 'rlgame_save_v1';
  C.SAVE_VERSION = 2; // bumped: v1 saves carried a currency/unlock economy that no longer exists
})();
