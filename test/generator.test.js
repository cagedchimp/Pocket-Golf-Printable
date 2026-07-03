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
    assert(cupCell === golf.FAIRWAY, `seed ${s} hole ${i + 1}: cup not on fairway pad`);

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
