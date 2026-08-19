#!/usr/bin/env node
/**
 * Systematic difficulty/balance simulation across all 3 floors.
 *
 * Plays 10-15 headless runs with random valid word selection.
 * Records statistics per run to identify balance outliers.
 */

const { chromium } = require('@playwright/test');
const http = require('http');
const path = require('path');
const fs = require('fs');

const PORT = 9877;
const NUM_RUNS = process.argv[2] ? parseInt(process.argv[2]) : 2; // Default to 2 runs for quick test
let server;

// Start HTTP server
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

// Play a single run and record statistics
async function playRun(page, runNumber) {
  const run = {
    number: runNumber,
    won: false,
    floorsReached: 1,
    deathCause: null,
    deathFloor: 1,
    goldEarned: 0,
    itemsCollected: 0,
    turnsPerFloor: [0, 0, 0],
    monstersFaced: [],
    timestamp: new Date().toISOString()
  };

  try {
    // Navigate to game
    await page.goto(`http://localhost:${PORT}/wordbound.html`, {
      waitUntil: 'networkidle'
    });

    // Wait for game to load
    await page.waitForFunction(() => window.Wordbound?.Game, { timeout: 15000 });

    // Select character (archivist = first option)
    const characterOptions = await page.locator('.character-option').count();
    if (characterOptions > 0) {
      await page.click('.character-option:first-child');
      await page.waitForTimeout(300);
    }

    // Play until win or death (max 300 turns per run to prevent infinite loops)
    let totalTurns = 0;
    const maxTurns = 300;

    while (totalTurns < maxTurns) {
      totalTurns++;

      // Check game state
      const state = await page.evaluate(() => {
        const gameOver = !document.getElementById('screen-game-over').classList.contains('hidden');
        const victory = !document.getElementById('screen-victory').classList.contains('hidden');
        const combat = !document.getElementById('combat-panel').classList.contains('hidden');
        const nodeMap = !document.getElementById('node-map').classList.contains('hidden');

        return { gameOver, victory, combat, nodeMap };
      });

      if (state.gameOver) {
        run.won = false;
        const deathText = await page.evaluate(() => {
          return document.getElementById('game-over-stats')?.textContent || 'Unknown';
        });
        run.deathCause = deathText.split('\n')[0].substring(0, 50);
        break;
      }

      if (state.victory) {
        run.won = true;
        run.deathCause = 'Victory';
        run.floorsReached = 3;
        break;
      }

      // Handle map navigation
      if (state.nodeMap && !state.combat) {
        const nodeInfo = await page.evaluate(() => {
          const current = document.querySelector('.node-pill.node-current');
          if (!current) return null;

          // Extract floor from node position
          const nodes = Array.from(document.querySelectorAll('.node-pill'));
          const idx = nodes.indexOf(current);
          const floor = Math.floor(idx / 8) + 1;

          return {
            isCurrent: true,
            floor: Math.min(floor, 3),
            type: current.className.match(/node-(\w+)/)?.[ 1] || 'unknown',
            text: current.textContent.trim()
          };
        });

        if (nodeInfo?.isCurrent) {
          run.floorsReached = Math.max(run.floorsReached, nodeInfo.floor);

          // Click to enter node
          await page.click('.node-pill.node-current');
          await page.waitForTimeout(400);
          continue;
        }
      }

      // Handle combat
      if (state.combat) {
        // Get current rack and monster
        const info = await page.evaluate(() => {
          const rack = Array.from(document.querySelectorAll('.rack-tile')).map(t => t.textContent.trim());
          const monsterName = document.querySelector('.monster-name')?.textContent?.trim() || 'Unknown';
          return { rack, monsterName };
        });

        if (!info.rack || info.rack.length === 0) {
          await page.waitForTimeout(300);
          continue;
        }

        run.monstersFaced.push(info.monsterName);

        // Get valid words from the game
        const validWords = await page.evaluate(() => {
          if (!window.Wordbound?.Lexicon) return [];

          const rack = Array.from(document.querySelectorAll('.rack-tile')).map(t => t.textContent.trim());
          const Lexicon = window.Wordbound.Lexicon;

          // Generate candidate words (2-8 letters)
          const candidates = [];

          // Try simple combinations
          for (let len = 2; len <= Math.min(rack.length, 8); len++) {
            for (let i = 0; i < rack.length; i++) {
              for (let j = i + 1; j <= Math.min(i + len, rack.length); j++) {
                const word = rack.slice(i, j).join('').toUpperCase();
                if (window.Wordbound.WORD_SET?.has(word)) {
                  candidates.push(word);
                }
              }
            }
          }

          return [...new Set(candidates)].slice(0, 5);
        });

        if (validWords && validWords.length > 0) {
          // Play a random valid word
          const word = validWords[Math.floor(Math.random() * validWords.length)];
          await page.fill('#word-input', word);
          await page.click('#btn-submit-word');

          run.turnsPerFloor[run.floorsReached - 1]++;

          await page.waitForTimeout(400);
        } else {
          // No valid words found, wait a bit
          await page.waitForTimeout(500);
        }
      }

      if (totalTurns % 50 === 0) {
        // Timeout protection
        await page.waitForTimeout(100);
      }
    }

    // Record final statistics
    run.goldEarned = await page.evaluate(() => {
      const text = document.getElementById('gold-display')?.textContent || '0';
      const match = text.match(/(\d+)/);
      return parseInt(match?.[1] || 0);
    });

    run.itemsCollected = await page.evaluate(() => {
      return document.querySelectorAll('#items-owned .item-chip').length;
    });

    // Update floor based on screens
    if (await page.locator('#screen-victory:not(.hidden)').count() > 0) {
      run.floorsReached = 3;
    } else if (await page.locator('#screen-game-over:not(.hidden)').count() > 0) {
      const gameOverText = await page.evaluate(() => {
        return document.getElementById('game-over-stats')?.textContent || '';
      });
      const floorMatch = gameOverText.match(/Floor (\d+)/);
      run.deathFloor = floorMatch ? parseInt(floorMatch[1]) : 1;
      run.floorsReached = run.deathFloor;
    }

  } catch (error) {
    run.error = error.message;
  }

  return run;
}

async function main() {
  try {
    await startServer();
    console.log(`Starting balance simulation (${NUM_RUNS} runs)\n`);

    const browser = await chromium.launch({
      executablePath: '/opt/pw-browsers/chromium',
      headless: true,
      args: ['--disable-dev-shm-usage']
    });

    const results = [];

    // Run simulations
    for (let i = 1; i <= NUM_RUNS; i++) {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();

      console.log(`Run ${i}/${NUM_RUNS}...`);

      const run = await playRun(page, i);
      results.push(run);

      const status = run.won ? '✓ WON' : `✗ LOST (Floor ${run.floorsReached})`;
      console.log(`  ${status} - ${run.goldEarned} gold, ${run.itemsCollected} items, ${run.monstersFaced.length} monsters`);

      await page.close();
      await context.close();
    }

    await browser.close();

    // Analyze results
    const analysis = {
      totalRuns: results.length,
      wins: results.filter(r => r.won).length,
      losses: results.filter(r => !r.won).length,
      winRate: ((results.filter(r => r.won).length / results.length) * 100).toFixed(1),
      averageGold: (results.reduce((s, r) => s + r.goldEarned, 0) / results.length).toFixed(1),
      averageItems: (results.reduce((s, r) => s + r.itemsCollected, 0) / results.length).toFixed(1),
      avgFloorsReached: (results.reduce((s, r) => s + r.floorsReached, 0) / results.length).toFixed(1),

      // Cause of death frequency
      deathCauses: {},

      // Monsters by floor
      monstersByFloor: {
        1: {},
        2: {},
        3: {}
      },

      // Floor difficulty
      floorWinRates: {
        1: { wins: 0, attempts: 0 },
        2: { wins: 0, attempts: 0 },
        3: { wins: 0, attempts: 0 }
      }
    };

    // Process results
    results.forEach((run, idx) => {
      // Count death causes
      if (run.deathCause && run.deathCause !== 'Victory') {
        analysis.deathCauses[run.deathCause] = (analysis.deathCauses[run.deathCause] || 0) + 1;
      }

      // Record which monsters appeared per floor
      const monstersPerFloor = Math.ceil(run.monstersFaced.length / 3);
      for (let floor = 1; floor <= Math.min(run.floorsReached, 3); floor++) {
        const startIdx = (floor - 1) * monstersPerFloor;
        const endIdx = floor * monstersPerFloor;
        run.monstersFaced.slice(startIdx, endIdx).forEach(monster => {
          analysis.monstersByFloor[floor][monster] = (analysis.monstersByFloor[floor][monster] || 0) + 1;
        });

        // Track floor win rates (runs that reached/passed this floor)
        if (run.floorsReached >= floor) {
          analysis.floorWinRates[floor].attempts++;
          if (run.won || run.floorsReached > floor) {
            analysis.floorWinRates[floor].wins++;
          }
        }
      }
    });

    // Print results
    console.log('\n=== BALANCE SIMULATION RESULTS ===\n');
    console.log(`Runs: ${analysis.totalRuns}`);
    console.log(`Wins: ${analysis.wins}/${analysis.totalRuns} (${analysis.winRate}%)`);
    console.log(`Avg floors reached: ${analysis.avgFloorsReached}/3`);
    console.log(`Avg gold per run: ${analysis.averageGold}`);
    console.log(`Avg items per run: ${analysis.averageItems}\n`);

    console.log('Floor win rates:');
    Object.entries(analysis.floorWinRates).forEach(([floor, stats]) => {
      const rate = stats.attempts > 0 ? ((stats.wins / stats.attempts) * 100).toFixed(1) : 'N/A';
      console.log(`  Floor ${floor}: ${stats.wins}/${stats.attempts} (${rate}%)`);
    });

    console.log('\nMost common death causes:');
    Object.entries(analysis.deathCauses)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([cause, count]) => {
        console.log(`  ${cause}: ${count} times (${(count/analysis.losses*100).toFixed(1)}% of deaths)`);
      });

    // Check for balance outliers
    const outliers = [];
    Object.entries(analysis.deathCauses).forEach(([cause, count]) => {
      const percentage = count / analysis.losses * 100;
      if (percentage > 25) {
        outliers.push({ cause, count, percentage });
      }
    });

    if (outliers.length > 0) {
      console.log('\n⚠️  BALANCE OUTLIERS (>25% of deaths):');
      outliers.forEach(({ cause, count, percentage }) => {
        console.log(`  ${cause}: ${count} times (${percentage.toFixed(1)}%)`);
      });
    } else {
      console.log('\n✓ No major balance outliers detected');
    }

    // Save results
    fs.writeFileSync(
      path.join(__dirname, 'balance-simulation-results.json'),
      JSON.stringify({ results, analysis }, null, 2)
    );

    console.log('\nFull results saved to test/balance-simulation-results.json');
    process.exit(0);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    if (server) server.close();
  }
}

main();
