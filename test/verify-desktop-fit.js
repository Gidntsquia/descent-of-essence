#!/usr/bin/env node
/**
 * LAYOUT ticket (GOALS.md, Jaxon batch item 7/7): "everything fits in ONE
 * screen on computer, no scrolling" across every core screen. Checks
 * document.documentElement for vertical overflow (scrollHeight vs.
 * clientHeight, small tolerance) at two common desktop viewports -- 1366x768
 * (the most common laptop resolution) and 1920x1080 (the most common
 * external-monitor/desktop resolution) -- across every core screen: main
 * menu, character select, the branching node map, combat, shop, the three
 * item/tile-reward screens, an event, and game-over/victory.
 *
 * Mirrors test/verify-mobile-layout.js's structure (real browser, real
 * server, same screen-reaching techniques) but checks the opposite axis:
 * mobile cares about horizontal overflow at NARROW/tall viewports, this
 * cares about vertical overflow at WIDE/short ones.
 *
 * Menu/character-select/map/combat are reached via real clicks, same as the
 * mobile script. Shop/treasure/tile-reward/boss-item-reward/event/victory
 * are reached by forcing `state.screen` directly (same technique the mobile
 * script already uses for GAME_OVER) rather than hunting for a specific
 * random node/seed that happens to contain one -- deterministic, no
 * flakiness, and this project's own established pattern for these
 * particular screens (window.Wordbound.Game._state is exposed specifically
 * for this kind of headless/browser test inspection). Each force explicitly
 * clears `state.combatActive = false` first -- these screens are never
 * reached mid-combat in real play, and leaving a stale `true` behind (e.g.
 * from an earlier step in this same script) would leave combat-panel
 * visible underneath, which is a test-harness artifact, not a real
 * (or fixable) layout bug -- confirmed by hand while building this script,
 * see PROGRESS.md.
 */

const { chromium } = require('@playwright/test');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 9882;
let server;

async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let filePath = path.join(__dirname, '..', req.url === '/' ? 'wordbound.html' : req.url);
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath);
        let contentType = 'text/html';
        if (ext === '.js') contentType = 'application/javascript';
        if (ext === '.css') contentType = 'text/css';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });
    server.listen(PORT, resolve);
  });
}

const VIEWPORTS = [
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 }
];

// Small tolerance for sub-pixel rounding across engines/DPI, same spirit as
// the ticket's own "small tolerance" wording.
const OVERFLOW_TOLERANCE_PX = 2;

async function checkFit(page, label) {
  let anyFailed = false;
  for (const { width, height } of VIEWPORTS) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => {
      const el = document.documentElement;
      return { scrollHeight: el.scrollHeight, clientHeight: el.clientHeight };
    });
    const overflow = r.scrollHeight - r.clientHeight;
    const ok = overflow <= OVERFLOW_TOLERANCE_PX;
    if (!ok) anyFailed = true;
    console.log(`  ${width}x${height}: scrollHeight=${r.scrollHeight} clientHeight=${r.clientHeight}` +
      (ok ? ' ✓' : `  ⚠️  overflow ${overflow}px`));
  }
  console.log(`  ${anyFailed ? '⚠️ ' : '✓'} ${label} ${anyFailed ? 'DOES NOT FIT' : 'fits one screen'}\n`);
  return !anyFailed;
}

async function main() {
  let allOk = true;
  try {
    await startServer();
    console.log('Starting desktop one-screen-fit verification...\n');

    const sandboxChromiumPath = '/opt/pw-browsers/chromium';
    const launchOpts = { headless: true };
    if (fs.existsSync(sandboxChromiumPath)) launchOpts.executablePath = sandboxChromiumPath;
    const browser = await chromium.launch(launchOpts);
    const page = await browser.newPage();

    await page.goto(`http://localhost:${PORT}/wordbound.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.Wordbound?.Game, { timeout: 15000 });

    console.log('Main menu:');
    allOk = (await checkFit(page, 'Main menu')) && allOk;

    console.log('Character select:');
    await page.click('#btn-new-run');
    await page.waitForTimeout(200);
    allOk = (await checkFit(page, 'Character select')) && allOk;

    console.log('Node map:');
    await page.click('.character-option:first-child');
    await page.waitForTimeout(400);
    allOk = (await checkFit(page, 'Node map')) && allOk;

    console.log('Combat:');
    await page.click('.node-pill:first-child');
    await page.waitForTimeout(400);
    await page.waitForFunction(() => document.getElementById('combat-panel').classList.contains('hidden') === false, { timeout: 5000 }).catch(() => {});
    allOk = (await checkFit(page, 'Combat')) && allOk;

    console.log('Shop:');
    await page.evaluate(() => {
      const state = window.Wordbound.Game._state;
      const Items = window.Wordbound.Items;
      state.combatActive = false;
      state.screen = 'SHOP';
      state.shopOptions = Object.keys(Items.ITEM_DEFS).slice(0, 3).concat(['c:errata_slip']);
      window.Wordbound.Game.openDeckViewer();
      window.Wordbound.Game.closeDeckViewer();
    });
    await page.waitForTimeout(100);
    allOk = (await checkFit(page, 'Shop')) && allOk;

    console.log('Treasure (item pick):');
    await page.evaluate(() => {
      const state = window.Wordbound.Game._state;
      const Items = window.Wordbound.Items;
      state.combatActive = false;
      state.screen = 'TREASURE';
      state.treasureOptions = Object.keys(Items.ITEM_DEFS).slice(0, 3);
      window.Wordbound.Game.openDeckViewer();
      window.Wordbound.Game.closeDeckViewer();
    });
    await page.waitForTimeout(100);
    allOk = (await checkFit(page, 'Treasure')) && allOk;

    console.log('Tile reward:');
    await page.evaluate(() => {
      const state = window.Wordbound.Game._state;
      const Tiles = window.Wordbound.Tiles;
      state.combatActive = false;
      state.screen = 'TILE_REWARD';
      state.tileRewardOptions = ['A', 'B', 'C'].map((l) => Tiles.createTile(l, null));
      window.Wordbound.Game.openDeckViewer();
      window.Wordbound.Game.closeDeckViewer();
    });
    await page.waitForTimeout(100);
    allOk = (await checkFit(page, 'Tile reward')) && allOk;

    console.log('Boss item reward:');
    await page.evaluate(() => {
      const state = window.Wordbound.Game._state;
      const Items = window.Wordbound.Items;
      state.combatActive = false;
      state.screen = 'BOSS_ITEM_REWARD';
      state.bossRewardOptions = Object.keys(Items.ITEM_DEFS).slice(0, 3);
      window.Wordbound.Game.openDeckViewer();
      window.Wordbound.Game.closeDeckViewer();
    });
    await page.waitForTimeout(100);
    allOk = (await checkFit(page, 'Boss item reward')) && allOk;

    console.log('Event:');
    await page.evaluate(() => {
      const state = window.Wordbound.Game._state;
      const Events = window.Wordbound.Events;
      const eventId = Object.keys((Events && Events.EVENT_DEFS) || {})[0];
      state.combatActive = false;
      state.screen = 'EVENT';
      state.currentEventId = eventId;
      window.Wordbound.Game.openDeckViewer();
      window.Wordbound.Game.closeDeckViewer();
    });
    await page.waitForTimeout(100);
    allOk = (await checkFit(page, 'Event')) && allOk;

    console.log('Game over:');
    await page.evaluate(() => {
      const state = window.Wordbound.Game._state;
      state.combatActive = false;
      state.screen = 'GAME_OVER';
      window.Wordbound.Game.openDeckViewer();
      window.Wordbound.Game.closeDeckViewer();
    });
    await page.waitForTimeout(100);
    allOk = (await checkFit(page, 'Game over')) && allOk;

    console.log('Victory:');
    await page.evaluate(() => {
      const state = window.Wordbound.Game._state;
      state.combatActive = false;
      state.screen = 'VICTORY';
      window.Wordbound.Game.openDeckViewer();
      window.Wordbound.Game.closeDeckViewer();
    });
    await page.waitForTimeout(100);
    allOk = (await checkFit(page, 'Victory')) && allOk;

    await page.close();
    await browser.close();

    console.log('=== SUMMARY ===');
    if (allOk) {
      console.log('✅ Every core screen fits one screen (no vertical overflow) at 1366x768 and 1920x1080');
      process.exit(0);
    } else {
      console.log('⚠️  One or more screens overflow vertically. See details above.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    if (server) server.close();
  }
}

main();
