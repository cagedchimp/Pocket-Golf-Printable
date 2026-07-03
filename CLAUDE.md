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
  optimal strokes (`solve()` gates generation).
- **Shareable URLs**: seed, theme, holes, and `play=1` live in the query
  string; keep `syncURL()`/boot restore in sync when adding state.
- **Browser + Node**: `golf.js` must keep working in both environments.
- **Print layout**: the printable sheets must stay intact — play mode
  hides them on screen but `@media print` shows them again, so a user
  can print while playing.
- **Mobile**: play mode is touch-first — keep tap targets generous and
  the roll controls pinned to the bottom on narrow screens.

## Game rules (encoded in golf.js)

Straight-line moves in 8 directions, distance = d6 roll. Fairway +1 and
may fly over trees; sand −1; rough/green exact; water and trees can be
flown over but never landed on; slope arrows carry the ball after
landing; a putt (1 space, or 1–2 on the green) is always allowed instead
of the roll. Par 6 every hole; 6 mulligans per course. About 1/3 of
courses hide a **wonder** on one hole (Bigfoot, gnome, castle, UFO,
kraken — the `WONDERS` registry in golf.js; some are theme-restricted
and rarer than others); tapping it in play mode earns a free mulligan.

## Deploy

`.github/workflows/pages.yml` runs the tests, then deploys `index.html`
and `golf.js` to GitHub Pages (both via the Actions deployment and the
`gh-pages` branch). Live site:
<https://cagedchimp.github.io/Pocket-Golf-Printable/>. If you add a new
file the site needs, add it to the workflow's staging steps.
