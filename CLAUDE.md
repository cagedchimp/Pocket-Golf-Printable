# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

A single-page web app that procedurally generates printable dot-grid golf
courses in the style of Paper Apps™ GOLF, and lets you play them in the
browser with a virtual d6. No build step, no dependencies, no framework —
plain HTML/CSS/JS served as static files.

## Files

- `index.html` — the entire app: styles, controls, SVG hole rendering,
  4-up print layout, and the on-screen play mode. Script is written in
  ES5-style vanilla JS (var, string-concat SVG); match that style.
- `golf.js` — pure logic module (UMD-ish: `window.PaperGolf` in the
  browser, `module.exports` in Node). Course/hole generation, the BFS
  solver, slope resolution, and move legality (`shotTargets`,
  `movesForRoll`). **All game rules live here**, never in `index.html`,
  so they stay testable headlessly and shared between the solver and
  play mode.
- `test/generator.test.js` — headless checks. Run with:

  ```sh
  node test/generator.test.js
  ```

  No test framework — plain `assert()` helpers, exits nonzero on failure.
  Takes ~10s (generates 60 full courses).

## Invariants to preserve

- **Determinism**: courses are generated from a seeded RNG
  (`xmur3` + `mulberry32`). The same seed + theme + hole count must
  always produce the identical course — never call `Math.random()`
  inside generation logic (UI-side die rolls are fine).
- **Solvability**: every generated hole must be finishable in 3–6
  optimal strokes (`solve()` gates generation). Holes carry their own
  grid size (`hole.w`/`hole.h`, drawn per hole from a weighted pool in
  `generateCourse`; the module W/H are only defaults) — every rule
  and generation helper must use the hole's dims, never the globals.
- **Shareable URLs**: seed, theme, diff, holes, and `play=1` live in the
  query string; keep `syncURL()`/boot restore in sync when adding state.
  Standard difficulty must add no RNG draws and scale nothing during
  generation, so pre-difficulty share links keep producing identical
  courses (see `DIFFICULTIES` in golf.js).
- **Browser + Node**: `golf.js` must keep working in both environments.
- **Print layout**: the printable sheets must stay intact — play mode
  hides them on screen but `@media print` shows them again, so a user
  can print while playing. Four layouts (`layout` param), each with a
  fixed `@page` size — there is no paper picker: `sheet` (4-up
  quarters on Letter), `single` (one 4.25×5.5in card per page),
  `booklet` (the course map on 6×8 pad pages, 6 holes each), and
  `continuous` (Letter, 9 holes, scorecard on the cover page, then a
  blank verso so duplex prints pair the map pages) —
  several holes composed onto one shared dot grid by
  `packSheet()`: tight per-hole footprints placed rigidly (translate +
  90°-multiple rotation of self-solved holes, so solvability transfers),
  seeded as an aspect-matched boustrophedon grid, then compacted
  toward the sheet centre and interlaced — each hole pulls toward its
  route-predecessor until only a 1-cell rough seam separates playable
  cells (the invariant) — into an organic cluster with no reserved
  centerpiece. Routed so each cup ends near the next tee.
  decorateSheet() then dresses the sheet like a course map: seam tree
  lines where holes nearly touch, a free-roaming organic-shoreline
  lake or river, connective forest blobs, and a fill pass that plants
  forest over leftover interior rough so no big bare patches survive
  (tested). Decoration only replaces plain rough, and
  validateSheet() re-solves every hole AS PRINTED via extractFrame()
  (neighbours' terrain and decoration included), stripping decoration
  from any frame that breaks the 3–6 gate — playable by construction,
  and tested. The renderer clips dots to a dilated content mask so the
  course has an organic outline. Holes flow vertically or diagonally
  (tee/cup placement in `buildHoleAttempt`), not just top-to-bottom.
  The `players` param (1/2) works in every layout: P1/P2 on the
  scorecard, hole cards, title-card mulligan tracks, and booklet
  footer — printed sheets only, on-screen play stays single-player.
- **Mobile**: play mode is touch-first — keep tap targets generous and
  the roll controls pinned to the bottom on narrow screens.

## Game rules (encoded in golf.js)

Straight-line moves in 8 directions, distance = d6 roll. Fairway +1 and
may fly over trees; sand −1; rough/green exact; water and trees can be
flown over but never landed on; slope arrows carry the ball after
landing; a putt (1 space, or 1–2 on the green) is always allowed instead
of the roll. **Clubs** (declared before rolling, `movesForRoll`'s club
arg): driver +1 but only from tee/fairway, iron exact, wedge = half the
roll rounded up, lofted (over trees from anywhere, immune to wind, no
sand penalty). **Wind** (`hole.wind` direction, `hole.windStr` 1–2,
drawn from a separate RNG stream so hole layouts stay untouched):
shots of 4+ spaces drift one space downwind per strength point after
landing — never into water/trees/off-grid, holed balls stay holed;
wind is kept on a hole only if the wind-aware `solve()` still fits the
difficulty's stroke gate. Par 6 every hole; mulligans per course come from the
difficulty tier (Casual 8 / Standard 6 / Tough 4). Difficulty also
gates each hole's optimal stroke count (Casual exactly 3, Tough 4-6),
scales hazard density, and on Tough adds greenside moats, island
greens, and wider creeks; every course gets a measured 1-3 star
rating printed on the title card. About 1/3 of
courses hide a **wonder** on one hole (Bigfoot, gnome, castle, UFO,
kraken — the `WONDERS` registry in golf.js; some are theme-restricted
and rarer than others); tapping it in play mode earns a free mulligan.

## Deploy

`.github/workflows/pages.yml` runs the tests, then deploys `index.html`
and `golf.js` to GitHub Pages (both via the Actions deployment and the
`gh-pages` branch). Live site:
<https://cagedchimp.github.io/Pocket-Golf-Printable/>. If you add a new
file the site needs, add it to the workflow's staging steps.
