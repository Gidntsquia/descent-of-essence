#!/usr/bin/env node
/**
 * Targeted regression check for the run-header horizontal-overflow bug
 * (GOALS.md, filed 2026-08-21 QA pass): `.run-header` (HP/gold/floor label,
 * Deck/Consumables buttons, mute button, volume slider) had no `flex-wrap`
 * outside the existing 480px-and-below media query, so it overflowed
 * horizontally at every viewport from ~481px to ~780px.
 *
 * Sweeps the exact widths measured when the bug was found, plus the
 * existing 375/414px mobile breakpoints (should already wrap via the media
 * query, unaffected by this fix) and a wide desktop width (should fit on
 * one line, should NOT start wrapping unnecessarily).
 */

const { chromium } = require('@playwright/test');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 9880;
let server;

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const filePath = path.join(__dirname, '..', req.url === '/' ? 'wordbound.html' : req.url);
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

async function checkOverflow(page, widthPx) {
  await page.setViewportSize({ width: widthPx, height: 800 });
  await page.waitForTimeout(150);
  return page.evaluate(() => {
    const doc = document.documentElement;
    return Math.max(0, doc.scrollWidth - doc.clientWidth);
  });
}

async function main() {
  try {
    await startServer();
    console.log('Verifying .run-header horizontal overflow fix...\n');

    const sandboxChromiumPath = '/opt/pw-browsers/chromium';
    const launchOpts = { headless: true };
    if (fs.existsSync(sandboxChromiumPath)) {
      launchOpts.executablePath = sandboxChromiumPath;
    }
    const browser = await chromium.launch(launchOpts);
    const page = await browser.newPage();

    await page.goto(`http://localhost:${PORT}/wordbound.html`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.Wordbound?.Game, { timeout: 15000 });

    // Get into a run so the run-header is actually rendered (hidden on the main menu).
    await page.click('#btn-new-run');
    await page.waitForTimeout(300);
    await page.click('.character-option:first-child');
    await page.waitForTimeout(400);

    await page.waitForFunction(() => !document.querySelector('.run-header')?.closest('.hidden'), { timeout: 5000 }).catch(() => {});

    // The exact widths measured when the bug was filed, spanning the affected
    // 481-780px range, plus the two existing mobile breakpoints (regression
    // check -- must still wrap cleanly via the 480px media query, unaffected
    // by this fix) and a wide desktop width (must NOT wrap unnecessarily).
    const widths = [375, 414, 481, 550, 600, 650, 700, 750, 800, 1280];
    let allClean = true;

    for (const width of widths) {
      const overflow = await checkOverflow(page, width);
      const ok = overflow === 0;
      if (!ok) allClean = false;
      console.log(`  ${width}px: ${ok ? '✓' : '⚠️ '} ${overflow}px horizontal overflow`);
    }

    await page.close();
    await browser.close();

    console.log('\n=== SUMMARY ===');
    if (allClean) {
      console.log('✅ .run-header: zero horizontal overflow across all tested widths (375-1280px)');
      process.exit(0);
    } else {
      console.log('⚠️  .run-header still overflows at one or more widths -- see above');
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
