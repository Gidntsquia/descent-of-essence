// js/main.js -- bootstrap. Waits for the DOM (screen containers, canvas,
// hud/message-log mounts) to exist, then hands off to Game.init() in
// game.js, which wires up every package and shows the main menu.
document.addEventListener('DOMContentLoaded', function () {
  window.Game.init();
});
