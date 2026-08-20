// Regression guard for the touch tap-to-play double-fire bug (fixed
// 2026-08-20): a real touch tap on a rack tile must append the tapped
// tile's letter to #word-input EXACTLY ONCE and push its id into
// state.selectedTileIds EXACTLY ONCE. A doubled letter (the bug this
// guards) still satisfies a weaker "something got typed" check, which is
// why this asserts exact values/counts, not just non-emptiness.
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const sandboxChromiumPath = '/opt/pw-browsers/chromium';
const launchOpts = fs.existsSync(sandboxChromiumPath) ? { executablePath: sandboxChromiumPath } : {};

let failures = 0;
function check(label, ok) {
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + label);
  if (!ok) failures++;
}

(async () => {
  const browser = await chromium.launch(launchOpts);
  try {
    const context = await browser.newContext({ hasTouch: true });
    const page = await context.newPage();

    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err));

    await page.goto('file://' + path.join(__dirname, '..', 'wordbound.html'));

    await page.click('#btn-new-run');
    await page.waitForSelector('.character-option');
    await page.click('.character-option');
    await page.waitForSelector('.node-pill', { timeout: 5000 });

    const combatNode = page.locator('.node-pill').first();
    await combatNode.click();
    await page.waitForSelector('.letter-tile');

    // A fresh browser context has no localStorage history, so the "How to
    // Play" overlay auto-shows on this first-ever combat entry and sits on
    // top of the rack, intercepting the tap. Dismiss it before testing.
    if (await page.isVisible('#howto-overlay')) {
      await page.click('#btn-close-howto');
    }

    const initialValue = await page.inputValue('#word-input');
    check('word-input starts empty', initialValue === '');

    // ---- TEST 1: single tap plays the letter exactly once ----
    const firstTile = page.locator('.letter-tile').first();
    const expectedLetter = await firstTile.evaluate(el => {
      // childNodes[0] is the raw letter text node; childNodes[1] is the
      // <sub>value</sub> element -- textContent alone concatenates both
      // with no separator (e.g. "T1"), so read the text node directly.
      var raw = el.childNodes[0].textContent;
      return raw === '★' ? '' : raw; // '?' tiles render as a star and contribute no letter
    });
    const tappedTileId = await firstTile.getAttribute('data-tile-id');

    const bbox = await firstTile.boundingBox();
    await page.touchscreen.tap(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2);

    const afterTapValue = await page.inputValue('#word-input');
    check('word-input gains exactly the tapped letter once (got ' + JSON.stringify(afterTapValue) +
      ', expected ' + JSON.stringify(expectedLetter) + ')', afterTapValue === expectedLetter);

    const selectedIdsAfterTap = await page.evaluate(() => window.Wordbound.Game._state.selectedTileIds.slice());
    check('selectedTileIds has exactly one entry (got ' + JSON.stringify(selectedIdsAfterTap) + ')',
      selectedIdsAfterTap.length === 1);
    check('selectedTileIds\' one entry is the tapped tile, not a duplicate of some other tile',
      selectedIdsAfterTap[0] === tappedTileId);

    const isSelected = await firstTile.evaluate(el => el.classList.contains('selected'));
    check('tapped tile has .selected class', isSelected);

    // ---- TEST 2: simulated touch-drag reorder still works and does NOT also append a letter ----
    const tilesBeforeDrag = await page.locator('.letter-tile').all();
    check('at least 2 tiles present for a drag test', tilesBeforeDrag.length >= 2);
    if (tilesBeforeDrag.length >= 2) {
      const wordInputBeforeDrag = await page.inputValue('#word-input');
      const dragTileId = await tilesBeforeDrag[1].getAttribute('data-tile-id');
      const startBox = await tilesBeforeDrag[1].boundingBox();
      const targetBox = await tilesBeforeDrag[0].boundingBox();

      // Dispatch a real touch sequence: touchstart, several touchmove steps
      // past the 10px drag threshold, then touchend at a different tile's position.
      await page.evaluate(({ startX, startY, endX, endY, tileId }) => {
        var el = document.querySelector('[data-tile-id="' + tileId + '"]');
        function touch(type, x, y) {
          var t = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
          el.dispatchEvent(new TouchEvent(type, { touches: type === 'touchend' ? [] : [t], changedTouches: [t], bubbles: true, cancelable: true }));
        }
        touch('touchstart', startX, startY);
        var steps = 5;
        for (var i = 1; i <= steps; i++) {
          touch('touchmove', startX + (endX - startX) * (i / steps), startY + (endY - startY) * (i / steps));
        }
        touch('touchend', endX, endY);
      }, {
        startX: startBox.x + startBox.width / 2, startY: startBox.y + startBox.height / 2,
        endX: targetBox.x + targetBox.width / 2, endY: targetBox.y + targetBox.height / 2,
        tileId: dragTileId,
      });

      const wordInputAfterDrag = await page.inputValue('#word-input');
      check('simulated touch-drag did NOT append a letter to word-input',
        wordInputAfterDrag === wordInputBeforeDrag);

      const rackIdsAfterDrag = await page.evaluate(() => window.Wordbound.Game._state.player.rack.map(t => t.id));
      const draggedNewIndex = rackIdsAfterDrag.indexOf(dragTileId);
      check('dragged tile moved to a different rack position (reorder happened)',
        draggedNewIndex !== -1 && draggedNewIndex !== rackIdsAfterDrag.length && rackIdsAfterDrag[0] === dragTileId);
    }

    console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
    await context.close();
  } finally {
    await browser.close();
  }
  process.exitCode = failures === 0 ? 0 : 1;
})();
