#!/usr/bin/env node
// test/verify-itch-build.js
//
// Regression guard for tools/build-itch.js. Builds the itch.io zip fresh,
// unzips it to a scratch directory, and proves the packaged file set is
// actually complete and correct -- not just "the script ran without
// throwing":
//   1. index.html sits at the ZIP ROOT (itch.io's HTML5 upload requirement;
//      a nested folder is a common upload mistake this must not reproduce).
//   2. The unzipped index.html passes the same jsdom sanity checks as
//      wordbound.html itself (test/dom-check.js, parameterized to point at
//      an arbitrary HTML file) -- proves every dependency was staged and
//      the relative paths inside index.html still resolve after the
//      wordbound.html -> index.html rename.
//   3. A real browser (Playwright) loads the unzipped copy over a local
//      static server and reports zero 404s on any subresource -- catches
//      anything dom-check.js's non-network jsdom load can't (e.g. a typo'd
//      relative path that jsdom silently swallows differently than a real
//      browser would).
//
// Run with `npm run test:itch-build` (or `node test/verify-itch-build.js`).

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require('@playwright/test');

const ROOT = path.join(__dirname, '..');
const { OUTPUT_ZIP } = require('../tools/build-itch.js');

const PORT = 9881;

function unzip(zipPath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  execFileSync('unzip', ['-q', zipPath, '-d', destDir]);
}

async function startServer(rootDir) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath);
      fs.readFile(filePath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end('Not found');
          return;
        }
        const ext = path.extname(filePath);
        const contentType = ext === '.js' ? 'application/javascript' : ext === '.css' ? 'text/css' : 'text/html';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });
    server.listen(PORT, () => resolve(server));
  });
}

async function main() {
  let failures = 0;
  function check(label, cond) {
    if (cond) {
      console.log('OK   ' + label);
    } else {
      console.log('FAIL ' + label);
      failures++;
    }
  }

  console.log('Building itch.io zip...');
  execFileSync('node', [path.join(ROOT, 'tools', 'build-itch.js')], { stdio: 'inherit' });

  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordbound-itch-verify-'));
  let server;
  try {
    unzip(OUTPUT_ZIP, scratchDir);

    const indexPath = path.join(scratchDir, 'index.html');
    check('index.html exists at the zip root', fs.existsSync(indexPath));
    check('css/wordbound.css exists in the unzipped copy', fs.existsSync(path.join(scratchDir, 'css', 'wordbound.css')));
    check('js/wordbound/game.js exists in the unzipped copy', fs.existsSync(path.join(scratchDir, 'js', 'wordbound', 'game.js')));

    console.log('\nRunning dom-check.js against the unzipped index.html...');
    let domCheckPassed = true;
    try {
      execFileSync('node', [path.join(ROOT, 'test', 'dom-check.js'), indexPath], { stdio: 'inherit' });
    } catch (e) {
      domCheckPassed = false;
    }
    check('dom-check.js passes against the unzipped index.html (16/16)', domCheckPassed);

    console.log('\nLoading the unzipped copy in a real browser over a static server...');
    server = await startServer(scratchDir);

    const sandboxChromiumPath = '/opt/pw-browsers/chromium';
    const launchOpts = { headless: true };
    if (fs.existsSync(sandboxChromiumPath)) launchOpts.executablePath = sandboxChromiumPath;
    const browser = await chromium.launch(launchOpts);
    const page = await browser.newPage();

    const failedRequests = [];
    page.on('requestfailed', (req) => failedRequests.push(req.url() + ' (' + (req.failure() || {}).errorText + ')'));
    page.on('response', (res) => {
      if (res.status() >= 400) failedRequests.push(res.url() + ' -> ' + res.status());
    });

    await page.goto('http://localhost:' + PORT + '/');
    await page.waitForTimeout(500);

    check('zero 404s / failed requests loading the unzipped build in a real browser', failedRequests.length === 0);
    if (failedRequests.length) failedRequests.forEach((f) => console.log('  BAD REQUEST:', f));

    const gameLoaded = await page.evaluate(() => !!(window.Wordbound && window.Wordbound.Game));
    check('window.Wordbound.Game exists in the real-browser load', gameLoaded);

    await browser.close();

    const zipSize = fs.statSync(OUTPUT_ZIP).size;
    console.log('\nZip size: ' + (zipSize / 1024 / 1024).toFixed(2) + ' MB');
  } finally {
    if (server) server.close();
    fs.rmSync(scratchDir, { recursive: true, force: true });
  }

  console.log('\n' + (failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('SCRIPT CRASHED:', e);
  process.exit(1);
});
