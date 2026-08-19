// Shared global namespace. Every other file attaches only to its pre-assigned
// slot here. No file may call across packages at load time -- only inside
// functions invoked later once every script has loaded.
window.Game = window.Game || {
  Constants: {},
  RNG: {},
  Utils: {},

  Data: {
    Items: { ITEM_DEFS: {} },
    Consumables: { CONSUMABLE_DEFS: {} },
    Enemies: { ENEMY_DEFS: {} },
    Bosses: { BOSS_DEFS: {} },
    Characters: { CHARACTER_DEFS: {} }
  },

  Systems: {
    Dungeon: {},
    Entities: {},
    Combat: {},
    AI: { behaviors: {} },
    Items: {},
    Save: {}
  },

  UI: {
    Renderer: {},
    Hud: {},
    MessageLog: {},
    Input: {},
    Screens: {}
  },

  // Mutable runtime state, owned by game.js
  State: {}
};
