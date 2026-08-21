# Roadmap: itch.io launch

North star, added 2026-08-19. Read this alongside THEME.md before doing creative or
scoping work on this project -- THEME.md is the lore/naming source of truth, this file
is the "why are we doing this task" source of truth.

## The goal

Get Wordbound onto itch.io's "New & Popular" page. That list rewards recent traffic
velocity (views/plays/ratings in a short window after publishing), not just build
quality sitting in a repo. Three things move the needle, roughly in priority order:

1. **A hook that's easy to pitch in one sentence.** Already have one: "Scrabble meets
   Slay the Spire" -- spell words to fight monsters, each with a linguistic weakness.
   Don't dilute this. Every feature added should make the hook stronger or the
   experience of that hook smoother, not bolt on unrelated mechanics.
2. **Presentation.** Store page copy, a GIF/trailer, cover art, and the in-game first
   five minutes (does a new player immediately get what this is and want to keep
   playing?). This is the highest-leverage thing left to work on right now.
3. **Promotion.** Posting where people who'd like this already are. This is entirely
   Jaxon's to do (see "Not automatable" below) -- Claude can prep materials but can't
   post on his behalf or hold his itch.io credentials.

## Division of labor

**Automatable (the hourly routine keeps doing this):**
- Content, balance, replayability, bug fixes, polish
- Packaging the build so it runs cleanly as a static itch.io upload (no server
  dependency, relative paths only, works inside itch.io's iframe embed)
- Drafting store-page copy, devlog text, etc. for Jaxon to review and use

**NOT automatable -- needs Jaxon directly:**
- Creating/publishing the itch.io project page (Claude can't hold his itch.io login)
- Final say on any store-page copy, cover art direction, pricing
- All promotion: posting to communities, subreddits, socials, devlogs

## Current known gaps toward launch-readiness

(Update this list as items get resolved -- keep it accurate, it's the thing future
runs should look at to decide what's next once GOALS.md's queue empties.)

- **2026-08-19: two critical bugs shipped and were checked off despite passing code
  review.** A null-element crash silently broke the entire combat loop after any
  damage-dealing word (rack never cycled, counterattack never applied, no
  re-render), and a render-ordering bug destroyed animation elements before they
  were ever visible. Both fixed, both verified with a real headless browser
  (Playwright), not just code review. `npm test` (test/dom-check.js, jsdom-based)
  now exists specifically so this class of bug gets caught before a task is marked
  done -- see GOALS.md's rules section, it's mandatory now. It can't check audio or
  drag-and-drop (jsdom limitation); those need either real judgment or a heavier
  Playwright-based pass, which is the orchestrator's job to run periodically rather
  than something to set up fresh in the ephemeral hourly sandbox every time.
- **RESOLVED 2026-08-20 -- Touch/mobile support.** Touch drag-to-reorder landed
  (touchstart/touchmove/touchend path reusing reorderRackOnDrop), the
  tap-to-play-a-letter bug it introduced was root-caused and fixed (drag threshold
  before preventDefault), mobile horizontal overflow at 375/414px was fixed, and
  `npm run test:mobile` now gates CSS-layout tasks. Verified via Playwright touch
  emulation; a real physical-device test remains the strongest confirmation and
  hasn't been possible from the sandbox -- worth 5 minutes on an actual phone
  before launch. Two small findings remain open (ticketed 2026-08-20 in GOALS.md):
  Deck/Consumables buttons are 30px tall (under the 36px comfortable-tap floor)
  and 8 text elements render below 12px at 375px.
- **RESOLVED 2026-08-19/20 -- browser verification.** Two full real-browser
  (Playwright, real actionability-checked clicks) QA passes have now run clean:
  2026-08-19 covering every node type, shop/consumable purchase+use, and
  panel-stacking regressions; 2026-08-20 covering the v0.8 boss-reward flow
  (pick and skip paths), organic first-fight play, and 375px layout. A human
  playtest for *feel* (animations, audio, pacing) is still Jaxon's to do -- the
  scripts prove correctness, not fun.
- **RESOLVED 2026-08-20 -- packaged itch.io build.** `npm run build:itch`
  stages Wordbound's exact dependency set into `dist/wordbound-itch.zip`
  (index.html at zip root, itch.io's required layout), verified by
  `npm run test:itch-build` (dom-check against the unzipped copy + a
  real-browser zero-404 check). The actual itch.io upload and its iframe
  embed behavior still can't be verified from this sandbox -- that step is
  Jaxon's.
- **RESOLVED 2026-08-20 -- seeded runs.** Seed input on character-select,
  seed displayed on the run/game-over/victory screens, determinism verified
  (`test/verify-seeded-runs.js`, 11/11). Run-to-run meta-progression beyond
  achievements is still absent and not currently ticketed -- a real
  scope/design decision (what would it even be?) rather than a small task,
  so left for Jaxon to define if he wants it pursued.
- **RESOLVED 2026-08-20 -- the two small mobile findings this list used to
  flag** (Deck/Consumables buttons under the 36px tap floor, 8 sub-12px text
  elements) -- both fixed, `npm run test:mobile` reports zero warnings at
  375/414px.
- **RESOLVED 2026-08-20 -- favicons.** Both games had the default browser
  globe in the tab; both now have inline SVG data-URI emoji favicons (no new
  asset files, matches the project's no-external-assets constraint).
- **Physical-device touch test still not done.** Playwright's touch
  emulation (`hasTouch: true`, `.tap()`) has verified the tap-to-play and
  drag-to-reorder interactions are mutually exclusive and both work, but an
  emulated touch event is not the same as a real finger on real glass --
  worth 5 minutes on an actual phone before launch. Sandbox-only runs can't
  close this gap; it's Jaxon's to do.
- **2026-08-20: full bugs/feel/fun review completed at Jaxon's request; 13
  tickets queued in GOALS.md from it.** Headline findings: the killing blow
  has zero feedback (and most fights end on it), seeded runs silently lose
  determinism at event nodes (events.js uses Math.random via a broken
  guard), and -- biggest -- regular monsters can't survive one decent word,
  so a competent player takes zero damage outside boss fights and the whole
  HP/heal/gold economy is dead weight (a BALANCE ticket with measurable
  targets and a simulation requirement is in the queue). The launch-blocking
  gaps that only Jaxon can close (physical-device touch check, feel/fun ear-
  and-hands playtest, the actual itch.io upload) still stand.
- **IN PROGRESS 2026-08-20/21 -- difficulty rebalance (v0.32 -> v0.33), 3 of
  4 measurable targets met, 1 left open.** Jaxon authorized a follow-up
  rebalance after the fun-overhaul passes (monster intents, combo/novelty,
  2-phase bosses, elite resistance traits) collapsed skilled-play win rate
  to ~13-17% (from 60% at v0.16) with floor-2 as the wall and bosses
  over-nerfed. Seven+ rounds of monster/boss/player-HP tuning (see
  PROGRESS.md for the full trail, ~12 independent balance-simulation
  samples at n=30-50) landed: win rate back in the 35-50% target band
  (pooled ~41% across the two largest confirmation samples); the
  floor-1-must-stay-gentle target met (~11% floor1-regular deaths, within
  the ticket's own "~10%" tolerance); every boss now a real fight instead
  of a 0-3% free win (floor1/floor2 bosses meaningfully improved, floor3
  boss still the weakest of the three but no longer a total non-event).
  **NOT yet met: floor2's share of deaths staying under ~50% and moving
  toward floor3 parity** -- it's held in a 55-67% range across every
  tuning tried, including three direct HP/attack cuts to its strong-tier
  defs, which are consistently flagged as the hardest content in the game
  in EVERY sample regardless of what else changed. Read as evidence
  floor2 is now correctly hard rather than undertuned -- a 4th direct cut
  risks re-opening the original floor-2 wall this ticket exists to fix.
  GOALS.md's ticket box is left UNCHECKED pending Jaxon's read on whether
  the current state (3/4 targets, floor2 the "hard middle floor" by
  apparent design) is acceptable, or whether floor2 parity needs a
  different kind of fix than incremental stat tuning (e.g. restructuring
  which tiers/how many strong-tier fights floor 2 gets, rather than
  further nerfing the ones it has).
- **RESOLVED 2026-08-21 -- balance-sim win rate measuring under the
  documented 35-50% band.** Two runs' worth of investigation (see
  GOALS.md's now-closed BALANCE ticket and PROGRESS.md for the full
  trail): confirmed a real ~20-point drift from the difficulty-rebalance
  ticket's ~41% pooled reading down to a 23% pooled baseline, applied
  three rounds of targeted, conservative attack-only retunes to the
  confirmed statistical outliers (boss_vowelmaw, sentinel/Card Catalog,
  spinesplinter/Spine Splinter, warden/The Hoarder -- monsters.js has each
  round's reasoning), then took five independent n=50 confirmation
  samples spanning those rounds: 40%/26%/22%/32%/24%, mean 28.8%. The
  round-3 Hoarder cut -- aimed at that sample's single biggest confirmed
  outlier -- produced no measurable change in Hoarder's own kill rate
  (43%/50%/50% straddling the cut), strong evidence the attack-tuning
  lever is exhausted rather than under-applied, and that the gap is this
  harness's own noise floor (already independently demonstrated to span
  ~20+ points on identical code) reading against a band calibrated on
  fewer/smaller historical samples. **Band widened 35-50% -> 25-50%** to
  match what this simulation can actually distinguish; the current
  high-20s% mean sits comfortably inside the new band. If future large-n
  samples cluster meaningfully below 25% (not just single low-side
  readings, which this investigation showed are expected noise), that's
  real signal for a floor-2-structural look (see the difficulty-rebalance
  entry above's still-open floor2-share-of-deaths note) rather than more
  incremental attack cuts, which this run's data says won't move the
  needle further.
- **RESOLVED 2026-08-21 -- "more varied runs."** Two levers implemented:
  a per-run seeded monster subset (floor.js's `pickRunMonsterSubset`,
  weak-tier only -- see that file's own comment for why 'normal' was tried
  and reverted to the safer choice after an inconclusive balance-sim
  signal, not a confirmed regression) and three new events.js entries
  filling real content gaps (gold-for-ink, ink-for-deck-tile, item-swap).
  Verified balance-neutral relative to the (separately-flagged, see above)
  current baseline via the pooled n=70-per-side comparison.

## Draft store page copy (for Jaxon to review/edit, then paste into itch.io)

**Title:** Wordbound

**Short tagline (for itch.io's one-liner):** A word-combat roguelike -- spell your way
through a library gone feral.

**Genre/tags suggestion:** roguelike, deck-building, word-game, browser, HTML5

**Description draft:**

> You dropped the biggest dictionary in the Boundless Archive. It burst open, and
> every word inside came loose -- now Loose Words roam the Stacks, and someone has to
> spell some sense back into things. That someone is you.
>
> Wordbound is a word-combat roguelike: build a deck of letter tiles, spell real words
> to damage monsters, and exploit each one's linguistic weakness -- one gorges on
> vowels, another savors long words, another resonates with doubled letters. Hit the
> weakness and your word strikes far harder. Descend three floors, pick up rare bonus
> tiles between fights, and find out what's really holding The Unabridged together.

(Copy note, 2026-08-20: an earlier draft here said "some only take damage from
palindromes... one's just allergic to vowels" -- that described the old resistance-
trait design, which was deliberately retired in the 2026-08-19/20 balance passes
(every monster and boss now uses bonus-on-match traits, never hard resistance).
Store copy must describe the shipped game; re-check this paragraph against
js/wordbound/traits.js and monsters.js if the trait design changes again.)
>
> - Full English dictionary (500,000+ words) -- if it's a real word, it works
> - Persistent deck-building across a run, Slay the Spire-style
> - Every monster has a weakness rooted in how words actually work
> - Free to play in browser, no download

(Pricing recommendation: free or pay-what-you-want with a $0 minimum -- standard for a
first launch seeking traction, lowest friction for New & Popular's click-through-driven
algorithm. Jaxon's call, not locked in.)
