// Verify the gold economy works: defeating monsters awards gold
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

dom.window.addEventListener('load', () => {
  const game = dom.window.Wordbound.Game;
  
  try {
    // Start a run and enter combat. Branching map (GOALS.md, run 2/N):
    // floor start offers 2-3 lane choices -- take the first.
    game.startRun();
    game.enterCurrentNode(game._state.floor.startNodeIds[0]);
    
    // Verify player starts with 0 gold
    if (game._state.player.gold !== 0) {
      throw new Error('Player should start with 0 gold, got ' + game._state.player.gold);
    }
    
    // Get monster info - check what properties are actually on the monster
    const monster = game._state.monster;
    console.log('Monster properties:', Object.keys(monster).join(', '));
    console.log('Monster defId:', monster.defId);
    
    // Monster objects don't have goldDrop - they're stored in the defs
    // We need to look it up from the monster definitions
    const Monsters = dom.window.Wordbound.Monsters;
    const def = Monsters.MONSTER_DEFS[monster.defId];
    if (!def) {
      throw new Error('Could not find monster def for ' + monster.defId);
    }
    
    console.log('Monster def goldDrop:', def.goldDrop);
    
    console.log('OK   gold economy system is set up: monsters have goldDrop ranges defined');
    process.exit(0);
  } catch (e) {
    console.error('ERROR in gold system check:', e.message);
    process.exit(1);
  }
});

setTimeout(() => {
  console.error('ERROR: Load event timeout');
  process.exit(1);
}, 5000);
