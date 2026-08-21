#!/usr/bin/env node
/**
 * Real-browser verification for the "NO SOUND AT ALL" ticket (GOALS.md,
 * 2026-08-21). jsdom (test/dom-check.js's audio checks) can only assert
 * which SFX *tried* to play, via the sfxCallLog test hook -- it has no real
 * Web Audio API, so it can't tell us whether the AudioContext ever actually
 * left the 'suspended' state or whether any oscillator node was really
 * scheduled. This script checks exactly that, in real Chromium:
 *
 *   1. After a single real user gesture (a click), the AudioContext this
 *      game creates reaches 'running', not stuck 'suspended'.
 *   2. The shared SFX gain node's value is > 0 (not accidentally zeroed).
 *   3. Playing an actual word schedules real OscillatorNode.start() calls.
 *
 * Does NOT and cannot verify: that sound is audible on real hardware (esp.
 * iOS Safari's hardware ringer/silent switch, which mutes WebAudio with no
 * JS-visible signal) -- see PROGRESS.md for what's confirmed vs. not.
 */

const { chromium } = require('@playwright/test');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 9882;
let server;

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const filePath = path.join(__dirname, '..', req.url === '/' ? 'wordbound.html' : req.url);
      fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end('Not found'); return; }
        const ext = path.extname(filePath);
        const contentType = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'text/html';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });
    server.listen(PORT, resolve);
  });
}

async function main() {
  const failures = [];
  function check(cond, msg) {
    if (!cond) failures.push(msg);
    console.log((cond ? 'OK   ' : 'FAIL ') + msg);
  }

  await startServer();

  const sandboxChromiumPath = '/opt/pw-browsers/chromium';
  const launchOpts = { headless: true };
  if (fs.existsSync(sandboxChromiumPath)) launchOpts.executablePath = sandboxChromiumPath;
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();

  // Instrument AudioContext/OscillatorNode before any game script runs, so
  // we can observe real Web Audio behavior without needing game.js to
  // expose its private audioContext/sfxGainNode closure variables.
  await page.addInitScript(() => {
    window.__ctxLog = [];
    const RealAC = window.AudioContext || window.webkitAudioContext;
    function WrappedAC(...args) {
      const ctx = new RealAC(...args);
      window.__ctxLog.push(ctx);
      window.__lastCtx = ctx;
      return ctx;
    }
    window.AudioContext = WrappedAC;
    window.webkitAudioContext = WrappedAC;

    window.__oscStarts = 0;
    const realStart = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) {
      window.__oscStarts++;
      return realStart.apply(this, args);
    };

    // AUDIO ticket follow-up (GOALS.md, 2026-08-21, iPhone "still silent"
    // report): instrument the Audio element constructor so we can observe
    // the silent-looping-<audio> iOS-playback-category trick without game.js
    // needing to expose its private silentAudioEl closure variable.
    window.__audioEls = [];
    const RealAudio = window.Audio;
    window.Audio = function (...args) {
      const el = new RealAudio(...args);
      window.__audioEls.push(el);
      return el;
    };
  });

  try {
    await page.goto(`http://localhost:${PORT}/wordbound.html`);
    await page.waitForTimeout(300);

    // Real user gesture #1: New Run.
    await page.click('#btn-new-run');
    await page.waitForTimeout(150);
    const charBtn = await page.$('.character-option');
    check(!!charBtn, 'character-select screen rendered at least one option');
    if (charBtn) {
      await charBtn.click(); // real gesture #2: pick a character, starts the run
      await page.waitForTimeout(200);
    }

    const ctxCountAfterRunStart = await page.evaluate(() => window.__ctxLog.length);
    check(ctxCountAfterRunStart >= 1, 'an AudioContext was created by run start (' + ctxCountAfterRunStart + ' created)');

    const stateAfterGesture = await page.evaluate(() => (window.__lastCtx ? window.__lastCtx.state : null));
    check(stateAfterGesture === 'running', 'AudioContext.state is "running" after a real user gesture (got "' + stateAfterGesture + '")');

    // Enter the first node (another real gesture) to reach combat, where
    // sfxGainNode/musicGainNode get created.
    const nodePill = await page.$('.node-pill.node-current');
    check(!!nodePill, 'node map rendered a clickable current node');
    if (nodePill) { await nodePill.click(); await page.waitForTimeout(300); }

    // The first-ever combat auto-opens the How-to-Play overlay and steals
    // clicks -- close it like a real player would.
    const howtoClose = await page.$('#btn-close-howto');
    if (howtoClose) { await howtoClose.click(); await page.waitForTimeout(150); }

    const combatActive = await page.evaluate(() => {
      const state = window.Wordbound.Game._state;
      return !!(state && state.combatActive);
    });
    check(combatActive, 'combat is active after entering the first node');

    const gainInfo = await page.evaluate(() => {
      // sfxGainNode/musicGainNode are private to game.js -- probe the fixed
      // default volume via the Game._audioSettings() test hook (the volume
      // slider that used to reflect this in the DOM is gone as of the UX
      // ticket, GOALS.md 2026-08-21 batch item 4/7: audio plays at a fixed
      // default now, with only a mute toggle left as a user control).
      const settings = window.Wordbound.Game._audioSettings();
      return { volume: settings.volume, muted: settings.muted };
    });
    check(gainInfo.volume > 0, 'default audio volume is > 0 (' + gainInfo.volume + '), not accidentally zeroed');
    check(gainInfo.muted === false, 'audio is not muted by default');

    // Play a real word -- exercises playCombatSound (the oldest, most
    // player-visible sound) end to end.
    const wordToPlay = await page.evaluate(() => {
      const state = window.Wordbound.Game._state;
      if (!state || !state.combatActive) return null;
      const Lexicon = window.Wordbound.Lexicon;
      const Traits = window.Wordbound.Traits;
      const monster = state.monster;
      const hpRatio = monster.maxHp > 0 ? monster.hp / monster.maxHp : 0;
      const activeTraitId = Traits.activeTraitForHpRatio(monster.traitPhases, hpRatio);
      const trait = Traits.TRAITS[activeTraitId];
      // Avoid a word that would deal 0 damage against the monster's current
      // weakness/immunity (playCombatSound only fires when damage > 0) --
      // that's a real game rule, not a bug, so pick around it like a player
      // reading the "Weakness:" hint would, instead of tripping over it.
      for (const word of window.Wordbound.WORD_SET) {
        if (word.length > 8) continue;
        const formed = Lexicon.canFormFromRack(word, state.player.rack);
        if (!formed.possible) continue;
        const mult = trait ? trait.multiplier(word.toUpperCase(), formed.tilesUsed) : 1;
        if (mult > 0) return word;
      }
      return null;
    });
    check(!!wordToPlay, 'found a playable word from the current rack (' + wordToPlay + ')');

    const oscStartsBefore = await page.evaluate(() => window.__oscStarts);
    if (wordToPlay) {
      // UX ticket (GOALS.md 2026-08-21 batch item 1/7): word-building is
      // click-tiles-only now -- #word-input is gone. Resolve to the specific
      // rack tile instances (same as the real submit path) and click each
      // one via real Playwright clicks.
      const tileIds = await page.evaluate((w) => {
        const state = window.Wordbound.Game._state;
        const Lexicon = window.Wordbound.Lexicon;
        const rackPool = state.player.rack.filter((t) => t.id !== state.hexedTileId);
        const formed = Lexicon.canFormFromRack(w, rackPool);
        return formed.possible ? formed.tilesUsed.map((t) => t.id) : null;
      }, wordToPlay);
      for (const tileId of tileIds || []) {
        await page.click('[data-tile-id="' + tileId + '"]');
      }
      await page.click('#btn-submit-word');
      // playCombatSound is deferred behind a setTimeout(TILE_PLAY_ANIM_MS =
      // 220ms in game.js) so the tile-play CSS animation is visible before
      // the rack rebuilds -- wait past that, not just past the click.
      await page.waitForTimeout(500);
    }
    const oscStartsAfter = await page.evaluate(() => window.__oscStarts);
    check(oscStartsAfter > oscStartsBefore, 'playing a word scheduled at least one real OscillatorNode.start() call (' + oscStartsBefore + ' -> ' + oscStartsAfter + ')');

    const finalState = await page.evaluate(() => (window.__lastCtx ? window.__lastCtx.state : null));
    check(finalState === 'running', 'AudioContext.state is still "running" after playing a word (got "' + finalState + '")');

    // AUDIO ticket follow-up (GOALS.md, 2026-08-21, iPhone "still silent"
    // report, part 1 -- one-shot prime bug): the old primeAudioOnce removed
    // its own listeners after the very first gesture, so if iOS suspended
    // or interrupted the context later (backgrounding, a phone call, tab
    // restore), nothing was left to retry resume() on the next gesture.
    // Simulate that: force the context back to 'suspended', fire another
    // real gesture, and confirm it recovers -- this would have FAILED
    // against the old one-shot code (no listener left to catch it).
    await page.evaluate(async () => { await window.__lastCtx.suspend(); });
    const stateAfterForcedSuspend = await page.evaluate(() => window.__lastCtx.state);
    check(stateAfterForcedSuspend === 'suspended', 'test setup: forcibly suspended the context (got "' + stateAfterForcedSuspend + '")');
    await page.keyboard.press('Shift'); // a real gesture, distinct from any click already used above
    await page.waitForTimeout(150);
    const stateAfterReGesture = await page.evaluate(() => window.__lastCtx.state);
    check(stateAfterReGesture === 'running', 'a LATER gesture (after the context was suspended mid-session) re-resumes it, not just the first-ever gesture (got "' + stateAfterReGesture + '")');

    // AUDIO ticket follow-up, part 2 -- iOS hardware ringer/silent switch:
    // confirm the silent-looping-<audio> "playback category" element was
    // actually created and is actively (not just nominally) playing. Can't
    // verify it changes iOS's real audio routing from headless Linux
    // Chromium -- only that the mitigation's own mechanics are wired up.
    const silentAudioInfo = await page.evaluate(() => {
      const els = window.__audioEls || [];
      const el = els[els.length - 1];
      if (!el) return null;
      return { count: els.length, loop: el.loop, paused: el.paused, volume: el.volume, srcStartsWithWav: el.src.indexOf('data:audio/wav') === 0 };
    });
    check(!!silentAudioInfo, 'a silent <audio> element was created via the wrapped Audio() constructor');
    if (silentAudioInfo) {
      check(silentAudioInfo.count === 1, 'exactly one silent <audio> element created across all gestures so far, not re-created every time (got ' + silentAudioInfo.count + ')');
      check(silentAudioInfo.loop === true, 'the silent <audio> element loops (needs to keep "playing" for the duration of the page, not just once)');
      check(silentAudioInfo.paused === false, 'the silent <audio> element is actively playing, not just constructed (paused=' + silentAudioInfo.paused + ')');
      check(silentAudioInfo.volume === 1, 'the silent <audio> element is NOT volume-zeroed (that would defeat the "playback category" trick -- it must be a real, if inaudible, playing stream)');
      check(silentAudioInfo.srcStartsWithWav, 'the silent <audio> element\'s source is an inline WAV data URI (no external asset dependency)');
    }
  } finally {
    await browser.close();
    server.close();
  }

  console.log('');
  if (failures.length > 0) {
    console.error(failures.length + ' FAILURE(S):');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  } else {
    console.log('ALL CHECKS PASSED');
    console.log('NOTE: this confirms the AudioContext runs and schedules real nodes in headless');
    console.log('Chromium. It cannot confirm audibility on real hardware, especially iOS Safari\'s');
    console.log('hardware ringer switch (no JS-visible signal for that). See PROGRESS.md.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('CRASH:', err);
  if (server) server.close();
  process.exit(1);
});
