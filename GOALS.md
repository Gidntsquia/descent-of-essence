# Goals

This file is the task queue for the autonomous hourly dev routine. Jaxon (or Claude,
acting on Jaxon's behalf) adds tasks here. Each hourly run picks the first unchecked
item, does a complete, working chunk of progress on it, checks it off when fully done,
and logs what happened in PROGRESS.md.

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
- [ ] QA/polish pass on the deck system above: check rack and tile-reward screen UI/UX clarity
      (especially the bonus-tile highlight and tooltip), verify item hooks (lucky_vowel,
      wildcard_pouch) behave correctly against the new draw/discard pile model, look for edge
      cases (empty deck+discard mid-fight, duplicate-letter tile identity, etc.), and playtest a
      full run if possible. Fix anything clearly broken; leave genuinely ambiguous design calls
      (e.g. reward-screen skip option, bonus tile rarity tuning) noted in PROGRESS.md for Jaxon
      rather than guessing.
- [ ] Apply the theme from THEME.md (read it in full first -- it's the source of truth, don't
      invent names/lore that contradict it): update monster/boss `name` fields in
      js/wordbound/monsters.js per its rename tables (ids, traitPhases, stats untouched --
      display name only), update the main-menu tagline in wordbound.html to fit, and optionally
      show the floor's name alongside "Floor N / 3" in renderRun() (game.js) if it fits the HUD
      cleanly. Small, mechanical, should be low-risk.
- [ ] Expand the dictionary (js/wordbound/wordlist.js) -- it's only ~10k common words right now
      (first20hours/google-10000-english), so many valid words get rejected. This machine already
      has a much bigger public-domain list locally at /usr/share/dict/words (~236k entries,
      Webster's Second via macOS) -- do NOT fetch anything from the internet, that local file is
      sufficient and license-safe. Rebuild WORDS/WORD_SET using the SAME filtering pipeline already
      documented in wordlist.js's header (alphabetic only, length 2-15, deduped, uppercased) applied
      to /usr/share/dict/words instead, and additionally drop any entry that isn't all-lowercase in
      the source (that file capitalizes proper nouns like "Aaron" -- Wordbound has no proper-noun
      concept). Update the header comment to describe the new source. Note the final word count in
      PROGRESS.md. Pure data swap -- same WORD_SET Set-of-strings shape, don't touch Lexicon or
      anything that reads this file.
- [ ] Add a deck viewer: a button on the run screen showing every tile in state.deck (game.js) --
      not just the current rack -- with letter + bonus description (Tiles.describeBonus) per tile,
      sorted however reads clearly. Viewable any time during a run, not just mid-combat. Follow the
      existing treasure-panel/tile-reward-panel visual pattern (css/wordbound.css .treasure-panel,
      .treasure-choice) rather than inventing a new style language.
- [ ] Make the items you own actually easy to inspect. There's already an always-visible chip strip
      (wordbound.html #items-owned, renderItemsOwned() in game.js) with hover-tooltip hint text, but
      hover isn't discoverable (and doesn't really work on touch). Clicking a chip (or a dedicated
      button) should show the item's full name + hint clearly, not just on hover -- reuse the panel
      pattern from the deck-viewer task above if that's built already, or build both to share it.
      Keep the always-visible strip for at-a-glance reference.
- [ ] Animate the rack and make it reorderable: (1) tiles drawn into the rack (refillRack in
      game.js) should visibly slide/animate into place rather than just appearing -- a CSS
      transition is enough, no physics engine needed. (2) rack tiles should be draggable with the
      mouse to reorder them, and the DISPLAY order must stay in sync with state.player.rack's actual
      order, since clicking/typing tiles builds the word left-to-right from rack order. This is the
      biggest task in the queue -- if it doesn't fit one hourly run, leave the rack visually
      functional (even if unanimated/undraggable) at the end of every run and resume exactly where
      you left off using PROGRESS.md notes. Touch/mobile drag is nice-to-have, not required.
- [ ] Make combat feel impactful: animate damage when a word is played (e.g. a floating damage
      number over the monster, HP bar flash/shake scaled to the hit size) and play a sound effect --
      punchy for a big score, deliberately wimpy (soft "pff"/thud) for a low one. Same for the
      monster's counterattack landing on the player. Do NOT fetch/download any external audio files
      -- synthesize sound effects with the Web Audio API directly (oscillators + gain envelopes,
      e.g. a short pitch-swept tone for hits, a noise burst for a whiff). Browsers block audio until
      a user gesture, which is already satisfied by the time combat sound would play. Scale
      intensity to score/damage so big plays are distinctly more satisfying than small ones, and
      don't make it obnoxious on every single word.
- [ ] Add background music: a calm loop for normal play, a more intense loop specifically for boss
      fights (node.type === 'boss'). Same constraint as the sound-effects task -- no external audio
      files, synthesize procedurally with the Web Audio API (a simple looping oscillator melody/
      bassline is enough, doesn't need to be sophisticated). Add an easy-to-find mute/volume control
      on the run screen, defaulting to a reasonable low-to-moderate volume. Can share a single
      AudioContext with the sound-effects task above but doesn't need to depend on it landing first.
