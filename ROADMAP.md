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
- **As of 2026-08-20T04:45Z, GOALS.md's queue and this known-gaps list are
  both empty of anything the sandbox can act on.** Everything left above
  needs Jaxon directly (a physical-device check, a feel/fun playtest, the
  actual itch.io upload) or a product/scope decision only he can make
  (meta-progression, if he wants it). Future runs: re-read this list fresh
  rather than trusting this summary sentence, in case Jaxon added something
  since.

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
> - Full English dictionary (200k+ words) -- if it's a real word, it works
> - Persistent deck-building across a run, Slay the Spire-style
> - Every monster has a weakness rooted in how words actually work
> - Free to play in browser, no download

(Pricing recommendation: free or pay-what-you-want with a $0 minimum -- standard for a
first launch seeking traction, lowest friction for New & Popular's click-through-driven
algorithm. Jaxon's call, not locked in.)
