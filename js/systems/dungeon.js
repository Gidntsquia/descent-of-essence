// =============================================================================
// Game.Systems.Dungeon -- Isaac-style procedural floor/dungeon generator.
//
// Builds a floor as a coarse room-grid graph grown via a randomized walk
// (NOT BSP rectangle carving), then lays out a fixed-size interior tile grid
// per room and populates rooms with enemies/bosses/items by calling into
// Package B (Entities/Enemies/Bosses) and Package C (Items), all defensively
// (typeof-checked / try-caught) since those files may not exist yet at load
// time in this dev sandbox -- only ever called from inside function bodies
// invoked later, never at script top-level.
//
// PUBLIC API
// -----------------------------------------------------------------------
//   Dungeon.generateFloor(floorNumber, seed, unlockedItemPool) -> Floor
//       floorNumber: 1-based int, 1..Game.Constants.TOTAL_FLOORS
//       seed: number|string, fed to Game.RNG.create(seed)
//       unlockedItemPool: string[] of item ids treasure rooms may draw from;
//           may be undefined/empty -> falls back to all known item ids
//
//   Dungeon.getRoom(floor, roomId) -> Room | undefined
//
//   Dungeon.getNeighborRoom(floor, roomId, direction) -> Room | null
//       direction: one of Game.Constants.DIRECTIONS values
//       Returns null if there's no door that direction, or no room there.
//
//   Dungeon.findOpenTile(room, rng, avoidDoors = true) -> {x, y} | null
//       Picks a random open FLOOR tile within room.layout, avoiding tiles
//       already occupied by room.enemies/room.items (falls back to ignoring
//       occupancy, then returns null only if the room truly has no open
//       tiles). Useful for game.js when placing new content into a room
//       post-generation (e.g. a dropped item after an enemy dies).
//
// DATA SHAPES PRODUCED (binding contract for other packages / integration)
// -----------------------------------------------------------------------
//   Floor:
//     { floorNumber, rooms: { [roomId]: Room }, roomGrid: RoomIdGrid,
//       startRoomId, bossRoomId, width, height, difficulty }
//
//     roomGrid is row-major: roomGrid[y][x] === roomId string | null,
//     sized height (Constants.ROOM_GRID_H) rows x width (Constants.ROOM_GRID_W)
//     columns. width/height mirror Constants.ROOM_GRID_W/H.
//
//   Room:
//     { id, gridX, gridY, type,                // Constants.ROOM_TYPES value
//       doors: { north, south, east, west },   // booleans
//       visited: false, cleared: false,
//       distance,                              // BFS-ish hop count from start
//       layout,                                // 2D tile grid, see below
//       enemies: [],                           // Entities.createEnemy() instances
//                                               // (boss instance included here too
//                                               // for boss rooms, see bossId)
//       items: [],                             // [{itemId, x, y}, ...]
//       bossId: null }                         // or the boss def id string
//
//     room.layout is a 2D array indexed [y][x] (row-major, matching roomGrid),
//     sized Constants.ROOM_TILE_H rows x Constants.ROOM_TILE_W columns, with
//     each cell holding a Constants.TILE_TYPES string (FLOOR / WALL / DOOR).
//
// Also exposed as smaller helpers, in case game.js/UI find them useful:
//   Dungeon.doorCount(room) -> number of open doors on a room
//   Dungeon.buildRoomLayout(room) -> fresh 2D tile grid for a room's doors
// =============================================================================
(function () {
  const Game = window.Game;
  const Dungeon = Game.Systems.Dungeon;
  const Constants = Game.Constants;
  const Utils = Game.Utils;

  const ALL_DIRECTIONS = Object.keys(Constants.DIRECTION_VECTORS);
  const RARITY_WEIGHTS = { common: 10, uncommon: 5, rare: 2, legendary: 1 };
  const TIER_TAGS = ['weak', 'normal', 'strong'];

  // ---------------------------------------------------------------------
  // Room shell creation
  // ---------------------------------------------------------------------
  function createRoomShell(gridX, gridY, distance, type) {
    return {
      id: 'r_' + gridX + '_' + gridY,
      gridX: gridX,
      gridY: gridY,
      type: type,
      doors: { north: false, south: false, east: false, west: false },
      visited: false,
      cleared: false,
      distance: distance,
      layout: null,
      enemies: [],
      items: [],
      bossId: null,
      // internal bookkeeping used only during generation; stripped before
      // the Floor object is returned to callers.
      _usedDirs: new Set(),
      _branchCount: 0
    };
  }

  function doorCount(room) {
    const d = room.doors;
    return (d.north ? 1 : 0) + (d.south ? 1 : 0) + (d.east ? 1 : 0) + (d.west ? 1 : 0);
  }
  Dungeon.doorCount = doorCount;

  // ---------------------------------------------------------------------
  // Step 1-4: randomized graph growth on the room grid, with retries.
  // ---------------------------------------------------------------------
  function growFloorGraph(targetRooms, seedForAttempt, gridW, gridH) {
    const rng = Game.RNG.create(seedForAttempt);
    const placedRooms = new Map(); // key: 'x,y' -> room

    const startX = Math.floor(gridW / 2);
    const startY = Math.floor(gridH / 2);
    const startRoom = createRoomShell(startX, startY, 0, Constants.ROOM_TYPES.START);
    placedRooms.set(Utils.key(startX, startY), startRoom);

    let frontier = [startRoom];
    let iterations = 0;

    while (
      placedRooms.size < targetRooms &&
      frontier.length > 0 &&
      iterations < Constants.MAX_GENERATION_ITERATIONS
    ) {
      iterations++;

      const idx = rng.randInt(0, frontier.length - 1);
      const room = frontier[idx];
      frontier.splice(idx, 1);

      const availableDirs = ALL_DIRECTIONS.filter((d) => !room._usedDirs.has(d));
      if (availableDirs.length === 0) continue;

      const dir = rng.choice(availableDirs);
      room._usedDirs.add(dir);

      const vec = Constants.DIRECTION_VECTORS[dir];
      const cx = room.gridX + vec.dx;
      const cy = room.gridY + vec.dy;

      let valid = Utils.inBounds(cx, cy, gridW, gridH) && !placedRooms.has(Utils.key(cx, cy));

      if (valid) {
        // Anti-loop/blob rule: candidate must touch at most 1 already-placed
        // room (its soon-to-be parent). If it would touch 2+, reject it.
        let placedNeighborCount = 0;
        Utils.neighborCells(cx, cy).forEach((nc) => {
          if (placedRooms.has(Utils.key(nc.x, nc.y))) placedNeighborCount++;
        });
        if (placedNeighborCount >= 2) valid = false;
      }

      const stillEligible = room._branchCount < Constants.MAX_BRANCHES_PER_ROOM &&
        room._usedDirs.size < ALL_DIRECTIONS.length;

      if (valid) {
        const newRoom = createRoomShell(cx, cy, room.distance + 1, Constants.ROOM_TYPES.COMBAT);
        room.doors[dir] = true;
        newRoom.doors[Constants.OPPOSITE_DIRECTION[dir]] = true;
        placedRooms.set(Utils.key(cx, cy), newRoom);
        room._branchCount++;

        frontier.push(newRoom);
        if (room._branchCount < Constants.MAX_BRANCHES_PER_ROOM && room._usedDirs.size < ALL_DIRECTIONS.length) {
          frontier.push(room);
        }
      } else if (stillEligible) {
        // Failed attempt -- room may still have other unused directions and
        // branch budget left, so give it another chance later.
        frontier.push(room);
      }
    }

    return { placedRooms: placedRooms, startRoom: startRoom, rng: rng, iterations: iterations };
  }

  // ---------------------------------------------------------------------
  // Step 5: boss room selection
  // ---------------------------------------------------------------------
  function selectBossRoom(placedRooms, startRoom, rng) {
    const candidates = [];
    placedRooms.forEach((r) => {
      if (r !== startRoom) candidates.push(r);
    });
    if (candidates.length === 0) return null;

    let maxDist = -Infinity;
    candidates.forEach((r) => {
      if (r.distance > maxDist) maxDist = r.distance;
    });
    const atMax = candidates.filter((r) => r.distance === maxDist);
    const deadEnds = atMax.filter((r) => doorCount(r) === 1);
    const pool = deadEnds.length > 0 ? deadEnds : atMax;
    return rng.choice(pool);
  }

  // ---------------------------------------------------------------------
  // Step 6: room typing (treasure / elite / combat)
  // ---------------------------------------------------------------------
  function typeRooms(placedRooms, startRoom, bossRoom, floorNumber, rng) {
    const others = [];
    placedRooms.forEach((r) => {
      if (r !== startRoom && r !== bossRoom) others.push(r);
    });

    // Treasure: 1-2 dead-end or low-degree (<=2) rooms.
    const treasureCount = rng.randInt(1, 2);
    const treasureCandidates = others.filter(
      (r) => r.type === Constants.ROOM_TYPES.COMBAT && doorCount(r) <= 2
    );
    const shuffledTreasure = rng.shuffle(treasureCandidates);
    shuffledTreasure.slice(0, treasureCount).forEach((r) => {
      r.type = Constants.ROOM_TYPES.TREASURE;
    });

    // Elite: on elite floors, 1 mid-distance dead-end room.
    if (Constants.ELITE_FLOOR_NUMBERS.indexOf(floorNumber) !== -1) {
      let pool = others.filter((r) => r.type === Constants.ROOM_TYPES.COMBAT && doorCount(r) === 1);
      if (pool.length === 0) {
        pool = others.filter((r) => r.type === Constants.ROOM_TYPES.COMBAT && doorCount(r) <= 2);
      }
      if (pool.length > 0) {
        const distances = pool.map((r) => r.distance).sort((a, b) => a - b);
        const median = distances[Math.floor(distances.length / 2)];
        let bestDiff = Infinity;
        let midCandidates = [];
        pool.forEach((r) => {
          const diff = Math.abs(r.distance - median);
          if (diff < bestDiff) {
            bestDiff = diff;
            midCandidates = [r];
          } else if (diff === bestDiff) {
            midCandidates.push(r);
          }
        });
        const eliteRoom = rng.choice(midCandidates);
        eliteRoom.type = Constants.ROOM_TYPES.ELITE;
      }
    }

    // Everything else remains COMBAT (its default type from createRoomShell).
  }

  // ---------------------------------------------------------------------
  // Step 7: tile layout
  // ---------------------------------------------------------------------
  function buildRoomLayout(room) {
    const W = Constants.ROOM_TILE_W;
    const H = Constants.ROOM_TILE_H;
    const grid = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) {
        const isBorder = x === 0 || x === W - 1 || y === 0 || y === H - 1;
        row.push(isBorder ? Constants.TILE_TYPES.WALL : Constants.TILE_TYPES.FLOOR);
      }
      grid.push(row);
    }

    const midX = Math.floor(W / 2);
    const midY = Math.floor(H / 2);

    function carve(cells) {
      cells.forEach((c) => {
        if (Utils.inBounds(c.x, c.y, W, H)) grid[c.y][c.x] = Constants.TILE_TYPES.DOOR;
      });
    }

    if (room.doors.north) carve([{ x: midX - 1, y: 0 }, { x: midX, y: 0 }]);
    if (room.doors.south) carve([{ x: midX - 1, y: H - 1 }, { x: midX, y: H - 1 }]);
    if (room.doors.west) carve([{ x: 0, y: midY - 1 }, { x: 0, y: midY }]);
    if (room.doors.east) carve([{ x: W - 1, y: midY - 1 }, { x: W - 1, y: midY }]);

    return grid;
  }
  Dungeon.buildRoomLayout = buildRoomLayout;

  // ---------------------------------------------------------------------
  // findOpenTile helper (also independently useful post-generation)
  // ---------------------------------------------------------------------
  Dungeon.findOpenTile = function (room, rng, avoidDoors) {
    if (avoidDoors === undefined) avoidDoors = true;
    const layout = room && room.layout;
    if (!layout) return null;

    const occupied = new Set();
    (room.enemies || []).forEach((e) => {
      if (e && typeof e.x === 'number' && typeof e.y === 'number') occupied.add(Utils.key(e.x, e.y));
    });
    (room.items || []).forEach((it) => {
      if (it && typeof it.x === 'number' && typeof it.y === 'number') occupied.add(Utils.key(it.x, it.y));
    });

    function collect(respectOccupied) {
      const out = [];
      for (let y = 0; y < layout.length; y++) {
        for (let x = 0; x < layout[y].length; x++) {
          const t = layout[y][x];
          const isOpen = t === Constants.TILE_TYPES.FLOOR || (!avoidDoors && t === Constants.TILE_TYPES.DOOR);
          if (!isOpen) continue;
          if (respectOccupied && occupied.has(Utils.key(x, y))) continue;
          out.push({ x: x, y: y });
        }
      }
      return out;
    }

    let candidates = collect(true);
    if (candidates.length === 0) candidates = collect(false);
    if (candidates.length === 0) return null;
    return rng.choice(candidates);
  };

  // ---------------------------------------------------------------------
  // Step 8: content population helpers
  // ---------------------------------------------------------------------
  function getAllowedTiers(floorNumber) {
    if (floorNumber <= 1) return ['weak'];
    if (floorNumber <= 2) return ['weak', 'normal'];
    return ['weak', 'normal', 'strong'];
  }

  function getEnemyDefs() {
    const Enemies = Game.Data && Game.Data.Enemies;
    return (Enemies && Enemies.ENEMY_DEFS) || {};
  }

  function getEligibleEnemyIds(floorNumber, excludeEliteTag) {
    const defs = getEnemyDefs();
    const allowed = getAllowedTiers(floorNumber);
    return Object.keys(defs).filter((id) => {
      const def = defs[id];
      const tags = def && Array.isArray(def.tags) ? def.tags : [];
      if (excludeEliteTag && tags.indexOf('elite') !== -1) return false;
      const hasTier = tags.some((t) => TIER_TAGS.indexOf(t) !== -1);
      if (!hasTier) return true; // missing/unrecognized tags -> lenient default-allow
      return tags.some((t) => allowed.indexOf(t) !== -1);
    });
  }

  function getEliteEnemyIds(floorNumber) {
    const defs = getEnemyDefs();
    const eliteIds = Object.keys(defs).filter((id) => {
      const tags = defs[id] && Array.isArray(defs[id].tags) ? defs[id].tags : [];
      return tags.indexOf('elite') !== -1;
    });
    if (eliteIds.length > 0) return eliteIds;

    const strongIds = Object.keys(defs).filter((id) => {
      const tags = defs[id] && Array.isArray(defs[id].tags) ? defs[id].tags : [];
      return tags.indexOf('strong') !== -1;
    });
    if (strongIds.length > 0) return strongIds;

    return getEligibleEnemyIds(floorNumber, false);
  }

  function safeCreateEnemy(defId, floorNumber) {
    try {
      const Entities = Game.Systems && Game.Systems.Entities;
      if (Entities && typeof Entities.createEnemy === 'function') {
        return Entities.createEnemy(defId, floorNumber);
      }
    } catch (e) {
      // defensive -- Package B may not be loaded/wired yet
    }
    return null;
  }

  function placeInRoom(room, inst, rng) {
    if (!inst) return;
    const tile = Dungeon.findOpenTile(room, rng, true);
    if (tile) {
      inst.x = tile.x;
      inst.y = tile.y;
    }
    room.enemies.push(inst);
  }

  function populateCombatRoom(room, floorNumber, rng) {
    const pool = getEligibleEnemyIds(floorNumber, true);
    if (pool.length === 0) return;
    const count = rng.randInt(2, 3);
    for (let i = 0; i < count; i++) {
      const defId = rng.choice(pool);
      const inst = safeCreateEnemy(defId, floorNumber);
      if (inst) placeInRoom(room, inst, rng);
    }
  }

  function populateEliteRoom(room, floorNumber, rng) {
    const elitePool = getEliteEnemyIds(floorNumber);
    if (elitePool.length > 0) {
      const defId = rng.choice(elitePool);
      const inst = safeCreateEnemy(defId, floorNumber);
      if (inst) placeInRoom(room, inst, rng);
    }

    const normalPool = getEligibleEnemyIds(floorNumber, true);
    if (normalPool.length > 0) {
      const extra = rng.randInt(1, 2);
      for (let i = 0; i < extra; i++) {
        const defId = rng.choice(normalPool);
        const inst = safeCreateEnemy(defId, floorNumber);
        if (inst) placeInRoom(room, inst, rng);
      }
    }
  }

  function populateBossRoom(room, floorNumber, rng) {
    const Bosses = Game.Data && Game.Data.Bosses;
    const defs = (Bosses && Bosses.BOSS_DEFS) || {};
    const ids = Object.keys(defs);
    if (ids.length === 0) {
      room.bossId = null;
      return;
    }

    function eligible(id) {
      const def = defs[id];
      const hasMin = typeof def.minFloor === 'number';
      const hasMax = typeof def.maxFloor === 'number';
      if (hasMin && floorNumber < def.minFloor) return false;
      if (hasMax && floorNumber > def.maxFloor) return false;
      return true;
    }

    let pool = ids.filter(eligible);
    if (pool.length === 0) pool = ids; // field missing/no matches -> pick any boss def

    const bossDefId = rng.choice(pool);
    room.bossId = bossDefId;

    const inst = safeCreateEnemy(bossDefId, floorNumber);
    if (inst) {
      const cx = Math.floor(Constants.ROOM_TILE_W / 2);
      const cy = Math.floor(Constants.ROOM_TILE_H / 2);
      inst.x = cx;
      inst.y = cy;
      // Also tracked in room.enemies so generic enemy-iteration code (AI,
      // combat, "is room cleared" checks) finds the boss without needing
      // special-case logic.
      room.enemies.push(inst);
    }
  }

  function populateTreasureRoom(room, unlockedItemPool, rng) {
    const Items = Game.Data && Game.Data.Items;
    const defs = (Items && Items.ITEM_DEFS) || {};
    const pool = unlockedItemPool && unlockedItemPool.length > 0 ? unlockedItemPool.slice() : Object.keys(defs);
    if (pool.length === 0) return;

    const weighted = pool.map((id) => {
      const def = defs[id];
      const rarity = def && def.rarity;
      const weight = RARITY_WEIGHTS[rarity] || RARITY_WEIGHTS.common;
      return { id: id, weight: weight };
    });

    const count = rng.randInt(1, 3);
    for (let i = 0; i < count; i++) {
      const chosen = rng.weightedChoice(weighted, (it) => it.weight);
      if (!chosen) continue;
      const tile = Dungeon.findOpenTile(room, rng, true);
      room.items.push({ itemId: chosen.id, x: tile ? tile.x : null, y: tile ? tile.y : null });
    }
  }

  // ---------------------------------------------------------------------
  // Public entry point
  // ---------------------------------------------------------------------
  Dungeon.generateFloor = function (floorNumber, seed, unlockedItemPool) {
    const gridW = Constants.ROOM_GRID_W;
    const gridH = Constants.ROOM_GRID_H;

    const base = Utils.clamp(
      Constants.MIN_ROOMS_PER_FLOOR + Math.floor((floorNumber - 1) * 1.5),
      Constants.MIN_ROOMS_PER_FLOOR,
      Constants.MAX_ROOMS_PER_FLOOR
    );
    const targetRooms = base + 1; // +1 for the boss room (retyped from a placed room)

    let best = null;
    for (let attempt = 0; attempt < Constants.MAX_GENERATION_ATTEMPTS; attempt++) {
      const attemptSeed = attempt === 0 ? seed : String(seed) + ':attempt' + attempt;
      const result = growFloorGraph(targetRooms, attemptSeed, gridW, gridH);
      if (!best || result.placedRooms.size > best.placedRooms.size) best = result;
      if (best.placedRooms.size >= targetRooms) break;
    }

    const placedRooms = best.placedRooms;
    const startRoom = best.startRoom;
    const rng = best.rng; // continue the winning attempt's RNG stream for the rest of generation

    const bossRoom = selectBossRoom(placedRooms, startRoom, rng);
    if (bossRoom) bossRoom.type = Constants.ROOM_TYPES.BOSS;

    typeRooms(placedRooms, startRoom, bossRoom, floorNumber, rng);

    const rooms = {};
    const roomGrid = [];
    for (let y = 0; y < gridH; y++) roomGrid.push(new Array(gridW).fill(null));

    placedRooms.forEach((room) => {
      delete room._usedDirs;
      delete room._branchCount;
      room.layout = buildRoomLayout(room);
      rooms[room.id] = room;
      roomGrid[room.gridY][room.gridX] = room.id;
    });

    // Content population happens after every room has its layout built, so
    // findOpenTile() works for every room regardless of population order.
    placedRooms.forEach((room) => {
      switch (room.type) {
        case Constants.ROOM_TYPES.COMBAT:
          populateCombatRoom(room, floorNumber, rng);
          break;
        case Constants.ROOM_TYPES.ELITE:
          populateEliteRoom(room, floorNumber, rng);
          break;
        case Constants.ROOM_TYPES.BOSS:
          populateBossRoom(room, floorNumber, rng);
          break;
        case Constants.ROOM_TYPES.TREASURE:
          populateTreasureRoom(room, unlockedItemPool, rng);
          break;
        default:
          // START room stays empty/safe -- no enemies, no hazards.
          break;
      }
    });

    return {
      floorNumber: floorNumber,
      rooms: rooms,
      roomGrid: roomGrid,
      startRoomId: startRoom.id,
      bossRoomId: bossRoom ? bossRoom.id : null,
      width: gridW,
      height: gridH,
      difficulty: floorNumber
    };
  };

  // ---------------------------------------------------------------------
  // Small query helpers
  // ---------------------------------------------------------------------
  Dungeon.getRoom = function (floor, roomId) {
    return floor && floor.rooms ? floor.rooms[roomId] : undefined;
  };

  Dungeon.getNeighborRoom = function (floor, roomId, direction) {
    const room = Dungeon.getRoom(floor, roomId);
    if (!room || !room.doors || !room.doors[direction]) return null;

    const vec = Constants.DIRECTION_VECTORS[direction];
    if (!vec) return null;

    const nx = room.gridX + vec.dx;
    const ny = room.gridY + vec.dy;

    if (!floor.roomGrid || ny < 0 || ny >= floor.roomGrid.length) return null;
    const row = floor.roomGrid[ny];
    if (!row || nx < 0 || nx >= row.length) return null;

    const neighborId = row[nx];
    if (!neighborId) return null;
    return Dungeon.getRoom(floor, neighborId);
  };
})();
