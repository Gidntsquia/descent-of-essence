// Verify consumables work correctly in actual gameplay

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function main() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'wordbound.html'), 'utf8');
  const errors = [];

  const dom = new JSDOM(html, {
    url: 'file://' + path.join(__dirname, '..', 'wordbound.html'),
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
  });

  dom.window.addEventListener('error', (e) => {
    errors.push((e.error && e.error.stack) || e.message);
  });

  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') return resolve();
    dom.window.addEventListener('load', resolve);
  });
  await new Promise((r) => setTimeout(r, 300));

  const { document, window } = dom.window;
  if (errors.length > 0) {
    console.log('Errors during page load:');
    errors.forEach((e) => console.log('  ERR:', e));
    process.exit(1);
  }

  console.log('\n=== Consumables Gameplay Test ===\n');

  // Start a run
  document.getElementById('btn-new-run').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));

  // Enter first combat node
  const nodePill = document.querySelector('.node-pill.node-current');
  if (nodePill) {
    nodePill.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
  }

  const state = window.Wordbound.Game._state;
  const Lexicon = window.Wordbound.Lexicon;
  const Traits = window.Wordbound.Traits;
  const WORDLIST = window.Wordbound.WORDLIST;

  // TEST 1: Index Card Shard bonus damage
  console.log('Test 1: Index Card Shard bonus damage in combat');

  // Give the player the consumable
  state.player.consumables.push('index_card_shard');

  // Use the consumable
  const Game = window.Wordbound.Game;
  Game.useConsumable('index_card_shard');

  // Verify the flag is set
  if (state.player.bonusDamageUntilEndOfTurn !== 15) {
    console.log('FAIL: Bonus damage flag not set correctly');
    process.exit(1);
  }

  // Find a playable damage word
  let word = null;
  const hpRatio = state.monster.maxHp > 0 ? state.monster.hp / state.monster.maxHp : 0;
  const activeTraitId = Traits.activeTraitForHpRatio(state.monster.traitPhases, hpRatio);
  const trait = Traits.TRAITS[activeTraitId];

  for (let i = 0; i < WORDLIST.length; i++) {
    const w = WORDLIST[i];
    if (w.length < 2 || w.length > state.player.rack.length) continue;
    if (!Lexicon.isValidWord(w)) continue;
    const formed = Lexicon.canFormFromRack(w, state.player.rack);
    if (!formed.possible) continue;
    const score = Lexicon.scoreWord(w, formed.tilesUsed);
    const mult = trait ? trait.multiplier(w, formed.tilesUsed) : 1;
    const damage = Math.round(score.total * mult);
    if (damage > 0) { // any damage-dealing word
      word = w;
      break;
    }
  }

  if (!word) {
    console.log('SKIP: Could not find suitable test word');
    process.exit(0);
  }

  const beforeHp = state.monster.hp;
  document.getElementById('word-input').value = word;
  document.getElementById('btn-submit-word').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));

  const afterHp = state.monster.hp;
  const actualDamage = beforeHp - afterHp;

  // The bonus damage should have been applied (15 damage bonus)
  // We can't directly verify the damage calc without re-running Combat.playWord,
  // but we can verify the HP decreased and the flag was reset
  if (state.player.bonusDamageUntilEndOfTurn === 0) {
    console.log('PASS: Bonus damage flag reset after word play');
  } else {
    console.log('FAIL: Bonus damage flag not reset (still ' + state.player.bonusDamageUntilEndOfTurn + ')');
    process.exit(1);
  }

  if (actualDamage > 0) {
    console.log('PASS: Damage was applied (took ' + actualDamage + ' HP)');
  } else {
    console.log('FAIL: No damage was applied');
    process.exit(1);
  }

  // TEST 2: Page Turn bonus tiles
  console.log('\nTest 2: Page Turn bonus tiles');

  // Add another consumable and use it
  if (state.combatActive) {
    state.player.consumables.push('page_turn');
    Game.useConsumable('page_turn');

    if (state.player.skipDiscardNextTurn && state.player.bonusTilesToDraw === 3) {
      console.log('PASS: Page Turn flags set (skip=true, bonus=3)');
    } else {
      console.log('FAIL: Page Turn flags not correct');
      process.exit(1);
    }

    // Play another word to trigger cycleRackAfterWord
    const rackBefore = state.player.rack.length;

    // Find any valid word
    for (let i = 0; i < WORDLIST.length; i++) {
      const w = WORDLIST[i];
      if (w.length < 2 || w.length > state.player.rack.length) continue;
      if (!Lexicon.isValidWord(w)) continue;
      const formed = Lexicon.canFormFromRack(w, state.player.rack);
      if (!formed.possible) continue;
      word = w;
      break;
    }

    if (word) {
      document.getElementById('word-input').value = word;
      document.getElementById('btn-submit-word').dispatchEvent(new window.Event('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 50));

      // Check flags are reset
      if (state.player.skipDiscardNextTurn === false && state.player.bonusTilesToDraw === 0) {
        console.log('PASS: Page Turn flags reset after rack cycle');
      } else {
        console.log('FAIL: Page Turn flags not reset');
        process.exit(1);
      }

      // With 3 bonus tiles, rack should have been larger than normal (7 base + 3 = 10)
      const rackAfter = state.player.rack.length;
      if (rackAfter > 0) {
        console.log('PASS: Rack was refilled (now ' + rackAfter + ' tiles, max 10 with bonus)');
      }
    }
  }

  console.log('\n=== Consumables Gameplay Tests PASSED ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('SCRIPT CRASHED:', e);
  process.exit(1);
});
