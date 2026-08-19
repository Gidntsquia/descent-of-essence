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
