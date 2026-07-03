/*
 * Pocket Golf Printable — course generator
 *
 * Generates dot-grid golf holes in the style of Paper Apps(TM) GOLF
 * (created by Tom Brinton). Pure logic module: works in the browser
 * (window.PaperGolf) and in Node (module.exports) so the generator
 * and solver can be tested headlessly.
 *
 * Rules the generator honors (see the rule guide):
 *  - Moves are straight lines in 8 directions, distance = die roll.
 *  - Fairway: +1 to roll (max move 7), may hit over trees.
 *  - Rough:   move exactly the roll (max 6).
 *  - Sand:    -1 to roll (max 5).
 *  - Water:   may fly over, never land on.
 *  - Trees:   never land on; may only fly over when hitting from fairway.
 *  - Slopes:  ball rolls 1 space per arrow until a non-arrow space;
 *             a slope pointing into water/trees is ignored; loops stop.
 *  - Par is 6 on every hole. A putt (move 1) is always allowed.
 *
 * Every generated hole is verified with a BFS solver to be finishable
 * in 3-6 strokes, so par 6 is always achievable.
 */
(function (global) {
  'use strict';

  var W = 15; // grid columns
  var H = 20; // grid rows

  var ROUGH = 0, FAIRWAY = 1, SAND = 2, WATER = 3, TREE = 4;

  // 8 move directions; first 4 are orthogonal (also used for slopes)
  var DIRS = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1]
  ];

  /* ------------------------------------------------------------------ *
   * Seeded RNG                                                          *
   * ------------------------------------------------------------------ */

  function xmur3(str) {
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      return (h ^= h >>> 16) >>> 0;
    };
  }

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function ri(rng, n) { return Math.floor(rng() * n); }
  function pick(rng, arr) { return arr[ri(rng, arr.length)]; }

  /* ------------------------------------------------------------------ *
   * Grid helpers                                                        *
   * ------------------------------------------------------------------ */

  function idx(x, y) { return y * W + x; }
  function inBounds(x, y) { return x >= 0 && x < W && y >= 0 && y < H; }

  // Cells of a straight line between two points (Bresenham).
  function lineCells(x0, y0, x1, y1) {
    var cells = [];
    var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    var err = dx - dy;
    var x = x0, y = y0;
    for (;;) {
      cells.push([x, y]);
      if (x === x1 && y === y1) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
    return cells;
  }

  // Grow a connected blob of up to `size` cells from `seed`, painting
  // `type` into cells where `allowed` returns true.
  function growBlob(rng, cells, seed, size, type, allowed) {
    var members = [];
    var seen = {};
    function tryAdd(x, y) {
      if (!inBounds(x, y)) return false;
      var k = idx(x, y);
      if (seen[k]) return false;
      if (!allowed(x, y)) return false;
      seen[k] = true;
      cells[k] = type;
      members.push([x, y]);
      return true;
    }
    if (!tryAdd(seed[0], seed[1])) return members;
    var guard = size * 30;
    while (members.length < size && guard-- > 0) {
      var from = pick(rng, members);
      var d = DIRS[ri(rng, 4)]; // orthogonal growth keeps blobs chunky
      tryAdd(from[0] + d[0], from[1] + d[1]);
    }
    return members;
  }

  // growBlob, but retry from fresh random seeds when the first seed
  // lands somewhere disallowed (keeps holes from coming out barren).
  function placeBlob(rng, cells, size, type, allowed) {
    for (var tries = 0; tries < 12; tries++) {
      var seed = [1 + ri(rng, W - 2), 1 + ri(rng, H - 2)];
      var members = growBlob(rng, cells, seed, size, type, allowed);
      if (members.length >= Math.max(2, size / 2)) return members;
    }
    return [];
  }

  /* ------------------------------------------------------------------ *
   * Solver — BFS over legal moves, returns minimum strokes or null      *
   * ------------------------------------------------------------------ */

  function maxMoveFrom(type) {
    if (type === FAIRWAY) return 7; // roll 6 + 1
    if (type === SAND) return 5;    // roll 6 - 1
    return 6;                       // rough
  }

  // Ball lands on `x,y`; follow slope arrows until it rests.
  function resolveSlope(hole, x, y) {
    var seen = {};
    seen[idx(x, y)] = true;
    for (;;) {
      var s = hole.slope[idx(x, y)];
      if (s < 0) break;
      var nx = x + DIRS[s][0], ny = y + DIRS[s][1];
      if (!inBounds(nx, ny)) break;
      var t = hole.cells[idx(nx, ny)];
      if (t === WATER || t === TREE) break; // slope into hazard: ignored
      if (seen[idx(nx, ny)]) break;         // opposing arrows: stop
      seen[idx(nx, ny)] = true;
      x = nx; y = ny;
    }
    return [x, y];
  }

  function solve(hole) {
    var start = idx(hole.tee.x, hole.tee.y);
    var target = idx(hole.hole.x, hole.hole.y);
    var dist = new Array(W * H).fill(Infinity);
    dist[start] = 0;
    var queue = [start];
    while (queue.length) {
      var cur = queue.shift();
      var cx = cur % W, cy = (cur - cx) / W;
      var strokes = dist[cur];
      if (strokes >= 12) continue;
      var fromType = hole.cells[cur];
      var maxD = maxMoveFrom(fromType);
      for (var di = 0; di < 8; di++) {
        var dx = DIRS[di][0], dy = DIRS[di][1];
        for (var step = 1; step <= maxD; step++) {
          var x = cx + dx * step, y = cy + dy * step;
          if (!inBounds(x, y)) break;
          var t = hole.cells[idx(x, y)];
          if (t === TREE) {
            if (fromType !== FAIRWAY) break; // blocked: can't fly over
            continue;                        // fly over, but can't land
          }
          if (t === WATER) continue;         // fly over, can't land
          var rest = resolveSlope(hole, x, y);
          var rk = idx(rest[0], rest[1]);
          if (dist[rk] > strokes + 1) {
            dist[rk] = strokes + 1;
            if (rk === target) return strokes + 1; // BFS: first hit is optimal
            queue.push(rk);
          }
        }
      }
    }
    return dist[target] === Infinity ? null : dist[target];
  }

  /* ------------------------------------------------------------------ *
   * Hole generation                                                     *
   * ------------------------------------------------------------------ */

  function buildHoleAttempt(rng, ease) {
    var cells = new Array(W * H).fill(ROUGH);
    var slope = new Array(W * H).fill(-1);

    // Tee near one short edge, cup near the other; flip half the time
    // so the course alternates visual direction.
    var flip = rng() < 0.5;
    var tee = { x: 2 + ri(rng, W - 4), y: 1 + ri(rng, 2) };
    var cup = { x: 2 + ri(rng, W - 4), y: H - 2 - ri(rng, 2) };
    if (flip) { var tmp = tee; tee = cup; cup = tmp; }

    // A wandering guide path from tee to cup: 2-3 waypoints with
    // lateral offsets create doglegs. Its 1-cell corridor is kept
    // clear of trees and water so the hole stays playable and honest.
    var waypoints = [[tee.x, tee.y]];
    var nWp = 2 + ri(rng, 2);
    for (var i = 1; i <= nWp; i++) {
      var fy = tee.y + Math.round((cup.y - tee.y) * (i / (nWp + 1)));
      var fx = Math.max(1, Math.min(W - 2, 1 + ri(rng, W - 2)));
      waypoints.push([fx, fy]);
    }
    waypoints.push([cup.x, cup.y]);

    var corridor = {};
    var pathCells = [];
    for (i = 0; i < waypoints.length - 1; i++) {
      var seg = lineCells(waypoints[i][0], waypoints[i][1], waypoints[i + 1][0], waypoints[i + 1][1]);
      for (var j = 0; j < seg.length; j++) {
        pathCells.push(seg[j]);
        for (var ox = -1; ox <= 1; ox++) {
          for (var oy = -1; oy <= 1; oy++) {
            if (inBounds(seg[j][0] + ox, seg[j][1] + oy)) {
              corridor[idx(seg[j][0] + ox, seg[j][1] + oy)] = true;
            }
          }
        }
      }
    }

    function isRough(x, y) { return cells[idx(x, y)] === ROUGH; }
    function offCorridor(x, y) { return !corridor[idx(x, y)]; }
    function notEndpoint(x, y) {
      return !(x === tee.x && y === tee.y) && !(x === cup.x && y === cup.y);
    }

    // Fairway: pads at the tee and the green, plus patches along the path.
    growBlob(rng, cells, [tee.x, tee.y], 4 + ri(rng, 4), FAIRWAY, isRough);
    growBlob(rng, cells, [cup.x, cup.y], 8 + ri(rng, 7), FAIRWAY, isRough);
    var nFw = 1 + ri(rng, 2);
    for (i = 0; i < nFw; i++) {
      var p = pick(rng, pathCells);
      growBlob(rng, cells, p, 8 + ri(rng, 10), FAIRWAY, isRough);
    }

    // Water hazards (0-2), off the corridor.
    var nWater = Math.round((rng() < 0.75 ? 1 : 2) * ease);
    for (i = 0; i < nWater; i++) {
      placeBlob(rng, cells, Math.round((7 + ri(rng, 12)) * ease), WATER,
        function (x, y) { return isRough(x, y) && offCorridor(x, y); });
    }

    // Tree clusters (2-4), off the corridor.
    var nTrees = Math.max(1, Math.round((2 + ri(rng, 3)) * ease));
    for (i = 0; i < nTrees; i++) {
      placeBlob(rng, cells, Math.round((4 + ri(rng, 10)) * ease), TREE,
        function (x, y) { return isRough(x, y) && offCorridor(x, y); });
    }

    // Sand traps (0-2); one often guards the green.
    var nSand = ri(rng, 3);
    for (i = 0; i < nSand; i++) {
      var near = i === 0
        ? [Math.max(0, Math.min(W - 1, cup.x + ri(rng, 7) - 3)),
           Math.max(0, Math.min(H - 1, cup.y + ri(rng, 7) - 3))]
        : pick(rng, pathCells);
      growBlob(rng, cells, near, 3 + ri(rng, 4), SAND, function (x, y) {
        return notEndpoint(x, y) &&
          (cells[idx(x, y)] === ROUGH || cells[idx(x, y)] === FAIRWAY);
      });
    }

    // Slopes: occasionally, a short run of arrows in one direction.
    if (rng() < 0.45) {
      var sd = ri(rng, 4);
      var sx = 1 + ri(rng, W - 2), sy = 2 + ri(rng, H - 4);
      var len = 2 + ri(rng, 3);
      for (i = 0; i < len; i++) {
        if (!inBounds(sx, sy)) break;
        var k = idx(sx, sy);
        var t2 = cells[k];
        if ((t2 === ROUGH || t2 === FAIRWAY) && notEndpoint(sx, sy)) slope[k] = sd;
        // lay arrows perpendicular to their pointing direction (a bank)
        sx += DIRS[sd][1]; sy += DIRS[sd][0];
      }
    }

    // Endpoints must be clean, restful spots.
    cells[idx(tee.x, tee.y)] = FAIRWAY;
    cells[idx(cup.x, cup.y)] = FAIRWAY;
    slope[idx(tee.x, tee.y)] = -1;
    slope[idx(cup.x, cup.y)] = -1;

    return { w: W, h: H, cells: cells, slope: slope, tee: tee, hole: cup, bigfoot: null };
  }

  function generateHole(rng) {
    for (var attempt = 0; attempt < 300; attempt++) {
      // Back off obstacle density if we keep failing, so generation
      // always terminates with a playable hole.
      var ease = attempt < 60 ? 1 : Math.max(0.15, 1 - (attempt - 60) / 120);
      var hole = buildHoleAttempt(rng, ease);
      var best = solve(hole);
      if (best !== null && best >= 3 && best <= 6) {
        hole.best = best;
        return hole;
      }
    }
    // Practically unreachable: an empty hole is always solvable.
    var fallback = buildHoleAttempt(rng, 0);
    fallback.best = solve(fallback);
    return fallback;
  }

  /* ------------------------------------------------------------------ *
   * Course generation                                                   *
   * ------------------------------------------------------------------ */

  var NAME_A = ['Whispering', 'Pebble', 'Sunny', 'Foggy', 'Old', 'Royal',
    'Hidden', 'Bent', 'Crooked', 'Sleepy', 'Windy', 'Thorny', 'Golden',
    'Mossy', 'Badger', 'Heron', 'Twin', 'Lost', 'Rolling', 'Quiet'];
  var NAME_B = ['Pines', 'Creek', 'Hollow', 'Meadows', 'Bluffs', 'Dunes',
    'Glen', 'Ridge', 'Marsh', 'Acres', 'Knolls', 'Gorse', 'Fields',
    'Prairie', 'Springs', 'Fox Run', 'Thistle', 'Willows', 'Heights', 'Bend'];
  var NAME_C = ['Golf Club', 'Links', 'Country Club', 'Golf Course',
    'Municipal Links', 'G.C.'];

  function generateCourse(seedStr, numHoles) {
    numHoles = numHoles || 18;
    var seedFn = xmur3(String(seedStr));
    var rng = mulberry32(seedFn());

    var name = pick(rng, NAME_A) + ' ' + pick(rng, NAME_B) + ' ' + pick(rng, NAME_C);

    var holes = [];
    for (var i = 0; i < numHoles; i++) holes.push(generateHole(rng));

    // In about 1/3 of courses, Bigfoot hides on one hole (free Mulligan!).
    if (rng() < 1 / 3) {
      var hb = pick(rng, holes);
      for (var tries = 0; tries < 100; tries++) {
        var bx = 1 + ri(rng, W - 2), by = 1 + ri(rng, H - 2);
        var far = Math.max(Math.abs(bx - hb.tee.x), Math.abs(by - hb.tee.y)) > 3 &&
                  Math.max(Math.abs(bx - hb.hole.x), Math.abs(by - hb.hole.y)) > 3;
        if (hb.cells[idx(bx, by)] === ROUGH && hb.slope[idx(bx, by)] < 0 && far) {
          hb.bigfoot = { x: bx, y: by };
          break;
        }
      }
    }

    return { name: name, seed: String(seedStr), holes: holes, par: numHoles * 6 };
  }

  var api = {
    W: W, H: H,
    ROUGH: ROUGH, FAIRWAY: FAIRWAY, SAND: SAND, WATER: WATER, TREE: TREE,
    DIRS: DIRS,
    generateCourse: generateCourse,
    generateHole: generateHole,
    solve: solve,
    resolveSlope: resolveSlope,
    mulberry32: mulberry32,
    xmur3: xmur3
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.PaperGolf = api;
})(typeof window !== 'undefined' ? window : this);
