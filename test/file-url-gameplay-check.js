// Verify wordbound.html can actually run a full game via file:// (not just load)
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');

const htmlPath = path.join(__dirname, '..', 'wordbound.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

const dom = new JSDOM(html, {
  url: 'file://' + htmlPath,
  runScripts: 'dangerously',
  resources: 'usable'
});

// Wait for scripts to load
dom.window.addEventListener('load', () => {
  const game = dom.window.Wordbound.Game;
  const errors = [];
  
  // Capture any errors during gameplay
  dom.window.addEventListener('error', (e) => {
    errors.push(e.message);
  });
  
  try {
    // Start a new run
    game.startRun();
    
    if (!game._state) {
      throw new Error('game._state not initialized');
    }
    
    // Enter first node (should be combat). Branching map (GOALS.md, run
    // 2/N): floor start offers 2-3 lane choices -- take the first.
    game.enterCurrentNode(game._state.floor.startNodeIds[0]);
    
    // Verify combat started
    if (!game._state.monster) {
      throw new Error('monster not loaded in combat');
    }
    
    // Check that rack has playable tiles
    const rack = game._state.player.rack;
    if (rack.length === 0) {
      throw new Error('rack is empty after combat start');
    }
    
    const rackLetters = rack.map(t => t.letter).join('');
    console.log('OK   file:// gameplay: starts run, enters combat node, combat active with monster health=' + game._state.monster.hp + ', rack=' + rackLetters);
    
    if (errors.length > 0) {
      console.warn('Warnings (non-fatal):', errors);
    }
    
    process.exit(0);
  } catch (e) {
    console.error('ERROR during gameplay check:', e.message);
    process.exit(1);
  }
});

setTimeout(() => {
  console.error('ERROR: Load event timeout during gameplay check');
  process.exit(1);
}, 5000);
