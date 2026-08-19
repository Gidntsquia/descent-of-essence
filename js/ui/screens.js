// js/ui/screens.js
// Attaches only to Game.UI.Screens.
//
// Public API:
//   Screens.show(stateName)
//     Hides every top-level screen container, then shows the one appropriate
//     for stateName (a Game.Constants.GAME_STATES value):
//       MAIN_MENU        -> #screen-main-menu
//       CHARACTER_SELECT -> #screen-character-select
//       RUN_EXPLORE      -> #screen-run
//       GAME_OVER        -> #screen-game-over
//       VICTORY          -> #screen-victory
//       BOOT / anything else -> everything hidden
//     Visibility convention: a `.hidden` class (display:none, see style.css)
//     is added/removed on the top-level screen containers.
//
//   Screens.renderMainMenu(saveData)
//   Screens.renderCharacterSelect(characterDefs, saveData)
//   Screens.renderGameOver(player)
//   Screens.renderVictory(player)
//     Each rebuilds the relevant container's inner DOM from the given data.
//     Safe to call repeatedly (idempotent full rebuild via innerHTML).
//     `characterDefs` accepted as either an object map ({id: def}) or an
//     array of defs; normalized internally.
//
//   Screens.onAction(callback)
//     Registers ONE delegated click listener on #game-root (call once, from
//     game.js, after DOM is ready). Any click landing on a descendant with a
//     `data-action` attribute invokes callback({action, ...otherDataAttrs})
//     where otherDataAttrs are the element's remaining data-* attributes
//     camelCased by the DOM (e.g. data-item-id -> itemId).
//
// === data-action catalog (element -> action -> payload keys) ===
//   #btn-new-run                -> "new-run"           {}
//   #btn-select-character-<id>  -> "select-character"   {characterId}
//       (clicking Select immediately confirms AND starts the run)
//   #btn-continue-gameover -> "continue-gameover" {}
//   #btn-continue-victory  -> "continue-victory"  {}

(function () {
  const Screens = window.Game.UI.Screens;

  const TOP_LEVEL_SCREEN_IDS = [
    'screen-main-menu',
    'screen-character-select',
    'screen-run',
    'screen-game-over',
    'screen-victory'
  ];

  // ---- small local helpers -------------------------------------------

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Accepts either an object map ({id: def}) or an array of defs; always
  // returns an array of defs, each guaranteed to carry an `.id`.
  function normalizeList(defsLike) {
    if (!defsLike) return [];
    if (Array.isArray(defsLike)) return defsLike;
    return Object.keys(defsLike).map((k) => {
      const d = defsLike[k] || {};
      return d.id ? d : Object.assign({ id: k }, d);
    });
  }

  function renderRunStatsInto(containerId, player) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const rs = (player && player.runStats) || {};
    el.innerHTML =
      '<div class="stat-line"><span>Enemies Killed</span><span>' + (rs.enemiesKilled || 0) + '</span></div>' +
      '<div class="stat-line"><span>Items Collected</span><span>' + (rs.itemsCollected || 0) + '</span></div>' +
      '<div class="stat-line"><span>Gold Found</span><span>' + (rs.goldEarned || 0) + '</span></div>' +
      '<div class="stat-line"><span>Floors Cleared</span><span>' + (rs.floorsCleared || 0) + '</span></div>' +
      '<div class="stat-line"><span>Turns Taken</span><span>' + (rs.turnsTaken || 0) + '</span></div>';
  }

  // ---- Screens.show -----------------------------------------------------

  Screens.show = function (stateName) {
    TOP_LEVEL_SCREEN_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    const GS = window.Game.Constants.GAME_STATES;
    let idToShow = null;

    switch (stateName) {
      case GS.MAIN_MENU: idToShow = 'screen-main-menu'; break;
      case GS.CHARACTER_SELECT: idToShow = 'screen-character-select'; break;
      case GS.RUN_EXPLORE: idToShow = 'screen-run'; break;
      case GS.GAME_OVER: idToShow = 'screen-game-over'; break;
      case GS.VICTORY: idToShow = 'screen-victory'; break;
      default: break; // BOOT or unrecognized -> everything stays hidden
    }

    if (idToShow) {
      const el = document.getElementById(idToShow);
      if (el) el.classList.remove('hidden');
    }
  };

  // ---- render functions ---------------------------------------------

  Screens.renderMainMenu = function (saveData) {
    const bestFloorEl = document.getElementById('main-menu-best-floor');
    if (bestFloorEl) {
      const best = (saveData && saveData.stats && saveData.stats.bestFloorReached) || 0;
      bestFloorEl.textContent = 'Best floor reached: ' + best;
    }
  };

  Screens.renderCharacterSelect = function (characterDefs) {
    const listEl = document.getElementById('character-select-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const defs = normalizeList(characterDefs);
    if (defs.length === 0) {
      listEl.innerHTML = '<div class="empty-hint">No characters available yet.</div>';
      return;
    }

    defs.forEach((def) => {
      const id = def.id;
      const card = document.createElement('div');
      card.className = 'character-card';
      card.innerHTML =
        '<div class="character-card-name">' + escapeHtml(def.name || id) + '</div>' +
        '<div class="character-card-desc">' + escapeHtml(def.description || '') + '</div>';

      const btn = document.createElement('button');
      btn.className = 'btn btn-primary';
      btn.id = 'btn-select-character-' + id;
      btn.setAttribute('data-action', 'select-character');
      btn.setAttribute('data-character-id', id);
      btn.textContent = 'Select';
      card.appendChild(btn);

      listEl.appendChild(card);
    });
  };

  Screens.renderGameOver = function (player) {
    renderRunStatsInto('game-over-stats', player);
  };

  Screens.renderVictory = function (player) {
    renderRunStatsInto('victory-stats', player);
  };

  // ---- delegated action wiring ---------------------------------------

  let actionCallback = null;
  let delegatedListenerAttached = false;

  Screens.onAction = function (callback) {
    actionCallback = callback;
    if (delegatedListenerAttached) return;

    const root = document.getElementById('game-root');
    if (!root) return;

    root.addEventListener('click', function (event) {
      const el = event.target.closest('[data-action]');
      if (!el || !root.contains(el)) return;
      if (typeof actionCallback !== 'function') return;

      const payload = {};
      for (const key in el.dataset) {
        if (Object.prototype.hasOwnProperty.call(el.dataset, key)) {
          payload[key] = el.dataset[key];
        }
      }
      actionCallback(payload);
    });

    delegatedListenerAttached = true;
  };
})();
