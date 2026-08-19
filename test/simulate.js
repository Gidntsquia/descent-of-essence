// test/simulate.js
//
// Balance analysis: verifies game data structure integrity and basic requirements.
//
// Usage: node test/simulate.js
// Run after npm install (requires jsdom).

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function analyze() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'wordbound.html'), 'utf8');

  const dom = new JSDOM(html, {
    url: 'file://' + path.join(__dirname, '..', 'wordbound.html'),
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true
  });

  await new Promise(resolve => setTimeout(resolve, 300));
  const window = dom.window;
  const Game = window.Wordbound?.Game;
  const Lexicon = window.Wordbound?.Lexicon;
  const Monsters = window.Wordbound?.Monsters;
  const Items = window.Wordbound?.Items;
  const Traits = window.Wordbound?.Traits;
  const Floor = window.Wordbound?.Floor;

  if (!Game || !Lexicon || !Monsters) {
    console.error('Failed to load game modules');
    process.exit(1);
  }

  console.log('Running game balance analysis...\n');

  let issues = [];
  let warnings = [];
  let passed = 0;

  // Check 1: Dictionary
  if (Lexicon.WORD_SET && Lexicon.WORD_SET.size > 10000) {
    console.log('✓ Dictionary: ' + Lexicon.WORD_SET.size.toLocaleString() + ' words loaded');
    passed++;
  } else {
    console.log('✗ Dictionary problem');
    issues.push('Dictionary empty or too small (found ' + (Lexicon.WORD_SET?.size || 0) + ')');
  }

  // Check 2: Monsters exist
  const monsterCount = Object.keys(Monsters.MONSTER_DEFS).length;
  if (monsterCount >= 6) {
    console.log('✓ Monster definitions: ' + monsterCount + ' regular monsters');
    passed++;
  } else {
    console.log('✗ Not enough regular monsters');
    issues.push('Only ' + monsterCount + ' regular monsters (need 6+)');
  }

  // Check 3: Bosses exist
  const bossCount = Object.keys(Monsters.BOSS_DEFS).length;
  if (bossCount >= 3) {
    console.log('✓ Boss definitions: ' + bossCount + ' bosses');
    passed++;
  } else {
    console.log('✗ Not enough bosses');
    issues.push('Only ' + bossCount + ' bosses (need 3 for 3-floor run)');
  }

  // Check 4: Traits
  const traitCount = Traits && Object.keys(Traits.TRAITS).length;
  if (traitCount > 0) {
    console.log('✓ Traits: ' + traitCount + ' monster traits defined');
    passed++;
  } else {
    console.log('✗ No traits defined');
    issues.push('Traits system not loaded');
  }

  // Check 5: Items
  const itemCount = Items && Object.keys(Items.ITEM_DEFS).length;
  if (itemCount > 0) {
    console.log('✓ Items: ' + itemCount + ' permanent items available');
    passed++;
  } else {
    console.log('✗ No items defined');
    issues.push('Items system not loaded');
  }

  // Check 6: Game state structure
  if (Game._state) {
    console.log('✓ Game state structure: accessible via Game._state');
    passed++;

    // Check state properties
    const state = Game._state;
    if (state.player && state.player.hp > 0 && state.player.rack) {
      console.log('  ✓ Player state initialized');
    } else {
      console.log('  ✗ Player state incomplete');
      issues.push('Player state missing required fields');
    }
  } else {
    console.log('✗ Game state not accessible');
    issues.push('Game._state not exposed');
  }

  // Check 7: Tier assignment
  let tierIssues = [];
  for (const [id, def] of Object.entries(Monsters.MONSTER_DEFS)) {
    if (!def.tier || !['weak', 'normal', 'strong'].includes(def.tier)) {
      tierIssues.push(id + ' has invalid tier: ' + def.tier);
    }
  }
  if (tierIssues.length === 0) {
    console.log('✓ Monster tiers: all monsters properly classified');
    passed++;
  } else {
    console.log('⚠ Tier issues: ' + tierIssues.length);
    warnings.push('Monster tiers: ' + tierIssues.join('; '));
  }

  // Check 8: Gold drops
  let noGoldMonsters = [];
  for (const [id, def] of Object.entries(Monsters.MONSTER_DEFS)) {
    if (!def.goldDrop || !Array.isArray(def.goldDrop) || def.goldDrop.length < 2) {
      noGoldMonsters.push(id);
    }
  }
  if (noGoldMonsters.length === 0) {
    console.log('✓ Gold drops: all monsters award gold');
    passed++;
  } else {
    console.log('⚠ Gold drops: ' + noGoldMonsters.length + ' monsters missing drops');
    warnings.push('Gold missing from: ' + noGoldMonsters.join(', '));
  }

  // Print summary
  console.log('\n========== ANALYSIS SUMMARY ==========\n');
  console.log('Checks passed: ' + passed + ' / 8');

  if (issues.length > 0) {
    console.log('\n❌ Critical issues found:');
    issues.forEach((issue, i) => console.log('  ' + (i+1) + '. ' + issue));
  }

  if (warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    warnings.forEach((warn, i) => console.log('  ' + (i+1) + '. ' + warn));
  }

  if (issues.length === 0) {
    console.log('\n✅ All critical checks passed!');
    console.log('\nThe game structure is complete and ready for playtesting.');
    console.log('Next: manual playtest in browser to verify gameplay experience.\n');
    return 0;
  } else {
    console.log('\n❌ Fix issues before launch\n');
    return 1;
  }
}

analyze().then(code => process.exit(code))
         .catch(err => { console.error('Analysis failed:', err); process.exit(1); });
