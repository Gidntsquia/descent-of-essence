// UX ticket (GOALS.md 2026-08-21 batch item 1/7): "REMOVE the typing
// interface on computer" -- #word-input is gone from the DOM entirely, and
// word-building is click-tiles-only on every device now, exact parity with
// mobile. jsdom (test/dom-check.js) already exercises the click-handler
// logic end to end, but it can't render CSS or a real desktop (fine-pointer,
// no touch) viewport -- this Playwright pass proves the actual thing the
// ticket asked for in a real browser: a full word played on a DESKTOP
// viewport using nothing but tile clicks, with #word-input verified absent
// and keyboard letter-entry verified inert.
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
    // Desktop viewport, fine pointer, no touch -- the exact context this
    // ticket is about (mobile/touch already had tile-only staging before
    // this ticket; the gap was desktop).
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, hasTouch: false });
    const page = await context.newPage();

    page.on('console', (msg) => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', (err) => console.error('PAGE ERROR:', err));

    await page.goto('file://' + path.join(__dirname, '..', 'wordbound.html'));

    check('#word-input does not exist in the DOM at all', await page.locator('#word-input').count() === 0);

    await page.click('#btn-new-run');
    await page.waitForSelector('.character-option');
    await page.click('.character-option');
    await page.waitForSelector('.node-pill', { timeout: 5000 });

    const combatNode = page.locator('.node-pill').first();
    await combatNode.click();
    await page.waitForSelector('.letter-tile');

    // A fresh browser context has no localStorage history, so the "How to
    // Play" overlay auto-shows on this first-ever combat entry and sits on
    // top of the rack, intercepting clicks. Dismiss it before testing.
    if (await page.isVisible('#howto-overlay')) {
      const tip = await page.textContent('#howto-blank-tip');
      check('How to Play blank tip describes clicking the blank tile (not typing)', /click the blank tile/i.test(tip));
      await page.click('#btn-close-howto');
    }

    check('staged word starts empty', await page.evaluate(() => window.Wordbound.Game._stagedWord()) === '');

    // ---- Keyboard letter-entry must be inert: there's no input to focus,
    // so typing keys anywhere on the page must not build a word. ----
    await page.keyboard.type('ZZZZZ');
    check('typing on the keyboard does not build a staged word', await page.evaluate(() => window.Wordbound.Game._stagedWord()) === '');

    // ---- Click rack tiles (mouse, not touch) to build and play a real word ----
    const rack = await page.evaluate(() => window.Wordbound.Game._state.player.rack.map((t) => ({ id: t.id, letter: t.letter })));
    const formed = await page.evaluate((rackArg) => {
      const state = window.Wordbound.Game._state;
      const WordList = window.Wordbound.WORDLIST;
      const Lex = window.Wordbound.Lexicon;
      for (let i = 0; i < WordList.length; i++) {
        const w = WordList[i];
        if (w.length < 2 || w.length > rackArg.length) continue;
        if (!Lex.isValidWord(w)) continue;
        const f = Lex.canFormFromRack(w, state.player.rack);
        if (f.possible) return { word: w, tileIds: f.tilesUsed.map((t) => t.id) };
      }
      return null;
    }, rack);
    check('found a playable word from the starting rack', !!formed);

    if (formed) {
      for (const tileId of formed.tileIds) {
        await page.click('[data-tile-id="' + tileId + '"]');
      }
      const stagedWord = await page.evaluate(() => window.Wordbound.Game._stagedWord());
      check('clicking rack tiles staged exactly the target word (got ' + JSON.stringify(stagedWord) + ', expected ' + JSON.stringify(formed.word) + ')',
        stagedWord === formed.word);

      const previewText = await page.textContent('#damage-preview');
      check('the damage preview reflects the mouse-staged word (not neutral "--")', previewText.trim() !== '--');

      const hpBefore = await page.evaluate(() => window.Wordbound.Game._state.monster.hp);
      await page.click('#btn-submit-word');
      await page.waitForTimeout(500);
      const hpAfter = await page.evaluate(() => window.Wordbound.Game._state.monster.hp);
      check('Play Word (mouse click) actually played the word (monster HP changed or a message logged)',
        hpAfter !== hpBefore || (await page.evaluate(() => window.Wordbound.Game._state.messages.length)) > 0);
    }

    console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
    await context.close();
  } finally {
    await browser.close();
  }
  process.exitCode = failures === 0 ? 0 : 1;
})();
