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

for (let s = 0; s < SEEDS; s++) {
  const course = golf.generateCourse('test-seed-' + s, 18);
  assert(course.holes.length === 18, `seed ${s}: expected 18 holes`);
  course.holes.forEach((h, i) => {
    const best = golf.solve(h);
    assert(best !== null, `seed ${s} hole ${i + 1}: unsolvable`);
    assert(best >= 3 && best <= 6, `seed ${s} hole ${i + 1}: best=${best} outside 3-6`);
    bestCounts[best] = (bestCounts[best] || 0) + 1;

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
      const rest = golf.resolveSlope(h, m.x, m.y);
      assert(rest[0] === m.rx && rest[1] === m.ry,
        `play hole ${i + 1}: rest position disagrees with resolveSlope`);
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

if (failures) {
  console.error(failures + ' failure(s)');
  process.exit(1);
}
console.log('All checks passed.');
