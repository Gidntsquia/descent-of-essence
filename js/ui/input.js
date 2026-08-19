// js/ui/input.js
// Package D (UI). Attaches only to Game.UI.Input.
//
// Public API:
//   Input.init(callback)     -- attach a single document keydown listener.
//                                callback(actionObject) fires for every
//                                recognized key, regardless of game state
//                                (the orchestrator decides whether to act on it).
//   Input.setEnabled(bool)   -- optional convenience to short-circuit the
//                                listener entirely (default true). The primary
//                                gating mechanism is expected to be state
//                                checks inside the orchestrator's callback,
//                                not this flag.
//
// Key mapping -> action object:
//   ArrowUp / w / W          -> { type: 'move', direction: 'north' }
//   ArrowDown / s / S        -> { type: 'move', direction: 'south' }
//   ArrowLeft / a / A        -> { type: 'move', direction: 'west' }
//   ArrowRight / d / D       -> { type: 'move', direction: 'east' }
//   Space / Enter            -> { type: 'wait' }
//   Digit1-Digit9            -> { type: 'useConsumable', slotIndex: <digit-1> }
//
// NOTE on useConsumable: Constants.js's comment documents the action shape as
// `{type:'useConsumable', itemId}`, but at keydown time this module has no
// reliable knowledge of the player's current consumable ordering (that lives
// in Package B/game.js state). Per the Package D spec we emit `slotIndex`
// (0-based) instead; the orchestrator must resolve
// `player.inventory.consumables[slotIndex]` to get the itemId before calling
// into Systems.Items/Combat. This is a deliberate, documented deviation --
// flagged here for the orchestrator wiring js/game.js.
//
// For every recognized key: callback(actionObject) is invoked AND
// event.preventDefault() is called (stops page scroll on arrows/space).
// Unrecognized keys are ignored entirely (no preventDefault, no callback).

(function () {
  const Input = window.Game.UI.Input;

  let enabled = true;
  let userCallback = null;
  let listenerAttached = false;

  const KEY_TO_ACTION = {
    ArrowUp: () => ({ type: 'move', direction: 'north' }),
    KeyW: () => ({ type: 'move', direction: 'north' }),
    ArrowDown: () => ({ type: 'move', direction: 'south' }),
    KeyS: () => ({ type: 'move', direction: 'south' }),
    ArrowLeft: () => ({ type: 'move', direction: 'west' }),
    KeyA: () => ({ type: 'move', direction: 'west' }),
    ArrowRight: () => ({ type: 'move', direction: 'east' }),
    KeyD: () => ({ type: 'move', direction: 'east' }),
    Space: () => ({ type: 'wait' }),
    Enter: () => ({ type: 'wait' })
  };

  function resolveAction(event) {
    // Prefer event.code for layout independence; fall back to event.key for
    // environments/tests where `code` may be absent (e.g. synthetic events).
    const byCode = KEY_TO_ACTION[event.code];
    if (byCode) return byCode();

    const key = event.key;
    if (key === 'ArrowUp' || key === 'w' || key === 'W') return { type: 'move', direction: 'north' };
    if (key === 'ArrowDown' || key === 's' || key === 'S') return { type: 'move', direction: 'south' };
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') return { type: 'move', direction: 'west' };
    if (key === 'ArrowRight' || key === 'd' || key === 'D') return { type: 'move', direction: 'east' };
    if (key === ' ' || key === 'Spacebar' || key === 'Enter') return { type: 'wait' };

    // Digit1-Digit9 by code, or '1'-'9' by key.
    const codeMatch = /^Digit([1-9])$/.exec(event.code || '');
    if (codeMatch) return { type: 'useConsumable', slotIndex: parseInt(codeMatch[1], 10) - 1 };
    if (/^[1-9]$/.test(key)) return { type: 'useConsumable', slotIndex: parseInt(key, 10) - 1 };

    return null;
  }

  function onKeydown(event) {
    if (!enabled) return;
    const action = resolveAction(event);
    if (!action) return;

    event.preventDefault();
    if (typeof userCallback === 'function') {
      userCallback(action);
    }
  }

  Input.init = function (callback) {
    userCallback = callback;
    if (!listenerAttached) {
      document.addEventListener('keydown', onKeydown);
      listenerAttached = true;
    }
  };

  Input.setEnabled = function (isEnabled) {
    enabled = !!isEnabled;
  };
})();
