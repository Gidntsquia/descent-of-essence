// js/wordbound/portraits.js
// ART ticket (GOALS.md, Jaxon request, style DECIDED: inked woodcut):
// procedurally-built inline-SVG "engraving plate" portraits for monsters and
// bosses, replacing the generic tier emoji in the monster-info panel.
//
// Shared vocabulary (so every portrait reads as one hand, per the ticket):
//   - one palette of 3 ink tones + a parchment plate ground, drawn straight
//     from the existing CSS palette (css/wordbound.css .panel border #4a4130,
//     monster-info bg accents, boss-tier red #e08a8a) rather than inventing
//     new colors.
//   - one crosshatch <pattern> (bold) + one finer wash <pattern>, both
//     defined per-portrait with a unique id (see nextUid) so multiple
//     portraits can coexist in the DOM at once without id collisions --
//     not needed yet (only one monster-info panel exists), but the upcoming
//     character-portrait ticket may show several simultaneously.
//   - one shared plate-frame (border + inner hairline + vignette ground),
//     with a grander corner-flourish variant for bosses.
// Each monster's inner drawing expresses its trait/name gimmick (see the
// per-def comments below) using only these shared primitives (paths, basic
// shapes, and small inline <text> glyphs for the wordplay motifs), not
// hand-traced illustration -- appropriate for a procedurally generated
// "bestiary plate" rather than fine art.
//
// COVERAGE: this ticket is explicitly MULTI-RUN, batched by floor. This run
// covers every def a player can meet on floor 1 (tiers 'weak' + 'normal',
// see floor.js getAllowedTiers) plus the floor-1 boss: slime, gremlin, wisp,
// glossary, serpent, golempup, raven, bindingstrap, appendix, boss_vowelmaw
// (10 of the 15 total defs). The floor-2/3-only defs (sentinel, warden,
// spinesplinter, boss_unabridged, boss_sovereign) are left for a follow-up
// run -- see PROGRESS.md. svgFor() returns null for anything not yet in
// PORTRAIT_BUILDERS below, and callers (game.js renderCombat) fall back to
// the pre-existing tier-emoji glyph in that case, so uncovered monsters
// still render correctly, just without custom art yet.
//
// PUBLIC API (window.Wordbound.Portraits):
//   svgFor(defId) -> full <svg>...</svg> markup string (role="img",
//     aria-label = the monster's display name, viewBox 0 0 120 120 so it
//     scales responsively via CSS width:100%), or null if defId has no
//     def (unknown id) or no builder yet (not this run's batch).
//   COVERED_IDS -> array of defIds this build has a portrait for (test hook).

(function () {
  window.Wordbound = window.Wordbound || {};
  var Portraits = (window.Wordbound.Portraits = {});

  // Palette pulled from css/wordbound.css: PLATE_BG/PLATE_BG_DEEP are a
  // parchment ground (so ink linework reads clearly, echoing the vellum
  // .panel texture elsewhere); INK_1/2/3 are three ink weights (bold
  // outline / crosshatch / light wash); FRAME matches .panel's existing
  // #4a4130 border; BOSS_ACCENT echoes the boss-tier red (#e08a8a family)
  // used on HP-flash and .boss-tier text elsewhere.
  var PLATE_BG = '#e9dfc3';
  var PLATE_BG_DEEP = '#d9c89e';
  var INK_1 = '#2a2015';
  var INK_2 = '#5c4b31';
  var INK_3 = '#8d7752';
  var FRAME = '#4a4130';
  var BOSS_ACCENT = '#7c2323';

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var uidCounter = 0;
  function nextUid(defId) {
    uidCounter++;
    return 'pf-' + defId + '-' + uidCounter;
  }

  function glyph(x, y, ch, opts) {
    opts = opts || {};
    var size = opts.size || 11;
    var fill = opts.fill || INK_1;
    var opacity = opts.opacity != null ? opts.opacity : 1;
    return '<text x="' + x + '" y="' + y + '" font-family="Georgia, \'Times New Roman\', serif" ' +
      'font-weight="bold" font-size="' + size + '" fill="' + fill + '" text-anchor="middle" ' +
      'opacity="' + opacity + '">' + esc(ch) + '</text>';
  }

  function defs(uid) {
    return '' +
      '<defs>' +
      '<pattern id="hatch-' + uid + '" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">' +
      '<line x1="0" y1="0" x2="0" y2="6" stroke="' + INK_2 + '" stroke-width="1.1"/>' +
      '</pattern>' +
      '<pattern id="hatchfine-' + uid + '" width="4" height="4" patternTransform="rotate(-45)" patternUnits="userSpaceOnUse">' +
      '<line x1="0" y1="0" x2="0" y2="4" stroke="' + INK_3 + '" stroke-width="0.8"/>' +
      '</pattern>' +
      '<radialGradient id="vign-' + uid + '" cx="50%" cy="42%" r="65%">' +
      '<stop offset="60%" stop-color="' + PLATE_BG + '"/>' +
      '<stop offset="100%" stop-color="' + PLATE_BG_DEEP + '"/>' +
      '</radialGradient>' +
      '</defs>';
  }

  function cornerFlourish(stroke) {
    var pts = [[10, 10], [110, 10], [10, 110], [110, 110]];
    return pts.map(function (p) {
      return '<path d="M' + p[0] + ' ' + (p[1] - 4) + ' l4 4 l-4 4 l-4 -4 z" fill="' + stroke + '" opacity="0.85"/>';
    }).join('');
  }

  function frame(uid, isBoss) {
    var stroke = isBoss ? BOSS_ACCENT : FRAME;
    var w = isBoss ? 3 : 2;
    return '' +
      '<rect x="3" y="3" width="114" height="114" rx="4" fill="url(#vign-' + uid + ')" stroke="' + stroke + '" stroke-width="' + w + '"/>' +
      '<rect x="7" y="7" width="106" height="106" rx="2" fill="none" stroke="' + stroke + '" stroke-width="0.75" opacity="0.6"/>' +
      (isBoss ? cornerFlourish(stroke) : '');
  }

  function echoPair(dx, dy, primary) {
    // Shared "doubled/echo" motif (gremlin, golempup, bindingstrap all carry
    // the 'doubled' trait -- see monsters.js): draw the same shape twice,
    // offset and lighter behind the bold primary copy, so the art itself
    // reads as an echo/repeat, matching the mechanic.
    return primary(dx, dy, INK_3, 0.5) + primary(0, 0, INK_1, 1);
  }

  // ---- per-def builders ------------------------------------------------
  // Each returns inner <g>-relative markup. Origin (0,0) is the plate
  // center; keep drawings within roughly -45..45 on both axes to stay
  // inside the frame's padded interior.

  function slimeInner(uid) {
    // vowelHungry: an amoeba blob with an open mouth pulling in vowels.
    return '' +
      '<ellipse cx="0" cy="6" rx="34" ry="26" fill="url(#hatch-' + uid + ')" stroke="' + INK_1 + '" stroke-width="2.5"/>' +
      '<circle cx="-10" cy="-4" r="2.2" fill="' + INK_1 + '"/>' +
      '<circle cx="6" cy="-4" r="2.2" fill="' + INK_1 + '"/>' +
      '<ellipse cx="-2" cy="14" rx="11" ry="7" fill="' + INK_1 + '"/>' +
      glyph(-26, -16, 'A', { size: 10 }) + glyph(22, -18, 'E', { size: 9, opacity: 0.85 }) + glyph(30, 6, 'I', { size: 9, opacity: 0.7 }) +
      '<path d="M -22 -12 Q -10 4 -4 12" fill="none" stroke="' + INK_2 + '" stroke-width="1" stroke-dasharray="2 2"/>' +
      '<path d="M 18 -14 Q 6 -2 0 10" fill="none" stroke="' + INK_2 + '" stroke-width="1" stroke-dasharray="2 2"/>';
  }

  function gremlinBody(dx, dy, stroke, op) {
    return '<g transform="translate(' + dx + ',' + dy + ')" opacity="' + op + '">' +
      '<circle cx="0" cy="-10" r="14" fill="none" stroke="' + stroke + '" stroke-width="2"/>' +
      '<path d="M -12 -18 L -18 -30 L -6 -20 Z" fill="' + stroke + '"/>' +
      '<path d="M 12 -18 L 18 -30 L 6 -20 Z" fill="' + stroke + '"/>' +
      '<path d="M -10 2 L -14 26 M 10 2 L 14 26 M -10 2 Q 0 10 10 2" fill="none" stroke="' + stroke + '" stroke-width="2"/>' +
      '<circle cx="-5" cy="-11" r="1.6" fill="' + stroke + '"/><circle cx="5" cy="-11" r="1.6" fill="' + stroke + '"/>' +
      '</g>';
  }
  function gremlinInner() {
    // doubled: a small jittery imp, drawn as a bold copy over a lighter
    // offset echo copy -- the "Fidget" reads as caught mid-twitch.
    return echoPair(3, -3, gremlinBody);
  }

  function wispInner() {
    // plain (no bonus): deliberately insubstantial -- thin dashed outline,
    // faint scratch lines, faded "um"/"er" text. "It doesn't really do
    // anything," per THEME.md.
    return '' +
      '<path d="M -20 20 Q -30 -10 -10 -25 Q 5 -35 20 -20 Q 32 -5 20 10 Q 10 26 -6 24 Q -14 24 -20 20 Z" fill="none" stroke="' + INK_3 + '" stroke-width="1.2" stroke-dasharray="3 2" opacity="0.8"/>' +
      '<path d="M -14 6 Q -4 -6 8 2" fill="none" stroke="' + INK_3 + '" stroke-width="0.8" opacity="0.6"/>' +
      '<path d="M -8 16 Q 2 6 14 12" fill="none" stroke="' + INK_3 + '" stroke-width="0.8" opacity="0.6"/>' +
      glyph(-4, -2, 'um', { size: 9, fill: INK_2, opacity: 0.5 }) +
      glyph(10, 16, 'er', { size: 8, fill: INK_2, opacity: 0.4 });
  }

  function glossaryInner(uid) {
    // vowelHungry, but themed as a book (the name/flavor): an alphabetical
    // index, "absolutely livid about disorder."
    return '' +
      '<rect x="-26" y="-30" width="52" height="60" rx="2" fill="url(#hatch-' + uid + ')" stroke="' + INK_1 + '" stroke-width="2.5"/>' +
      '<line x1="-26" y1="-30" x2="-26" y2="30" stroke="' + INK_1 + '" stroke-width="3"/>' +
      '<line x1="24" y1="-26" x2="24" y2="26" stroke="' + INK_2 + '" stroke-width="1"/>' +
      '<line x1="21" y1="-24" x2="21" y2="24" stroke="' + INK_2 + '" stroke-width="1"/>' +
      glyph(0, -8, 'A', { size: 9 }) + glyph(0, 6, 'M', { size: 9 }) + glyph(0, 20, 'Z', { size: 9 }) +
      '<path d="M -20 -30 l6 -6 M 14 -30 l6 -6" stroke="' + INK_1 + '" stroke-width="1.4" fill="none"/>';
  }

  function serpentInner(uid) {
    // vowelless: a constrictor coiled into a squeeze, consonants along its
    // hide instead of scales.
    var coil = 'M -30 20 Q -30 -30 10 -22 Q 40 -16 20 6 Q 4 22 -8 6 Q -14 -2 -2 -6';
    return '' +
      '<path d="' + coil + '" fill="none" stroke="' + INK_1 + '" stroke-width="4.5" stroke-linecap="round"/>' +
      '<path d="' + coil + '" fill="none" stroke="url(#hatchfine-' + uid + ')" stroke-width="2.5" opacity="0.7"/>' +
      '<ellipse cx="-30" cy="20" rx="7" ry="5" fill="' + INK_1 + '"/>' +
      '<path d="M -35 24 L -40 28 M -35 24 L -38 30" stroke="' + INK_1 + '" stroke-width="1" fill="none"/>' +
      glyph(8, -24, 'K', { size: 8, fill: INK_2, opacity: 0.6 }) + glyph(26, -2, 'S', { size: 8, fill: INK_2, opacity: 0.6 });
  }

  function pupBody(dx, dy, stroke, op) {
    return '<g transform="translate(' + dx + ',' + dy + ')" opacity="' + op + '">' +
      '<ellipse cx="0" cy="10" rx="16" ry="14" fill="none" stroke="' + stroke + '" stroke-width="2"/>' +
      '<circle cx="0" cy="-14" r="11" fill="none" stroke="' + stroke + '" stroke-width="2"/>' +
      '<path d="M -9 -22 L -13 -32 L -3 -24 Z M 9 -22 L 13 -32 L 3 -24 Z" fill="' + stroke + '"/>' +
      '<path d="M 14 12 Q 26 6 24 -4" fill="none" stroke="' + stroke + '" stroke-width="2"/>' +
      '<circle cx="-4" cy="-15" r="1.4" fill="' + stroke + '"/><circle cx="4" cy="-15" r="1.4" fill="' + stroke + '"/>' +
      '</g>';
  }
  function golempupInner() {
    // doubled: "Echo Pup. Woof woof." -- the echo motif again, this time a
    // sitting pup.
    return echoPair(4, -4, pupBody);
  }

  function ravenInner(uid) {
    // silentE: a raven with a faded, struck-through "e" -- "say it out
    // loud" (THEME.md quip), i.e. the letter is there but silent. Built from
    // separate body/head/beak/tail parts (rather than one blob outline) so
    // the silhouette actually reads as a bird at this size.
    return '' +
      '<path d="M -30 12 L -14 2 L -30 -4 L -18 6 Z" fill="' + INK_1 + '"/>' +
      '<ellipse cx="-6" cy="4" rx="20" ry="13" fill="url(#hatch-' + uid + ')" stroke="' + INK_1 + '" stroke-width="2.2" transform="rotate(-14 -6 4)"/>' +
      '<path d="M -16 -2 Q 0 8 14 1" fill="none" stroke="' + INK_2 + '" stroke-width="1.3"/>' +
      '<circle cx="16" cy="-7" r="9" fill="url(#hatch-' + uid + ')" stroke="' + INK_1 + '" stroke-width="2"/>' +
      '<path d="M 24 -7 L 35 -4 L 24 1 Z" fill="' + INK_1 + '"/>' +
      '<circle cx="18" cy="-9" r="1.5" fill="' + INK_1 + '"/>' +
      glyph(6, -22, 'e', { size: 12, fill: INK_2, opacity: 0.55 }) +
      '<line x1="1" y1="-26" x2="11" y2="-18" stroke="' + INK_2 + '" stroke-width="1" opacity="0.6"/>';
  }

  function bindingstrapInner(uid) {
    // doubled: a leather strap/buckle, doubled stitch lines along both
    // edges -- "holds YOUR mistakes over your head."
    return '' +
      '<rect x="-30" y="-8" width="60" height="16" rx="3" fill="url(#hatch-' + uid + ')" stroke="' + INK_1 + '" stroke-width="2.5"/>' +
      '<rect x="-6" y="-16" width="12" height="32" fill="' + PLATE_BG + '" stroke="' + INK_1 + '" stroke-width="2"/>' +
      '<line x1="0" y1="-16" x2="0" y2="16" stroke="' + INK_1 + '" stroke-width="2"/>' +
      '<line x1="-28" y1="-11" x2="28" y2="-11" stroke="' + INK_2 + '" stroke-width="1" stroke-dasharray="3 2"/>' +
      '<line x1="-28" y1="-6" x2="28" y2="-6" stroke="' + INK_2 + '" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"/>' +
      '<line x1="-28" y1="11" x2="28" y2="11" stroke="' + INK_2 + '" stroke-width="1" stroke-dasharray="3 2"/>' +
      '<line x1="-28" y1="6" x2="28" y2="6" stroke="' + INK_2 + '" stroke-width="1" stroke-dasharray="3 2" opacity="0.6"/>';
  }

  function appendixInner(uid) {
    // silentE, themed as a booklet: dog-eared corner, footnote asterisk, a
    // faded struck-through "e" echoing the raven's same silent-E motif so
    // the two share visual language (they share the trait).
    return '' +
      '<path d="M -20 -28 L 14 -28 L 20 -22 L 20 28 L -20 28 Z" fill="url(#hatch-' + uid + ')" stroke="' + INK_1 + '" stroke-width="2.2"/>' +
      '<path d="M 14 -28 L 14 -22 L 20 -22 Z" fill="' + PLATE_BG + '" stroke="' + INK_1 + '" stroke-width="1.4"/>' +
      glyph(0, 5, 'e', { size: 14, fill: INK_2, opacity: 0.5 }) +
      '<line x1="-6" y1="1" x2="6" y2="9" stroke="' + INK_2 + '" stroke-width="1" opacity="0.55"/>' +
      glyph(-2, -14, '*', { size: 10, fill: INK_1 }) +
      '<line x1="-12" y1="14" x2="12" y2="14" stroke="' + INK_2 + '" stroke-width="0.8" opacity="0.5"/>' +
      '<line x1="-12" y1="18" x2="12" y2="18" stroke="' + INK_2 + '" stroke-width="0.8" opacity="0.5"/>';
  }

  function teethRow(cy, dir) {
    // dir: -1 teeth hang down from the top rim, 1 teeth point up from the
    // bottom rim.
    var xs = [-18, -9, 0, 9, 18];
    return xs.map(function (x) {
      var tipY = cy + dir * 9;
      return '<path d="M' + (x - 4) + ' ' + cy + ' L' + (x + 4) + ' ' + cy + ' L' + x + ' ' + tipY + ' Z" fill="' + PLATE_BG + '"/>';
    }).join('');
  }
  function vowelmawInner(uid) {
    // Floor-1 boss: a grander, red-accented gaping maw devouring every
    // vowel at once -- the escalated version of the plain slime's mouth
    // motif, matching its own vowelHungry opening phase (traitPhases[0]).
    return '' +
      '<path d="M -40 -6 Q -20 -34 0 -32 Q 20 -34 40 -6 Q 30 26 0 34 Q -30 26 -40 -6 Z" fill="url(#hatch-' + uid + ')" stroke="' + BOSS_ACCENT + '" stroke-width="3"/>' +
      '<ellipse cx="0" cy="4" rx="26" ry="17" fill="' + INK_1 + '"/>' +
      teethRow(-9, -1) + teethRow(17, 1) +
      glyph(-30, -20, 'A', { size: 12 }) + glyph(28, -20, 'E', { size: 12 }) +
      glyph(-34, 12, 'O', { size: 11, opacity: 0.85 }) + glyph(34, 14, 'U', { size: 11, opacity: 0.85 }) +
      glyph(0, -32, 'I', { size: 11, opacity: 0.9 }) +
      '<path d="M -26 -16 Q -10 -4 -4 6" fill="none" stroke="' + INK_2 + '" stroke-width="1.2" stroke-dasharray="2 2"/>' +
      '<path d="M 24 -16 Q 8 -4 4 6" fill="none" stroke="' + INK_2 + '" stroke-width="1.2" stroke-dasharray="2 2"/>';
  }

  var PORTRAIT_BUILDERS = {
    slime: slimeInner,
    gremlin: gremlinInner,
    wisp: wispInner,
    glossary: glossaryInner,
    serpent: serpentInner,
    golempup: golempupInner,
    raven: ravenInner,
    bindingstrap: bindingstrapInner,
    appendix: appendixInner,
    boss_vowelmaw: vowelmawInner
  };
  Portraits.COVERED_IDS = Object.keys(PORTRAIT_BUILDERS);

  Portraits.svgFor = function (defId) {
    var Monsters = window.Wordbound && window.Wordbound.Monsters;
    if (!Monsters) return null;
    var isBoss = !!Monsters.BOSS_DEFS[defId];
    var def = isBoss ? Monsters.BOSS_DEFS[defId] : Monsters.MONSTER_DEFS[defId];
    var builder = PORTRAIT_BUILDERS[defId];
    if (!def || !builder) return null;
    var uid = nextUid(defId);
    var inner = builder(uid);
    return '' +
      '<svg viewBox="0 0 120 120" class="portrait-svg' + (isBoss ? ' boss-portrait-svg' : '') + '" ' +
      'role="img" aria-label="' + esc(def.name) + '" xmlns="http://www.w3.org/2000/svg">' +
      defs(uid) +
      frame(uid, isBoss) +
      '<g transform="translate(60,64)" aria-hidden="true" focusable="false">' + inner + '</g>' +
      '</svg>';
  };
})();
