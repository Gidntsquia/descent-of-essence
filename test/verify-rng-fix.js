// Verify the RNG fix: defeat a monster and confirm gold is awarded + screen transitions

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

  // wait for scripts to load
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

  // Start a run
  document.getElementById('btn-new-run').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));

  // Enter first node (combat)
  const nodePill = document.querySelector('.node-pill.node-current');
  if (nodePill) {
    nodePill.dispatchEvent(new window.Event('click', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 50));
  }

  const state = window.Wordbound.Game._state;
  const Lexicon = window.Wordbound.Lexicon;
  const Traits = window.Wordbound.Traits;
  const WORDLIST = window.Wordbound.WORDLIST;

  // Find a word that deals enough damage to one-shot this monster
  let word = null;
  const monsterMaxHp = state.monster.maxHp;
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
    if (damage >= monsterMaxHp) {
      word = w;
      break;
    }
  }

  if (!word) {
    console.log('Could not find a one-shot word. Trying any damage word...');
    for (let i = 0; i < WORDLIST.length; i++) {
      const w = WORDLIST[i];
      if (w.length < 2 || w.length > state.player.rack.length) continue;
      if (!Lexicon.isValidWord(w)) continue;
      const formed = Lexicon.canFormFromRack(w, state.player.rack);
      if (!formed.possible) continue;
      const score = Lexicon.scoreWord(w, formed.tilesUsed);
      const mult = trait ? trait.multiplier(w, formed.tilesUsed) : 1;
      if (Math.round(score.total * mult) > 0) {
        word = w;
        break;
      }
    }
  }

  if (!word) {
    console.log('SKIP: No playable word found for this monster');
    process.exit(0);
  }

  const beforeGold = state.player.gold;
  const beforeScreen = state.screen;
  const beforeMonsterHp = state.monster.hp;

  // Play the word
  document.getElementById('word-input').value = word;
  document.getElementById('btn-submit-word').dispatchEvent(new window.Event('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 50));

  // Check results
  console.log('\n=== RNG Fix Verification ===');

  if (errors.length > 0) {
    console.log('FAIL: Errors during word submission');
    errors.forEach((e) => console.log('  ERR:', e));
    process.exit(1);
  }

  console.log('PASS: No errors during word submission');

  // If monster HP is now <= 0, verify the gold and screen transition
  if (state.monster.hp <= 0) {
    console.log('PASS: Monster was defeated (HP <= 0)');

    const afterGold = state.player.gold;
    const afterScreen = state.screen;

    if (afterGold > beforeGold) {
      console.log('PASS: Gold was awarded (' + beforeGold + ' -> ' + afterGold + ')');
    } else {
      console.log('FAIL: Gold was NOT awarded (stayed at ' + beforeGold + ')');
      process.exit(1);
    }

    if (afterScreen === 'TILE_REWARD') {
      console.log('PASS: Screen transitioned to TILE_REWARD');
    } else {
      console.log('FAIL: Screen did not transition to TILE_REWARD (is: ' + afterScreen + ')');
      process.exit(1);
    }

    console.log('\n=== All RNG Fix Verifications PASSED ===');
  } else {
    console.log('INFO: Monster still alive after word play. Test inconclusive (but no errors is good).');
  }

  process.exit(0);
}

main().catch((e) => {
  console.error('SCRIPT CRASHED:', e);
  process.exit(1);
});
