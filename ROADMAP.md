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
- **No packaged, itch.io-ready build.** The repo is source files; itch.io wants a zip
  (or a URL if hosting elsewhere, which GitHub Pages already provides -- itch.io does
  support linking to an external page for HTML5 games, so the current GitHub Pages URL
  may be usable directly without a separate zip. Worth confirming against itch.io's
  actual upload options when the page gets created, rather than assuming a zip is
  required.)
- **Replayability is partly addressed, still thin vs. genre peers.** Since this
  was written: 3 characters with distinct starting decks, 5 achievements
  unlocking 5 items (cross-run localStorage persistence), 15 items, 4 more
  monsters, boss-kill bonus rewards. Still absent: any daily/seeded-run hook
  (the RNG is already fully seeded under the hood -- surfacing it is cheap and
  ticketed 2026-08-20), and run-to-run meta-progression beyond achievements.
- **No packaged itch.io build yet -- now the top remaining launch blocker.**
  itch.io's HTML5 upload wants a zip with `index.html` at the zip root, but this
  repo's `index.html` is Descent of Essence (a different game) -- Wordbound lives
  at `wordbound.html`, so a build step has to stage/rename it. Ticketed
  2026-08-20 in GOALS.md with full details. (The external-URL option via GitHub
  Pages exists as a fallback, but an itch-hosted upload keeps plays and ratings
  on the itch page itself instead of bouncing visitors to an external site --
  likely better for traction, though how itch's ranking actually weighs this
  is not something that can be verified from here.)

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
