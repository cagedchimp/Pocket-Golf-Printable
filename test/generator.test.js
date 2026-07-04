// Headless sanity checks for the course generator.
// Run with: node test/generator.test.js
'use strict';

const golf = require('../golf.js');

let failures = 0;
function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error('FAIL: ' + msg);
  }
}

const SEEDS = 60;
const t0 = Date.now();
const bestCounts = {};
const parCounts = {};
const wonderCounts = {};

// A hole's wonder must be a known kind allowed on this theme, sit on
// its habitat terrain, and keep clear of the tee and cup.
function checkWonder(course, label) {
  let found = 0;
  course.holes.forEach((h, i) => {
    if (!h.wonder) return;
    found++;
    const spec = golf.WONDERS[h.wonder.key];
    assert(!!spec, `${label} hole ${i + 1}: unknown wonder "${h.wonder.key}"`);
    if (!spec) return;
    assert(!spec.themes || spec.themes.includes(course.theme),
      `${label} hole ${i + 1}: ${h.wonder.key} not allowed on theme ${course.theme}`);
    assert(h.cells[h.wonder.y * h.w + h.wonder.x] === spec.habitat,
      `${label} hole ${i + 1}: ${h.wonder.key} off its habitat`);
    const clear = p => Math.max(Math.abs(h.wonder.x - p.x), Math.abs(h.wonder.y - p.y)) > 3;
    assert(clear(h.tee) && clear(h.hole),
      `${label} hole ${i + 1}: wonder too close to tee or cup`);
    wonderCounts[h.wonder.key] = (wonderCounts[h.wonder.key] || 0) + 1;
  });
  assert(found <= 1, `${label}: more than one wonder on the course`);
  return found;
}

let wonderCourses = 0;
for (let s = 0; s < SEEDS; s++) {
  const course = golf.generateCourse('test-seed-' + s, 18);
  assert(course.holes.length === 18, `seed ${s}: expected 18 holes`);
  assert(course.par === course.holes.reduce((a, h) => a + h.par, 0),
    `seed ${s}: course par ${course.par} != sum of hole pars`);
  wonderCourses += checkWonder(course, `seed ${s}`);
  course.holes.forEach((h, i) => {
    const best = golf.solve(h);
    assert(best !== null, `seed ${s} hole ${i + 1}: unsolvable`);
    assert(best >= 3 && best <= 6, `seed ${s} hole ${i + 1}: best=${best} outside 3-6`);
    bestCounts[best] = (bestCounts[best] || 0) + 1;

    // Par is the wind-aware optimum + 2, ±1 by tee→cup length.
    const len = Math.max(Math.abs(h.tee.x - h.hole.x), Math.abs(h.tee.y - h.hole.y));
    const wantPar = h.best + 2 + (len >= 20 ? 1 : len <= 16 ? -1 : 0);
    assert(h.par === wantPar, `seed ${s} hole ${i + 1}: par=${h.par}, want ${wantPar}`);
    parCounts[h.par] = (parCounts[h.par] || 0) + 1;

    const teeCell = h.cells[h.tee.y * h.w + h.tee.x];
    const cupCell = h.cells[h.hole.y * h.w + h.hole.x];
    assert(teeCell === golf.FAIRWAY, `seed ${s} hole ${i + 1}: tee not on fairway pad`);
    assert(cupCell === golf.GREEN, `seed ${s} hole ${i + 1}: cup not on the green`);

    // Golf anatomy: every hole has a real green and a fairway ribbon.
    const greenCells = h.cells.filter(c => c === golf.GREEN).length;
    const fairwayCells = h.cells.filter(c => c === golf.FAIRWAY).length;
    assert(greenCells >= 4, `seed ${s} hole ${i + 1}: green too small (${greenCells})`);
    assert(fairwayCells >= 12, `seed ${s} hole ${i + 1}: fairway ribbon too thin (${fairwayCells})`);

    // Slopes must never sit on tee/cup and never point straight into rest cells that loop forever
    const rest = golf.resolveSlope(h, h.hole.x, h.hole.y);
    assert(rest[0] === h.hole.x && rest[1] === h.hole.y, `seed ${s} hole ${i + 1}: cup on a slope`);
  });
}

// Themes: each generates solvable holes and skews terrain as advertised.
function countType(course, type) {
  let n = 0;
  course.holes.forEach(h => h.cells.forEach(c => { if (c === type) n++; }));
  return n / course.holes.length;
}
function countSlopes(course) {
  let n = 0;
  course.holes.forEach(h => h.slope.forEach(s => { if (s >= 0) n++; }));
  return n / course.holes.length;
}

// Wonders appear on roughly 1/3 of courses (60 draws: expect ~20).
assert(wonderCourses >= 10 && wonderCourses <= 30,
  `wonder rate off: ${wonderCourses}/60 courses`);

// Sweep the wonder-restricted themes so the rarer kinds (kraken, UFO,
// castle) each turn up somewhere and get their placement checked.
for (const themeKey of ['lakeside', 'dunes', 'highlands']) {
  for (let s = 0; s < 40; s++) {
    checkWonder(golf.generateCourse('wonder-' + s, 9, themeKey), `wonder-${s} ${themeKey}`);
  }
}
assert(Object.keys(wonderCounts).length >= 3,
  `expected several wonder kinds across the sweep, saw: ${JSON.stringify(wonderCounts)}`);

const themed = {};
for (const key of Object.keys(golf.THEMES)) {
  const course = golf.generateCourse('theme-check', 18, key);
  assert(course.theme === key, `theme ${key}: not recorded on course`);
  course.holes.forEach((h, i) => {
    const best = golf.solve(h);
    assert(best !== null && best >= 3 && best <= 6,
      `theme ${key} hole ${i + 1}: best=${best}`);
  });
  themed[key] = course;
}

assert(countType(themed.forest, golf.TREE) > countType(themed.classic, golf.TREE) * 1.5,
  'forest theme should have noticeably more trees than classic');
assert(countType(themed.lakeside, golf.WATER) > countType(themed.classic, golf.WATER) * 1.5,
  'lakeside theme should have noticeably more water than classic');
assert(countType(themed.dunes, golf.SAND) > countType(themed.classic, golf.SAND) * 1.5,
  'dunes theme should have noticeably more sand than classic');
assert(countSlopes(themed.highlands) > countSlopes(themed.classic) * 1.5,
  'highlands theme should have noticeably more slopes than classic');
console.log('Avg cells/hole —',
  'classic trees:', countType(themed.classic, golf.TREE).toFixed(1),
  '| forest trees:', countType(themed.forest, golf.TREE).toFixed(1),
  '| classic water:', countType(themed.classic, golf.WATER).toFixed(1),
  '| lakeside water:', countType(themed.lakeside, golf.WATER).toFixed(1),
  '| classic sand:', countType(themed.classic, golf.SAND).toFixed(1),
  '| dunes sand:', countType(themed.dunes, golf.SAND).toFixed(1),
  '| classic slopes:', countSlopes(themed.classic).toFixed(1),
  '| highlands slopes:', countSlopes(themed.highlands).toFixed(1));

// Difficulty tiers: casual holes are always reachable in 3 optimal
// strokes, tough holes never are; tough piles on water and trims the
// mulligan budget; and the default tier is exactly the legacy call.
{
  for (let s = 0; s < 4; s++) {
    const legacy = golf.generateCourse('diff-' + s, 9, 'lakeside');
    const explicit = golf.generateCourse('diff-' + s, 9, 'lakeside', 'standard');
    assert(JSON.stringify(legacy) === JSON.stringify(explicit),
      `diff-${s}: standard should equal the legacy 3-arg call`);

    const casual = golf.generateCourse('diff-' + s, 9, 'lakeside', 'casual');
    const tough = golf.generateCourse('diff-' + s, 9, 'lakeside', 'tough');
    assert(casual.mulligans === 8 && legacy.mulligans === 6 && tough.mulligans === 4,
      `diff-${s}: mulligan budgets wrong`);
    assert(casual.rating >= 1 && casual.rating <= 3 && tough.rating >= 2,
      `diff-${s}: ratings out of range (casual ${casual.rating}, tough ${tough.rating})`);
    casual.holes.forEach((h, i) =>
      assert(h.best === 3, `diff-${s} casual hole ${i + 1}: best=${h.best}, want 3`));
    tough.holes.forEach((h, i) =>
      assert(h.best >= 4 && h.best <= 6, `diff-${s} tough hole ${i + 1}: best=${h.best}, want 4-6`));

    const water = c => c.holes.reduce(
      (n, h) => n + h.cells.filter(t => t === golf.WATER).length, 0);
    assert(water(tough) > water(legacy),
      `diff-${s}: tough lakeside should carry more water (${water(tough)} vs ${water(legacy)})`);

    assert(JSON.stringify(tough) ===
      JSON.stringify(golf.generateCourse('diff-' + s, 9, 'lakeside', 'tough')),
      `diff-${s}: tough generation not deterministic`);

    // Pars vary within a course and spread upward with difficulty.
    const avgPar = c => c.par / c.holes.length;
    assert(avgPar(tough) > avgPar(casual),
      `diff-${s}: tough avg par ${avgPar(tough).toFixed(2)} should beat casual ${avgPar(casual).toFixed(2)}`);
    const spread = c => new Set(c.holes.map(h => h.par)).size;
    assert(spread(casual) + spread(legacy) + spread(tough) >= 5,
      `diff-${s}: pars too uniform (spreads ${spread(casual)}/${spread(legacy)}/${spread(tough)})`);
    checkWonder(casual, `diff-${s} casual`);
    checkWonder(tough, `diff-${s} tough`);
  }
  // Tough works across themes, not just the watery one.
  for (const themeKey of ['classic', 'forest', 'highlands']) {
    const c = golf.generateCourse('diff-theme', 9, themeKey, 'tough');
    c.holes.forEach((h, i) =>
      assert(h.best >= 4, `tough ${themeKey} hole ${i + 1}: best=${h.best}`));
  }
}

// Play-mode move logic: from the tee (and along a played-out route),
// every roll offers at least one legal move, no offered landing sits
// on water or trees, and rest positions agree with the slope solver.
const playCourse = golf.generateCourse('play-mode-check', 9);
playCourse.holes.forEach((h, i) => {
  for (let roll = 1; roll <= 6; roll++) {
    const moves = golf.movesForRoll(h, h.tee.x, h.tee.y, roll);
    assert(moves.length > 0, `play hole ${i + 1} roll ${roll}: no legal moves from tee`);
    moves.forEach(m => {
      const t = h.cells[m.y * h.w + m.x];
      assert(t !== golf.WATER && t !== golf.TREE,
        `play hole ${i + 1}: offered landing on a hazard at ${m.x},${m.y}`);
      const rest = golf.resolveLanding(h, m.x, m.y, m.dist, false);
      assert(rest[0] === m.rx && rest[1] === m.ry,
        `play hole ${i + 1}: rest position disagrees with resolveLanding`);
    });
  }

  // Simulate a round with a seeded die, choosing each stroke with the
  // solver. Two invariants: there is always a legal move, and no legal
  // move ever strands the ball somewhere the cup can't be reached from.
  const die = golf.mulberry32(1000 + i);
  let ball = { x: h.tee.x, y: h.tee.y };
  let strokes = 0;
  while ((ball.x !== h.hole.x || ball.y !== h.hole.y) && strokes < 100) {
    const roll = 1 + Math.floor(die() * 6);
    const moves = golf.movesForRoll(h, ball.x, ball.y, roll);
    assert(moves.length > 0,
      `play hole ${i + 1}: no legal move at ${ball.x},${ball.y} with roll ${roll}`);
    if (!moves.length) break;
    let best = null, bestD = Infinity;
    for (const m of moves) {
      if (m.rx === h.hole.x && m.ry === h.hole.y) { best = m; break; }
      const d = golf.solve(Object.assign({}, h, { tee: { x: m.rx, y: m.ry } }));
      assert(d !== null,
        `play hole ${i + 1}: landing at ${m.rx},${m.ry} strands the ball`);
      if (d !== null && d < bestD) { bestD = d; best = m; }
    }
    ball = { x: best.rx, y: best.ry };
    strokes++;
  }
  assert(ball.x === h.hole.x && ball.y === h.hole.y,
    `play hole ${i + 1}: solver-guided round did not finish in 100 strokes`);
});

// A putt (move 1) is always among the options unless every neighbor
// is a hazard; on the green a 2-space putt is offered too.
{
  const h = playCourse.holes[0];
  const moves = golf.movesForRoll(h, h.tee.x, h.tee.y, 6);
  assert(moves.some(m => m.dist === 1), 'putt option missing from tee');
}

// Wind: deterministic, direction in range, and the wind-aware solver
// still fits the stroke gate on every windy hole. Wind must obey its
// conventions: never drift a lofted or short shot, never into hazards.
{
  const a = golf.generateCourse('wind-check', 18, 'lakeside');
  const b = golf.generateCourse('wind-check', 18, 'lakeside');
  assert(JSON.stringify(a.holes.map(h => h.wind)) === JSON.stringify(b.holes.map(h => h.wind)),
    'wind assignment not deterministic');
  a.holes.forEach(h => {
    if (h.wind < 0) assert(!h.windStr, 'calm hole carries wind strength');
  });
  const windy = a.holes.filter(h => h.wind >= 0);
  assert(windy.length > 0, 'expected some windy holes on a standard course');
  windy.forEach(h => {
    assert(h.wind >= 0 && h.wind < 8, 'wind direction out of range');
    assert(h.windStr === 1 || h.windStr === 2, `wind strength ${h.windStr} out of range`);
    const wb = golf.solve(h);
    assert(wb !== null && wb >= 3 && wb <= 6, `windy hole solves to ${wb}`);
    // drift conventions, probed through windPoint
    const far = golf.windPoint(h, h.tee.x, h.tee.y, 4, false);
    const short = golf.windPoint(h, h.tee.x, h.tee.y, 3, false);
    const lofted = golf.windPoint(h, h.tee.x, h.tee.y, 4, true);
    assert(short[0] === h.tee.x && short[1] === h.tee.y, 'short shot drifted');
    assert(lofted[0] === h.tee.x && lofted[1] === h.tee.y, 'lofted shot drifted');
    if (far[0] !== h.tee.x || far[1] !== h.tee.y) {
      const t = h.cells[far[1] * h.w + far[0]];
      assert(t !== golf.WATER && t !== golf.TREE, 'wind drifted into a hazard');
    }
    const cup = golf.windPoint(h, h.hole.x, h.hole.y, 6, false);
    assert(cup[0] === h.hole.x && cup[1] === h.hole.y, 'wind blew a holed ball out');
    // drift distance is bounded by the wind strength
    if (far[0] !== h.tee.x || far[1] !== h.tee.y) {
      const d = Math.max(Math.abs(far[0] - h.tee.x), Math.abs(far[1] - h.tee.y));
      assert(d <= h.windStr, `drifted ${d} with strength ${h.windStr}`);
    }
  });
  // Gales (strength 2) exist somewhere across a small sweep.
  let gales = 0;
  for (let s = 0; s < 8; s++) {
    golf.generateCourse('gale-' + s, 9, 'classic', 'tough').holes.forEach(h => {
      if (h.windStr === 2) gales++;
    });
  }
  assert(gales > 0, 'expected at least one gale across the sweep');
}

// Clubs: every club offers legal moves whose rest positions agree
// with resolveLanding; the wedge halves the roll, flies over trees,
// and never wind-drifts; the driver only gains distance on fairway.
playCourse.holes.forEach((h, i) => {
  for (let roll = 1; roll <= 6; roll++) {
    for (const club of ['iron', 'driver', 'wedge']) {
      const moves = golf.movesForRoll(h, h.tee.x, h.tee.y, roll, club);
      assert(moves.length > 0, `hole ${i + 1} roll ${roll} ${club}: no moves`);
      const lofted = club === 'wedge';
      moves.forEach(m => {
        const t = h.cells[m.y * h.w + m.x];
        assert(t !== golf.WATER && t !== golf.TREE,
          `hole ${i + 1} ${club}: landing on hazard`);
        const rest = golf.resolveLanding(h, m.x, m.y, m.dist, lofted && m.dist !== 1 && m.dist !== 2);
        assert(rest[0] === m.rx && rest[1] === m.ry,
          `hole ${i + 1} ${club}: rest disagrees with resolveLanding`);
      });
      if (club === 'wedge') {
        const maxSwing = Math.ceil(roll / 2);
        moves.forEach(m => assert(m.dist <= Math.max(maxSwing, 2),
          `hole ${i + 1} wedge roll ${roll}: dist ${m.dist} too long`));
      }
    }
  }
  // The tee sits on fairway, so the driver swing is one space longer
  // than the iron swing for the same roll (when that distance has any
  // legal landing at all).
  if (golf.shotTargets(h, h.tee.x, h.tee.y, 5).length) {
    assert(golf.movesForRoll(h, h.tee.x, h.tee.y, 3, 'driver').some(m => m.dist === 5),
      `hole ${i + 1}: driver roll 3 from tee should offer 5-space shots`);
  }
  if (golf.shotTargets(h, h.tee.x, h.tee.y, 4).length) {
    assert(golf.movesForRoll(h, h.tee.x, h.tee.y, 3, 'iron').some(m => m.dist === 4),
      `hole ${i + 1}: iron roll 3 from tee should offer 4-space shots`);
  }
});

// Sheet composition: holes blitted onto one shared grid must keep
// their exact terrain (so each stays solvable to its original best),
// must land inside the grid, and must never put two holes' playable
// (non-rough) cells adjacent — a rough gutter separates every region.
{
  const course = golf.generateCourse('compose-check', 18, 'lakeside', 'tough');
  const sheet = golf.composeSheet(course.holes.slice(0, 4), 2, 2, 1);
  assert(sheet.placements.length === 4, 'expected 4 placements');
  const PLAY = new Set([golf.FAIRWAY, golf.SAND, golf.WATER, golf.TREE, golf.GREEN]);
  sheet.placements.forEach(pl => {
    const src = pl.hole;
    // extract the region back out and confirm it is byte-identical
    let match = true;
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const gk = (pl.oy + y) * sheet.w + (pl.ox + x);
        if (sheet.cells[gk] !== src.cells[y * src.w + x]) match = false;
        if (sheet.slope[gk] !== src.slope[y * src.w + x]) match = false;
      }
    }
    assert(match, `hole ${pl.num}: composed region differs from source`);
    assert(sheet.cells[pl.tee.y * sheet.w + pl.tee.x] === golf.FAIRWAY, `hole ${pl.num}: tee misplaced`);
    assert(sheet.cells[pl.cup.y * sheet.w + pl.cup.x] === golf.GREEN, `hole ${pl.num}: cup misplaced`);
    assert(pl.tee.x >= 0 && pl.tee.x < sheet.w && pl.cup.y >= 0 && pl.cup.y < sheet.h,
      `hole ${pl.num}: endpoints out of grid`);
  });
  // no playable cell borders a *different* hole's playable cell
  function ownerAt(gx, gy) {
    for (const pl of sheet.placements) {
      if (gx >= pl.ox && gx < pl.ox + pl.hole.w && gy >= pl.oy && gy < pl.oy + pl.hole.h) return pl.num;
    }
    return 0; // gutter
  }
  let leaks = 0;
  for (let gy = 0; gy < sheet.h; gy++) {
    for (let gx = 0; gx < sheet.w; gx++) {
      if (!PLAY.has(sheet.cells[gy * sheet.w + gx])) continue;
      const me = ownerAt(gx, gy);
      [[1,0],[0,1]].forEach(([dx,dy]) => {
        const nx = gx+dx, ny = gy+dy;
        if (nx >= sheet.w || ny >= sheet.h) return;
        if (PLAY.has(sheet.cells[ny*sheet.w+nx]) && ownerAt(nx,ny) !== me) leaks++;
      });
    }
  }
  assert(leaks === 0, `composed sheet has ${leaks} cross-hole playable adjacencies`);
}

// packSheet: the organic (rotated, interlocking) sheet. Placements
// must be deterministic, land tee/cup on the right terrain in-grid,
// and — the load-bearing guarantee — no hole's playable cell may
// border a different hole's playable cell (rough separates them).
{
  const course = golf.generateCourse('pack-check', 18, 'forest', 'tough');
  const PLAY = new Set([golf.FAIRWAY, golf.SAND, golf.WATER, golf.TREE, golf.GREEN]);
  const s = golf.packSheet(course.holes.slice(0, 6));
  assert(s.placements.length === 6, 'expected 6 placements');
  const s2 = golf.packSheet(course.holes.slice(0, 6));
  assert(JSON.stringify(s.placements.map(p => [p.rot, p.tee, p.cup])) ===
         JSON.stringify(s2.placements.map(p => [p.rot, p.tee, p.cup])),
    'packSheet not deterministic');
  s.placements.forEach(p => {
    assert(p.tee.x >= 0 && p.tee.x < s.w && p.tee.y >= 0 && p.tee.y < s.h, `hole ${p.num}: tee off-grid`);
    assert(p.cup.x >= 0 && p.cup.x < s.w && p.cup.y >= 0 && p.cup.y < s.h, `hole ${p.num}: cup off-grid`);
    assert(s.cells[p.tee.y * s.w + p.tee.x] === golf.FAIRWAY, `hole ${p.num}: tee terrain wrong`);
    assert(s.cells[p.cup.y * s.w + p.cup.x] === golf.GREEN, `hole ${p.num}: cup terrain wrong`);
  });
  let leaks = 0;
  for (let gy = 0; gy < s.h; gy++) {
    for (let gx = 0; gx < s.w; gx++) {
      const k = gy * s.w + gx;
      if (!PLAY.has(s.cells[k])) continue;
      const me = s.owner[k];
      [[1,0],[0,1]].forEach(([dx,dy]) => {
        const nx = gx+dx, ny = gy+dy;
        if (nx >= s.w || ny >= s.h) return;
        const nk = ny*s.w+nx;
        if (PLAY.has(s.cells[nk]) && s.owner[nk] && s.owner[nk] !== me) leaks++;
      });
    }
  }
  assert(leaks === 0, `packed sheet has ${leaks} cross-hole playable adjacencies`);
  // organic cluster: holes compact into an interlaced blob with no
  // reserved centerpiece. Grid aspect stays page-like, consecutive
  // holes stay routed close, and neighbours reach the 1-cell seam.
  const s9 = golf.packSheet(course.holes.slice(0, 9), { aspect: 8.5 / 11 });
  assert(s9.placements.length === 9, 'expected 9 placements');
  [s, s9].forEach(sheet => {
    assert(!sheet.commons, 'organic layout should not reserve a commons');
    assert(sheet.w / sheet.h > 0.55 && sheet.w / sheet.h < 1.3,
      `grid aspect off: ${(sheet.w/sheet.h).toFixed(2)}`);
    for (let i = 0; i + 1 < sheet.placements.length; i++) {
      const a = sheet.placements[i].cup, b = sheet.placements[i + 1].tee;
      const d = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
      assert(d <= 26, `hop ${i} too long: ${d}`);
    }
    // interlacing: most consecutive pairs sit at the minimum legal gap
    function nearestGap(a, b) {
      let bestD = 99;
      for (let k = 0; k < sheet.cells.length; k++) {
        if (sheet.owner[k] !== a) continue;
        const x1 = k % sheet.w, y1 = (k - x1) / sheet.w;
        for (let j = 0; j < sheet.cells.length; j++) {
          if (sheet.owner[j] !== b) continue;
          const x2 = j % sheet.w, y2 = (j - x2) / sheet.w;
          const d = Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2));
          if (d < bestD) bestD = d;
        }
      }
      return bestD;
    }
    let tight = 0;
    for (let i = 1; i < sheet.placements.length; i++) {
      if (nearestGap(i, i + 1) <= 3) tight++;
    }
    assert(tight >= sheet.placements.length - 3,
      `holes not interlaced: only ${tight} tight consecutive pairs`);
  });
  // commons-anchored lakes are big: force a lake and count its cells
  {
    const sl = golf.packSheet(course.holes.slice(0, 6), { aspect: 6 / 8 });
    const before = sl.cells.slice();
    golf.decorateSheet(sl, { rng: golf.mulberry32(7), themeKey: 'dunes', chance: 1, kind: 'lake' });
    let painted = 0;
    for (let k = 0; k < sl.cells.length; k++) {
      if (sl.cells[k] === golf.WATER && before[k] === golf.ROUGH) painted++;
    }
    assert(painted >= 150, `commons lake too small: ${painted} cells`);
  }
}

// decorateSheet: a sheet-spanning water feature must only flood rough,
// never fairway/green/sand/tree, and must leave every hole solvable
// (3–6). Sweep several seeds so both rivers and lakes get exercised.
{
  const NONROUGH_PLAY = new Set([golf.FAIRWAY, golf.SAND, golf.TREE, golf.GREEN]);
  let features = 0;
  for (let s = 0; s < 30; s++) {
    const course = golf.generateCourse('deco-' + s, 18, 'lakeside', 'standard');
    const comp = golf.packSheet(course.holes.slice(0, 6));
    // snapshot non-rough cells before decorating
    const before = comp.cells.slice();
    golf.decorateSheet(comp, { rng: golf.mulberry32(1000 + s), themeKey: 'lakeside', chance: 1 });
    if (comp.feature) features++;
    // no fairway/green/sand/tree was overwritten
    for (let k = 0; k < comp.cells.length; k++) {
      if (NONROUGH_PLAY.has(before[k])) {
        assert(comp.cells[k] === before[k], `deco-${s}: overwrote protected terrain at ${k}`);
      }
    }
    // reconstruct each hole's local frame with the added water; solve
    const water = {}; // holeIdx -> [localIdx...]
    for (let k = 0; k < comp.cells.length; k++) {
      if (comp.cells[k] === golf.WATER && before[k] === golf.ROUGH && comp.region[k]) {
        (water[comp.region[k]] = water[comp.region[k]] || []).push(comp.regionLoc[k]);
      }
    }
    comp.placements.forEach(p => {
      const local = p.hole.cells.slice();
      (water[p.num] || []).forEach(li => { local[li] = golf.WATER; });
      const best = golf.solve({ w: p.hole.w, h: p.hole.h, cells: local, slope: p.hole.slope,
        tee: p.hole.tee, hole: p.hole.hole, wind: p.hole.wind, windStr: p.hole.windStr });
      assert(best !== null && best >= 3 && best <= 6,
        `deco-${s} hole ${p.num}: unsolvable after feature (best=${best})`);
    });
  }
  assert(features >= 20, `expected most sheets to get a feature, got ${features}/30`);

  // decorated sheets stay playable as printed on every theme, and the
  // interior of the cluster carries decoration (no big bare hollow):
  // within the content bounding box, plain rough stays a minority.
  for (const theme of ['classic', 'forest', 'lakeside', 'dunes', 'highlands']) {
    for (let s = 0; s < 4; s++) {
      const course = golf.generateCourse('mid-' + s, 9, theme, 'standard');
      const comp = golf.packSheet(course.holes.slice(0, 6), { aspect: 6 / 8 });
      golf.decorateSheet(comp, { rng: golf.mulberry32(500 + s), themeKey: theme });
      let bare = 0, total = 0;
      for (let y = 4; y < comp.h - 4; y++) {
        for (let x = 4; x < comp.w - 4; x++) {
          total++;
          if (comp.cells[y * comp.w + x] === golf.ROUGH && comp.slope[y * comp.w + x] < 0) bare++;
        }
      }
      assert(bare <= total * 0.52, `${theme} mid-${s}: sparse interior (${bare}/${total} bare)`);
      const res = golf.validateSheet(comp);
      assert(res.every(b => b !== null && b >= 3 && b <= 6),
        `${theme} mid-${s}: sheet not playable as printed`);
    }
  }
}

// Determinism: same seed -> identical course
const a = golf.generateCourse('determinism', 9);
const b = golf.generateCourse('determinism', 9);
assert(JSON.stringify(a) === JSON.stringify(b), 'same seed should produce identical courses');

// Different seeds -> different layout (overwhelmingly likely)
const c = golf.generateCourse('other-seed', 9);
assert(JSON.stringify(a) !== JSON.stringify(c), 'different seeds should differ');

const dt = Date.now() - t0;
console.log(`Generated ${SEEDS} courses (${SEEDS * 18} holes) in ${dt}ms`);
console.log('Optimal-stroke distribution:', bestCounts);
console.log('Par distribution:', parCounts);
console.log('Wonders seen:', wonderCounts);

if (failures) {
  console.error(failures + ' failure(s)');
  process.exit(1);
}
console.log('All checks passed.');
