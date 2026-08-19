#!/usr/bin/env node
//
// test/balance-simulation.js -- systematic difficulty/balance simulation.
//
// Plays many full runs headlessly by driving the REAL game API (Game.startRun,
// Game.enterCurrentNode, Game.submitWord, ...) inside a single jsdom document,
// then reports per-floor win rates and per-monster kill rates so numeric
// outliers stand out (one monster killing far more runs than its floor peers).
//
// It deliberately does NOT reimplement the combat loop -- an independent
// reimplementation would measure the simulation's balance, not the game's.
// The page is loaded once and Game.startRun() is called per run, because
// parsing the 2.5MB wordlist takes ~3s and doing that per run would dominate
// the runtime.
//
// Two bot strategies bracket skilled vs. unskilled play:
//   best  -- exhaustive search, plays the highest-damage word available
//   first -- plays the first playable word it finds (any damage > 0)
//
// Usage: node test/balance-simulation.js [runsPerStrategy]   (default 15)
//
// LIMITATIONS (don't over-read the numbers):
//   - The bot never uses blank ('?') tiles, consumables, or the rack-reorder
//     UI, and always takes shop/treasure/event option ordering greedily.
//     So these win rates are a floor, not a ceiling, on human performance.
//   - jsdom has no Web Audio API; audio paths are inert here (already true of
//     npm test). Nothing in this script depends on them.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const RUNS_PER_STRATEGY = parseInt(process.argv[2], 10) || 15;
const STRATEGIES = ['best', 'first'];

// Safety caps so a stalled run (e.g. a trait the bot can never beat) ends as a
// recorded stall instead of hanging the whole simulation.
const MAX_WORDS_PER_COMBAT = 40;
const MAX_NODES_PER_RUN = 120;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- word finding ---------------------------------------------------------

// sorted-letters -> [words]. Built once. Lets us go from "which subset of the
// rack am I holding" straight to the words it can spell, instead of testing
// 200k words against the rack every turn.
function buildAnagramMap(wordlist, maxLen) {
  const map = new Map();
  for (const word of wordlist) {
    if (word.length < 2 || word.length > maxLen) continue;
    const key = word.split('').sort().join('');
    const bucket = map.get(key);
    if (bucket) bucket.push(word);
    else map.set(key, [word]);
  }
  return map;
}

// Every word the current rack can spell, with the damage it would actually
// deal -- predicted the same way Combat.playWord computes it, so the bot picks
// on real damage rather than raw score (traits can zero a high-scoring word).
function findPlayableWords(win, anagramMap, rack, monster, opts) {
  const { Lexicon, Traits, Tiles } = win.Wordbound;
  const usable = rack.filter((t) => t.letter !== '?');
  const n = usable.length;
  if (n < 2) return [];

  const hpRatio = monster.maxHp > 0 ? monster.hp / monster.maxHp : 0;
  const trait = Traits.TRAITS[Traits.activeTraitForHpRatio(monster.traitPhases, hpRatio)];

  const results = [];
  const seen = new Set();
  const stopAtFirst = opts && opts.stopAtFirstDamaging;

  for (let mask = 1; mask < 1 << n; mask++) {
    const subset = [];
    for (let i = 0; i < n; i++) if (mask & (1 << i)) subset.push(usable[i]);
    if (subset.length < 2) continue;

    const key = subset.map((t) => t.letter).sort().join('');
    const words = anagramMap.get(key);
    if (!words) continue;

    for (const word of words) {
      if (seen.has(word)) continue;
      seen.add(word);

      const formed = Lexicon.canFormFromRack(word, rack);
      if (!formed.possible) continue;

      const score = Lexicon.scoreWord(word, formed.tilesUsed);
      const usedIds = new Set(formed.tilesUsed.map((t) => t.id));
      let holdMult = 1;
      for (const tile of rack) {
        if (usedIds.has(tile.id)) continue;
        if (tile.bonus && tile.bonus.type === Tiles.BONUS_TYPES.MULT_ON_HOLD) holdMult *= tile.bonus.amount;
      }
      const traitMult = trait ? trait.multiplier(word, formed.tilesUsed) : 1;
      const damage = Math.round(score.total * holdMult * traitMult);

      results.push({ word, damage });
      if (stopAtFirst && damage > 0) return results;
    }
  }
  return results;
}

function chooseWord(candidates, strategy) {
  if (candidates.length === 0) return null;
  if (strategy === 'first') {
    const damaging = candidates.find((c) => c.damage > 0);
    return (damaging || candidates[0]).word;
  }
  let best = candidates[0];
  for (const c of candidates) if (c.damage > best.damage) best = c;
  return best.word;
}

// ---- run driver -----------------------------------------------------------

async function playRun(win, anagramMap, strategy, runIndex) {
  const Game = win.Wordbound.Game;
  const state = Game._state;

  // Rotate characters so no single loadout dominates the sample.
  const characters = Object.keys(win.Wordbound.Characters.CHARACTER_DEFS || { archivist: 1 });
  const characterId = characters[runIndex % characters.length];

  // Game.startRun does NOT clear state.combatActive/state.monster -- in the real
  // game that's unreachable (you only reach it from the main menu, after combat
  // has already ended), but this harness can abandon a run mid-combat, and the
  // stale flag would make every later run start "already fighting" the previous
  // monster with an empty rack. Reset it here rather than changing game code.
  state.combatActive = false;
  state.monster = null;

  Game.startRun(characterId);

  const run = {
    strategy,
    characterId,
    won: false,
    stalled: false,
    softlock: null,
    deathFloor: null,
    killedBy: null,
    killedByIsBoss: false,
    wordsPlayedInFatalFight: null,
    floorsCleared: 0,
    encounters: [],   // { defId, name, isBoss, floor, words, damageTaken, playerDied }
    bossReachStats: [], // { floor, gold, items } captured on entering each boss node
  };

  let nodeSteps = 0;

  while (nodeSteps++ < MAX_NODES_PER_RUN) {
    if (state.screen === 'GAME_OVER' || state.screen === 'VICTORY') break;

    if (state.screen === 'TILE_REWARD') {
      // Always take a reward -- skipping is strictly worse for a bot with no
      // deck-thinning strategy, and taking it is what a new player does.
      const opts = state.tileRewardOptions;
      if (opts && opts.length) Game.pickTileReward(opts[0].id);
      else Game.skipTileReward();
      continue;
    }

    if (state.screen === 'TREASURE') {
      const opts = state.treasureOptions;
      if (opts && opts.length) Game.pickTreasureItem(opts[0]);
      continue;
    }

    if (state.screen === 'SHOP') {
      // Buy anything affordable, once each. Game.buyItem does NOT reject an
      // already-owned permanent item (a real bug -- see PROGRESS.md), so
      // re-offering the same id would stack its hooks and wildly distort these
      // numbers. Track what we bought and skip repeats, which is what a player
      // who understands the items would do anyway.
      const boughtHere = new Set();
      for (const id of state.shopOptions || []) {
        if (boughtHere.has(id)) continue;
        const goldBefore = state.player.gold;
        Game.buyItem(id);
        if (state.player.gold < goldBefore) boughtHere.add(id);
      }
      Game.leaveShop();
      continue;
    }

    if (state.screen === 'EVENT') {
      Game.chooseEventOption(0);
      continue;
    }

    if (state.combatActive) {
      const monster = state.monster;
      const node = state.floor.nodes[state.currentNodeIndex];
      const isBoss = node && node.type === 'boss';
      const encounter = {
        defId: monster.defId,
        name: monster.name,
        isBoss,
        tier: monster.tier || (isBoss ? 'boss' : 'unknown'),
        floor: state.floorNumber,
        words: 0,
        damageTaken: 0,
        playerDied: false,
      };
      run.encounters.push(encounter);

      if (isBoss) {
        run.bossReachStats.push({
          floor: state.floorNumber,
          gold: state.player.gold,
          items: state.player.items.length,
        });
      }

      while (state.combatActive && encounter.words < MAX_WORDS_PER_COMBAT) {
        const candidates = findPlayableWords(win, anagramMap, state.player.rack, state.monster, {
          stopAtFirstDamaging: strategy === 'first',
        });
        const word = chooseWord(candidates, strategy);
        if (!word) {
          // The rack can spell NO valid word at all. There is no discard or
          // redraw action in combat (only "Play Word" and "Clear", which just
          // clears the text input), so a real player in this position is hard
          // softlocked -- they cannot act, and the rack only cycles when a word
          // is played. Recorded as its own outcome, not lumped in with stalls.
          run.softlock = {
            monster: state.monster.name,
            floor: state.floorNumber,
            rack: state.player.rack.map((t) => t.letter).join(''),
          };
          break;
        }

        const hpBefore = state.player.hp;
        Game.submitWord(word);
        encounter.words++;
        // submitWord defers rack cycling + counterattack by TILE_PLAY_ANIM_MS
        // (220ms in game.js) so the tile-play animation is visible. Wait past
        // that, or we'd read state mid-turn.
        await sleep(260);
        encounter.damageTaken += Math.max(0, hpBefore - state.player.hp);

        if (state.screen === 'GAME_OVER') {
          encounter.playerDied = true;
          run.killedBy = monster.name;
          run.killedByDefId = monster.defId;
          run.killedByIsBoss = isBoss;
          run.deathFloor = encounter.floor;
          run.wordsPlayedInFatalFight = encounter.words;
          break;
        }
      }

      if (state.combatActive) {
        // Hit the per-combat cap without resolving: record and abandon the run.
        run.stalled = true;
        run.deathFloor = state.floorNumber;
        break;
      }
      continue;
    }

    if (state.screen === 'RUN') {
      Game.enterCurrentNode();
      continue;
    }

    // Unknown screen -- bail rather than spin.
    run.stalled = true;
    break;
  }

  if (nodeSteps >= MAX_NODES_PER_RUN) run.stalled = true;
  run.won = state.screen === 'VICTORY';
  run.floorsCleared = run.won ? 3 : Math.max(0, (run.deathFloor || state.floorNumber) - 1);
  run.finalGold = state.player.gold;
  run.finalItems = state.player.items.length;
  return run;
}

// ---- reporting ------------------------------------------------------------

function analyze(runs) {
  const perMonster = new Map();
  const perFloor = { 1: { entered: 0, cleared: 0 }, 2: { entered: 0, cleared: 0 }, 3: { entered: 0, cleared: 0 } };
  const bossReach = { 1: [], 2: [], 3: [] };

  for (const run of runs) {
    const floorsEntered = new Set(run.encounters.map((e) => e.floor));
    for (const f of floorsEntered) {
      if (!perFloor[f]) continue;
      perFloor[f].entered++;
      if (run.won || (run.deathFloor && run.deathFloor > f)) perFloor[f].cleared++;
    }
    for (const b of run.bossReachStats) {
      if (bossReach[b.floor]) bossReach[b.floor].push(b);
    }
    for (const e of run.encounters) {
      const key = e.defId + '|' + e.floor;
      if (!perMonster.has(key)) {
        perMonster.set(key, {
          defId: e.defId, name: e.name, floor: e.floor, tier: e.tier,
          encounters: 0, kills: 0, totalWords: 0, totalDamageTaken: 0,
        });
      }
      const m = perMonster.get(key);
      m.encounters++;
      m.totalWords += e.words;
      m.totalDamageTaken += e.damageTaken;
      if (e.playerDied) m.kills++;
    }
  }

  const monsters = [...perMonster.values()].map((m) => ({
    ...m,
    killRate: m.encounters ? m.kills / m.encounters : 0,
    avgWords: m.encounters ? m.totalWords / m.encounters : 0,
    avgDamageTaken: m.encounters ? m.totalDamageTaken / m.encounters : 0,
  }));

  return { monsters, perFloor, bossReach };
}

function pct(x) { return (x * 100).toFixed(0) + '%'; }

function report(allRuns) {
  const lines = [];
  const say = (s) => { console.log(s); lines.push(s); };

  say('\n================ BALANCE SIMULATION ================');
  say(`Runs: ${allRuns.length} (${RUNS_PER_STRATEGY} per strategy)`);

  for (const strategy of STRATEGIES) {
    const runs = allRuns.filter((r) => r.strategy === strategy);
    const wins = runs.filter((r) => r.won).length;
    const stalls = runs.filter((r) => r.stalled).length;
    say(`\n--- strategy: ${strategy} (${runs.length} runs) ---`);
    const softlocks = runs.filter((r) => r.softlock);
    say(`  wins: ${wins}/${runs.length} (${pct(wins / runs.length)})   stalled: ${stalls}   softlocked: ${softlocks.length}`);
    if (softlocks.length) {
      say('  UNPLAYABLE-RACK SOFTLOCKS (no valid word formable, and combat has no discard action):');
      for (const r of softlocks) {
        say(`    ${r.characterId} floor ${r.softlock.floor} vs ${r.softlock.monster}: rack "${r.softlock.rack}"`);
      }
    }

    const { monsters, perFloor, bossReach } = analyze(runs);

    say('  floor clear rate (of runs that entered that floor):');
    for (const f of [1, 2, 3]) {
      const s = perFloor[f];
      say(`    floor ${f}: ${s.cleared}/${s.entered}` + (s.entered ? ` (${pct(s.cleared / s.entered)})` : ''));
    }

    say('  state on reaching each boss (avg):');
    for (const f of [1, 2, 3]) {
      const b = bossReach[f];
      if (!b.length) { say(`    floor ${f} boss: never reached`); continue; }
      const g = (b.reduce((s, x) => s + x.gold, 0) / b.length).toFixed(1);
      const i = (b.reduce((s, x) => s + x.items, 0) / b.length).toFixed(1);
      say(`    floor ${f} boss: reached ${b.length}x, avg ${g} gold, ${i} items`);
    }

    say('  per-monster (kills = runs ended by it / times encountered):');
    for (const f of [1, 2, 3]) {
      const onFloor = monsters.filter((m) => m.floor === f).sort((a, b) => b.killRate - a.killRate);
      if (!onFloor.length) continue;
      say(`    floor ${f}:`);
      for (const m of onFloor) {
        say(`      ${m.name.padEnd(28)} ${String(m.kills).padStart(2)}/${String(m.encounters).padStart(2)} kills (${pct(m.killRate).padStart(4)})` +
            `  avg ${m.avgWords.toFixed(1)} words, ${m.avgDamageTaken.toFixed(1)} dmg taken  [${m.tier}]`);
      }
    }

    // Outlier detection: a monster is flagged only against its OWN floor's
    // peers of the same kind (boss vs. non-boss). Floor-appropriate escalation
    // is intended, so cross-floor comparison would flag it as a false positive.
    say('  outliers vs. same-floor peers:');
    let flagged = 0;
    for (const f of [1, 2, 3]) {
      for (const boss of [false, true]) {
        const peers = monsters.filter((m) => m.floor === f && (m.tier === 'boss') === boss && m.encounters >= 3);
        if (peers.length < 2) continue;
        const meanDmg = peers.reduce((s, m) => s + m.avgDamageTaken, 0) / peers.length;
        for (const m of peers) {
          if (meanDmg > 0 && m.avgDamageTaken > meanDmg * 1.6) {
            say(`    HARD  floor ${f} ${m.name}: ${m.avgDamageTaken.toFixed(1)} dmg taken vs. ${meanDmg.toFixed(1)} floor avg`);
            flagged++;
          } else if (meanDmg > 0 && m.avgDamageTaken < meanDmg * 0.4) {
            say(`    EASY  floor ${f} ${m.name}: ${m.avgDamageTaken.toFixed(1)} dmg taken vs. ${meanDmg.toFixed(1)} floor avg`);
            flagged++;
          }
        }
      }
    }
    if (!flagged) say('    (none -- no monster is >1.6x or <0.4x its floor peers on damage dealt to the player)');
  }

  say('\n===================================================');
  return lines.join('\n');
}

// ---- main -----------------------------------------------------------------

async function main() {
  const htmlPath = path.join(__dirname, '..', 'wordbound.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const pageErrors = [];

  const dom = new JSDOM(html, {
    url: 'file://' + htmlPath,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
  });
  dom.window.addEventListener('error', (e) => {
    pageErrors.push((e.error && e.error.stack) || e.message);
  });

  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
  });
  await sleep(500);

  const win = dom.window;
  if (!(win.Wordbound && win.Wordbound.Game)) {
    console.error('Game did not initialize. Page errors:');
    pageErrors.forEach((e) => console.error('  ' + e));
    process.exit(1);
  }

  // Achievement unlocks persist in localStorage and would change the item pool
  // partway through the sample. Reset once so every run sees the same pool.
  // (Achievements.reset() touches localStorage unguarded, unlike save/loadProgress
  // -- under jsdom's file:// opaque origin that throws. Not fatal here.)
  try {
    if (win.Wordbound.Achievements && win.Wordbound.Achievements.reset) {
      win.Wordbound.Achievements.reset();
    }
  } catch (e) {
    console.log('  (achievement reset skipped: ' + e.message + ')');
  }

  const maxLen = 9; // rack capacity ceiling with items; longer words are unplayable
  console.log(`Building anagram index over ${win.Wordbound.WORDLIST.length} words...`);
  const anagramMap = buildAnagramMap(win.Wordbound.WORDLIST, maxLen);
  console.log(`  ${anagramMap.size} letter-multiset keys indexed.`);

  const allRuns = [];
  for (const strategy of STRATEGIES) {
    for (let i = 0; i < RUNS_PER_STRATEGY; i++) {
      const run = await playRun(win, anagramMap, strategy, i);
      allRuns.push(run);
      const outcome = run.won ? 'WON'
        : run.softlock ? `SOFTLOCK F${run.softlock.floor} vs ${run.softlock.monster} (unplayable rack "${run.softlock.rack}")`
        : run.stalled ? 'STALL'
        : `died F${run.deathFloor} to ${run.killedBy}`;
      console.log(`  [${strategy}] run ${i + 1}/${RUNS_PER_STRATEGY} (${run.characterId}): ${outcome}`);
    }
  }

  const text = report(allRuns);

  if (pageErrors.length) {
    console.log(`\n!! ${pageErrors.length} uncaught page error(s) during simulation:`);
    pageErrors.slice(0, 5).forEach((e) => console.log('  ERR: ' + e));
  } else {
    console.log('\nZero uncaught page errors across all runs.');
  }

  fs.writeFileSync(
    path.join(__dirname, 'balance-simulation-results.json'),
    JSON.stringify({ runsPerStrategy: RUNS_PER_STRATEGY, runs: allRuns, report: text, pageErrors }, null, 2)
  );
  console.log('Full results: test/balance-simulation-results.json');
  process.exit(0);
}

main().catch((e) => { console.error('SCRIPT CRASHED:', e); process.exit(1); });
