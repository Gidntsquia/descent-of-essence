// js/systems/save.js
//
// localStorage persistence for the one thing that carries across runs: a
// small stat line ("best floor reached" etc.), shown on the main menu.
// There is no currency, no unlock economy -- every character is available
// from the start (see data/characters.js).
//
// PUBLIC API (Game.Systems.Save):
//   Save.getDefault() -> fresh save object (see shape below).
//   Save.load() -> reads+parses localStorage[Constants.SAVE_KEY]. Falls back
//     to getDefault() if missing, corrupt, or version-mismatched. No
//     migration path -- a version bump discards old saves. Documented, not
//     a bug.
//   Save.persist(saveData) -> writes to localStorage, try/catch'd so
//     private-browsing/quota failures can't crash the game. Returns
//     true/false for success.
//   Save.recordRunResult(saveData, runStats, victory)
//     -> runStats = {enemiesKilled, itemsCollected, goldEarned,
//        floorsCleared, turnsTaken}; victory = bool. Mutates saveData.stats
//        in place (also returns saveData).
//
// SAVE DATA SHAPE:
//   { version: Game.Constants.SAVE_VERSION,
//     stats: { totalRuns, bestFloorReached, totalKills, totalDeaths } }

(function () {
  const Save = window.Game.Systems.Save;

  function getConstants() {
    return window.Game.Constants || {};
  }

  Save.getDefault = function () {
    const C = getConstants();
    return {
      version: C.SAVE_VERSION,
      stats: {
        totalRuns: 0,
        bestFloorReached: 0,
        totalKills: 0,
        totalDeaths: 0
      }
    };
  };

  Save.load = function () {
    const C = getConstants();
    try {
      const raw = localStorage.getItem(C.SAVE_KEY);
      if (!raw) return Save.getDefault();
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.version !== C.SAVE_VERSION) return Save.getDefault();
      return parsed;
    } catch (e) {
      return Save.getDefault();
    }
  };

  Save.persist = function (saveData) {
    const C = getConstants();
    try {
      localStorage.setItem(C.SAVE_KEY, JSON.stringify(saveData));
      return true;
    } catch (e) {
      return false;
    }
  };

  Save.recordRunResult = function (saveData, runStats, victory) {
    const stats = runStats || {};
    const enemiesKilled = stats.enemiesKilled || 0;
    const floorsCleared = stats.floorsCleared || 0;
    const isVictory = !!victory;

    if (!saveData.stats) {
      saveData.stats = { totalRuns: 0, bestFloorReached: 0, totalKills: 0, totalDeaths: 0 };
    }
    saveData.stats.totalRuns = (saveData.stats.totalRuns || 0) + 1;
    saveData.stats.bestFloorReached = Math.max(saveData.stats.bestFloorReached || 0, floorsCleared);
    saveData.stats.totalKills = (saveData.stats.totalKills || 0) + enemiesKilled;
    saveData.stats.totalDeaths = (saveData.stats.totalDeaths || 0) + (isVictory ? 0 : 1);

    return saveData;
  };
})();
