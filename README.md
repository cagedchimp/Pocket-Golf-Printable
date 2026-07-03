# ⛳ Pocket Golf Printable

Generate printable dot-grid golf courses in the style of
[Paper Apps™ GOLF](https://gladdendesign.com/) (created by Tom Brinton).
Open the app, roll up a fresh 9- or 18-hole course, print it 4-up on
Letter or A4, cut the sheets into quarters, and hit the links with a
pencil and a d6.

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
- **Holes** — 9 or 18.
- **Paper** — Letter (quarters are 4.25 × 5.5 in) or A4 (quarters are
  exactly A6).
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
Bigfoot hides on one hole in about a third of courses; spotting him
earns a free mulligan.

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

- `index.html` — the whole app: UI, SVG rendering, print layout
- `golf.js` — pure course generator + rules solver (browser & Node)
- `test/generator.test.js` — solvability, determinism, and pacing checks

*Not affiliated with Paper Apps™ or Gladden Design — go buy their
notebooks, they're wonderful.*
