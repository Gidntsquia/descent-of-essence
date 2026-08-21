# Wordbound

A word-combat roguelike where you spell your way through a library gone feral.

**[Play Wordbound now →](https://gidntsquia.github.io/descent-of-essence/wordbound.html)**

## What is this?

Wordbound is a browser-based roguelike inspired by Slay the Spire and Scrabble. You descend through a mysterious library called the Boundless Archive, battling "Loose Words" — sentient letter-monsters that escaped from a shattered dictionary. To fight them, you spell real English words using letter tiles from your rack. Each monster has a linguistic weakness: some fear palindromes, others despise long words, one's just allergic to vowels. Build a persistent deck across three floors, exploit monster weaknesses, and unlock rare items. Win by defeating the archive's final boss and restoring order to the Stacks.

**The core hook:** "Scrabble meets Slay the Spire" — spell words to damage monsters, each with a weakness rooted in how words actually work. The full English dictionary (200,000+ words) means your valid vocabulary is your power.

For the full lore and design philosophy, see [THEME.md](THEME.md).

## Features

- **Full English dictionary (200,000+ words):** If it's a real word, it works.
- **Persistent deck-building across a run:** Slay the Spire-style progression. Your deck grows as you defeat enemies.
- **Linguistic-based monster weaknesses:** Each monster has a unique trait (palindromic words, short words, no vowels, etc.).
- **Drag-to-reorder tile rack:** Arrange your letters strategically before spelling.
- **Touch-friendly mobile support:** Works on phones and tablets.
- **Shop economy:** Earn gold, buy permanent and consumable items, synergize builds.
- **Character selection:** 3 distinct starting loadouts with different deck compositions and items.
- **Achievement system:** Unlock rare items by completing challenges (beat the game, defeat bosses without damage, deal massive damage, etc.).
- **Synthesized audio:** Web Audio API sound effects and background music (no external files, plays offline).
- **No dependencies:** Pure vanilla HTML/CSS/JavaScript. Runs in any modern browser.

## Quickstart — Play Locally

No build step required. Just open the HTML files in your browser.

**Option 1: Direct open (simplest)**
```bash
# On Mac:
open wordbound.html

# On Windows or Linux:
firefox wordbound.html    # or chrome, safari, etc.
```

**Option 2: Use a local server (recommended for development)**
```bash
# Python 3
python -m http.server 8000

# Then visit: http://localhost:8000/wordbound.html
```

**Why a server?** Some browsers enforce stricter CORS policies with `file://` URLs. A local server avoids this entirely. Python comes pre-installed on Mac and Linux; Windows users can use Python 3 from [python.org](https://python.org) or use any other simple server (Node's `http-server`, PHP's `php -S`, etc.).

## Development

### Running Tests

The project includes a DOM-verification test suite that catches common bugs before they ship.

```bash
npm install        # One-time setup
npm test           # Runs test/dom-check.js in ~2 seconds
```

What it checks:
- Page loads without errors
- Game initializes correctly
- Combat mechanics work (damage, ink updates, rack cycling)
- Animations and DOM mutations execute properly
- Drag-and-drop state management is wired correctly

**Limitations:** The test suite uses jsdom (a JavaScript implementation of the DOM). It cannot verify:
- Audio playback (Web Audio API nodes init but jsdom doesn't render sound)
- Touch drag-and-drop (jsdom lacks full DataTransfer support)
- Visual appearance (animations and CSS, just that the classes/elements exist)

For a full feature validation, test in a real browser: start a run, fight a monster, buy items, try different characters, and check that everything feels right.

### Project Structure

```
wordbound.html              # Main game file (all screens, combat UI)
js/wordbound/
  game.js                   # Game loop, state machine, all screen logic
  lexicon.js                # Word validation, letter scoring
  combat.js                 # Turn logic: word → damage calculation
  traits.js                 # Monster behavior traits (vowel-hungry, doubled, etc.)
  monsters.js               # Monster/boss definitions with stats and traits
  items.js                  # Permanent items (rack modifiers, hooks)
  consumables.js            # One-time-use boost items
  tiles.js                  # Letter tiles, deck system, draw/discard piles
  floor.js                  # Floor generation, node-map (linear progression)
  events.js                 # Event nodes (choice-based encounters)
  characters.js             # Character starting loadouts
  achievements.js           # Achievement tracking and unlockable items
  wordlist.js               # Dictionary (200,000+ words)
js/core/
  rng.js                    # Seeded random number generator
  namespace.js              # Wordbound namespace setup
css/wordbound.css           # All styling (parchment/gold theme)
test/
  dom-check.js              # Main DOM verification tests
  simulate.js               # Headless game loop for balance checking
  *.js                      # Other test utilities
THEME.md                    # Lore, naming conventions, flavor text
GOALS.md                    # Development task queue (for automated routine)
PROGRESS.md                 # Detailed log of what's been built and fixed
ROADMAP.md                  # itch.io launch strategy and design philosophy
```

### Editing & Extending

The game is built entirely in vanilla JavaScript with a modular namespace pattern. Each system (Lexicon, Traits, Monsters, Combat, Items, Floor) is its own file exporting to `window.Wordbound`.

To add a feature:
1. **New item?** Edit `js/wordbound/items.js`, add a `def({...})` entry. Use the `hooks` system to react to events (onRunStart, onWordPlayed, onPlayerDamaged, etc.).
2. **New monster?** Edit `js/wordbound/monsters.js`, add an entry to MONSTER_DEFS or BOSS_DEFS with stats and a trait from traits.js.
3. **New trait?** Add to TRAIT_DEFS in `js/wordbound/traits.js` with behavior logic.
4. **New achievement?** Edit `js/wordbound/achievements.js`, add ACHIEVEMENTS and UNLOCKABLE_ITEMS entries.
5. **UI changes?** Edit `wordbound.html` for structure and `css/wordbound.css` for styling. Game logic is in `game.js`.

Run `npm test` after any changes to ensure nothing broke.

## Screenshots & GIF

![Wordbound gameplay: spelling a word to damage a monster, a tile reward pick, and a boss entrance](docs/gameplay.gif)

*A ~13s clip: the first fight of a run (typing a real word, the damage animation, the kill), the deck tile-reward pick, then entering a boss fight (trait/weakness callout, entrance flash) and playing a word against it. Recorded with `tools/record-gameplay.js` — see that file to re-record after a visual change. A higher-quality source clip (`docs/gameplay.mp4`) is also available for itch.io's store page, which accepts video.*

## How to Play

1. **Pick a character.** The Archivist is balanced, the Scribe is aggressive, the Keeper is defensive.
2. **Spell words to damage monsters.** Click tile letters in your rack to add them to the input field, or type directly.
3. **Exploit weaknesses.** Each monster has a linguistic weakness shown in its name. Try palindromes, short words, words with doubled letters, etc.
4. **Build your deck.** After each victory, pick a bonus letter tile to add to your deck permanently.
5. **Buy items and consumables.** Defeat monsters to earn gold. Spend it in shops for permanent boosts or one-time power-ups.
6. **Ascend floors.** Complete 3 floors and defeat the final boss to win.
7. **Unlock achievements.** Beat the game, defeat bosses without taking damage, and complete other challenges to unlock rare items for future runs.

**Tip:** Higher-scoring letters (Q, X, Z) are rare but powerful. Common words often win over flashy ones. Reordering your rack with drag-and-drop can help you spot better words.

## Design Philosophy

Wordbound is built for itch.io's "New & Popular" charts — a game that's easy to pitch (Scrabble + Slay the Spire), immediate to understand (spell words, damage monsters), and compelling to watch (each run plays differently, achievements reward mastery). The design is deliberately scoped to a single-page, no-backend browser game, emphasizing replayability and mechanical depth over visual spectacle.

For detailed design reasoning, see [ROADMAP.md](ROADMAP.md).

## License

Wordbound is **not currently licensed.** The game, code, and design are the creation of Jaxon. If you'd like to use, remix, or extend this game, reach out.

The English dictionary used (wordlist.js) is derived from [Webster's Second International Dictionary](https://en.wikipedia.org/wiki/Webster%27s_Second_International_Dictionary) (public domain, 1934).

## Credits

- **Design & implementation:** Jaxon
- **Automated development & testing:** Claude (via the hourly dev routine)
- **Sound design:** Web Audio API synthesis (no external assets)
- **Theme & lore:** Boundless Archive library inspiration, whimsical pun-heavy tone

## Feedback & Contributions

This game is being developed as a solo project toward an itch.io launch. Bug reports and feature suggestions are welcome — open an issue on GitHub or reach out directly.

---

**[Play now →](https://gidntsquia.github.io/descent-of-essence/wordbound.html)**

Spell your way through the Stacks. The Loose Words are waiting.
