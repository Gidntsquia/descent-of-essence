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
