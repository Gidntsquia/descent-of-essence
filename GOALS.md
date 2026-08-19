# Goals

This file is the task queue for the autonomous hourly dev routine. Jaxon (or Claude,
acting on Jaxon's behalf) adds tasks here. Each hourly run picks the first unchecked
item, does a complete, working chunk of progress on it, checks it off when fully done,
and logs what happened in PROGRESS.md.

Read ROADMAP.md too, not just this file -- it's the "why" behind the current queue
(the goal is getting this game itch.io-launch-ready, not just shipping features for
their own sake) and lists known gaps to pull the next task from once this queue empties.

Rules for the routine:
- Work top to bottom. Don't skip ahead unless a task is blocked — note the blocker in
  PROGRESS.md instead and move to the next one.
- Only check a box `[x]` when the task is actually complete and working, not partially done.
- If a task is large, it's fine to spend multiple hourly runs on it — leave clear state in
  PROGRESS.md so the next run (which starts with zero memory of this one) can pick it up.
- Commit and push after every run, even partial progress, so nothing is ever lost.
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

- [ ] Fix rack-tile reordering on touch devices. The drag-to-reorder feature (task above)
      uses native HTML5 drag-and-drop (dragstart/dragover/drop events), which does NOT fire on
      touch screens -- so on phones/tablets the rack currently can't be reordered at all. Per
      ROADMAP.md, a lot of itch.io's traffic is mobile browser, so this matters. Add touch event
      handling (touchstart/touchmove/touchend) as a parallel path to the existing mouse drag
      handlers in game.js, reusing the same reorderRackOnDrop() logic -- don't duplicate the
      reorder math, just feed it from touch coordinates instead of drag events. Test your
      touch-position-to-rack-index math carefully by reasoning through it (no browser available);
      get the geometry right rather than approximating.
- [ ] Headless "playtest" via a simple simulation script: write a one-off Node script (put it
      somewhere like scripts/simulate.js, or just run it ad hoc and don't commit it if it's purely
      a diagnostic -- your call) that loads the actual game modules (same technique used for the
      verification harness in PROGRESS.md's 2026-08-19T02:29Z entry: shim `window`, load the
      Wordbound files into a vm context) and drives many simulated runs using a simple heuristic
      player (e.g. always plays the highest-scoring word it can form from the rack). Run enough
      simulations to answer: does a reasonable player usually survive floor 1? Is any floor a
      difficulty cliff? Does any monster trait seem impossible or trivial to exploit? Is any item
      clearly overpowered or useless? Write findings to PROGRESS.md. Fix anything that's clearly
      broken (a monster no reasonable word can ever damage, a run that's unwinnable by design);
      leave subjective balance/difficulty-curve opinions for Jaxon rather than guessing at "fun."
- [ ] Confirm the game is itch.io-upload-ready as a static zip: no server dependency (should
      already be true -- everything's plain files with no fetch() of external resources), all
      asset paths relative (not absolute, not assuming a specific host), and it actually runs
      correctly when opened via file:// (not just via a local http.server) since that's closer to
      how some itch.io/zip distribution scenarios work. Note in PROGRESS.md whether GitHub Pages
      hosting (already live) is sufficient for itch.io's "this game is hosted externally" option,
      or whether a packaged zip is actually needed -- if you can't determine this from the repo
      alone, just document what you checked and leave the open question for Jaxon rather than
      guessing at itch.io's upload requirements.
- [ ] Add 2-3 more monster and 1-2 more item defs to js/wordbound/monsters.js / items.js, using
      the existing pattern (a monster's trait comes from traits.js's existing TRAITS -- reuse
      those rather than inventing new trait mechanics, that's a bigger design change than this
      task) and THEME.md's naming/tone (add new entries to THEME.md's tables first, keeping the
      whimsical library-pun style, then implement). This is about replayability variety, not a
      new mechanic -- keep scope tight.
