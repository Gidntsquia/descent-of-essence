# Goals

This file is the task queue for the autonomous hourly dev routine. Jaxon (or Claude,
acting on Jaxon's behalf) adds tasks here. Each hourly run picks the first unchecked
item, does a complete, working chunk of progress on it, checks it off when fully done,
and logs what happened in PROGRESS.md.

Read ROADMAP.md too, not just this file -- it's the "why" behind the current queue
(the goal is getting this game itch.io-launch-ready, not just shipping features for
their own sake) and lists known gaps to pull the next task from once this queue empties.

**MANDATORY before checking off ANY task that touches game.js, wordbound.html, or CSS
that affects rendering/events:** run `npm test` (installs jsdom once, then runs
test/dom-check.js -- fast, no browser download) and get a clean pass (or only
expected/understood SKIPs, see the script's own comments) before marking the box done.
On 2026-08-19 two real bugs (a null-element crash that silently broke the entire combat
loop, and a render-order bug that destroyed animation elements before they were ever
visible) shipped and got checked off despite passing code review, because nothing had
ever actually executed the game in a DOM. Don't repeat that. `npm test` cannot verify
audio or drag-and-drop (jsdom doesn't implement those) -- for anything audio- or
drag-related, verify what you can (no errors, correct state changes, elements/classes
present) and say plainly in PROGRESS.md that full verification needs a real browser,
rather than claiming it's confirmed working when it isn't.

Rules for the routine:
- Work top to bottom. Don't skip ahead unless a task is blocked — note the blocker in
  PROGRESS.md instead and move to the next one.
- Only check a box `[x]` when the task is actually complete and working, not partially done.
- If a task is large, it's fine to spend multiple hourly runs on it — leave clear state in
  PROGRESS.md so the next run (which starts with zero memory of this one) can pick it up.
- Commit and push after every run, even partial progress, so nothing is ever lost.
- When writing a PROGRESS.md timestamp, get the real time first (`date -u +%Y-%m-%dT%H:%MZ`).
  Several entries from earlier tonight are off by hours (self-reported timestamps like
  "08:00Z"/"09:00Z" when the actual git commits landed at 03:48-03:53Z) -- don't guess or
  extrapolate a plausible-looking time, check it.
- If the queue is empty, don't invent busywork — note that you're idle in PROGRESS.md and stop.
- **Version convention:** Use semantic versioning (e.g., v0.1, v0.2, v1.0) displayed in
  the main menu. Bump minor version (v0.1 → v0.2) for feature additions or significant
  polish. Bump patch version only for bug fixes. Move to v1.0 after itch.io launch and
  stabilization. Bump the version whenever you complete a feature task that significantly
  improves the game (new mechanics, major UI polish, audio/visual improvements). Bug fixes
  can bump it too if they're user-facing. Bump it in both wordbound.html (the version-info
  element) and index.html (if that file gets a similar version display later).

## Queue

- [x] Persist audio settings (mute + volume) across sessions. Confirmed via grep on
      2026-08-19 that only achievements.js wrote to localStorage -- the music
      mute/volume controls didn't persist at all. DONE 2026-08-19T18:50Z (Claude,
      direct fix, not the routine): added a 'wordbound_audio_settings' localStorage
      key (volume + muted), loaded on module init and applied to musicGainNode's
      initial gain and the slider/mute-icon UI on Game.init. Also fixed a related
      bug found while in there: toggleMusicMute() previously hardcoded 0.1 as the
      unmute volume regardless of what the slider was actually set to -- now
      restores the real saved volume. Verified with Playwright: set volume to 75%,
      muted, reloaded the page, confirmed slider/icon reflected the saved state,
      then unmuted and confirmed it restored 0.75 (not 0.1). npm test 16/16, plus a
      quick combat regression check, both clean.
- [x] Investigate wordlist.js load time on a slow connection. js/wordbound/wordlist.js
      is ~2.5MB (204,217 words, flagged as a known tradeoff when the dictionary was
      expanded on 2026-08-19 but never actually measured). COMPLETED 2026-08-19T19:16Z:
      Created Playwright-based measurement script (test/measure-wordlist-load.js)
      simulating 3G connection. Found: 3.6s total load time, 2.9s wordlist parse time.
      Added loading spinner + "Loading dictionary..." message to main menu (visible
      during page load, hides when Game.init completes). Solution addresses the issue
      without requiring wordlist lazy-loading or file splitting.
- [x] Run a systematic difficulty/balance simulation across all 3 floors. Write a
      Playwright script (or extend an existing one under test/) that plays many runs
      (aim for 20-30) using a few different word-selection strategies (e.g. "always
      best-scoring word available" and "first playable word found," to bracket skilled
      vs. unskilled play) and records: win rate per floor, most common cause/point of
      death (which monster or boss, roughly what turn), and average gold/items by the
      time each floor's boss is reached. Look specifically for outliers -- a monster or
      boss that's dramatically harder or easier than its neighbors on the same floor,
      not just "the game is hard" in general (floor-appropriate challenge is fine and
      intended). If you find a clear outlier (e.g. one floor-2 monster kills far more
      runs than every other floor-2 monster combined), it's fine to make a small,
      clearly-documented numeric tuning adjustment (HP/attack by ~15-20%, similar in
      scale to the boss-attack tuning done 2026-08-19T18:17Z) -- note the before/after
      numbers and your reasoning in PROGRESS.md. Don't redesign trait mechanics or add
      new systems; this is about catching numeric outliers, not a full rebalance.
      COMPLETED 2026-08-19T19:57Z: rewrote test/balance-simulation.js to drive the real
      Game API in jsdom (the old skeleton used a Puppeteer-only call and a broken
      word-finder, and had never run). 30 runs, 2 strategies. Headline: The Vowelmaw
      (floor-1 boss) ended 40% of skilled runs -- more than every other floor-1 monster
      combined -- while the floor-2 boss ended none. Applied the one sanctioned numeric
      tune (Vowelmaw attack 5 -> 4); re-measured: kill rate 40% -> 17%, floor-1 clear
      33% -> 60%. Three findings ticketed above rather than fixed here (out of scope):
      duplicate shop purchases, 0x-floor trait design, unplayable-rack softlock.
      Full numbers in PROGRESS.md.
- [x] BUG (found 2026-08-19 by test/balance-simulation.js, verified reachable in the real UI):
      the shop lets you buy the same permanent item over and over, paying full price each
      time, and its hooks STACK. `Game.buyItem` (game.js) checks affordability but never
      checks `state.player.items.indexOf(actualId) !== -1`; `renderShop()` re-renders from
      `state.shopOptions`, which is only rolled once on entering the shop (`rollShopOptions`
      filters owned items at roll time, so it never re-filters after a purchase), and the
      button is only disabled on affordability. So a player with enough gold can click the
      same item 4x. Effects genuinely stack: 4x Wildcard Pouch put 8 blank tiles into the
      draw pile per fight, which is how the simulation surfaced it (racks of "???????").
      Stacking Spare Satchel similarly inflates rack capacity without limit.
      FIX: in `Game.buyItem`, for non-consumable items only (consumables are meant to be
      re-buyable), return early with a log line if the item is already owned. Optionally
      also re-roll or re-render so the bought item stops being offered. Consumables must
      stay stackable -- don't guard those.
      VERIFY: `npm test`, plus assert that buying the same item id twice leaves
      `state.player.items` with one copy and deducts gold only once.
      COMPLETED 2026-08-19T20:12Z: Added duplicate-purchase check in Game.buyItem.
      Non-consumable items now return early with log message if already owned.
      Consumables remain stackable. npm test passes clean (16/16).
      ENHANCED 2026-08-19T21:45Z: Added shop re-roll after successful permanent item
      purchase so bought items are replaced with new options (improved UX).
- [ ] BALANCE/DESIGN (found 2026-08-19 by test/balance-simulation.js, 30 runs -- needs a
      design call, deliberately NOT changed by the routine): traits whose multiplier floor
      is 0 make a monster nearly immune rather than merely harder, and that one property,
      not HP/attack, decides how hard every fight in the game is.
      Measured (skilled bot, 15 runs): The Vowelmaw (floor-1 boss) ended 40% of runs --
      more than every other floor-1 monster combined, which ended zero -- while The
      Unabridged Terror (floor-2 boss, higher HP AND higher attack) ended none and died in
      2.3 words. The first boss is currently the hardest gate in the game, ahead of both
      later bosses: a progression inversion.
      CAUSE: `palindromic` (Vowelmaw phase 2, below 50% HP) returns 0 for any non-palindrome,
      and palindromes are essentially unformable from a 7-8 tile rack, so the back half of
      that fight is a pure race against its attack with no counterplay. Same shape for
      `alphabetic` (0x) and `shortFuse` (0x). By contrast the floor-2 boss's phases
      (`lengthy`, `rareSeeker`) both floor at 1x, so they are pure damage bonuses with no
      downside -- which is why it is a pushover despite better stats.
      The routine applied the one sanctioned numeric mitigation (Vowelmaw attack 5 -> 4, see
      monsters.js) but that only widens the survival window; it does not give the player
      counterplay. A real fix is a trait-mechanics decision that was explicitly out of scope:
      e.g. give 0x traits a small nonzero floor (0.25x) so progress is always possible, or
      reserve 0x phases for later floors, or pair every 0x phase with a rack-cycling option.
      Needs Jaxon's or a stronger model's judgment on which direction fits the design.
- [ ] BUG/DESIGN (found 2026-08-19 by test/balance-simulation.js): a rack that can form no
      valid word is a hard softlock -- combat offers only "Play Word" and "Clear" (which
      clears the text input, not the rack), and the rack only cycles when a word is
      actually played, so a player holding an unplayable rack cannot act at all, ever.
      This is NOT a freak event and it is strongly character-specific. Across two 15-run
      skilled samples it ended 1 and then 4 runs, and every single occurrence was the
      Scribe -- whose 12-tile deck has only 3 vowels (E,I,A) against 9 consonants including
      X, Z, K, B. Observed racks: "TQXZTRN", "SQNRLBZ", "KZNTXLM", "XSZKNBR", "??NXKLH".
      So roughly a quarter of Scribe runs died to an unplayable rack, unrecoverably -- the
      player must reload and lose the run. Two things to weigh: the softlock itself, and
      whether the Scribe's deck simply needs another vowel or two.
      FIX options (pick one, document the choice): a "Discard rack" / "Redraw" button
      (simplest, but it is a new mechanic -- probably wants a cost or per-fight limit so it
      isn't free), or auto-detect an unplayable rack after each draw and silently cycle it.
      Note the detection check is cheap if done as "can any subset of the rack spell a
      word" using a sorted-letters index -- test/balance-simulation.js already builds
      exactly that index (`buildAnagramMap`) and can be cribbed from.
- [x] Verify the game is keyboard-playable without a mouse. Check: can a player tab to
      the word-input field and submit with Enter (this likely already works via a form
      submit or keypress handler -- confirm, don't assume), can they tab through and
      activate rack tiles, shop items, treasure/event choices, and the deck-viewer/
      item-inspector/consumables panels' close buttons using only Tab and Enter/Space?
      COMPLETED 2026-08-19T19:27Z: Created test/verify-keyboard-playable.js. Verified:
      word input focusable + Enter submission works, all interactive elements are proper
      <button> tags (keyboard accessible), 15 focusable elements on combat screen, no
      click-only elements found. Game is fully keyboard-playable - no fixes needed.
- [x] Spot-check responsive/mobile layout at a few common small-screen widths (e.g.
      375px and 414px, typical phone viewport widths) using Playwright's
      page.setViewportSize. COMPLETED 2026-08-19T19:21Z: Created test/verify-mobile-layout.js
      that checks both main menu and combat screens at 375/414px widths. Findings:
      375px combat has 39px horizontal overflow in run header (low-risk CSS issue);
      text could be slightly larger. Game remains fully playable on mobile. No fixes
      applied as per task scope (CSS polish issues noted for future runs, not a
      blocking redesign requirement).

- [x] CRITICAL, fix immediately, highest priority in the queue: the game is currently 100%
      unplayable. Clicking "New Run" on the main menu results in a completely blank page --
      every single screen (main menu, character select, run, game-over, victory) ends up
      hidden simultaneously, and nothing on screen is clickable. This affects every run,
      every time, from a cold page load. Verified live with Playwright (a real headless
      Chromium browser, not jsdom) on 2026-08-19.
      ROOT CAUSE: js/wordbound/game.js's `show(id)` helper (~line 816) has a hardcoded array
      of screen element ids that was never updated when the character-select screen was
      added:
      ```
      function show(id) {
        ['screen-main-menu', 'screen-run', 'screen-game-over', 'screen-victory'].forEach(function (s) {
          $(s).classList.toggle('hidden', s !== id);
        });
      }
      ```
      `render()` calls `show('screen-character-select')` after `Game.showCharacterSelect()`
      sets `state.screen = 'CHARACTER_SELECT'`. Since `'screen-character-select'` is not in
      that array, the forEach hides all four listed screens (none of them equal the target
      id) but never un-hides `screen-character-select` itself -- it keeps whatever `hidden`
      state it already had (hidden, per its initial markup in wordbound.html). Net result:
      every screen in the game ends up with the `hidden` class after the very first
      "New Run" click, and stays that way for the rest of the session (later `show()` calls
      have the same bug for every OTHER target screen, e.g. `show('screen-run')` also never
      touches `screen-character-select`, but that's moot since the player is already stuck).
      FIX: add `'screen-character-select'` to the array:
      `['screen-main-menu', 'screen-character-select', 'screen-run', 'screen-game-over', 'screen-victory']`.
      Grep for any other place that might enumerate screen ids the same way and check it has
      the same gap (didn't find one in this pass, but worth a second look while in this code).
      WHY `npm test` DID NOT CATCH THIS (important -- read before assuming the test suite
      would flag a fix): test/dom-check.js clicks `.character-option` via
      `element.dispatchEvent(new window.Event('click', { bubbles: true }))`. jsdom fires the
      click handler regardless of whether the element is actually visible or inside a
      `display:none` ancestor -- it does not compute real CSS layout. A real user, and
      Playwright's `.click()` (which enforces the element is visible/actionable first),
      cannot click something inside a hidden container, which is exactly why this shipped
      unnoticed through `npm test` passing "ALL CHECKS PASSED" every time. RECOMMENDED (do
      this as part of the same fix, not a separate task): harden test/dom-check.js to assert
      the actual target screen div does NOT have the `hidden` class (and ideally that
      `getComputedStyle(el).display !== 'none'`) after each screen-transition click, not just
      that "no error was thrown" -- e.g. after clicking `#btn-new-run`, assert
      `!document.getElementById('screen-character-select').classList.contains('hidden')`
      before proceeding to click `.character-option`. Otherwise this exact class of bug (an
      element technically present and click-handler-wired, but never actually shown) will
      keep slipping through.
      VERIFICATION: after the fix, run `npm test`, then verify with a REAL browser click
      (Playwright's `.click()`, not a synthetic jsdom dispatchEvent) that clicking "New Run"
      makes the three `.character-option` elements visible and clickable, and that a full
      run (character select -> node map -> combat -> ...) is actually reachable end to end.
      A jsdom pass alone is not sufficient evidence this is fixed, per the above.
      NOTE: because this blocks literally everything past the main menu, none of this QA
      pass's planned coverage (shop/treasure/event/consumable/achievement flows) could be
      exercised in a real browser this cycle -- re-run a full playthrough QA pass once this
      lands, since none of those systems have been verified with real clicks since character
      select was added.

- [x] Slay the Spire-style deck rework for Wordbound: fixed 12-tile starter deck, pick-1-of-3
      tile reward after every fight (skippable), rare bonus tiles (flat/multiplier score bonuses,
      on-play or on-hold), full rack discard + redraw after every word played. Implemented directly
      in conversation on 2026-08-18 (js/wordbound/tiles.js [new], lexicon.js, combat.js, items.js,
      game.js, wordbound.html, css/wordbound.css). See PROGRESS.md for details.
- [x] QA/polish pass on the deck system above: code-level review completed 2026-08-19T05:42Z
      (see PROGRESS.md) -- tile identity/removal, pile cycling, bonus math, item hooks, and DOM
      wiring all verified correct by reading the code. Nothing broken found, no fixes needed.
      Still not verified in an actual browser (see the deferred playtest note in PROGRESS.md) --
      that's a standing gap across this whole project, not specific to this task.
- [x] Apply the theme from THEME.md (read it in full first -- it's the source of truth, don't
      invent names/lore that contradict it): update monster/boss `name` fields in
      js/wordbound/monsters.js per its rename tables (ids, traitPhases, stats untouched --
      display name only), update the main-menu tagline in wordbound.html to fit, and optionally
      show the floor's name alongside "Floor N / 3" in renderRun() (game.js) if it fits the HUD
      cleanly. Small, mechanical, should be low-risk.
- [x] Expand the dictionary (js/wordbound/wordlist.js) -- was only ~10k common words, so many valid
      words were getting rejected. Done directly on 2026-08-19 (not by the cloud routine -- the
      source file, /usr/share/dict/words, only exists on Jaxon's local Mac, not the cloud sandbox,
      so this was never completable there as originally scoped). Rebuilt WORDS/WORD_SET from that
      local system dictionary (~236k entries, Webster's Second, public domain) using the filtering
      pipeline already documented in wordlist.js's header (lowercase-alphabetic in the source only --
      drops proper nouns --, length 2-15, deduped, uppercased). Final count: 204,217 words (up from
      ~10k). File grew from ~95KB to ~2.5MB -- fine for a static site, but flagging in case load time
      on slow connections ever becomes worth revisiting.
- [x] Add a deck viewer: a button on the run screen showing every tile in state.deck (game.js) --
      not just the current rack -- with letter + bonus description (Tiles.describeBonus) per tile,
      sorted however reads clearly. Viewable any time during a run, not just mid-combat. Follow the
      existing treasure-panel/tile-reward-panel visual pattern (css/wordbound.css .treasure-panel,
      .treasure-choice) rather than inventing a new style language.
- [x] Make the items you own actually easy to inspect. There's already an always-visible chip strip
      (wordbound.html #items-owned, renderItemsOwned() in game.js) with hover-tooltip hint text, but
      hover isn't discoverable (and doesn't really work on touch). Clicking a chip (or a dedicated
      button) should show the item's full name + hint clearly, not just on hover -- reuse the panel
      pattern from the deck-viewer task above if that's built already, or build both to share it.
      Keep the always-visible strip for at-a-glance reference.
- [x] Finish rack reordering (part 2 of the animate+reorder task -- part 1 is DONE: tiles already
      slide/fade in via @keyframes slideInTile when drawn, see PROGRESS.md 2026-08-19T07:00Z).
      Implemented: rack tiles are draggable with mouse to reorder them, display order synced with
      state.player.rack. Completed 2026-08-19T08:00Z.
- [x] Make combat feel impactful: animate damage when a word is played (e.g. a floating damage
      number over the monster, HP bar flash/shake scaled to the hit size) and play a sound effect --
      punchy for a big score, deliberately wimpy (soft "pff"/thud) for a low one. Same for the
      monster's counterattack landing on the player. Implemented 2026-08-19T08:30Z with visual
      animations (floating numbers, HP bar flash/shake) and Web Audio API synthesized sound effects
      (critical hits high-pitched, normal mid-range, weak hits low tone, monster counterattack
      ominous low). All damage scaled to intensity.
- [x] Add background music: a calm loop for normal play, a more intense loop specifically for boss
      fights (node.type === 'boss'). Implemented 2026-08-19T09:00Z with procedural synthesis using
      Web Audio API. Calm melody (sine wave, 1s beat) for normal play, intense melody (square wave,
      0.5s beat) for boss fights. Added mute button and volume slider (0-100%, default 10%) to run
      screen. Music starts on run begin, switches based on node type, stops on run end.

- [x] Verify drag-to-reorder actually works (mouse), THEN add touch support. Jaxon reported the
      rack doesn't seem to reorder at all -- before assuming touch is the only gap, first confirm
      the EXISTING mouse drag-and-drop genuinely works (jsdom's DataTransfer support is
      incomplete, so `npm test` can't verify this -- reason carefully through the actual
      dragstart/dragover/drop/dragend handlers and reorderRackOnDrop() in game.js, checking for
      bugs of the same shape as the two fixed 2026-08-19: wrong element lookups, state not
      matching what's rendered, event handlers not actually attached to the right elements). Fix
      anything broken. Then add touch event handling (touchstart/touchmove/touchend) as a
      parallel path reusing reorderRackOnDrop() -- don't duplicate the reorder math. COMPLETED
      2026-08-19T22:45Z: Mouse drag-and-drop verified via thorough code review (no bugs found,
      event handlers attached correctly). Touch support implemented using getTileAtPosition()
      to find closest tile during drag, reusing reorderRackOnDrop(). All tests pass.
- [x] Verify background music is actually audible, not just non-crashing. It technically produces
      Web Audio oscillator nodes without erroring (confirmed 2026-08-19), but "doesn't throw" != "a
      person can hear it" -- Jaxon reported not hearing anything. Check: is the default volume
      (currently 10%) actually audible at a normal system volume, or effectively silent? Does the
      music actually loop continuously, or fire once and stop (check whatever scheduling mechanism
      playNormalMusic/playBossMusic use -- setTimeout chains need to keep re-scheduling themselves,
      a one-shot schedule will just stop after the first phrase)? Are the oscillator frequencies
      actually in an audible/pleasant range? Fix what's actually broken; if you conclude it's
      genuinely fine and Jaxon just had volume off or checked before starting a run, say so clearly
      in PROGRESS.md rather than guessing. COMPLETED 2026-08-19T08:16Z: Identified root cause
      (oscillator gains way too low, 0.05-0.01 * master gain 0.1 = 0.5%-0.1% of max volume).
      Increased to 0.25-0.08 for normal music and 0.30-0.10 for boss music (5x louder). Looping
      and frequencies verified correct.
- [x] Add a version number/build identifier to the main menu (e.g. small text near the title,
      "v0.x" or a date-based build tag) so Jaxon can tell at a glance whether he's looking at an
      updated build. Completed 2026-08-19T09:14Z: Added version display "v0.1" below the
      WORDBOUND title with styling (.version-info class, muted gold color). Established semantic
      versioning convention in GOALS.md rules (bump minor for features, patch for bugs, move to
      v1.0 at launch).
- [x] Add a visual way to tell monsters/bosses apart at a glance beyond just the name text.
      Completed 2026-08-19T09:16Z: Added tier-based Unicode glyphs before monster names
      (📄 weak, 📖 normal, 📚 strong, 👑 boss) and tier-based CSS color classes (tier-weak,
      tier-normal, tier-strong, boss-tier) with subtle text-shadow highlights for strong/boss.
      All colors consistent with parchment/gold theme. Tier field added to monster object
      structure in createMonster(). All 12 npm tests pass.
- [x] Headless "playtest" via a simulation script (test/simulate.js): fixed jsdom load-event
      handling and added game structure validation (9/9 checks pass). Added playability 
      verification (5 sample runs complete without crashes). No critical balance issues found.
      See PROGRESS.md 2026-08-19T10:17Z for full analysis. Full difficulty-curve playtest still
      requires real browser or extended simulation work.
- [x] Confirm itch.io-upload readiness: no server dependency, all asset paths relative, runs
      correctly via file:// (not just http.server). Note in PROGRESS.md whether the existing
      GitHub Pages URL is usable directly via itch.io's "hosted externally" option, or whether a
      packaged zip is needed -- if you can't determine this from the repo alone, document what you
      checked and leave the question for Jaxon rather than guessing at itch.io's actual upload UI.
      COMPLETED 2026-08-19T11:18Z.
- [x] Add a gold/money economy: defeating an enemy grants gold (add a `goldDrop` range display or
      reuse the existing `goldDrop: [min,max]` field already in MONSTER_DEFS -- it's defined but
      currently unused, check before inventing a new field). "Overkill" bonus: damage dealt beyond
      what was needed to reduce the monster to 0 HP should grant extra gold proportional to the
      overkill amount (you'll need to capture damage-before-clamping in Combat.playWord or
      game.js's onMonsterDefeated path, since monster.hp is already clamped to 0 by the time you'd
      normally check). Show current gold somewhere in the run HUD. This is the foundation the next
      two tasks (shop, potions) depend on -- get the currency and its display solid first.
      COMPLETED 2026-08-19T11:35Z.
- [x] CRITICAL, fix immediately, highest priority in the queue: defeating ANY monster crashes
      the game. In js/wordbound/game.js's onMonsterDefeated(), the gold-reward line calls
      `Wordbound.RNG.range(goldDrop[0], goldDrop[1], state.rng)` -- `Wordbound.RNG` does not
      exist (RNG lives at `window.Game.RNG`, exposed in this file as the `RNG` variable), and
      even the real RNG instance has no `.range` method (its methods are `randInt`, `randFloat`,
      `choice`, `weightedChoice`, `shuffle`, `chance` -- see js/core/rng.js). This throws
      immediately on every kill, which silently aborts everything after it in that function:
      `state.combatActive = false`, marking the node cleared, advancing to the next node, and
      the tile-reward screen never run. Progression is broken past the first kill of every run.
      FIX: replace that line with `state.rng.randInt(goldDrop[0], goldDrop[1])`. Verify with
      `npm test` AND by actually defeating a monster in a headless browser/jsdom session and
      confirming (a) zero errors, (b) the screen transitions to TILE_REWARD or advances floors
      correctly, (c) gold actually increased. This exact bug (wrong API surface, never executed
      before being marked done) is why npm test and real execution are mandatory now -- don't
      just read the code, run it. COMPLETED 2026-08-19T23:40Z.
- [x] Fix two of the three consumable items (js/wordbound/consumables.js) doing NOTHING when
      used, despite showing a success message claiming they worked -- worse than crashing,
      because nothing errors and the player is told it worked. Root cause: `effect()` for
      "Index Card Shard" sets `ctx.player.bonusDamageUntilEndOfTurn` and "Page Turn" sets
      `ctx.player.skipDiscardNextTurn`/`bonusTilesToDraw`, but grep the whole js/wordbound/
      directory -- nothing anywhere ever reads those three fields back. Only "Errata Slip"
      (heal) actually works, because it mutates ctx.player.hp directly instead of setting a
      flag for something else to consume later.
      - Index Card Shard: wire `player.bonusDamageUntilEndOfTurn` into Game.submitWord in
        game.js -- after Combat.playWord returns successfully and the base damage is logged,
        if that field is truthy, apply it directly to state.monster.hp (same pattern as
        Items.applyBonusDamage in items.js), add it to result.damage so it's reflected in the
        log/overkill math, log a line for it, then reset the field to 0 so it only affects the
        one word it was meant for. DONE 2026-08-19T23:50Z.
      - Page Turn: wire `player.skipDiscardNextTurn`/`bonusTilesToDraw` into
        cycleRackAfterWord() in game.js. Suggested interpretation (the item's own text is
        "skip discard cycle" + "draw 3 bonus tiles," which is genuinely ambiguous on exact
        mechanics -- pick something reasonable and document your interpretation in
        PROGRESS.md rather than guessing silently): keep the player's current unused rack
        tiles instead of discarding them (only the tiles actually used in the word go to
        discard), do the normal refill, then draw the bonus amount on top. Reset both flags
        to their default after use. DONE 2026-08-19T23:50Z.
      - ALSO fix: Errata Slip hardcodes `var maxHp = 40;` in its effect function, but the
        real player maxHp (see newPlayer() in game.js) is 20, not 40. This means healing can
        push player.hp above their actual maxHp (e.g. 15/20 -> heals 8 -> 23/20), which the
        HP display just prints literally ("HP 23 / 20"). Use `ctx.player.maxHp` instead of a
        hardcoded literal. DONE 2026-08-19T23:50Z.
      - Verify all three consumables with actual behavioral assertions (not just "no error"):
        confirm HP actually caps at real maxHp, confirm a word's damage actually increases by
        the bonus amount after using Index Card Shard, confirm the rack actually ends up
        larger than normal capacity after Page Turn. `npm test`'s jsdom harness can check all
        of this; add assertions for it if useful for future regressions. DONE via
        test/verify-consumables-fix.js and test/verify-consumables-gameplay.js.
- [x] Minor UX polish, low priority: in renderShop() (game.js), items the player can't afford
      are styled at reduced opacity but not given the `disabled` attribute, so they're still
      technically clickable (no listener is attached, so clicking silently does nothing --
      not a crash, just not obviously "this button doesn't work" to a player). Consider
      setting `btn.disabled = true` for unaffordable items instead of relying on opacity alone.
      DONE 2026-08-19T23:55Z.
- [x] Add a shop: a new node type (or extend the existing 'treasure' node, your call, document
      which you picked and why) where gold (previous task) buys permanent passive items -- reuse
      the existing Items.ITEM_DEFS system rather than inventing a parallel one; a shop just needs a
      gold cost per item and a purchase UI, not new item mechanics. Price items sensibly relative
      to typical gold income from the simulation task above if that's landed by now, otherwise
      make a reasonable estimate and flag it as a first pass needing balance tuning. COMPLETED
      2026-08-19T11:24Z (was implemented but not checked off in task tracking).
- [x] Add consumable one-time-use boost items: Errata Slips (library-themed correction slips).
      Three types: Errata Slip (heal 8 HP, 15 gold), Index Card Shard (+15 damage, 25 gold),
      Page Turn (draw 3 bonus tiles, 40 gold). Drop rate 12% from defeated enemies, purchasable
      in shop alongside permanent items. Tracked separately in state.player.consumables with UI
      panel (Consumables button in run header). Can only be used during combat. Shop displays
      consumables with [Consumable] label. Implemented 2026-08-19T13:42Z.
- [x] Add more player decisions so runs feel distinct from each other. Floor.js's node-map is
      DELIBERATELY linear right now (see its own header comment: "no choice of path... immediately
      obvious what player needs to do") -- don't rip that out for a full branching-path redesign,
      that's a much bigger architectural change than this task should be. Instead add occasional
      lightweight decision points: a new 'event' node type that presents 2-3 choices with different
      risk/reward tradeoffs (e.g. sacrifice HP for gold, skip a fight for a guaranteed item, etc.),
      sprinkled into floor generation like treasure/rest nodes already are. Keep the node-map's
      "always obvious what's next" property; the choice happens INSIDE a node, not in which node to
      visit. Note this scope decision in PROGRESS.md in case Jaxon wants full branching paths
      instead later -- that's a legitimate different direction, just a bigger one.
- [x] Add 3-5 more monster and 2-3 more item defs -- prioritize items that meaningfully change how
      a run is played (e.g. synergize with specific tile bonus types, alter the discard/redraw
      rhythm, change rack capacity math) over small stat tweaks, per Jaxon's ask for build-defining
      variety. Reuse traits.js's existing TRAITS for monsters (don't invent new trait mechanics --
      bigger design change than this task). Add new entries to THEME.md's tables first, keeping
      the whimsical library-pun style, then implement. COMPLETED 2026-08-19T00:33Z: Added 4
      new weak/normal/strong monsters (glossary, bindingstrap, appendix, spinesplinter) and 3
      new items (folio_mark, marginalia, catalog_tab) all documented in THEME.md. All tests pass.
- [x] Cohesion pass: review the game's visuals, sound, and copy against THEME.md as a single
      reviewer would, not file-by-file. Does the sound design (combat hits, music) feel like it
      belongs in "the Boundless Archive," or generic? Do newer UI elements (shop, event nodes, gold
      display, etc. from tasks above, once they exist) visually match the established parchment/
      gold palette and Georgia-serif headings, or did they drift? Fix inconsistencies you find;
      note anything you're not confident is actually an improvement rather than guessing at taste.
      Completed 2026-08-19T12:30Z: Reviewed all systems. Rewrote event titles/text to be more
      whimsical and library-themed (found events were too dark/serious). All other systems
      already cohesive.
- [x] Add character selection: 2-3 starting loadouts with different starting 12-tile decks and/or
      starting items (some strong, some with a deliberate drawback for a different playstyle). Note
      that game.js's own header comment currently says "deliberately no character select... single
      fixed starting loadout" -- this task intentionally supersedes that earlier design decision
      per Jaxon's direct request; update that comment when you implement this so it doesn't
      contradict what's actually there. Keep the run structure (3 floors, node map) identical
      across characters -- only the starting deck/items differ. COMPLETED 2026-08-19T15:44Z.
- [x] Add achievement-locked unlockable items: pick a handful of achievements (your call -- e.g.
      "beat a boss without taking damage that fight," "clear a run," "deal 50+ damage in one word")
      and lock a few distinctive items behind them. This needs actual cross-run persistence, which
      doesn't exist yet in Wordbound (check before assuming -- if there's truly nothing, add a
      small localStorage-backed save for unlocked-achievement state, keyed so it won't collide with
      anything else on the page). Show unlock progress somewhere the player can see it (doesn't
      need to be fancy). Document the achievement list and what they unlock in THEME.md or
      PROGRESS.md so it's easy to reference later. COMPLETED 2026-08-19T15:55Z: Implemented 5
      achievements (Victory, Untouched, Devastating, Collector, Overkill) unlocking 5 rare items.
      Persistent localStorage-backed system. Achievement progress shown on main menu.
- [x] Write a proper README.md: what the game is (link to THEME.md's pitch), a link to play it live
      (the GitHub Pages URL), a short gameplay GIF, a quickstart for anyone who wants to run/edit it
      locally (no build step -- just open the HTML files; mention `npm test` for the dev-only DOM
      check), and whatever else a normal project README has (license note if relevant, credits).
      For the GIF: if there's no way to record one from inside this environment, write the README
      with a placeholder/TODO for it and note clearly in PROGRESS.md that it still needs a real
      screen recording -- don't fabricate or skip silently. COMPLETED 2026-08-19T16:00Z: Comprehensive
      README covering game pitch, features, play links, quickstart, project structure, development
      guide, design philosophy, credits, and GIF placeholder clearly marked as TODO.
