#!/usr/bin/env node
// tools/build-itch.js
//
// Packages Wordbound into an itch.io-ready HTML5 zip.
//
// itch.io's HTML5 upload requires index.html at the ROOT of the zip as the
// entry point. This repo's own index.html is Descent of Essence, a
// different game -- Wordbound lives at wordbound.html. So this script
// stages Wordbound's exact dependency set into a temp directory, renames
// wordbound.html -> index.html within that staging dir, and zips the
// staging dir's CONTENTS (not the dir itself -- index.html must sit at the
// zip root, not nested inside a folder, which is a common itch upload
// mistake).
//
// Run with `npm run build:itch` (or `node tools/build-itch.js`). Output:
// dist/wordbound-itch.zip. `dist/` is a build artifact, not source -- see
// .gitignore.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const OUTPUT_ZIP = path.join(DIST_DIR, 'wordbound-itch.zip');

// Wordbound's full dependency list, verified against wordbound.html's own
// <link>/<script> tags. Nothing else -- no images/fonts/audio files exist
// by design (CSS-only visuals, Web Audio synthesis). Kept as an explicit
// list rather than a glob so a stray unrelated file added to js/wordbound/
// later doesn't silently ship (or a needed one silently gets dropped) --
// this script will just fail loudly (ENOENT) if the list and the directory
// drift apart.
const DEPENDENCIES = [
  'css/wordbound.css',
  'js/core/namespace.js',
  'js/core/rng.js',
  'js/wordbound/achievements.js',
  'js/wordbound/characters.js',
  'js/wordbound/combat.js',
  'js/wordbound/consumables.js',
  'js/wordbound/events.js',
  'js/wordbound/floor.js',
  'js/wordbound/game.js',
  'js/wordbound/intents.js',
  'js/wordbound/items.js',
  'js/wordbound/lexicon.js',
  'js/wordbound/monsters.js',
  'js/wordbound/tiles.js',
  'js/wordbound/traits.js',
  'js/wordbound/wordlist.js',
];

function checkZipAvailable() {
  try {
    execFileSync('zip', ['-v'], { stdio: 'ignore' });
  } catch (e) {
    console.error(
      'ERROR: the `zip` command is not available on this system. ' +
        'Install it (e.g. `apt-get install zip` / `brew install zip`) and re-run.'
    );
    process.exit(1);
  }
}

function stageBuild(stagingDir) {
  fs.mkdirSync(stagingDir, { recursive: true });

  for (const relPath of DEPENDENCIES) {
    const src = path.join(ROOT, relPath);
    const dest = path.join(stagingDir, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }

  // wordbound.html -> index.html, so itch's HTML5 embed finds an entry
  // point at the zip root, exactly like a real itch upload requires.
  fs.copyFileSync(path.join(ROOT, 'wordbound.html'), path.join(stagingDir, 'index.html'));
}

function zipStagingDir(stagingDir, outputZip) {
  fs.mkdirSync(path.dirname(outputZip), { recursive: true });
  if (fs.existsSync(outputZip)) fs.unlinkSync(outputZip);
  // -X: no extra file attributes (deterministic-ish, avoids platform cruft).
  // -r: recurse into subdirectories (css/, js/).
  // Run with cwd = stagingDir so the zip's internal paths start at
  // index.html/css/js, not at some absolute host path.
  execFileSync('zip', ['-r', '-X', outputZip, '.'], { cwd: stagingDir, stdio: 'inherit' });
}

function main() {
  checkZipAvailable();

  const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wordbound-itch-'));
  try {
    stageBuild(stagingDir);
    zipStagingDir(stagingDir, OUTPUT_ZIP);
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true });
  }

  const { size } = fs.statSync(OUTPUT_ZIP);
  console.log(`\nBuilt ${path.relative(ROOT, OUTPUT_ZIP)} (${(size / 1024 / 1024).toFixed(2)} MB)`);
}

if (require.main === module) {
  main();
}

module.exports = { DEPENDENCIES, stageBuild, zipStagingDir, OUTPUT_ZIP, DIST_DIR };
