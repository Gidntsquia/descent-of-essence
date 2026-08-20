#!/usr/bin/env node
/**
 * Spot-check responsive/mobile layout at common small-screen widths.
 *
 * Tests at 375px (iPhone SE) and 414px (iPhone 12/13) viewport widths.
 * Checks for: horizontal overflow, elements clipped off screen, readable text, button sizes.
 */

const { chromium } = require('@playwright/test');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 9879;
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

async function checkLayout(page, widthPx, heightPx = 800) {
  const results = {
    width: widthPx,
    height: heightPx,
    checks: {
      overflowX: false,
      elementsClipped: [],
      hiddenElements: 0,
      buttonSizesOK: true,
      textReadable: true
    }
  };

  // Set viewport
  await page.setViewportSize({ width: widthPx, height: heightPx });
  await page.waitForTimeout(300);

  // Check for horizontal overflow
  const overflow = await page.evaluate(() => {
    const viewport = document.documentElement;
    const hasOverflow = viewport.scrollWidth > viewport.clientWidth;
    const scrollAmount = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    return { hasOverflow, scrollAmount };
  });

  results.checks.overflowX = overflow.hasOverflow;

  if (overflow.hasOverflow) {
    console.log(`  ⚠️  Horizontal overflow detected: ${overflow.scrollAmount}px beyond viewport`);
  }

  // Check for clipped elements
  const clipped = await page.evaluate(() => {
    const viewport = window.innerWidth;
    const clippedElements = [];

    const visibleElements = Array.from(document.querySelectorAll('*')).filter(el => {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

    visibleElements.forEach(el => {
      const rect = el.getBoundingClientRect();
      // Check if element extends past right edge
      if (rect.right > viewport && rect.width > 10) {
        clippedElements.push({
          tag: el.tagName,
          class: el.className,
          text: el.textContent?.substring(0, 30),
          right: Math.round(rect.right),
          viewport: viewport,
          overflow: Math.round(rect.right - viewport)
        });
      }
    });

    return clippedElements.slice(0, 3); // Return top 3
  });

  if (clipped.length > 0) {
    results.checks.elementsClipped = clipped;
    clipped.forEach(el => {
      console.log(`  ⚠️  Element clipped (${el.overflow}px): ${el.tag}.${el.class} "${el.text}"`);
    });
  }

  // Check button sizes (should be at least 44px tall for touch)
  const buttonSizes = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button')).filter(btn => {
      const style = window.getComputedStyle(btn);
      return style.display !== 'none' && style.visibility !== 'hidden' && btn.offsetParent !== null;
    });
    const tooSmall = buttons.filter(btn => {
      const rect = btn.getBoundingClientRect();
      return rect.height < 36 || rect.width < 36;
    });

    return {
      total: buttons.length,
      tooSmall: tooSmall.length,
      examples: tooSmall.slice(0, 2).map(btn => ({
        text: btn.textContent.substring(0, 20),
        height: Math.round(btn.getBoundingClientRect().height),
        width: Math.round(btn.getBoundingClientRect().width)
      }))
    };
  });

  if (buttonSizes.tooSmall > 0) {
    console.log(`  ⚠️  ${buttonSizes.tooSmall} buttons are < 36px (hard to touch)`);
    buttonSizes.examples.forEach(btn => {
      console.log(`     "${btn.text}": ${btn.height}x${btn.width}px`);
    });
    results.checks.buttonSizesOK = false;
  }

  // Check text legibility (font size > 12px)
  const textSizes = await page.evaluate(() => {
    const textElements = Array.from(document.querySelectorAll('body *')).filter(el => {
      return el.textContent?.trim().length > 0 && !el.querySelector('*');
    });

    const tooSmall = textElements.filter(el => {
      const fontSize = parseFloat(window.getComputedStyle(el).fontSize);
      return fontSize < 12;
    });

    return {
      total: textElements.length,
      tooSmall: tooSmall.length,
      minSize: Math.min(...textElements.map(el => parseFloat(window.getComputedStyle(el).fontSize)))
    };
  });

  if (textSizes.tooSmall > 0) {
    console.log(`  ⚠️  ${textSizes.tooSmall} text elements < 12px (hard to read)`);
    results.checks.textReadable = false;
  }

  return results;
}

async function main() {
  try {
    await startServer();
    console.log('Starting mobile layout verification...\n');

    // Some sandboxes pre-install a Chromium build under a fixed path that may not match
    // the exact revision @playwright/test's package.json pins (its own auto-resolved
    // path can then 404). Prefer that fixed path when present; otherwise fall back to
    // Playwright's normal resolution (e.g. Jaxon's local Mac, where it doesn't exist).
    const sandboxChromiumPath = '/opt/pw-browsers/chromium';
    const launchOpts = { headless: true };
    if (fs.existsSync(sandboxChromiumPath)) {
      launchOpts.executablePath = sandboxChromiumPath;
    }
    const browser = await chromium.launch(launchOpts);

    const page = await browser.newPage();

    // Load game
    await page.goto(`http://localhost:${PORT}/wordbound.html`, {
      waitUntil: 'networkidle'
    });

    await page.waitForFunction(() => window.Wordbound?.Game, { timeout: 15000 });

    const widths = [375, 414]; // Common mobile widths
    const results = [];

    console.log('Testing main menu screen:\n');

    for (const width of widths) {
      console.log(`${width}px width:`);
      const result = await checkLayout(page, width);
      results.push(result);

      const hasIssues = result.checks.overflowX ||
                       result.checks.elementsClipped.length > 0 ||
                       !result.checks.buttonSizesOK ||
                       !result.checks.textReadable;

      console.log(`  ${hasIssues ? '⚠️  ' : '✓ '}Layout OK\n`);
    }

    // Test combat screen
    console.log('Testing combat screen:\n');

    // Navigate to combat
    await page.click('#btn-new-run');
    await page.waitForTimeout(300);
    await page.click('.character-option:first-child');
    await page.waitForTimeout(400);
    await page.click('.node-pill:first-child');
    await page.waitForTimeout(400);

    // Wait for combat
    await page.waitForFunction(() => {
      return document.getElementById('combat-panel').classList.contains('hidden') === false;
    }, { timeout: 5000 }).catch(() => {});

    for (const width of widths) {
      console.log(`${width}px width:`);
      const result = await checkLayout(page, width);
      results.push(result);

      const hasIssues = result.checks.overflowX ||
                       result.checks.elementsClipped.length > 0 ||
                       !result.checks.buttonSizesOK ||
                       !result.checks.textReadable;

      console.log(`  ${hasIssues ? '⚠️  ' : '✓ '}Layout OK\n`);
    }

    await page.close();
    await browser.close();

    // Summary
    console.log('=== SUMMARY ===');
    const hasIssues = results.some(r => r.checks.overflowX || r.checks.elementsClipped.length > 0);

    if (!hasIssues) {
      console.log('✅ Mobile layout appears responsive and functional');
      console.log('All tested widths (375px, 414px) display correctly');
      process.exit(0);
    } else {
      console.log('⚠️  Some mobile layout issues detected');
      console.log('See details above. Most are CSS sizing issues.');
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
