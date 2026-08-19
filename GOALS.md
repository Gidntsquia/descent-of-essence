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

## Queue

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
- [ ] Add a version number/build identifier to the main menu (e.g. small text near the title,
      "v0.x" or a date-based build tag) so Jaxon can tell at a glance whether he's looking at an
      updated build. Bump it as part of this task; doesn't need to auto-increment, just needs to
      visibly change when meaningful updates ship -- use your judgment on when future tasks should
      bump it too (mention the convention in this file's rules section once you've set it up).
- [ ] Add a visual way to tell monsters/bosses apart at a glance beyond just the name text.
      boss-name CSS class already exists (redder text) -- build on that rather than replacing it.
      No image assets are available (no way to source/generate art in this pipeline), so this has
      to be CSS/typography/motion-based: consider a colored accent border or icon-like Unicode
      glyph per monster tier (weak/normal/strong/boss), or a small per-monster color derived
      deterministically from its id/trait. Keep it consistent with THEME.md's aesthetic (warm
      parchment/gold, not a clashing new palette).
- [ ] Headless "playtest" via a simulation script (test/simulate.js or similar, committed since
      it's genuinely useful going forward): load the actual game modules (same jsdom or vm-shim
      technique as test/dom-check.js) and drive many simulated runs with a simple heuristic player
      (always plays the highest-scoring word it can form). Answer: does a reasonable player usually
      survive floor 1? Is any floor a difficulty cliff? Any monster trait impossible or trivial to
      exploit? Any item clearly overpowered or useless? Write findings to PROGRESS.md. Fix anything
      clearly broken (a monster no reasonable word can ever damage, a run that's unwinnable by
      design); leave subjective difficulty-curve opinions for Jaxon.
- [ ] Confirm itch.io-upload readiness: no server dependency, all asset paths relative, runs
      correctly via file:// (not just http.server). Note in PROGRESS.md whether the existing
      GitHub Pages URL is usable directly via itch.io's "hosted externally" option, or whether a
      packaged zip is needed -- if you can't determine this from the repo alone, document what you
      checked and leave the question for Jaxon rather than guessing at itch.io's actual upload UI.
- [ ] Add a gold/money economy: defeating an enemy grants gold (add a `goldDrop` range display or
      reuse the existing `goldDrop: [min,max]` field already in MONSTER_DEFS -- it's defined but
      currently unused, check before inventing a new field). "Overkill" bonus: damage dealt beyond
      what was needed to reduce the monster to 0 HP should grant extra gold proportional to the
      overkill amount (you'll need to capture damage-before-clamping in Combat.playWord or
      game.js's onMonsterDefeated path, since monster.hp is already clamped to 0 by the time you'd
      normally check). Show current gold somewhere in the run HUD. This is the foundation the next
      two tasks (shop, potions) depend on -- get the currency and its display solid first.
- [ ] Add a shop: a new node type (or extend the existing 'treasure' node, your call, document
      which you picked and why) where gold (previous task) buys permanent passive items -- reuse
      the existing Items.ITEM_DEFS system rather than inventing a parallel one; a shop just needs a
      gold cost per item and a purchase UI, not new item mechanics. Price items sensibly relative
      to typical gold income from the simulation task above if that's landed by now, otherwise
      make a reasonable estimate and flag it as a first pass needing balance tuning.
- [ ] Add consumable one-time-use boost items (pick a name that fits THEME.md's library/archive
      theme better than "potion" -- something like "Bookmark," "Errata Slip," "Loose Leaf," or your
      own pick, add it to THEME.md first for consistency). Big one-time effect on use (heal, temp
      damage boost, free tile, your call on the specific effects -- keep them simple and clearly
      different from existing permanent items). Should sometimes drop from defeated enemies (small
      chance, tune it) and be purchasable in the shop (previous task). Track them as a separate
      inventory list from permanent items (state.player.consumables or similar), with a UI to view
      and use them during combat.
- [ ] Add more player decisions so runs feel distinct from each other. Floor.js's node-map is
      DELIBERATELY linear right now (see its own header comment: "no choice of path... immediately
      obvious what player needs to do") -- don't rip that out for a full branching-path redesign,
      that's a much bigger architectural change than this task should be. Instead add occasional
      lightweight decision points: a new 'event' node type that presents 2-3 choices with different
      risk/reward tradeoffs (e.g. sacrifice HP for gold, skip a fight for a guaranteed item, etc.),
      sprinkled into floor generation like treasure/rest nodes already are. Keep the node-map's
      "always obvious what's next" property; the choice happens INSIDE a node, not in which node to
      visit. Note this scope decision in PROGRESS.md in case Jaxon wants full branching paths
      instead later -- that's a legitimate different direction, just a bigger one.
- [ ] Add 3-5 more monster and 2-3 more item defs -- prioritize items that meaningfully change how
      a run is played (e.g. synergize with specific tile bonus types, alter the discard/redraw
      rhythm, change rack capacity math) over small stat tweaks, per Jaxon's ask for build-defining
      variety. Reuse traits.js's existing TRAITS for monsters (don't invent new trait mechanics --
      bigger design change than this task). Add new entries to THEME.md's tables first, keeping
      the whimsical library-pun style, then implement.
- [ ] Cohesion pass: review the game's visuals, sound, and copy against THEME.md as a single
      reviewer would, not file-by-file. Does the sound design (combat hits, music) feel like it
      belongs in "the Boundless Archive," or generic? Do newer UI elements (shop, event nodes, gold
      display, etc. from tasks above, once they exist) visually match the established parchment/
      gold palette and Georgia-serif headings, or did they drift? Fix inconsistencies you find;
      note anything you're not confident is actually an improvement rather than guessing at taste.
- [ ] Add character selection: 2-3 starting loadouts with different starting 12-tile decks and/or
      starting items (some strong, some with a deliberate drawback for a different playstyle). Note
      that game.js's own header comment currently says "deliberately no character select... single
      fixed starting loadout" -- this task intentionally supersedes that earlier design decision
      per Jaxon's direct request; update that comment when you implement this so it doesn't
      contradict what's actually there. Keep the run structure (3 floors, node map) identical
      across characters -- only the starting deck/items differ.
- [ ] Add achievement-locked unlockable items: pick a handful of achievements (your call -- e.g.
      "beat a boss without taking damage that fight," "clear a run," "deal 50+ damage in one word")
      and lock a few distinctive items behind them. This needs actual cross-run persistence, which
      doesn't exist yet in Wordbound (check before assuming -- if there's truly nothing, add a
      small localStorage-backed save for unlocked-achievement state, keyed so it won't collide with
      anything else on the page). Show unlock progress somewhere the player can see it (doesn't
      need to be fancy). Document the achievement list and what they unlock in THEME.md or
      PROGRESS.md so it's easy to reference later.
- [ ] Write a proper README.md: what the game is (link to THEME.md's pitch), a link to play it live
      (the GitHub Pages URL), a short gameplay GIF, a quickstart for anyone who wants to run/edit it
      locally (no build step -- just open the HTML files; mention `npm test` for the dev-only DOM
      check), and whatever else a normal project README has (license note if relevant, credits).
      For the GIF: if there's no way to record one from inside this environment, write the README
      with a placeholder/TODO for it and note clearly in PROGRESS.md that it still needs a real
      screen recording -- don't fabricate or skip silently.
