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

## Ink

You don't carry hit points — you carry **Ink**, drawn from the same well every Junior
Lexicographer is issued on their first day. It's what keeps your handwriting legible
(you, alive) and, eventually, what pays for the fancier tricks in your Rack. A Loose
Word doesn't "deal damage" so much as it **spills your ink** across the page; nothing
to write with means nothing left to fight with. Healing effects **refill the well**.
If you ever bottom out, the Archive's official incident report reads: **the well ran
dry** — dramatic, technically accurate, and exactly the kind of phrasing a library
would file in triplicate.

Two ways to spend it deliberately, once you're comfortable with the basics:
**Overcharge** presses harder on the nib before a word lands, spilling more ink than
the word alone would ask for in exchange for a heavier blow. **Rewrite** is the
librarian's prerogative — pay to void the page and start the sentence over with a
fresh hand, instead of working with what you were dealt. Both cost ink up front,
shown before you commit; plain word play never does.

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
| glossary | vowelHungry | (new) | **The Glossary** | An alphabetical index of words, absolutely livid about disorder. |
| bindingstrap | alphabetic | (new) | **Binding Strap** | Holds the pages together, holds the rules together, holds YOUR mistakes over your head. |
| appendix | silentE | (new) | **The Appendix** | Supplementary material, supplementary grievances. All filed at the end. |
| spinesplinter | doubled | (new) | **Spine Splinter** | A fragment of The Unabridged's shattered spine, sharp and determined. |

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

## Consumable items (one-time use boosts)

Errata Slips are temporary power-ups that drop from defeated enemies or can be purchased in
shops. Use them during combat for immediate, significant effects.

| Name | Type | Effect | Flavor |
|---|---|---|---|
| **Errata Slip** | consumable | Heal 8 ink or restore to max (whichever is less) | A correction slip from the Archive. Stabilizes your condition. |
| **Index Card Shard** | consumable | Gain 15 temporary bonus damage to next word (1 turn) | A fragment of the master index. Knowledge is power. |
| **Page Turn** | consumable | Draw 3 bonus tiles, keep them without discarding (1 turn) | Skip the discard cycle once. Read ahead. |

## Permanent items (rack & deck modifiers)

Permanent upgrades that persist for the entire run once acquired. Synergize with specific
word patterns or tile types.

| Name | Rarity | Effect | Flavor |
|---|---|---|---|
| **Spare Satchel** | common | Your rack holds 8 tiles instead of 7. | More room for possibilities. |
| **Lucky Vowel** | common | Every draw is guaranteed at least one vowel. | The Archive's luck runs vowel-deep. |
| **Thick Skin** | common | Reduce all incoming damage by 2 (minimum 1). | Hardened by years in the Stacks. |
| **Wildcard Pouch** | uncommon | Adds 2 extra blank tiles to your draw pile at the start of every fight. | Every word can mean something new. |
| **Heavy Ink** | uncommon | Your word's single highest-value tile counts double. | Deep, bold marks leave impressions. |
| **Rare Hunter** | uncommon | Deal +3 bonus damage when your word contains a 4+ point letter. | Seek the valuable letters. |
| **Folio Mark** | uncommon | +2 bonus damage for each tile with a bonus that you play. | A bookmark marking passages of power. |
| **Marginalia** | uncommon | Heal 2 ink when you play 5+ letter words. | Handwritten notes in the margins restore the spirit. |
| **Catalog Tab** | uncommon | +2 bonus damage when you play an alphabetical word. | Index tabs guide you to what matters. |
| **Blank Slate** | uncommon | +2 bonus damage for each blank (?) tile in the word you play. | A fresh start makes all the difference. |
| **Dust Jacket** | uncommon | Reduce incoming damage by 1 for each bonused tile in your rack (minimum 1). | A protective covering safeguards what matters. |
| **Rare Tome** | uncommon | +2 bonus damage when you play a word containing X, Q, or Z. | Some books are precious precisely because they're rare. |
| **Vowel Leech** | rare | Heal 1 ink per vowel in each word you play. | Every vowel is a sip of vitality. |
| **Foreword** | rare | +1 bonus damage for each unused tile in your rack after playing a word. | Preparation carries weight; potential carries power. |
| **Second Wind** | legendary | The first time you would drop to 0 ink, survive with 1 ink instead. Once per run. | A final word at the final hour. |

## Applying this

A separate GOALS.md task handles wiring these names into the actual game files. This
document is the reference; don't duplicate the tables above into code comments, just
point back to THEME.md.
