// UX ticket (GOALS.md 2026-08-21 batch item 3/7): "HIDE the mid-screen
// message log unless in debug mode" -- gated behind ?debug=1 in the URL via
// body.debug-mode + a CSS display:none/block toggle (game.js Game.init,
// css/wordbound.css .message-log). jsdom can compute the CSS rule match, but
// this proves it in a real rendering engine as the ticket asks: hidden by
// default, visible with ?debug=1, and that the element stays in the DOM
// (still being written to) either way, not removed.
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

// #message-log lives inside #screen-run, which itself is hidden ("screen
// hidden") until a run starts -- checking isVisible() on the main menu
// would read false regardless of the debug-mode class, testing nothing.
// Start a run so #screen-run is showing before asserting on the log itself.
async function startRun(page) {
  await page.click('#btn-new-run');
  await page.waitForSelector('.character-option');
  await page.click('.character-option');
  await page.waitForSelector('#screen-run.screen:not(.hidden)', { timeout: 5000 });
}

(async () => {
  const browser = await chromium.launch(launchOpts);
  try {
    const htmlPath = 'file://' + path.join(__dirname, '..', 'wordbound.html');

    // ---- Default (no ?debug param): hidden ----
    {
      const page = await browser.newPage();
      page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
      await page.goto(htmlPath);
      check('#message-log is present in the DOM by default', await page.locator('#message-log').count() === 1);
      await startRun(page);
      const el = page.locator('#message-log');
      check('#message-log is hidden by default (no ?debug param)', !(await el.isVisible()));
      await page.close();
    }

    // ---- ?debug=1: visible ----
    {
      const page = await browser.newPage();
      page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
      await page.goto(htmlPath + '?debug=1');
      check('#message-log is present in the DOM with ?debug=1', await page.locator('#message-log').count() === 1);
      await startRun(page);
      const el = page.locator('#message-log');
      check('#message-log is visible with ?debug=1', await el.isVisible());
      await page.close();
    }

    // ---- ?debug=0 (or any other value): still hidden, only '1' opts in ----
    {
      const page = await browser.newPage();
      page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
      await page.goto(htmlPath + '?debug=0');
      await startRun(page);
      const el = page.locator('#message-log');
      check('#message-log stays hidden with ?debug=0 (only "1" opts in)', !(await el.isVisible()));
      await page.close();
    }

    // ---- The log is still being WRITTEN to while hidden (not removed/dead) ----
    {
      const page = await browser.newPage();
      page.on('pageerror', (err) => console.error('PAGE ERROR:', err));
      await page.goto(htmlPath);
      await page.click('#btn-new-run');
      await page.waitForSelector('.character-option');
      await page.click('.character-option');
      await page.waitForSelector('.node-pill', { timeout: 5000 });
      if (await page.isVisible('#howto-overlay')) await page.click('#btn-close-howto');
      const combatNode = page.locator('.node-pill').first();
      await combatNode.click();
      await page.waitForSelector('.letter-tile');

      const messagesLen = await page.evaluate(() => window.Wordbound.Game._state.messages.length);
      check('starting a fight produced at least one log message in state', messagesLen > 0);
      const logHtml = await page.locator('#message-log').innerHTML();
      check('#message-log DOM content reflects state.messages while still hidden', logHtml.length > 0);
      check('#message-log is still hidden during real play (no ?debug)', !(await page.locator('#message-log').isVisible()));
      await page.close();
    }

    console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  } finally {
    await browser.close();
  }
  process.exitCode = failures === 0 ? 0 : 1;
})();
