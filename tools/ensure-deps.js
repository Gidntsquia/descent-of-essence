#!/usr/bin/env node
// Test scripts run in fresh, throwaway sandboxes where node_modules doesn't exist
// yet. GOALS.md tells the hourly routine that `npm test` installs its own deps --
// this is what makes that true, so a missing-module crash is never mistaken for a
// broken repo (or an excuse to skip the mandatory test gate).

var child = require('child_process');

var required = process.argv.slice(2);
var missing = required.filter(function (name) {
  try {
    require.resolve(name);
    return false;
  } catch (e) {
    return true;
  }
});

if (missing.length === 0) process.exit(0);

console.log('[ensure-deps] missing: ' + missing.join(', ') + ' -- running npm install');
var result = child.spawnSync('npm', ['install', '--no-audit', '--no-fund'], {
  stdio: 'inherit',
  cwd: __dirname + '/..',
});
process.exit(result.status === null ? 1 : result.status);
