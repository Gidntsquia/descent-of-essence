// Quick check: does wordbound.html load and initialize via file:// (not http://)
const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');

const htmlPath = path.join(__dirname, '..', 'wordbound.html');
const html = fs.readFileSync(htmlPath, 'utf-8');

const dom = new JSDOM(html, {
  url: 'file://' + htmlPath,  // Simulate file:// protocol, not http://
  runScripts: 'dangerously',
  resources: 'usable',
  beforeParse(window) {
    // Shim console to catch any errors
    window.caughtErrors = [];
    window.addEventListener('error', (e) => {
      window.caughtErrors.push(e.message);
    });
  }
});

// Wait for scripts to load
dom.window.addEventListener('load', () => {
  const errors = dom.window.caughtErrors;
  const gameExists = dom.window.Wordbound && dom.window.Wordbound.Game;
  
  if (errors.length > 0) {
    console.error('ERROR: Page errors on file:// load:');
    errors.forEach(e => console.error('  -', e));
    process.exit(1);
  }
  
  if (!gameExists) {
    console.error('ERROR: Wordbound.Game not initialized on file://');
    process.exit(1);
  }
  
  console.log('OK   wordbound.html loads and initializes via file:// protocol (no server required)');
  process.exit(0);
});

// Timeout in case load event doesn't fire
setTimeout(() => {
  console.error('ERROR: Load event timeout');
  process.exit(1);
}, 5000);
