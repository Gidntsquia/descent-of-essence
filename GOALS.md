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
