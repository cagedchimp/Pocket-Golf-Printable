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
 *  - Green:   plays like rough for full swings, but putts may move
 *             1 or 2 spaces (house rule; doesn't change reachability).
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

  var ROUGH = 0, FAIRWAY = 1, SAND = 2, WATER = 3, TREE = 4, GREEN = 5;

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
    return 6;                       // rough & green: move exactly the roll
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

  // Where the wind leaves a ball that lands on (x, y) after a shot of
  // `dist` spaces: shots of 4+ drift downwind one space per point of
  // wind strength (hole.windStr, 1 = breeze, 2 = gale), unless the
  // shot was lofted (wedge) or the ball landed in the cup (holed is
  // holed). Drift stops at water, trees, the grid edge — or the cup.
  function windPoint(hole, x, y, dist, lofted) {
    var w = hole.wind;
    if (w == null || w < 0 || dist < 4 || lofted ||
        (x === hole.hole.x && y === hole.hole.y)) return [x, y];
    var steps = hole.windStr || 1;
    for (var i = 0; i < steps; i++) {
      var wx = x + DIRS[w][0], wy = y + DIRS[w][1];
      if (!inBounds(wx, wy)) break;
      var t = hole.cells[idx(wx, wy)];
      if (t === WATER || t === TREE) break;
      x = wx; y = wy;
      if (x === hole.hole.x && y === hole.hole.y) break; // blown in!
    }
    return [x, y];
  }

  // Full landing resolution: wind drift first, then slope arrows.
  function resolveLanding(hole, x, y, dist, lofted) {
    var wp = windPoint(hole, x, y, dist, lofted);
    return resolveSlope(hole, wp[0], wp[1]);
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
          var rest = resolveLanding(hole, x, y, step, false);
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
   * Playable moves — legality of a single shot, shared with the         *
   * website's on-screen play mode                                       *
   * ------------------------------------------------------------------ */

  // Landing cells for a straight shot of exactly `dist` spaces from
  // (x, y): 8 directions, trees block unless hitting from fairway (or
  // opts.overTrees — a lofted wedge), water and trees can be flown
  // over but never landed on. Each entry carries the wind-drifted
  // point (wx, wy) and the final rest position after slope arrows.
  function shotTargets(hole, x, y, dist, opts) {
    var out = [];
    if (dist < 1) return out;
    var fromType = hole.cells[idx(x, y)];
    var overTrees = fromType === FAIRWAY || !!(opts && opts.overTrees);
    var lofted = !!(opts && opts.lofted);
    for (var di = 0; di < 8; di++) {
      var ok = true, nx = x, ny = y;
      for (var step = 1; step <= dist; step++) {
        nx = x + DIRS[di][0] * step;
        ny = y + DIRS[di][1] * step;
        if (!inBounds(nx, ny)) { ok = false; break; }
        var t = hole.cells[idx(nx, ny)];
        if (t === TREE && !overTrees) { ok = false; break; }
        if (step === dist && (t === TREE || t === WATER)) ok = false;
      }
      if (!ok) continue;
      var wp = windPoint(hole, nx, ny, dist, lofted);
      var rest = resolveSlope(hole, wp[0], wp[1]);
      out.push({ x: nx, y: ny, wx: wp[0], wy: wp[1], rx: rest[0], ry: rest[1], dist: dist });
    }
    return out;
  }

  // Every legal destination for a die roll from (x, y) with the chosen
  // club (default iron):
  //  - iron:   the full swing (fairway +1, sand −1, else exactly)
  //  - driver: the iron swing +1 more — but only from the tee box or
  //            fairway; anywhere else it plays as an iron
  //  - wedge:  half the roll rounded up, lofted — flies over trees
  //            from anywhere, immune to wind, ignores terrain mods
  // plus the always-allowed putt of 1 space — or 1-2 on the green.
  // Deduped by landing cell; each move keeps the distance that got it.
  function movesForRoll(hole, x, y, roll, club) {
    var t = hole.cells[idx(x, y)];
    var seen = {}, out = [];
    function addAll(moves) {
      moves.forEach(function (m) {
        var k = idx(m.x, m.y);
        if (seen[k]) return;
        seen[k] = true;
        out.push(m);
      });
    }
    if (club === 'wedge') {
      addAll(shotTargets(hole, x, y, Math.ceil(roll / 2), { overTrees: true, lofted: true }));
    } else {
      var swing = roll + (t === FAIRWAY ? 1 : t === SAND ? -1 : 0);
      if (club === 'driver' && t === FAIRWAY) swing += 1;
      addAll(shotTargets(hole, x, y, swing));
    }
    addAll(shotTargets(hole, x, y, 1));
    if (t === GREEN) addAll(shotTargets(hole, x, y, 2));
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Themes — how much of each feature a course leans on                 *
   * ------------------------------------------------------------------ */

  // Counts are [min,max] ranges rolled per hole; sizes are blob cell
  // counts. `creek` is the odds of a water band crossing the fairway,
  // `slopeChance` the odds a hole gets slope runs at all.
  var THEMES = {
    classic: {
      label: 'Classic', trees: 'deciduous',
      creek: 0.35, creekWide: 0.3,
      pondN: [0, 1], pondSize: [6, 12],
      treeN: [2, 4], treeSize: [4, 10],
      greenSandN: [1, 2], fwSandN: [0, 1], sandSize: [2, 4],
      slopeChance: 0.45, slopeRuns: [1, 1],
      nouns: null
    },
    forest: {
      label: 'Deep Forest', trees: 'conifer',
      creek: 0.25, creekWide: 0.2,
      pondN: [0, 1], pondSize: [4, 8],
      treeN: [15, 19], treeSize: [11, 22],
      greenSandN: [0, 1], fwSandN: [0, 0], sandSize: [2, 3],
      slopeChance: 0.3, slopeRuns: [1, 1],
      nouns: ['Pines', 'Timber', 'Cedars', 'Redwoods', 'Thicket', 'Grove', 'Woods', 'Hollow']
    },
    lakeside: {
      label: 'Lakeside', trees: 'deciduous',
      creek: 0.75, creekWide: 0.5,
      pondN: [1, 2], pondSize: [10, 20],
      treeN: [4, 6], treeSize: [5, 11],
      greenSandN: [0, 2], fwSandN: [0, 0], sandSize: [2, 4],
      slopeChance: 0.3, slopeRuns: [1, 1],
      nouns: ['Lakes', 'Shores', 'Coves', 'Marsh', 'Waters', 'Inlet', 'Bayou', 'Springs']
    },
    dunes: {
      label: 'Sandy Dunes', trees: 'palm',
      creek: 0.1, creekWide: 0.2,
      pondN: [0, 1], pondSize: [4, 7],
      treeN: [3, 5], treeSize: [4, 9],
      greenSandN: [2, 3], fwSandN: [2, 4], sandSize: [3, 6],
      slopeChance: 0.35, slopeRuns: [1, 2],
      nouns: ['Dunes', 'Sands', 'Links', 'Flats', 'Barrens', 'Shells', 'Salt Flats']
    },
    highlands: {
      label: 'Highlands', trees: 'conifer',
      creek: 0.35, creekWide: 0.2,
      pondN: [0, 1], pondSize: [5, 10],
      treeN: [1, 3], treeSize: [3, 8],
      greenSandN: [1, 2], fwSandN: [0, 1], sandSize: [2, 4],
      slopeChance: 1.0, slopeRuns: [2, 4],
      nouns: ['Highlands', 'Bluffs', 'Ridge', 'Knolls', 'Heights', 'Fells', 'Crags', 'Moors']
    }
  };

  /* ------------------------------------------------------------------ *
   * Wonders — rare hidden landmarks. At most one per course; spotting   *
   * it in play mode earns a free mulligan (like Bigfoot always has).    *
   * ------------------------------------------------------------------ */

  // weight: relative odds among the wonders eligible for the theme.
  // themes: null = anywhere; otherwise only these theme keys.
  // habitat: the terrain the wonder hides on.
  var WONDERS = {
    bigfoot: { label: 'Bigfoot', weight: 12, themes: null, habitat: ROUGH },
    gnome:   { label: 'the garden gnome', weight: 12, themes: null, habitat: ROUGH },
    castle:  { label: 'the old castle', weight: 5,
               themes: ['classic', 'forest', 'highlands'], habitat: ROUGH },
    ufo:     { label: 'a UFO', weight: 3,
               themes: ['classic', 'dunes', 'highlands'], habitat: ROUGH },
    kraken:  { label: 'the kraken', weight: 2,
               themes: ['lakeside'], habitat: WATER }
  };

  // About 1/3 of courses get a wonder; which one is a weighted pick
  // among those at home in the theme, so e.g. the kraken only ever
  // surfaces on lakeside courses — and rarely even there.
  function rollWonder(rng, themeKey) {
    if (rng() >= 1 / 3) return null;
    var keys = Object.keys(WONDERS).filter(function (k) {
      var w = WONDERS[k].themes;
      return !w || w.indexOf(themeKey) >= 0;
    });
    var total = 0;
    keys.forEach(function (k) { total += WONDERS[k].weight; });
    var r = rng() * total;
    for (var i = 0; i < keys.length; i++) {
      r -= WONDERS[keys[i]].weight;
      if (r < 0) return keys[i];
    }
    return keys[keys.length - 1];
  }

  function rollN(rng, range, ease) {
    var n = range[0] + ri(rng, range[1] - range[0] + 1);
    return Math.round(n * ease);
  }
  function rollSize(rng, range, ease) {
    return Math.max(2, Math.round((range[0] + ri(rng, range[1] - range[0] + 1)) * ease));
  }

  /* ------------------------------------------------------------------ *
   * Difficulty — how demanding a course is to score on                  *
   * ------------------------------------------------------------------ */

  // minBest/maxBest gate the solver's optimal stroke count per hole
  // (tough holes can't be reached in 3 perfect shots). density scales
  // hazard counts. moat/island/wideWater are per-hole odds of water
  // features that guard the green or demand bigger carries.
  //
  // IMPORTANT: standard must add no RNG draws and scale nothing, so
  // that courses from pre-difficulty share links come out identical.
  var DIFFICULTIES = {
    casual: {
      label: 'Casual', mulligans: 8, density: 0.75,
      minBest: 3, maxBest: 3, moat: 0, island: 0, wideWater: 0, wind: 0.25
    },
    standard: {
      label: 'Standard', mulligans: 6, density: 1,
      minBest: 3, maxBest: 6, moat: 0, island: 0, wideWater: 0, wind: 0.45
    },
    tough: {
      label: 'Tough', mulligans: 4, density: 1.3,
      minBest: 4, maxBest: 6, moat: 0.45, island: 0.18, wideWater: 0.5, wind: 0.7
    }
  };

  /* ------------------------------------------------------------------ *
   * Hole generation                                                     *
   * ------------------------------------------------------------------ */

  // Builds a hole with real golf anatomy: a tee box, a rough carry
  // gap, a continuous fairway ribbon (with doglegs and landing-zone
  // bulges), a distinct green around the cup, and hazards placed
  // where a course architect would put them — bunkers guarding the
  // green, trees lining the fairway and filling dogleg elbows, and
  // creeks cutting across the line of play.
  function buildHoleAttempt(rng, ease, theme, diff) {
    var cells = new Array(W * H).fill(ROUGH);
    var slope = new Array(W * H).fill(-1);
    // Hazard-count scaling for the difficulty tier (identity on standard).
    function dens(n) { return Math.round(n * diff.density); }

    // Tee and cup on opposite ends of the box. Half the holes run
    // straight down the grid; the rest run corner-to-corner on one of
    // the two diagonals, so a course isn't all top-to-bottom holes.
    // Every orientation spans the full 20-row height, which keeps the
    // tee→cup distance long enough to stay above the 3-stroke floor.
    var orient = ri(rng, 4);   // 0-1 vertical, 2 diagonal "\", 3 diagonal "/"
    var tee, cup;
    if (orient <= 1) {
      tee = { x: 3 + ri(rng, W - 6), y: 1 + ri(rng, 2) };
      cup = { x: 2 + ri(rng, W - 4), y: H - 2 - ri(rng, 2) };
    } else if (orient === 2) {                 // top-left → bottom-right
      tee = { x: 1 + ri(rng, 3), y: 1 + ri(rng, 2) };
      cup = { x: W - 2 - ri(rng, 3), y: H - 2 - ri(rng, 2) };
    } else {                                   // top-right → bottom-left
      tee = { x: W - 2 - ri(rng, 3), y: 1 + ri(rng, 2) };
      cup = { x: 1 + ri(rng, 3), y: H - 2 - ri(rng, 2) };
    }
    if (rng() < 0.5) { var tmp = tee; tee = cup; cup = tmp; }

    function nearPt(x, y, p, r) {
      return Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) <= r;
    }
    function paintDisc(px, py, r, type) {
      for (var ox = -r; ox <= r; ox++) {
        for (var oy = -r; oy <= r; oy++) {
          if (inBounds(px + ox, py + oy) && cells[idx(px + ox, py + oy)] === ROUGH) {
            cells[idx(px + ox, py + oy)] = type;
          }
        }
      }
    }

    // Centerline from tee to cup with 1-2 dogleg elbows. Interior
    // waypoints march along the tee→cup line (works for any
    // orientation) and jitter off it to form the doglegs.
    var waypoints = [[tee.x, tee.y]];
    var nWp = 1 + ri(rng, 2);
    for (var i = 1; i <= nWp; i++) {
      var f = i / (nWp + 1);
      var bx = tee.x + (cup.x - tee.x) * f;
      var by = tee.y + (cup.y - tee.y) * f;
      var wx = Math.max(2, Math.min(W - 3, Math.round(bx) + ri(rng, 5) - 2));
      var wy = Math.max(2, Math.min(H - 3, Math.round(by) + ri(rng, 5) - 2));
      waypoints.push([wx, wy]);
    }
    waypoints.push([cup.x, cup.y]);

    var centerline = [];
    for (i = 0; i < waypoints.length - 1; i++) {
      var seg = lineCells(waypoints[i][0], waypoints[i][1], waypoints[i + 1][0], waypoints[i + 1][1]);
      if (i > 0) seg.shift();
      centerline = centerline.concat(seg);
    }
    var corridor = {};
    for (i = 0; i < centerline.length; i++) {
      for (var ox = -1; ox <= 1; ox++) {
        for (var oy = -1; oy <= 1; oy++) {
          var cxx = centerline[i][0] + ox, cyy = centerline[i][1] + oy;
          if (inBounds(cxx, cyy)) corridor[idx(cxx, cyy)] = true;
        }
      }
    }

    function isRough(x, y) { return cells[idx(x, y)] === ROUGH; }
    function offCorridor(x, y) { return !corridor[idx(x, y)]; }
    function notEndpoint(x, y) {
      return !(x === tee.x && y === tee.y) && !(x === cup.x && y === cup.y);
    }

    // Fairway ribbon: starts after a short carry gap off the tee and
    // runs to the green approach. Never scaled by ease — the ribbon
    // is what makes it read as a golf hole.
    var L = centerline.length;
    var startK = Math.min(3 + ri(rng, 2), Math.max(1, L - 6));
    var endK = Math.max(startK, L - 4);
    for (var k = startK; k <= endK; k++) {
      paintDisc(centerline[k][0], centerline[k][1], 1, FAIRWAY);
    }
    // Landing-zone bulges widen the ribbon in a spot or two.
    var nBulge = 1 + ri(rng, 2);
    for (i = 0; i < nBulge && endK > startK; i++) {
      k = startK + ri(rng, endK - startK + 1);
      paintDisc(centerline[k][0], centerline[k][1], 2, FAIRWAY);
    }
    // Tee box pad.
    paintDisc(tee.x, tee.y, 1, FAIRWAY);

    // The green: its own terrain, kept compact around the cup.
    growBlob(rng, cells, [cup.x, cup.y], 6 + ri(rng, 5), GREEN, function (x, y) {
      var t = cells[idx(x, y)];
      return (t === ROUGH || t === FAIRWAY) && nearPt(x, y, cup, 2);
    });

    // Greenside bunkers, seeded on the green's fringe.
    var greenAdj = [];
    for (var yy = 0; yy < H; yy++) {
      for (var xx = 0; xx < W; xx++) {
        if (cells[idx(xx, yy)] === GREEN) continue;
        var t3 = cells[idx(xx, yy)];
        if (t3 !== ROUGH && t3 !== FAIRWAY) continue;
        for (var d8 = 0; d8 < 8; d8++) {
          var ax = xx + DIRS[d8][0], ay = yy + DIRS[d8][1];
          if (inBounds(ax, ay) && cells[idx(ax, ay)] === GREEN) {
            greenAdj.push([xx, yy]);
            break;
          }
        }
      }
    }
    var nGS = dens(rollN(rng, theme.greenSandN, 1));
    for (i = 0; i < nGS && greenAdj.length; i++) {
      growBlob(rng, cells, pick(rng, greenAdj), rollSize(rng, theme.sandSize, 1), SAND,
        function (x, y) {
          var t = cells[idx(x, y)];
          return (t === ROUGH || t === FAIRWAY) && notEndpoint(x, y) && !nearPt(x, y, tee, 2);
        });
    }

    // Fairway bunkers pinch the ribbon's edges.
    var nFB = dens(rollN(rng, theme.fwSandN, ease));
    for (i = 0; i < nFB && endK > startK; i++) {
      k = startK + ri(rng, endK - startK + 1);
      var side = rng() < 0.5 ? -1 : 1;
      growBlob(rng, cells, [centerline[k][0] + side * 2, centerline[k][1]],
        rollSize(rng, theme.sandSize, 1), SAND, function (x, y) {
          var t = cells[idx(x, y)];
          return (t === ROUGH || t === FAIRWAY) && offCorridor(x, y) &&
            notEndpoint(x, y) && !nearPt(x, y, tee, 2) && !nearPt(x, y, cup, 2);
        });
    }

    // Trees line the fairway, seeded just off the ribbon's shoulders.
    var treeAllowed = function (x, y) { return isRough(x, y) && offCorridor(x, y); };
    var nT = dens(rollN(rng, theme.treeN, ease));
    for (i = 0; i < nT && endK > startK; i++) {
      k = startK + ri(rng, endK - startK + 1);
      side = rng() < 0.5 ? -1 : 1;
      growBlob(rng, cells,
        [centerline[k][0] + side * (2 + ri(rng, 2)), centerline[k][1] + ri(rng, 3) - 1],
        rollSize(rng, theme.treeSize, ease), TREE, treeAllowed);
    }
    // A copse in each dogleg elbow punishes corner-cutting.
    for (i = 1; i < waypoints.length - 1; i++) {
      if (rng() < 0.7) {
        side = rng() < 0.5 ? -1 : 1;
        growBlob(rng, cells, [waypoints[i][0] + side * 2, waypoints[i][1]],
          Math.max(2, Math.round((3 + ri(rng, 4)) * ease)), TREE, treeAllowed);
      }
    }

    // Creek: a water band cutting across the line of play. You can
    // fly over water but never land in it, so this demands a carry.
    if (endK > startK + 5 && rng() < theme.creek * (0.5 + 0.5 * ease) * diff.density) {
      k = startK + 2 + ri(rng, endK - startK - 4);
      var cc = centerline[k];
      var half = 3 + ri(rng, 3);
      var rows = rng() < theme.creekWide + diff.wideWater ? 2 : 1;
      // On tiers with wideWater, a wide creek sometimes swells to three
      // rows — a carry that a mid roll can't clear.
      if (rows === 2 && diff.wideWater > 0 && rng() < 0.4) rows = 3;
      for (var rr = 0; rr < rows; rr++) {
        for (var t4 = -half; t4 <= half; t4++) {
          var wx = cc[0] + t4, wy = cc[1] + rr;
          if (!inBounds(wx, wy)) continue;
          var ct = cells[idx(wx, wy)];
          if (ct !== ROUGH && ct !== FAIRWAY) continue;
          if (nearPt(wx, wy, tee, 2) || nearPt(wx, wy, cup, 2)) continue;
          cells[idx(wx, wy)] = WATER;
        }
      }
    }
    // Ponds flank the hole, off the playing corridor.
    var nP = dens(rollN(rng, theme.pondN, ease));
    for (i = 0; i < nP; i++) {
      placeBlob(rng, cells, rollSize(rng, theme.pondSize, ease), WATER, function (x, y) {
        return isRough(x, y) && offCorridor(x, y) &&
          !nearPt(x, y, tee, 2) && !nearPt(x, y, cup, 2);
      });
    }

    // Greenside moat (tough tiers): a water band across the approach,
    // closer to the cup than a creek is ever allowed, so reaching the
    // green demands a genuine carry.
    if (diff.moat > 0 && L > 6 && rng() < diff.moat * ease) {
      var mc = centerline[L - 4];
      var mHalf = 2 + ri(rng, 3);
      for (var mt = -mHalf; mt <= mHalf; mt++) {
        var mx = mc[0] + mt, my = mc[1];
        if (!inBounds(mx, my)) continue;
        var mct = cells[idx(mx, my)];
        if (mct !== ROUGH && mct !== FAIRWAY) continue;
        if (nearPt(mx, my, tee, 2) || nearPt(mx, my, cup, 1)) continue;
        cells[idx(mx, my)] = WATER;
      }
    }

    // Island green (tough tiers, rare): ring the green's fringe with
    // water — the green must be hit exactly, no lay-up-and-putt. Any
    // greenside bunker already placed stays as a lucky bail-out.
    if (diff.island > 0 && rng() < diff.island * ease) {
      for (var gy = 0; gy < H; gy++) {
        for (var gx = 0; gx < W; gx++) {
          var gt = cells[idx(gx, gy)];
          if (gt !== ROUGH && gt !== FAIRWAY) continue;
          if (nearPt(gx, gy, tee, 2)) continue;
          for (var gd = 0; gd < 8; gd++) {
            var ex = gx + DIRS[gd][0], ey = gy + DIRS[gd][1];
            if (inBounds(ex, ey) && cells[idx(ex, ey)] === GREEN) {
              cells[idx(gx, gy)] = WATER;
              break;
            }
          }
        }
      }
    }

    // Slopes: short runs of arrows laid perpendicular to their
    // pointing direction, like a bank the ball rolls down.
    if (rng() < theme.slopeChance) {
      var nRuns = theme.slopeRuns[0] + ri(rng, theme.slopeRuns[1] - theme.slopeRuns[0] + 1);
      for (var run = 0; run < nRuns; run++) {
        var sd = ri(rng, 4);
        var sx = 1 + ri(rng, W - 2), sy = 2 + ri(rng, H - 4);
        var len = 2 + ri(rng, 3);
        for (i = 0; i < len; i++) {
          if (!inBounds(sx, sy)) break;
          var kk = idx(sx, sy);
          var t2 = cells[kk];
          if ((t2 === ROUGH || t2 === FAIRWAY) && notEndpoint(sx, sy)) slope[kk] = sd;
          sx += DIRS[sd][1]; sy += DIRS[sd][0];
        }
      }
    }

    // Endpoints must be clean, restful spots.
    cells[idx(tee.x, tee.y)] = FAIRWAY;
    cells[idx(cup.x, cup.y)] = GREEN;
    slope[idx(tee.x, tee.y)] = -1;
    slope[idx(cup.x, cup.y)] = -1;

    return { w: W, h: H, cells: cells, slope: slope, tee: tee, hole: cup, wonder: null, wind: -1, windStr: 0 };
  }

  function generateHole(rng, theme, diff) {
    theme = theme || THEMES.classic;
    diff = diff || DIFFICULTIES.standard;
    for (var attempt = 0; attempt < 300; attempt++) {
      // Back off obstacle density if we keep failing, so generation
      // always terminates with a playable hole.
      var ease = attempt < 60 ? 1 : Math.max(0.15, 1 - (attempt - 60) / 120);
      // The difficulty's stroke floor also relaxes late: better a
      // slightly-too-easy hole than generation that never terminates.
      var minBest = attempt < 150 ? diff.minBest : 3;
      var maxBest = attempt < 150 ? diff.maxBest : 6;
      var hole = buildHoleAttempt(rng, ease, theme, diff);
      var best = solve(hole);
      if (best !== null && best >= minBest && best <= maxBest) {
        hole.best = best;
        return hole;
      }
    }
    // Practically unreachable: an empty hole is always solvable.
    var fallback = buildHoleAttempt(rng, 0, theme, diff);
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

  function generateCourse(seedStr, numHoles, themeKey, diffKey) {
    numHoles = numHoles || 18;
    var theme = THEMES[themeKey] || THEMES.classic;
    themeKey = THEMES[themeKey] ? themeKey : 'classic';
    var diff = DIFFICULTIES[diffKey] || DIFFICULTIES.standard;
    diffKey = DIFFICULTIES[diffKey] ? diffKey : 'standard';
    // Theme — and any non-standard difficulty — are part of the seed
    // so the same seed string gives a different (but reproducible)
    // course per combination. Standard adds nothing, so share links
    // that predate difficulty tiers keep producing identical courses.
    var seedName = themeKey + (diffKey === 'standard' ? '' : '|' + diffKey);
    var seedFn = xmur3(seedName + '|' + String(seedStr));
    var rng = mulberry32(seedFn());

    // Themed courses draw their middle name from the theme's pool.
    var nounPool = theme.nouns
      ? (rng() < 0.8 ? theme.nouns : NAME_B)
      : NAME_B;
    var name = pick(rng, NAME_A) + ' ' + pick(rng, nounPool) + ' ' + pick(rng, NAME_C);

    var holes = [];
    for (var i = 0; i < numHoles; i++) {
      var h = generateHole(rng, theme, diff);
      h.trees = theme.trees; // biome's tree species, for rendering
      holes.push(h);
    }

    // Wind comes from its own RNG stream so hole layouts (drawn from
    // the main stream) are untouched by this feature. A windy hole
    // keeps its wind only if the wind-aware solver still fits the
    // difficulty's stroke gate; otherwise it stays calm.
    var windRng = mulberry32(xmur3('wind|' + seedName + '|' + String(seedStr))());
    holes.forEach(function (h) {
      var windy = windRng() < diff.wind;
      var dir = ri(windRng, 8);                    // always drawn —
      var gale = windRng() < 0.3;                  // keeps the stream aligned
      if (!windy) return;
      // Try the drawn strength and direction first, then rotate through
      // the other directions, then downgrade a gale to a breeze — some
      // combination usually keeps the stroke gate intact.
      var strengths = gale ? [2, 1] : [1];
      for (var si = 0; si < strengths.length; si++) {
        h.windStr = strengths[si];
        for (var t = 0; t < 8; t++) {
          h.wind = (dir + t) % 8;
          var windBest = solve(h);
          if (windBest !== null && windBest >= diff.minBest && windBest <= diff.maxBest) {
            h.best = windBest;
            return;
          }
        }
      }
      h.wind = -1;    // nothing fits: the hole stays calm
      h.windStr = 0;
    });

    // Maybe hide a wonder on one hole (free mulligan when spotted).
    var wonderKey = rollWonder(rng, themeKey);
    if (wonderKey) {
      var habitat = WONDERS[wonderKey].habitat;
      // Only holes that actually have the wonder's habitat qualify
      // (a kraken needs water to lurk in).
      var lairs = holes.filter(function (h) { return h.cells.indexOf(habitat) >= 0; });
      if (lairs.length) {
        var hb = pick(rng, lairs);
        for (var tries = 0; tries < 100; tries++) {
          var bx = 1 + ri(rng, W - 2), by = 1 + ri(rng, H - 2);
          var far = Math.max(Math.abs(bx - hb.tee.x), Math.abs(by - hb.tee.y)) > 3 &&
                    Math.max(Math.abs(bx - hb.hole.x), Math.abs(by - hb.hole.y)) > 3;
          if (hb.cells[idx(bx, by)] === habitat && hb.slope[idx(bx, by)] < 0 && far) {
            hb.wonder = { key: wonderKey, x: bx, y: by };
            break;
          }
        }
      }
    }

    // Star rating (1-3) from measured stats: how far optimal play sits
    // above 3 strokes, and how much hazard the course actually carries.
    var sumBest = 0, hazard = 0;
    holes.forEach(function (h) {
      sumBest += h.best;
      h.cells.forEach(function (c) {
        if (c === WATER || c === TREE) hazard++;
        else if (c === SAND) hazard += 0.5;
      });
    });
    var avgBest = sumBest / holes.length;
    var hazardPerHole = hazard / holes.length;
    var rating = 1;
    if (avgBest > 3.15 || hazardPerHole > 30) rating = 2;
    if (avgBest > 3.7) rating = 3;

    return {
      name: name, seed: String(seedStr), theme: themeKey,
      themeLabel: theme.label, holes: holes, par: numHoles * 6,
      difficulty: diffKey, difficultyLabel: diff.label,
      mulligans: diff.mulligans, rating: rating, treeStyle: theme.trees
    };
  }

  /* ------------------------------------------------------------------ *
   * Sheet composition — several holes on one continuous grid            *
   * ------------------------------------------------------------------ */

  // Lay `holes` onto one shared grid in a cols×rows arrangement for a
  // continuous printed sheet. Placement is translate-only (no rotation)
  // into disjoint slots separated by a `gap` of rough, so each hole's
  // cells are copied verbatim: solvability is preserved exactly and no
  // hole's playable cells ever touch a neighbour's. Returns the big
  // grid plus, per hole, where its tee / cup / wonder landed.
  function composeSheet(holes, cols, rows, gap) {
    gap = gap == null ? 1 : gap;
    var gw = cols * W + (cols - 1) * gap;
    var gh = rows * H + (rows - 1) * gap;
    var cells = new Array(gw * gh).fill(ROUGH);
    var slope = new Array(gw * gh).fill(-1);
    var placements = [];
    for (var n = 0; n < holes.length && n < cols * rows; n++) {
      var h = holes[n];
      var ox = (n % cols) * (W + gap);
      var oy = Math.floor(n / cols) * (H + gap);
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          var gk = (oy + y) * gw + (ox + x);
          cells[gk] = h.cells[y * W + x];
          slope[gk] = h.slope[y * W + x];
        }
      }
      placements.push({
        hole: h, num: n + 1, ox: ox, oy: oy,
        tee: { x: ox + h.tee.x, y: oy + h.tee.y },
        cup: { x: ox + h.hole.x, y: oy + h.hole.y },
        wind: h.wind, windStr: h.windStr,
        wonder: h.wonder ? { key: h.wonder.key, x: ox + h.wonder.x, y: oy + h.wonder.y } : null
      });
    }
    return { w: gw, h: gh, cells: cells, slope: slope, placements: placements };
  }

  var api = {
    W: W, H: H,
    ROUGH: ROUGH, FAIRWAY: FAIRWAY, SAND: SAND, WATER: WATER, TREE: TREE, GREEN: GREEN,
    DIRS: DIRS,
    THEMES: THEMES,
    WONDERS: WONDERS,
    DIFFICULTIES: DIFFICULTIES,
    generateCourse: generateCourse,
    generateHole: generateHole,
    composeSheet: composeSheet,
    solve: solve,
    resolveSlope: resolveSlope,
    resolveLanding: resolveLanding,
    windPoint: windPoint,
    shotTargets: shotTargets,
    movesForRoll: movesForRoll,
    mulberry32: mulberry32,
    xmur3: xmur3
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.PaperGolf = api;
})(typeof window !== 'undefined' ? window : this);
