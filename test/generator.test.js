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
