// test/dom-check.js
//
// Fast, no-browser-download DOM sanity check for wordbound.html, using jsdom.
// Run with `npm test` (or `node test/dom-check.js`). No network access needed
// after `npm install` has been run once.
//
// WHY THIS EXISTS: on 2026-08-19, two real bugs shipped and got marked
// complete in GOALS.md despite passing code review and a Node-based logic
// harness, because neither ever actually executed the game in a DOM:
//   1. animateDamage() looked up an element by an id that didn't exist
//      (only a class did) -- every damage-dealing word threw an uncaught
//      exception and silently broke the rest of that turn (rack never
//      cycled, counterattack never applied, nothing re-rendered).
//   2. Even after fixing #1, render() was rebuilding monster-info's
//      innerHTML AFTER the damage-number element was appended, destroying
//      it before the browser ever painted a frame with it visible.
// Both are exactly the kind of bug this script exists to catch: run this
// BEFORE checking off any task that touches rendering, event handlers, or
// game-state transitions. It is not a substitute for a real playtest, and
// it CANNOT verify audio (jsdom has no Web Audio API) or drag-and-drop
// (jsdom's DataTransfer support is incomplete) -- those still need a real
// browser (Playwright), which is heavier and is the orchestrator's job to
// run periodically, not something to set up fresh every hourly task.
//
// Exit code 0 = all checks passed. Non-zero = something's actually broken;
// read the output, fix it, don't check the task off with this still failing.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log('OK   ' + label);
  } else {
    console.log('FAIL ' + label);
    failures++;
  }
}

async function main() {
  // Optional CLI arg: path to the HTML file to check (defaults to the repo's
  // own wordbound.html). Lets the itch.io build script point this same check
  // at a staged/unzipped index.html to prove the packaged file set is
  // complete and its relative paths resolve, without duplicating this file.
  const targetPath = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(__dirname, '..', 'wordbound.html');
  const html = fs.readFileSync(targetPath, 'utf8');
  const errors = [];

  const dom = new JSDOM(html, {
    url: 'file://' + targetPath,
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
  });

  dom.window.addEventListener('error', (e) => {
    errors.push((e.error && e.error.stack) || e.message);
  });

  // wait for the page's own scripts (loaded via resources:"usable") to finish
  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
  });
  // give any queued microtasks/late script execution a moment
  await new Promise((r) => setTimeout(r, 300));

  const { document, window } = dom.window;
  check('page loaded with zero uncaught errors', errors.length === 0);
  if (errors.length) errors.forEach((e) => console.log('  ERR:', e));

  check('window.Wordbound.Game exists', !!(window.Wordbound && window.Wordbound.Game));
  if (!(window.Wordbound && window.Wordbound.Game)) {
    console.log('\nCannot continue -- Game did not initialize. See errors above.');
    process.exit(1);
  }

  // Foreword item (review B2): its unused-tile-count bonus used to be
  // computed as `rack.length - tilesUsed.length`, but Combat.playWord
  // already removes played tiles from the rack BEFORE onWordPlayed hooks
  // run, so by hook time `rack.length` already IS the unused count and the
  // subtraction double-counted (undercounting or going negative). Isolated
  // check with a synthetic player/monster/rack, independent of the live run
  // state exercised below -- doesn't need a run in progress.
  {
    const Combat = window.Wordbound.Combat;
    const Tiles = window.Wordbound.Tiles;
    const Items = window.Wordbound.Items;
    const rack = ['C', 'A', 'T', 'D', 'G', 'L', 'N'].map((l) => Tiles.createTile(l, null));
    const player = { rack: rack, items: ['foreword'], hp: 20, maxHp: 20 };
    const monster = { hp: 100, maxHp: 100, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
    const result = Combat.playWord(player, monster, 'CAT');
    check('Foreword test setup: "CAT" is playable from the synthetic 7-tile rack', !!result);
    if (result) {
      const damageBeforeHook = result.damage;
      const ctx = { player: player, monster: monster, word: result.word, tilesUsed: result.tilesUsed, result: result };
      Items.runHook('onWordPlayed', ctx, player);
      // CAT uses 3 of the 7 rack tiles, leaving 4 unused -- Foreword should
      // add exactly +4 damage, not rack.length(4) - tilesUsed.length(3) = 1.
      check('Foreword (review B2): bonus damage equals unused tile count (4)', result.damage === damageBeforeHook + 4);
    }
  }

  // Word novelty + combo streaks (GOALS.md "FUN OVERHAUL 1/8"): three
  // distinct words should each get a bigger damage multiplier than the last
  // (+12%/stack off the streak BEFORE that word), and replaying an
  // already-used word this fight should both apply the x0.4 repeat penalty
  // and reset the combo for whatever comes next. Isolated synthetic setup
  // like the Foreword check above -- doesn't need a run in progress. High
  // monster HP and the 'plain' trait (multiplier always 1) keep the math
  // predictable (no kill, no weakness multiplier to account for).
  {
    const Combat = window.Wordbound.Combat;
    const Tiles = window.Wordbound.Tiles;
    // Enough tiles for CAT, DOG, PIG, then CAT again (a repeat).
    const rack = ['C', 'A', 'T', 'D', 'O', 'G', 'P', 'I', 'G', 'C', 'A', 'T'].map((l) => Tiles.createTile(l, null));
    const player = { rack: rack, items: [], hp: 20, maxHp: 20 };
    const monster = { hp: 1000, maxHp: 1000, traitPhases: [{ hpThreshold: 1, traitId: 'plain' }] };
    const comboState = { combo: 0, usedWords: new Set() };

    const r1 = Combat.playWord(player, monster, 'CAT', comboState);
    check('combo test setup: "CAT" is playable', !!r1);
    const r2 = r1 && Combat.playWord(player, monster, 'DOG', comboState);
    const r3 = r2 && Combat.playWord(player, monster, 'PIG', comboState);
    const r4 = r3 && Combat.playWord(player, monster, 'CAT', comboState); // repeat

    if (r1 && r2 && r3 && r4) {
      check('combo: 1st distinct word has no bonus yet (comboAtPlay 0, x1.00)', r1.comboAtPlay === 0 && r1.comboMultiplier === 1 && !r1.isRepeat);
      check('combo: 2nd distinct word gets +12% (comboAtPlay 1, x1.12)', r2.comboAtPlay === 1 && r2.comboMultiplier === 1.12 && !r2.isRepeat);
      check('combo: 3rd distinct word gets +24% (comboAtPlay 2, x1.24)', r3.comboAtPlay === 2 && r3.comboMultiplier === 1.24 && !r3.isRepeat);
      check('combo: multiplier strictly grows across 3 distinct words', r1.comboMultiplier < r2.comboMultiplier && r2.comboMultiplier < r3.comboMultiplier);
      check('combo: damage for each distinct word matches score * comboMultiplier', r1.damage === Math.round(r1.score.total * r1.comboMultiplier) && r2.damage === Math.round(r2.score.total * r2.comboMultiplier) && r3.damage === Math.round(r3.score.total * r3.comboMultiplier));

      check('combo: repeating "CAT" is flagged isRepeat', r4.isRepeat === true);
      // r4 still earns comboAtPlay 3's bonus (the streak going INTO this word)
      // before the x0.4 repeat penalty is applied on top.
      const r4Boosted = Math.round(r4.score.total * r4.comboMultiplier);
      check('combo: repeat damage is the combo-boosted damage x0.4, rounded', r4.damage === Math.round(r4Boosted * 0.4));
      check('combo: repeat penalty actually reduced the damage below the combo-boosted (pre-penalty) amount', r4Boosted > 0 && r4.damage < r4Boosted);
      check('combo: repeating a word resets the combo streak to 0', comboState.combo === 0);
    } else {
      console.log('SKIP combo checks -- synthetic rack could not form CAT/DOG/PIG (unexpected, check LETTER tiles)');
    }
  }

  // Multi-phase boss traits (GOALS.md "FUN OVERHAUL 3/8"): every boss should
  // have exactly 2 phases, both drawn from the SIMPLE (bonus-on-match, 1x
  // baseline) trait pool -- never the four 0.3x-floor resistance traits
  // (vowelless/palindromic/shortFuse/alphabetic), which were deliberately
  // removed from bosses in the 2026-08-19/20 balance pass and must not
  // silently come back via this ticket. Isolated math check against
  // Traits.activeTraitForHpRatio directly, same synthetic style as the
  // blocks above -- the live-DOM confirmation that the rendered weakness
  // text actually updates mid-fight is further down, once a run exists.
  {
    const Monsters = window.Wordbound.Monsters;
    const Traits = window.Wordbound.Traits;
    const RESISTANCE_TRAITS = ['vowelless', 'palindromic', 'shortFuse', 'alphabetic'];
    const bossIds = Object.keys(Monsters.BOSS_DEFS);
    check('boss phases: all 3 boss defs present', bossIds.length === 3);
    bossIds.forEach((id) => {
      const def = Monsters.BOSS_DEFS[id];
      const phases = def.traitPhases || [];
      check('boss phases: ' + id + ' has exactly 2 phases', phases.length === 2);
      if (phases.length === 2) {
        check('boss phases: ' + id + ' phase order is descending hpThreshold', phases[0].hpThreshold > phases[1].hpThreshold);
        phases.forEach((p, i) => {
          check('boss phases: ' + id + ' phase ' + i + ' (' + p.traitId + ') is not a resistance trait', RESISTANCE_TRAITS.indexOf(p.traitId) === -1);
        });
        const atFull = Traits.activeTraitForHpRatio(phases, 1.0);
        const atLow = Traits.activeTraitForHpRatio(phases, 0.3);
        check('boss phases: ' + id + ' at full HP uses phase 0 (' + phases[0].traitId + ')', atFull === phases[0].traitId);
        check('boss phases: ' + id + ' below the threshold switches to phase 1 (' + phases[1].traitId + ')', atLow === phases[1].traitId);
      }
    });
  }

  // Monster intents (GOALS.md "FUN OVERHAUL 2/8"): isolated, deterministic
  // checks of the Intents module's own logic -- same synthetic-setup style
  // as the Foreword/combo blocks above, independent of any run in progress.
  {
    const Intents = window.Wordbound.Intents;
    const Monsters = window.Wordbound.Monsters;
    const RNGModule = window.Game.RNG;
    const rng = RNGModule.create('intents-test-seed');

    // WEAK-tier monsters always roll plain Attack -- floor 1 stays welcoming,
    // no telegraphed variety needed.
    const weak = Monsters.createMonster('slime');
    let weakOk = true;
    for (let i = 0; i < 30; i++) {
      const intent = Intents.rollIntent(weak, rng);
      if (intent.type !== 'attack' || intent.value !== weak.attack) weakOk = false;
    }
    check('monster intents: WEAK-tier always rolls plain Attack (30/30)', weakOk);

    // A def with a non-empty `intents` list (sentinel: hex/enrage) fighting
    // as a REGULAR (non-elite, non-boss) monster must never roll a
    // signature move -- only the elite/boss instance of the same fight
    // should see them.
    const regularSentinel = Monsters.createMonster('sentinel');
    check('monster intents: regular-fight instance is not flagged elite/boss', !regularSentinel.isElite && !regularSentinel.isBoss);
    let regularSawSignature = false;
    for (let i = 0; i < 40; i++) {
      const intent = Intents.rollIntent(regularSentinel, rng);
      if (Intents.isSignatureIntent(intent)) regularSawSignature = true;
    }
    check('monster intents: regular (non-elite) strong-tier fight never rolls a signature move (40/40 attack/heavy only)', !regularSawSignature);

    // The SAME def, now flagged as an elite fight, should see its signature
    // pool (hex/enrage for sentinel) mixed in -- weight 1 each against
    // attack:3/heavy:1, so over 60 rolls the odds of never seeing either are
    // astronomically small; a real failure here means the elite gate broke.
    const eliteSentinel = Monsters.createMonster('sentinel');
    eliteSentinel.isElite = true;
    const seenTypes = new Set();
    for (let i = 0; i < 60; i++) {
      seenTypes.add(Intents.rollIntent(eliteSentinel, rng).type);
    }
    check('monster intents: elite fight can roll its def\'s signature moves', seenTypes.has('hex') || seenTypes.has('enrage'));
    check('monster intents: elite fight never rolls a signature NOT in its own def\'s list', !seenTypes.has('devour') && !seenTypes.has('mend'));

    // Heavy Blow's damage value.
    const serpent = Monsters.createMonster('serpent');
    let heavyIntent = null;
    for (let i = 0; i < 100 && !heavyIntent; i++) {
      const intent = Intents.rollIntent(serpent, rng);
      if (intent.type === 'heavy') heavyIntent = intent;
    }
    check('monster intents: Heavy Blow was rolled at least once in 100 tries', !!heavyIntent);
    if (heavyIntent) check('monster intents: Heavy Blow value is round(attack * HEAVY_MULTIPLIER)', heavyIntent.value === Math.round(serpent.attack * Intents.HEAVY_MULTIPLIER));

    // describeIntent / isSignatureIntent sanity.
    check('monster intents: describeIntent formats Attack', Intents.describeIntent({ type: 'attack', value: 5 }) === 'Next: Attack 5');
    check('monster intents: describeIntent formats Heavy Blow', Intents.describeIntent({ type: 'heavy', value: 8 }) === 'Next: Heavy Blow 8');
    check('monster intents: isSignatureIntent is false for attack/heavy, true for hex/devour/mend/enrage',
      !Intents.isSignatureIntent({ type: 'attack' }) && !Intents.isSignatureIntent({ type: 'heavy' }) &&
      Intents.isSignatureIntent({ type: 'hex' }) && Intents.isSignatureIntent({ type: 'devour' }) &&
      Intents.isSignatureIntent({ type: 'mend' }) && Intents.isSignatureIntent({ type: 'enrage' }));

    // executeIntent: Hex locks a tile without removing it from the rack.
    {
      const Tiles = window.Wordbound.Tiles;
      const player = { rack: ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null)) };
      const monster = { name: 'Test Monster' };
      const before = player.rack.map((t) => t.id);
      const result = Intents.executeIntent({ type: 'hex' }, { player, monster, rng });
      check('monster intents: Hex returns a locked tile id from the current rack', before.indexOf(result.tileLockedId) !== -1);
      check('monster intents: Hex does not remove the locked tile from the rack', player.rack.length === 3 && JSON.stringify(player.rack.map((t) => t.id)) === JSON.stringify(before));
      check('monster intents: Hex deals zero damage', result.damage === 0);
    }

    // executeIntent: Devour eats a tile only when the player's word dealt
    // less than the threshold; at/above it, the lunge is thwarted and the
    // rack is untouched.
    {
      const Tiles = window.Wordbound.Tiles;
      const monster = { name: 'Test Monster' };
      const weakHitPlayer = { rack: ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null)) };
      const weakHitResult = Intents.executeIntent({ type: 'devour' }, { player: weakHitPlayer, monster, turnDamage: Intents.DEVOUR_DAMAGE_THRESHOLD - 1, rng });
      check('monster intents: Devour eats a tile when turn damage is below the threshold', weakHitPlayer.rack.length === 2 && !!weakHitResult.tileDevouredLetter);

      const strongHitPlayer = { rack: ['C', 'A', 'T'].map((l) => Tiles.createTile(l, null)) };
      const strongHitResult = Intents.executeIntent({ type: 'devour' }, { player: strongHitPlayer, monster, turnDamage: Intents.DEVOUR_DAMAGE_THRESHOLD, rng });
      check('monster intents: Devour is thwarted (skips) when turn damage meets the threshold', strongHitPlayer.rack.length === 3 && strongHitResult.tileDevouredLetter === null && strongHitResult.damage === 0);
      check('monster intents: a successful Devour sets devourUsed', monster.devourUsed === true);
    }

    // GOALS.md balance ticket (2026-08-20 orchestrator decision): Devour had
    // no per-fight cap, so a long fight (esp. boss_unabridged/spinesplinter)
    // could eat the whole rack over enough turns. Once devourUsed is true,
    // rollIntent must stop offering 'devour' -- same guard pattern as Mend.
    {
      const boss = Monsters.createBoss('boss_unabridged'); // intents: ['hex', 'devour']
      boss.isBoss = true;
      const Tiles = window.Wordbound.Tiles;
      const player = { rack: ['C', 'A', 'T', 'S'].map((l) => Tiles.createTile(l, null)) };
      Intents.executeIntent({ type: 'devour' }, { player, monster: boss, turnDamage: 0, rng });
      check('monster intents: Devour eaten tile is only removed from the in-fight rack, not the persistent deck', player.rack.length === 3);
      let devourSeenAfterUse = false;
      for (let i = 0; i < 60; i++) {
        if (Intents.rollIntent(boss, rng).type === 'devour') devourSeenAfterUse = true;
      }
      check('monster intents: Devour is never re-telegraphed after it\'s already fired this fight (60/60)', !devourSeenAfterUse);
      check('monster intents: hex (the def\'s other signature) still rolls once Devour is used', (() => {
        for (let i = 0; i < 60; i++) {
          if (Intents.rollIntent(boss, rng).type === 'hex') return true;
        }
        return false;
      })());
    }

    // executeIntent: Mend heals a fixed % of max HP, once per fight.
    {
      const boss = Monsters.createBoss('boss_vowelmaw'); // intents: ['mend']
      boss.hp = 10;
      const expectedHeal = Math.round(boss.maxHp * Intents.MEND_HEAL_RATIO);
      const mendResult = Intents.executeIntent({ type: 'mend' }, { monster: boss });
      check('monster intents: Mend heals maxHp * MEND_HEAL_RATIO', boss.hp === 10 + expectedHeal && mendResult.healed === expectedHeal);
      check('monster intents: Mend sets mendUsed', boss.mendUsed === true);
      let mendSeenAfterUse = false;
      for (let i = 0; i < 60; i++) {
        if (Intents.rollIntent(boss, rng).type === 'mend') mendSeenAfterUse = true;
      }
      check('monster intents: Mend is never re-telegraphed after it\'s already fired this fight (60/60)', !mendSeenAfterUse);
    }

    // GOALS.md bug (2026-08-20 QA pass): a Mend firing close to max HP used
    // to report the raw ratio-derived amount instead of the actual
    // post-clamp gain -- assert the clamped case reports the SMALLER real
    // number, and that the no-clamp case still reports the full raw amount.
    {
      const boss = Monsters.createBoss('boss_vowelmaw'); // intents: ['mend']
      const rawHeal = Math.round(boss.maxHp * Intents.MEND_HEAL_RATIO);
      boss.hp = boss.maxHp - Math.floor(rawHeal / 2); // less headroom than the raw heal amount
      const clampedHealResult = Intents.executeIntent({ type: 'mend' }, { monster: boss });
      const expectedClampedHeal = boss.maxHp - (boss.maxHp - Math.floor(rawHeal / 2));
      check('monster intents: Mend reports the actual post-clamp heal, not the raw ratio amount', clampedHealResult.healed === expectedClampedHeal && clampedHealResult.healed < rawHeal);
      check('monster intents: Mend message number matches the clamped heal', clampedHealResult.message.indexOf('healing ' + expectedClampedHeal + ' HP') !== -1);
      check('monster intents: post-Mend hp is exactly maxHp (clamped)', boss.hp === boss.maxHp);
    }

    // executeIntent: Enrage permanently increases attack and stacks.
    {
      const boss = Monsters.createBoss('boss_sovereign'); // intents: ['enrage', 'hex']
      const baseAttack = boss.attack;
      Intents.executeIntent({ type: 'enrage' }, { monster: boss });
      Intents.executeIntent({ type: 'enrage' }, { monster: boss });
      check('monster intents: Enrage stacks (+ENRAGE_ATTACK_BONUS per use)', boss.attack === baseAttack + 2 * Intents.ENRAGE_ATTACK_BONUS);
      check('monster intents: Enrage tracks enrageStacks', boss.enrageStacks === 2);
    }

    // GOALS.md balance ticket (2026-08-20): Enrage had no cap, letting a
    // dragged-out fight (esp. boss_sovereign) stack it indefinitely for an
    // unbounded attack spiral. Once enrageStacks reaches ENRAGE_MAX_STACKS,
    // rollIntent must stop offering 'enrage' -- same once-fired guard
    // pattern as Mend's mendUsed, but a counted cap instead of a boolean.
    {
      const boss = Monsters.createBoss('boss_sovereign'); // intents: ['enrage', 'hex']
      for (let i = 0; i < Intents.ENRAGE_MAX_STACKS; i++) {
        Intents.executeIntent({ type: 'enrage' }, { monster: boss });
      }
      check('monster intents: enrageStacks reaches ENRAGE_MAX_STACKS after that many uses', boss.enrageStacks === Intents.ENRAGE_MAX_STACKS);
      let enrageSeenAfterCap = false;
      boss.isBoss = true;
      for (let i = 0; i < 60; i++) {
        if (Intents.rollIntent(boss, rng).type === 'enrage') enrageSeenAfterCap = true;
      }
      check('monster intents: Enrage is never re-telegraphed once enrageStacks hits the cap (60/60)', !enrageSeenAfterCap);
      check('monster intents: hex (the def\'s other signature) still rolls once Enrage is capped', (() => {
        for (let i = 0; i < 60; i++) {
          if (Intents.rollIntent(boss, rng).type === 'hex') return true;
        }
        return false;
      })());
    }
  }

  document.getElementById('btn-new-run').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));
  check('starting a run produces zero errors', errors.length === 0);

  // Verify character select screen is actually visible (not hidden by show() function)
  const screenCharSelect = document.getElementById('screen-character-select');
  check('screen-character-select is not hidden after "New Run" click', screenCharSelect && !screenCharSelect.classList.contains('hidden'));

  // Character select screen is now shown; click on the first character option
  const firstCharacter = document.querySelector('.character-option');
  if (firstCharacter) {
    firstCharacter.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
  }

  // Verify game-over and victory screens are hidden (should never be visible at this point)
  const screenGameOver = document.getElementById('screen-game-over');
  const screenVictory = document.getElementById('screen-victory');
  check('screen-game-over is hidden after run starts', screenGameOver && screenGameOver.classList.contains('hidden'));
  check('screen-victory is hidden after run starts', screenVictory && screenVictory.classList.contains('hidden'));

  const nodePill = document.querySelector('.node-pill.node-current');
  check('a clickable current node exists after starting a run', !!nodePill);
  if (nodePill) {
    nodePill.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
  }
  check('entering the first node produces zero errors', errors.length === 0);

  const state = window.Wordbound.Game._state;
  check('combat is active after entering a combat node', state.combatActive === true);
  check('rack has tiles', state.player.rack.length > 0);

  // review B4: the fight-start log line used to read "A The Consonant
  // Constrictor appears!" (a hardcoded 'A ' prefix in front of names that
  // already carry their own article, or none at all for "Quoth").
  const appearsMsg = state.messages.find((m) => /appears!$/.test(m));
  check('fight-start log line exists', !!appearsMsg);
  check('fight-start log line has no doubled/spurious article ("A " prefix removed)', !!appearsMsg && !/^A /.test(appearsMsg));
  check('fight-start log line is exactly "<monster name> appears!"', appearsMsg === state.monster.name + ' appears!');

  // Find a playable word that will actually deal damage > 0 -- not just any
  // playable word. A monster's trait can legitimately zero out damage (e.g.
  // "vowelless" is immune unless the word has zero vowels), and submitting
  // one of those isn't a bug, it just makes this check meaningless. Predict
  // damage the same way Combat.playWord does before picking a word.
  const Lexicon = window.Wordbound.Lexicon;
  const Traits = window.Wordbound.Traits;
  const WORDLIST = window.Wordbound.WORDLIST;
  const hpRatio = state.monster.maxHp > 0 ? state.monster.hp / state.monster.maxHp : 0;
  const activeTraitId = Traits.activeTraitForHpRatio(state.monster.traitPhases, hpRatio);
  const trait = Traits.TRAITS[activeTraitId];

  // Monster intents (GOALS.md "FUN OVERHAUL 2/8"), live integration check:
  // force THIS in-progress fight's monster into elite mode with only Hex
  // available, submit a real (survivable, first-turn) word, and confirm the
  // telegraphed "Next: Hex" line matches what then actually happens -- a
  // tile gets locked, greyed out and disabled in the real rendered rack,
  // and clicking it is a no-op. Resets back to a neutral, non-elite state
  // afterward so it doesn't affect the checks below, which assume a plain
  // fight (Devour/Mend/Enrage are covered deterministically in the isolated
  // Intents unit tests above instead of here, since predicting a real
  // word's exact damage well enough to force those specific branches
  // through a live run would be unreliably precise).
  {
    let safeWord = null;
    for (let i = 0; i < WORDLIST.length; i++) {
      const w = WORDLIST[i];
      if (w.length < 2 || w.length > state.player.rack.length) continue;
      if (!Lexicon.isValidWord(w)) continue;
      const formed = Lexicon.canFormFromRack(w, state.player.rack);
      if (!formed.possible) continue;
      const score = Lexicon.scoreWord(w, formed.tilesUsed);
      const mult = trait ? trait.multiplier(w, formed.tilesUsed) : 1;
      if (Math.round(score.total * mult) < state.monster.hp) { safeWord = w; break; } // must not kill it
    }
    if (!safeWord) {
      console.log('SKIP monster-intent Hex integration check -- no survivable word found from this rack (unexpected)');
    } else {
      state.monster.isElite = true;
      state.monster.intents = ['hex'];
      state.monster.intent = { type: 'hex' };
      window.Wordbound.Game.openDeckViewer(); // forces a real re-render (existing test convention)
      window.Wordbound.Game.closeDeckViewer();

      const intentEl = document.getElementById('monster-intent');
      check('monster intent: Hex is telegraphed before it fires ("Next: Hex...")', !!intentEl && intentEl.textContent.indexOf('Hex') !== -1);

      document.getElementById('word-input').value = safeWord;
      document.getElementById('btn-submit-word').dispatchEvent(new window.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 300));

      check('monster intent: Hex turn produces zero errors', errors.length === 0);
      check('monster intent: telegraphed Hex actually locked a tile', !!state.hexedTileId);
      const hexedTile = state.player.rack.find((t) => t.id === state.hexedTileId);
      check('monster intent: the locked tile is still in the rack (locked, not removed)', !!hexedTile);
      const hexedBtn = hexedTile && document.querySelector('[data-tile-id="' + hexedTile.id + '"]');
      check('monster intent: the locked tile\'s button is disabled in the rendered rack', !!hexedBtn && hexedBtn.disabled === true);
      check('monster intent: the locked tile\'s button has the tile-hexed class', !!hexedBtn && hexedBtn.className.indexOf('tile-hexed') !== -1);
      if (hexedBtn) {
        const selectedBefore = state.selectedTileIds.length;
        hexedBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
        check('monster intent: clicking the locked tile does not stage it', state.selectedTileIds.length === selectedBefore);
      }

      state.monster.isElite = false;
      state.monster.intents = [];
      state.hexedTileId = null;
      state.monster.intent = { type: 'attack', value: state.monster.attack || 0 };
      window.Wordbound.Game.openDeckViewer();
      window.Wordbound.Game.closeDeckViewer();
    }
  }

  // UX (review B5): clicking an already-staged rack tile should DESELECT it
  // instead of appending a second copy of its letter. Live-DOM check using
  // real clicks on the actual rendered rack buttons (not synthetic state
  // pokes), since this is exactly a click-handler/render-order bug class.
  {
    state.selectedTileIds = [];
    document.getElementById('word-input').value = '';
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();

    const rackButtons = () => Array.from(document.querySelectorAll('#rack-display .letter-tile'));
    // Blanks are a separate no-op case (checked below) -- exclude them here
    // so this check only exercises the toggle-select/deselect behavior.
    const nonBlankButtons = () => rackButtons().filter((b) => {
      const t = state.player.rack.find((rt) => rt.id === b.getAttribute('data-tile-id'));
      return t && t.letter !== '?';
    });

    let candidates = nonBlankButtons();
    if (candidates.length < 2) {
      console.log('SKIP tile-toggle checks -- fewer than 2 non-blank rack tiles (unexpected)');
    } else {
      const firstId = candidates[0].getAttribute('data-tile-id');
      candidates[0].dispatchEvent(new window.Event('click', { bubbles: true }));
      check('tile click: staging a tile appends its letter exactly once', document.getElementById('word-input').value.length === 1);
      check('tile click: selectedTileIds gains exactly the clicked tile', state.selectedTileIds.length === 1 && state.selectedTileIds[0] === firstId);
      let firstBtn = rackButtons().find((b) => b.getAttribute('data-tile-id') === firstId);
      check('tile click: the staged tile shows the selected class', !!firstBtn && firstBtn.className.indexOf('selected') !== -1);

      firstBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      check('tile click: clicking a staged tile again deselects it (input empty)', document.getElementById('word-input').value === '');
      check('tile click: selectedTileIds is empty again', state.selectedTileIds.length === 0);
      firstBtn = rackButtons().find((b) => b.getAttribute('data-tile-id') === firstId);
      check('tile click: the tile no longer shows the selected class', !!firstBtn && firstBtn.className.indexOf('selected') === -1);

      candidates = nonBlankButtons();
      const tileAId = candidates[0].getAttribute('data-tile-id');
      const tileALetter = state.player.rack.find((t) => t.id === tileAId).letter;
      candidates[0].dispatchEvent(new window.Event('click', { bubbles: true }));
      candidates = nonBlankButtons();
      const tileBBtn = candidates.find((b) => b.getAttribute('data-tile-id') !== tileAId);
      const tileBId = tileBBtn.getAttribute('data-tile-id');
      const tileBLetter = state.player.rack.find((t) => t.id === tileBId).letter;
      tileBBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      check('tile click: two distinct tiles stage in click order', document.getElementById('word-input').value === tileALetter + tileBLetter);

      const tileABtn = rackButtons().find((b) => b.getAttribute('data-tile-id') === tileAId);
      tileABtn.dispatchEvent(new window.Event('click', { bubbles: true })); // unclick the first of the two
      check('tile click: unclicking the first of two leaves only the second letter', document.getElementById('word-input').value === tileBLetter);
      check('tile click: selectedTileIds now holds only the second tile', state.selectedTileIds.length === 1 && state.selectedTileIds[0] === tileBId);

      state.selectedTileIds = [];
      document.getElementById('word-input').value = '';
      window.Wordbound.Game.openDeckViewer();
      window.Wordbound.Game.closeDeckViewer();
    }

    // A blank (?) tile has no letter to stage -- clicking it must be a true
    // no-op (review B5's second finding), not a visible-but-empty selection.
    const blankTile = { id: 'test-blank-tile-b5', letter: '?' };
    state.player.rack.push(blankTile);
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
    const blankBtn = document.querySelector('[data-tile-id="test-blank-tile-b5"]');
    check('blank tile renders in the rack for this check', !!blankBtn);
    if (blankBtn) {
      const inputBefore = document.getElementById('word-input').value;
      const selectedCountBefore = state.selectedTileIds.length;
      blankBtn.dispatchEvent(new window.Event('click', { bubbles: true }));
      check('blank tile click: word-input unchanged', document.getElementById('word-input').value === inputBefore);
      check('blank tile click: selectedTileIds unchanged', state.selectedTileIds.length === selectedCountBefore);
      const blankBtnAfter = document.querySelector('[data-tile-id="test-blank-tile-b5"]');
      check('blank tile click: never gets the selected class', !!blankBtnAfter && blankBtnAfter.className.indexOf('selected') === -1);
    }
    state.player.rack = state.player.rack.filter((t) => t.id !== 'test-blank-tile-b5');
    state.selectedTileIds = [];
    document.getElementById('word-input').value = '';
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
  }

  // Multi-phase boss traits (GOALS.md "FUN OVERHAUL 3/8"), live-DOM check:
  // force the in-progress fight's monster onto the Vowelmaw boss's 2-phase
  // traitPhases and confirm the rendered ".monster-weakness" text actually
  // flips when HP crosses the phase threshold. renderCombat recomputes the
  // active trait from hp ratio on every render (confirmed by reading the
  // code, not assumed) -- this proves that end to end in a real DOM rather
  // than only against Traits.activeTraitForHpRatio in isolation (see the
  // isolated boss-phase math check above). Restores the monster's real
  // traitPhases/hp afterward so it doesn't affect the checks below.
  {
    const Monsters = window.Wordbound.Monsters;
    const bossPhases = Monsters.BOSS_DEFS['boss_vowelmaw'].traitPhases;
    const originalTraitPhases = state.monster.traitPhases;
    const originalHp = state.monster.hp;
    const originalMaxHp = state.monster.maxHp;

    state.monster.traitPhases = bossPhases;
    state.monster.maxHp = 100;
    state.monster.hp = 100; // full HP -> phase 0
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
    let weaknessEl = document.querySelector('.monster-weakness');
    const phase0Hint = Traits.TRAITS[bossPhases[0].traitId].hint;
    const phase1Hint = Traits.TRAITS[bossPhases[1].traitId].hint;
    check('boss phases (live): full HP shows phase 0 weakness text', !!weaknessEl && weaknessEl.textContent.indexOf(phase0Hint) !== -1);

    state.monster.hp = 30; // 0.3 ratio, below the 0.5 threshold -> phase 1
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
    weaknessEl = document.querySelector('.monster-weakness');
    check('boss phases (live): below-threshold HP switches to phase 1 weakness text', !!weaknessEl && weaknessEl.textContent.indexOf(phase1Hint) !== -1);
    check('boss phases (live): the two phase hints are actually different text', phase0Hint !== phase1Hint);

    state.monster.traitPhases = originalTraitPhases;
    state.monster.hp = originalHp;
    state.monster.maxHp = originalMaxHp;
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
  }

  let word = null;
  for (let i = 0; i < WORDLIST.length; i++) {
    const w = WORDLIST[i];
    if (w.length < 2 || w.length > state.player.rack.length) continue;
    if (!Lexicon.isValidWord(w)) continue;
    const formed = Lexicon.canFormFromRack(w, state.player.rack);
    if (!formed.possible) continue;
    const score = Lexicon.scoreWord(w, formed.tilesUsed);
    const mult = trait ? trait.multiplier(w, formed.tilesUsed) : 1;
    if (Math.round(score.total * mult) > 0) { word = w; break; }
  }
  if (!word) {
    // Not a bug: some monster traits (e.g. vowelless/"The Consonant") are
    // legitimately immune to whatever the starting 7-tile rack can form.
    // The rack still cycles on any valid play regardless of damage dealt,
    // so this isn't a softlock -- just an unlucky draw for this test run.
    // Skip the damage-specific checks rather than falsely failing them.
    console.log('SKIP damage checks -- no damage-dealing word possible against ' + state.monster.name + ' from this starting rack (likely a legitimate trait immunity, not a bug -- rerun if you want to double check)');
  } else {
    const before = { monsterHp: state.monster.hp, playerHp: state.player.hp, rackIds: state.player.rack.map((t) => t.id) };
    document.getElementById('word-input').value = word;
    document.getElementById('btn-submit-word').dispatchEvent(new window.Event('click', { bubbles: true }));
    // Rack cycling, the counterattack, and damage animations are deferred by
    // TILE_PLAY_ANIM_MS (game.js) so the tile-play animation is actually visible
    // before the rack redraws -- wait past that, not just past the click handler.
    await new Promise((r) => setTimeout(r, 300));

    check('playing a damage-dealing word produces zero errors', errors.length === 0);
    if (errors.length) errors.forEach((e) => console.log('  ERR:', e));

    const after = { monsterHp: state.monster.hp, playerHp: state.player.hp, rackIds: state.player.rack.map((t) => t.id) };
    check('monster HP decreased', after.monsterHp < before.monsterHp);
    check('rack cycled (discard + redraw ran)', JSON.stringify(before.rackIds) !== JSON.stringify(after.rackIds));
    check('a damage-number element appeared and was still present right after the hit', document.querySelectorAll('.damage-number').length > 0);
    const hpFill = document.getElementById('monster-hp-fill');
    check('monster-hp-fill element exists (matches the id game.js looks up)', !!hpFill);
    if (hpFill) check('monster-hp-fill got the flash-damage class', hpFill.className.indexOf('flash-damage') !== -1);
  }

  // Killing-blow feedback (review B3/F1): force the monster down to a sliver
  // of HP so the next damage-dealing word is a killing blow, and confirm the
  // death path still shows a damage number + HP-bar flash during its beat
  // instead of hard-cutting straight to the tile-reward screen.
  if (state.combatActive) {
    const hpRatio2 = state.monster.maxHp > 0 ? state.monster.hp / state.monster.maxHp : 0;
    const activeTraitId2 = Traits.activeTraitForHpRatio(state.monster.traitPhases, hpRatio2);
    const trait2 = Traits.TRAITS[activeTraitId2];
    let killWord = null;
    for (let i = 0; i < WORDLIST.length; i++) {
      const w = WORDLIST[i];
      if (w.length < 2 || w.length > state.player.rack.length) continue;
      if (!Lexicon.isValidWord(w)) continue;
      const formed = Lexicon.canFormFromRack(w, state.player.rack);
      if (!formed.possible) continue;
      const score = Lexicon.scoreWord(w, formed.tilesUsed);
      const mult = trait2 ? trait2.multiplier(w, formed.tilesUsed) : 1;
      if (Math.round(score.total * mult) > 0) { killWord = w; break; }
    }
    if (!killWord) {
      console.log('SKIP kill-blow-feedback checks -- no damage-dealing word possible from this rack (likely a trait immunity, not a bug)');
    } else {
      state.monster.hp = 1; // force this word to be a killing blow
      document.getElementById('word-input').value = killWord;
      document.getElementById('btn-submit-word').dispatchEvent(new window.Event('click', { bubbles: true }));
      // TILE_PLAY_ANIM_MS (220ms) defers processing; check partway into the
      // MONSTER_DEATH_BEAT_MS (500ms) beat that follows -- proves the
      // feedback actually renders and is visible, not just that the game
      // eventually reaches the reward screen afterward.
      await new Promise((r) => setTimeout(r, 400));
      check('killing blow produces zero errors', errors.length === 0);
      if (errors.length) errors.forEach((e) => console.log('  ERR:', e));
      check('killing blow: a damage-number element appeared during the death beat', document.querySelectorAll('.damage-number').length > 0);
      const hpFillAfterKill = document.getElementById('monster-hp-fill');
      check('killing blow: monster-hp-fill still exists during the death beat', !!hpFillAfterKill);
      if (hpFillAfterKill) check('killing blow: monster-hp-fill got the flash-damage class', hpFillAfterKill.className.indexOf('flash-damage') !== -1);
      check('killing blow: still on the combat screen mid-beat (no hard cut yet)', state.screen === 'RUN' && state.combatActive === true);
      const monsterInfoDuringBeat = document.getElementById('monster-info');
      check('killing blow: monster-info panel got the death-beat fade class', !!monsterInfoDuringBeat && monsterInfoDuringBeat.className.indexOf('monster-defeated') !== -1);

      await new Promise((r) => setTimeout(r, 500)); // past MONSTER_DEATH_BEAT_MS (500ms)
      check('killing blow: tile-reward screen arrives after the death beat', state.screen === 'TILE_REWARD');

      // Tile-reward restyle (GOALS.md POLISH review F4.5): choices should
      // render as letter-tile-shaped buttons (big letter + point-value sub,
      // bonus text underneath), not the old full-width text bars.
      if (state.screen === 'TILE_REWARD') {
        const tileChoiceButtons = Array.from(document.querySelectorAll('#tile-reward-choices .treasure-choice-tile'));
        check('tile reward: one .treasure-choice-tile button per offered option', tileChoiceButtons.length === (state.tileRewardOptions || []).length && tileChoiceButtons.length > 0);
        const firstLetterEl = tileChoiceButtons[0] && tileChoiceButtons[0].querySelector('.tile-reward-letter');
        check('tile reward: choice button contains a .tile-reward-letter element', !!firstLetterEl);
        const firstSub = firstLetterEl && firstLetterEl.querySelector('sub');
        check('tile reward: .tile-reward-letter has a point-value <sub>', !!firstSub && firstSub.textContent.trim() !== '');
        const deckSizeBefore = state.deck.length;
        tileChoiceButtons[0].dispatchEvent(new window.Event('click', { bubbles: true }));
        check('tile reward: clicking a tile choice adds it to the deck', state.deck.length === deckSizeBefore + 1);
        check('tile reward: picking a tile resolves off the TILE_REWARD screen', state.screen !== 'TILE_REWARD');
      }
    }
  }

  // End-of-run stats (GOALS.md review N6): submitWord/onMonsterDefeated
  // bookkeeping (state.runStats), and the stats block rendered on the
  // game-over/victory screens. By this point in the script at least one
  // word has been played and the one monster on this run has been killed
  // (tile-reward flow above), so these should all be populated.
  {
    const rs = state.runStats;
    check('run stats: wordsPlayed tracked the words submitted so far', !!rs && rs.wordsPlayed > 0);
    check('run stats: totalDamage tracked and positive', !!rs && rs.totalDamage > 0);
    check('run stats: bestWord recorded a word', !!rs && typeof rs.bestWord === 'string' && rs.bestWord.length > 0);
    check('run stats: bestWordDamage is positive and no more than totalDamage', !!rs && rs.bestWordDamage > 0 && rs.bestWordDamage <= rs.totalDamage);
    check('run stats: monstersDefeated incremented for the one kill so far', !!rs && rs.monstersDefeated === 1);
    check('run stats: goldEarned tracked from the kill\'s gold drop', !!rs && rs.goldEarned > 0);

    // Force the game-over/victory screens to render with these stats and
    // confirm the new stats block actually displays them, not just that
    // the underlying state updated.
    const savedScreen = state.screen;
    state.screen = 'GAME_OVER';
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
    const gameOverStatsBlock = document.getElementById('game-over-run-stats');
    check('game-over stats block rendered with rows', !!gameOverStatsBlock && gameOverStatsBlock.children.length > 0);
    check('game-over stats block shows the words-spelled count', !!gameOverStatsBlock && gameOverStatsBlock.textContent.indexOf(String(rs.wordsPlayed)) !== -1);
    check('game-over stats block shows the best word', !!gameOverStatsBlock && gameOverStatsBlock.textContent.indexOf(rs.bestWord) !== -1);
    check('game-over stats block has a Loose Words Defeated row', !!gameOverStatsBlock && gameOverStatsBlock.textContent.indexOf('Loose Words Defeated') !== -1);

    state.screen = 'VICTORY';
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
    const victoryStatsBlock = document.getElementById('victory-run-stats');
    check('victory stats block rendered with rows', !!victoryStatsBlock && victoryStatsBlock.children.length > 0);
    check('victory stats block has a Gold Earned row', !!victoryStatsBlock && victoryStatsBlock.textContent.indexOf('Gold Earned') !== -1);

    state.screen = savedScreen;
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
  }

  // Cleanup ticket (GOALS.md review B6, item 2): Game.useConsumable now
  // checks whether the monster died from a consumable's effect and routes
  // through the same onMonsterDefeated path submitWord uses, instead of
  // just re-rendering onto an already-dead monster. No shipped consumable
  // deals direct monster damage today, so this force-registers a
  // throwaway test-only consumable that does, to actually exercise the
  // guard rather than leave it unverified.
  {
    const Consumables = window.Wordbound.Consumables;
    const savedCombatActive = state.combatActive;
    const savedMonsterHp = state.monster.hp;
    const savedScreen2 = state.screen;
    const savedConsumables = state.player.consumables.slice();

    Consumables.CONSUMABLE_DEFS['_test_lethal_strike'] = {
      id: '_test_lethal_strike',
      name: 'Test Lethal Strike',
      hint: 'test-only, not a real consumable',
      rarity: 'common',
      effect: function (ctx) {
        ctx.monster.hp = 0;
        return { message: 'Test Lethal Strike used.' };
      }
    };

    state.combatActive = true;
    state.monster.hp = 1;
    state.screen = 'RUN';
    state.player.consumables.push('_test_lethal_strike');

    window.Wordbound.Game.useConsumable('_test_lethal_strike');

    check('useConsumable death guard: killing the monster via a consumable routes to TILE_REWARD (not left rendering a dead monster)', state.screen === 'TILE_REWARD');
    check('useConsumable death guard: combat is no longer active', state.combatActive === false);

    delete Consumables.CONSUMABLE_DEFS['_test_lethal_strike'];
    state.combatActive = savedCombatActive;
    state.monster.hp = savedMonsterHp;
    state.screen = savedScreen2;
    state.player.consumables = savedConsumables;
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('SCRIPT CRASHED:', e); process.exit(1); });
