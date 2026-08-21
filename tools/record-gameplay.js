// tools/record-gameplay.js
//
// Records a short real-browser gameplay clip of Wordbound for the README
// screenshot section and for Jaxon's itch.io page (GOALS.md PRESENTATION
// ticket, 2026-08-20). Drives real Playwright clicks/typing against a local
// static server -- same pattern as test/orchestrator-qa-boss-reward.js --
// while Playwright's native recordVideo captures a .webm, then ffmpeg
// re-encodes that into docs/gameplay.mp4 (source clip, itch.io accepts
// video on store pages) and docs/gameplay.gif (README-embeddable,
// palette-optimized two-pass).
//
// Segment recorded (~15-20s): main menu -> New Run -> character select ->
// first (organic) combat, typing real words into #word-input and watching
// the damage animation -> tile reward pick -> a jump to this floor's boss
// node (setup, not itself part of the recorded interaction -- same
// "setup vs. interaction" scaffolding note as the QA script) -> a REAL click
// on the boss node pill to trigger the bossEntrance CSS animation -> one
// more real word played against the boss.
//
// ENVIRONMENT NOTE: the ffmpeg preinstalled at /opt/pw-browsers/ffmpeg-1011
// (mentioned as available in this sandbox) is a Playwright-internal build
// stripped down to just what Playwright itself needs (webm/vp8 decode,
// scale/crop/pad, png/vp8 encode) -- it has NO gif encoder and NO
// palettegen/paletteuse filters, so it can't produce a README-ready gif.
// This script shells out to a full-featured `ffmpeg` on PATH instead
// (`apt-get install ffmpeg` pulls one with libx264 + palettegen/paletteuse
// baked in). If re-running this in a fresh sandbox and `ffmpeg` isn't on
// PATH or is missing those filters, `apt-get install -y ffmpeg` first.
//
// Re-run after visual changes: `node tools/record-gameplay.js`

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require('@playwright/test');

const PORT = 9882;
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const RAW_DIR = path.join(ROOT, '.recording-tmp');
const VIDEO_SIZE = { width: 960, height: 600 };
const GIF_WIDTH = 560;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      const filePath = path.join(ROOT, urlPath === '/' ? 'wordbound.html' : urlPath);
      if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        return res.end('not found');
      }
      const ext = path.extname(filePath);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
      res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

function checkFfmpeg() {
  let out;
  try {
    out = execFileSync('ffmpeg', ['-hide_banner', '-filters'], { encoding: 'utf8' });
  } catch (e) {
    throw new Error('`ffmpeg` not found on PATH. Install a full build: apt-get install -y ffmpeg (the bundled /opt/pw-browsers ffmpeg lacks gif support, see this file\'s header comment).');
  }
  if (!/palettegen/.test(out) || !/paletteuse/.test(out)) {
    throw new Error('`ffmpeg` on PATH is missing palettegen/paletteuse filters (likely the stripped Playwright-internal build). Install a full build: apt-get install -y ffmpeg.');
  }
}

// Page-side anagram lookup, same technique as test/orchestrator-qa-boss-reward.js.
const FIND_WORD_FN = `
(function findPlayableWord() {
  var W = window.Wordbound;
  if (!window.__anagramIndex) {
    var idx = new Map();
    var list = W.WORDLIST || [];
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      if (w.length < 2 || w.length > 8) continue;
      var key = w.split('').sort().join('');
      if (!idx.has(key)) idx.set(key, w);
    }
    window.__anagramIndex = idx;
  }
  var rack = W.Game._state.player.rack;
  var letters = [];
  for (var r = 0; r < rack.length; r++) {
    if (rack[r].letter !== '?') letters.push(rack[r].letter);
  }
  var n = letters.length;
  var best = null;
  for (var mask = 1; mask < (1 << n); mask++) {
    var subset = [];
    for (var b = 0; b < n; b++) if (mask & (1 << b)) subset.push(letters[b]);
    if (subset.length < 2) continue;
    var word = window.__anagramIndex.get(subset.slice().sort().join(''));
    if (word && (!best || word.length > best.length)) best = word;
  }
  return best;
})()
`;

async function playOneWord(page) {
  const word = await page.evaluate(FIND_WORD_FN);
  if (!word) return null;
  await page.fill('#word-input', '');
  await page.type('#word-input', word, { delay: 90 }); // slow enough to read on the recording
  await page.waitForTimeout(300);
  await page.click('#btn-submit-word');
  await page.waitForTimeout(700); // let the damage animation land on camera
  return word;
}

async function main() {
  checkFfmpeg();
  fs.rmSync(RAW_DIR, { recursive: true, force: true });
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.mkdirSync(DOCS_DIR, { recursive: true });

  const server = await startServer();
  const sandboxChromiumPath = '/opt/pw-browsers/chromium';
  const launchOpts = { headless: true };
  if (fs.existsSync(sandboxChromiumPath)) launchOpts.executablePath = sandboxChromiumPath;
  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext({
    viewport: VIDEO_SIZE,
    recordVideo: { dir: RAW_DIR, size: VIDEO_SIZE },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('pageerror (non-fatal for a recording pass):', e.message));

  await page.goto(`http://localhost:${PORT}/wordbound.html`, { waitUntil: 'load' });
  await page.waitForFunction('window.Wordbound && window.Wordbound.Game && window.Wordbound.Game._state');
  // this clip is about core gameplay, not the onboarding panel -- suppress the
  // one-time first-combat How to Play auto-show (localStorage-gated) so it
  // doesn't block #btn-submit-word mid-recording
  await page.evaluate("localStorage.setItem('wordbound_seen_howto', '1')");
  await page.waitForTimeout(1200); // let the main menu sit on screen briefly

  // ---- main menu -> character select ----
  await page.click('#btn-new-run');
  await page.waitForTimeout(900);
  await page.click('.character-option');
  await page.waitForTimeout(600);

  // setup, not the recorded interaction: headroom so the clip doesn't end on
  // an unlucky player death mid-fight
  await page.evaluate('(function(){var p=window.Wordbound.Game._state.player;p.maxInk=200;p.ink=200;})()');

  // ---- first combat, organic (floor.js always puts a combat node first) ----
  await page.click('.node-pill.node-current');
  await page.waitForTimeout(700);
  for (let i = 0; i < 5; i++) {
    const st = await page.evaluate('({ combatActive: window.Wordbound.Game._state.combatActive })');
    if (!st.combatActive) break;
    const word = await playOneWord(page);
    if (!word) break;
  }

  // tile reward, if the fight ended there (it always does on a normal kill)
  const afterFight = await page.evaluate('window.Wordbound.Game._state.screen');
  if (afterFight === 'TILE_REWARD') {
    await page.waitForTimeout(600);
    await page.click('#tile-reward-choices .treasure-choice');
    await page.waitForTimeout(700);
  }

  // ---- setup: jump to this floor's boss node (not itself the recorded interaction) ----
  // Branching map (GOALS.md, run 2/N): every node in the floor's last
  // encounter row has exactly one outgoing edge, straight to the boss (see
  // Floor.generateBranchingFloor) -- standing on any one of them makes the
  // boss the sole available/clickable next node.
  await page.evaluate(`(function () {
    var s = window.Wordbound.Game._state;
    var floor = s.floor;
    var lastRowNode = floor.nodes.find(function (n) { return n.row === floor.rows - 1; });
    floor.nodes.forEach(function (n) { if (n.type !== 'boss') n.cleared = true; });
    s.mapPositionNodeId = lastRowNode.id;
    s.currentNodeId = null;
    s.screen = 'RUN';
    s.player.maxInk = 200;
    s.player.ink = 200;
  })()`);
  await page.evaluate('window.Wordbound.Game.openDeckViewer(); window.Wordbound.Game.closeDeckViewer();'); // force a render of the new node map
  await page.waitForTimeout(500);

  // ---- boss entrance: a real click, captures the bossEntrance CSS animation ----
  await page.click('.node-pill.node-current');
  await page.waitForTimeout(1400);
  await playOneWord(page); // one real word against the boss
  await page.waitForTimeout(900);

  await context.close(); // recordVideo only finalizes the file on context close
  await browser.close();
  server.close();

  const videoFiles = fs.readdirSync(RAW_DIR).filter((f) => f.endsWith('.webm'));
  if (!videoFiles.length) throw new Error('no .webm produced by Playwright recordVideo in ' + RAW_DIR);
  const rawWebm = path.join(RAW_DIR, videoFiles[0]);

  const mp4Out = path.join(DOCS_DIR, 'gameplay.mp4');
  const gifOut = path.join(DOCS_DIR, 'gameplay.gif');
  const paletteOut = path.join(RAW_DIR, 'palette.png');

  console.log('Encoding docs/gameplay.mp4 (source clip, for itch.io)...');
  execFileSync('ffmpeg', ['-y', '-i', rawWebm, '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4Out], { stdio: 'inherit' });

  console.log('Generating gif palette...');
  execFileSync('ffmpeg', ['-y', '-i', rawWebm, '-vf', `fps=12,scale=${GIF_WIDTH}:-1:flags=lanczos,palettegen`, paletteOut], { stdio: 'inherit' });

  console.log('Encoding docs/gameplay.gif (README)...');
  execFileSync('ffmpeg', ['-y', '-i', rawWebm, '-i', paletteOut, '-filter_complex', `fps=12,scale=${GIF_WIDTH}:-1:flags=lanczos[x];[x][1:v]paletteuse`, gifOut], { stdio: 'inherit' });

  fs.rmSync(RAW_DIR, { recursive: true, force: true });

  const gifSize = fs.statSync(gifOut).size;
  const mp4Size = fs.statSync(mp4Out).size;
  console.log('');
  console.log('docs/gameplay.gif: ' + (gifSize / 1024 / 1024).toFixed(2) + ' MB');
  console.log('docs/gameplay.mp4: ' + (mp4Size / 1024 / 1024).toFixed(2) + ' MB');
}

main().catch((e) => {
  console.error('FATAL:', e);
  fs.rmSync(RAW_DIR, { recursive: true, force: true });
  process.exit(1);
});
