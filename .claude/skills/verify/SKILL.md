---
name: verify
description: Build/launch/drive recipe for verifying changes to this app at its real surface (the browser).
---

# Verifying Pocket Golf Printable

No build step. Serve the repo as static files and drive it in the
pre-installed headless Chromium via the global Playwright:

```sh
python3 -m http.server 8123 --bind 127.0.0.1 &   # serve repo root
NODE_PATH=/opt/node22/lib/node_modules node my-driver.js
```

Useful facts for drivers:

- Deep-link straight into a round: `?seed=X&theme=classic&holes=9&play=1`
  (9 holes keeps automated rounds short).
- Round state is `window.play`; the current hole is
  `play.course.holes[play.hi]`; legal landing spots after a roll are
  `play.moves` (each has grid coords `x,y` and rest coords `rx,ry`).
- To click a grid cell like a user: SVG coords are
  `PAD + (x + 0.5) * U` with `U = 20`, `PAD = 12`; map to screen with
  `play.svg.getScreenCTM()` and use `page.mouse.click`.
- To finish a round fast: loop — click `#p-next` if visible, else
  `#p-roll` if enabled, else click the legal move nearest the cup.
  The summary screen is `.play-summary`.
- Headless Chromium has no `navigator.share`, so share features take
  the clipboard fallback; grant `clipboard-read`/`clipboard-write` on
  the context and read back with `navigator.clipboard.readText()`.
- Watch `pageerror`/console errors — the app is plain ES5 JS with no
  bundler to catch typos before runtime.

Headless generator tests (CI runs these; not a substitute for driving
the app): `node test/generator.test.js` (~10s).
