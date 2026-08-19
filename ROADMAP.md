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

- **Touch/mobile support is incomplete.** The rack drag-to-reorder feature (see
  PROGRESS.md, task 7) was built with native HTML5 drag-and-drop, which does NOT work
  on touch devices. A lot of itch.io browser-game traffic is on phones/tablets. This
  is probably the single most important remaining gap -- a player on mobile currently
  can't reorder their rack at all.
- **Never verified in an actual browser.** Every feature so far has been
  logic-reasoned and syntax-checked, never visually confirmed. Worth a real human
  playtest pass before publishing, not just more unverified feature work.
- **No packaged, itch.io-ready build.** The repo is source files; itch.io wants a zip
  (or a URL if hosting elsewhere, which GitHub Pages already provides -- itch.io does
  support linking to an external page for HTML5 games, so the current GitHub Pages URL
  may be usable directly without a separate zip. Worth confirming against itch.io's
  actual upload options when the page gets created, rather than assuming a zip is
  required.)
- **Replayability is currently thin.** One run's decisions don't carry over, no
  unlockables, no daily/seeded-run hook, limited monster/item variety relative to
  genre peers. Nice-to-have once the above (more fundamental) gaps are closed.
- **No store page copy drafted yet.** See below -- a first draft exists now.

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
> to damage monsters, and exploit each one's linguistic weakness -- some only take
> damage from palindromes, others hate long words, one's just allergic to vowels.
> Descend three floors, pick up rare bonus tiles between fights, and find out what's
> really holding The Unabridged together.
>
> - Full English dictionary (200k+ words) -- if it's a real word, it works
> - Persistent deck-building across a run, Slay the Spire-style
> - Every monster has a weakness rooted in how words actually work
> - Free to play in browser, no download

(Pricing recommendation: free or pay-what-you-want with a $0 minimum -- standard for a
first launch seeking traction, lowest friction for New & Popular's click-through-driven
algorithm. Jaxon's call, not locked in.)
