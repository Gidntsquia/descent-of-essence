// js/ui/renderer.js
// Package D (UI). Attaches only to Game.UI.Renderer.
//
// Public API:
//   Renderer.init(canvasElementId)       -- grab canvas + 2d context. Call once.
//   Renderer.drawRoom(room, player)      -- clear + draw tiles, enemies, items, player.
//   Renderer.showTelegraph(text)         -- show a small overlay warning line (e.g. boss tell).
//   Renderer.clearTelegraph()            -- hide it.
//
// Room shape expected: { layout: rows[y][x] = Constants.TILE_TYPES value,
//   doors: {north,south,east,west} (bool-ish, truthy = door exists in that wall),
//   cleared: bool, enemies: [EnemyInstance], items: [{itemId,x,y}] }.
// `layout` is read defensively as a 2D array of rows (layout[y][x]); if a flat
// array shows up instead this falls back to index y*W+x automatically.
//
// Telegraph implementation note: a DOM overlay `<div id="renderer-telegraph">`
// is created lazily and absolutely positioned over the canvas's parent
// (which must be position:relative -- #screen-run's canvas wrapper is styled
// that way in style.css), NOT drawn on the canvas itself, so it never gets
// wiped by the next drawRoom() clear.

(function () {
  const R = window.Game.UI.Renderer;

  let canvas = null;
  let ctx = null;
  let telegraphEl = null;

  function getTile(room, x, y) {
    if (!room || !room.layout) return null;
    const layout = room.layout;
    if (Array.isArray(layout[y])) {
      return layout[y][x];
    }
    // Flat array fallback: index = y * width + x
    const C = window.Game.Constants;
    const w = C.ROOM_TILE_W;
    return layout[y * w + x];
  }

  function tileColor(tileType, doorLocked) {
    const C = window.Game.Constants;
    if (tileType === C.TILE_TYPES.WALL) return '#151320'; // dark/solid, close to canvas bg
    if (tileType === C.TILE_TYPES.DOOR) return doorLocked ? '#5a3040' : '#4e8f6b';
    return '#3d3958'; // floor -- clearly lighter than the wall fill above
  }

  function lookupEnemyDef(defId) {
    try {
      const defs = window.Game.Data.Enemies.ENEMY_DEFS;
      if (defs && defs[defId]) return defs[defId];
    } catch (e) { /* not ready */ }
    return null;
  }

  R.init = function (canvasElementId) {
    canvas = document.getElementById(canvasElementId);
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    const C = window.Game.Constants;
    canvas.width = C.ROOM_TILE_W * C.TILE_SIZE;
    canvas.height = C.ROOM_TILE_H * C.TILE_SIZE;
  };

  R.drawRoom = function (room, player) {
    if (!ctx || !canvas) return;
    const C = window.Game.Constants;
    const TS = C.TILE_SIZE;
    const W = C.ROOM_TILE_W;
    const H = C.ROOM_TILE_H;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!room) return;

    // Whether the room's doors should render as "locked" (uncleared combat-ish room).
    const doorLocked = room.cleared === false;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const t = getTile(room, x, y) || C.TILE_TYPES.FLOOR;
        ctx.fillStyle = tileColor(t, doorLocked);
        ctx.fillRect(x * TS, y * TS, TS, TS);
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.strokeRect(x * TS + 0.5, y * TS + 0.5, TS - 1, TS - 1);
      }
    }

    // Items
    (room.items || []).forEach((it) => {
      const cx = it.x * TS + TS / 2;
      const cy = it.y * TS + TS / 2;
      ctx.fillStyle = '#f2c14e';
      ctx.beginPath();
      ctx.arc(cx, cy, TS * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8a6a10';
      ctx.stroke();
    });

    // Enemies
    (room.enemies || []).forEach((en) => {
      if (en.isAlive === false) return;
      const def = lookupEnemyDef(en.defId);
      const color = (def && def.color) || '#c05050';
      const glyph = (def && def.glyph) || 'e';
      const cx = en.x * TS + TS / 2;
      const cy = en.y * TS + TS / 2;

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, TS * 0.32, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + Math.floor(TS * 0.4) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(glyph).slice(0, 1).toUpperCase(), cx, cy);

      // small HP bar above enemy
      if (en.maxHp) {
        const pct = Math.max(0, Math.min(1, en.hp / en.maxHp));
        const barW = TS * 0.7;
        const barX = cx - barW / 2;
        const barY = en.y * TS + 4;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(barX, barY, barW, 4);
        ctx.fillStyle = '#e0455f';
        ctx.fillRect(barX, barY, barW * pct, 4);
      }
    });

    // Player
    if (player) {
      const cx = player.x * TS + TS / 2;
      const cy = player.y * TS + TS / 2;
      ctx.fillStyle = '#7c5cff';
      ctx.beginPath();
      ctx.arc(cx, cy, TS * 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold ' + Math.floor(TS * 0.45) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('@', cx, cy);
    }
  };

  R.showTelegraph = function (text) {
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    if (!telegraphEl) {
      telegraphEl = document.createElement('div');
      telegraphEl.id = 'renderer-telegraph';
      telegraphEl.className = 'renderer-telegraph';
      parent.appendChild(telegraphEl);
    }
    telegraphEl.textContent = text;
    telegraphEl.classList.remove('hidden');
  };

  R.clearTelegraph = function () {
    if (telegraphEl) {
      telegraphEl.classList.add('hidden');
    }
  };
})();
