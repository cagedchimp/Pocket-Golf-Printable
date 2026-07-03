# ⛳ Pocket Golf Printable

Generate printable dot-grid golf courses in the style of
[Paper Apps™ GOLF](https://gladdendesign.com/) (created by Tom Brinton).
Open the app, roll up a fresh 9- or 18-hole course, print it 4-up on
Letter or A4, cut the sheets into quarters, and hit the links with a
pencil and a d6 — or hit **▶ Play** and play the same course right in
the browser with a virtual die.

## Use it

**Play it here: <https://cagedchimp.github.io/Pocket-Golf-Printable/>**
(deployed automatically by GitHub Actions on every push)

Or open `index.html` in any browser — no build step, no server, no
dependencies.

- **Seed** — every course is procedurally generated from a seed string.
  The same seed always produces the same course, and the seed, style,
  and hole count live in the URL, so you can share a link with friends
  and play the same track.
- **🎲 New course** — random seed, fresh course.
- **Style** — terrain themes that change what the course leans on:

  | Style | Character |
  | --- | --- |
  | Classic | A bit of everything |
  | Deep Forest | Dense pine thickets crowd the corridors |
  | Lakeside | Big water carries and shoreline greens |
  | Sandy Dunes | Bunkers everywhere, barely a tree in sight |
  | Highlands | Slope arrows send your ball rolling |

  Example courses to try:
  - [Deep Forest](https://cagedchimp.github.io/Pocket-Golf-Printable/?seed=demo-course&theme=forest&holes=18)
  - [Lakeside](https://cagedchimp.github.io/Pocket-Golf-Printable/?seed=demo-course&theme=lakeside&holes=18)
  - [Sandy Dunes](https://cagedchimp.github.io/Pocket-Golf-Printable/?seed=demo-course&theme=dunes&holes=18)
  - [Highlands](https://cagedchimp.github.io/Pocket-Golf-Printable/?seed=demo-course&theme=highlands&holes=18)
- **Difficulty** — Casual, Standard, or Tough. Tough courses can't be
  reached in 3 perfect strokes, pile on hazards — greenside moats,
  island greens, creeks too wide for a mid roll — and allow only 4
  mulligans (Casual allows 8). Every course shows a measured ★☆☆-★★★
  rating on its title page. Try
  [Lakeside on Tough](https://cagedchimp.github.io/Pocket-Golf-Printable/?seed=demo-course&theme=lakeside&diff=tough&holes=18).
- **Holes** — 9 or 18.
- **Paper** — Letter (quarters are 4.25 × 5.5 in) or A4 (quarters are
  exactly A6).
- **▶ Play** — play the course on screen instead of (or before)
  printing it. Roll the virtual d6, then tap one of the highlighted
  spots to hit the ball there: solid rings are your full shot
  (fairway +1, sand −1), dashed rings are putts. Slopes carry the ball
  after it lands, mulligans re-roll the die, spotting the course's
  hidden wonder earns a free one, and a scorecard tracks the round.
  Works great on phones — the roll controls stay pinned to the bottom
  of the screen. Add
  `&play=1` to a shared course URL to send someone straight into a
  round: [play Deep Forest now](https://cagedchimp.github.io/Pocket-Golf-Printable/?seed=demo-course&theme=forest&holes=18&play=1).
- **🖨 Print** — print with margins set to *none* and background
  graphics *on*. Cut along the dashed guides.

A course prints as: a title page (course name, mulligan tracker,
terrain legend) → one hole per quarter page → a scorecard.

## How to play (short version)

Roll a d6 and move that many dots in a straight line, in any of the 8
directions. Draw the line, mark the ball. Par is 6 on every hole.

| Terrain | Effect |
| --- | --- |
| Fairway (light) | +1 to your roll; you may hit over trees |
| Green (darker, around the cup) | Plays like rough, but putts may move 1 **or 2** spaces |
| Rough (dots) | Move exactly your roll |
| Sand (hatched) | −1 to your roll |
| Water (dark) | Never land on it; flying over is fine |
| Trees (pines) | Never land on them; only fly over from the fairway |
| Slopes (arrows) | Ball rolls 1 more space per arrow after landing |

Holes are laid out like real golf holes: a tee box, a carry over rough,
a continuous fairway (often with a dogleg and wider landing zones), and
a green around the cup — guarded by bunkers, tree lines along the
fairway, copses in dogleg elbows, and the occasional creek crossing the
line of play.

You may always putt (move 1) instead of your roll. 6 mulligans
(re-rolls) per course — tick them off on the title page. Rumor has it
a *wonder* hides on one hole in about a third of courses — usually
Bigfoot's footprints or a garden gnome, but sometimes an old castle, a
UFO, or (only on lakeside courses, and rarely even there) the kraken
lurking in a pond. Spot it and tap it for a free mulligan.

## Guaranteed playable

Every generated hole is verified by a solver (`golf.js`) that simulates
the movement rules — tree blocking, water carries, sand penalties,
slope rolls — and only holes finishable in 3–6 optimal strokes are
kept, so par 6 is always achievable.

Run the generator checks headlessly:

```sh
node test/generator.test.js
```

## Files

- `index.html` — the whole app: UI, SVG rendering, print layout, play mode
- `golf.js` — pure course generator + rules solver + move legality (browser & Node)
- `test/generator.test.js` — solvability, determinism, pacing, and play-mode checks

*Not affiliated with Paper Apps™ or Gladden Design — go buy their
notebooks, they're wonderful.*
