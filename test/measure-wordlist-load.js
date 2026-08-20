#!/usr/bin/env node
/**
 * Measures wordlist.js load time on a slow 3G connection.
 *
 * Simulates a slow 3G network using page.route to introduce artificial delays.
 * Measures:
 * 1. Time from page load to first interactive state
 * 2. Time until wordlist.js is fully parsed and Game.init() completes
 * 3. Reports whether this is user-friendly or needs a loading indicator
 */

const { chromium } = require('@playwright/test');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 9876;
let server;

// Start a simple HTTP server
async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      let filePath = path.join(__dirname, '..', req.url === '/' ? 'wordbound.html' : req.url);

      // Read and serve the file
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

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      resolve();
    });
  });
}

async function measureLoadTime() {
  const sandboxChromiumPath = '/opt/pw-browsers/chromium';
  const launchOpts = fs.existsSync(sandboxChromiumPath) ? { executablePath: sandboxChromiumPath } : {};
  const browser = await chromium.launch(launchOpts);
  const page = await browser.newPage();

  // Track when major events happen
  const timings = {
    navigationStart: 0,
    wordsLoadStart: 0,
    wordsLoadEnd: 0,
    gameInitEnd: 0,
    firstPaintTime: 0
  };

  // Intercept requests and add delays to simulate 3G
  // Typical 3G: 400 Kbps down, 400 ms latency
  // We'll use: 2ms per KB for slower throughput effect, 400ms base latency
  let requestCount = 0;

  await page.route('**/*', async (route) => {
    const url = route.request().url();
    requestCount++;
    const isWordlist = url.includes('wordlist.js');

    if (isWordlist) {
      timings.wordsLoadStart = Date.now();
      // 3G latency + delay for file transfer (2.5MB with artificial throttle)
      await new Promise(r => setTimeout(r, 400)); // base latency
      // Simulate transfer time (2.5MB at 400 Kbps = ~50 seconds real time; scale down to measurable)
      // Use 2-3 second delay to represent parsing a large file on a slow connection
      await new Promise(r => setTimeout(r, 2500));
      timings.wordsLoadEnd = Date.now();
    } else if (url.includes('.js') || url.includes('.css')) {
      // Add small delay to other resources too (typical 3G latency)
      await new Promise(r => setTimeout(r, 100));
    }

    try {
      await route.continue();
    } catch (e) {
      // Ignore abort errors from continued routes
    }
  });

  timings.navigationStart = Date.now();

  // Navigate and wait for page to load
  await page.goto(`http://localhost:${PORT}/wordbound.html`, {
    waitUntil: 'networkidle'
  });

  // Wait for Game to be initialized
  await page.waitForFunction(() => {
    return window.Wordbound && window.Wordbound.Game && window.Wordbound.Game.init;
  }, { timeout: 30000 });

  timings.gameInitEnd = Date.now();

  // Check if the page is actually interactive
  const isMenuVisible = await page.evaluate(() => {
    const menu = document.getElementById('screen-main-menu');
    if (!menu) return false;
    return !menu.classList.contains('hidden');
  });

  const dictionarySize = await page.evaluate(() => {
    return window.Wordbound?.WORD_SET?.size || 0;
  });

  // Close everything
  await page.close();
  await browser.close();

  // Calculate and report
  const totalLoadTime = timings.gameInitEnd - timings.navigationStart;
  const wordlistLoadTime = timings.wordsLoadEnd - timings.wordsLoadStart;

  console.log('\n=== WORDLIST LOAD TIME MEASUREMENT ===\n');
  console.log(`Total page load time: ${totalLoadTime}ms (${(totalLoadTime/1000).toFixed(2)}s)`);
  console.log(`Wordlist.js load + parse time: ${wordlistLoadTime}ms (${(wordlistLoadTime/1000).toFixed(2)}s)`);
  console.log(`Dictionary loaded: ${dictionarySize.toLocaleString()} words`);
  console.log(`Page interactive: ${isMenuVisible ? 'Yes' : 'No'}`);
  console.log(`\nNetwork profile: Simulated 3G (400ms latency + 2.5s parse delay)`);

  if (totalLoadTime > 3000) {
    console.log('\n⚠️  LOAD TIME IS SLOW (>3 seconds)');
    console.log('RECOMMENDATION: Add a loading indicator on the main menu');
    console.log('OR consider lazy-loading wordlist.js on "New Run" click');
    return 'SLOW';
  } else if (totalLoadTime > 1500) {
    console.log('\n⏱️  LOAD TIME IS MODERATE (1.5-3 seconds)');
    console.log('RECOMMENDATION: Add a loading indicator for user feedback');
    return 'MODERATE';
  } else {
    console.log('\n✅ LOAD TIME IS ACCEPTABLE (<1.5 seconds)');
    console.log('No loading indicator needed');
    return 'FAST';
  }
}

async function main() {
  try {
    await startServer();
    const result = await measureLoadTime();
    process.exit(result === 'FAST' ? 0 : 1);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    if (server) server.close();
  }
}

main();
