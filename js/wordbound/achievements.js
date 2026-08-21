// js/wordbound/achievements.js
// Cross-run achievement tracking and unlockable items system.
//
// PUBLIC API (window.Wordbound.Achievements):
//   ACHIEVEMENTS - object with achievement definitions
//   UNLOCKABLE_ITEMS - object with items unlocked by achievements
//   unlock(achievementId) - mark achievement as unlocked
//   isUnlocked(achievementId) - check if achievement is unlocked
//   trackDamage(damage) - track max damage dealt in current run
//   trackItemsCollected(count) - track items collected in current run
//   trackBossDefeatedWithoutDamage(bossId) - track boss beaten undamaged
//   saveProgress() - persist to localStorage
//   loadProgress() - load from localStorage
//   getUnlockedItems() - return array of unlocked item ids
//   reset() - clear all achievements (for testing)

(function () {
  window.Wordbound = window.Wordbound || {};
  var Achievements = (window.Wordbound.Achievements = {});

  var STORAGE_KEY = 'wordbound_achievements_v1';

  // Achievement definitions: what needs to be done to unlock them
  var ACHIEVEMENTS = {
    clear_a_run: {
      id: 'clear_a_run',
      name: 'Victory',
      description: 'Escape the Stacks alive. Three floors of mayhem, and you made it.',
      unlocksItem: 'unwritten_page'
    },
    boss_without_damage: {
      id: 'boss_without_damage',
      name: 'Untouched',
      description: 'Dance with a boss and slip away unscathed.',
      unlocksItem: 'inscribed_ledger'
    },
    high_damage_word: {
      id: 'high_damage_word',
      name: 'Devastating',
      description: 'One word. Fifty damage. A strike they won\'t forget.',
      unlocksItem: 'bookmark_of_reckoning'
    },
    collect_many_items: {
      id: 'collect_many_items',
      name: 'Collector',
      description: 'Fill your hands with five treasures before the final page.',
      unlocksItem: 'keepers_seal'
    },
    massive_overkill: {
      id: 'massive_overkill',
      name: 'Overkill',
      description: 'Crush them with twenty more points than needed. Because why not.',
      unlocksItem: 'gilded_margin'
    }
  };

  // Unlockable items: special items unlocked by achievements
  var UNLOCKABLE_ITEMS = {
    unwritten_page: {
      id: 'unwritten_page',
      name: 'Unwritten Page',
      hint: 'A blank sheet—one extra word waiting to be written.',
      rarity: 'rare',
      shopPrice: 0, // not purchasable, achievement-only
      isUnlockable: true,
      hooks: {
        onRunStart: function (ctx) {
          ctx.player.bonusTilesToDraw = (ctx.player.bonusTilesToDraw || 0) + 1;
        }
      }
    },
    inscribed_ledger: {
      id: 'inscribed_ledger',
      name: 'Inscribed Ledger',
      hint: 'Each victory recorded in its pages mends you, one line at a time.',
      rarity: 'rare',
      shopPrice: 0,
      isUnlockable: true,
      hooks: {
        onMonsterDefeated: function (ctx) {
          ctx.player.ink = Math.min(ctx.player.ink + 1, ctx.player.maxInk);
        }
      }
    },
    bookmark_of_reckoning: {
      id: 'bookmark_of_reckoning',
      name: 'Bookmark of Reckoning',
      hint: 'Marks its place in your enemies\' stories—and they pay the price.',
      rarity: 'rare',
      shopPrice: 0,
      isUnlockable: true,
      hooks: {
        onWordPlayed: function (ctx) {
          var bonusCount = ctx.tilesUsed.filter(function (t) { return t.bonus; }).length;
          if (bonusCount > 0) {
            ctx.player.lastRunBonusDamage = (ctx.player.lastRunBonusDamage || 0) + (bonusCount * 5);
          }
        }
      }
    },
    keepers_seal: {
      id: 'keepers_seal',
      name: "Keeper's Seal",
      hint: 'A curator\'s blessing—each treasure mends what was broken.',
      rarity: 'rare',
      shopPrice: 0,
      isUnlockable: true
    },
    gilded_margin: {
      id: 'gilded_margin',
      name: 'Gilded Margin',
      hint: 'Adorned with gold leaf—beauty has value, and so do your victories.',
      rarity: 'rare',
      shopPrice: 0,
      isUnlockable: true
    }
  };

  // In-memory state for current run
  var currentRunState = {
    maxDamageDealt: 0,
    itemsCollected: 0,
    bossesDefeatedUndamaged: {},
    maxOverkillDealt: 0
  };

  // Persistent state (loaded from localStorage)
  var unlockedAchievements = {};

  // Load achievements from localStorage on module init
  function loadProgress() {
    try {
      if (typeof localStorage === 'undefined') return;
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        unlockedAchievements = JSON.parse(stored);
      }
    } catch (e) {
      // localStorage unavailable (jsdom, private browsing, etc.)
    }
  }

  // Save achievements to localStorage
  function saveProgress() {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(unlockedAchievements));
    } catch (e) {
      // localStorage unavailable (jsdom, private browsing, etc.)
    }
  }

  function unlock(achievementId) {
    if (!ACHIEVEMENTS[achievementId]) return;
    if (!unlockedAchievements[achievementId]) {
      unlockedAchievements[achievementId] = true;
      saveProgress();
    }
  }

  function isUnlocked(achievementId) {
    return !!unlockedAchievements[achievementId];
  }

  function trackDamage(damage) {
    currentRunState.maxDamageDealt = Math.max(currentRunState.maxDamageDealt, damage);
    if (currentRunState.maxDamageDealt >= 50) {
      unlock('high_damage_word');
    }
  }

  function trackItemsCollected(count) {
    currentRunState.itemsCollected = count;
    if (currentRunState.itemsCollected >= 5) {
      unlock('collect_many_items');
    }
  }

  function trackBossDefeatedWithoutDamage(bossId, tookDamage) {
    if (!tookDamage) {
      currentRunState.bossesDefeatedUndamaged[bossId] = true;
      unlock('boss_without_damage');
    }
  }

  function trackOverkill(overkill) {
    currentRunState.maxOverkillDealt = Math.max(currentRunState.maxOverkillDealt, overkill);
    if (currentRunState.maxOverkillDealt >= 20) {
      unlock('massive_overkill');
    }
  }

  function trackRunCompletion() {
    unlock('clear_a_run');
  }

  function resetRunState() {
    currentRunState = {
      maxDamageDealt: 0,
      itemsCollected: 0,
      bossesDefeatedUndamaged: {},
      maxOverkillDealt: 0
    };
  }

  function getUnlockedItems() {
    return Object.keys(ACHIEVEMENTS).map(function (achId) {
      var ach = ACHIEVEMENTS[achId];
      if (isUnlocked(achId) && ach.unlocksItem) {
        return ach.unlocksItem;
      }
      return null;
    }).filter(Boolean);
  }

  function reset() {
    unlockedAchievements = {};
    resetRunState();
    localStorage.removeItem(STORAGE_KEY);
  }

  // Public API
  Achievements.ACHIEVEMENTS = ACHIEVEMENTS;
  Achievements.UNLOCKABLE_ITEMS = UNLOCKABLE_ITEMS;
  Achievements.unlock = unlock;
  Achievements.isUnlocked = isUnlocked;
  Achievements.trackDamage = trackDamage;
  Achievements.trackItemsCollected = trackItemsCollected;
  Achievements.trackBossDefeatedWithoutDamage = trackBossDefeatedWithoutDamage;
  Achievements.trackOverkill = trackOverkill;
  Achievements.trackRunCompletion = trackRunCompletion;
  Achievements.resetRunState = resetRunState;
  Achievements.saveProgress = saveProgress;
  Achievements.loadProgress = loadProgress;
  Achievements.getUnlockedItems = getUnlockedItems;
  Achievements.reset = reset;
  Achievements.getUnlockedAchievements = function () { return Object.keys(unlockedAchievements); };

  // Load on init
  loadProgress();
})();
