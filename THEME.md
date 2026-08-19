# Wordbound — Story Bible

Whimsical/lighthearted, pun-heavy. This is the single source of truth for names and
flavor text so renaming stays consistent across separate work sessions — always read
this before touching any names, and don't invent new lore that contradicts it.

## Premise

You're a Junior Lexicographer at the **Boundless Archive**, an infinite library holding
every word ever spoken. One very bad afternoon, someone (you, actually — it was you)
dropped **The Unabridged**, the biggest and heaviest dictionary on the top shelf. It
burst open on impact. Every word inside came loose and started mutating into living
**Loose Words** — word-monsters that now roam the Stacks, hoarding rare letters and
absolutely refusing to alphabetize.

Armed with nothing but a **Rack** (a satchel of enchanted letter tiles) and the power of
correct spelling, you descend into the Stacks to spell some sense back into things.

Tone: pun-forward and silly, but never mean-spirited. Think library puns, not horror.
The monsters are a nuisance, not a threat to be feared — they're just badly behaved words.

## Floors (TOTAL_FLOORS = 3, see js/wordbound/floor.js)

1. **The Overdue Aisles** — where the easy, common Loose Words hang around, overdue for
   re-shelving. Low stakes, mild chaos.
2. **The Reference Wing** — denser stacks, tougher and rarer Loose Words guarding
   valuable letters.
3. **The Binding** — the vault at the very bottom, where the actual busted spine of The
   Unabridged still lies. Home to the source of the whole mess.

## Monster renames

Keep every `id`, `traitPhases`, `maxHp`, `attack`, `tier`, and `goldDrop` in
js/wordbound/monsters.js exactly as they are — only the `name` field changes. Each quip
below is optional flavor (fine to leave unused if there's nowhere natural to put it; do
not force a UI/data-shape change just to fit them in).

| id | trait | old name | new name | quip (optional flavor) |
|---|---|---|---|---|
| slime | vowelHungry | Vowel Slime | **The Vowel Slurper** | Always thirsty for A, E, I, O, or U. |
| gremlin | shortFuse | Gremlin | **The Fidget** | Can't focus on anything longer than four letters. |
| wisp | plain | Wisp | **Filler Word** | Um. Er. Like. It doesn't really do anything. |
| serpent | vowelless | Consonant Serpent | **The Consonant Constrictor** | Squeezes tighter the fewer vowels you use. |
| golempup | doubled | Golem Pup | **Echo Pup** | Woof woof. |
| raven | silentE | Raven | **Quoth** | Say it out loud. Go on. |
| sentinel | alphabetic | Sorted Sentinel | **The Card Catalog** | Everything has its proper place. EVERYTHING. |
| warden | rareSeeker | Warden | **The Hoarder** | Collects Qs, Xs, and Zs. Very proud of the collection. |

## Boss renames

Same rule: only `name` changes, mechanics untouched.

| id | floor | phases | old name | new name |
|---|---|---|---|---|
| boss_vowelmaw | 1 | vowelHungry → palindromic | The Vowelmaw | **The Vowelmaw** (keep as-is — already on-theme) |
| boss_unabridged | 2 | lengthy → rareSeeker | The Unabridged Terror | **The Unabridged Terror** (keep as-is — a fragment of the real thing, see below) |
| boss_sovereign | 3 | silentE → shortFuse → palindromic | The Silent Sovereign | **The Unabridged, Unbound** |

Narrative beat for the floor-3 boss rename: the floor-2 boss ("The Unabridged Terror")
was only ever a loose fragment. The floor-3 boss is the real, whole, busted dictionary —
free of its binding and very unhappy about it. This is why floor 2 keeps a name so
similar to floor 3's boss; it's intentional, not a naming collision.

## UI copy

- Main menu tagline (wordbound.html `.tagline`): something in the spirit of "Spell your
  way through the Stacks. Every Loose Word has a weakness — find the word that hits it."
  (adjust freely, keep it one sentence, keep the existing "every monster has a
  weakness" beat since it's actually explaining a real mechanic to the player).
- Floor label (currently just "Floor N / 3" in game.js `renderRun`): fine to keep
  numeric-only, or append the floor name from the table above (e.g. "Floor 1 / 3 — The
  Overdue Aisles") if there's a clean spot for it without crowding the HUD.
- Game title stays **WORDBOUND** — do not rename the game itself.

## Applying this

A separate GOALS.md task handles wiring these names into the actual game files. This
document is the reference; don't duplicate the tables above into code comments, just
point back to THEME.md.
