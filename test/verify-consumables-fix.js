// Verify consumable items are actually working

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

  console.log('\n=== Consumable Verification ===\n');

  // Test 1: Errata Slip healing caps at maxInk
  console.log('Test 1: Errata Slip maxInk capping');
  const state = window.Wordbound.Game._state;
  const Consumables = window.Wordbound.Consumables;

  state.player = { ink: 15, maxInk: 20, consumables: [] };
  const healResult = Consumables.useConsumable('errata_slip', { player: state.player });
  if (state.player.ink === 20) {
    console.log('PASS: ink healed correctly (15 -> 20)');
  } else {
    console.log('FAIL: ink not healed correctly (expected 20, got ' + state.player.ink + ')');
    process.exit(1);
  }

  // Test 2: Errata Slip doesn't exceed maxInk
  console.log('\nTest 2: Errata Slip does not exceed maxInk');
  state.player = { ink: 18, maxInk: 20, consumables: [] };
  Consumables.useConsumable('errata_slip', { player: state.player });
  if (state.player.ink === 20) {
    console.log('PASS: ink capped at maxInk (18 -> 20, not 26)');
  } else {
    console.log('FAIL: ink exceeded maxInk (got ' + state.player.ink + ')');
    process.exit(1);
  }

  // Test 3: Index Card Shard sets bonus damage flag
  console.log('\nTest 3: Index Card Shard bonus damage flag');
  state.player = { ink: 20, maxInk: 20, bonusDamageUntilEndOfTurn: 0 };
  Consumables.useConsumable('index_card_shard', { player: state.player });
  if (state.player.bonusDamageUntilEndOfTurn === 15) {
    console.log('PASS: Bonus damage flag set to 15');
  } else {
    console.log('FAIL: Bonus damage flag not set correctly (got ' + state.player.bonusDamageUntilEndOfTurn + ')');
    process.exit(1);
  }

  // Test 4: Page Turn sets flags correctly
  console.log('\nTest 4: Page Turn flag initialization');
  state.player = { ink: 20, maxInk: 20, skipDiscardNextTurn: false, bonusTilesToDraw: 0 };
  Consumables.useConsumable('page_turn', { player: state.player });
  if (state.player.skipDiscardNextTurn === true && state.player.bonusTilesToDraw === 3) {
    console.log('PASS: Page Turn flags set correctly (skip=true, bonus=3)');
  } else {
    console.log('FAIL: Page Turn flags not set (skip=' + state.player.skipDiscardNextTurn + ', bonus=' + state.player.bonusTilesToDraw + ')');
    process.exit(1);
  }

  console.log('\n=== All Consumable Verifications PASSED ===');
  process.exit(0);
}

main().catch((e) => {
  console.error('SCRIPT CRASHED:', e);
  process.exit(1);
});
