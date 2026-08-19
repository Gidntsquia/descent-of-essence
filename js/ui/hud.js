// js/ui/hud.js
// Attaches only to Game.UI.Hud.
//
// Public API:
//   Hud.init(containerId)                          -- build HUD DOM once.
//   Hud.update(player, floorNumber, floor, room)    -- refresh HUD with current
//     values. `floor` is the current Floor object (for the mini-map), `room`
//     is the current Room object (for the goal line + enemies-remaining count
//     + highlighting the player's position on the map). Both are optional --
//     omitting them just skips the map/goal sections.
//
// DOM convention (all ids stable, built once by init()):
//   #hud-hp-fill, #hud-hp-text       -- HP bar fill + "12/30" text
//   #hud-gold-text                   -- gold amount
//   #hud-floor-text                  -- "Floor 3"
//   #hud-goal-text                   -- plain-language "what do I do right now"
//   #hud-minimap                     -- small room-grid map, revealed rooms only
//   #hud-passives / #hud-consumables / #hud-status-effects -- icon rows

(function () {
  const Hud = window.Game.UI.Hud;

  let root = null;
  let hpFillEl = null;
  let hpTextEl = null;
  let goldTextEl = null;
  let floorTextEl = null;
  let goalEl = null;
  let minimapEl = null;
  let passivesEl = null;
  let consumablesEl = null;
  let statusEl = null;

  function lookupItemName(itemId) {
    try {
      const defs = window.Game.Data.Items.ITEM_DEFS;
      if (defs && defs[itemId] && defs[itemId].name) return defs[itemId].name;
    } catch (e) { /* defs not ready yet */ }
    return itemId;
  }

  function lookupConsumableName(itemId) {
    try {
      const defs = window.Game.Data.Consumables.CONSUMABLE_DEFS;
      if (defs && defs[itemId] && defs[itemId].name) return defs[itemId].name;
    } catch (e) { /* defs not ready yet */ }
    return itemId;
  }

  function roomTypeColor(type) {
    const T = window.Game.Constants.ROOM_TYPES;
    if (type === T.BOSS) return '#e0455f';
    if (type === T.ELITE) return '#f2a14e';
    if (type === T.SHOP) return '#f2c14e';
    if (type === T.TREASURE) return '#a78bfa';
    if (type === T.START) return '#4e8f6b';
    return '#5b5578'; // combat, and fallback
  }

  function roomTypeLabel(type) {
    const T = window.Game.Constants.ROOM_TYPES;
    if (type === T.BOSS) return 'Boss';
    if (type === T.ELITE) return 'Elite';
    if (type === T.SHOP) return 'Shop';
    if (type === T.TREASURE) return 'Treasure';
    if (type === T.START) return 'Start';
    return 'Enemies';
  }

  // A room is shown on the map once the player has stood in it, or in a
  // room next door to one they've stood in (revealed-on-approach, so the
  // player always sees where they can go next without spoiling the whole
  // floor layout).
  function computeRevealed(floor) {
    const revealed = new Set();
    const roomIds = Object.keys(floor.rooms);
    roomIds.forEach((id) => { if (floor.rooms[id].visited) revealed.add(id); });

    const DV = window.Game.Constants.DIRECTION_VECTORS;
    roomIds.forEach((id) => {
      const r = floor.rooms[id];
      if (!r.visited) return;
      Object.keys(r.doors).forEach((dir) => {
        if (!r.doors[dir]) return;
        const vec = DV[dir];
        const row = floor.roomGrid[r.gridY + vec.dy];
        const neighborId = row ? row[r.gridX + vec.dx] : null;
        if (neighborId) revealed.add(neighborId);
      });
    });
    return revealed;
  }

  function renderMiniMap(floor, currentRoomId) {
    if (!minimapEl) return;
    minimapEl.innerHTML = '';
    if (!floor || !floor.roomGrid) return;

    const revealed = computeRevealed(floor);
    for (let y = 0; y < floor.roomGrid.length; y++) {
      const row = floor.roomGrid[y];
      for (let x = 0; x < row.length; x++) {
        const roomId = row[x];
        const cell = document.createElement('div');
        cell.className = 'hud-map-cell';

        if (roomId && revealed.has(roomId)) {
          const room = floor.rooms[roomId];
          cell.style.background = roomTypeColor(room.type);
          cell.title = roomTypeLabel(room.type) + (room.cleared ? ' (cleared)' : '');
          if (roomId === currentRoomId) cell.classList.add('hud-map-current');
          if (!room.visited) cell.classList.add('hud-map-unvisited');
        } else {
          cell.classList.add('hud-map-empty');
        }
        minimapEl.appendChild(cell);
      }
    }
  }

  function updateGoalLine(room) {
    if (!goalEl) return;
    if (!room) { goalEl.textContent = ''; return; }

    const T = window.Game.Constants.ROOM_TYPES;
    const aliveCount = (room.enemies || []).filter((e) => e.isAlive !== false).length;

    if (room.type === T.BOSS && !room.cleared) {
      goalEl.textContent = 'Defeat the boss to descend! (' + aliveCount + (aliveCount === 1 ? ' enemy left' : ' enemies left') + ')';
    } else if (!room.cleared && aliveCount > 0) {
      goalEl.textContent = 'Room locked — defeat ' + aliveCount + (aliveCount === 1 ? ' more enemy' : ' more enemies') + ' to open the doors';
    } else {
      goalEl.textContent = 'Room clear. Head for the red room on the map — that’s the boss.';
    }
  }

  Hud.init = function (containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    root = document.createElement('div');
    root.className = 'hud-panel';

    root.innerHTML =
      '<div class="hud-row hud-row-vitals">' +
        '<div class="hud-hp-bar"><div id="hud-hp-fill" class="hud-hp-fill"></div>' +
          '<span id="hud-hp-text" class="hud-hp-text">--/--</span></div>' +
        '<div id="hud-gold-text" class="hud-gold-text">0g</div>' +
        '<div id="hud-floor-text" class="hud-floor-text">Floor 1</div>' +
      '</div>' +
      '<div id="hud-goal-text" class="hud-goal-text"></div>' +
      '<div class="hud-row hud-row-label">Map</div>' +
      '<div id="hud-minimap" class="hud-minimap"></div>' +
      '<div class="hud-row hud-row-label">Passives</div>' +
      '<div id="hud-passives" class="hud-icon-row"></div>' +
      '<div class="hud-row hud-row-label">Consumables</div>' +
      '<div id="hud-consumables" class="hud-icon-row"></div>' +
      '<div class="hud-row hud-row-label">Status</div>' +
      '<div id="hud-status-effects" class="hud-icon-row"></div>';

    container.appendChild(root);

    hpFillEl = root.querySelector('#hud-hp-fill');
    hpTextEl = root.querySelector('#hud-hp-text');
    goldTextEl = root.querySelector('#hud-gold-text');
    floorTextEl = root.querySelector('#hud-floor-text');
    goalEl = root.querySelector('#hud-goal-text');
    minimapEl = root.querySelector('#hud-minimap');
    passivesEl = root.querySelector('#hud-passives');
    consumablesEl = root.querySelector('#hud-consumables');
    statusEl = root.querySelector('#hud-status-effects');
  };

  Hud.update = function (player, floorNumber, floor, room) {
    if (!root || !player) return;

    const hp = Math.max(0, player.hp);
    const maxHp = Math.max(1, player.maxHp);
    const pct = window.Game.Utils.clamp((hp / maxHp) * 100, 0, 100);
    hpFillEl.style.width = pct + '%';
    hpFillEl.classList.toggle('hud-hp-low', pct <= 25);
    hpTextEl.textContent = hp + '/' + maxHp;

    goldTextEl.textContent = (player.gold != null ? player.gold : 0) + 'g';
    floorTextEl.textContent = 'Floor ' + (floorNumber != null ? floorNumber : '?') + ' / ' + window.Game.Constants.TOTAL_FLOORS;

    updateGoalLine(room);
    renderMiniMap(floor, room && room.id);

    // Passives
    passivesEl.innerHTML = '';
    const passives = (player.inventory && player.inventory.passives) || [];
    passives.forEach((p) => {
      const icon = document.createElement('div');
      icon.className = 'hud-item-icon';
      icon.setAttribute('data-item-id', p.itemId);
      icon.title = lookupItemName(p.itemId) + (p.stackCount > 1 ? ' x' + p.stackCount : '');
      icon.textContent = lookupItemName(p.itemId).slice(0, 2).toUpperCase();
      if (p.stackCount > 1) {
        const badge = document.createElement('span');
        badge.className = 'hud-icon-badge';
        badge.textContent = p.stackCount;
        icon.appendChild(badge);
      }
      passivesEl.appendChild(icon);
    });

    // Consumables
    consumablesEl.innerHTML = '';
    const consumables = (player.inventory && player.inventory.consumables) || [];
    consumables.forEach((c, idx) => {
      const icon = document.createElement('div');
      icon.className = 'hud-item-icon hud-consumable-icon';
      icon.setAttribute('data-item-id', c.itemId);
      icon.setAttribute('data-slot-index', String(idx));
      icon.title = lookupConsumableName(c.itemId) + ' x' + c.quantity + ' (key ' + (idx + 1) + ')';
      icon.textContent = lookupConsumableName(c.itemId).slice(0, 2).toUpperCase();
      const badge = document.createElement('span');
      badge.className = 'hud-icon-badge';
      badge.textContent = c.quantity;
      icon.appendChild(badge);
      consumablesEl.appendChild(icon);
    });

    // Status effects
    statusEl.innerHTML = '';
    const effects = player.statusEffects || [];
    effects.forEach((fx) => {
      const badge = document.createElement('div');
      badge.className = 'hud-status-badge';
      badge.title = fx.type + ' (' + fx.turnsRemaining + ' turns, mag ' + fx.magnitude + ')';
      badge.textContent = fx.type + ' ' + fx.turnsRemaining;
      statusEl.appendChild(badge);
    });
  };
})();
