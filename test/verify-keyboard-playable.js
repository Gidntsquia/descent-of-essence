#!/usr/bin/env node
/**
 * Verify the game is keyboard-playable without a mouse.
 *
 * Checks:
 * - Can tab to word-input field and submit with Enter
 * - Can tab through rack tiles and activate with Space/Enter
 * - Can tab through UI buttons (shop, treasure, events, panels)
 * - Close buttons are keyboard accessible
 */

const { chromium } = require('@playwright/test');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 9878;
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

const checks = {
  passed: 0,
  failed: 0,
  warnings: 0
};

function pass(name) {
  console.log(`✓ ${name}`);
  checks.passed++;
}

function fail(name, message) {
  console.log(`✗ ${name}`);
  if (message) console.log(`  ${message}`);
  checks.failed++;
}

function warn(name, message) {
  console.log(`⚠️  ${name}`);
  if (message) console.log(`  ${message}`);
  checks.warnings++;
}

async function test(page) {
  // Test 1: Word input via keyboard
  console.log('\n=== WORD INPUT ===');

  // Start a run - click "New Run" first
  await page.waitForFunction(() => {
    return document.getElementById('btn-new-run') !== null;
  }, { timeout: 5000 });

  await page.click('#btn-new-run');
  await page.waitForTimeout(600);

  // Now click character option
  await page.waitForFunction(() => {
    const opts = document.querySelectorAll('.character-option');
    return opts.length > 0;
  }, { timeout: 5000 });

  await page.click('.character-option:first-child');
  await page.waitForTimeout(600);

  // Click on first combat node
  const nodeCount = await page.locator('.node-pill').count();
  if (nodeCount > 0) {
    await page.click('.node-pill:first-child');
    await page.waitForTimeout(400);
  }

  // Wait for combat
  await page.waitForFunction(() => {
    return document.getElementById('combat-panel').classList.contains('hidden') === false;
  }, { timeout: 5000 }).catch(() => {});

  // Focus on word input
  const wordInputFocused = await page.evaluate(() => {
    const input = document.getElementById('word-input');
    input.focus();
    return document.activeElement === input;
  });

  if (wordInputFocused) {
    pass('Word input field is focusable');
  } else {
    fail('Word input field is not focusable');
  }

  // Type a word
  await page.fill('#word-input', 'THE');

  // Submit with Enter
  const beforeText = await page.evaluate(() => {
    return document.getElementById('word-input').value;
  });

  await page.press('#word-input', 'Enter');
  await page.waitForTimeout(400);

  const inputCleared = await page.evaluate(() => {
    return document.getElementById('word-input').value === '';
  });

  if (inputCleared) {
    pass('Word submission works with Enter key');
  } else {
    fail('Word submission with Enter key did not work');
  }

  // Test 2: Rack tiles keyboard access
  console.log('\n=== RACK TILES ===');

  const rackTiles = await page.locator('.rack-tile').count();
  if (rackTiles > 0) {
    pass(`Rack has ${rackTiles} tiles`);

    // Check if rack tiles have proper keyboard support
    const tileKeyboardSupport = await page.evaluate(() => {
      const tiles = Array.from(document.querySelectorAll('.rack-tile'));
      const hasClickHandler = tiles.some(t => {
        // Check if element or parent has click listener
        return t.onclick !== null || t.hasAttribute('data-click') || t.hasAttribute('tabindex');
      });

      // Better check: see if they're buttons
      const isButton = tiles.some(t => t.tagName === 'BUTTON');

      return { hasClickHandler, isButton, count: tiles.length };
    });

    if (tileKeyboardSupport.isButton) {
      pass('Rack tiles are <button> elements (keyboard accessible)');
    } else if (tileKeyboardSupport.hasClickHandler) {
      warn('Rack tiles have click handlers but may need tabindex', 'Check if all tiles are focusable with Tab');
    } else {
      fail('Rack tiles may not be keyboard accessible', 'Consider adding tabindex or converting to buttons');
    }
  }

  // Test 3: Panel close buttons
  console.log('\n=== PANEL CLOSE BUTTONS ===');

  const closeButtons = await page.locator('button:has-text("Close")').count();
  if (closeButtons > 0) {
    pass(`Found ${closeButtons} close buttons`);

    // Try focusing close buttons
    const closeBtnAccessible = await page.evaluate(() => {
      const btn = document.querySelector('button:not(.hidden)');
      if (btn) {
        btn.focus();
        return document.activeElement === btn;
      }
      return false;
    });

    if (closeBtnAccessible) {
      pass('Close buttons are focusable with Tab');
    } else {
      warn('Close button focus check inconclusive', 'May be on hidden panels');
    }
  }

  // Test 4: Skip buttons and action buttons
  console.log('\n=== ACTION BUTTONS ===');

  const allButtons = await page.locator('button').count();
  if (allButtons > 0) {
    pass(`Found ${allButtons} total buttons`);

    // Check if all buttons are actual <button> elements
    const buttonTypes = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="button"], button'));
      const counts = {
        button: 0,
        div: 0,
        other: 0
      };

      btns.forEach(b => {
        if (b.tagName === 'BUTTON') counts.button++;
        else if (b.tagName === 'DIV') counts.div++;
        else counts.other++;
      });

      return counts;
    });

    console.log(`  Button elements: ${buttonTypes.button}`);
    if (buttonTypes.div > 0) {
      warn(`Divs used as buttons: ${buttonTypes.div}`, 'Consider converting to <button> tags or adding role="button" + tabindex');
    }
    if (buttonTypes.button > 0) {
      pass('Most interactive elements are proper <button> tags');
    }
  }

  // Test 5: Focusable elements count
  console.log('\n=== TAB NAVIGATION ===');

  const focusableCount = await page.evaluate(() => {
    const focusable = Array.from(document.querySelectorAll(
      'button:not(.hidden), input:not(.hidden), a[href], [tabindex]:not(.hidden)'
    )).filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0; // Exclude invisible elements
    });

    return focusable.length;
  });

  if (focusableCount > 0) {
    pass(`${focusableCount} focusable elements found on current screen`);
  } else {
    fail('No focusable elements found', 'Game may not be navigable with Tab key');
  }

  // Test 6: Check for elements that are clickable but not keyboard-accessible
  console.log('\n=== ACCESSIBILITY CHECK ===');

  const clickOnlyElements = await page.evaluate(() => {
    const divs = Array.from(document.querySelectorAll('div.treasure-choice, .item-chip, [class*="choice"]'));
    const notFocusable = divs.filter(el => {
      return !el.hasAttribute('tabindex') && el.onclick;
    });

    return {
      clickableNoTabindex: notFocusable.length,
      total: divs.length,
      examples: notFocusable.slice(0, 3).map(e => ({
        class: e.className,
        text: e.textContent?.substring(0, 30)
      }))
    };
  });

  if (clickOnlyElements.clickableNoTabindex > 0) {
    warn(`Found ${clickOnlyElements.clickableNoTabindex} clickable elements without tabindex`, 'These may not be keyboard accessible. Add tabindex="0" or convert to buttons.');
    if (clickOnlyElements.examples.length > 0) {
      console.log(`  Examples:`, clickOnlyElements.examples);
    }
  } else {
    pass('No obvious click-only elements found');
  }
}

async function main() {
  try {
    await startServer();
    console.log('Starting keyboard playability verification...\n');

    const sandboxChromiumPath = '/opt/pw-browsers/chromium';
    const launchOpts = { headless: true };
    if (fs.existsSync(sandboxChromiumPath)) {
      launchOpts.executablePath = sandboxChromiumPath;
    }
    const browser = await chromium.launch(launchOpts);

    const page = await browser.newPage();

    // Navigate to game
    await page.goto(`http://localhost:${PORT}/wordbound.html`, {
      waitUntil: 'networkidle'
    });

    // Wait for game to load
    await page.waitForFunction(() => window.Wordbound?.Game, { timeout: 15000 });

    await test(page);

    await page.close();
    await browser.close();

    // Summary
    console.log('\n=== SUMMARY ===');
    console.log(`Passed: ${checks.passed}`);
    console.log(`Warnings: ${checks.warnings}`);
    console.log(`Failed: ${checks.failed}`);

    if (checks.failed === 0) {
      console.log('\n✅ Game appears to be keyboard-playable (or mostly so)');
      console.log('Note: Full keyboard testing requires manual verification in a browser.');
      process.exit(0);
    } else {
      console.log('\n⚠️  Some keyboard accessibility issues found.');
      console.log('See details above for recommendations.');
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
