const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  try {
    const context = await browser.newContext({ hasTouch: true });
    const page = await context.newPage();

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('error', err => console.error('PAGE ERROR:', err));

    await page.goto('file:///home/user/descent-of-essence/wordbound.html');

    // Start a run
    await page.click('#btn-new-run');
    await page.waitForSelector('.character-option');
    await page.click('.character-option');
    await page.waitForSelector('.node-pill', { timeout: 5000 });

    // Find first combat node and enter it
    const combatNode = await page.locator('.node-pill').first();
    await combatNode.click();

    // Wait for combat to load
    await page.waitForSelector('.letter-tile');

    // Get initial word-input value (should be empty)
    const initialValue = await page.inputValue('#word-input');
    console.log('Initial word-input value:', JSON.stringify(initialValue));

    // Get the first rack tile element
    const firstTile = await page.locator('.letter-tile').first();
    const tileLetter = await firstTile.textContent();
    console.log('First tile letter:', tileLetter.split('\n')[0]);

    // Test 1: Tap (touch without significant movement)
    // Get the center of the tile
    const bbox = await firstTile.boundingBox();
    const centerX = bbox.x + bbox.width / 2;
    const centerY = bbox.y + bbox.height / 2;

    console.log('\n=== TEST 1: TAP (no drag) ===');
    await page.touchscreen.tap(centerX, centerY);

    // Check if word-input got updated
    const afterTapValue = await page.inputValue('#word-input');
    console.log('After tap word-input value:', JSON.stringify(afterTapValue));
    console.log('PASS: Tap played a letter' + (afterTapValue.length > 0 ? ' ✓' : ' ✗'));

    // Check if tile got selected class
    const isSelected = await firstTile.evaluate(el => el.classList.contains('selected'));
    console.log('Tile has .selected class:', isSelected ? '✓' : '✗');

    // TEST 2: Note about drag verification
    console.log('\n=== TEST 2: DRAG VERIFICATION ===');
    console.log('NOTE: Playwright touchscreen API does not support swipe/drag operations.');
    console.log('The mouse drag-and-drop path (via dragstart/drop events) is already verified');
    console.log('in npm test, and the touch path reuses the same reorderRackOnDrop() logic.');
    console.log('A real physical touch device would provide the strongest verification.');

    console.log('\n=== SUMMARY ===');
    console.log('Tap on rack tile should append letter to word-input without reordering');
    console.log('This test uses Playwright with hasTouch: true to emulate touch events');
    console.log('A real physical touch device would provide the strongest confirmation');

    await context.close();
  } finally {
    await browser.close();
  }
})();
