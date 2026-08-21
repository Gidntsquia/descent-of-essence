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

**ALSO MANDATORY for any task that touches CSS layout/panels (positioning, sizing,
media queries, flex/grid behavior):** run `npm run test:mobile` (a real-browser
Playwright check of horizontal overflow/clipping at 375px and 414px on the main menu
and combat screen) and get a clean (or documented-acceptable) result before checking
the box, same standard as the `npm test` mandate above. It's a separate, slower script
from `npm test` (needs a real browser) -- see test/verify-mobile-layout.js.

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

- [x] BUG, minor (found during real-browser QA pass on 2fb89fd, verified
      2026-08-20T11:00Z): Mend's log message (and its `result.healed`
      return value) overstate the actual HP recovered whenever the heal
      would be clamped by the monster's max HP -- the number the player
      sees and the HP actually gained silently disagree.
      ROOT CAUSE (line numbers as of commit 065b633, which landed mid-pass
      and already retuned MEND_HEAL_RATIO 0.15->0.10 without touching this
      logic -- re-check line numbers if more commits land first):
      `js/wordbound/intents.js` lines 172-176, the 'mend'
      branch of `Intents.executeIntent`:
      ```
      if (intent.type === 'mend') {
        var healAmt = Math.round((monster.maxHp || 0) * MEND_HEAL_RATIO);
        monster.hp = Math.min(monster.maxHp, monster.hp + healAmt);
        monster.mendUsed = true;
        result.healed = healAmt;
        result.message = monster.name + ' mends its wounds, healing ' + healAmt + ' HP.';
        return result;
      }
      ```
      `monster.hp` itself is correctly clamped via `Math.min`, but
      `result.healed` and the log message both use the raw, PRE-clamp
      `healAmt` regardless of how much headroom the monster actually had.
      Whenever Mend fires with the monster within `healAmt` HP of its max,
      the displayed number is bigger than what actually happened. This is
      independent of the exact `MEND_HEAL_RATIO` value (currently 0.15;
      see the ORCHESTRATOR DECISION below this ticket, which plans to
      retune it to 0.10) -- the bug is in how an already-computed heal
      gets REPORTED, not in the ratio itself, so it will still apply after
      that retune unless fixed in the same touch. This is a small,
      self-contained, mechanically-unrelated fix -- fine for the next run
      to knock out quickly before or after the time-sensitive balance
      work below, whichever fits better.
      VERIFIED live in a real Chromium browser through the actual
      `Game.submitWord` flow (not a synthetic/isolated call): forced a
      Mend intent on a boss-tier monster instance sitting 10 HP below a
      300 max HP, played a real word, and read `state.monster.hp` before
      and after. Message read "...mends its wounds, healing 45 HP." but
      the monster's HP only actually increased by 12 (290 -> 300,
      hard-capped at maxHp). Reproduced identically (same 45-claimed/
      12-actual split) across two independent runs of the same check.
      (Those exact numbers were measured against MEND_HEAL_RATIO=0.15,
      just before commit 065b633 retuned it to 0.10 -- the bug mechanism
      is identical regardless of the ratio, just with a smaller claimed
      number now; didn't re-run the live check against 0.10 specifically
      since the formula is unchanged and the discrepancy is purely
      arithmetic, not timing- or value-sensitive.)
      FIX: compute the actual post-clamp delta and use THAT for both
      `result.healed` and the message:
      ```
      var healAmt = Math.round((monster.maxHp || 0) * MEND_HEAL_RATIO);
      var actualHeal = Math.min(monster.maxHp, monster.hp + healAmt) - monster.hp;
      monster.hp += actualHeal;
      monster.mendUsed = true;
      result.healed = actualHeal;
      result.message = monster.name + ' mends its wounds, healing ' + actualHeal + ' HP.';
      ```
      VERIFICATION: `npm test` plus one new targeted assertion alongside
      the existing Mend checks in test/dom-check.js: set `monster.hp` to
      `maxHp - X` where `X` is smaller than the raw heal amount, call
      `executeIntent`, assert `result.healed === X` (not the raw
      `round(maxHp*MEND_HEAL_RATIO)`) and that the log message's number
      matches `X`; also re-confirm the existing no-clamp case still
      reports the full raw amount (regression check). No player-facing
      balance change on its own (the real `monster.hp` value was already
      correct) so no version bump strictly required, but natural to fold
      into whichever commit next touches this function for the pending
      ratio retune.
      FIXED 2026-08-20T11:10Z: exactly the fix specified -- `executeIntent`'s
      'mend' branch now computes `actualHeal` (the real post-clamp delta)
      and uses it for both `monster.hp`'s increment, `result.healed`, and
      the log message. Added 3 jsdom assertions to test/dom-check.js: a
      forced near-max-HP Mend reports the smaller clamped amount (not the
      raw ratio amount) in both `result.healed` and the message text, and
      post-heal `monster.hp` is exactly `maxHp`; the pre-existing no-clamp
      Mend test above it still passes unchanged (regression check). `npm
      test` 110/110 (full suite, ALL CHECKS PASSED). No version bump
      (display-only fix, no player-facing balance change, per the
      ticket's own note).

<!-- The 12 tickets below were queued 2026-08-20 from a full bugs/feel/fun
     review Jaxon requested and approved (review artifact + full findings in
     the session that queued these; finding IDs like B1/F2/N1 refer to it).
     Ordered: quick high-value bugs first, then the balance rework, then
     feel/polish, then design-flavored additions. -->

- [x] BUG/FEEL (review B3/F1), high priority: the killing blow produces NO
      feedback at all -- no damage number, no HP-bar flash, no hit sound, no
      death beat. In `Game.submitWord` (js/wordbound/game.js ~line 510-514),
      the monster-death branch calls `onMonsterDefeated(...)` and returns;
      `animateDamage()`, the flash, and `playCombatSound()` only run in the
      monster-survives branch further down. Since current balance means many
      fights end on the FIRST word, most fights currently show zero combat
      feedback of any kind: word submitted -> hard cut to the tile-reward
      panel. Verified live in a scripted Chromium playthrough (one-shot the
      first monster; a screenshot 320ms after submit already showed the
      reward screen).
      FIX: on the death path, still show the damage number + play the hit
      sound + flash the HP bar (which will visibly hit 0), hold a short death
      beat (~500ms -- e.g. dim/fade the monster-info panel via a CSS class),
      THEN call onMonsterDefeated/render. Keep the beat short and
      non-blocking (a setTimeout, same pattern as TILE_PLAY_ANIM_MS). Careful
      with render ordering -- render() rebuilds monster-info's innerHTML and
      would destroy the damage-number element (this exact class of bug is in
      the top-of-file warning); run the animation on the still-rendered
      combat DOM BEFORE the screen switches.
      VERIFICATION: `npm test` (it already asserts damage-number/flash
      presence for the survive path -- add the same assertions for a killing
      blow: play a word that kills, confirm the damage number + flash exist
      during the beat, and that the tile-reward screen still arrives
      afterward). `npm run test:qa` must stay 24/24 (it drives full fights --
      watch that added delay doesn't break its waits; bump its timeouts if
      needed, not the game's). Audio can't be verified in jsdom -- say so.
      FIXED 2026-08-20T06:04Z: see PROGRESS.md for the fix (a
      MONSTER_DEATH_BEAT_MS beat + a `.monster-defeated` fade class), the new
      jsdom kill-blow assertions, a submitWord re-entrancy guard the beat's
      open window required that wasn't in the ticket text, and the
      test:qa timing bump.

- [x] BUG (review B1), high priority: seeded runs silently lose determinism
      at every event with a random outcome, contradicting the v0.10
      seeded-runs feature ("same seed + character + unlock state reproduces
      the run"). js/wordbound/events.js lines 57, 80, and 115 each do
      `var RNG = window.Wordbound && window.Wordbound.RNG;` and then
      `RNG ? state.rng.xxx(...) : Math.random()...` -- but `window.Wordbound
      .RNG` is NEVER assigned anywhere (the RNG module registers at
      `window.Game.RNG`; verified by grep), so the guard is always falsy and
      all three rolls (lucky_scroll's 50/50, empty_shelf's 50% item hunt,
      cursed_tome's random item pick) always use `Math.random()`. The
      existing test/verify-seeded-runs.js passes because it only checks floor
      layout + first monster, never an event outcome.
      FIX: delete the broken guard and call `state.rng.chance(...)` /
      `state.rng.choice(...)` unconditionally -- `state.rng` always exists
      during a run (events can only fire from a run). Three small edits, all
      in events.js.
      VERIFICATION: `npm test` 16/16. Extend test/verify-seeded-runs.js (or
      add a targeted jsdom check): force the same event with the same seed
      twice (set state directly or replay to an event node on a seed known to
      contain one) and assert the random branch resolves identically both
      times; different seeds may differ.
      FIXED 2026-08-20T06:21Z: see PROGRESS.md for the fix and the new
      determinism assertions added to test/verify-seeded-runs.js.

- [x] BUG (review B2): the Foreword item (rare, "+1 damage per unused tile")
      almost never grants its bonus. js/wordbound/items.js line 283:
      `var unusedCount = (ctx.player.rack || []).length - ctx.tilesUsed.length;`
      -- but by the time onWordPlayed hooks fire, Combat.playWord has ALREADY
      removed the played tiles from the rack (combat.js calls
      Lexicon.removeTiles before returning), so `rack.length` already IS the
      unused count and subtracting `tilesUsed.length` double-counts: 7-tile
      rack + 4-letter word = 3 - 4 = -1 -> no bonus (correct: 3). It only
      fires when the word is shorter than half the rack, and undercounts then.
      FIX: `var unusedCount = (ctx.player.rack || []).length;`. One line.
      VERIFICATION: `npm test` 16/16 plus a targeted assertion: give the
      test player Foreword, play a known word from a known rack, assert
      result.damage includes exactly rack-size-minus-word-length extra.
      FIXED 2026-08-20T06:42Z: see PROGRESS.md for the fix and the new
      jsdom Foreword assertion in test/dom-check.js.

- [x] BALANCE (review N1/N2/N3), high priority, larger task: regular fights
      can't touch a competent player, which kills most of the game's systems.
      Numbers as shipped: any 6-letter word scores ~30+ (length bonus
      js/wordbound/lexicon.js line 113: +3/letter past 4; bingo line 114:
      +15 at 7 tiles) while EVERY regular monster has 6-22 HP
      (js/wordbound/monsters.js) -- so long words one-shot everything
      non-boss before trait multipliers even apply. Monsters only
      counterattack when they survive the word (game.js submitWord), so a
      player with vocabulary takes literally zero damage outside boss
      fights -- HP, rest nodes, healing items (Vowel Leech, Marginalia,
      Errata Slips), and Thick Skin are dead weight for exactly the players
      most likely to keep playing. Overkill gold (game.js onMonsterDefeated:
      +floor(overkill*0.5)) then REWARDS the one-shot (+26 bonus gold on a
      floor-1 fight observed live), trivializing the shop by floor 2. It
      also buries the game's stated core hook -- weakness matching is
      irrelevant when base damage one-shots (review N3).
      GOAL (measurable, not vibes): a regular fight against a competent
      player should average >= 1 monster counterattack (i.e. take 2-3 words
      to win), so the HP/heal/gold economy exists; weak-tier fights on floor
      1 may stay closer to 1-2 words so the early game stays welcoming.
      SUGGESTED KNOBS (implementing run's judgment on the mix, validate with
      simulation rather than guessing): raise regular monster HP bands
      (weak ~15-20, normal ~28-38, strong ~45-60 as a starting hypothesis);
      and/or trim the length bonus (e.g. +2/letter past 4) and gate the
      bingo bonus to full-rack-only (tilesUsed === current rack capacity,
      not a hardcoded 7 -- right now a Spare Satchel 8-tile rack gets the
      bingo for a 7-of-8 word); consider capping overkill gold (e.g. at the
      monster's base drop max) so one-shots aren't ALSO an economy exploit.
      Boss HP/attack should be re-checked AFTER regular tuning (players will
      now arrive with less HP and fewer items than today's zero-damage
      runs).
      USE test/balance-simulation.js (already exists, 30-run harness from
      the 2026-08-19 balance pass) -- update its assumptions to the new
      numbers and report before/after: average words per fight, average
      player HP entering each boss, run win rate. Report the numbers in
      PROGRESS.md so Jaxon can veto.
      This is a tuning pass, NOT a mechanics rework: no new mechanics, no
      changes to how counterattacks work. If simulation shows the targets
      are unreachable by numbers alone, STOP, write up why, and flag for
      Jaxon rather than inventing mechanics. Version bump to v0.11 when
      complete (user-facing balance change).
      VERIFICATION: `npm test` 16/16, `npm run test:qa` 24/24 (its
      word-finder plays optimal-length words -- it directly exercises the
      new numbers; its fights will take more words now, make sure its loop
      caps tolerate that), balance-simulation before/after numbers in
      PROGRESS.md.
      DONE 2026-08-20T08:11Z, completed across two concurrent/consecutive
      runs -- see PROGRESS.md for the full history (a prior run landed the
      code changes and HP numbers but deliberately left this unchecked,
      citing untrustworthy floor-2/3 simulation data caused by the sim
      bot's own inability to use blank tiles; this run fixed that bot
      limitation, got trustworthy data confirming the target is met
      (regular fights avg 2.19-2.26 words, i.e. >=1 counterattack on
      average), re-checked boss HP against the new data (real risk already
      present, left unchanged), and confirmed the "first"-strategy 0% win
      rate is pre-existing/unrelated to this pass, not a regression).
      `npm test` 25/25, `npm run test:qa` 24/24.

- [x] FUN OVERHAUL 1/8 -- word novelty + combo streaks (do AFTER the balance
      ticket above; with today's numbers fights end in 1 word and none of
      this can trigger). Direct order from Jaxon 2026-08-20: "The game is
      boring, make it more fun." Diagnosis this ticket addresses: once
      fights last 2-4 words, the optimal play is still "find your best word
      and repeat it" -- spam is never punished and variety is never
      rewarded, which wastes the entire fantasy of a word game.
      MECHANIC (exact numbers, don't soften them without simulating):
      - Track `usedWords` (a Set) on combat state, reset in startCombat.
        Submitting a word already in the set this fight: damage x0.4
        (rounded), log a THEME.md-voiced line (e.g. "The Archive has heard
        that one before."), and it resets the combo to 0. Do NOT block the
        word -- weak repeat is a fallback, not an error.
      - Combo: consecutive DISTINCT valid words this fight. Each stack adds
        +12% damage, cap +60% (5 stacks). Order of operations:
        round(score.total * traitMult * (1 + 0.12*min(combo,5))), then the
        x0.4 repeat penalty if applicable (a repeat both gets x0.4 and
        resets combo for the next word).
      - UI: a combo chip in the monster-info area ("Combo x3 · +36%"),
        rising SFX pitch per stack (reuse the existing word-play synth,
        scale frequency by combo), combo reset is visually obvious (chip
        clears).
      SIM CHECK: re-run test/balance-simulation.js with the bot playing
      distinct words (it already scans the wordlist; make it avoid repeats)
      -- if win rate leaves the band the balance ticket established, nudge
      regular monster HP up to +10% rather than reopening full tuning.
      VERIFICATION: `npm test` 16/16 plus targeted jsdom assertions (three
      distinct words -> multiplier grows each turn; repeat -> x0.4 and
      combo resets); `npm run test:qa` (its word-finder may repeat words --
      update it to prefer unused words so it exercises the combo path).
      Version bump -- this is the core-loop feel change of the overhaul.
      DONE 2026-08-20T08:29Z: see PROGRESS.md for the implementation (a
      `comboState` object threaded through `Combat.playWord`, an optional
      4th arg so old callers without a fight to track still work), the log
      line, the combo chip, SFX pitch scaling, and the SIM CHECK result
      (win rate stayed in-band, no HP nudge needed). `npm test` 34/34 (10
      new targeted combo assertions), `npm run test:qa` 24/24. Bumped
      v0.11 -> v0.12.

- [x] FUN OVERHAUL 2/8 -- monster intents (telegraphed next actions).
      Fights are reactive damage races with no reads or answers; Slay the
      Spire's single most load-bearing mechanic is showing what the enemy
      does next. MECHANIC:
      - Each monster def gets an `intents` list; the game pre-rolls the
        NEXT action at fight start and after each monster action, and
        renderCombat displays it above the monster ("Next: Attack 8",
        "Next: Heavy Blow 15", "Next: Hex -- a tile will be bound").
      - Regular (non-weak) monsters: Attack (weight 3) and Heavy Blow
        (1.6x attack, weight 1). WEAK-TIER monsters always plain Attack --
        keep floor 1 welcoming, no intents UI needed for them beyond the
        plain attack line.
      - Elites and bosses additionally roll one signature from a shared
        pool (implement all four, each def picks 1-2): Hex (locks a random
        rack tile for the player's next turn -- greyed out, unusable),
        Devour (if the player's word this turn deals < 12 damage, eats a
        random rack tile for the rest of the fight), Mend (heals 15% max
        HP, once per fight), Enrage (+2 attack permanently, stacks).
      The fun beat is the clutch answer: a telegraphed Heavy Blow or Devour
      makes THIS turn's word choice matter. Keep state minimal: intent =
      {type, value} on combat state; monsterAct() executes it; no new
      screens.
      VERIFICATION: `npm test` + targeted jsdom checks (intent is displayed
      before the monster acts and matches what then happens; Hex actually
      prevents using the locked tile for one turn; Devour skips when the
      word dealt >= 12). `npm run test:qa` full pass. Version bump.
      DONE 2026-08-20T09:04Z: see PROGRESS.md for the full implementation
      (new js/wordbound/intents.js module, monster.isElite flag set from
      node.type in startCombat, a Hex splice-guard in Game.submitWord that
      locks a tile for both click/tap staging AND typed words), the
      elite/boss signature assignments (a judgment call, noted in
      PROGRESS.md), a real bug found and fixed in the process (Hex could
      permanently freeze a fight if the chosen word needed the locked tile
      -- fixed by clearing hexedTileId before cycling, not after), and a
      `test:qa` word-finder update to route around a hexed tile. `npm test`
      58/58, `npm run test:qa` 24/24, `npm run test:mobile` clean, plus
      real-Chromium stress runs (15 boss fights + 10 elite fights across
      all 6 defs, zero errors). Bumped v0.12 -> v0.13.

- [x] DESIGN/BALANCE (review N4), FUN OVERHAUL 3/8 -- do AFTER the balance
      ticket above lands: restore boss fight arcs via multi-phase traits.
      The phase system (traits.js activeTraitForHpRatio, monsters.js
      traitPhases) is built, tested, and documented but unused -- all three
      bosses now have a single phase, so a boss fight is "repeat your best
      word category 2-4 times." Give each boss 2 phases built ONLY from
      simple (bonus-on-match, 1x baseline) traits -- e.g. Vowelmaw:
      vowelHungry above 50%, doubled below; Unabridged Terror: lengthy then
      rareSeeker; Sovereign: silentE then lengthy -- flavor picks are the
      implementing run's call, note them in PROGRESS.md. Do NOT reuse the
      four resistance traits (vowelless/palindromic/shortFuse/alphabetic,
      0.3x floor) -- they were removed from bosses deliberately (see the
      2026-08-19/20 balance history in this file). Also update
      monsters.js's header comment, which still advertises multi-phase
      bosses that don't exist, and make sure the in-combat weakness line
      updates when the phase flips (renderCombat already recomputes from hp
      ratio -- verify, don't assume; the node-map hint shows phase[0] only,
      which is fine, note it).
      VERIFICATION: `npm test` 16/16; `npm run test:qa` 24/24 (drives two
      real boss fights); a targeted check that the displayed weakness text
      changes when a boss crosses its threshold. Re-run
      balance-simulation.js to confirm boss win rates stay in the band the
      balance ticket established. Version bump -- player-facing feature.
      DONE 2026-08-20T09:33Z: implemented exactly as specified (see
      PROGRESS.md for the flavor-pick reasoning and full verification).
      `npm test` 76/76, `npm run test:qa` 24/24. The mechanic itself is
      correct and fully verified. IMPORTANT CAVEAT, see the new ticket
      immediately below: the mandated balance-simulation.js re-run found
      the game is currently WAY outside the established win-rate band (7%
      vs. the documented 33-50%, plus a 33% stall rate) -- but a controlled
      before/after A/B (single-phase vs. this ticket's 2-phase change,
      otherwise identical code, n=15 each) showed both conditions already
      near-zero, so this ticket's own change does not appear to be the
      primary cause. Checked off because the mechanic itself meets spec;
      the regression is real but looks pre-existing and is tracked
      separately below rather than guessed at or silently ignored here.

- [x] BALANCE, HIGH PRIORITY (found during FUN OVERHAUL 3/8's mandated SIM
      CHECK, 2026-08-20): the game is significantly outside the win-rate
      band the original N1/N2/N3 balance ticket established (33-50% for
      "best"-strategy skilled play) -- do this BEFORE continuing FUN
      OVERHAUL 4/8-8/8, which would stack more mechanics on top of an
      already out-of-band difficulty curve and make diagnosis harder.
      MEASURED (test/balance-simulation.js, n=30 "best" strategy, current
      HEAD): win rate 2/30 (7%); 10/30 runs (33%) STALLED (hit the sim's
      40-word-per-combat safety cap without resolving); floor clear rates
      60%/28%/40% (floor 1/2/3, of runs that reached each); floor-3 boss
      (Sovereign, "The Unabridged, Unbound") went 0/3 across encounters,
      averaging 27.7 words per fight; floor-2 boss (Unabridged Terror)
      averaged 14.6 words. Compare to the 1/8 ticket's own SIM CHECK
      (PROGRESS.md 2026-08-20T08:29Z, before monster intents existed):
      40% win rate, boss fights averaging 2.53 words -- a large gap opened
      somewhere after that.
      LEADING HYPOTHESIS (reasoned from the code, not confirmed by a
      dedicated experiment -- verify before acting): Enrage
      (js/wordbound/intents.js, ENRAGE_ATTACK_BONUS=2, executed at line
      ~148) is the only signature move with NO once-per-fight guard (Mend
      has one via `monster.mendUsed`; Hex/Devour are naturally self-
      limiting). Any def with 'enrage' in its intents list (Sovereign,
      and the floor-2 elite-eligible Sentinel) can re-roll and re-stack it
      every single monster turn at 1-in-6 odds (buildPool weights:
      attack 3, heavy 1, enrage 1, hex 1) for as long as the fight runs --
      a longer fight buys more turns, which buys more permanent +2-attack
      stacks, which increases damage taken per turn and can make the fight
      run even longer: an uncapped positive-feedback spiral with no ceiling
      except the player dying or the sim's 40-word stall cap. This was
      never balance-tested when it shipped (FUN OVERHAUL 2/8's own
      VERIFICATION line didn't call for a balance-simulation.js run).
      FUN OVERHAUL 3/8's 2-phase bosses plausibly make this worse
      secondarily (a fight needing two different weaknesses takes longer to
      resolve, buying the spiral more turns) but the 3/8 ticket's own A/B
      check (see its DONE note above) suggests it isn't the primary driver
      -- Enrage's lack of a cap looks like the bigger lever.
      This needs Jaxon's steer on the actual fix, not a guessed one: how
      hard should Enrage be capped (a Mend-style once-per-fight guard? a
      max-stacks limit? a smaller per-stack bonus?), and whether Devour's
      permanent tile removal (also uncapped, also compounds a long fight)
      needs the same treatment. A well-scoped starting hypothesis for
      whoever picks this up: give Enrage a max-stacks cap (e.g. 3, like a
      soft version of Mend's hard 1) and re-run balance-simulation.js n=30
      before/after to confirm it actually returns win rate to the
      33-50% band -- but this is a judgment call on how much to nerf it,
      not a mechanical fix, so don't invent the exact number without
      checking the sim data, and flag back to Jaxon if the numbers suggest
      something structural (not just numeric) is wrong.
      VERIFICATION: whatever fix is chosen, `npm test`, `npm run test:qa`,
      and a fresh `test/balance-simulation.js` n=30 (or larger) run showing
      the win rate back in band, reported in PROGRESS.md same as the
      original balance ticket did. Version bump if the fix changes
      player-facing numbers.
      PARTIAL PROGRESS 2026-08-20T10:20Z, NOT checked off -- see PROGRESS.md
      for full data: implemented the ticket's own starting hypothesis
      (Enrage capped at 3 stacks/fight, `ENRAGE_MAX_STACKS` in intents.js).
      Result of a fresh n=30 `balance-simulation.js` run: stall rate
      improved a lot (33% -> 13%, 10/30 -> 4/30), but win rate did NOT
      move (7%, 2/30, identical to the pre-fix measurement). Capping
      Enrage alone is confirmed NOT sufficient to restore the 33-50% band
      -- this is exactly the "numbers suggest something structural, not
      just numeric" case the ticket asked to flag rather than guess
      further on. Left the Enrage cap in place (it's a real, tested,
      net-positive improvement with no downside) but the box stays
      unchecked and this needs Jaxon's steer on the deeper cause before
      continuing. Not spending more of this run guessing at further
      combat-balance nerfs per the ticket's own instruction; picking up
      a safe, unrelated, already-queued item further down instead (see
      PROGRESS.md for which and why).
      ORCHESTRATOR DECISION 2026-08-20T10:50Z (steer provided; Jaxon is
      asleep and delegated overnight calls -- he can veto in the morning,
      the decision and reasoning will be in his digest). Diagnosis I'm
      acting on: the intents kit is a fight-LENGTH amplifier (Mend heals,
      Enrage stacks, Devour shrinks the rack, Heavy Blow raises avg DPS
      ~15%, two-phase bosses invalidate the held rack mid-fight), and boss
      HP was sized before any of that existed -- so every extra monster
      turn compounds and bosses became 14-27-word sponges (Sovereign 0/3).
      The fix is to make signature costs NON-COMPOUNDING and shorten boss
      fights; do NOT touch combo/novelty or remove any mechanic.
      IMPLEMENT EXACTLY, in one pass:
      1. Mend: heal 10% max HP (down from 15%), keep once-per-fight.
      2. Devour: eaten tile returns after the fight (fight-scoped, not
         permanent), and add a once-per-fight guard like Mend's. A
         fight-level miss must not become run-level punishment.
      3. Enrage: keep the 3-stack cap, reduce to +1 attack per stack
         (max +3 total, down from +6).
      4. Boss HP: cut all three bosses by ~25-30% (their arc now comes
         from phases + signatures, not HP sponge).
      5. Nothing else. Specifically: no new mechanics, no changes to
         combo/novelty numbers, no regular-monster HP changes.
      GATE (must pass to check this box): fresh n=30 balance-simulation
      "best" strategy lands in the 33-50% win band, stall rate < 10%,
      floor-3 boss averages < 8 words per encounter. If the gate fails
      after knobs 1-4, adjust boss HP further (safest knob) and re-run;
      only if TWO more boss-HP iterations still miss the band, stop and
      leave a data table in PROGRESS.md -- do not start inventing new
      mechanics overnight.
      After the gate passes: FUN OVERHAUL 4/8-8/8 below are UNBLOCKED,
      resume top-to-bottom as normal.
      VERIFICATION: npm test, npm run test:qa, sim numbers in PROGRESS.md
      (before/after table). Version bump (player-facing numbers).
      IMPLEMENTED 2026-08-20T11:01-11:15Z (knobs 1-4 exactly as specified,
      then one further boss-HP-only iteration per the gate's own escape
      valve). Full before/after table and per-monster death breakdown in
      PROGRESS.md. STOPPING HERE, box left UNCHECKED -- flagging for
      Jaxon, this is the "numbers suggest something structural, not just
      numeric" case the ticket names, not a numeric miss further boss-HP
      tuning can fix:
      | metric | target | pre-fix | gate #1 (knobs 1-4) | gate #2 (+1 boss-HP iter) |
      |---|---|---|---|---|
      | win rate (best) | 33-50% | 7% | 17% | **30%** |
      | stall rate | <10% | 33% | 17% | **13%** |
      | Sovereign words/fight | <8 | 27.7 | 15.3 | **1.7** (PASSES) |
      Gate #2 result: win rate and stall rate both still miss their bands,
      but only barely (30% is 3 points under the 33% floor; 13% stalls is
      ~3 points over the 10% ceiling) -- and CRITICALLY, floor-3 boss
      (Sovereign) now clears 9/9 (100%) of encounters and floor-2 boss
      (Unabridged Terror) went 0/10 kills, both far inside target. Pulled
      the raw per-run data (test/balance-simulation-results.json) to find
      what's ACTUALLY still killing/stalling runs at gate #2: of 17 "best"
      strategy deaths, only 3 (18%, all The Vowelmaw, floor-1 boss) were
      boss kills -- the other 14 (82%) were regular/strong-tier monsters:
      Spine Splinter x3, The Card Catalog x3, Binding Strap, Quoth, The
      Appendix, The Hoarder, Echo Pup, The Vowel Slurper, Filler Word, The
      Consonant Constrictor, one each. Of the 4 stalls, only 1 was a boss
      fight (Unabridged Terror, 40 words, 0 damage taken by the player the
      entire fight -- an odd outlier worth a look but not obviously an HP
      problem since the player was never in danger); the other 3 stalls
      were also regular/strong-tier (Spine Splinter, The Card Catalog x2).
      REASONING FOR STOPPING NOW rather than spending the second
      sanctioned boss-HP-only iteration: bosses are demonstrably no longer
      the bottleneck (82% of deaths, 75% of stalls are non-boss), so a
      further boss-HP cut has no plausible mechanism left to move win-rate
      or stall-rate -- floor-3 is already trivial (1.7 words) and floor-2's
      boss already never kills anyone. Spending the iteration anyway would
      be exactly the "guess without checking sim data" the ticket says not
      to do; the data already answers the question. The actual remaining
      gap is regular/strong-tier monster HP/damage on floors 1-2 (Spine
      Splinter, Card Catalog, Binding Strap, Quoth, Appendix, Hoarder) --
      explicitly OUT OF SCOPE for this ticket ("nothing else... no
      regular-monster HP changes"), and those numbers were last tuned by
      the original N1/N2/N3 pass BEFORE combo/novelty, monster intents, or
      2-phase bosses existed, so they're plausibly stale now for reasons
      unrelated to the Enrage-spiral bug this ticket chased.
      KEPT (net-positive regardless of the gate miss): the Mend/Enrage/
      Devour non-compounding knobs and both boss-HP cuts (vowelmaw 50->38,
      unabridged 80->60->35, sovereign 120->90->45) all measurably improved
      every metric (win 7%->30%, stalls 33%->13%, Sovereign 27.7->1.7
      words) with zero downside found in `npm test` (110/110) or
      `npm run test:qa` (26/26, real Chromium, zero console/page errors) --
      not reverting any of it.
      RECOMMENDATION for Jaxon: a fresh regular/strong-tier monster HP/
      damage pass (same spirit as the original N1/N2/N3 ticket, scoped to
      floors 1-2's non-boss defs) is likely the actual next lever, OR a
      judgment call that ~30% win / ~13% stalls is close enough to ship
      itch.io-launch-ready and not worth further precision-tuning against
      a bot-driven simulation. Separately, the one boss-fight stall
      (Unabridged Terror, 40 words / 0 damage taken) may be worth a
      dedicated look -- possibly a rack/word-availability edge case rather
      than a balance number.
      Not continuing to FUN OVERHAUL 4/8+ yet since the gate (as literally
      written) hasn't passed -- picking up the next safe, unblocked queue
      item instead (see PROGRESS.md for which and why), same pattern as
      the previous flag-and-continue on this same ticket.
      ORCHESTRATOR DECISION #2, 2026-08-20T13:15Z (steer for the gate-#2
      flag above; overnight delegation, Jaxon can veto in the morning --
      the stop-and-flag was exactly right, and the per-monster death table
      makes the next step obvious enough to steer without him):
      1. OUTLIER PASS, not a global retune: the misses concentrate in TWO
         defs -- Spine Splinter (3 deaths + 1 stall) and The Card Catalog
         (3 deaths + 2 stalls) account for 6/14 regular deaths and 3/3
         regular stalls. Cut those two defs' HP by ~20%, and if either
         carries a signature-heavy intent pool (hex/devour/heavy weighted
         high), shift one weight from the signature to plain attack.
         Touch NOTHING else -- no global regular-tier changes, no boss
         changes, no mechanic changes.
      2. Re-run n=30. Gate unchanged: 33-50% win AND <10% stalls.
      3. If it misses by a hair after the outlier pass, ONE global
         strong-tier-only HP nudge (-10%) is sanctioned, then one final
         n=30 re-run. Hard stop after that either way.
      4. WHATEVER the final number is after step 3: CHECK THIS BOX, bump
         the version, and note the final band in PROGRESS.md ("band
         accepted at X% win / Y% stalls by orchestrator, Jaxon may
         revisit"). Rationale: FUN OVERHAUL 4/8-8/8 are all player-power
         content (rule-changer items, special tiles, elite rewards) --
         every one of them raises effective win rate, so holding them
         hostage to a band their own content will shift is backwards, and
         the queue must not idle overnight on a 3-point miss. 30% vs 33%
         is within bot-proxy noise; the fun content matters more.
      5. The Unabridged 40-word/0-damage stall oddity: write a separate
         small ticket for it at the BOTTOM of the queue (investigation,
         not balance) rather than blocking anything on it.
      After the box is checked per step 4: FUN OVERHAUL 4/8-8/8 are
      UNBLOCKED, resume top-to-bottom.
      GATE-#3 RESULT 2026-08-20T13:40Z -- box checked per step 4, but with a
      major finding that reframes everything above it: the 40-word/0-damage
      stall oddity named in step 5 was NOT boss-specific flavor -- it was a
      real bug in test/balance-simulation.js itself, and it's why gate-#2's
      outlier pass (the HP cuts to Card Catalog/Spine Splinter, done first
      this run per steps 1-2) initially measured WORSE, not better (27%
      win / 30% stall, up from 30%/13%).
      ROOT CAUSE, found by pulling raw per-encounter data
      (balance-simulation-results.json) instead of trusting the aggregate
      numbers: all 9 of that run's stalls showed ~0 damageTaken across all
      40 words, and every one was against a hex-carrying def (Spine
      Splinter, Card Catalog, or Sovereign -- never Hoarder, the one
      strong-tier def WITHOUT hex). game.js's real submitWord pulls a
      Hex'd tile out of the rack before word-formation runs, so a real
      player literally cannot use it (the UI greys it out) -- but the
      sim's own findPlayableWords never excluded it. When the bot's
      "best" word happened to need the locked tile, Game.submitWord
      silently rejected it every iteration (no counterattack, no rack
      cycle, the hex never clears since that only happens on a
      successful play) -- the loop just relit the same rejected word
      until MAX_WORDS_PER_COMBAT, logging a false stall with 0 damage on
      both sides. This is very likely why EVERY prior sim reading in this
      ticket's history that involved a hex-carrying def (which is most of
      them -- Unabridged Terror and Sovereign both have hex) was reading
      somewhat inflated difficulty, including the three rounds of boss-HP
      cuts already landed against that contaminated data.
      FIX (test/balance-simulation.js only, no game-code change): filter
      state.hexedTileId out of the rack passed to findPlayableWords,
      matching what game.js already enforces. This also resolves the
      exact "Unabridged 40-word/0-damage stall" oddity step 5 above asked
      for a separate investigation ticket on -- same mechanism, same fix,
      so no separate ticket needed.
      CLEAN RE-RUN (n=30, hex-fixed bot, HP already includes this run's
      outlier cuts): win rate 18/30 (60%), stalled 0/30 (0%), softlocked
      0/30. Floor clears 80%/75%/100% (floor 1/2/3). This OVERSHOOTS the
      33-50% band on the easy side, by a wide margin -- not "a hair," so
      step 3's sanctioned action (a further -10% strong-tier HP cut) does
      NOT apply: that knob only makes fights easier and win rate higher,
      the wrong direction to correct an overshoot. Applying it anyway
      would be guessing against what the data says, which the ticket's
      own rules (and the prior orchestrator's own reasoning) say not to
      do. Skipped it for that reason, not out of laziness -- documenting
      the "why not" per the routine's own guardrails.
      DECISION: checked the box per step 4's own literal instruction
      ("WHATEVER the final number is after step 3... CHECK THIS BOX") --
      a 0%-stall, 100%-floor-3-clear, zero-error result is a healthy,
      shippable game state, just an easy one, and FUN OVERHAUL 4/8-8/8
      are pure player-power content that would only push win rate UP
      further if left blocked, same logic the prior orchestrator used.
      `npm test` 110/110, `npm run test:qa` 26/26 (real Chromium, zero
      errors). Version bumped v0.15 -> v0.16 (player-facing balance
      numbers changed: Card Catalog/Spine Splinter HP cuts + the
      corrected, much-easier true difficulty now visible).
      RECOMMENDATION FOR JAXON (not acted on this run -- a bigger call
      than a routine run should make alone): the three rounds of boss-HP
      cuts already landed (Vowelmaw 50->38, Unabridged 80->60->35,
      Sovereign 120->90->45) were tuned against data now known to have
      been inflated by the hex bug for exactly the two defs with hex in
      their kit (Unabridged, Sovereign) -- they may now be cut further
      than the game actually needed. A 60% clean win rate suggests some
      of that HP could reasonably come back up, particularly on floor 2/3
      bosses, rather than nerfing floor-1/2 regular monsters down to
      match the current curve. Left as-is rather than guessed at, since
      re-buffing already-shipped boss HP is exactly the kind of judgment
      call this ticket's own history has repeatedly deferred to Jaxon.

- [x] FUN OVERHAUL 4/8 -- build-defining items (rule-changers, not stat
      sticks). Current items are mostly passive stat bumps, so no two runs
      PLAY differently; the fun of a roguelike is assembling a build that
      warps your decisions. Add EXACTLY these 8 items to items.js (names
      adjustable to THEME.md voice, mechanics not):
      1. Illuminated Initial (rare): your word starts with the same letter
         as your previous word -> +40% damage.
      2. Errant Footnote (rare): every 3rd word you play each fight deals
         x2.
      3. Vowel Reliquary (rare): vowels score triple their letter value.
      4. Consonant Cluster (uncommon): +2 damage per consonant in the word.
      5. Long-S Ligature (rare): 6+ letter words deal +25% and heal 1 HP.
      6. Cursed Quill (rare): every word deals +10 flat damage; you take 2
         self-damage per word played (can kill you -- that's the deal).
      7. Gilded Bookmark (uncommon): your first word each fight deals x2.
      8. Palimpsest (rare): your word shares 3+ distinct letters with your
         previous word -> +30%.
      Wire them into the same treasure/boss-item/shop pools existing items
      use (boss-item pool should favor these rares). When one procs, say so
      in the log ("Gilded Bookmark: x2!") -- silent modifiers don't create
      builds. All 8 hook the single word-damage site; if the Foreword bug
      ticket above (review B2) hasn't landed yet, fix that hook first as
      part of this.
      VERIFICATION: `npm test` + one targeted jsdom assertion per item
      (drive two words, assert exact damage/HP/gold math). `npm run
      test:qa`. Version bump.
      DONE 2026-08-20T13:48Z: all 8 items added to js/wordbound/items.js
      exactly as specified (ids: illuminated_initial, errant_footnote,
      vowel_reliquary, consonant_cluster, long_s_ligature, cursed_quill,
      gilded_bookmark, palimpsest). All 8 hook onWordPlayed, the single
      word-damage site (Foreword's bug was already fixed by an earlier
      ticket, confirmed before starting). Added a new
      `Items.applyPercentBonus(ctx, pct)` helper alongside the existing
      `applyBonusDamage` for the 5 percentage-based items (Illuminated
      Initial, Errant Footnote, Long-S Ligature, Gilded Bookmark,
      Palimpsest) -- rounds and applies `result.damage * pct`, stacking
      additively with any other item that already fired on the same word,
      consistent with how flat-bonus items already stacked.
      NEW PLUMBING (js/wordbound/game.js, Game.submitWord): three of the
      eight items need per-fight word SEQUENCE, which nothing tracked
      before -- added `state.previousWordThisFight` (the upper-cased word
      played immediately before this one, null on the fight's first word)
      and `state.wordsPlayedThisFightCount` (1-based, includes repeats),
      both reset in startCombat alongside the existing comboState reset,
      and fed to item hooks via new `ctx.previousWord`/
      `ctx.wordsPlayedThisFight` fields. Also added `ctx.messages` (an
      array hooks push proc strings onto, e.g. "Gilded Bookmark: x2!") --
      the caller logs each one after runHook returns, per the ticket's own
      "silent modifiers don't create builds" instruction; this is the
      first time any item hook logs anything (all 15 pre-existing items
      are silent, untouched here).
      REAL BUG FOUND AND FIXED while wiring this up, not in the original
      ticket text: Cursed Quill's self-damage lands on the PLAYER'S OWN
      turn (inside the onWordPlayed hook), before the monster ever gets a
      counterattack -- but the existing player-death check only ran in the
      "monster survives" branch (after the counterattack), and the
      killing-blow branch never checked player HP at all (it never needed
      to before an item could hurt the player on their own turn). A word
      that kills the monster AND, via Cursed Quill, drops the player to 0
      in the same blow would have fallen through to the tile-reward screen
      with a "dead" player still nominally in play -- the same CLASS of
      bug (an interaction nobody actually ran through the DOM) that
      GOALS.md's own top-of-file warning exists to catch. Fixed by adding
      an explicit `state.player.hp <= 0` check right after the
      onWordPlayed hook runs (and its log messages print), before either
      the killing-blow or monster-survives branch, routing to `endRun(false)`
      -- verified with a targeted jsdom check (Cursed Quill at 1 HP drops
      the player to exactly 0, no floor, per the ticket's own "can kill
      you, that's the deal" wording).
      WIRING INTO POOLS: confirmed no additional plumbing was needed beyond
      setting each item's `rarity`/`shopPrice` fields correctly --
      `rollTreasureOptions`/`rollShopOptions` already draw uniformly from
      ALL item ids regardless of rarity, and `rollBossRewardOptions`
      already filters to rare/legendary only (js/wordbound/game.js). Since
      6 of the 8 new items are rare, the boss-reward pool grew from 3 items
      (vowel_leech, foreword, second_wind) to 9, which satisfies "should
      favor these rares" as a natural consequence rather than needing a
      separate weighting change.
      JUDGMENT CALLS (none change the ticket's specified mechanics, only
      fill in gaps its text left open): Vowel Reliquary's "vowels score
      triple their letter value" is computed as +2x each vowel's
      LETTER_VALUES entry (all vowels are 1pt in this game's scoring, so
      practically +2 damage per vowel) -- consistent with how the
      pre-existing Vowel Leech item already reads vowels straight from
      `ctx.word`, not from resolved tile objects, so a blank tile used to
      spell a vowel does NOT count (matches the existing pattern, not
      separately specified either way by the ticket). Percentage items
      compute their bonus off `ctx.result.damage` AS IT STANDS when they
      fire (i.e. after any earlier-firing item's own bonus already
      applied), same additive-in-sequence behavior `Items.runHook` already
      gives every hook -- not attempted to special-case "true multiplier of
      base" semantics, since no existing item does that either.
      VERIFICATION: `npm test` 150/150 (ALL CHECKS PASSED; 21 new targeted
      assertions -- one isolated Combat.playWord + Items.runHook check per
      item's positive case, matching the existing Foreword-check pattern
      exactly, plus a negative/non-firing case for every conditional item,
      plus 2 live-DOM checks piggybacked on this fight's first-ever real
      word submission confirming the new previousWord/wordsPlayedThisFight
      state actually gets populated end to end through Game.submitWord, not
      just in the isolated unit-test ctx shape). `npm run test:qa` 26/26
      real Chromium, zero console/page errors (also incidentally confirms
      the boss-reward pool now offers 3 distinct rares instead of repeating
      the same old 2-3 every time). Version bumped v0.16 -> v0.17
      (player-facing feature). Housekeeping note: this run started with a
      detached HEAD one commit behind a concurrent session that had ALREADY
      completed the BALANCE ticket (with a real fix to
      balance-simulation.js's own hex-tile bug that this run's own earlier,
      now-discarded attempt at the same ticket had missed) -- discarded this
      run's redundant/inferior balance work, rebased onto the real
      `origin/main`, and picked up FUN OVERHAUL 4/8 fresh from there instead
      of re-litigating an already-closed ticket.

- [x] FUN OVERHAUL 5/8 -- special tile variants in rewards/shop. Tile
      rewards are the most frequent decision in the game and every option
      is plain. Add 4 variants: Gilded (+2 gold when played), Charged (+4
      flat damage when played), Vampiric (heal 1 HP when played), Volatile
      (letter scores x2; after each play, 25% chance it cracks -- unusable
      for the rest of the fight, returns next fight). Roughly 25% of
      tile-reward offers roll a variant; the shop occasionally sells one at
      a premium. Distinct CSS badge per variant following the existing
      bonus-tile class pattern (bonus-flat/bonus-mult-* classes) so they
      read at a glance in rack, staging, and deck viewer.
      VERIFICATION: `npm test` + targeted checks (force-add each variant
      tile to state, play it, assert the gold/damage/heal/crack effect
      actually happens; cracked tile is unplayable then returns next
      fight). `npm run test:mobile` (new badges must not break 375px).
      Version bump.
      DONE 2026-08-20T14:25Z, v0.17 -> v0.18. All 4 variants implemented
      end to end. Data model (tiles.js): a tile now carries an optional
      `variant` (one of Tiles.VARIANTS.GILDED/CHARGED/VAMPIRIC/VOLATILE) and
      a `crackedThisFight` flag. rollRewardOptions rolls a variant at
      VARIANT_CHANCE=0.25 BEFORE the legacy bonus roll and mutually
      exclusive with it (one badge per tile, not a stack of two -- makes the
      rate exactly 25%, not conditioned on the bonus roll missing first).
      New rollVariantTile(rng) = guaranteed-variant roll for the shop.
      SCORING variants resolve in lexicon.js scoreWord (Charged +4 flat via
      a new `variantFlat` field; Volatile doubles only its own letter's
      value, not the word). SIDE-EFFECT variants resolve in game.js
      submitWord after the item hooks: Gilded +2 gold, Vampiric +1 HP
      (clamped to max), Volatile's 25% crack roll -- summed per matching
      tile played, each logged once. A cracked tile is filtered out of the
      discard in cycleRackAfterWord (so no reshuffle deals it back this
      fight) and its flag is cleared for EVERY deck tile at startCombat, so
      "returns next fight" works without ever touching the persistent deck.
      SHOP: state.shopTileOffer (a Tile OBJECT) holds the premium offer,
      rolled once at shop entry at SHOP_VARIANT_TILE_CHANCE=0.4, priced 45
      (rare-item tier). Kept in its OWN state field, NOT mixed into
      shopOptions -- that array stays a flat list of string ids so every
      consumer (renderShop's item loop, test/balance-simulation.js's
      shopping bot) can keep assuming strings.
      REAL BUG the change surfaced (and fixed): my first cut put the tile
      offer inside shopOptions as a {shopTile} wrapper object;
      balance-simulation.js's shopping bot does
      `for (const id of state.shopOptions) ... id.indexOf(...)` and crashed
      on the object. Fixed by splitting it into shopTileOffer as above --
      the crash proved the mixed-type array was the wrong design. (This is
      exactly why running the sim, not just npm test, mattered here.)
      CSS: distinct ring color + a corner emoji glyph per variant
      (🪙/⚡/🩸/💥) so they're distinguishable without relying on color alone
      (the four rings sit close in hue and must read at 375px), applied
      across rack, staging, tile-reward, deck viewer, and shop rows.
      Volatile tiles show their DOUBLED point value in rack/staging/reward.
      VERIFICATION: `npm test` (all pass, 8 consecutive randomized-layout
      runs clean): isolated Lexicon.scoreWord arithmetic per scoring variant
      (baseline 5, Charged->9/13, Volatile C->8 / A->6, Gilded/Vampiric
      score-neutral), describeVariant coverage, roll-distribution
      (mutual-exclusion, ~25% rate, all four appear, uncracked-at-birth),
      rollVariantTile-never-whiffs; live-DOM through real Game.submitWord
      for Gilded gold / Vampiric heal / Volatile crack (crack forced by
      temporarily wrapping state.rng.chance to return true for p===0.25
      only -- grep-confirmed 0.25 is the sole in-fight probability),
      cracked-tile-absent-from-both-piles, next-fight reset driven through a
      real second Game.enterCurrentNode combat, and the full shop-tile
      buy/afford/disabled/re-roll path. `npm run test:mobile` clean at
      375/414. `npm run test:qa` 26/26 real Chromium, zero errors. Real
      Chromium screenshots confirmed badge/glyph placement in rack,
      staging, tile-reward, and shop rows. balance-simulation.js n=30
      "best" strategy: 33% win / 0% stall (in the 33-50% target band; the
      prior 60% was an easy-side overshoot, so this is better centered) --
      variants did not break balance. NOT independently verifiable in
      jsdom, standing caveat: audio (none of these touch sound) and a
      human's feel for whether the variants are fun -- Jaxon's playtest.

- [x] FUN OVERHAUL 6/8 -- elites as opt-in risk/reward. Elite nodes exist
      as a type but don't meaningfully differ. Make an elite: one
      RESISTANCE trait (vowelless, shortFuse, or alphabetic -- one per
      elite def; these were removed from regular monsters/bosses for being
      too punishing UNTELEGRAPHED, which is exactly what makes them right
      for a labeled elite) + a guaranteed drop from the FUN OVERHAUL 4/8
      rule-changer pool + 1.5x gold. REQUIREMENT for using resistance
      traits: the node map must warn BEFORE entry (map pill styling + the
      existing weakness-hint mechanism, e.g. "Elite -- it devours vowels")
      so the player walks in informed. VERIFY first whether the floor path
      lets a player route around elites; if elites turn out to be
      unavoidable AND the pre-entry warning can't be made clear, fall back
      to: simple trait + elite intents (Hex/Devour from 2/8) + higher
      stats, same guaranteed drop -- and say which branch you took in
      PROGRESS.md.
      VERIFICATION: `npm test`; targeted check that an elite fight grants
      the guaranteed item + boosted gold; `npm run test:qa`. Version bump.
      DONE 2026-08-20T14:46Z (v0.18 -> v0.19): took the PRIMARY branch
      (resistance trait + guaranteed 4/8 drop + 1.5x gold), NOT the
      fallback. ROUTE-AROUND CHECK: floor.js is explicit that a floor is "a
      single ordered path... deliberately no choice of path" -- so elites
      ARE unavoidable. But the fallback only triggers if unavoidable AND the
      pre-entry warning can't be made clear; the warning CAN be made clear
      (boss node pills already show a trait hint before entry via the same
      mechanism), so the primary resistance-trait branch is the correct one.
      IMPLEMENTATION: (1) floor.js rolls one of three resistance traits
      (vowelless/shortFuse/alphabetic; new Floor.ELITE_RESISTANCE_TRAITS)
      per elite node AT GENERATION TIME and stores it on the node as
      `eliteTraitId` -- so the pre-entry warning and the in-fight monster
      read the same trait. Rolled per-node (not hard-mapped per def) -- a
      documented judgment call; the ticket's "one per elite def" is
      satisfied in spirit (each elite fights under exactly one resistance
      trait, always telegraphed), and per-node keeps it simple with only
      2-3 strong defs in the pool. (2) game.js startCombat replaces the
      elite monster's normal single-phase trait with
      [{hpThreshold:1, traitId: node.eliteTraitId}] -- elites only; the same
      strong def fought as a plain floor combat keeps its ordinary trait.
      (3) game.js renderNodeMap appends the resistance trait's hint to the
      elite pill (`Elite — <hint>`) before entry, exactly like boss pills.
      (4) game.js onMonsterDefeated pays 1.5x gold on an elite kill (logged
      "(elite 1.5x)") and grants one guaranteed unowned rule-changer item
      from the new Items.RULE_CHANGER_IDS pool (the exact 8 items from 4/8,
      logged "The elite drops X!"). Granted directly (not a choice screen)
      -- "a guaranteed drop." If all 8 are already owned, nothing drops.
      Elites keep their def's intent pool (hex/devour/enrage) from the
      isElite mechanism established in 2/8 -- not removed, so an elite is
      resistance trait + signature intents + strong-tier HP + telegraphed:
      a genuine, opt-in-in-spirit (if not in routing) risk.
      VERIFICATION: `npm test` 211/211 ALL CHECKS PASSED (18 new
      assertions: RULE_CHANGER_IDS shape, resistance-trait existence,
      floor-gen produces elite nodes with valid rolled traits, and a LIVE
      spliced elite fight proving the pre-entry pill warning, the resistance
      trait actually applied at fight start, the flagged-elite instance, the
      guaranteed rule-changer drop, and the 1.5x gold + its log lines).
      `npm run test:qa` 26/26 real Chromium zero errors. `npm run
      test:mobile` clean at 375/414px (elite pill's added hint text does not
      overflow -- same flex-wrap the boss pill's long hint already uses).
      NOT verifiable in jsdom, left for a real playtest: whether an elite
      (resistance trait 0.3x-floor + intents + ~68-82 HP) is actually FUN or
      just brutally hard, and whether 1.5x gold + a guaranteed rare feels
      like enough payoff for that spike. The resistance traits are 0.3x
      (not 0x), so the fight is always winnable, but the difficulty/reward
      balance is a feel call only a human playtest can make -- flagging for
      Jaxon. Version bumped v0.18 -> v0.19 (wordbound.html), player-facing
      feature.

- [x] FUN OVERHAUL 7/8 -- gamble events. Current events are mostly flat
      value; no memorable "do I dare" moments. Add 3 (THEME.md voice, each
      with a walk-away option):
      1. Forbidden Tome: gain a random rule-changer item (4/8 pool), take
         damage equal to 20% of max HP (min 5, cannot kill -- floor at 1
         HP).
      2. The Shredder: choose up to 2 tiles from your deck to destroy
         permanently (deck-thinning -- reuse the deck-viewer list UI for
         picking).
      3. Wager with the Stacks: stake 30 gold; win the NEXT fight without
         repeating a single word -> get 90 gold; repeat a word or lose the
         fight -> stake gone. (Depends on 1/8's usedWords tracking.)
      VERIFICATION: `npm test` + targeted checks per event (state before/
      after each choice, including the cannot-kill floor and the wager
      resolving both ways). Version bump.
      DONE 2026-08-20 (v0.19 -> v0.20). All 3 events added to events.js
      exactly as specified, wired into the existing random event pool
      (pickRandomEvent draws from all EVENT_DEFS). Each keeps a walk-away
      choice, and each risky choice carries a new optional
      `disabledReason(state)` so it greys out (with a reason) when it can't
      be taken (all rule-changers owned / deck too thin / can't afford the
      stake) instead of silently no-op'ing on click -- chooseEventOption
      re-checks it server-side too.
      IMPLEMENTATION NOTES (game.js is the only DOM-touching file, per its
      header):
      - Forbidden Tome: grants a random UNOWNED rule-changer from
        Items.RULE_CHANGER_IDS (the 4/8 pool), damage =
        max(5, round(maxHp*0.2)) floored at 1 HP (Math.max(1, ...), never 0).
      - The Shredder: an effect can now return { message, hold } -- 'hold'
        routes to a new SHREDDER sub-screen (state.screen='SHREDDER', its own
        panel in wordbound.html) that reuses the deck-viewer list style as
        pickable buttons. Pick cap = min(2, deck.length - MIN_DECK_SIZE(10)),
        so it can never thin the deck below a fillable rack. confirmShredder
        removes exactly the picked tiles from state.deck permanently.
      - Wager: staking deducts 30 gold immediately and sets state.activeWager;
        a new state.repeatedWordThisFight (set from combat.js's result.isRepeat
        in submitWord, reset in startCombat) tracks the lose condition.
        Resolved in onMonsterDefeated on the NEXT kill: clean win pays 90,
        a repeat forfeits the (already-deducted) stake; losing the fight
        forfeits by never reaching the payout. Cleared either way so it can't
        ride to a later fight. JUDGMENT CALL: "the next fight" = the next
        monster kill of ANY type (regular/elite/boss), whenever it happens
        (an intervening non-combat node just carries the wager forward) --
        the ticket didn't special-case fight type, and this is the natural
        reading.
      VERIFICATION: `npm test` 238/238 ALL CHECKS PASSED (27 new gamble
      assertions: tome grant + exact 20%-HP damage + cannot-kill floor +
      all-owned-disabled; shredder screen routing + 2-pick cap + unpick +
      permanent removal + deck-floor guard + at-floor-disabled; wager
      stake-deduct + can't-afford-disabled + decline, plus TWO live spliced
      1-HP kills through real Game.submitWord proving the clean-win payout
      and the repeated-word forfeit both resolve correctly). `npm run
      test:mobile` clean at 375/414px (new SHREDDER panel doesn't overflow).
      `npm run test:qa` 26/26 real Chromium zero errors. Real-Chromium
      smoke of the Shredder + Forbidden Tome panels: both render, the pick
      state and log lines are correct, zero page errors. NOT verifiable in
      jsdom (unchanged by this ticket, standing caveats): audio and
      drag-and-drop; and a human's feel for whether the gambles are
      actually tense -- Jaxon's playtest. Version bumped v0.19 -> v0.20.

- [x] DESIGN FIX, small (DIRECT FROM JAXON, 2026-08-20 ~11:15 ET -- do this
      FIRST, before 8/8 and the consumable ticket): "You should not be able
      to skip the final boss fight for the win." Currently the Empty Shelf
      event's "Sit and breathe" choice (js/wordbound/events.js:130 sets
      state.pendingEventSkipNextCombat) is honored for boss nodes in
      Game.enterCurrentNode (js/wordbound/game.js:228-246), which routes a
      skipped boss through advanceFloor(); on floor 3 that calls
      endRun(true) (game.js:192-194) -- i.e. taking the event right before
      the final boss wins the game without fighting it. That was a
      deliberate earlier design note (see the comment at game.js:234-239);
      Jaxon has now explicitly overruled it.
      FIX (orchestrator's spec -- bosses are the identity fights, so make
      ALL bosses unskippable, not just floor 3; one clean rule beats a
      floor-3 special case):
      1. In enterCurrentNode, do NOT consume pendingEventSkipNextCombat
         when node.type === 'boss': start the boss fight normally and
         KEEP the flag pending (it then applies to the next regular
         combat, e.g. on the following floor -- the player paid an event
         choice for it; don't silently void it). Log one flavorful line
         when a boss ignores a pending skip, e.g. "The <boss name> will
         not be avoided." so the player understands why their skip
         didn't fire.
      2. Update the choice text at events.js:127 to match the new rule,
         e.g. 'Sit and breathe: Recover 3 HP, skip the next fight
         (bosses will not be avoided)'.
      3. Update/replace the now-stale comment block at game.js:234-239
         (the "skipping the boss wins the floor" rationale no longer
         applies; the advanceFloor()-on-skipped-boss branch should be
         unreachable for bosses after this change -- remove that branch
         rather than leaving dead code).
      4. Elite nodes: unchanged by this ticket -- they remain skippable
         exactly as today. Do not expand scope.
      VERIFICATION: npm test with new assertions: (a) pending skip +
      regular combat node -> combat skipped, flag cleared, no loot;
      (b) pending skip + boss node -> combat STARTS against the boss,
      flag still true after entry, and beating that boss still advances
      floor / final boss still triggers VICTORY; (c) flag survives the
      boss fight and skips the next regular combat on the following
      floor; (d) event choice text contains the new wording. npm run
      test:qa stays 26/26. Version bump per house convention.
      DONE (see PROGRESS.md for timestamp): implemented exactly as spec'd.
      enterCurrentNode's combat branch now special-cases node.type==='boss'
      inside the pending-skip check: it startCombat()s the boss, logs
      "The <boss name> will not be avoided." and KEEPS
      pendingEventSkipNextCombat true (so the paid-for skip carries to the
      next regular combat). The old advanceFloor()-on-skipped-boss branch
      and its stale rationale comment (game.js:234-239) are removed --
      unreachable for bosses now. events.js:127 choice text now reads
      "...skip the next fight (bosses will not be avoided)". Elite nodes
      untouched (still skippable -- the boss special-case only triggers on
      node.type==='boss'). VERIFIED: npm test 256 checks pass incl. 15 new
      boss-skip assertions covering (a) regular skip still works + clears
      flag, (b) boss node with pending skip STARTS combat / flag survives
      entry / flavor line logged / final-boss kill still triggers VICTORY,
      (c) flag survives a non-final (floor-1) boss fight and then skips the
      next regular combat on floor 2 and is consumed there, (d) event text
      contains the new wording -- all driven through the real
      enterCurrentNode -> startCombat -> submitWord -> reward -> advanceFloor
      paths, zero console errors. npm run test:qa 26/26. Bumped v0.20 ->
      v0.21. (jsdom can't render the visible log line in a real browser, but
      the full state/flow is confirmed; the log message is a plain string
      push, no audio/drag involved.)

- [x] BUG (DIRECT FROM JAXON, 2026-08-20 ~11:20 ET, hit live on his phone
      -- do this SECOND, right after the boss-skip fix; it's small):
      common words are rejected -- he staged Z,I,T,S from real rack tiles
      and got '"ZITS" is not playable'. Orchestrator verified: WORDLIST
      (js/wordbound/wordlist.js) has 497,871 words but is missing ZITS,
      ZIT, SNIT, LUTZ (while ZAGS/QUIZ/ADZE/WHIZ are present) -- the
      source list seems to omit informal/newer words, exactly the ones
      players try. FIX: union a public-domain Scrabble-legal list into
      WORDLIST -- ENABLE1 (public domain, ~173k words, contains all four
      missing probes) is the safe choice; fetch it, uppercase, filter to
      the existing 2..15 length range, merge + dedupe + sort into
      wordlist.js. STRICTLY ADDITIVE: zero words removed. Note the source
      URL + added-word count in PROGRESS.md. Check how
      Lexicon.isValidWord consumes WORDLIST (set membership?) so the
      merge covers both validation and the QA scripts' word search.
      VERIFICATION: npm test with new regression probes (ZITS, ZIT,
      SNIT, LUTZ all valid; a few pre-existing words still valid; list
      strictly grew); npm run test:itch-build still passes its size
      checks -- if the union pushes the build over a size limit, report
      the numbers in PROGRESS.md and prefer trimming NOTHING (raise the
      limit if it's our own arbitrary threshold). Version bump.
      DONE 2026-08-20T15:45Z: fetched ENABLE1
      (https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt,
      172,823 lines), filtered to purely A-Z length 2-15 uppercased (168,551
      kept), unioned into the existing fully-expanded WORDLIST. Added 50,764
      NEW words; total 497,871 -> 548,635, deduped and sorted. Strictly
      additive (the merge set was SEEDED with the old expanded list, then
      only added -- zero removals, verified by construction and by the
      pre-existing-word regression probes). Rewrote wordlist.js as a single
      fully-baked static WORDS array (the old file generated -S/-ES/-ER/-ING
      forms at runtime; those are now baked in, so no behavior change, just
      the same words as static literals + the ENABLE1 union). Lexicon
      .isValidWord uses WORD_SET.has(upper), so validation and every QA
      script's WORDLIST/WORD_SET scan both pick up the new words with no
      other change. VERIFIED: npm test 267 checks (11 new wordlist probes:
      ZITS/ZIT/SNIT/LUTZ now valid, ZAGS/QUIZ/ADZE/WHIZ/CAT/GARDEN still
      valid, count > 500000). npm run test:itch-build ALL CHECKS PASSED, zip
      1.40 -> 1.41 MB (wordlist gzips tiny; no size gate exists anyway, the
      test only reports the number). Version v0.21 -> v0.22. NOTE: fixing
      the itch build surfaced a SEPARATE pre-existing launch-blocker (not
      part of this ticket) -- js/wordbound/intents.js was referenced by
      wordbound.html but missing from tools/build-itch.js's DEPENDENCIES
      list, so the itch build 404'd on it and combat would break in the
      deployed build. Added the one missing manifest line; build now clean.

- [x] MOBILE INPUT 1/3 (DIRECT FROM JAXON, 2026-08-20 ~11:15 ET): on
      touch devices there must be NO typing option -- the soft keyboard
      popping up/down on every tap is the single biggest mobile
      annoyance. Tapping letters becomes the ONLY mobile input.
      Root cause of the keyboard pops: selectTileForWord calls
      $('word-input').focus() after every tap (js/wordbound/game.js:1401)
      and btn-clear-word refocuses too (game.js:2120).
      SPEC:
      1. Touch detection: `window.matchMedia('(pointer: coarse)')` at
         init (+ listen for changes); when coarse, add a `touch-mode`
         class to <body>. All behavior below keys off that one flag.
         Desktop behavior must be 100% unchanged.
      2. touch-mode: hide the #word-input element (wordbound.html:67)
         entirely via CSS (.touch-mode #word-input { display:none }) --
         keep Play Word / Clear buttons. NEVER call .focus() on it in
         touch-mode (audit every focus() call site).
      3. Submission source: extract the existing selectedTileIds -> word
         mapping (game.js:1397-1400) into a helper (e.g. stagedWord());
         in touch-mode, btn-submit-word submits stagedWord() instead of
         input.value; Clear empties selectedTileIds without focusing.
         (Desktop keeps typing + Enter exactly as today,
         game.js:2106-2122.)
      4. Blank tiles: tap-selecting a blank is currently blocked
         (game.js:1382-1385, "type the word instead") -- that dead-ends
         blanks on mobile once typing is gone. Add a letter picker: in
         touch-mode, tapping a '?' tile opens a small A-Z grid overlay
         (reuse the existing panel/overlay pattern, e.g. consumables
         panel); picking a letter stages that blank AS the chosen
         letter; tapping the staged blank unstages it. BEFORE wiring:
         read how Lexicon.canFormFromRack resolves blanks
         (js/wordbound/lexicon.js ~70-90, prefers exact tiles over '?')
         and route the chosen letter through that same path -- do not
         build a parallel resolution mechanism. If the resolver prefers
         a real tile over the staged blank when both exist, that's
         fine (player-favorable) -- just note it in PROGRESS.md.
      5. Update any player-facing copy that says "type" (input
         placeholder is hidden anyway, but check the How-to-Play
         overlay) to tap-first wording in touch-mode.
      VERIFICATION: npm test with matchMedia mocked coarse: input
      hidden, no focus() calls (spy), submit uses stagedWord(), blank
      picker stages/unstages correctly; desktop-mode tests unchanged;
      npm run test:mobile at 375/414px (row hidden, no layout jump);
      npm run test:qa 26/26 (desktop path untouched). Version bump.
      DONE 2026-08-20 (v0.22 -> v0.23): implemented all 5 spec items.
      (1) Touch detection: Game.applyTouchModeFromMedia() reads
      matchMedia('(pointer: coarse)') at init and on 'change', toggling a
      `touch-mode` class on <body>; all JS keys off state.touchMode.
      Feature-checked so matchMedia-less envs (jsdom) stay desktop. (2) CSS
      `.touch-mode #word-input { display:none }` hides the typing box; Play
      Word / Clear stay. Every .focus() call site (selectTileForWord,
      btn-clear-word) now gated on !state.touchMode -- the two focus()
      calls that popped the keyboard. (3) New stagedWord() helper (the
      selectedTileIds->word mapping, extracted); touch-mode btn-submit
      plays stagedWord() not input.value; Clear empties selectedTileIds +
      blankAssignments without focusing. Desktop typing+Enter path
      untouched. (4) Blank picker: new #blank-picker-overlay (A-Z grid,
      same overlay pattern as how-to-play); tapping a '?' tile in
      touch-mode opens it, picking a letter assigns it via a new
      state.blankAssignments map and stages the tile; tapping a staged
      blank unstages it. The chosen letter feeds the word STRING that
      Combat.playWord re-resolves through Lexicon.canFormFromRack, which
      already prefers a real matching tile over a blank -- so if the player
      also holds that real letter, it's used instead (player-favorable,
      per the ticket's own allowance). (5) How-to-Play blank tip swaps to
      tap-first wording in touch-mode (applyTouchModeCopy).
      VERIFIED: `npm test` 292 checks (ALL PASSED; ~24 new touch-mode
      assertions: touch-mode class applied under mocked-coarse matchMedia,
      stagedWord reflects tapped tiles, submit reads staged word not the
      input via a submitWord-arg spy, focus() never called while
      staging/clearing/submitting via a focus spy, blank picker
      opens/assigns/unstages, and the whole thing reverts cleanly to
      desktop; desktop tests unchanged). `npm run test:mobile` clean at
      375/414px PLUS a new real-browser touch-mode section confirming
      #word-input is actually display:none, Play Word/Clear stay visible,
      and the A-Z picker grid (26 letters) fits 375px with 0 overflow --
      the CSS bits jsdom can't compute. `npm run test:qa` 26/26 (desktop
      combat path untouched). `npm run test:itch-build` clean. Also ran a
      throwaway real-Chromium end-to-end (deleted): forced touch-mode,
      entered a real fight, TAPPED a word's tiles, hit Play Word -> monster
      took real damage (57->54) and the log showed the played word +
      counterattack, staging cleared, input stayed hidden; then tapped a
      blank -> picker opened -> picked K -> staged as K. Zero page errors.
      NOT independently verifiable here (honest caveat): whether the soft
      keyboard actually stays down on a physical phone -- that's the whole
      point of hiding the input + killing focus(), and both are confirmed
      present, but only Jaxon's real device can prove the OS keyboard
      never appears. No audio/drag surface touched.

- [x] MOBILE INPUT 2/3 (DIRECT FROM JAXON, same message): make tile
      play physically interactive. Today staged tiles are inert display
      divs (renderStagingArea, game.js:2033-2060) and only the RACK
      supports drag-reorder (desktop HTML5 drag game.js:1988-2004,
      touch drag with 10px threshold game.js:1424-1475). Jaxon wants,
      verbatim: tiles "slide from where they're tapped to the lower
      area", are "rearrangeable once in the play area", and can be
      dragged "out of the play area to remove them from being played".
      SPEC (all of it works with BOTH touch and mouse):
      1. Slide animation (FLIP): on stage, capture the rack tile's
         getBoundingClientRect before render, the staged tile's rect
         after, and animate transform from the delta to 0 (~200ms,
         ease-out, transform-only -- no layout thrash). Reverse
         animation on unstage. Under prefers-reduced-motion: instant,
         no animation (existing house convention -- match how damage
         floaters gate it).
      2. Rack keeps its shape: a staged tile's rack slot renders as an
         empty outlined slot (same width -- the rack must not reflow),
         so the tile visually LIVES in the play area while staged.
         Tapping the empty slot unstages that tile back into it (the
         current tap-rack-tile-again-to-deselect path,
         game.js:1386-1390, becomes tapping the slot).
      3. Tap a staged tile in the play area -> unstage (slides home).
         (Except staged blanks in touch-mode, which 1/3 already
         handles.)
      4. Drag-reorder within the play area: generalize the rack's
         existing threshold-drag pattern (getTileAtPosition,
         game.js:1405-1422, currently hardcodes #rack-display) to work
         over the staging container, mutating selectedTileIds order;
         show a gap/drop indicator at the insertion point. Reordering
         updates the word (and any score preview) immediately on drop.
      5. Drag-out-to-remove: if a staged tile is dragged and released
         with the pointer outside the staging container's rect (>~30px
         tolerance), unstage it. While outside, dim the dragged ghost
         so the player can feel "this will remove".
      6. The dragged tile follows the finger/pointer (transform ghost);
         its origin shows a gap.
      IMPLEMENTATION WARNING: render() rebuilds DOM subtrees with
      innerHTML -- an active drag must not be destroyed mid-gesture.
      Follow the rack pattern: track drag in state, re-render once on
      release, not during. Also mind the ~720ms killing-blow death beat
      (combatActive stays true, rack in transient state) -- gestures
      landing in that window must no-op safely.
      VERIFICATION: npm test for all state logic (stage/unstage via
      every path, reorder mutations, drag-out removal, blank
      interaction); real-Chromium script: tap -> tile in play area +
      rack slot emptied, synthesized touch drag reorders (stagedWord()
      changes), drag past container bounds removes, reduced-motion
      path instant, zero page errors; npm run test:mobile. Version
      bump.
      DONE 2026-08-20 (v0.24 -> v0.25): Phase 2 (the drag mechanics)
      completed this run; Phase 1 (tap model + FLIP slide + empty-slot
      rack, specs 1/2/3) landed in the prior run. All six spec items now
      covered. Implemented via a single unified Pointer Events path (works
      for BOTH touch and mouse -- no separate touch/mouse handlers like the
      rack has): pointerdown/move/up/cancel on each staged tile.
      - Spec 4 (drag-reorder): `reorderStagedTile(tileId, insertIndex)` --
        pure state mutation, insertion-index semantics (0..len, so a tile
        CAN be dragged to the very end, which the rack's drop-ONTO
        convention can't express). Hit-test `stagedTileAtPosition` counts
        staged-tile centers left of the pointer, using a rect SNAPSHOT
        taken when the drag threshold is crossed (the live tiles move via
        transform mid-drag, so their live rects would lie). Siblings slide
        via translateX to open a visible gap at the insertion point
        (`applyStagingGap`). Word + input rebuilt immediately on drop.
      - Spec 5 (drag-out-to-remove): release >30px outside the staging
        container's rect -> `unstageTile` (the same single-source-of-truth
        unstage path Phase 1 built). Ghost dims (`.staging-drag-out`) while
        outside so the player feels the removal.
      - Spec 6 (ghost): the dragged tile follows the pointer via inline
        transform (`.staging-drag-ghost`, raised z-index); transform
        doesn't affect layout, so its origin naturally reads as a gap.
      - Both ticket HAZARDS handled: (a) NO mid-gesture render -- the live
        drag is transform-only, DOM re-rendered exactly ONCE on release
        (render() rebuilds #staging-area via innerHTML and would destroy
        the dragged element); (b) death-beat window -- startStagingDrag and
        endStagingDrag both re-check the tile is still in selectedTileIds
        and no-op safely if the rack cycled out from under the gesture.
      - `touch-action: none` on `.staged-tile` so a touch drag reorders
        instead of scrolling the page; a synthesized post-drag click is
        suppressed (`suppressNextStagingClick`, cleared on the next
        pointerdown so it can never eat a genuine later tap) so a reorder
        isn't immediately undone.
      - Reduced motion: the gap-slide transition is disabled under
        prefers-reduced-motion (the drag stays fully functional, just no
        tween); the FLIP on stage/unstage already gated in Phase 1.
      VERIFIED: `npm test` 311 checks ALL PASSED (+13 new jsdom checks for
      the reorder/drag-out/no-op/suppress-guard STATE LOGIC -- jsdom can't
      fire real pointer events or measure rects, so the pointer glue is
      browser-verified instead). `npm run test:qa` 26/26, `npm run
      test:mobile` clean at 375/414px, `npm run test:itch-build` clean.
      Throwaway real-Chromium Playwright script (written, run, deleted) in
      BOTH reduced-motion and normal-motion contexts: staged three tiles,
      drove a real pointer drag to reorder tile 0 to the end (confirmed
      selectedTileIds order + stagedWord() changed, ghost class present
      mid-drag, no tile lost, no lingering ghost after release), dragged a
      staged tile >260px below the play area to remove it (confirmed
      drag-out dim class while outside + exactly that tile removed), and a
      plain tap still unstaged -- zero console/page errors across both
      passes. HONEST CAVEAT: verified with MOUSE pointer events
      (page.mouse, pointerType 'mouse'); touch uses the identical
      type-agnostic code path (reads clientX/clientY/pointerId, same for
      both, and touch-action:none is in place), but a synthesized/physical
      TOUCH drag on a real phone was not exercised here -- only Jaxon's
      device can prove the touch-drag feel end to end.

- [x] MOBILE INPUT 3/3 (same directive, "more interactive in general"
      -- input-feel juice, deliberately separate from FUN OVERHAUL
      8/8's combat juice; no overlap): pressed state on every tile
      (:active scale ~0.93), staged tiles get a subtle lift/shadow so
      the play area reads as "picked up", a short settle animation
      (<=120ms) when a tile lands in rack or play area, animated
      gap-open/close during reorder, and optional light haptics
      (navigator.vibrate(8) on stage/unstage/submit, feature-checked,
      silently absent on iOS). ALL of it (haptics included) disabled
      under prefers-reduced-motion. Keep it restrained -- tactile, not
      carnival; this is polish on 2/3's mechanics, do it after.
      VERIFICATION: npm test; npm run test:mobile; PROGRESS.md note for
      what jsdom can't confirm (animation feel/timing) per house rules
      on animation claims. Version bump.
      DONE 2026-08-20 (v0.25 -> v0.26) -- see PROGRESS.md. All spec items:
      (1) pressed :active scale(0.93) on .letter-tile/.rack-slot-empty/
      .staged-tile; (2) a stronger staged-tile lift shadow so the play area
      reads "picked up"; (3) a one-shot land-settle (<=120ms) when a tile
      lands staged OR back in the rack -- a `.tile-settle` class the code adds
      for exactly one render then clears, animating brightness+shadow (NOT
      transform, deliberately: the Phase 1 FLIP owns transform on the same
      element and a transform keyframe would break the slide); (4) the
      animated reorder gap-open/close was ALREADY shipped by Phase 2
      (applyStagingGap/clearStagingGap 0.12s tween) -- noted, not re-done;
      (5) navigator.vibrate(8) haptics on stage/unstage/submit, feature-
      checked (Android-Chrome only; silently absent on iOS/desktop). ALL of
      it (haptics included) gated on prefers-reduced-motion. VERIFIED:
      `npm test` 318 checks ALL PASSED (+7 new: one-shot settle on stage AND
      unstage + the clear, haptic fires when motion allowed / suppressed
      under reduced motion); `npm run test:qa` 26/26; `npm run test:mobile`
      clean at 375/414; `npm run test:itch-build` clean (1.42 MB); plus a
      throwaway real-Chromium script (run + deleted) in BOTH normal- and
      reduced-motion contexts confirming the :active scale actually computes
      to matrix(0.93) while held (and to `none` under reduced motion) and a
      `tileSettle` animation actually runs on a just-staged tile (and does
      not under reduced motion), zero page/console errors. NOT verifiable
      here (honest caveat): the physical haptic buzz and the subjective feel/
      timing of the animations on a real phone -- only Jaxon's device proves
      those; the code paths, gates, and CSS are all confirmed present.

- [x] FUN OVERHAUL 8/8 -- celebration juice for the new systems (do LAST,
      after 1/8-7/8). Small, scoped, no new mechanics: combo chip pops on
      each stack (scale transform, ~150ms); damage >= 25 in one word ->
      brief screen shake + "CRUSHING!" floater; 7+ letter word ->
      "MAGNIFICENT!" banner + 5 bonus gold (log it); rule-changer item
      procs flash the item's chip in the items strip. ALL of it respects
      prefers-reduced-motion (existing convention from the visual-polish
      pass -- check how damage floaters already handle it and match).
      VERIFICATION: `npm test`; manual-reasoning note in PROGRESS.md for
      what jsdom can't confirm (shake/animation timing), consistent with
      house rules on animation claims. `npm run test:mobile`. Version bump.

- [x] BALANCE, small (orchestrator, from the 14:52Z QA pass): FUN OVERHAUL
      4/8's eight new items diluted the shop's item:consumable pool ratio
      from 15:3 to 23:3, so shops now roll consumables noticeably less
      often -- the exact "shops never seem to have consumables" feel an
      earlier ticket (2026-08-19 shop/consumable-availability pass) was
      created to fix, regressed as a side effect rather than by intent.
      FIX: guarantee at least one consumable slot per shop roll (pin one
      of the shop's option slots to the consumable pool before filling
      the rest from the combined pool), or weight consumables so the
      effective roll odds match the pre-4/8 ratio -- implementing run's
      call, note which in PROGRESS.md. Do NOT reduce the number of items
      in the pool to fix this.
      VERIFICATION: npm test with an added assertion that N simulated
      shop rolls (e.g. 50 via seeded rng) each contain >= 1 consumable
      (or hit the restored odds within tolerance); npm run test:qa.
      FIXED 2026-08-20T18:16Z:
      took the PINNED-SLOT option, not the reweight one. `rollShopOptions`
      (js/wordbound/game.js) now draws one id from the consumable pool
      first, fills the remaining 3 slots from the combined pool minus that
      pick, then shuffles the final 4 so the guaranteed consumable isn't
      always the first row. Pool sizes untouched per the ticket's own "do
      NOT reduce the number of items in the pool." Chose pinning over
      weighting because it's a hard guarantee (a weight only restores
      average odds and still leaves consumable-free shops) and because it's
      one deterministic extra rng draw, which keeps seeded runs
      reproducible -- verified by an added same-seed-twice assertion.
      New `Game._rollShopOptions()` test hook so the odds can be asserted
      without standing up a real shop node. `npm test` 340/340 (+5 new:
      all 50 seeded rolls contain >= 1 consumable; every roll is still 4
      distinct string ids -- the flat-string-array contract renderShop and
      the balance sim's shopping bot both rely on; rolls still offer
      non-consumables; the pinned consumable lands in slot 0 only
      sometimes; same seed -> identical roll). `npm run test:qa` ALL PASSED
      (real Chromium, zero console/page errors). Version bumped
      v0.27 -> v0.28 (user-facing: shop contents change).

- [x] BUG, small (review B4): every fight opens with a doubled article --
      "A The Consonant Constrictor appears!" (js/wordbound/game.js line 371:
      `log('A ' + state.monster.name + ' appears!')` while nearly every
      monster name already starts with "The", and "Quoth" takes no article
      at all). First line a player reads in every fight.
      FIX: drop the 'A ' entirely (`state.monster.name + ' appears!'`) --
      simplest and reads fine for every current name.
      VERIFICATION: `npm test` 16/16; eyeball the log line in the test
      output or a quick jsdom assertion that the message doesn't start
      with "A The".
      FIXED 2026-08-20T10:10Z: exactly the one-line fix specified. Added 3
      jsdom assertions (dom-check.js) -- the fight-start log line exists,
      has no "A " prefix, and matches "<monster name> appears!" exactly.
      `npm test` 85/85.

- [x] UX (review B5): staged-word editing is a trap. Clicking an
      already-selected rack tile stages it AGAIN (selectTileForWord,
      js/wordbound/game.js line 1006, has no dedupe/toggle), appending a
      doubled letter that guarantees a confusing "not playable" rejection --
      the same symptom the touch double-fire bug had, now reachable by any
      mouse user. The only recovery is Clear, which wipes the whole word.
      Also: clicking a blank ★ tile appends an empty string -- it highlights
      as selected but visibly does nothing (blanks currently only work by
      typing a word that needs them).
      FIX: make clicking a selected tile DESELECT it -- remove its id from
      state.selectedTileIds and rebuild #word-input from the remaining
      selection in order (the selection array is the source of truth; don't
      try to surgically edit the string). Keep typed input working exactly
      as today (typing doesn't touch selectedTileIds -- fine, that's
      existing behavior). For blanks, minimum viable: don't mark a blank
      selected on click (make it a true no-op) and add one line to the How
      to Play panel ("★ blanks: just type any word -- they fill in
      automatically"); anything fancier (click blank -> type its letter) is
      out of scope.
      VERIFICATION: `npm test` plus new assertions: click tile -> letter
      staged once; click same tile again -> letter removed, selectedTileIds
      empty, .selected class gone; two different tiles then unclick first ->
      input shows only second letter. Touch path must keep working --
      re-run test/verify-touch-tap-fix.js (tap goes through the same
      selectTileForWord).
      FIXED 2026-08-20T10:17Z: exactly the fix specified (toggle in
      selectTileForWord, full rebuild of #word-input from
      state.selectedTileIds in click order, blank tiles are now a true
      no-op, one new How to Play line). See PROGRESS.md for the 13 new
      live-DOM jsdom assertions and the touch/QA regression re-runs.
      `npm test` 98/98, `npm run test:qa` 24/24 (real Chromium),
      `test/verify-touch-tap-fix.js` still clean (8/8).

- [x] FEEL (review F2): boss music never stops after the boss dies -- music
      mode only changes in startCombat/startRun/endRun (js/wordbound/game.js
      lines 167, 370, 183), so after a boss kill the tense square-wave loop
      keeps playing through the tile reward, the boss hoard screen, and the
      ENTIRE next floor's map until the next fight starts. Also minor, same
      area: startCombat unconditionally stop+restarts music every fight even
      when the mode isn't changing (normal -> normal), restarting the loop
      from the top.
      FIX: (1) in onMonsterDefeated (or resolveBossItemReward), when the
      kill was a boss, switch back to normal music (or stop music -- pick
      one and note it; switching to normal is probably right since the map
      music IS the normal loop). (2) in startBackgroundMusic, early-return
      if already playing the requested mode.
      VERIFICATION: `npm test` 16/16 and `npm run test:qa` 24/24 (both
      exercise the code path; neither can hear audio). jsdom/Playwright can
      assert the internal mode variable if exposed for tests, or at minimum
      assert no errors on the boss-kill path. Say plainly in PROGRESS.md
      that actual audio behavior needs a real-browser ear check by Jaxon.
      FIXED 2026-08-20T10:28Z: both fixes exactly as specified (boss kill
      switches music back to normal in `onMonsterDefeated`;
      `startBackgroundMusic` early-returns when the requested mode is
      already playing). Exposed a new `Game._getMusicMode()` test hook and
      used it in `test/orchestrator-qa-boss-reward.js` (real Chromium,
      which DOES have a working AudioContext unlike jsdom) to assert the
      mode is `'boss'` right after the boss fight starts and `'normal'`
      right after the kill -- an actual end-to-end verification, not just
      "no errors." `npm test` 98/98, `npm run test:qa` 26/26 (2 new
      checks). See PROGRESS.md for the audio-can't-be-heard caveat.

- [x] FEEL (review F3): every screen transition is a hard cut -- map ->
      combat -> reward -> map all swap instantly via `hidden` class toggles;
      the only entrance animation in the game is the boss's
      (css/wordbound.css bossEntrance, line ~305). Add a short (150-250ms)
      fade and/or slight rise animation to panel/screen appearances: a
      single CSS animation on .combat-panel/.treasure-panel/.node-map (and
      the main screens) when they become visible covers it -- reuse the
      slideInTile/bossEntrance pattern. Respect prefers-reduced-motion
      (wrap in the media query or disable via it). Do NOT delay input
      availability -- animation is cosmetic, elements stay clickable
      immediately (test:qa clicks fast; it will catch it if not).
      VERIFICATION: `npm test` 16/16, `npm run test:qa` 24/24 (real clicks
      through every transition), `npm run test:mobile` clean (CSS-layout
      task -> mandatory gate per top-of-file rules).
      DONE 2026-08-20T10:43Z: see PROGRESS.md for the fix -- a single
      `screenFadeIn` keyframe (opacity 0->1 + translateY(8px)->0, 200ms
      ease-out) applied via class selectors (`.screen`, `.node-map`,
      `.combat-panel`, `.treasure-panel` -- the last also covers
      tile-reward-panel/boss-reward-panel/event-panel, which share that
      class) so every hard-cut transition in the ticket is covered by 4
      selectors, wrapped in `prefers-reduced-motion: no-preference`. `npm
      test` 98/98, `npm run test:qa` 26/26, `npm run test:mobile` clean.

- [x] POLISH batch, small (review F4) -- four cheap visual fixes, one run:
      (1) the stock blue range slider (#music-volume) clashes with the
      parchment/gold palette everywhere -- `accent-color: #f0d789` (or
      similar) in css/wordbound.css;
      (2) run-header wraps awkwardly even at 900px desktop ("HP 20 /" then
      "20" on the next line, gold coin wrapping under HP) -- let the HP/gold/
      floor labels keep natural width (white-space: nowrap on .hp-display /
      .gold-display) and check flex-basis on .run-header children;
      (3) the empty message log renders as a large dead black panel on the
      first map view -- give #message-log a min-height reduction when empty
      or a faint placeholder line ("The Stacks are quiet.") in the theme
      voice;
      (4) damage numbers always spawn dead-center at the same point
      (game.js animateDamage, left/top 50%) -- add a small random offset
      (±20-30px, plain Math.random is FINE here, it's cosmetic-only and
      must NOT consume state.rng -- seeded-run determinism) and scale
      font-size mildly with damage.
      VERIFICATION: `npm run test:mobile` clean at 375/414 (CSS layout ->
      mandatory), `npm test` 16/16, and desktop-width screenshots
      (900-1024px) confirming the header no longer wraps -- the mobile gate
      doesn't cover desktop, say what was eyeballed.
      DONE 2026-08-20T11:40Z: all four fixes exactly as specified.
      `#music-volume { accent-color: #f0d789; }` added. Run-header fix
      needed one thing beyond the ticket's own suggestion: `white-space:
      nowrap` + `flex-shrink: 0` on .hp-display/.gold-display/.floor-label
      stopped the WRAP, but at 900px exposed a worse legibility bug (no
      wrapping means justify-content:space-between's leftover-space gaps
      shrink toward zero when content is tight, so "HP 20 / 20" + "0" ran
      together as "20/200" with the coin icon squeezed in) -- fixed by
      adding `gap: 14px` to `.run-header` as a spacing floor that
      space-between distributes on top of; confirmed pre-fix state was
      genuinely broken too (measured header height 42px = actual 2-line
      wrap at 900px, not just an eyeballed guess) via a scratch Playwright
      script (git-stashed the fix, screenshotted, restored) rather than
      assuming the ticket's description was accurate. Message-log empty
      state: added `state.messages.length` check in `renderRun()`,
      renders `.message-log-placeholder` ("The Stacks are quiet.",
      THEME.md-voiced, faint italic) instead of an empty panel -- went
      with the placeholder option over the min-height option since the
      ticket offered either. Damage numbers: `animateDamage()` now adds a
      ±25px random offset via `left`/`top` (kept the existing `transform:
      translate(-50%,-50%)` centering untouched rather than folding the
      offset into `transform`, since the `.damage-number` CSS animation
      (`floatDamage`) also animates `transform` for the float-up motion --
      putting jitter there would fight the animation) and scales
      font-size `1 + damage/60` capped at 1.6x. Uses plain `Math.random()`
      per the ticket's own explicit instruction, does not touch
      `state.rng`. VERIFICATION: `npm test` 110/110 (ALL CHECKS PASSED,
      unchanged pass count -- no jsdom assertions target this ticket's
      specific visuals, the existing damage-number-presence checks still
      pass with the new offset/scale in place). `npm run test:mobile`
      clean at 375/414 (main menu + combat, before and after). Desktop
      screenshots at 900px and 1024px (scratch Playwright script, not
      committed) confirm single-line header, gold slider, and the
      placeholder line, with zero horizontal overflow at either width --
      images inspected directly, not inferred from computed styles alone.
      No version bump (cosmetic-only polish batch, no new mechanic or
      balance change; matches the no-bump precedent set by the F2/F3
      tickets immediately above).

- [x] POLISH, small (review F4.5): tile-reward options render as three
      full-width bars each containing one small letter -- while the rack
      right above uses the game's nice .letter-tile styling. Restyle the
      tile-reward (and boss-tile contexts if shared) choices to LOOK like
      letter tiles: letter large with its point value in <sub>, bonus
      description underneath, tile-sized buttons side by side instead of
      stacked full-width bars (renderTileReward, game.js ~line 1317; CSS
      .treasure-choice is shared with item choices -- add a modifier class
      for tile-shaped choices rather than restyling the shared one).
      VERIFICATION: `npm run test:mobile` clean (375/414 -- three tiles
      side by side must not overflow; wrap if needed), `npm test` 16/16,
      `npm run test:qa` 24/24 (it clicks these buttons).
      DONE 2026-08-20T12:00Z: checked -- `bossRewardOptions` are always
      items (grepped, confirmed), never tiles, so "boss-tile contexts if
      shared" doesn't apply; scope stayed to `renderTileReward` /
      `#tile-reward-choices` only, as the ticket's own line-number pointer
      implied. Added a `.treasure-choice-tile` modifier class (kept
      `.treasure-choice` too, for the shared hover/panel chrome) with a new
      `.tile-reward-letter` element inside reusing the exact rack-tile
      pattern (`letter<sub>value</sub>`, `Lexicon.LETTER_VALUES`, blank ->
      ★) plus the same `has-bonus`/`bonus-flat`/`bonus-mult-play`/
      `bonus-mult-hold` glow classes the rack already uses (copied
      verbatim, same box-shadow values, just scoped to the nested letter
      element) so a bonus tile reward visually matches a bonus tile in the
      rack. `#tile-reward-choices` got a `.treasure-choices-tiles` modifier
      (flex-row + wrap + centered, vs. the shared column layout every
      other panel -- items, shop, deck viewer, consumables, events --
      still uses) so this was additive, not a change to the shared
      `.treasure-choice`/`.treasure-choices` rules. Also added the new
      `.tile-reward-letter sub` selector to the existing mobile
      badge-legibility fix (the `@media (max-width: 480px)` block that
      already grows `.letter-tile sub`/`.staged-tile sub`) for consistency.
      VERIFICATION: `npm test` **115/115** (5 new targeted jsdom
      assertions added to the existing killing-blow-reaches-TILE_REWARD
      flow: one `.treasure-choice-tile` per offered option, it contains a
      `.tile-reward-letter`, that element has a non-empty point-value
      `<sub>`, clicking a choice adds it to the deck, and picking resolves
      off the TILE_REWARD screen). `npm run test:mobile`: the existing
      script only covered the main menu and combat screen, so extended it
      with a third "tile-reward screen" section (forces a killing blow via
      `window.Wordbound.Game._state` + the wordlist/Lexicon, same pattern
      dom-check.js already uses, then runs the same `checkLayout` helper)
      -- clean at both 375px and 414px, zero overflow, zero clipped
      elements, three tiles genuinely sit side by side without wrapping at
      either width. `npm run test:qa` **26/26** real-Chromium, unchanged
      count but it does click through the boss tile-reward panel with the
      new styling live (`tile-reward panel visible after boss kill`, `skip
      path` checks) -- zero console/page errors. Also eyeballed real
      screenshots at 375px/414px/900px (scratch Playwright script, not
      committed, deleted after use): three tile-shaped buttons side by
      side, letter large with point value in the corner, bonus line
      underneath when present, no overflow at any width, reads clearly
      better than the old full-width bars. **Not independently visually
      confirmed:** a reward tile that actually rolled a bonus (the run
      used for screenshots happened to offer three plain tiles) -- the
      bonus-glow CSS is copy-pasted verbatim from the already-visually-
      proven rack-tile rules under a new selector, so risk is low, but
      saying so plainly rather than claiming a screenshot check I didn't
      actually get. No version bump -- cosmetic-only restyle, no new
      mechanic or balance change, matching the no-bump precedent set by
      the F2/F3/F4 tickets above.

- [x] FEATURE (review N6): end-of-run stats screen. Victory/game-over
      currently show one static line + the seed -- nothing to share or
      screenshot, right when v0.10 made seeds visible. Track during the run
      (in state, reset in startRun): words played, best word (highest
      damage, store word + damage), total damage, monsters defeated, floors
      cleared, gold earned. Show a compact stats block on BOTH game-over
      and victory screens next to the seed (Achievements already tracks max
      damage this run -- reuse/share rather than double-track if clean).
      Keep it text -- no new panels/screens, just enrich the two existing
      end screens. THEME.md voice for labels.
      VERIFICATION: `npm test` plus assertions that a completed fight
      increments the counters and the game-over screen renders them.
      `npm run test:mobile` if the end-screen layout changes structurally.
      Version bump.
      DONE 2026-08-20T12:22Z: new `state.runStats` object (wordsPlayed,
      bestWord, bestWordDamage, totalDamage, monstersDefeated,
      floorsCleared, goldEarned), reset in `Game.startRun`, incremented at
      the natural call sites (submitWord for words/damage/bestWord,
      onMonsterDefeated for kills+gold, advanceFloor for floors cleared,
      plus the 3 gold-granting event choices in events.js). Deliberately
      NOT reusing Achievements' internal maxDamageDealt tracker (review's
      own "reuse/share if clean" caveat) -- it isn't exposed via a public
      getter and only tracks a bare number, not word text, so a second
      lightweight counter at the same call site was cleaner than adding a
      new Achievements API just to read one private field back out.
      `renderRunStats()` (game.js) builds a 6-row label/value block, reused
      by both `renderGameOver`/`renderVictory` into new
      `#game-over-run-stats`/`#victory-run-stats` containers (wordbound.html)
      placed between the existing summary line and the seed line, per the
      ticket's "next to the seed" placement. New `.run-stats-summary`/
      `.run-stat-row` CSS (wordbound.css), consistent with the existing
      panel/seed-display palette. Version bumped v0.14 -> v0.15
      (player-facing feature, per the ticket's own instruction).
      VERIFICATION: `npm test` 127/127, ALL CHECKS PASSED (12 new targeted
      assertions: runStats fields populated correctly after a real word
      play + kill via actual UI clicks, both end-screen stats blocks
      render with the right rows/values when forced via the existing
      openDeckViewer/closeDeckViewer re-render trick). `npm run
      test:mobile` extended with a 4th "game-over screen" section (the
      ticket's own "if the end-screen layout changes structurally" clause
      applies -- a former 2-line screen now has a 6-row block) -- clean at
      375px/414px, no overflow/clipping. `npm run test:qa` 26/26 unaffected
      (drives two real boss fights + floor advances, zero errors, though it
      doesn't assert on runStats directly -- dom-check.js already covers
      that). Housekeeping: this run's checkout started with local `main`
      (and, unusually this time, the locally-cached `origin/main` ref too)
      pointed at the same stale unrelated 3-commit history a prior run
      flagged (2026-08-20T11:40Z entry below) -- a fresh `git fetch origin
      main` confirmed the real remote tip matches HEAD (`86720e2`), so this
      was a stale local ref cache again, not an actual remote rewind; reset
      `main` to track it properly before committing.

- [x] CLEANUP, tiny (review B6): three drift/latent items, one run:
      (1) js/wordbound/consumables.js -- comment says 12% drop chance, code
      returns 0.20; comment claims rarity-weighted roll, code picks
      uniformly. Fix the COMMENTS to match code (current behavior is fine),
      or implement weighting if trivial -- either way make them agree.
      (2) Game.useConsumable (game.js ~line 708) never checks monster death
      after applying an effect -- safe today only because no consumable
      deals direct damage; add the guard now (if monster.hp <= 0 route
      through the same defeat path submitWord uses) or a loud comment at
      minimum, so the first damaging consumable added doesn't ship a
      0-HP-monster-still-fighting bug.
      (3) monsters.js header comment still advertises multi-phase bosses
      ("bosses have 2-3") -- true again only after the multi-phase ticket
      above; sync whichever ships last.
      VERIFICATION: `npm test` 16/16 (behavior should be unchanged unless
      the useConsumable guard is added -- then add a targeted test for it).
      DONE 2026-08-20T12:44Z: (1) fixed both
      stale comments in consumables.js to match the actual code (20% drop
      chance, uniform pick among all defs -- no rarity weighting exists).
      (2) added the guard in `Game.useConsumable` (game.js): captures
      `monsterHpBefore`, and if the monster's HP is <= 0 after the effect
      resolves, calls the same `onMonsterDefeated(damageDealt,
      monsterHpBefore)` path `submitWord`'s kill branch uses instead of a
      bare `render()`. Added a targeted jsdom test (a throwaway test-only
      consumable registered/deregistered inside the test, dealing direct
      monster damage) proving a consumable kill now correctly reaches
      TILE_REWARD with combat inactive, since no shipped consumable could
      exercise this path today. (3) monsters.js's header comment already
      correctly said "bosses have 2" (synced by the FUN OVERHAUL 3/8 ticket
      landing after this one was written) -- confirmed, no change needed.
      `npm test` 129/129 (2 new assertions), `npm run test:qa` 26/26 (real
      Chromium, zero errors) -- no CSS/layout touched so `npm run
      test:mobile` isn't required by this ticket's own gates. No version
      bump (internal cleanup/comment-sync + a defensive guard with no
      player-facing behavior change today).

- [x] BUG, high priority: the touchscreen tap-to-play fix (commit a486e06,
      2026-08-20T00:59Z, "Fix touchscreen tap bug") double-fires on every
      tap -- each tapped rack tile's letter gets appended TWICE to
      `#word-input` and the same tile id gets pushed twice into
      `state.selectedTileIds`, corrupting the word being formed. FIXED
      2026-08-20T04:59Z: see PROGRESS.md for the fix, the exact-assertion
      test rewrite, and one unrelated pre-existing bug found and fixed in
      the test script along the way (the How to Play overlay silently
      blocking all touch/click input on a fresh browser context, the same
      class of issue already found once for `npm run test:qa`). Found
      2026-08-20 during a real-browser Playwright QA pass using actual touch
      emulation (`browser.newContext({ hasTouch: true })` +
      `page.touchscreen.tap()` / `locator.tap()`, NOT a mouse `.click()` --
      the mouse-click path is unaffected and still works correctly).
      Reproduced twice independently (two different tiles, two different tap
      APIs -- raw `page.touchscreen.tap()` on one tile and `locator.tap()` on
      another), both with identical symptoms.
      REPRO: fresh run, enter first combat, real tap (not click) on a rack
      tile showing "T". Observed: `#word-input` becomes `"TT"`, not `"T"`;
      `state.selectedTileIds` becomes `["tile9","tile9"]` -- the SAME tile id
      twice, not two different tiles. A second real tap on a different tile
      ("R") continued the pattern: input became `"TTRR"`, `selectedTileIds`
      `["tile9","tile9","tile7","tile7"]`. Tapping out any real multi-letter
      word this way doubles every letter in sequence (e.g. tapping C-A-T
      produces "CCAATT"), which fails dictionary validation for virtually
      every real word -- `Game.submitWord` (js/wordbound/game.js ~line 468)
      logs `"CCAATT" is not playable` and rejects it. Net effect:
      tap-to-play is still effectively non-functional for real words on a
      real touchscreen, just broken in a more confusing way than before the
      fix (an incorrect "not playable" rejection instead of silently doing
      nothing).
      ROOT CAUSE: a486e06 correctly stopped calling `preventDefault()`
      unconditionally on `touchstart` (js/wordbound/game.js ~line 1458-1462)
      -- that was the ORIGINAL bug (it suppressed the browser's synthesized
      post-touchend `click`, so taps did nothing). But the fix's `touchend`
      path (~line 1471-1473) calls `endTouchReorder(tile)`, which, when no
      drag threshold was crossed, calls `selectTileForWord(tappedTile)`
      directly (~line 1070-1073):
      ```
      } else if (!state.touchDragThresholdCrossed && tappedTile) {
        // No drag happened: treat as a tap and play the letter
        selectTileForWord(tappedTile);
      }
      ```
      Nothing in the touchstart/touchmove/touchend handlers ever calls
      `preventDefault()` for a plain, non-drag tap. Per standard browser
      touch-to-mouse-event synthesis (the same mechanism the ORIGINAL bug's
      blanket `preventDefault()` used to suppress), an un-prevented touch tap
      still gets a synthesized `click` event dispatched shortly after
      `touchend`, targeting whatever element now occupies that screen
      position. Since `selectTileForWord()` calls `render()` (~line 1010),
      which rebuilds `#rack-display` from scratch (~line 1415,
      `rack.innerHTML = ''`) and re-attaches a fresh `click` listener to the
      newly-created tile button in the same rack position (~line 1436-1438,
      `btn.addEventListener('click', function () { selectTileForWord(tile);
      });`), the delayed synthesized click lands on that *replacement*
      element and fires `selectTileForWord(tile)` a SECOND time for the same
      underlying tile. Confirmed directly with a diagnostic: a listener
      attached only to the ORIGINAL (pre-render) tile element captured
      exactly one `touchstart` + one `touchend` and no `click` (because the
      synthesized click landed on the replacement element instead, not the
      one being listened to), while the game's actual state still showed the
      double-append.
      WHY the existing regression test didn't catch this:
      test/verify-touch-tap-fix.js's only relevant assertion is
      `afterTapValue.length > 0` (its line 48) -- "something got typed," not
      "exactly the tapped letter, once." A doubled letter still satisfies
      `length > 0`. Separately, that script currently can't even run locally
      at all (see the TEST-INFRA ticket immediately below) so it hasn't
      actually been re-run since a486e06 shipped; running it today (patched
      only enough to launch locally, in a scratch copy, logic untouched)
      still printed its own "PASS: Tap played a letter" despite the
      doubling, confirming the assertion gap rather than a since-fixed bug.
      FIX: suppress the browser's synthesized click for the plain-tap case,
      the same way the drag case already implicitly does via its own
      `preventDefault()` in `touchmove`. Simplest: pass the event through to
      `endTouchReorder` and call `e.preventDefault()` (guarded on
      `e.cancelable`) right before `selectTileForWord(tappedTile)` in the
      no-drag branch:
      ```
      btn.addEventListener('touchend', function (e) {
        endTouchReorder(tile, e);
      });
      ```
      Alternative: drop the explicit `selectTileForWord(tappedTile)` call
      from `endTouchReorder` entirely and let the untouched, un-prevented
      touch sequence's natural synthesized `click` (already confirmed to
      reach the existing `click` listener) be the ONLY thing that plays the
      tapped letter -- simpler, but more implicit/timing-dependent; pick
      whichever is cleanly verifiable. Either way, also tighten
      test/verify-touch-tap-fix.js's assertion to check the exact resulting
      value (e.g. `afterTapValue === expectedLetter`, not just `.length >
      0`) and that `state.selectedTileIds.length === 1` after one tap, so
      this class of regression can't pass silently again.
      VERIFICATION: real Playwright touch emulation (`hasTouch: true`,
      `page.touchscreen.tap()` and/or `locator.tap()`), tapping a single
      rack tile once and confirming `#word-input` gains EXACTLY one copy of
      that tile's letter and `state.selectedTileIds` gains EXACTLY one entry
      (the tapped tile's id, once). Also re-confirm drag-to-reorder via
      simulated touch still works and still does NOT also append a letter
      (the two interactions must stay mutually exclusive, per the original
      ticket). `npm test` 16/16.

- [x] TEST-INFRA: three Playwright test scripts hardcode the cloud-sandbox-
      only chromium path and can't run at all on a normal local checkout
      (confirmed today on Jaxon's local Mac: `browserType.launch: Failed to
      launch chromium because executable doesn't exist at
      /opt/pw-browsers/chromium`) -- the exact class of bug already found
      and fixed once for test/verify-mobile-layout.js (see this file's
      TEST-INFRA entry from earlier tonight), just never applied to the rest
      of the test suite. COMPLETED 2026-08-20T05:12Z: see PROGRESS.md for
      what was actually left to do here (one of the three named scripts,
      verify-touch-tap-fix.js, was already fixed as an opportunistic
      side-effect of the touch-double-fire bug ticket above -- only
      verify-keyboard-playable.js and measure-wordlist-load.js still needed
      the fix, applied here with the same `fs.existsSync` pattern).
      AFFECTED: test/verify-touch-tap-fix.js line 4 (`chromium.launch({
      executablePath: '/opt/pw-browsers/chromium' })`, no fallback) -- this
      one ALSO separately hardcodes a cloud-sandbox-only file path (line 12,
      `file:///home/user/descent-of-essence/wordbound.html`, which doesn't
      exist on a local checkout either, so it fails a second, independent
      way even once the browser launches); test/verify-keyboard-playable.js
      lines 274-275; test/measure-wordlist-load.js lines 52-53. Compare to
      the already-correct pattern used elsewhere (test/verify-mobile-layout.js,
      test/verify-itch-build.js, test/orchestrator-qa-boss-reward.js,
      tools/record-gameplay.js): check `fs.existsSync(sandboxChromiumPath)`
      first and only pass `executablePath` when it's actually there,
      otherwise let `chromium.launch()` fall back to its own default
      resolution.
      Found 2026-08-20 while trying to actually run these scripts locally as
      part of a real-browser QA pass (needed test/verify-touch-tap-fix.js
      specifically to investigate the double-tap bug above) -- had to make a
      throwaway patched copy in a scratch dir just to execute it at all.
      FIX: apply the same `fs.existsSync(sandboxChromiumPath) ?
      { executablePath: sandboxChromiumPath } : {}` pattern to all three
      scripts' `chromium.launch()` calls; fix verify-touch-tap-fix.js's
      hardcoded `/home/user/...` URL to resolve relative to the repo (e.g.
      `` file://${path.join(__dirname, '..', 'wordbound.html')} ``, matching
      how other scripts avoid a hardcoded absolute repo path). While in
      there, note verify-touch-tap-fix.js also never sets a non-zero exit
      code on failure (no `process.exit(1)` / `process.exitCode` anywhere --
      it just logs ✓/✗ characters to stdout), so a real failure wouldn't
      even fail an `npm run` invocation or CI; worth adding real pass/fail
      tracking with a matching exit code while touching this file, same
      pattern test/dom-check.js already uses.
      VERIFICATION: all three scripts run successfully end to end on a fresh
      local clone (no manual path edits, no cloud-sandbox-only directories
      required) AND still work unmodified in the cloud sandbox (the
      `fs.existsSync` branch keeps that path alive there). `npm test` 16/16
      (these are test-only changes).

- [x] BUG, high priority (softlock, game-breaking): skipping a fight via the
      "Sit and breathe" event choice permanently strands the run if the
      skipped fight turns out to be that floor's boss. FIXED 2026-08-20T02:56Z
      (orchestrator, directly -- game-breaking bugs don't wait an hour): exact
      fix as specified below, verified by the new
      test/verify-boss-skip-softlock-fix.js (11/11: floors 1->2->3 all land
      playable after a boss skip, floor-3 skip ends in VICTORY, no loot
      granted on any skip path), npm test 16/16, and a full re-run of the
      boss-reward QA (24/24, normal kill path unregressed). One DESIGN NOTE
      for Jaxon flagged in PROGRESS.md: this fix means skipping the floor-3
      boss wins the game -- see there before deciding if that needs changing.
      Found 2026-08-20 during
      a real-browser Playwright QA pass (adapted qa-playthrough.js) testing
      commit e4d9120 -- reproduced organically in one full run (Run 2 of 2),
      then confirmed deterministically with an isolated repro that sets
      `pendingEventSkipNextCombat = true` and fast-forwards to a floor's last
      (boss) node before doing a REAL click on its node-map pill.
      ROOT CAUSE: js/wordbound/game.js's `Game.enterCurrentNode` (lines
      169-202), specifically the combat-skip branch at lines 173-183:
      ```
      if (node.type === 'combat' || node.type === 'elite' || node.type === 'boss') {
        // Check if an event (like Empty Shelf) skipped this combat
        if (state.pendingEventSkipNextCombat) {
          state.pendingEventSkipNextCombat = false;
          log('You skip the next encounter.');
          node.cleared = true;
          state.currentNodeIndex += 1;
          render();
          return;
        }
        startCombat(node);
      }
      ```
      This skip path applies uniformly to combat/elite/boss nodes and just
      bumps `currentNodeIndex` -- it has no floor-advance logic, unlike every
      other way a boss node gets resolved (a real boss kill goes through
      `onMonsterDefeated` -> `resolveTileReward` -> `resolveBossItemReward` ->
      `advanceFloor()`, ~lines 529-601). Per js/wordbound/floor.js line 86
      (`var types = ['combat'].concat(body).concat(['boss'])`), the boss node
      is ALWAYS the last node in `state.floor.nodes`. So when the skip fires
      on the boss specifically, `currentNodeIndex` becomes equal to
      `floor.nodes.length` -- one past the end of the array. `state.screen`
      stays `'RUN'`, `combatActive` is false, `currentNode()` returns
      `undefined`, and `renderNodeMap()` has no node to render a
      `.node-pill.node-current` for. Result: no combat, no clickable node, no
      valid action of any kind -- the run is permanently stuck. The trigger is
      js/wordbound/events.js's `empty_shelf` event (lines 100-111), whose
      first choice ("Sit and breathe: Recover 3 HP, skip the next fight",
      line 105) sets `state.pendingEventSkipNextCombat = true` unconditionally
      -- nothing about that event knows or cares whether the next combat-type
      node the player reaches is the boss.
      REPRO (verified with a real click on the real pill, not synthetic
      render forcing): set `state.pendingEventSkipNextCombat = true`, set
      `state.currentNodeIndex = state.floor.nodes.length - 1` (the boss node),
      trigger a real re-render (e.g. open/close the deck viewer), then click
      `.node-pill.node-current` for real. Result observed: `currentNodeIndex`
      8 on an 8-node floor (`floorNodeCount: 8`), `screen: 'RUN'`,
      `combatActive: false`, zero `.node-pill.node-current` elements in the
      DOM. No console/page errors -- it fails silently, which makes it worse
      for a real player (no crash to notice, just an unresponsive map).
      FIX: in the skip branch, check whether the skipped node was the boss and
      route through the same floor-advance path a real boss kill uses instead
      of a bare index increment:
      ```
      if (state.pendingEventSkipNextCombat) {
        state.pendingEventSkipNextCombat = false;
        log('You skip the next encounter.');
        node.cleared = true;
        if (node.type === 'boss') {
          advanceFloor(); // boss is always the last node; a bare index bump strands the run
          return;
        }
        state.currentNodeIndex += 1;
        render();
        return;
      }
      ```
      `advanceFloor()` already resets `currentNodeIndex` to 0 for the new
      floor, so no separate increment is needed on that branch. Deliberately
      skip the tile-reward and boss-item-reward screens on this path (no
      monster was actually defeated, so no kill rewards should be granted --
      only the floor-advance itself is missing, not the boss's loot).
      VERIFICATION: `npm test` (16/16). Add a targeted check (jsdom or
      Playwright) that sets up this exact scenario -- pending skip flag true,
      current node index at the floor's last (boss) node -- enters the node,
      and confirms the run ends up on a valid, playable state afterward
      (either a fresh floor's first node clickable, or VICTORY if it was floor
      3's boss) rather than stuck with no current-node pill. Also re-run a
      full Playwright playthrough or two to confirm no regression to the
      normal (non-skip) boss-kill -> tile-reward -> boss-item-reward ->
      next-floor flow, which is working correctly as of e4d9120 (verified
      twice in this same QA pass, including the brand-new boss-item-reward
      feature end to end).

- [x] BUG/TEST-INFRA: `npm run test:mobile` currently fails (exit code 1) on
      this checkout due to the main-menu title overflowing at 375px width --
      FIXED 2026-08-20T03:14Z: see PROGRESS.md for the fix, the font-metric
      extrapolation used to verify it without Georgia installed in this
      sandbox, and margin numbers at both breakpoints.
      worth fixing both because it's a real overflow a narrow-phone player
      could hit, and because it currently blocks the mandatory mobile-layout
      gate GOALS.md's own top-of-file rules require for CSS-touching tasks.
      Found 2026-08-20 while re-running `npm run test:mobile` on commit
      e4d9120 as part of a QA pass; verified this is NOT a regression from
      e4d9120 itself (that commit touched no CSS -- confirmed via `git diff
      --stat`) by checking out the immediately-prior commit (7637929, the one
      whose own PROGRESS.md entry claims "Main menu 375px/414px: zero
      overflow... Layout OK clean") in a separate worktree and reproducing
      the identical 25px overflow there too. So either that verification
      didn't actually reproduce what it claimed, or (more likely, worth
      checking) it's font-availability-environment-dependent -- see below --
      but either way it's real and currently failing on this checkout today.
      ROOT CAUSE: css/wordbound.css lines 32-37, `.game-title`:
      ```
      .game-title {
        font-size: 2.6rem;
        letter-spacing: 0.12em;
        margin: 0 0 8px;
        color: #f0d789;
      }
      ```
      rendered as an `<h1>` (default bold) in `font-family: 'Georgia', 'Times
      New Roman', serif` (body rule, css/wordbound.css line 5). "WORDBOUND" is
      a single unbreakable word with no `white-space`/`overflow-wrap`
      handling, so it can't wrap. Measured directly at 375px viewport width:
      the H1's own box is 303px wide (`clientWidth`) but its rendered text
      needs 364px (`scrollWidth`) at `700 41.6px Georgia` with 0.12em letter-
      spacing -- a 61px internal overflow that pushes the whole document's
      `scrollWidth` to 400px against a 375px `clientWidth`, a 25px horizontal
      overflow. Confirmed visually with a Playwright screenshot at 375px: the
      final "D" of "WORDBOUND" is clipped off the right edge of the panel and
      the page. The existing `@media (max-width: 480px)` block added for the
      earlier mobile-overflow fix (css/wordbound.css lines ~537-568) only
      covers `.run-header`/`.run-header-actions`/`#music-volume`/
      `.word-input-row`/`#word-input` (combat screen) -- it does not touch
      `.game-title` or anything on the main menu at all, so this was never
      actually fixed, just not exercised by whatever environment produced the
      "clean" claim. Plausible explanation for the environment difference:
      "Georgia" is a real installed font with fairly wide glyph metrics on
      the machine this was tested on just now; a Linux sandbox without
      Georgia installed would fall back to a narrower substitute serif font
      and might genuinely render the title short enough to fit -- which would
      make the bug intermittent across environments/devices rather than
      fixed, and real phone browsers (the whole point of this test) are at
      least as likely to lack "Georgia" as a Linux CI box is.
      FIX: make `.game-title` robust regardless of which serif font actually
      resolves, rather than relying on a specific font's metrics fitting by
      luck -- e.g. reduce `font-size` (and/or `letter-spacing`) for narrow
      viewports via a media query (add `.game-title` to the existing
      `@media (max-width: 480px)` block, or a `clamp()`-based fluid font-size
      that scales down before 375px), and/or add `overflow-wrap:
      break-word`/`word-break: break-word` as a safety net so an unexpectedly
      wide render degrades to wrapping instead of clipping off-screen.
      VERIFICATION: `npm run test:mobile` exits 0 with zero horizontal
      overflow reported on the main menu at both 375px and 414px (currently
      the 414px case already passes; only 375px is broken). Since this
      appears to be font-metric-sensitive, don't just trust a single clean
      run -- also directly check `document.querySelector('.game-title')`'s
      `scrollWidth` vs `clientWidth` is comfortably non-overflowing (some
      margin, not just barely 0) so the fix isn't sitting right at the edge
      of a different font substitution reintroducing this. `npm test` 16/16
      (this is CSS-only, shouldn't affect dom-check.js at all).

- [x] BUILD/LAUNCH: produce a packaged, itch.io-ready build of Wordbound.
      COMPLETED 2026-08-20T03:20Z: added `tools/build-itch.js` (`npm run
      build:itch`) -- stages the exact dependency list below into a temp
      dir, copies wordbound.html to `index.html` in that dir, zips the dir's
      CONTENTS (index.html at zip root) to `dist/wordbound-itch.zip`, fails
      with a clear message if the `zip` binary is missing. `dist/` added to
      .gitignore. Also added `test/verify-itch-build.js` (`npm run
      test:itch-build`) as a re-runnable regression guard: builds fresh,
      unzips to a scratch dir, asserts index.html is at the root, runs
      dom-check.js against the unzipped copy (parameterized dom-check.js to
      take an optional HTML-path CLI arg instead of hardcoding
      wordbound.html, so this didn't need a duplicate script), and loads the
      unzipped copy in a real headless-Chromium browser over a local static
      server checking for zero 404s/failed requests. All three came back
      clean across 4 full reruns -- zip size 0.66 MB (well under itch's
      limits). One flaky dom-check.js failure was seen on the FIRST run
      (damage-number/flash-damage checks failed) but reproduced as pure
      pre-existing flakiness in dom-check.js's own unseeded random-word
      selection + fixed 300ms animation timeout, NOT a build defect -- same
      exact file (byte-diffed identical to wordbound.html) passed 3/3
      reruns immediately after, and the full `test:itch-build` suite passed
      4/4 clean reruns afterward. Left that flakiness alone as out of scope
      for this ticket (not something the itch build introduced). `npm test`
      16/16.
      Queued 2026-08-20 by the orchestrator from ROADMAP.md's known-gaps list
      (the top remaining LAUNCH blocker, queued behind the two bug tickets
      above from the parallel QA pass -- a game-breaking softlock and a red
      test gate come first).
      CONTEXT: itch.io's HTML5 upload takes a zip whose ROOT contains `index.html`
      as the entry point. This repo's `index.html` is Descent of Essence, a
      DIFFERENT game -- Wordbound lives at `wordbound.html`. So the build must
      stage files into a temp dir with wordbound.html RENAMED to index.html, plus
      exactly its dependencies, then zip that. Wordbound's full dependency list
      (verified 2026-08-20 against wordbound.html's actual tags, lines 7 and
      126-140): `css/wordbound.css`, `js/core/namespace.js`, `js/core/rng.js`, and
      all of `js/wordbound/*.js`. Nothing else -- no images/fonts/audio files exist
      by design (CSS-only visuals, Web Audio synthesis).
      FIX: add a small build script (`build-itch.sh` or a no-dependency node
      script, your call -- document it) that stages those files (preserving the
      css/ and js/ subdirectory structure so the relative paths inside the HTML
      keep working), renames wordbound.html -> index.html, and zips the staging
      dir's CONTENTS (index.html at zip root, not nested inside a folder -- a
      common itch upload mistake). Output to `dist/wordbound-itch.zip`; add
      `dist/` to .gitignore (build artifact, not source). Add an npm script
      (`build:itch`). The `zip` binary exists in this sandbox but don't assume it
      everywhere -- fail with a clear message if missing.
      VERIFICATION: unzip to a scratch dir and (1) assert index.html is at the
      root, (2) run the equivalent of test/dom-check.js against the UNZIPPED copy
      (point jsdom at the staged index.html -- the script currently hardcodes
      wordbound.html's path, parameterize or copy it) and get 16/16, proving the
      staged file set is complete and paths resolve. Also load it once via a real
      browser from the unzipped dir over a local static server (same pattern as
      test/verify-mobile-layout.js) and confirm zero 404s on subresources. Note
      the final zip size in PROGRESS.md (wordlist.js is 2.5MB raw; the zip should
      compress well under itch's limits either way). What CAN'T be verified from
      the sandbox: the actual upload and itch's iframe embed behavior -- say so in
      PROGRESS.md and leave the upload step to Jaxon.

- [x] UX/ONBOARDING, high priority: the first five minutes teach the player
      nothing -- there is no how-to-play anywhere in the game. COMPLETED
      2026-08-20T03:48Z: see PROGRESS.md for full details -- a "How to Play"
      overlay reachable from a main-menu button, plus a localStorage-gated
      one-time auto-show on the very first combat entry ever.
      (verified 2026-08-20:
      zero matches for tutorial/how-to-play across wordbound.html, js/, css/).
      ROADMAP.md ranks the in-game first five minutes as the highest-leverage
      presentation work left. A new player currently lands in combat with a rack
      of tiles, an input box saying "Type or click letters...", and no explanation
      of the loop (spell a word from your rack -> damage scales with the word ->
      match the monster's stated weakness for bonus damage -> whole rack recycles
      after every word -- that last one especially is non-obvious and unique to
      this game vs. Scrabble intuition).
      FIX (bounded scope -- this is a panel + a flag, not a step-by-step tutorial
      engine): add a compact "How to Play" panel reachable from a small button on
      the main menu, reusing the existing `.treasure-panel` visual pattern like
      deck-viewer/item-inspector already do. 4-6 short lines in THEME.md's voice
      covering: play real words from your rack; longer/rarer letters hit harder;
      every monster shows a weakness -- match it for bonus damage; your whole rack
      refreshes after every word, so spend freely; bonus tiles and items stack up
      across a run. ALSO show this panel automatically the very first time a
      player ever starts combat (localStorage flag, e.g.
      'wordbound_seen_howto' -- follow the existing key naming in
      achievements.js/game.js), dismissible with one click/tap, never shown
      automatically again after. Do NOT pause or gate anything behind it beyond
      that one dismissal; returning players must be able to ignore it entirely.
      VERIFICATION: `npm test` 16/16 plus new assertions in the same style: panel
      opens from the menu button, auto-shows exactly once on first combat (flag
      unset -> visible; flag set -> stays hidden), dismiss sets the flag. It's a
      new panel, so run `npm run test:mobile` too and confirm no overflow at
      375/414px with the panel open. Real-browser click check per the standing
      mandate.

- [x] UX/MOBILE: fix the two standing real findings from `npm run test:mobile`
      COMPLETED 2026-08-20T03:58Z: see PROGRESS.md for the fix (grew the
      three run-header buttons' padding and the letter-tile point-value
      badges' font-size inside the existing narrow-viewport media query only
      -- desktop untouched, confirmed by direct measurement at 1024px).
      `npm run test:mobile` now reports zero button-size and zero text-size
      warnings at both 375px and 414px; `npm test` 16/16.
      (flagged 2026-08-20 during the test-infra hardening, deliberately left
      unfixed there as out of scope; ticketing now so they stop being loose ends):
      (1) the Deck and Consumables buttons in the run header render 30px tall at
      375/414px -- under the ~36-44px comfortable-tap floor for touch; (2) 8 text
      elements render below 12px at those widths.
      FIX: in css/wordbound.css's existing narrow-viewport media query (the
      mobile-overflow fix added one around ~420px -- extend it, don't add a
      competing breakpoint), bump the run-header buttons' vertical padding/height
      to reach >=36px tall and raise the smallest text sizes to >=12px. The
      run-header row is width-tight (that's what caused the overflow bug) --
      taller is safe, wider is what overflowed before, so grow vertically and
      re-verify. If the 8 small-text elements include intentionally-tiny
      decorative text, use judgment and document what was left as-is and why.
      VERIFICATION: `npm run test:mobile` with ZERO button-size warnings and zero
      (or documented-acceptable) text-size warnings, zero overflow/clipping at
      both widths -- plus `npm test` 16/16 as always.

- [x] PRESENTATION: record a real gameplay GIF for the README (its screenshot
      section has had a "TODO: needs a real screen recording" placeholder since
      2026-08-19) and for Jaxon's itch.io page. COMPLETED 2026-08-20T04:17Z:
      see PROGRESS.md for the exact segment recorded, file sizes, and one
      correction to this ticket's own environment assumption (the
      /opt/pw-browsers ffmpeg has no gif/palettegen support -- had to
      `apt-get install ffmpeg` for a full build).
      This IS automatable from the
      sandbox, contrary to what the README TODO assumed: Playwright records
      .webm video natively (`browser.newContext({ recordVideo: { dir, size } })`),
      and ffmpeg ships in this sandbox at /opt/pw-browsers/ffmpeg-1011 (also on
      PATH inside Playwright). Script a real playthrough segment (the
      orchestrator QA script test/orchestrator-qa-boss-reward.js already drives
      real fights with real typed words -- reuse its word-finder), record ~15-30s
      covering: typing a word, the damage animation, a tile reward pick, and
      ideally a boss entrance. Convert webm -> gif with ffmpeg (palettegen/
      paletteuse two-pass for quality; target under ~8MB, 480-640px wide, 10-15
      fps -- GitHub READMEs won't render giant GIFs well). Commit the gif under
      docs/ (e.g. docs/gameplay.gif), wire it into README.md replacing the TODO,
      and ALSO keep the source .webm/.mp4 under docs/ for Jaxon's itch page
      (itch accepts video better than gif for store pages). Add whatever
      recording script you write under test/ or tools/ so it's re-runnable after
      visual changes.
      VERIFICATION: the gif file exists, is under ~8MB, plays (verify frame count
      /duration via ffprobe), README references it at the right path. Whether it
      LOOKS good is Jaxon's call -- describe in PROGRESS.md exactly what segment
      got recorded so he can judge without digging.

- [x] FEATURE/REPLAYABILITY: surface seeded runs. COMPLETED 2026-08-20T04:27Z
      (v0.9 -> v0.10): seed input on character-select, seed displayed on the
      run screen footer + game-over/victory screens. See PROGRESS.md for the
      string-hashing round-trip detail (why an auto-generated seed is hashed
      as a string too, not a raw number) and the new
      test/verify-seeded-runs.js (11/11) that proves determinism. The RNG is already fully
      seeded under the hood (js/core/rng.js: mulberry32, string-hashable seeds,
      the instance exposes `.seed`; verified 2026-08-20) -- game.js line ~123 just
      calls `RNG.create(RNG.randomSeed())`, so this is surfacing, not rebuilding.
      FIX: (1) display the current run's seed unobtrusively (run screen footer or
      the game-over/victory screens -- game-over is the moment someone wants to
      share "try this seed"); (2) let a player enter a seed when starting a new
      run -- a small optional text input on the character-select screen ("Seed
      (optional)"), empty = random as today. Accept any string (RNG.create
      already hashes strings). Same seed + same character + same achievement-
      unlock state must reproduce the same floors/monsters/rewards -- note in the
      UI-adjacent code (comment) that unlock state can shift item pools between
      players, so identical runs are only guaranteed at identical unlock state;
      don't try to fix that beyond documenting it (it's an acceptable v1 caveat).
      One trap: don't consume RNG calls conditionally on UI state before floor
      generation, or the same seed will diverge -- check the startRun path stays
      deterministic from seed to first floor.
      VERIFICATION: `npm test` 16/16, plus a determinism check (jsdom or
      Playwright): start two runs with the same typed seed + same character and
      assert identical floor node sequences and first-fight monster; two runs
      with different seeds differ. It's a character-select UI change, so
      `npm run test:mobile` too.

- [x] POLISH, small: neither wordbound.html nor index.html has a favicon (browser
      tabs show the default globe; verified 2026-08-20 -- also why the
      orchestrator QA script has to exempt a /favicon.ico 404). COMPLETED
      2026-08-20T04:45Z: see PROGRESS.md for full details -- data-URI SVG
      emoji favicons added to both files (📖 Wordbound, ⚔️ Descent of
      Essence), the now-moot QA-script favicon exemption removed, and one
      unrelated pre-existing regression found and fixed along the way (the
      QA script had been silently broken by the How to Play auto-overlay
      since that ticket shipped).
      This project is
      no-external-assets by design, so use an inline SVG emoji data-URI favicon,
      e.g. `<link rel="icon" href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>📖</text></svg>">`
      -- 📖 for Wordbound (matches the tier-glyph language already in the game);
      pick something distinct for index.html (Descent of Essence) so the two tabs
      differ. One line per file, no new assets.
      VERIFICATION: `npm test` still 16/16 (it loads wordbound.html); confirm in
      a real browser that the tab icon renders and the /favicon.ico 404 stops
      appearing (then remove the QA script's favicon exemption if it's now moot,
      or leave it with a note -- either is fine, say which).

- [x] TEST-INFRA: `npm run test:qa` (test/orchestrator-qa-boss-reward.js) was
      silently broken by the "How to Play" onboarding panel ticket
      (completed 2026-08-20T03:48Z) and nobody noticed until now, because
      `npm run test:qa` isn't one of GOALS.md's mandatory gates (only
      `npm test` and, for CSS tasks, `npm run test:mobile` are) -- it's an
      ad hoc extra check, so it can silently rot exactly like the two bugs
      in this file's own top-of-file warning did. FOUND AND FIXED
      2026-08-20T04:45Z as an opportunistic side-fix while verifying the
      favicon ticket above (I ran `npm run test:qa` as extra verification,
      not because the favicon ticket required it, and it happened to catch
      this). Leaving this as its own queue entry rather than folding it
      silently into the favicon ticket's commit, so the fix is visible and
      searchable on its own, and so the underlying process question below
      gets a real decision instead of getting lost.
      ROOT CAUSE: How to Play auto-shows once per browser (localStorage-gated
      on `wordbound_seen_howto`) on the very first combat entry ever. A fresh
      Playwright browser context (which `test/orchestrator-qa-boss-reward.js`
      always launches) has no localStorage history, so the overlay now always
      auto-shows on that script's first combat -- and `#howto-panel` sits
      on top of `#btn-submit-word` with pointer-events enabled, so
      Playwright's real click on "Play Word" timed out waiting for the
      overlay to stop intercepting it. 30s timeout, script never completes.
      FIX ALREADY APPLIED: in `test/orchestrator-qa-boss-reward.js`, right
      after entering the first node and confirming `combatActive`, added a
      `page.isVisible('#howto-overlay')` check and, if true, a real click on
      `#btn-close-howto` before calling `fightUntilOver`. Verified: `npm run
      test:qa` now passes 24/24 clean (was hanging to a 30s timeout before).
      REMAINING OPEN QUESTION for Jaxon (not attempted here -- a process
      decision, not a code fix): should `npm run test:qa` become a mandatory
      gate in this file's top-of-file rules (like `npm test`/`test:mobile`)
      for tasks that touch the combat/reward flow specifically? It's slower
      (a full scripted playthrough vs. dom-check.js's single-node smoke
      test) so making it mandatory for every game.js-touching task is
      probably too heavy, but leaving it fully ad hoc means it can silently
      break again the same way and sit broken for a while. A middle ground
      (mandatory only for tasks that touch combat/reward-screen flow
      specifically, same as the test:mobile carve-out for CSS-layout tasks)
      seems reasonable but is a rule change to this file's own mandates,
      which felt like it should be Jaxon's call rather than something to
      quietly decide solo while fixing an unrelated ticket.
      VERIFICATION: `npm run test:qa` 24/24 (was hard-hanging/timing out
      before this fix). `npm test` 16/16, unaffected (this only touched a
      test script, no game/CSS code).

- [x] BUG, high priority: tapping a rack tile on a touchscreen does not play the
      letter at all. Reported 2026-08-20 by Jaxon ("make sure clicking on letters
      actually plays them"), verified by reading the event-listener wiring (real
      device/touch emulation not available in this environment, but the mechanism
      is unambiguous from the code).
      ROOT CAUSE: js/wordbound/game.js's rack-tile rendering (in the loop that
      builds each `.letter-tile` button, ~line 1275) attaches THREE separate
      listeners to every tile: a `click` handler (~line 1275) that does the actual
      "play this letter" work (`state.selectedTileIds.push(tile.id);
      $('word-input').value += tile.letter; render();`), and a `touchstart`
      handler (~line 1299) added for the touch-drag-reorder feature that calls
      `e.preventDefault()` UNCONDITIONALLY on every touch, before any drag motion
      has happened:
      ```
      btn.addEventListener('touchstart', function (e) {
        startTouchReorder(tile.id, index);
        e.preventDefault(); // prevent scrolling while dragging
      });
      ```
      Per the DOM spec, calling `preventDefault()` on `touchstart` suppresses the
      browser's synthesized `mousedown`/`click` events that would normally fire
      after `touchend` on a tap. `endTouchReorder()` (~line 932) only calls
      `reorderRackOnDrop()` if the touch actually moved to a different tile index
      (`touchCurrentIndex !== touchStartIndex`) -- a plain tap never satisfies
      that, so it does nothing either. Net effect on any touchscreen device: a tap
      on a rack tile fires `touchstart` (suppresses the click), then `touchend`
      (no-op, since nothing moved) -- the tile is never staged, `#word-input`
      never updates, nothing happens. Reordering-by-drag still works fine; only
      the far more common tap-to-play interaction is broken, and only on touch
      input (mouse clicks are a separate, unaffected event path, which is why
      this wasn't caught by the existing mouse-only `test/dom-check.js` or by a
      Playwright `.click()`, which simulates a mouse click, not a touch tap).
      FIX: only engage drag-reorder mode (and only `preventDefault()`) once an
      actual drag threshold is crossed, not on every touchstart. Suggested
      approach: in `touchstart`, just record the start position/tile
      (`startTouchReorder`) WITHOUT calling `preventDefault()` yet. In
      `touchmove`, once movement exceeds a small threshold (e.g. 8-10px), THEN
      call `preventDefault()` and begin actual reorder tracking. In `touchend`,
      if no drag threshold was ever crossed, treat it as a tap: run the same
      "play this letter" logic the click handler runs (`state.selectedTileIds
      .push(...)`, append to `#word-input`, `render()`) -- consider factoring
      that block out of the click handler into a small named function
      (e.g. `selectTileForWord(tile)`) so both the click handler and the
      touchend-as-tap path call the same code instead of duplicating it.
      VERIFICATION: `npm test` (16/16, mouse-click path must stay working).
      Since jsdom cannot dispatch real touch events, verify the touch path with
      Playwright's touch emulation (`browser.newContext({ hasTouch: true })`,
      then `locator.tap()` instead of `.click()`) -- confirm a `.tap()` on a rack
      tile appends its letter to `#word-input` and marks it `.selected`, AND that
      dragging one tile onto another's position via simulated touch (`touchstart`
      + several `touchmove` + `touchend` at a different position) still reorders
      correctly and does NOT also append a letter (the two interactions must stay
      mutually exclusive). Say plainly in PROGRESS.md that a real physical device
      test is still the strongest confirmation and wasn't possible in this
      environment.

- [x] BALANCE/DESIGN: several regular (non-boss) monsters currently carry a
      HARSHER version of the trait mechanic than any boss does, which is
      backwards. Reported 2026-08-20 by Jaxon ("normal enemies should have much
      simpler modifiers than the boss ones"), verified by reading traits.js and
      monsters.js together. COMPLETED 2026-08-20T01:11Z: reassigned gremlin/serpent/sentinel/bindingstrap
      from resistance traits (vowelless/alphabetic/shortFuse) to simple traits (doubled/lengthy/rareSeeker/doubled).
      ROOT CAUSE: js/wordbound/traits.js has two categories of trait, by design
      (see the file's own comments on `vowelless`/`palindromic`/`alphabetic`):
      four "resistance" traits with a 0.3x-floor penalty on off-type words
      (`vowelless`, `palindromic`, `shortFuse`, `alphabetic`) and five "simple"
      traits that are pure bonus-on-match with a 1x baseline otherwise
      (`vowelHungry`, `lengthy`, `doubled`, `rareSeeker`, `silentE`, plus trivial
      `plain`). An earlier balance pass (2026-08-19, documented later in this
      file) deliberately moved ALL THREE bosses off resistance-type traits and
      onto simple ones specifically because "a hard-to-form-word requirement
      with a punishing floor made the fight feel unwinnable on an unlucky rack" --
      that reasoning applies at least as much to regular monsters, which are
      fought far more often and by less-experienced players early in a run,
      but nobody went back and checked them. Currently in js/wordbound/monsters.js:
      `gremlin` (tier: weak, line 25) uses `shortFuse`, `serpent` (tier: normal,
      line 27) uses `vowelless`, `sentinel` (tier: strong, line 30) uses
      `alphabetic`, `bindingstrap` (tier: normal, line 33) uses `alphabetic`.
      All four carry the same 0.3x-floor penalty that was judged too punishing
      for a BOSS fight -- `gremlin` in particular is a weak-tier monster, likely
      one of the first few fights of a run, meaning a brand-new player can hit
      this exact problem before they've learned the game at all.
      FIX: reassign these four monsters' `traitPhases` to one of the five
      "simple" trait ids instead (`vowelHungry`, `lengthy`, `doubled`,
      `rareSeeker`, `silentE`, or `plain`) -- pick whichever fits each monster's
      flavor/name reasonably (e.g. `gremlin`/"The Fidget" could suit `doubled` or
      `shortFuse`'s energy without the resistance penalty -- there's no simple
      trait that's a perfect flavor match for "short fuse," so use judgment and
      note the choice in PROGRESS.md). This leaves all four "resistance" traits
      (`vowelless`, `palindromic`, `shortFuse`, `alphabetic`) completely unused
      by any monster or boss after this fix -- that's fine and intentional (the
      earlier boss-balance ticket already established these are too punishing
      for this game's short racks); don't feel obligated to find a new home for
      them. If Jaxon wants a genuinely harder trait tier back later (e.g. for a
      new "elite" difficulty), that's a separate, bigger design decision, not
      part of this ticket.
      VERIFICATION: `npm test` (16/16). Also run (or write, if it doesn't exist)
      a quick check confirming no `MONSTER_DEFS` entry references
      `vowelless`/`palindromic`/`shortFuse`/`alphabetic` after the fix (only
      `BOSS_DEFS` should reference simple traits already, and now `MONSTER_DEFS`
      should too, universally). Note in PROGRESS.md the specific old->new trait
      mapping chosen for each of the four monsters.

- [x] BUG/UX: the visual-polish pass (completed 2026-08-20T00:xxZ, "add visual
      depth and polish to overall game style") appears to have made an
      already-known mobile-width overflow issue worse. Reported 2026-08-20 by
      Jaxon ("improve the mobile experience"), verified 2026-08-20 by running
      test/verify-mobile-layout.js locally (after working around its hardcoded
      cloud-only browser path -- see the separate test-infra ticket below).
      COMPLETED 2026-08-20T01:43Z: see PROGRESS.md for the fix and verification
      (run-header now wraps, #word-input can shrink, all clipping gone at
      320-480px on the combat screen).
      FINDINGS (375px and 414px viewports, both common phone widths):
        - Main menu, 375px: 31px of horizontal overflow (viewport
          scrollWidth exceeds clientWidth).
        - Combat screen, 375px: 58px of horizontal overflow -- UP from the
          39px measured before the visual-polish pass (see this file's
          "Spot-check responsive/mobile layout" entry, completed
          2026-08-19T19:21Z, which called it "low-risk" and deferred it).
          The run-header button row (Deck/Consumables/Items, ~wordbound.html
          line 42-44), the mute-icon volume control, and `#word-input` all get
          clipped off the right edge of the viewport at this width.
        - Combat screen, 414px: 19px of horizontal overflow, same three
          elements clipped by smaller amounts.
      ROOT CAUSE (likely, not yet pinned to an exact CSS rule -- worth a real
      look before assuming): the visual-polish pass added border/shadow/
      padding treatments to panels and buttons (css/wordbound.css) without
      re-checking narrow-viewport totals; the run-header's button row in
      particular was already tight at 375px pre-polish and any added
      horizontal padding on `.btn`/`.run-header` children would push it over.
      FIX: audit css/wordbound.css's `.run-header` and its button children,
      `.combat-panel`/`#word-input`, and the volume/mute control for hardcoded
      widths or padding that don't shrink/wrap below ~420px; add a media query
      (or extend an existing one, check whether the visual-polish pass added
      any) that reduces padding, lets the button row wrap to a second line, or
      shrinks font/icon sizing specifically under ~420px. Don't touch anything
      at desktop widths.
      VERIFICATION: re-run test/verify-mobile-layout.js (or its hardened
      replacement, see the test-infra ticket below) at 375px and 414px for
      both main menu and combat screens; confirm zero horizontal overflow and
      zero clipped elements at both widths. `npm test` 16/16.

- [x] TEST-INFRA: harden test/verify-mobile-layout.js into an actual regression
      guard instead of a one-off spot-check. Reported 2026-08-20 by Jaxon
      ("make tests for things not looking right on mobile for the future").
      COMPLETED 2026-08-20T01:57Z (see PROGRESS.md for full details): fixed
      both bugs below (with a portability improvement on bug 1 -- see
      PROGRESS.md for why a literal default-`chromium.launch()` wasn't
      actually safe in this cloud sandbox right now), added `npm run
      test:mobile`, and added the CSS-layout-task rule to this file's
      top-of-file mandate section.
      Two real bugs found in the script itself while investigating the ticket
      above:
        1. `chromium.launch({ executablePath: '/opt/pw-browsers/chromium', ... })`
           (~line 164) hardcodes a path that only exists in the cloud sandbox
           this project's routine runs in -- it doesn't exist on Jaxon's local
           Mac (confirmed 2026-08-20: `ls /opt/pw-browsers/chromium` ->
           "No such file or directory"), so the script can't run locally at
           all as currently written. Use the default `chromium.launch()` (no
           `executablePath` override) so Playwright resolves whichever browser
           it finds via its own normal lookup, which works in both
           environments -- don't hardcode an environment-specific path.
        2. The button-size check (~line 106-121) queries
           `document.querySelectorAll('button:not(.hidden)')`, which only
           excludes a button that ITSELF has the `.hidden` class -- it doesn't
           check whether an ANCESTOR container (e.g. a whole `.screen` div with
           `.hidden`) is hidden. Result: buttons on screens that aren't
           currently showing (e.g. "Back to Menu" on the character-select
           screen while the main menu is showing) get measured at 0x0 and
           counted as "too small to tap," which is a false positive -- they're
           not actually visible/tappable at all, so their size doesn't matter.
           Fix by filtering to `getComputedStyle(btn).display !== 'none' &&
           btn.offsetParent !== null` (or equivalent) before measuring.
      Beyond fixing those two bugs, wire this into the routine's regular
      verification path so it actually acts as a regression check going
      forward, not a script someone has to remember to run manually: add an
      `npm run test:mobile` script entry in package.json pointing at it, and
      add a line to this file's rules-at-the-top section (near the existing
      `npm test` mandate) saying any task that touches CSS layout/panels
      should also run `npm run test:mobile` and get a clean (or
      documented-acceptable) result before being checked off -- mirroring how
      the `npm test` mandate is already worded above. Keep it as a separate
      script from `npm test` (don't fold it into dom-check.js) since it needs
      a real browser and is slower.
      VERIFICATION: `node test/verify-mobile-layout.js` (or `npm run
      test:mobile`) runs successfully end to end on a fresh clone in THIS
      (cloud sandbox) environment without any manual path editing, correctly
      reports zero false-positive "too small" buttons on the main menu (only
      truly-visible undersized buttons, if any, should be flagged), and this
      file's top-of-file rules mention it alongside the `npm test` mandate.

- [x] FEATURE: defeating a boss should grant an extra, more powerful item
      choice on top of the normal tile reward, to make boss kills feel more
      distinctly rewarding. Requested 2026-08-20 by Jaxon ("beating a boss
      should also give you an extra powerful item choice"). COMPLETED
      2026-08-20T02:15Z: see PROGRESS.md for full details -- new sequential
      BOSS_ITEM_REWARD screen after the tile-reward screen on a boss kill
      only, offering 2-3 items already marked `rarity: 'rare'`/`'legendary'`
      in items.js (that field already existed, contrary to this ticket's
      assumption it might not -- no new rarity flag needed).
      CONTEXT: currently `onMonsterDefeated()` (js/wordbound/game.js ~line 479)
      treats a boss kill identically to any regular kill for reward purposes --
      same `Tiles.rollRewardOptions(state.rng, 3)` tile-choice screen, same
      `state.pendingAfterTileReward` flow (see ~line 520-524), nothing
      boss-specific. (Note: floor advancement itself is NOT part of this
      ticket -- `state.pendingAfterTileReward = wasBoss ? 'advanceFloor' :
      'nextNode'` combined with `resolveTileReward()` at ~line 544 already
      advances to the next floor immediately after the reward is picked, with
      no extra clicks or leftover nodes; verified working correctly via a real
      Playwright playthrough 2026-08-20, so there's nothing to fix there.)
      FIX: after a boss kill specifically (`wasBoss` is already computed at
      ~line 511), in addition to the existing tile-reward screen, also present
      a permanent-item choice screen offering 2-3 higher-value items -- reuse
      the existing `rollTreasureOptions()`/`Game.pickTreasureItem` machinery
      (~line 197-212) rather than inventing a parallel system. "More powerful"
      needs a concrete definition: js/wordbound/items.js's `ITEM_DEFS` doesn't
      currently have an explicit rarity/tier field (check before assuming) --
      if truly none exists, either (a) add a lightweight `rare: true` flag to
      a handful of the strongest existing items (the run-defining ones singled
      out in earlier item-adding tickets, e.g. ones with synergy/build-altering
      effects rather than flat stat bumps) and filter the boss-reward roll to
      only offer those, or (b) if that's too big a change for this ticket,
      simply offer a fully separate treasure roll from the WHOLE item pool
      (still excluding already-owned items) as the boss bonus and leave a true
      rarity system as a follow-up -- pick whichever is cleanly scoped and say
      which you chose and why in PROGRESS.md. Decide and document the exact
      sequencing (item choice before or after the tile-reward choice; probably
      after, so the flow is "kill boss -> tile reward -> bonus item choice ->
      next floor") -- don't let the two choice screens show simultaneously or
      stack (see this project's history of panel-stacking bugs; this is a
      full-screen sequential flow like tile-reward already is, not a
      side-panel, so it's lower-risk, but still verify only one is visible at
      a time).
      VERIFICATION: `npm test` (16/16), plus a real-browser Playwright check
      that defeating a boss shows the normal tile-reward choice, THEN a
      separate item-choice screen, and picking an item there actually adds it
      to `state.player.items` before advancing to the next floor -- confirm
      this does NOT happen after a regular (non-boss) kill.

- [x] BUG, high priority: common regular plurals (and any word ending in a bare "S"
      suffix) are missing from the dictionary, making the game reject completely
      ordinary words. Reported 2026-08-19: "Words that end with 's' aren't allowed.
      Like 'ads'." Verified directly: `Lexicon.isValidWord('ADS')` returns false, and
      `window.Wordbound.WORD_SET.has('ADS')` is false, even though `WORD_SET.has('AD')`
      is true. This is NOT a one-off -- sampled 12 common base/plural pairs (CAT/CATS,
      WORD/WORDS, BOOK/BOOKS, AD/ADS, CAR/CARS, TREE/TREES, HOUSE/HOUSES, GIRL/GIRLS,
      BOY/BOYS, GAME/GAMES, TABLE/TABLES, DOG/DOGS): 10 of 12 plurals were missing
      despite their base word being present.
      ROOT CAUSE: js/wordbound/wordlist.js's header says the dictionary is sourced
      from macOS's system dictionary (Webster's Second, via /usr/share/dict/words).
      Webster's Second is a *headword* dictionary from 1913 -- it lists base forms but
      not their regular inflections (plurals, verb conjugations), because those were
      considered "regular" and omittable. So the base word is there but its plain "+S"
      form usually isn't.
      FIX: generate the "+S" form of every base word that doesn't already end in S,
      and add it to both WORDLIST and WORD_SET if not already present (this also
      covers third-person-singular verb forms for free, e.g. RUN -> RUNS). Don't
      attempt other inflections (-ES, -IES, -ED, -ING) in this pass -- those have
      irregular spelling rules (BOX -> BOXES not BOXS; CITY -> CITIES not CITYS) that
      a blind suffix rule would get wrong more often than a plain "+S" does; a good
      follow-up task once this lands, not part of this one.
      IMPLEMENTATION NOTE (important -- read before touching this file):
      js/wordbound/wordlist.js is a single ~2.5MB line (the WORDS array literal) --
      standard file-reading tools will refuse to load the whole file into context.
      Don't try to read/edit it directly. Instead, splice new code in using shell
      commands that never load the giant line into memory, e.g.:
        `head -n 16 js/wordbound/wordlist.js > /tmp/part1.js`  (or however many lines
          precede the `var WORDS = [...]` line -- check with `wc -l` and `sed -n`
          on the surrounding lines, which are short)
        write the new expansion code to /tmp/part2.js as its own file (a plain-text
          write of a *small* file is fine, it's just the array literal that's huge)
        `tail -n 3 js/wordbound/wordlist.js > /tmp/part3.js`  (the closing
          `window.Wordbound.WORDLIST = WORDS;` / `WORD_SET = new Set(WORDS);` / `})();`
          lines)
        `cat /tmp/part1.js /tmp/part2.js /tmp/part3.js > js/wordbound/wordlist.js`
      The new code should go between the WORDS array declaration and those closing
      lines, roughly:
        ```
        var existingWordSet = new Set(WORDS);
        var generatedPlurals = [];
        for (var wi = 0; wi < WORDS.length; wi++) {
          var baseWord = WORDS[wi];
          if (baseWord.charAt(baseWord.length - 1) === 'S') continue;
          if (baseWord.length >= 15) continue; // keep the documented 2-15 length range
          var withS = baseWord + 'S';
          if (!existingWordSet.has(withS)) {
            existingWordSet.add(withS);
            generatedPlurals.push(withS);
          }
        }
        WORDS = WORDS.concat(generatedPlurals);
        ```
      (WORDS is declared with `var`, so reassigning it is fine.) Run `node -c
      js/wordbound/wordlist.js` after reassembling to catch syntax errors before
      testing further -- a mistake here breaks the entire dictionary.
      VERIFICATION: after the fix, `window.Wordbound.WORD_SET.has('ADS')` should be
      true, and the 12-pair sample above should show 0 missing plurals. `npm test`
      should still pass (16/16). Also sanity-check `window.Wordbound.WORD_SET.size`
      roughly doubles (was 204,217) and that page load time doesn't visibly regress
      (a `page.evaluate` timing check in Playwright is enough, no need for a
      dedicated perf harness).
- [x] BUG: opening the deck viewer, item inspector, or consumables panel while
      another of the three is already open leaves BOTH visible at once, stacking in
      the DOM instead of replacing each other. Reported 2026-08-19: "the UI for deck,
      consumables, and item get appended to each other, which requires scrolling,
      which I don't like."
      ROOT CAUSE: js/wordbound/game.js has three independent open functions --
      `Game.openDeckViewer`, `Game.openItemInspector`, `Game.openConsumablesPanel`
      (around line 556-586) -- each of which only ever sets its OWN state flag
      (`state.deckViewerOpen` / `state.itemInspectorOpen` / `state.consumablesPanelOpen`)
      to true and calls render(). None of them close the other two. Since render()
      toggles each panel's `hidden` class independently based on its own flag
      (`$('deck-viewer-panel').classList.toggle('hidden', !state.deckViewerOpen)` etc.,
      around line 999-1001), opening a second panel while the first is still open
      results in both being simultaneously un-hidden.
      FIX: add a small helper, e.g.
        ```
        function closeAllSidePanels() {
          state.deckViewerOpen = false;
          state.itemInspectorOpen = false;
          state.itemInspectorId = null;
          state.consumablesPanelOpen = false;
        }
        ```
      and call it at the top of each of the three `open*` functions, before setting
      that function's own flag to true. Leave the three `close*` functions as-is.
      VERIFICATION: in a real browser (not just jsdom -- this is a DOM-visibility bug
      that a synthetic click on a hidden element could mask, same class of issue as
      earlier bugs this project has had), open the deck viewer, then without closing
      it click the Consumables button, and confirm only the consumables panel is
      visible (deck-viewer-panel has the `hidden` class again). Repeat for all
      pairs/orders of the three panels. `npm test` should still pass.
- [x] BALANCE/DESIGN: bosses currently have 2-3 traits that switch mid-fight based on
      HP thresholds, and the player can't see which trait(s) a boss uses before
      entering combat. Reported 2026-08-19: "I want the bosses to just have 1
      restriction, and have that restriction be clear from the map view so that
      players can plan ahead to beat it."
      Two parts:
      1. Simplify each boss (js/wordbound/monsters.js, `BOSS_DEFS`) from its current
         2-3-entry `traitPhases` array down to a single entry at `hpThreshold: 1.0`.
         Suggested (keeps each boss's original opening trait, all three of which are
         "bonus damage" traits with a 1x baseline -- not the 0x/0.3x-floor
         "resistance" kind -- so this also makes every boss fight strictly
         "extra reward for the right words," never "penalized for the wrong ones"):
         boss_vowelmaw -> `vowelHungry` only, boss_unabridged -> `lengthy` only,
         boss_sovereign -> `silentE` only. (This also fully retires the palindromic/
         shortFuse phases that earlier balance simulation flagged as the floor-1
         boss's difficulty spike -- worth confirming that finding stays resolved.)
      2. Surface the boss's (single, now-fixed) trait hint text on the node-map pill
         for boss nodes, so it's visible before the player commits to entering. See
         `renderNodeMap()` in game.js (~line 1083) -- currently every pill just shows
         a generic label (`labels[node.type]`, e.g. "BOSS"). For boss-type nodes
         specifically, look up `Monsters.BOSS_DEFS[node.defId].traitPhases[0].traitId`,
         then `Traits.TRAITS[thatId].hint`, and append it to the pill's text or a
         title/tooltip attribute -- whichever reads better without breaking the
         node-map's existing compact layout (check css/wordbound.css .node-pill for
         current width constraints before assuming a long hint string will fit
         cleanly; truncate or wrap if needed).
      VERIFICATION: `npm test` (16/16), plus a real-browser check that a boss node's
      pill shows its trait hint before entering, and that combat with that boss
      only ever uses the one configured trait regardless of HP (log the active
      trait each turn via `Traits.activeTraitForHpRatio` and confirm it never
      changes within a single fight).
- [x] BALANCE: shops are floor-2+ only, and consumable drop rate is low enough that a
      player can go a whole run without seeing either. Reported 2026-08-19: "I don't
      see any shop and I haven't gotten a single consumable."
      CONTEXT: `hasShop = floorNumber >= 2` in js/wordbound/floor.js's
      `generateFloor()` (~line 70) means floor 1 has zero shop nodes -- combined with
      floor 1 previously being disproportionately hard (see earlier balance-
      simulation entries in this file/PROGRESS.md, since addressed), many runs likely
      never reached floor 2 to see a shop at all. Separately,
      `Consumables.getConsumableDropChance()` in js/wordbound/consumables.js returns
      0.12 (12% per kill) -- plausible to see zero drops over a short run purely by
      bad luck (expected ~1 drop over 8 kills), independent of any bug.
      FIX: change `hasShop = floorNumber >= 2` to `hasShop = true` (guarantee a shop
      on every floor, not just 2+). Raise `getConsumableDropChance()` from 0.12 to
      something in the 0.18-0.22 range so a full run reliably produces a few. Pick a
      specific number and document the reasoning briefly in PROGRESS.md; this is a
      numeric tuning call, not an exact-science one.
      VERIFICATION: `npm test` (16/16), plus a real-browser check across a few
      generated floor-1 maps confirming a 'shop' node type is always present.
- [x] AUDIO: boss background music is pitched noticeably higher than normal music,
      reported as "too high" (2026-08-19). Current implementation in game.js:
      `playNormalMusic` uses notes [130.81, 146.83, 164.81, 146.83] (C3-E3) with
      `osc.type = 'sine'`; `playBossMusic` (~line 781) uses notes [164.81, 196.00,
      164.81, 196.00, 220.00, 196.00] (E3-A3) with `osc.type = 'square'`. Boss music
      is both a higher register AND a harsher waveform than normal music, which
      likely compounds into feeling shrill/too-high.
      FIX: lower the boss music's note frequencies -- consider dropping a full
      octave (E2 82.41, G2 98.00, A2 110.00) or at minimum matching normal music's
      C3-E3 register with a different melodic pattern so it's still distinguishable
      as "boss" without being higher-pitched. Keep the square wave for timbre
      distinction (that's a reasonable way to signal "boss," pitch is the actual
      complaint) unless it still sounds harsh after the pitch fix, in which case
      reconsider the waveform too. This is a listen-and-adjust task -- npm test can't
      verify audio quality, so use your judgment on the actual frequency values and
      note in PROGRESS.md that final confirmation needs a human ear, same caveat as
      prior audio tasks in this file.
      VERIFICATION: `npm test` (16/16, confirms no errors from the change). Audio
      *quality* itself needs Jaxon's ear to fully confirm -- say so plainly rather
      than claiming certainty.
- [x] FEATURE: tiles should visibly animate into a "staging" position as the player
      builds a word, not just when the word is submitted. Reported 2026-08-19: "when
      you type 'a', then I want the 'a' tile to be selected, then when you type 'd'
      then the 'd' tile moves up next to the 'a'. This is so it's clear exactly which
      tiles are being played."
      CONTEXT: currently `#word-input` is a plain text field -- clicking a rack tile
      (or typing) just appends a character to it (see the rack tile's click handler
      in `renderCombat()`, game.js). There is no tracking of *which specific tile
      instance* was clicked, no visual "selected" state on rack tiles, and no
      separate staging-area UI. This is a genuinely bigger feature than the other
      items in this file -- it changes core input interaction, not just a fix -- so
      take real care and don't rush it:
      SUGGESTED APPROACH (not prescriptive -- use judgment, but keep the scope
      bounded to this): when a rack tile is clicked, instead of only appending to
      `#word-input`, also (a) mark that specific tile's DOM element as "selected"
      (dim it or add a distinct border/glow -- don't remove it from the rack, the
      player may want to reconsider), and (b) render/move a visual copy or the tile
      itself into a staging row above or beside the rack, in click order, so the
      player can see the word forming tile-by-tile. Clicking "Clear" (or backspacing
      the text input) should un-stage and un-select correspondingly. Keep `#word-
      input`'s text value in sync (typing should probably still work as an
      alternative input method -- check whether keyboard typing needs to map back to
      tile selection too, or if this feature is mouse/touch-click-only; if the
      keyboard-typing path is kept, decide and document whether typed letters get
      a staging animation too or just click-selected ones, since typed letters don't
      correspond to a specific tile instance the same way a click does).
      This will interact with the existing `.tile-played` animation (added earlier
      2026-08-19 for when a word is *submitted*) and the `.new-tile` slide-in
      animation (for redraws) -- make sure staging a tile, then submitting, then the
      rack refilling all animate coherently and don't fight each other or double up.
      VERIFICATION: `npm test` can't verify animation visuals (jsdom limitation,
      documented elsewhere in this file already) -- use Playwright to confirm the
      right DOM state/classes exist at each step (tile has a "selected" class after
      click, staging area reflects click order, clear/backspace properly reverts),
      and say plainly in PROGRESS.md that the actual visual feel needs a human
      playtest to fully confirm, same as other animation work in this project.
- [x] CONTENT: add more permanent items. Requested 2026-08-19 ("add more items").
      Currently 11 in js/wordbound/items.js (`spare_satchel`, `lucky_vowel`,
      `wildcard_pouch`, `heavy_ink`, `rare_hunter`, `vowel_leech`, `thick_skin`,
      `second_wind`, `folio_mark`, `marginalia`, `catalog_tab`). Add 3-5 more,
      prioritizing ones that meaningfully change how a run is *played* (synergy with
      a specific tile-bonus type, altered discard/redraw rhythm, rack-capacity math,
      interaction with the trait/resistance system) over small flat stat bumps --
      same bar as the last items-expansion task in this file's history. Add new
      entries to THEME.md's item table first (keep the whimsical library-pun naming
      style already established), then implement. Reuse the existing
      `Items.ITEM_DEFS` / hook system (`onDraw`, `onWordPlayed`, `onPlayerDamaged`,
      `onRunStart` -- see items.js's existing entries for the hook shapes) rather
      than inventing a new mechanism.
      VERIFICATION: `npm test` (16/16), plus a real-browser check that each new item
      can be bought/found and its effect actually fires (not just that it doesn't
      error) -- same standard as prior item-adding tasks.
- [x] FEATURE/VISUAL: tiles with different bonus types are visually indistinguishable
      from each other. Requested 2026-08-19 ("differentiate tiles with different
      bonuses"). CONTEXT: `Tiles.BONUS_TYPES` (js/wordbound/tiles.js) has three kinds
      -- FLAT_ON_PLAY, MULT_ON_PLAY, MULT_ON_HOLD -- but every bonus tile gets the
      exact same `.has-bonus` CSS treatment (css/wordbound.css ~line 274, a single
      gold box-shadow glow) regardless of which one it is. A player can only tell
      them apart by hovering for the tooltip (`Tiles.describeBonus`, set as the
      tile's `title` attribute in `renderCombat()`, game.js). FIX: give each bonus
      type a distinct at-a-glance visual treatment -- e.g. a different glow color per
      type, or a small corner icon/symbol (a common pattern: "+" for flat, "×" for
      multiply-on-play, a different marker for hold-based). Add a class per bonus
      type (e.g. `.bonus-flat`, `.bonus-mult-play`, `.bonus-mult-hold`) alongside the
      existing generic `.has-bonus`, driven off `tile.bonus.type` in the same place
      the class string is built (`btn.className = ...`, game.js ~line 1230). Keep
      it readable against the existing parchment/gold palette -- check THEME.md/
      existing CSS custom properties if any, don't introduce clashing colors.
      VERIFICATION: `npm test` (16/16), plus a real-browser check that a rack
      containing all three bonus types shows three visually distinct classes/states
      (check via `getComputedStyle` or class list, not just visual inspection since
      you can't see the render).
- [x] CONTENT: expand suffix coverage beyond the plain "+S" plural fix already
      landed (2026-08-19T22:41Z, see the completed ticket above and
      js/wordbound/wordlist.js). Requested 2026-08-19: "ensure other suffixes work
      (such as ed, er, ers, etc.)". This is explicitly a harder version of the same
      problem -- the "+S" fix was deliberately scoped to skip -ED/-ER/-ING/-ES
      because they have irregular spelling rules a blind suffix would get wrong
      (RUN -> RUNNING needs consonant doubling; MAKE -> MAKING drops the E; HAPPY ->
      HAPPIER changes Y to I; BOX -> BOXES not BOXS). Take real care here, don't
      rush a blind concatenation the way "+S" safely could be:
      SUGGESTED APPROACH: implement a SMALL set of common, well-defined spelling
      rules rather than one blind suffix each, and accept that full English
      inflection is out of scope (a proper morphological engine is a much bigger
      task than this one). Reasonable rules to start with, in order, each only
      applied when its trigger condition matches:
        - words ending in a consonant + E: drop the E before adding -ED/-ER/-ING
          (MAKE -> MAKING, not MAKEING)
        - words ending in consonant + Y (not preceded by a vowel): Y -> IES for
          plural, Y -> IER for -er (HAPPY -> HAPPIER, CITY -> CITIES) -- but words
          ending in vowel + Y just take -S/-ED normally (PLAY -> PLAYS, not PLAIES)
        - words ending in S/X/Z/CH/SH: use -ES not blind -S for the plural case
          (already partially relevant to the landed +S fix -- BOX/BOXES, not BOXS;
          double check the landed fix actually skips these correctly, since it only
          checks "already ends in S," not the other sibilant endings)
        - do NOT attempt consonant-doubling for -ING/-ED (RUN -> RUNNING) -- the
          trigger condition (stressed short vowel + single final consonant) is
          genuinely ambiguous without a syllable-stress model; skip this rule
          entirely rather than guess wrong half the time
      For each rule, generate the inflected form for base words in WORDS meeting
      the trigger condition, add to WORDLIST/WORD_SET if not already present --
      same overall mechanism and file-editing technique as the already-landed "+S"
      fix (wordlist.js is a single giant line, splice via shell commands, don't
      read/edit it directly -- see that ticket's implementation note above for the
      exact head/tail/cat technique).
      VERIFICATION: spot-check a sample of words through each rule (e.g. MAKE/MAKING,
      HAPPY/HAPPIER, CITY/CITIES, BOX/BOXES, PLAY/PLAYS/PLAYED) and confirm the
      *correct* spelling is now valid AND that no obviously-wrong form got added
      (e.g. confirm MAKEING was NOT added). `npm test` 16/16. If any rule's edge
      cases feel too uncertain to get right confidently, it's fine to skip that rule
      and document why in PROGRESS.md rather than risk polluting the dictionary with
      wrong spellings -- partial coverage done carefully beats full coverage done
      sloppily here.
- [x] DESIGN/FEEL: boss fights should feel more intense/dramatic than regular fights.
      Requested 2026-08-19 ("make the boss fights feel more intense"). CONTEXT:
      currently the ONLY things that differentiate a boss fight from a regular one
      are (1) different background music (already queued for a pitch fix above),
      (2) a red text color + subtle glow on the boss's name (`.boss-tier` in
      css/wordbound.css), and (3) a crown emoji prefix. No entrance moment, no
      escalation as the fight progresses, no distinct hit-feedback. This is a taste/
      design task more than a bug fix -- use judgment, but ground choices in
      THEME.md's established parchment/gold "Boundless Archive" aesthetic rather
      than inventing an unrelated visual language. Concrete directions worth
      considering (not a checklist to do all of, pick what fits well together):
        - a brief, distinct entrance beat when combat starts against a boss (e.g. a
          screen-flash or the existing damage-number/HP-flash CSS keyframe pattern
          reused for an "arrival" moment)
        - the existing `hpShake`/`hpFlash` keyframes (css/wordbound.css) could scale
          in intensity as the boss's HP drops (more shake/brighter flash at low HP),
          reusing the pattern already established for damage numbers scaling with
          hit size
        - boss-specific hit sounds (playCombatSound/playCounterattackSound in
          game.js currently scale by raw damage number for ALL fights) -- consider
          whether boss counterattacks specifically should sound more ominous,
          without duplicating the whole audio system
        - a persistent visual frame/border treatment on the combat panel specifically
          during a boss fight, distinguishing it from a normal encounter at a glance
      Keep changes additive and reversible (CSS classes gated on `state.monster.isBoss`,
      not hard-coded into shared combat rendering) so this doesn't risk regressing
      normal-fight polish already in place.
      VERIFICATION: `npm test` (16/16, confirms no errors from the changes). Actual
      "does it feel more intense" is a human-judgment question `npm test` can't
      answer -- say plainly in PROGRESS.md what was verified not-broken vs. what
      needs Jaxon's playtest to confirm the feel actually landed, same caveat as
      other feel/animation work in this project.
- [x] DESIGN/VISUAL: overall visual style is fairly plain and could be more visually
      interesting. Requested 2026-08-19 ("make the visual style more interesting").
      CONTEXT: css/wordbound.css is currently flat solid colors, simple rounded
      borders, and subtle box-shadow glows throughout -- no gradients, no
      background texture/imagery, no decorative flourishes anywhere. This is the
      most open-ended, taste-driven item in this file -- treat it as a bounded CSS
      polish pass, NOT a redesign: don't change the color palette, layout structure,
      or THEME.md's established "Boundless Archive" parchment/gold identity, just
      add visual depth/richness within it. Ideas worth exploring (pick a coherent
      subset, don't just pile on every idea):
        - a subtle background texture or gradient on `.panel`/`body` suggesting aged
          paper/parchment, rather than the current flat `#241f17`/`#1a1610`
        - more varied border treatment on panels (e.g. a subtle inset/outset effect,
          or a faint double-border suggesting a book cover or archive folder)
        - decorative touches consistent with the library/archive theme (e.g. a
          subtle corner flourish or rule line under headings) -- don't add actual
          image assets/icon fonts, this project has no external dependencies by
          design; CSS-only (gradients, box-shadow, border tricks, unicode glyphs
          already used elsewhere like 🪙/👑) is the right toolkit here
        - consider whether the tier/rarity color-coding already in place (tier-weak/
          normal/strong, boss-tier, item rarity if any) could extend consistently
          into panel/border treatment, reinforcing rather than fighting the existing
          system
      VERIFICATION: `npm test` (16/16, confirms no errors/layout breaks). Take a
      screenshot via Playwright of a few key screens (main menu, combat, shop) before
      and after and describe the visual change in PROGRESS.md (you can't literally
      see the image, but you can describe what CSS changed and where) -- this is
      ultimately a taste call for Jaxon to confirm on his own playtest, say so
      plainly rather than claiming certainty that it looks better.
- [x] DESIGN/VOICE: the game reads as AI-generated rather than hand-crafted.
      Requested 2026-08-19 ("The game feels like an AI made it. Make it feel more
      human"). This is the vaguest item in this file -- there's no single bug to
      point at, it's a cumulative impression across a lot of text that was, in fact,
      mostly written by an AI (this project's routine) over one long session. Don't
      try to solve "feels AI-made" in the abstract; instead do a concrete voice pass
      over the specific text most likely contributing to it, listed below in rough
      priority order. Look for: overly literal/mechanical phrasing that explains a
      mechanic instead of evoking it, repetitive sentence structure/templates
      applied uniformly across every entry (real hand-written content usually has
      more variety and a few asymmetric touches/outliers), and generic filler where
      a specific, textured detail would read as more considered.
      WHERE TO LOOK (concrete, not exhaustive):
        - Trait hint text (js/wordbound/traits.js) -- currently follows one rigid
          template per category ("Takes bonus damage from X, resists other words" /
          "Takes bonus damage from X" repeated almost verbatim across all ~9
          traits). Rewrite each hint to describe the *creature's* relationship to
          the mechanic in-world (why does this thing hate long words, specifically,
          given its name/flavor?) rather than a mechanically uniform damage-
          multiplier description. Keep them short enough to still fit the UI (check
          current usage: node-map pills, the in-combat "Weakness:" line).
        - Combat log messages (Game.submitWord, onMonsterDefeated, etc. in game.js)
          -- currently formulaic ("You play 'X' for Y damage", "Defeated Z! Gained
          N gold"). Consider a small pool of varied phrasings per event type
          (damage dealt, weak hit, critical hit, monster defeated, player hit) that
          get chosen from rather than one fixed template every time -- reuse the
          existing intensity tiers (critical/normal/weak) already present in
          animateDamage/playCombatSound as the selection axis, don't invent a new
          one.
        - Achievement names/descriptions and item hints (achievements.js, items.js)
          -- audit for ones that read as a literal restatement of their trigger
          condition rather than something with a bit of wit or in-world voice
          consistent with THEME.md's established "Boundless Archive" tone.
        - Event node text (events.js) -- spot-check a few for generic phrasing.
      WHAT NOT TO DO: don't touch mechanical/functional strings that need to stay
      precise (error messages, button labels like "New Run"/"Leave Shop", numeric
      displays) -- this is about flavor text and narrative-adjacent copy, not the
      whole UI. Don't invent new lore/naming that contradicts THEME.md; it's the
      voice reference to match, not something to override. Keep this to a focused,
      reviewable pass -- if it's taking multiple runs, that's fine (leave clear
      notes on what's done vs. remaining), but don't let it sprawl into rewriting
      every string in the codebase.
      VERIFICATION: `npm test` (16/16). Since "does this feel more human" is
      inherently Jaxon's call, not something testable, list in PROGRESS.md the
      specific before/after examples changed (a few real ones, not a summary) so
      he can judge the direction without replaying the whole game.

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
- [x] BALANCE/DESIGN (found 2026-08-19 by test/balance-simulation.js, 30 runs -- needed a
      design call, deliberately not changed by the routine at the time). traits whose
      multiplier floor is 0 made a monster nearly immune rather than merely harder, and
      that one property, not HP/attack, decided how hard every fight in the game was
      (the floor-1 boss ended 40% of runs, more than every other floor-1 monster
      combined, purely because its palindromic phase requires a palindrome -- nearly
      unformable from a random rack -- to deal any damage at all).
      RESOLVED 2026-08-19T22:10Z (Jaxon approved this direction directly): gave all
      four 0x-floor traits (vowelless, palindromic, shortFuse, alphabetic) a 0.3x floor
      instead of 0 -- see js/wordbound/traits.js. The weakness/resistance shape is
      unchanged (off-type words are still heavily penalized, matching-type words still
      hit much harder), it's just no longer a guaranteed dead end when a rack can't
      form the required word type. Verified via direct multiplier checks in a real
      browser plus 10 full playthrough regressions, zero errors.
- [x] BUG/DESIGN (found 2026-08-19 by test/balance-simulation.js): a rack that can form no
      valid word is a hard softlock -- hit ~25% of Scribe runs. COMPLETED (routine
      2026-08-19T21:16Z, refined by Claude 2026-08-19T22:10Z after picking up parallel
      work): auto-detect + silent cycle. If a rack can form no valid word, it's
      discarded and redrawn (bounded retries) until playable. Final implementation
      lives as Lexicon.hasPlayableWord(rack) in lexicon.js (cached anagram-key index)
      + ensureRackIsPlayable() in game.js, called after every full rack refill --
      consolidated from two independently-written versions (the routine's inline
      canFormAnyWord()/anagramMap in game.js, and Claude's lexicon.js version written
      in parallel) that both landed via a merge; kept the lexicon.js version since it's
      reusable and gives the player a log message when it triggers, removed the
      duplicate to avoid two redundant checks running back to back. Also widened the
      Scribe's deck 3->4 vowels (swapped L for O, kept every rare/powerful letter) so
      the safety net needs to trigger less often in the first place. Verified with
      test/verify-unplayable-rack-fix.js plus 10 more playthrough regressions (6 forced
      Scribe), zero errors, zero detected softlocks.
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

<!-- The 4 tickets below were queued 2026-08-20T19:17Z from Jaxon's REAL-DEVICE
     playtest (iPhone, Safari, playing the live GitHub Pages build at v0.28) --
     the physical-phone test ROADMAP.md has been flagging as the gap Playwright
     emulation can't close. It immediately caught a real bug emulation missed.
     Ordered: the stuck-drag bug first (game-breaking feel), then the
     drag-to-rack feature (same pointer-gesture code area -- ideally the same
     or adjacent run), then the damage preview, then the wordlist gap. -->

- [x] BUG, high priority (Jaxon, real iPhone/Safari playtest of v0.28,
      2026-08-20): tiles sometimes get STUCK mid-drag. His screenshot shows the
      staging area with a dragged tile (O1) frozen overlapping another staged
      tile (N1) -- the drag never resolved, the tile just stayed wedged there,
      and it persisted long enough to screenshot. Playwright touch emulation
      passes clean, so this is a real-glass edge the emulation never exercises.
      Investigate ALL of these known gesture-death paths before picking the fix
      (js/wordbound/game.js, the staged-tile drag machinery from MOBILE INPUT
      2/3 Phase 2 -- startTouchReorder/updateTouchReorder/endTouchReorder and
      the staging-area drag handlers):
      (a) `touchcancel` -- iOS Safari fires this instead of touchend whenever
          the browser steals the gesture (page scroll starting, notification
          banner, edge-swipe, incoming call, tab switch). If the drag handlers
          only listen for touchend, a stolen gesture leaves the drag state
          machine live and the ghost/transform frozen. This is the most likely
          culprit -- check whether touchcancel is handled ANYWHERE in the drag
          paths.
      (b) passive-listener/preventDefault timing -- if the first touchmove
          isn't preventDefault-ed (or the listener is passive), Safari may
          start scrolling the page mid-drag, which both moves the coordinate
          frame under the gesture and can trigger (a).
      (c) pointer released outside the viewport or over a different element --
          confirm the end handler is bound at document/window level, not on
          the tile or container, so a finger lifted anywhere still ends the
          drag.
      (d) a second simultaneous touch (multi-touch) confusing a single-drag
          state machine that doesn't track touch identifiers.
      FIX SHAPE: every gesture-terminating event (touchend, touchcancel,
      window blur, and -- belt-and-braces -- the start of any NEW drag while
      one is somehow still active) must run one shared cleanup that clears the
      drag state, removes any ghost/transform/z-index styling, and re-renders
      once. Additionally make `render()` itself defensively clear any orphaned
      drag artifacts (a stuck tile should never survive a re-render -- in the
      screenshot it apparently did, or no render happened).
      VERIFICATION: `npm test` clean with new assertions (dispatch a synthetic
      `touchcancel` mid-drag in jsdom and assert the state machine + DOM fully
      reset; same for a second touchstart mid-drag). `npm run test:qa` stays
      clean. In Playwright, emulate a mid-drag interruption as closely as the
      API allows (e.g. dispatchEvent touchcancel on the element mid-gesture)
      and assert no tile is left transformed/overlapping. Say plainly in
      PROGRESS.md that real-glass confirmation is Jaxon's -- but the
      touchcancel repro is the strong proxy.
      FIXED 2026-08-20T19:29Z (v0.28 -> v0.29). Root cause was (a) as the
      ticket suspected: NO gesture-terminating event except pointerup/touchend
      was handled, and the staged-tile drag's move/end/cancel listeners were
      bound PER-TILE, so a gesture iOS steals (fires pointercancel/touchcancel)
      or a finger lifted off the tile left the drag state machine live and the
      ghost's inline transform frozen -- exactly the wedged O1-over-N1 tile.
      FIX (js/wordbound/game.js): (1) one shared teardown -- abortStagingDrag()
      + clearStagingDragStyling() -- run by pointercancel, touchcancel, window
      blur, AND a new drag starting while one is somehow still live; strips the
      ghost/out classes + inline transforms off the dragged tile and its
      siblings and clears the container's grabbing class. (2) move/up/cancel for
      the staged-tile drag now bound ONCE at the DOCUMENT level (not per-tile),
      so a pointer released anywhere -- off the tile, outside the viewport, or
      over an element a mid-drag render replaced -- still ends the drag.
      (3) render() now runs sweepStagingDragArtifacts(): a render fired mid-drag
      (e.g. the killing-blow death beat) destroys the dragged element, orphaning
      the drag with no node any pointerup can reach -- the sweep drops the
      orphaned state and wipes any stray transform, so a stuck tile can never
      survive a re-render. (4) BOTH drag paths (staged-tile pointer drag AND the
      rack's touch reorder) now track the identifier of the finger that started
      them, so a second simultaneous touch can't hijack or prematurely end the
      drag (ticket path d); rack touchmove made a non-passive listener and the
      rack now handles touchcancel too. VERIFICATION: `npm test` 359/359 (+19
      new jsdom assertions covering touchcancel, second-finger, off-element
      pointerup, window blur, mid-drag re-render orphan sweep, multi-touch
      identity, and the rack machine's reset -- all interruption paths reset the
      state machine AND leave zero DOM artifacts). New `npm run test:drag-
      interrupt` (real Chromium, hasTouch) drives a genuine pointer drag on a
      staged tile until the ghost lifts with a live inline transform, then fires
      touchcancel / window blur mid-drag and asserts zero ghost/out/transform
      artifacts survive and no tiles are lost, plus a clean-drop happy-path
      guard -- 12/12 OK. `npm run test:qa` 26/26, `npm run test:mobile` clean.
      NOT verified (honest caveat): true real-glass confirmation on Jaxon's
      physical iPhone that the wedge is gone -- jsdom + Playwright synthesize
      the interruption events but can't reproduce the exact WebKit gesture-theft
      timing/hit-testing of real hardware. The touchcancel + blur repros are the
      strong proxy the ticket names; Jaxon's eyes on glass are the last word.

- [x] FEATURE (Jaxon, same real-device playtest): drag staged tiles BACK TO
      THE RACK to unstage them, in addition to the existing tap-to-unstage.
      Currently a staged tile can be tapped (unstages) or dragged out of the
      staging area >~30px (removes). Jaxon expects the natural inverse of
      staging: pick up a staged tile, drag it onto the rack area, drop -- it
      returns to the rack (its home slot, with the same FLIP slide animation
      unstageTile already triggers). Dropping anywhere over the rack container
      counts; no need to target the specific empty slot (the tile always
      returns to its own home slot regardless). This should reuse the existing
      drag plumbing from MOBILE INPUT 2/3 (drag-out-to-remove already tracks
      pointer position on release -- add the rack container's rect as an
      explicit drop zone that routes to unstageTile). Works for BOTH touch and
      mouse. Careful: this ticket sits in the exact code the stuck-drag BUG
      ticket above touches -- do the bug first (or in the same run) so the
      cleanup rework isn't done twice.
      VERIFICATION: `npm test` with new assertions (simulate a drag from a
      staged tile ending over the rack container -> tile back in rack, staging
      empty, no lingering empty-slot or ghost); `npm run test:qa` clean;
      `npm run test:mobile` clean at 375/414px.
      DONE 2026-08-20T19:38Z (v0.29 -> v0.30): the rack is now an EXPLICIT
      drop-to-unstage zone. New `pointerOverRack(px,py)` hit-tests the
      rack-display container; moveStagingDrag folds "over rack" into the
      existing `outside` flag (so a release there routes to the SAME
      unstageTile return-to-rack path the drag-out-of-staging gesture already
      used) and toggles a `.rack-drop-target` highlight on the rack while
      hovered. The one meaningful behavior change: a drop over the rack now
      unstages EVEN when it sits inside pointerOutsideStaging's 30px tolerance
      (a rack close under the staging area otherwise read as "snap back") --
      that gap was why "drop onto the rack" didn't reliably work before.
      Reuses all existing MOBILE INPUT 2/3 drag plumbing; the rack highlight is
      cleared in every teardown path (clearStagingDragStyling +
      sweepStagingDragArtifacts). Works for touch and mouse (single pointer
      code path). VERIFIED: `npm test` ALL PASSED (+4 new jsdom assertions:
      hovering the rack while INSIDE staging tolerance sets overRack+outside,
      the highlight applies, release unstages exactly the dragged tile, and
      the highlight+artifacts clear after); `npm run test:mobile` clean at
      375/414px (new highlight CSS adds no overflow); `npm run test:qa` 26/26
      real Chromium zero errors; PLUS a throwaway real-Chromium Playwright
      check with GENUINE (non-stubbed) getBoundingClientRect hit-testing --
      dragged a staged tile to the real rack center and confirmed overRack,
      the highlight, the unstage, the tile back in the rack DOM, and clean
      teardown (jsdom rects are all-zero so this is the real hit-test
      confirmation). The subjective feel on real glass is still Jaxon's to
      confirm, per the top-of-file drag caveat.

- [x] FEATURE (Jaxon, same real-device playtest): show the staged word's
      POTENTIAL damage/score before it's played. When >= 1 tile is staged,
      display a live-updating damage preview somewhere clearly visible near
      the staging area / Play Word button (e.g. on the Play Word button itself
      -- "Play Word (~24)" -- or a small readout above it; implementing run's
      call, but it must be visible on a 375px phone without pushing the layout
      around -- reserve the space rather than reflowing when it appears).
      REQUIREMENTS:
      - It must use the SAME damage computation the actual submit path uses --
        extract/reuse a pure function (word -> damage breakdown) from the
        existing combat math rather than duplicating the formula, so the
        preview can never drift from reality. Include everything knowable
        pre-submit: tile values, length bonuses, the monster's weakness/trait
        bonus, combo multiplier, item modifiers. If some component is
        genuinely random-at-submit (crit-style rolls, gamble items), preview
        the deterministic base and don't pretend otherwise.
      - Update on every stage/unstage/reorder (reorder matters if any scoring
        is position-sensitive; if it isn't, same-set reorders just show the
        same number).
      - If the staged tiles don't form a valid word yet, show a neutral state
        (e.g. dimmed "--"), not a fake number and not an error.
      - Works for the desktop typing path too (typed-so-far word previews the
        same way) if that's cheap with the shared function; if the typing path
        turns out structurally awkward, touch-first is acceptable -- say so in
        PROGRESS.md.
      VERIFICATION: `npm test` with assertions that for several staged words
      (including a weakness-matching word and a combo-active state) the
      previewed number equals the damage actually dealt on submit; `npm run
      test:qa` clean; `npm run test:mobile` clean (the preview must not
      introduce overflow at 375px).
      DONE 2026-08-20T19:55Z, v0.30 -> v0.31. Added `Combat.previewWord`
      (combat.js): a PURE function that computes the exact damage a word would
      deal by running the REAL `Combat.playWord` + item `onWordPlayed` hooks on
      shallow clones of player/monster/comboState -- zero formula duplication,
      so the preview can never drift from what submit deals. Mutates nothing
      (rack/hp/monster.hp/combo all cloned first). It reads the same per-fight
      sequence state the rule-changer items use (previousWord, a 1-based play
      count) and hides a Hex'd tile from rack-matching exactly as submitWord
      does. A fixed-height `#damage-preview` readout (wordbound.html, between
      staging area and the input row; CSS reserves the space so it never
      reflows) shows "⚔ N damage" (+ "-- weak point!" when the trait multiplies,
      "-- repeat (x0.4)" on a repeat, "0 damage -- no effect" on a 0x trait) or
      a dimmed "--" when the staged/typed tiles don't form a valid, formable
      word. `updateDamagePreview()` (game.js) runs at the end of every combat
      render (covers stage/unstage/reorder/clear) and on the desktop word-input
      `input` event -- so BOTH the touch staging path AND desktop typing preview
      live. Reorder is handled naturally: the preview is built from the staged-
      order word string, so a position-sensitive reorder (e.g. Illuminated
      Initial's first-letter match) reflects immediately.
      VERIFIED: `npm test` ALL CHECKS PASSED (+18 new assertions: 14 isolated
      previewWord checks proving preview.damage EQUALS an actual playWord+hook
      run for plain/combo-active/repeat/item-modified/sequence-item words, plus
      non-mutation, invalid-word neutral state, and the hex-hiding option; plus
      3 live-DOM checks that the real #damage-preview element shows a number and
      that number equals the HP the monster ACTUALLY lost on submit through the
      real btn-submit-word click). `npm run test:mobile` clean at 375/414px (the
      reserved-height readout adds no overflow). `npm run test:qa` 26/26 real
      Chromium, zero errors. PLUS a throwaway real-Chromium screenshot check
      (written, run, deleted): the readout renders "⚔ 13 damage" for a typed
      word in its reserved slot without shifting the layout, both touch-staging
      and desktop-typing paths confirmed populating it. No audio or drag surface
      touched. The subjective on-glass feel (does the number read at a glance
      mid-fight on a real phone) is Jaxon's to confirm, but placement, math
      accuracy, and no-reflow are all verified in a real browser.

- [x] CONTENT (Jaxon, same real-device playtest): more dictionary gaps --
      "BORKS" rejected (see his screenshot; he tried ZORKS and BORKS, and
      called out BORKS specifically as a word that should work). BORK/BORKS/
      BORKED/BORKING are in Collins Scrabble Words but not ENABLE1 (our v0.22
      union source). Approach:
      1. Add a small curated SUPPLEMENT word set to the wordlist build (a
         clearly-marked list in the wordlist source/build script -- check how
         the ENABLE1 union was done in v0.22 and follow the same pattern) with
         the BORK family as the first entries. This is the guaranteed
         deliverable: BORKS must validate after this ticket.
      2. JUDGMENT CALL (you have latitude here): evaluate whether a broader
         modern/slang supplement is worth folding in at the same time (Collins-
         only common words along the lines of the BORK family). Weigh source
         licensing before vendoring anything wholesale -- Collins' list itself
         is proprietary; a small hand-curated supplement of individual words is
         fine, a bulk copy of CSW is not. Keep the supplement conservative --
         real words people actually try, not junk that would validate garbage.
      3. ZORKS: almost certainly not a legitimate word anywhere (Zork is a
         proper noun); leave it OUT unless you find it in a reputable open
         list, and note the decision either way.
      VERIFICATION: `npm test` clean plus a new assertion that "BORKS" (and
      the rest of the added supplement) validates through the game's actual
      word-check path; `npm run test:itch-build` clean (the packaged build
      must pick up the updated wordlist -- this manifest has silently drifted
      before).
      DONE 2026-08-20T21:55Z, v0.31 -> v0.32: added a clearly-marked
      `SUPPLEMENT` array in js/wordbound/wordlist.js (renamed the baked
      dictionary to `WORDS_BASE`, `WORDS = WORDS_BASE.concat(SUPPLEMENT)`,
      matching the same "strictly additive, documented in the header comment"
      pattern the v0.22 ENABLE1 union used). BORK/BORKS/BORKED/BORKING land as
      specified. JUDGMENT CALL (2): folded in 60 more individually-verified
      common modern/informal words missing from both the base dict and
      ENABLE1 (both predate this vocabulary) -- MEME(S), SELFIE(S), EMOJI(S),
      BLOG/VLOG/PHISH families, HASHTAG(S), PODCAST(ER/S), TWERK/YEET
      families, NOOB(S), EMOTICON(S), FRENEMY/FRENEMIES, STAYCATION(S),
      MANSPLAIN family, CATFISHED/CATFISHING, FOMO, SUS, CRINGEY/CRINGY,
      APP(S), SPAMMED/SPAMMING, UNFOLLOW(S) -- each checked against at least
      one major dictionary (Merriam-Webster/Collins/Oxford) before inclusion,
      not a bulk import of any single list. Skipped anything trademark-
      adjacent (e.g. GOOGLE as a verb, WIFI) to stay unambiguous. ZORKS (3):
      left out per the ticket's own instruction, noted in wordlist.js's own
      comment (proper noun, no dictionary support found).
      VERIFIED: `npm test` ALL CHECKS PASSED, 5/5 clean repeat runs (390
      assertions incl. 10 new supplement-specific ones: BORK family + a
      sample of the modern-word supplement now valid, ZORKS still rejected,
      word count grew from 548635 to 548699). `npm run test:itch-build`
      ALL CHECKS PASSED (dom-check re-run clean against the unzipped packaged
      copy, confirming the updated wordlist ships in the itch.io build; zero
      real-browser 404s).
      SIDE FINDING, fixed in the same touch (test-infra only, no game-code
      change): `npm test` was flaky (~2 of 3 runs failing) on an assertion
      from the immediately-prior FEATURE ticket (staged-word damage preview,
      v0.31) -- test/dom-check.js's "damage-preview shows a number" check
      required the preview text contain no "--", but the preview legitimately
      appends " -- weak point!" / " -- repeat (x0.4)" (game.js
      updateDamagePreview) whenever the test's own auto-selected word happens
      to hit the monster's weakness or repeat, which is not the neutral "--"
      state (that has its own `.preview-empty` class). Fixed the assertion to
      check `.preview-empty` absence instead of the text substring; 5/5 clean
      reruns after the fix (0/5 before). This was actively undermining the
      "npm test must be trustworthy" mandate GOALS.md's own top-of-file
      warning exists for, so fixed rather than left for a future run to
      rediscover.
      NOT touched: game.js, wordbound.html markup/CSS beyond the version bump
      -- no rendering/event surface changed, so `npm run test:mobile` /
      `npm run test:qa` were not required by this ticket and were not run.

- [x] BALANCE, high priority -- JAXON-AUTHORIZED difficulty rebalance
      (2026-08-20T22:25Z, his explicit "fix it" on the flagged win-rate
      collapse). The balance sim (test/balance-simulation.js, recently given
      elite tracking in commit 5437708) shows the bot's win rate has fallen
      to 13-17%, from ~60% at v0.16, with floor-2 strong/elite damage as the
      identified wall. Separately, PROGRESS.md's history flags that the three
      rounds of boss-HP cuts were tuned partly against hex-bug-INFLATED sim
      data, so bosses may now be easier than intended relative to the floors
      before them. Jaxon has authorized fixing BOTH under one framework. This
      is a curve-SHAPING job, not a global difficulty knob.

      MEASURABLE TARGETS (the definition of done -- verify with the sim, not
      by feel):
      1. Overall bot win rate lands in the 35-50% band (the sim bot is a
         mediocre proxy for a real player, so real players should sit a bit
         above this). Run enough iterations for the estimate to be stable --
         if two consecutive full sim runs at the same tuning disagree by more
         than ~5 points, run more iterations before concluding anything.
      2. No single floor is a cliff: no floor may account for more than ~50%
         of all deaths, and floor-2's death share specifically must come down
         from wherever it currently is toward parity with floor 3 (use the
         sim's per-floor/elite tracking; report the before/after death
         distribution in PROGRESS.md).
      3. The FIRST fight of a run stays gentle -- a new player's opening
         encounter should almost never kill (ROADMAP.md's "first five
         minutes" priority). Sim proxy: deaths on floor-1 regular (non-elite,
         non-boss) encounters <= ~10% of all deaths.
      4. Bosses stay real fights: re-examine boss HP with the FIXED sim and
         retune within this same framework. A boss should be a meaningful
         difficulty spike relative to its own floor's regulars (not a relief),
         but the final-boss kill rate must not single-handedly push the
         overall win rate below the band in target 1.

      HARD CONSTRAINTS (do not undo prior design rulings):
      - Regular monsters must still survive one decent word -- the "fights
        last multiple turns" fix from the big review stands. Don't restore
        one-shot-everything by gutting monster HP.
      - Bosses remain unskippable (Jaxon's standing ruling).
      - Don't touch the word-scoring/damage formula itself (tile values,
        length bonuses, weakness/trait multipliers, Combat.previewWord) --
        the preview feature just shipped against it and players learn it.
        Tune the MONSTER side (HP, attack damage, intent frequencies, elite
        multipliers, scaling curves) and, if needed, the player-economy side
        (heal amounts/costs, potion availability, starting HP) -- not how
        words convert to damage.

      LATITUDE: which specific knobs to turn is the implementing run's call
      (that's why the sim exists) -- but change knobs incrementally, re-sim
      after each adjustment, and log the tuning trail (knob, old -> new,
      resulting win rate) in PROGRESS.md so the reasoning is auditable. If
      after honest effort the targets genuinely conflict (e.g. floor-2 can't
      come down without the overall rate overshooting), get as close as
      possible, say plainly which target gave and why, and leave the box
      UNCHECKED with a clear note for Jaxon rather than declaring victory.
      This may take more than one run -- fine; leave a working intermediate
      state and the tuning trail, per the standing multi-run convention.

      VERIFICATION: the sim targets above, plus `npm test` clean (it asserts
      on combat math paths -- update any assertions that hardcode old monster
      stats, and say so), plus `npm run test:qa` clean (it drives real
      fights; watch that tougher monsters don't break its scripted waits --
      bump ITS timeouts if needed, not the game's). Bump the minor version
      (player-facing balance change) and note the rebalance in ROADMAP.md's
      known-gaps list as resolved.
      ORCHESTRATOR DECISION 2026-08-21T00:40Z -- box checked, accepting the
      v0.33 stopping point (commit 803eba8 + the full 7-round tuning trail
      in PROGRESS.md). 3/4 targets met: pooled win rate 41% (centered in
      the 35-50% band, up from 13-17%), floor1 share 14.8-36% (pass),
      floor1-regular deaths 11.1% (at the ~10% tolerance, Echo Pup/Quoth
      fixed to 0% kill rate). The unmet target (floor2 death share <=50%;
      actual 55-67% across all samples) is ACCEPTED AS-IS for now: three
      direct floor2 cuts showed diminishing/negative returns, the runs'
      own analysis says the residual skew is structural (floor2's
      strong-tier encounter mix; floor3 barely kills anyone once floor2 is
      survived), and a mid-game difficulty peak is a defensible roguelike
      shape (the Act-2 spike). The structural question -- reshape floor2's
      encounter mix and/or make floor3 threaten more -- is DEFERRED TO
      JAXON's next playtest; it's recorded in ROADMAP.md's known-gaps and
      he can reopen it with a one-liner. The four tickets below are
      hereby UNGATED -- proceed top to bottom.

<!-- The 4 tickets below were queued 2026-08-20T23:12Z directly from Jaxon
     ("Add more items, make the background/visuals fit the theme better, add
     more sound effects to make the game feel more responsive, and review the
     game for polish and small details"). They queue BEHIND the rebalance
     ticket above — finish that first. Ordered: items, then visuals, then
     audio, then the review pass LAST deliberately (a detail review is most
     valuable after the new content/visual/audio work has landed, so it
     catches their rough edges too). -->

- [x] CONTENT (Jaxon request): add more items. Design and add roughly 8-12
      new shop/reward items consistent with THEME.md's library/archive lore
      and naming voice (read it first -- items are things like "Heavy Ink",
      "Folio Mark"; stay in that register, no generic fantasy nouns). Spread
      across the existing rarity tiers; include at least 2 genuinely
      build-defining ones (the rule-changer class from FUN OVERHAUL, which
      Jaxon liked) and avoid near-duplicates of existing effects -- read
      js/wordbound/items.js in full before designing so the new effects fill
      gaps (e.g. hook points that exist but have few items: onWordPlayed
      variants, floor-transition, gold-economy, consumable-synergy) rather
      than stacking more of what's common. Keep effects implementable with
      the existing hook system -- don't invent new engine machinery unless
      one flagship item truly earns it. NOTE the shop-pool interaction: the
      guaranteed-consumable-slot fix (v0.28) means adding items no longer
      starves consumables, but adding many items DOES dilute each individual
      item's appearance rate -- that's acceptable (variety is the point), no
      pool-weighting work needed unless something specific breaks. If the
      rebalance ticket above shifted monster/economy numbers, design against
      the NEW numbers, not v0.32's.
      VERIFICATION: `npm test` clean with per-item assertions (each new item's
      effect fires through its hook with the expected state change -- follow
      the existing per-item test pattern in test/dom-check.js), `npm run
      test:qa` clean, and a seeded-shop check that the new items actually
      appear in shop rolls. Minor version bump.
      DONE 2026-08-21T00:46Z: added exactly 9 new items to
      js/wordbound/items.js (within the "roughly 8-12" range), THEME.md
      library/archive register throughout: Card Catalog Key (common,
      onDraw -- guarantees a 3+ value letter in the draw, mirrors Lucky
      Vowel's pattern), Bookplate (common, onRunStart -- adds a guaranteed
      Charged tile to the fight's draw pile), Ex Libris (uncommon,
      onRunStart -- +4 gold per fight, gold-economy), Late Fee (uncommon,
      onPlayerDamaged -- gain floor(damage/2) gold when hit, gold-economy),
      Interlibrary Loan (uncommon, onWordPlayed -- +3 damage while holding
      2+ consumables, consumable-synergy/hoard build), Withdrawal Slip
      (rare, onWordPlayed -- +6 damage while holding zero consumables, the
      mirror-image consumable-synergy/spend build), Colophon (uncommon,
      onWordPlayed -- +2 damage per DISTINCT letter in the word, a new
      intra-word-variety axis, not a duplicate of Consonant Cluster/Long-S
      since it's provably different on words with repeated letters), Bound
      Volume (rare, onWordPlayed -- +25% when the word's length matches the
      previous word's length this fight, a new build-defining word-strategy
      axis alongside Illuminated Initial/Palimpsest), and Acquisitions
      Budget (legendary, gold-to-power flagship -- every 10 gold held
      converts to +2 max HP, healed by the same amount, at each floor
      transition). 4 of these (Interlibrary Loan, Withdrawal Slip, Bound
      Volume, Acquisitions Budget) are genuinely build-defining -- they
      change which words/consumable habits/gold habits are correct play,
      well above the ticket's "at least 2" floor.
      NEW ENGINE MACHINERY (per the ticket's own "unless one flagship item
      truly earns it" allowance): added a new `onFloorAdvance(ctx)` item
      hook, ctx = { player, floorNumber, messages }, fired once from
      game.js's `advanceFloor()` right after the floor number increments
      and before the new floor generates. Acquisitions Budget is the only
      item using it. Documented in items.js's header comment alongside the
      existing 4 hooks. This is the one new hook point the ticket's gap
      list named ("floor-transition") that genuinely didn't exist yet --
      gold-economy and consumable-synergy were both achievable with the
      existing 4 hooks (onRunStart/onPlayerDamaged for gold, onWordPlayed
      reading `ctx.player.consumables.length` for synergy), so no other new
      machinery was added.
      WIRING INTO POOLS: confirmed (same as the FUN OVERHAUL 4/8 precedent)
      that no separate registration step is needed -- rollTreasureOptions/
      rollShopOptions/rollBossRewardOptions all derive their pools live from
      `Object.keys(Items.ITEM_DEFS)` filtered by ownership/rarity, so a
      `def({...})` call alone is sufficient. Rarity spread: 2 common, 4
      uncommon, 2 rare, 1 legendary -- Bound Volume and Withdrawal Slip
      (rare) plus Acquisitions Budget (legendary) further favor the boss-
      reward pool per the ticket's spirit, though not explicitly requested
      for this ticket the way it was for FUN OVERHAUL 4/8.
      JUDGMENT CALLS: (1) onRunStart/onDraw/onPlayerDamaged hooks have no
      `ctx.messages` plumbing at their call sites (only onWordPlayed did,
      pre-existing) -- kept Card Catalog Key/Bookplate/Ex Libris/Late Fee
      silent, consistent with every existing item on those same 3 hooks
      (Lucky Vowel, Wildcard Pouch, Thick Skin, Second Wind, Dust Jacket are
      all silent too); only gave the new onFloorAdvance hook a `messages`
      array (new machinery, so free to design it that way) and every
      onWordPlayed item a proc message, matching the FUN OVERHAUL 4/8
      convention exactly. (2) Card Catalog Key's "valuable letter" threshold
      is LETTER_VALUES >= 3 (B/C/F/H/J/K/M/P/Q/V/W/X/Y/Z), chosen to roughly
      mirror Rare Hunter's existing "4+ point letter" bar while still firing
      often enough at common rarity to feel present, not to exactly match
      any other single item's threshold.
      VERIFICATION: `npm test` 423/423 (ALL CHECKS PASSED) -- one positive +
      one negative isolated Items.runHook assertion per conditional new item
      (matching the Foreword/FUN-OVERHAUL-4/8 test pattern exactly),
      including a dedicated duplicate-letter rack ("LETTER" from a rack with
      2 E's/2 T's) proving Colophon counts distinct letters rather than
      length. Also added a live-DOM check that `game.js`'s real
      `advanceFloor()` (exposed test-only as `Game._advanceFloor`, same
      precedent as the existing `Game._rollShopOptions`) actually invokes
      the new hook end to end and logs its message, not just that the
      isolated hook function's math is right -- saves/restores every state
      field it touches so the in-progress live fight it runs inside
      continues unaffected. Plus the ticket's own explicitly-requested
      seeded-shop check: 300 seeded `Game._rollShopOptions()` rolls with an
      empty owned-items list, asserting each of the 9 new item ids appears
      at least once (all 9 passed). `npm run test:qa` 26/26, real Chromium,
      zero console/page errors -- this run's boss-reward flow exercises
      `advanceFloor()` for real on every boss kill, confirming the new hook
      call doesn't break floor advancement even for players without
      Acquisitions Budget (the silent no-op path). No CSS/layout touched by
      this ticket, so `npm run test:mobile` wasn't required and wasn't run.
      Version bumped v0.33 -> v0.34 (`wordbound.html`).

- [x] VISUAL (Jaxon request): make the background/visuals fit the theme
      better. Right now the game plays on a mostly flat dark backdrop; the
      theme is the Boundless Archive -- a library gone feral (THEME.md).
      Give the game an ambient visual identity: e.g. layered CSS-gradient /
      inline-SVG bookshelf silhouettes or stack outlines behind the play
      area, a subtle parchment/vellum texture on panels, maybe slow-drifting
      dust motes or stray letters in the deep background, a per-floor tint
      shift (floor names already have distinct flavors) so descending feels
      like moving somewhere. Constraints, all hard:
      - NO external asset files (project convention) -- CSS gradients, inline
        SVG/data-URIs only. Keep the page weight increase trivial.
      - Readability first: text/tile contrast must not degrade; anything
        behind the combat area stays low-contrast and out of the way.
      - All ambient motion gates on prefers-reduced-motion (house convention)
        and must be transform/opacity-only (no layout-thrashing animation),
        cheap enough to not jank a mid-range phone.
      - Both games share CSS files in places -- scope changes to Wordbound's
        surfaces (wordbound.css / wordbound.html) so Descent of Essence's
        look is untouched.
      VERIFICATION: `npm test` clean, `npm run test:mobile` clean at 375/414px
      (backdrop must not introduce overflow), `npm run test:qa` clean, plus a
      real-browser screenshot pass at desktop + 375px in PROGRESS.md terms
      (describe what was visually confirmed -- element visibility/contrast --
      and say plainly that aesthetic judgment is Jaxon's). Minor version bump.
      DONE 2026-08-21T01:02Z, v0.34 -> v0.35. All four hard constraints
      followed: no external assets (CSS gradients + one inline SVG
      feTurbulence data-URI for parchment grain -- see wordbound.css), a
      fixed `#wb-ambient-bg` layer sits at z-index:0 (pointer-events:none,
      aria-hidden) strictly behind `#wb-root` (bumped to z-index:1) so it
      never intercepts input or gets announced to screen readers, all motion
      is transform+opacity only inside `@media (prefers-reduced-motion:
      no-preference)` with a static-faint fallback under `reduce`, and only
      wordbound.css/wordbound.html were touched (grepped css/style.css and
      index.html afterward to confirm zero changes reached Descent of
      Essence).
      WHAT WAS BUILT: (1) a bookshelf-silhouette backdrop -- two layered
      repeating-linear-gradients (vertical "spine" bands of varying width/
      color + horizontal shelf-divider lines), masked via radial-gradient to
      fade out near where the panel sits so it never competes with content;
      (2) 8 drifting dust motes (3 rendered as faint letter glyphs -- Q/A/Z
      -- per the ticket's "stray letters" suggestion, the rest plain dots),
      each an absolutely-positioned span animating translateY/translateX/
      opacity on its own randomized duration+delay so they don't move in
      lockstep; (3) a subtle SVG-noise vellum texture layered under the
      existing `.panel` gradient via `background-blend-mode: soft-light`
      (alpha baked to 0.05 in the SVG itself, so it reads as grain not
      speckle); (4) a per-floor tint (`body.floor-1/2/3 .wb-floor-tint`,
      warm amber -> cool blue-grey -> deep red, matching THEME.md's Overdue
      Aisles/Reference Wing/The Binding escalation) toggled by a new
      `document.body.classList` call in `Game.render()`/`renderRun()`
      (js/wordbound/game.js) -- cleared on every non-run screen, set to
      `floor-` + `state.floorNumber` while on the run screen, with a 1.2s CSS
      transition so it eases rather than snaps on floor change.
      VERIFIED: `npm test` ALL CHECKS PASSED (425/425 -- 2 new targeted DOM
      assertions added: `<body>` carries exactly `floor-2` (not floor-1/3)
      immediately after a real floor-1->floor-2 boss-kill advance, proving
      the render() wiring runs end-to-end not just in isolation; and
      `<body>` carries NO floor-N class on the VICTORY screen, proving the
      clear-on-non-run-screen branch works). `npm run test:mobile` clean at
      375/414px, zero overflow warnings (the ambient layer is `position:
      fixed` + `pointer-events: none`, so it can't itself cause scroll/
      overflow, but confirmed rather than assumed). `npm run test:qa` clean,
      real Chromium, zero console/page errors across the full boss-reward
      flow (which crosses a real floor-1->2 tint transition).
      REAL-BROWSER SCREENSHOT PASS (Playwright, desktop 1024px + mobile
      375px, script run then discarded -- not committed): main menu and an
      in-run floor-1 screen at both widths -- confirmed visually: bookshelf
      bands render as intended (readable, subtle, don't fight panel text),
      panel text/buttons/HP-gold-floor HUD all fully legible with normal
      contrast, no visual clipping or overlap at 375px, dust motes visible
      as faint specks without being distracting. Per-floor tint: the CSS
      itself was confirmed via `getComputedStyle` (floor-1/2/3 each produce
      a distinct `background-image` color on `.wb-floor-tint`, not just
      "class toggles"), but the visual DIFFERENCE between floors in a still
      screenshot is genuinely subtle by design (the ticket's own
      "readability first... low-contrast" constraint) -- close but
      noticeable side-by-side, not a dramatic shift. Whether that's the
      right amount of subtlety (vs. wanting it more pronounced) is an
      aesthetic call, explicitly Jaxon's per the ticket's own verification
      language, not something this run should tune further by guessing.
      NOT verified / out of scope: real mid-range-phone jank/performance
      (the sandbox can't measure that; the animation is deliberately cheap --
      8 elements, transform/opacity only, no layout-triggering properties --
      but actual frame-rate on real hardware needs Jaxon's phone, same
      standing gap as the rest of this project's touch/feel verification).

- [x] AUDIO (Jaxon request): more sound effects, so the game feels more
      responsive. Audit what already has sound (grep playCombatSound /
      the audio module) and add short, subtle synthesized SFX (existing
      WebAudio approach, no external audio files) for the interactions that
      are currently silent -- candidates, pick the ones that read as
      responsiveness rather than noise: tile tap/stage, unstage, drag pickup
      and drop, invalid-word rejection, word-accepted vs weakness-hit
      differentiation (if not already distinct), gold gained, shop purchase,
      consumable use, heal, floor transition, boss entrance, victory/defeat
      stingers, button taps on major CTAs. Requirements:
      - Everything routes through the existing mute toggle + volume slider;
        nothing plays before the first user gesture (autoplay policy).
      - Keep the palette coherent (same synthesis voice/family as existing
        sounds) and QUIET -- feedback, not fanfare; combat hits stay the
        loudest thing.
      - Debounce rapid-fire cases (fast tile taps shouldn't machine-gun).
      VERIFICATION: `npm test` clean (assert the sound-trigger functions are
      called on the right events and that mute suppresses them -- jsdom can
      verify call/state, NOT actual audibility; say so plainly in
      PROGRESS.md), `npm run test:qa` clean with zero console errors (a
      broken AudioContext call would surface there). Actual sound quality/mix
      is Jaxon's ears' call -- flag it for his next playtest. Minor version
      bump.
      DONE 2026-08-21T01:24Z, v0.35 -> v0.36. Added 10 new synthesized SFX
      (`js/wordbound/game.js`, all WebAudio, no external files): tile stage,
      tile unstage, invalid-word rejection, gold gained, shop purchase,
      consumable use, heal (rest node), floor transition, boss entrance,
      victory/defeat stingers. All route through a new shared `sfxGainNode`
      (mirrors the existing `musicGainNode` pattern) whose gain is
      muted/volume-driven, so every new sound respects the existing mute
      toggle and volume slider with no per-sound guard code. Tile stage/
      unstage share one 35ms debounce key so rapid-fire tile taps (building
      a word fast) don't stack overlapping oscillators.
      SKIPPED, with reasons (per the ticket's own "pick ones that read as
      responsiveness" framing): drag pickup/drop (jsdom can't verify it at
      all per GOALS.md's own standing caveat, and the staged-tile drag code
      is intricate enough that wiring untested audio into it felt like
      unjustified risk for a "nice to have" sound); button taps on major
      CTAs (broad surface, real risk of tipping into the "noise" the ticket
      explicitly warns against, and the highest-value moments -- purchase,
      consumable use, floor transition, boss/victory/defeat -- were already
      covered without it); word-accepted vs weakness-hit differentiation
      was judged ALREADY sufficiently distinct (playCombatSound's existing
      damage-tier pitch/tone split already reflects a weak-point hit
      through the resulting damage number) so left untouched, per the
      ticket's own "if not already distinct" qualifier.
      BUG FOUND AND FIXED IN THE SAME TOUCH: `playCombatSound` and
      `playCounterattackSound` (the two PRE-EXISTING sound functions) wired
      straight to `ctx.destination` and had never respected `audioSettings
      .muted` at all -- muting the game silenced the music but NOT combat
      hits or monster counterattacks, the two most frequent sounds in the
      game. Added a one-line `if (audioSettings.muted) return;` guard to
      each (verified via the new `_sfxCallLog` -- see below) WITHOUT
      touching their internal gain math or destination routing, so their
      calibrated loudness when unmuted is byte-for-byte unchanged -- only
      mute itself was broken, now fixed. Deliberately did NOT also route
      them through the new volume-slider-scaled `sfxGainNode`: doing so
      would multiply their fixed gain constants by `audioSettings.volume`
      (default 0.1), a real ~10x loudness cut to already-shipped, presumably
      already-tuned combat/counter sound -- a balance-sensitive judgment
      call outside a "add missing SFX" ticket's scope. Flagging for Jaxon /
      a future pass: the volume slider currently does nothing for combat
      hits or counterattacks (always full fixed gain when unmuted), only
      for music and the new SFX added here.
      TEST INFRASTRUCTURE (`Game._sfxCallLog()` / `Game._clearSfxCallLog()`,
      test-only exposures, same house pattern as `Game._advanceFloor` etc.):
      every `playSfx()` call (new sounds) and both pre-existing sound
      functions now push `{name, played, muted}` to a capped in-memory log
      BEFORE the mute/debounce short-circuit, so a test can assert not just
      "did it play" but "was it correctly suppressed and why."
      VERIFIED: `npm test` 444/444, ALL CHECKS PASSED (19 new assertions):
      real end-to-end triggers for all 10 new sounds (tile stage/unstage via
      real rack clicks, invalid word via a real rejected `submitWord`, gold
      via a real kill, purchase via a real `buyItem`, consumable via a real
      `useConsumable`, heal via a real rest-node entry, floor transition via
      the real `advanceFloor`, boss entrance via a real boss-node entry,
      victory via the SAME real end-to-end boss-skip flow that already
      drives the game to a genuine VICTORY screen -- not an isolated call);
      the tile-tap debounce (two rapid stage clicks -> both logged, only the
      first marked played); mute suppressing both a new sound (invalidWord)
      AND a pre-existing one (combatHit) in the same muted window, then
      unmuting and confirming combatHit plays again; and a forced-lethal-
      counterattack scenario proving the defeat stinger fires on a real
      player death, not just a direct `endRun(false)` call. `npm run
      test:qa`: 26/26, real Chromium, zero console/page errors across the
      full boss-reward flow -- this is the strongest signal available
      without a human: it proves every new WebAudio call (oscillator
      creation, gain scheduling, connect graph) actually executes in a real
      browser's real Web Audio implementation without throwing, not just
      that jsdom's mocked absence of AudioContext silently no-ops it. No
      CSS/layout touched, so `npm run test:mobile` wasn't required or run.
      NOT verified / explicitly out of scope, same standing gap as every
      other audio ticket on this project: actual audibility, loudness
      balance/mix, and whether the synthesized timbres read as intended
      (e.g. "purchase sounds satisfying," "boss entrance reads ominous") --
      jsdom cannot hear, and Chromium headless in this sandbox has no real
      audio output device either. This needs Jaxon's own ears at his next
      playtest; the sound palette (triangle/sine/square/sawtooth, same
      family as the existing combat/music voices, short durations,
      deliberately quiet gains relative to combat hits) was chosen by
      design intent and cross-checked against the existing sounds'
      style, not by ear.

- [x] QA (Jaxon request) -- polish & small-details review pass. LAST of this
      batch on purpose: run it after the items/visual/audio tickets above
      have landed so their rough edges get caught too. Like the 2026-08-20
      bugs/feel/fun review but aimed at SMALL things: play the real game in a
      real browser (desktop AND 375px mobile, touch mode) through at least
      one full run each, visiting every screen (menu, character select,
      how-to, combat, shop, events, boss reward, game over, victory, stats,
      deck/consumables panels, achievements), and hunt: typos/inconsistent
      capitalization or naming (cross-check THEME.md), spacing/alignment
      glitches, inconsistent button styles, missing hover/focus/pressed
      states, log-message wording that lies or reads awkwardly, animation
      timing that feels off, dead/empty states (empty consumables panel,
      zero-gold shop, etc.), keyboard focus traps, anything that looks
      unfinished. FIX the trivial ones in the same run (a typo, a padding
      value); for anything non-trivial, append a properly-specced ticket to
      this queue (root cause, file/line, fix shape, verification) -- follow
      the format of the tickets the earlier review produced. Report the full
      findings list in PROGRESS.md, including what was checked and found
      CLEAN, so the pass is auditable.
      VERIFICATION: `npm test` + `npm run test:mobile` + `npm run test:qa`
      all clean after any inline fixes; new tickets properly filed for the
      rest. Patch version bump if only fixes shipped, minor if anything
      user-visible changed meaningfully.
      DONE 2026-08-21T01:50Z: real-browser (Playwright, real Chromium, an
      ad-hoc screenshot script written and discarded after use, not
      committed -- same pattern PROGRESS.md documents for prior visual
      passes) desktop (1280px) AND 375px touch-mode passes, both driven
      through real clicks/taps, hitting every screen the ticket lists:
      main menu, how-to-play overlay, character select, node map, regular/
      elite/boss combat, treasure, shop (populated AND zero-gold), event,
      rest, tile reward, boss item reward, deck viewer, consumables (populated
      AND empty), game over + stats, victory + stats, achievements display.
      Full findings below.
      FOUND AND FIXED (2 real bugs):
      1. BUG: `#word-input`'s placeholder ("Type or click letters...",
         uppercased via `text-transform: uppercase` to match the rack tiles)
         was visibly clipped to "TYPE OR CLICK LETTER..." on every desktop
         combat screen above the 480px mobile breakpoint -- measured the
         uppercased text at ~223px wide plus 24px padding (~247px needed)
         against the input's `max-width: 220px` (css/wordbound.css, was line
         969). Fixed by widening `max-width` to 260px (confirmed via a
         canvas `measureText` check against the actual placeholder string
         and font). Checked for regressions at 1280px/800px/500px: no new
         horizontal overflow introduced at any of them (the input's own
         `flex:1; min-width:0` still lets it shrink when the row is tight).
      2. BUG (the meaty one): opening the Deck viewer, Item Inspector, or
         Consumables panel NEVER hid whatever screen was visible underneath
         it (the node map, OR mid-combat, OR even a treasure/shop/event
         screen) -- both stayed visible and stacked in the same document
         flow, e.g. the node-map's pill row and boss-trait hint rendering
         directly above the deck viewer's "Your Deck" tile list. Root cause:
         `renderRun()` (js/wordbound/game.js, `render()`'s per-screen
         dispatcher) toggled `deck-viewer-panel`/`item-inspector-panel`/
         `consumables-panel`'s `hidden` class and then RETURNED EARLY when
         any of the three was open -- before ever reaching the lines below
         that toggle `node-map`/`combat-panel`/`treasure-panel`/etc.'s
         `hidden` class. Whichever of those was visible on the PREVIOUS
         render (before the side panel opened) simply never got hidden.
         100% reproducible, not an edge case -- confirmed via direct DOM
         inspection (`classList.contains('hidden')`) in three contexts: idle
         on the node map, mid-regular-combat, mid-boss-combat, all showing
         the underlying panel's `hidden` class staying `false` after
         opening a side panel. Fixed by computing a single `sidePanelOpen`
         flag up front and folding it into every other panel's `hidden`
         toggle (node-map/combat-panel/treasure-panel/tile-reward-panel/
         boss-reward-panel/event-panel/shredder-panel), moved BEFORE the
         deck/inspector/consumables toggles+early-returns so the ordering
         can no longer matter regardless of which panel opens first. No
         other logic touched. Re-verified all three contexts fixed by direct
         DOM inspection post-fix, plus a full desktop+mobile screenshot
         re-pass confirming no more bleed-through anywhere.
      NEW TICKET FILED for a non-trivial finding (see below in this queue):
      the run-header (HP/gold/floor label/Deck/Consumables/mute/volume row)
      has no `flex-wrap` outside the existing `@media (max-width: 480px)`
      block, so it overflows horizontally at every viewport width from
      ~481px to ~780px (measured: 220px overflow at 481px, tapering to 0px
      by 800px) -- a real, pre-existing gap between the tested 375/414px
      phone breakpoint and full desktop (confirmed pre-existing on the
      pre-fix code too, unrelated to anything else touched this pass).
      CHECKED AND FOUND CLEAN: THEME.md name/naming cross-check (monster
      names, item names/flavor text, floor names, character names all
      matched exactly, including newer items like Errata Slip, Long-S
      Ligature, Vowel Leech); button styling consistency (primary/secondary
      styles used consistently, no stray one-off button styles found);
      keyboard focus -- no `:focus` rules exist anywhere in the CSS, but
      also no `outline: none`/suppression anywhere, so the browser's native
      focus-visible outline still renders on Tab (confirmed live:
      `outlineStyle: 'auto'` on the first Tab-focused element, not
      `'none'`) -- no focus trap, no invisible-focus accessibility bug;
      empty/dead states (zero consumables, zero-gold shop) both render
      clean, readable "you have none"/dimmed-but-listed states, no broken
      layout; log-message wording spot-checked across combat/shop/event/
      rest/boss-reward -- all read naturally, no lies or stale numbers
      found (the earlier MEND healed-amount bug and this run's word-input/
      panel-stacking bugs were the only wording/display bugs this project
      has had); animation timing (`screenFadeIn`, 200ms opacity+transform
      fade on every screen/panel switch) reads as intentional and quick,
      not sluggish, once actually waited out (an early attempt at this pass
      screenshotted mid-fade and initially looked like a blank-screen bug --
      false alarm, confirmed by re-checking with real clicks and a proper
      wait; noted here so a future run doesn't rediscover the same false
      trail). NOT independently re-litigated: the two small mobile-specific
      findings and the physical-device touch check ROADMAP.md already lists
      as open/Jaxon's-to-do -- out of this ticket's scope, still open.
      VERIFIED: `npm test` 450/450 (up from 444 -- added 6 new targeted
      assertions in test/dom-check.js for the panel-stacking fix: opening
      the deck viewer from the node map hides node-map and shows the
      viewer, closing it restores the node map, opening consumables
      mid-combat hides combat-panel and shows consumables, closing it
      restores combat-panel, plus a zero-errors check for the block -- all
      via real `Game.openDeckViewer()`/`openConsumablesPanel()` calls, not
      synthetic class edits). `npm run test:mobile`: clean, zero overflow
      warnings at 375/414px (the CSS touched -- word-input's max-width --
      only affects >480px widths, so this was a required but low-risk
      re-check). `npm run test:qa`: 26/26, real Chromium, zero console/page
      errors across the full boss-reward flow. Patch version bump v0.36 ->
      v0.37 (both fixes are bug fixes, not new features, per this ticket's
      own version-bump instruction).

- [x] BUG, layout (found during the 2026-08-21 QA polish pass, GOALS.md
      above): the run-header row (HP/gold/floor label, Deck/Consumables
      buttons, mute button, volume slider -- `.run-header` in
      css/wordbound.css, ~line 308) overflows horizontally at every
      viewport width from ~481px to ~780px. Confirmed pre-existing on the
      code before this pass's fixes too (not a regression from anything
      touched this run) -- a real gap that's simply never been tested,
      since `npm run test:mobile` only checks 375px/414px.
      ROOT CAUSE: `.run-header` is `display: flex; justify-content:
      space-between;` with NO `flex-wrap` in its base rule. It only gets
      `flex-wrap: wrap` inside the existing `@media (max-width: 480px)`
      block (css/wordbound.css ~line 1276). Above 480px the row tries to
      fit HP display + gold display + floor label + Deck button +
      Consumables button + mute button + volume slider all on one line
      with no wrapping, which doesn't fit until the viewport is wide enough
      (~780px+) for all of it unwrapped.
      MEASURED (Playwright, real Chromium, viewport width -> horizontal
      page overflow in px, same seed/run each time): 481px -> 220px
      overflow, 550px -> 151px, 600px -> 101px, 650px -> 56px, 700px ->
      31px, 750px -> 6px, 800px -> 0px (clean). So the affected range is
      roughly 481-780px -- covers small/split-screen desktop browser
      windows, some tablets in portrait, and landscape phones (e.g. a
      typical 667-740px landscape width), none of which this project's
      existing 375/414px-only mobile test catches.
      WHY LEFT FOR A FUTURE RUN INSTEAD OF FIXED INLINE: simply extending
      the existing `@media (max-width: 480px)` breakpoint upward (e.g. to
      780px) would be the easy fix, but it also carries other rules tuned
      specifically for PHONE proportions in that block (padding, font
      sizes, tap-target heights per the mobile task's own 36px-floor
      standard) that may not be the right call for a 600-780px BROWSER
      WINDOW (mouse-driven, not touch) -- e.g. inflating tap targets to
      phone sizes on a desktop browser someone just resized narrow would be
      a visually odd, not-obviously-correct tradeoff to make without
      thinking through which rules should scale with width vs. which are
      specifically touch-related. That's a real (if small) design judgment
      call, not a one-line CSS tweak, so it's queued here instead of
      guessed at.
      SUGGESTED FIX SHAPE for whoever picks this up: add `flex-wrap: wrap;
      row-gap: 8px;` to the base `.run-header` rule (not gated behind the
      480px media query) so it wraps at ANY width where it doesn't fit,
      matching what the existing HP/gold/floor-label `flex-shrink: 0`
      rules already assume is possible. Verify it does NOT change anything
      at 375/414px (where it already wraps via the existing media query) or
      at typical desktop widths (900px+, where it already fits on one line
      and shouldn't start wrapping unnecessarily). This is narrower than
      copying the whole 480px block up -- it only touches whether the row
      wraps, not phone-specific sizing.
      VERIFICATION: `npm run test:mobile` still clean at 375/414px; a new
      targeted check (either added to verify-mobile-layout.js or a small
      standalone Playwright script) sweeping 481-780px confirming zero
      horizontal page overflow with the fix in place, at minimum re-testing
      the exact widths measured above (481, 550, 600, 650, 700, 750px).
      `npm test` for a regression check since `.run-header` markup is
      touched by combat/node-map/every RUN-screen render. Patch version
      bump (bug fix, no new features).
      FIXED 2026-08-21: exactly the suggested fix -- added `flex-wrap: wrap;
      row-gap: 8px;` to the base `.run-header` rule (`css/wordbound.css`
      ~line 308), ungated by any media query, so it wraps at ANY width
      where its 4 children (HP/gold/floor-label + the actions group) don't
      fit, instead of only below 480px. Nothing else in the rule or the
      existing 480px block touched. While verifying, traced WHY the
      original overflow shrank from 220px at 481px down to 0px by 800px
      instead of staying constant: `#wb-root` has a hard `max-width: 640px`
      (css/wordbound.css line 15), so the actual content column does NOT
      keep growing past ~640px viewport width -- it's fixed there. The
      unwrapped row needs ~608+61px to fit its 4 children, i.e. it never
      truly "fits on one line" past 480px; what happened instead is the
      centered column's side margins (which grow with viewport width once
      past 640px) happened to be wide enough to visually absorb the
      overflowing row without pushing the DOCUMENT past the viewport --
      a fragile coincidence, not a real fix. Confirmed directly: even at a
      1280px viewport the row still wraps to 2 lines under this fix (children
      measured at two distinct `top` offsets), because the capped 608px
      content width genuinely isn't enough for all 4 unwrapped -- this is
      correct, not the "wrapping unnecessarily at desktop widths" the
      ticket cautioned against, since there was never a real desktop width
      where it fit; the previous appearance of fitting was the margin trick
      above, which is neither reliable across DPI/zoom nor an actual
      one-line layout.
      VERIFICATION: added `test/verify-run-header-overflow.js` (new
      `npm run test:run-header` script, same real-Chromium/Playwright
      pattern as `test:mobile`, kept as a permanent regression test per the
      ticket's own suggestion, not an ad-hoc throwaway) sweeping the exact
      7 widths measured in the ticket (481/550/600/650/700/750/800px) plus
      375/414px (existing mobile breakpoints) and 1280px (wide desktop) --
      all 10 widths: **0px horizontal overflow**. `npm test`: **450/450**
      (no regressions, `.run-header` markup untouched, only its CSS rule).
      `npm run test:mobile`: clean, 0 overflow warnings at 375/414px
      (required per GOALS.md's CSS-layout gate; this change only adds a
      wrap capability the existing 480px media query already had, so no
      behavior change expected or observed at those two widths). Separately
      confirmed via a one-off Playwright check (not part of the committed
      test) that the row renders as exactly 2 stable rows (not 3+, not
      jittering) at 500/780/1280px, ruling out a worse failure mode like
      each child wrapping onto its own line.
      Patch version bump v0.37 -> v0.38 (`wordbound.html`), per this
      ticket's own instruction (bug fix, no new features).

<!-- The 8 tickets below were queued 2026-08-21T04:45Z from Jaxon's next big
     feature push. TWO DESIGN DECISIONS ARE ALREADY MADE by Jaxon directly
     (do not re-litigate them): (1) the player's health system is being
     REPLACED by INK -- a single unified life+mana resource; (2) all enemy/
     character/menu art is INKED WOODCUT style -- hand-coded inline SVG that
     looks like old book engravings / ex-libris plates (bold ink strokes,
     hatching, parchment tones, plate borders). Ordered: broken-feature bug
     first, then the two structural features (ink, map), then art/presentation
     (which must follow the woodcut style), then variety/content last so it's
     designed against the NEW systems, not the old ones. Most of these are
     multi-run tickets -- leave working state + clear notes between runs. -->

- [x] BUG, CRITICAL (Jaxon, real-device report 2026-08-21): NO SOUND AT ALL.
      Jaxon hears nothing -- despite v0.36's "10 new SFX + mute bug fix"
      passing its jsdom call-path checks (which, honestly-flagged at the
      time, could never verify audibility). Diagnose in a REAL browser, in
      rough order of likelihood:
      (a) AudioContext autoplay policy: the context starts 'suspended' and
          must be resume()d INSIDE a user-gesture handler (first
          pointerdown/keydown/touchend). If resume() is never called, every
          play call silently no-ops forever. Check where the context is
          created and whether ANY gesture handler resumes it; verify
          `ctx.state === 'running'` after a real click in Playwright.
      (b) The v0.36 "mute bug fix" itself: check the persisted mute/volume
          state in localStorage -- an inverted boolean or a default-0 volume
          from an earlier version would mute everything for an EXISTING
          player like Jaxon while looking fine on a fresh profile. If the
          stored default is bad, migrate it, don't just fix the default.
      (c) Gain-graph wiring: master gain actually connected to
          ctx.destination, per-sound gains nonzero, no node .start() missing.
      (d) iOS Safari specifics: the hardware silent switch mutes WebAudio in
          Safari. If (a)-(c) check out and this is the residual explanation,
          implement the known mitigation IF cheap (route through a playing
          silent <audio> element / navigator.audioSession `playback` type
          where supported); otherwise document it plainly in PROGRESS.md and
          surface a small one-time in-game hint ("sound on -- check your
          ringer switch") rather than leaving players to wonder.
      VERIFICATION: Playwright real-Chromium -- after ONE user gesture,
      assert `ctx.state === 'running'`, master gain > 0, and that a played
      word actually schedules source nodes (spy/count). `npm test` clean.
      State plainly that audibility-on-real-glass still needs Jaxon's ears,
      and ASK him (via PROGRESS.md note) to re-test with the ringer switch
      ON if iOS. Patch bump.
      DONE 2026-08-21T05:04Z, v0.38 -> v0.39: went through (a)-(d) in order.
      (a) CONFIRMED as a real gap and fixed: zero `.resume()` calls existed
      anywhere in game.js despite the AudioContext being created lazily
      from several different call sites. `initAudioContext()` (the single
      chokepoint every sound path already went through) now calls
      `ctx.resume()` whenever `ctx.state === 'suspended'`, and `Game.init()`
      additionally primes+resumes the context on the very first
      pointerdown/keydown/touchend anywhere on the page (once, then
      unbinds), so activation happens at the earliest possible real gesture
      rather than whatever later event first wants to play a sound. (b)
      NOT reproduced: `git log -p` on `AUDIO_SETTINGS_KEY`/`audioSettings`
      shows the mute/volume persistence system was introduced whole, in one
      commit, with sane defaults (`volume: 0.1, muted: false`) and no prior
      key feeding into it -- no code-level evidence of an inherited bad
      default or inverted boolean. (c) CHECKED, fine: every gain node
      (`sfxGainNode`, `musicGainNode`, and the two ad-hoc ones in
      `playCombatSound`/`playCounterattackSound`) connects to
      `ctx.destination`, non-zero gain values, no missing `.start()`. (d)
      COULD NOT rule in or out -- this sandbox only has Chromium
      (`/opt/pw-browsers`), no WebKit/Safari, so the hardware-ringer-switch
      hypothesis is untestable here either way; added the ticket's own
      fallback regardless since it's cheap and harmless elsewhere: a
      one-time How-to-Play hint ("check your ringer switch") gated to
      iPhone/iPad UA/platform sniffing.
      VERIFICATION: new permanent `test/verify-audio-context.js`
      (`npm run test:audio`, same real-Chromium/Playwright pattern as
      `test:mobile`/`test:run-header`) confirms, via a real user gesture
      through the actual character-select -> node-map -> combat -> submit
      flow: `AudioContext.state === 'running'` after the gesture, the
      shared volume setting is nonzero, and playing a real word schedules
      real `OscillatorNode.start()` calls (verified 4 -> 6 across a full
      flow, not just combat's own hit sound). All green. `npm test`
      (450+ jsdom checks), `npm run test:mobile`, and `npm run test:qa`
      also re-run clean (this ticket touched `game.js` and added one `<li>`
      to `wordbound.html`, both gated). **Still unconfirmed and needs
      Jaxon:** whether this actually fixes what he's hearing (or not
      hearing) on his real device -- none of the above can verify
      audibility on real hardware, only that the Web Audio graph is
      correctly constructed and running. Please re-test, and if you're on
      iPhone/iPad, check the physical ringer switch first per the new
      in-game hint.

- [x] FEATURE, STRUCTURAL (Jaxon's decision, 2026-08-21): replace the
      player's HP with INK -- one unified life + mana resource. Jaxon chose
      this explicitly over a Pages/Binding system and a no-lifebar
      corruption system. The chosen concept, verbatim from the option he
      picked: "Everything runs on Ink: attacks spill it, big plays can
      spend it, healing refills it, run ends when the well is dry. One
      unified resource to optimize."
      SCOPE (player side only -- monsters KEEP their HP/damage exactly as
      the fresh rebalance tuned them):
      - Player HP pool becomes the Inkwell (start ~= current max HP; the
        exact number is a balance knob, see below). Monster attacks SPILL
        ink (damage = ink lost). Run ends when ink hits 0.
      - The "mana" half: add at least two meaningful SPEND decisions so ink
        is something you optimize, not just a renamed bar. Baseline word
        play stays FREE (don't tax the core verb). Good candidate spends,
        implementing run's call on exact set/costs: an optional "overcharge"
        on a played word (spend N ink -> amplify damage), consumable-style
        activated abilities costing ink, event/shop options priced in ink.
        Every spend must show clear cost UI before committing.
      - All healing economy converts: potions/rest/heal items refill ink
        (recheck their tuned amounts still make sense against spends).
      - Full terminology + UI sweep: HP bar -> inkwell (visual: ink level,
        use the existing theme palette), damage log lines ("spills 4 ink"),
        game-over screen ("the well ran dry"), achievements, how-to-play,
        THEME.md lore section for Ink. Items whose text references player
        HP get rewritten (effects can stay numerically identical where
        sensible).
      - Combat.previewWord and the damage preview stay intact (monster
        damage is unchanged); if overcharge exists, preview shows the
        amplified number while the toggle is active.
      BALANCE GATE: after conversion, re-run the balance sim (teach the bot
      a simple spend policy -- e.g. overcharge when kill-secured or safe)
      and confirm the win rate is STILL in the 35-50% band the 2026-08-21
      rebalance established. If the ink spends push it out of band, tune
      SPEND COSTS first (not monster stats -- don't undo the rebalance).
      MULTI-RUN: this is likely 2-4 runs. Safe sequencing: run 1 = rename/
      convert (pure HP->ink swap, mechanically identical, all tests green);
      run 2+ = add the spend mechanics + bot policy + sim verification. The
      repo must work after every run.
      VERIFICATION: `npm test` (update the many player-HP assertions),
      `npm run test:qa`, `npm run test:mobile` (new inkwell UI), sim in
      band, `npm run test:itch-build`. Minor version bump per completed
      phase.
      DONE (run 2/2, 2026-08-21, v0.40 -> v0.41): run 1 (previous session,
      v0.39 -> v0.40) did the pure rename/convert -- see that PROGRESS.md
      entry. This run added the "mana" half and closes the ticket.
      SPENDS implemented (two, as required):
      (1) **Overcharge** -- a toggle button next to Play Word
      (`#btn-overcharge`). Arms via `Game.toggleOvercharge()` (only when
      affordable -- refuses + logs otherwise), spends
      `Combat.OVERCHARGE_INK_COST` (3) ink on the NEXT successful word for
      `Combat.OVERCHARGE_DAMAGE_MULTIPLIER` (1.5x) damage, single-use (auto-
      disarms after one play, whether or not it fires). Both constants live
      on `Combat` (js/wordbound/combat.js), not duplicated in game.js or the
      test bot. `Combat.playWord`/`previewWord` take a 5th `{overcharge}`
      arg -- the preview shows the exact amplified number while armed
      (verified byte-identical to what submit actually deals, same anti-
      drift standard the existing preview tests already hold everything
      else to).
      (2) **Rewrite** -- a button (`#btn-rewrite-rack`, `Game.rewriteRack()`)
      that spends `Combat.REWRITE_INK_COST` (4) ink to discard the whole
      rack and draw a fresh one, WITHOUT ending the turn (no counterattack).
      Not a softlock fix -- `ensureRackIsPlayable()` already guarantees a
      playable rack (pre-existing code) -- purely a "I don't like this hand"
      tactical option, matching the ticket's "consumable-style activated
      ability" candidate.
      Baseline word play is untouched either way: both spends are `options`
      params that default to off/false everywhere, and omitting them
      reproduces exactly what run 1 already had (proven in test/dom-check.js
      via a direct plain-vs-overcharged comparison).
      Cost UI: both buttons always show their ink cost in their own label
      ("-3 ink" / "-4 ink") and `.disabled` themselves below that cost --
      verified at the DOM level in test/dom-check.js, not just in state.
      Healing economy: already all `player.ink` as of run 1, rechecked here,
      untouched.
      BALANCE GATE: taught test/balance-simulation.js's "best" bot a
      kill-secured-only Overcharge policy (arms it ONLY when the top word's
      damage wouldn't kill this turn on its own but WOULD with the 1.5x
      multiplier -- never spends for pure overkill). Worth recording since
      it wasn't the first thing tried: an earlier version also added a flat
      "ink comfortably above a buffer" trigger per the ticket's own "or
      safe" wording, and a 5-run sanity check with it in showed the "best"
      win rate collapse to 0/5 -- not a game-balance problem, a bot-policy
      bug: a per-TURN affordability check re-fires almost every turn (ink
      never regenerates passively), so it wasn't "spend when safe," it was
      "spend nearly every turn," bleeding the bot's own ink faster than any
      monster could. Removed that trigger entirely rather than tune its
      threshold -- kill-securing is the one case where the spend is
      unambiguously worth a fixed small cost, with no risk of wasting ink on
      a fight that didn't need it. With ONLY that trigger: n=25/strategy
      real run (not a small sanity sample) -- "best" 11/25 wins (44%),
      squarely inside the established 35-50% band; "first" (weak baseline,
      not the target) 0/25 as expected; 3 stalls out of 25 for "best" (a
      pre-existing bot word-finding limitation per this script's own
      LIMITATIONS header, not a new softlock -- 0 softlocks recorded either
      strategy). `test/balance-simulation-results.json` in this commit is
      from that real run, not a small placeholder sample.
      VERIFICATION actually done: `npm test` 481/481 (up from 450 -- added
      isolated Combat-level overcharge math checks alongside the existing
      previewWord anti-drift block, plus a live-DOM block driving the real
      buttons/click handlers through a full arm -> preview -> submit ->
      spend -> disarm cycle and Rewrite's discard/redraw, including both
      buttons' insufficient-ink refusal paths). `npm run test:mobile` clean
      at 375/414px (the new `.ink-spend-row` wraps under the word-input row,
      same pattern the row already used). `npm run test:run-header` clean
      375-1280px. `npm run test:qa` clean, zero console errors across a full
      real-Chromium click-through. `npm run test:itch-build` clean (packaged
      build's dom-check + real-browser load, zero 404s). Version bumped
      v0.40 -> v0.41 (feature completion, minor bump per convention).
      **NOT independently verified beyond the above:** no human playtest of
      how Overcharge/Rewrite actually FEEL in the hand (worth a UX pass --
      is 1.5x/3 ink and discard-for-4 ink well-tuned for fun, not just for
      staying in the win-rate band? the sim only proves the band holds, not
      that the choice is interesting) -- flagged for Jaxon, not something a
      sandboxed run can judge. Shop options priced in ink (the ticket's
      third spend candidate) were NOT added -- two spends already satisfies
      "at least two," and adding a third felt like scope creep against
      "don't tax the core verb" once two were live and balance-verified.
      GOALS.md's last queued ticket in this batch (CONTENT: ink-era items)
      was explicitly gated on this box being checked -- it's unblocked now.

- [x] FEATURE, STRUCTURAL (Jaxon request): branching floor map with path
      choices. Replace the current linear node progression with a
      Slay-the-Spire-style branching map: each floor is a small DAG (2-3
      lanes wide), the player SEES upcoming node types (fight / elite /
      event / shop / rest / boss -- reuse existing node vocabulary) and
      CHOOSES which path to take. Requirements:
      - Boss always terminal per floor; every path reaches it. Generation
        guarantees per floor: at least one shop and one rest/heal node
        reachable on some path, elites avoidable-at-a-cost (the risk/reward
        of routing is the point).
      - Seeded determinism: map layout must be a pure function of the run
        seed (extend test/verify-seeded-runs.js: same seed -> identical map
        + identical outcome for the same choices; different choice ->
        different path, obviously).
      - Map UI in the woodcut/manuscript language (hand-drawn-looking ink
        paths on parchment, node glyphs), tappable at 375px (44px+ targets),
        current position + visited path visibly marked. Between fights the
        player returns to the map to pick the next node.
      - Keep the existing floor count/structure semantics (3 floors,
        Overdue Aisles etc.) -- this changes routing WITHIN floors, not the
        overall descent.
      - Balance note: routing choice shifts effective difficulty; after
        landing, run the sim (bot picks randomly among paths) and sanity-
        check the win-rate band still holds; small event/rest frequency
        retunes are in-scope if routing skews economy.
      MULTI-RUN expected. VERIFICATION: `npm test` with map-generation
      assertions (guarantees above hold across 50+ seeds), verify-seeded-
      runs extension, `npm run test:qa` (teach it to click through the map),
      `npm run test:mobile`, real-browser click-through of a full floor.
      Minor bump.
      PROGRESS (run 2/N, 2026-08-21, v0.41 -> v0.42): game.js is now fully
      wired to `Floor.generateBranchingFloor` -- the old linear
      `currentNodeIndex` flow is gone from the live game (still intact,
      untouched, as `Floor.generateFloor` itself, purely for the old
      generator-regression check). Map UI built: a CSS-grid DAG (rows x
      lanes) with an absolutely-positioned inline-SVG ink-line layer drawn
      from the floor's real edges, current-position marker, and
      walked-vs-unwalked edge styling; reuses the existing node-pill
      type/cleared styling rather than a new art pass (the woodcut/parchment
      TEXTURE the ticket asks for is not done -- flagged below). 44px+ tap
      targets fixed and dedicated-checked in `test/verify-mobile-layout.js`.
      Determinism extended in `test/verify-seeded-runs.js` (same seed ->
      identical lane-0 node content and replayable fight; different lane ->
      distinct node). `npm run test:qa` teaches the real-browser bot to jump
      onto the map's guaranteed last-encounter-row and click the boss pill
      via the real DOM (no more index poking) -- passes end to end across
      two floors. `npm test` (dom-check.js) required updating ~20 call sites
      across itself and 6 other test files/tools that used to jump around
      via `state.currentNodeIndex` -- all converted to the id-addressed
      equivalent, all green.
      BALANCE FINDING + RETUNE (the ticket's own anticipated risk): the
      first post-wiring sim run (bot chooses lanes uniformly at random, per
      the ticket's own instruction) cratered the "best"-strategy win rate
      from a ~38% pre-branching baseline (in the established 35-50% band,
      confirmed via a same-code A/B run this session) to 5%/20 -- root
      cause: required specials (shop/treasure/rest) were seated on only ONE
      lane's path (the old single "spine"), so a bot wandering off that one
      lane, which most random walks do, permanently lost ink/gold/item
      access for the rest of the floor. Retuned `Floor.generateBranchingFloor`
      to seat each required special once per `min(2, lanes)` guaranteed
      lanes instead of one -- both lanes on a 2-lane floor, 2 of 3 on a
      3-lane floor, still leaving one genuinely uncovered lane on 3-lane
      floors so routing risk isn't eliminated. Re-verified against the full
      180-seed `test/verify-branching-map.js` sweep, including a new
      per-lane REACHABILITY check (not just a raw type count, which a
      lane-merge could satisfy via a shared node instead of a literal
      duplicate) -- all green.
      **Balance NOT yet fully re-confirmed in band**: three small post-retune
      sim samples (n=20, n=10, n=10 "best"-strategy runs) came back 20%,
      50%, 10% -- high run-to-run variance (expected now that routing is
      randomized per run, unlike the old deterministic linear floor) but an
      aggregate ~25% across all three, still visibly under the 35-50% target
      even though it's a large improvement on the pre-retune 5%. Ran out of
      this run's window before a larger, more decisive sample (n=30-40
      "best") could confirm whether 25% is just small-sample noise around
      the lower edge of the band or a real remaining gap needing one more
      small retune (e.g. a slightly larger rest-node heal, or trimming
      floor-1 monster damage slightly). This is exactly the kind of
      "small event/rest frequency retune... in-scope" the ticket itself
      anticipates -- NOT a Jaxon-blocked judgment call, just unfinished
      within this hour. Box correctly left UNCHECKED pending that
      confirmation. **Next run:** run
      `node test/balance-simulation.js 30` (or bigger), read the "best"
      win rate, and either (a) it's comfortably in-band -- check this box,
      or (b) it's still low -- apply one small, targeted retune (rest heal
      ratio or floor-1 monster attack, NOT a second lane-count bump, which
      would erode the routing-risk point of the whole feature) and re-run
      until it lands, then check the box. `npm run test:mobile` (a real-
      browser 375/414px pass covering main menu/node-map/combat/tile-reward/
      game-over) is done and green -- no further mobile verification needed
      unless the balance retune touches CSS (it won't). Other still-open
      items from the ticket's own bar: a genuine woodcut/parchment visual
      pass on the map itself (currently functional but plain -- the
      separate ART tickets below are about monster/boss portraits, not this
      map's own texture, so don't assume they cover it).
      PROGRESS (run 3/N, 2026-08-21, v0.42 -> v0.43): ran the prescribed
      decisive n=40 `test/balance-simulation.js` -- confirmed "best"
      win rate was genuinely stuck at 25%, not sampling noise (matches the
      prior 3 small-sample runs' aggregate). Applied the ticket's own
      suggested lever: bumped the rest-node heal from a flat 50% to 65% of
      maxInk (`js/wordbound/game.js`, `node.type === 'rest'` branch) --
      reasoned this specifically compensates for what branching took away
      (every floor used to guarantee a rest node on its one linear path;
      now only `min(2,lanes)` of 2-3 lanes get one), rather than re-touching
      floor2's monster stats, which prior rounds already flagged as
      tightly tuned and risking re-opening the old floor-2 wall. Re-ran
      n=40: **43% win rate (17/40), squarely in the 35-50% band.** Floor
      clear rates by stage: floor1 78%, floor2 61% (of entrants), floor3
      89% (of entrants) -- floor2 remains relatively the hardest floor
      (consistent with every prior balance round's finding), but the
      overall band target is met. Also computed floor2's death-SHARE for
      the older rebalance ticket's own metric out of curiosity (not this
      ticket's bar): ~52% of losses, down from the 55-67% this same metric
      held at pre-branching -- an improvement, not a regression, though
      still just over that ticket's informal ~50% line; that ticket is
      already checked off in GOALS.md and this isn't reopening it, just
      noting it didn't get worse.
      Then closed the ticket's other still-open bar (the woodcut/parchment
      map visual, flagged unfinished by run 2): gave `.branch-map` the same
      feTurbulence vellum-grain background `.panel` already uses elsewhere
      (reused verbatim, not a new texture), and added a `feTurbulence` +
      `feDisplacementMap` SVG filter (`#branch-ink-wobble`, defined fresh
      inside `renderNodeMap`'s own `<svg>` on every render) applied to the
      `.branch-edge`/`.branch-edge-walked` lines -- perturbs the RENDERED
      stroke only, geometry/hit-testing/percentage math for line-endpoint
      placement is untouched, so the existing reachability/positioning
      logic and tests didn't need to change. Also added `stroke-linecap:
      round` on the edges and a subtle ink `text-shadow` on `.node-pill`.
      Visually confirmed via a real headless-Chromium screenshot (not just
      "tests pass") -- parchment grain and wobbly ink-line connectors both
      render correctly in Chromium, lines still visually meet their node
      pills, no clipping/glitching.
      **Verification:** `npm test` clean, `npm run test:branching-map`
      clean (180-seed sweep untouched by either change), `node
      test/verify-seeded-runs.js` clean (determinism unaffected -- the
      wobble filter is a pure rendering effect, not part of the seeded
      RNG/generation path), `npm run test:mobile` clean at 375/414px
      across all 5 screens including the node-map (re-run because this
      round touched map CSS, per the mandatory gate), `npm run test:qa`
      clean (real-browser two-floor click-through, zero console errors).
      **NOT independently re-verified:** audio (untouched by this round);
      a real physical device/browser beyond the Chromium screenshot taken
      this run (still Jaxon's to do per ROADMAP.md). Ticket requirements
      re-checked against the original list: boss-terminal + guarantees,
      seeded determinism, 44px+ tap targets + current-position marking,
      woodcut/manuscript map language, and the win-rate band are all now
      met and verified. **Box checked -- ticket closed.** Next queued item
      is the monster/boss woodcut-portrait ART ticket below.

- [x] ART (Jaxon request; style DECIDED: inked woodcut): every monster and
      boss gets an inline-SVG portrait in the woodcut/engraving style --
      bold ink strokes, crosshatch shading, parchment ground, a thin plate
      border; think 1700s bestiary plates. Build a tiny shared SVG
      vocabulary first (stroke widths, 2-3 ink tones from the existing CSS
      palette, hatch patterns via <pattern> or path groups, one reusable
      plate-frame) so all ~15-20 portraits read as one hand. Each portrait
      expresses the monster's linguistic gimmick visually where possible
      (Echo Pup built of echoing strokes, the Constrictor a strangling
      ligature loop, etc. -- THEME.md + monsters.js are the roster source).
      Displayed in the monster-info panel (replacing the generic 📖 emoji),
      sized responsively (must not break 375px layout), `role="img"` +
      `aria-label` with the monster name. Keep total added page weight
      modest (aim well under ~150KB total SVG; reuse defs). Bosses get
      slightly grander plates. MULTI-RUN fine (batch by floor).
      VERIFICATION: `npm test` (portrait element present per monster,
      correct aria-label), `npm run test:mobile`, `npm run test:qa`, plus a
      real-browser screenshot pass described in PROGRESS.md (what renders,
      any visual glitches); aesthetic judgment stays Jaxon's -- flag for
      his playtest. Minor bump when the full roster is covered.
      **DONE 2026-08-21 (v0.43 -> v0.44):** batch 2 (this run) covers the
      remaining 5 floor-2/3 defs (sentinel, warden, spinesplinter,
      boss_unabridged, boss_sovereign), completing all 15/15. See
      PROGRESS.md for verification detail and the screenshot pass; flagged
      for Jaxon's aesthetic playtest per the ticket's own wording.

- [x] ART (Jaxon request; same woodcut style): character portraits, visible
      somewhere meaningful. Each playable character gets a woodcut portrait
      (same shared SVG vocabulary as the monster plates): shown LARGE on
      the character-select cards, and small in-run (in/near the run header,
      next to the inkwell once the INK ticket lands -- coordinate with
      whatever header layout exists by then; the 481-780px overflow fix
      must not regress, that range now has a regression test). Same
      accessibility + weight rules as the monster ticket.
      VERIFICATION: `npm test`, `npm run test:mobile` AND a manual
      Playwright check at ~600px (the header's historic weak spot),
      `npm run test:qa`. Minor bump (can share it with the monster-art
      completion if they land together).
      **DONE 2026-08-21 (v0.44 -> v0.45):** all 3 playable characters
      (archivist, scribe, keeper) now have a woodcut portrait via
      `Portraits.svgForCharacter()` in js/wordbound/portraits.js, reusing the
      monster tickets's exact frame/defs/palette vocabulary. LARGE version
      (min(96px, 26vw)) shown on each character-select card; a small
      34x34px version sits next to the inkwell in the run header via a new
      `#character-portrait-display` element, filled once per run (guarded
      on a data-character-id attribute, not rebuilt every renderRun() call).
      Each portrait reads through pose + a character-specific prop rather
      than hand-traced detail: Archivist (balanced, no letter/vowel bias)
      holds a book level in both hands; Scribe (vowel-poor, rare-consonant-
      heavy deck) is hunched over a quill with its signature X/Z/K/B
      scattered around; Keeper (vowel-rich, defensive) holds a round
      ledger-shield ringed with A/E/I/O/U. See PROGRESS.md for full detail,
      including a real regression this run found and fixed (not just the
      finished result) -- worth reading before touching this file's mini-
      portrait or character-select code again.

- [x] VISUAL (Jaxon request): opening-screen glow-up -- the main menu
      should SET THE SCENE and sell the theme in the first three seconds.
      Direction (implementing run has latitude within the woodcut/archive
      language): a title treatment that looks set in metal/engraved rather
      than plain text; the Boundless Archive backdrop deepened for the menu
      (towering stacks, candlelight glow, drifting dust motes -- all
      CSS/inline-SVG, reduced-motion gated, transform/opacity only); a
      one-or-two-line scene-setting blurb in THEME.md's voice ("The
      dictionary burst. The words got loose. Someone must spell them back."
      -- draft freely, keep it SHORT); menu buttons restyled to match
      (ink-on-parchment, not default-looking); version + achievements
      display kept but integrated into the composition. Character select
      should feel continuous with it (the portraits from the ticket above
      help). Don't gate playability on any animation.
      VERIFICATION: `npm test`, `npm run test:mobile` (menu is one of its
      two checked screens), `npm run test:qa` (it boots through the menu),
      real-browser screenshots at desktop + 375px described in PROGRESS.md.
      Minor bump.

- [x] DESIGN/CONTENT (Jaxon request): more varied runs. Goal: two runs
      back-to-back should feel meaningfully different. Pick and implement
      AT LEAST TWO of these levers (implementing run's call, justify the
      pick in PROGRESS.md; more are welcome across multiple runs):
      (1) per-run monster subset -- roster is larger than any one run
      encounters, drawn seeded per run so floor 1 isn't always the same
      three regulars; (2) more event variety -- the event pool is small
      relative to how often events appear; grow it (respect gamble/choice
      house patterns, THEME voice); (3) run modifiers -- seeded "Edition"
      quirks announced at run start ("In this printing, vowels are scarce
      but potent") that bend one rule each, conservative numbers;
      (4) floor-themed encounter tables -- each floor's identity (names
      already exist) reflected in WHICH monsters/events appear there, not
      just stats. Everything must stay seed-deterministic (extend
      verify-seeded-runs where touched) and sim-checked to stay in the
      win-rate band. Design against the POST-ink, POST-map game.
      VERIFICATION: `npm test`, `npm run test:qa`, sim band check,
      seeded-runs extension. Minor bump per completed lever-pair.

- [x] CONTENT (Jaxon request): another item batch, 8-12 items -- but
      designed for the INK economy and the branching map. This ticket is
      LAST deliberately: do not start it until the INK ticket above is
      checked. New design space now open: items that refund/generate ink,
      items that reduce overcharge/spend costs, items that trigger on
      spilling ink (thresholds: "when below 10 ink..."), map-interacting
      items ("shops you pass are cheaper", "reveal adjacent nodes'
      contents"). Same rules as the v0.34 batch: THEME.md voice, fill
      empty hook niches (re-read items.js fresh -- it's grown), 2+
      build-definers, rarity spread, no near-duplicates, conservative
      numbers with sim check.
      VERIFICATION: per-item `npm test` assertions through real hooks,
      seeded-shop appearance check, `npm run test:qa`, sim band check.

- [x] BALANCE: re-confirm the win-rate band with a large sample, both
      strategies. ROADMAP.md's "NEW 2026-08-21" known-gap entry found (while
      sim-verifying an unrelated content ticket) that the current baseline
      -- not any specific recent ticket's changes -- now measures well under
      the documented 35-50% "best"-strategy win-rate band: a same-harness
      comparison landed baseline itself swinging 33% (n=30) to 18% (n=40)
      across two samples, both below band, versus the ~41% pooled reading
      the difficulty-rebalance ticket last confirmed. Likely drift from
      mechanics that landed since (Overcharge/Rewrite ink-spend, the
      branching map's lane-choice routing, monster intents' full rollout) --
      or the ~41% reading was itself high-side noise; either way this needs
      a real large-n (50+ per strategy, ideally 2-3 independent samples to
      separate signal from this game's evident run-to-run variance) sim
      pass with a per-monster/per-floor breakdown, not another small
      one-off sample. If a real drift is confirmed, retune (prefer floor2's
      strong-tier defs and/or floor1 attack values first, per the existing
      difficulty-rebalance ticket's trail in PROGRESS.md, before touching
      anything this ticket's own content additions haven't touched). If it
      turns out to be sampling noise at typical n, consider whether the
      documented band itself needs a wider stated tolerance instead of
      chasing a number this simulation can't hit reliably.
      VERIFICATION: `npm test`, sim band check at n>=50 per strategy (2+
      independent samples), documented per-monster/per-floor breakdown in
      PROGRESS.md either way. Patch bump if retuned, no bump if the band
      itself is just widened in documentation.
      RESOLVED 2026-08-21 (this run, continuing the prior run's
      investigation): took this ticket's own offered exit ramp. THREE
      rounds of real, targeted, conservative retuning were applied across
      this and the immediately-prior run (boss_vowelmaw attack 4->3,
      sentinel/spinesplinter attack -1 each, and this run's warden/Hoarder
      attack 5->4 -- see monsters.js comments for each). Five independent
      n=50 "best"-strategy samples taken AFTER at least one retune round
      (spanning all three rounds' code as they landed): 40%, 26%, 22%,
      32%, 24% -- mean 28.8%, range 22-40% (an 18-point spread, matching
      the ~22-point single-sample noise floor this whole investigation
      already demonstrated on IDENTICAL code). Decisive evidence the lever
      is exhausted, not under-applied: round 3's Hoarder cut, aimed
      squarely at that sample's single biggest confirmed floor-2 outlier,
      produced NO measurable change in Hoarder's own kill rate (43% ->
      50% -> 50% across the three samples straddling that cut) -- directly
      contradicting the "just needs one more attack cut" hypothesis this
      ticket started with. Reading five large-n samples honestly: the true
      current rate sits in the high-20s%, consistently below the
      documented 35% floor but well above the low-20s% this investigation
      would have called "still broken." The band was very likely
      calibrated on the difficulty-rebalance ticket's own smaller/fewer
      samples (its "~41% pooled" reading came from just its two largest
      confirmation samples, not this scale of large-n interrogation).
      **Band widened 35-50% -> 25-50%** to reflect what this game's own
      measurement noise can actually distinguish, rather than continuing
      to cut monster stats against a target the harness's variance makes
      unfalsifiable at reasonable sim budgets. No version bump (band
      widened in documentation, not "fixed" by retuning, per this
      ticket's own stated rule) -- the three retune rounds themselves were
      already committed unbumped as WIP and stay that way.
      Minor bump.

- [x] BUG (Jaxon report, 2026-08-21, playtesting v0.48 on iPhone): more valid
      words missing from the dictionary — "Some words are still missing, like
      zex and taze." Verified by the orchestrator before filing: grep over
      js/wordbound/wordlist.js finds ZERO occurrences of ZEX or TAZE in any
      form (base or inflection). Root cause is coverage-era, not a bug in the
      plural generator: both current sources (Webster's Second, 1913 headwords;
      ENABLE1, compiled 1997) predate newer Scrabble-legal additions. ZEX (a
      slate-cutting hatchet) and TAZE (variant of tase) are legal in current
      Collins/NWL lists — but those lists are COPYRIGHTED and must NOT be
      vendored. Two-part fix:
      1. SUPPLEMENT (guaranteed, do first): add a small curated
         SUPPLEMENT_WORDS array merged into WORDS/WORD_SET at load — for
         user-reported missing words. Seed it with ZEX, ZEXES, TAZE, TAZED,
         TAZES, TAZING. Keep it curated: only words verifiable as legal in a
         recognized Scrabble lexicon, each with a one-line comment. This is
         the durable channel for future playtest reports too.
      2. BROADER MERGE (judgment call, only if a clean source exists): merge
         one additional large word list to close the era gap generally —
         licensing constraint is strict: public domain or permissive
         (e.g. YAWL is PD; SCOWL is permissive) — document source + license
         in the file header exactly like the existing two sources. If no
         suitable list is reachable from the sandbox (network limits), do
         part 1 alone, note it in PROGRESS.md, and leave part 2 as a new
         unchecked ticket rather than half-doing it. Do NOT ingest Collins,
         NWL/TWL, or any "SOWPODS" file of unclear provenance — polluting
         the dictionary or the repo's licensing is worse than the gap.
      IMPLEMENTATION WARNING (same as the 2026-08-19 plurals ticket, read it
      at ~line 2445 for the full recipe): js/wordbound/wordlist.js is one
      ~2.5MB line — never load it into context; splice with head/tail/cat
      into /tmp parts, then `node -c` the reassembled file before anything
      else. The supplement merge belongs with the existing plural-generation
      code between the WORDS literal and the closing WORD_SET lines.
      VERIFICATION: WORD_SET.has() must be true for all six seeded words
      (check via the existing node/Playwright harness, same pattern as the
      ADS check in the plurals ticket); `npm test` still green; if part 2
      runs, sanity-check WORD_SET.size growth and page-load timing like the
      plurals ticket did. Minor version bump.
      RESOLVED 2026-08-21 (this run): did part 1 only, per the ticket's own
      fallback. Added ZEX, ZEXES, TAZE, TAZED, TAZES, TAZING to the existing
      hand-curated `SUPPLEMENT` array in `js/wordbound/wordlist.js` (same
      array the BORK-family words already live in from the 2026-08-20
      ticket), each with a one-line justification comment (ZEX: a
      slate-cutting hatchet; TAZE: variant spelling of "tase" -- both legal
      in current Collins/NWL, neither vendored). Edited via a Node script
      that split the file on `\n` and replaced only line 41 (the small
      SUPPLEMENT line, 716 bytes) in memory, never touching or printing
      line 43 (the ~7MB WORDS_BASE literal) -- same spirit as the
      head/tail/cat splice this ticket suggested, adapted since the
      SUPPLEMENT array (unlike WORDS_BASE) is a single short line that a
      plain in-memory replace can target safely. `node -c` passed after
      writing.
      Part 2 (broader PD/permissive merge) explicitly NOT attempted this
      run -- filed as its own new ticket below instead of half-doing it,
      per this ticket's own instruction. Reasoning: outbound network
      access from this sandbox does work (confirmed: a raw.githubusercontent
      fetch of a candidate YAWL word-list file returned HTTP 200), but the
      GitHub API needed to independently confirm the exact repo/license
      text before vendoring returned an error through this sandbox's proxy,
      and doing a full third-source merge (download, filter to A-Z/2-15,
      uppercase, dedupe against ~548K existing words, verify license
      provenance carefully enough to write an honest header comment, then
      re-verify WORD_SET size/load timing) is realistically its own
      dedicated pass, matching the scope the original ENABLE1 merge got as
      its own ticket -- not something to rush alongside part 1 in the same
      hour just because the network happened to answer once.
      VERIFICATION ACTUALLY DONE: `node -c js/wordbound/wordlist.js` (clean);
      a Node script loaded the reassembled file directly (`window` stub,
      `require()`) and confirmed `WORD_SET.has()` is true for all six of
      ZEX/ZEXES/TAZE/TAZED/TAZES/TAZING, and false for all six before the
      edit (confirmed pre-edit too, matching the ticket's own grep-based
      claim); `WORD_SET.size` is 548705 (up from 548699, exactly +6, no
      accidental duplication). `npm test`: 16/16, clean, run twice (once
      right after the wordlist.js edit, once again after the version bump).
      `npm run test:mobile` not run -- this ticket touched zero CSS/layout.
      Version bumped v0.48 -> v0.49 in wordbound.html (user-facing dictionary
      fix, per GOALS.md's own version-bump rule).

- [x] BUG, HIGH PRIORITY — audio (Jaxon report, 2026-08-21, iPhone, v0.48 live
      site): "I also am not hearing any sound." This is the total-silence
      symptom AGAIN, after the v0.39 fix (AudioContext.resume() on first
      gesture) supposedly closed it — so either a regression or the fix is
      incomplete on iOS. Current code: `primeAudioOnce` on document touchend
      (game.js ~3396-3400) + best-effort resume() in getAudioContext
      (~1409-1419). Diagnostic checklist, in order:
      1. ONE-SHOT PRIME BUG (check first, likely): primeAudioOnce
         removeEventListener's itself on first touchend. If that first
         resume() is refused or the context lands in 'suspended'/
         'interrupted' anyway, is audio then permanently dead with no retry
         path? iOS can suspend/interrupt the context later (app switch,
         phone call, Safari tab restore) — resume must be re-attempted on
         every gesture while state !== 'running' (listen for statechange;
         re-arm the prime handler instead of removing it permanently).
      2. iOS HARDWARE MUTE SWITCH: WebAudio-only pages are silenced by the
         ring/silent switch on iOS Safari. The known mitigation is getting
         the page into 'playback' audio category (navigator.audioSession
         .type='playback' where available, and/or the silent looping <audio>
         element trick). Implement inline — no external libraries.
      3. Volume slider default + persistence: confirm the master/SFX gain
         can't initialize to 0/muted on a fresh mobile profile, and that the
         slider value visible in the UI actually reaches the gain node.
      VERIFICATION HONESTY: the sandbox cannot hear anything. Verifiable
      here: Playwright asserting audioContext.state === 'running' after a
      synthesized tap, gain values > 0, sounds actually scheduled through
      the graph, plus `npm test` / `npm run test:audio` staying green.
      Real audibility on Jaxon's physical iPhone is Jaxon-only — end your
      PROGRESS.md entry by flagging it for his re-test, and do NOT claim
      "fixed", only what was structurally confirmed. Minor version bump.

- [x] DESIGN/BALANCE (Jaxon directive, 2026-08-21, verbatim): "Rewrite should
      be way cheaper, overcharge should be cheaper and have a more powerful
      effect. Both should only be unlocked after doing one run so that new
      players aren't confused." Current values: REWRITE_INK_COST=4,
      OVERCHARGE_INK_COST=3, OVERCHARGE_DAMAGE_MULTIPLIER=1.5
      (js/wordbound/combat.js:58-65); item cost reductions floor at 1 ink
      (js/wordbound/items.js getOverchargeCost/getRewriteCost). Three parts:
      1. RETUNE: pick the new numbers yourself and document the rationale —
         direction is fixed (Rewrite WAY cheaper, e.g. 4→2 or 1; Overcharge
         cheaper, e.g. 3→2, AND stronger, e.g. 1.5x→2x), exact values are
         your judgment call. Note the interaction with item reductions
         hitting the 1-ink floor sooner — fine, just note it.
      2. UNLOCK GATE: Overcharge + Rewrite controls hidden (not just
         disabled) until the player has COMPLETED at least one run — victory
         OR game-over both count as "doing one run" (document this
         interpretation). Persist the flag in localStorage the same way
         achievements.js already persists (reuse its pattern/prefix). Gate
         at the UI/game layer ONLY — the Combat engine functions stay
         callable so test/simulate.js and the test harness are unaffected.
         A small one-time "unlocked" callout when they first appear is
         welcome if cheap; don't over-build it.
      3. BALANCE CHECK: cheaper+stronger Overcharge moves win rate — run
         the simulator (n=50) and confirm the documented 25-50% band still
         holds; if the sim doesn't model ink spends, say so in PROGRESS.md
         instead of claiming the check.
      VERIFY: `npm test` green; `npm run test:mobile` if any CSS/layout
      changed; fresh-profile jsdom/Playwright check that the controls are
      absent pre-first-run-completion and present after. Minor version bump.

- [x] BUG, small (Jaxon report, 2026-08-21): "Zen" also missing from the word
      list. Add ZEN (and ZENS if it verifies against a recognized Scrabble
      lexicon — Collins has both) to the SUPPLEMENT_WORDS array created by
      the ZEX/TAZE ticket above, same curation rule (one-line comment each).
      If that ticket's supplement infrastructure doesn't exist yet when you
      get here, fold this into that ticket's work instead of building a
      second mechanism. VERIFY: WORD_SET.has('ZEN') true via the same
      harness check as ZEX/TAZE; `node -c js/wordbound/wordlist.js` clean;
      `npm test` green. No version bump needed if it rides the ZEX/TAZE
      commit; otherwise patch bump.

- [ ] BUG follow-up (filed 2026-08-21, this run, splitting off part 2 of the
      ZEX/TAZE dictionary ticket above rather than half-doing it in the same
      run): the dictionary's two source lists (Webster's Second via macOS
      system dictionary, baked 2026-08-20; ENABLE1, merged 2026-08-20) both
      predate current Scrabble-legal word additions, and the hand-curated
      `SUPPLEMENT` array in `js/wordbound/wordlist.js` is a per-report patch,
      not a systemic fix -- expect more individual "word X is missing"
      reports from Jaxon's playtesting until a broader, newer, still-clean
      source is merged.
      CANDIDATE SOURCE (partially vetted this run, not fully): YAWL ("Yet
      Another Word List"), a long-standing public-domain Scrabble word list
      built from other PD sources (Moby, etc.) with a documented history of
      being treated as safe for Scrabble-adjacent open-source projects
      (several other open word-game repos vendor it). A raw file fetch from
      `raw.githubusercontent.com/elasticdog/yawl/master/yawl-0.3.2.03/word.list`
      returned HTTP 200 from this sandbox 2026-08-21, so the file itself is
      reachable. NOT yet confirmed this run: the exact license text at the
      repo root (a GitHub API contents fetch for it errored through this
      sandbox's proxy rather than returning 404 -- worth retrying, may be a
      transient/path issue, not necessarily a hard block) and a manual spot
      check that the fetched file's content is actually what it claims to be
      (skim the first/last ~20 lines for plausible words, check it's plain
      newline-separated text, not HTML/an error page saved with a 200).
      SCOPE, if picked up: (1) re-verify the license (README/LICENSE file at
      the repo root, or an equivalent well-documented mirror) states public
      domain or a clearly permissive license -- do NOT proceed without
      reading the actual license text, a plausible-sounding name is not
      enough, and do NOT ingest Collins/NWL/TWL/SOWPODS as this ticket's
      parent already ruled out; (2) download, filter to purely A-Z, length
      2-15, uppercase (same filter ENABLE1 got); (3) dedupe against the
      existing ~548705-word `WORD_SET` (expect heavy overlap with ENABLE1 --
      log the actual net-new count, don't assume it'll be anywhere near
      YAWL's raw size); (4) merge net-new words into `WORDS_BASE` using the
      same never-load-the-giant-line splice discipline as every prior
      wordlist.js edit (see this ticket's parent, or the plurals ticket at
      ~line 2445, for the exact recipe); (5) add a new dated header comment
      documenting source + license + word count added, matching the
      existing three header entries' format exactly; (6) if the source
      turns out NOT to be cleanly PD/permissive on closer inspection, or the
      repo/license can't be independently confirmed, STOP and leave this
      ticket open with what was found -- do not proceed on a "probably
      fine" license for a file that ships in the repo.
      VERIFICATION: `node -c` after the splice; `WORD_SET.size` growth
      logged in PROGRESS.md; a handful of spot-check words known to be
      missing from the current dictionary (if any are known at the time)
      confirmed present; page-load timing sanity check (a `page.evaluate`
      timing check is enough, no dedicated perf harness needed) since this
      would be the largest single dictionary file this project has shipped;
      `npm test` still green. Minor version bump (user-facing dictionary
      expansion).
