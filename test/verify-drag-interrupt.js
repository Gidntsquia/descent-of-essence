// Real-browser guard for the stuck-drag bug (Jaxon's iPhone/Safari playtest of
// v0.28: a staged tile froze mid-drag, wedged on top of its neighbor). jsdom
// proves the state machine resets on every interruption path, but it has no
// real layout or compositor, so it cannot prove that a tile carrying a live
// inline transform is actually stripped clean in a real engine. This does that:
// it starts a genuine pointer drag on a staged tile (ghost lifted, inline
// transform set), fires the interruption events iOS Safari actually sends when
// it steals a gesture (touchcancel, then a window blur case), and asserts the
// DOM is left with zero drag artifacts and the drag state cleared.
//
// This is the strong proxy for the real-glass bug. True confirmation that iOS
// Safari no longer wedges a tile is Jaxon's on a physical phone -- see
// PROGRESS.md.
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

// Stage at least two rack tiles by tapping them, so the play area holds a
// draggable staged tile with a neighbor to (in the bug) wedge against.
async function stageTwoTiles(page) {
  return page.evaluate(() => {
    const state = window.Wordbound.Game._state;
    state.selectedTileIds = [];
    document.getElementById('word-input').value = '';
    window.Wordbound.Game.openDeckViewer();
    window.Wordbound.Game.closeDeckViewer();
    const rackBtns = Array.from(document.querySelectorAll('#rack-display .letter-tile'))
      .filter((b) => {
        const t = state.player.rack.find((rt) => rt.id === b.getAttribute('data-tile-id'));
        return t && t.letter !== '?';
      });
    if (rackBtns.length < 2) return 0;
    rackBtns[0].dispatchEvent(new Event('click', { bubbles: true }));
    rackBtns[1].dispatchEvent(new Event('click', { bubbles: true }));
    return state.selectedTileIds.length;
  });
}

// Begin a real pointer drag on the first staged tile: pointerdown, then a
// pointermove past the 8px threshold so the ghost lifts and the inline
// transform is set. Returns the live-drag snapshot for assertion.
async function beginStagingDrag(page) {
  return page.evaluate(() => {
    const tile = document.querySelector('#staging-area .staged-tile');
    const box = tile.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    function pe(type, cx, cy) {
      return new PointerEvent(type, { pointerId: 1, clientX: cx, clientY: cy, bubbles: true, cancelable: true });
    }
    tile.dispatchEvent(pe('pointerdown', x, y));
    document.dispatchEvent(pe('pointermove', x + 24, y)); // past threshold -> ghost + transform
    return {
      active: !!window.Wordbound.Game._state.stagingDrag,
      ghost: tile.classList.contains('staging-drag-ghost'),
      transformed: !!tile.style.transform,
    };
  });
}

// After an interruption, the play area must be pristine: no live drag, and no
// staged tile left ghosted, flagged out, or carrying an inline transform.
async function readArtifacts(page) {
  return page.evaluate(() => {
    const area = document.getElementById('staging-area');
    const tiles = Array.from(document.querySelectorAll('#staging-area .staged-tile'));
    return {
      active: !!window.Wordbound.Game._state.stagingDrag,
      areaDragging: area.classList.contains('staging-dragging'),
      anyGhost: tiles.some((t) => t.classList.contains('staging-drag-ghost')),
      anyOut: tiles.some((t) => t.classList.contains('staging-drag-out')),
      anyTransform: tiles.some((t) => !!t.style.transform),
      stagedCount: window.Wordbound.Game._state.selectedTileIds.length,
    };
  });
}

(async () => {
  const browser = await chromium.launch(launchOpts);
  try {
    const context = await browser.newContext({ hasTouch: true });
    const page = await context.newPage();
    page.on('pageerror', (err) => { console.error('PAGE ERROR:', err); failures++; });

    await page.goto('file://' + path.join(__dirname, '..', 'wordbound.html'));
    await page.click('#btn-new-run');
    await page.waitForSelector('.character-option');
    await page.click('.character-option');
    await page.waitForSelector('.node-pill', { timeout: 5000 });
    await page.locator('.node-pill').first().click();
    await page.waitForSelector('.letter-tile');
    if (await page.isVisible('#howto-overlay')) await page.click('#btn-close-howto');

    const staged = await stageTwoTiles(page);
    check('two tiles staged for the drag-interrupt test', staged === 2);
    if (staged === 2) {
      // --- touchcancel mid-drag (iOS steals the gesture) ---
      const live = await beginStagingDrag(page);
      check('drag goes live with a lifted, transformed ghost', live.active && live.ghost && live.transformed);
      await page.evaluate(() => document.dispatchEvent(new Event('touchcancel', { bubbles: true })));
      let a = await readArtifacts(page);
      check('touchcancel clears the live drag', !a.active);
      check('touchcancel leaves NO ghost/out/transform artifact and clears the container',
        !a.anyGhost && !a.anyOut && !a.anyTransform && !a.areaDragging);
      check('touchcancel loses no staged tiles', a.stagedCount === 2);

      // A stray pointermove after the interruption must transform nothing.
      await page.evaluate(() => document.dispatchEvent(
        new PointerEvent('pointermove', { pointerId: 1, clientX: 300, clientY: 40, bubbles: true })));
      a = await readArtifacts(page);
      check('a stray move after touchcancel re-transforms nothing', !a.anyTransform && !a.active);

      // --- window blur mid-drag (app switch / incoming call) ---
      const live2 = await beginStagingDrag(page);
      check('drag goes live again for the blur case', live2.active && live2.transformed);
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      a = await readArtifacts(page);
      check('window blur mid-drag ends the drag with no artifacts',
        !a.active && !a.anyGhost && !a.anyTransform && !a.areaDragging);
      check('window blur loses no staged tiles', a.stagedCount === 2);

      // --- a CLEAN drop still completes normally (guards against the teardown
      // refactor breaking the happy path): begin a drag, then release with a
      // real pointerup inside the play area. No artifact may survive. ---
      await beginStagingDrag(page);
      await page.evaluate(() => {
        const tile = document.querySelector('#staging-area .staged-tile');
        const box = tile.getBoundingClientRect();
        document.dispatchEvent(new PointerEvent('pointerup', {
          pointerId: 1, clientX: box.left + box.width / 2 + 24, clientY: box.top + box.height / 2, bubbles: true,
        }));
      });
      a = await readArtifacts(page);
      check('a clean pointerup drop completes with no artifacts', !a.active && !a.anyGhost && !a.anyTransform);
      check('a clean drop keeps both tiles staged', a.stagedCount === 2);
    }

    console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
    await context.close();
  } finally {
    await browser.close();
  }
  process.exitCode = failures === 0 ? 0 : 1;
})();
