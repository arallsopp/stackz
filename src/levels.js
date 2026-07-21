// Level definitions.
//
// Each block spec:
//   { shape: 'box', pos:[x,y,z], size:[w,h,d], rot?:[x,y,z] euler radians, color,
//     friction?, restitution?, density? }
//   { shape: 'cyl', pos:[x,y,z], radius, height, axis:'x'|'y'|'z', color, ... }
//
// The table top sits at y = 0. Blocks are authored resting ON the table (y > 0)
// with exact stacking contacts so they load perfectly stable. The table footprint
// is computed from the base layer (see computeBounds in game.js) so it is never
// bigger than the base of the tower. Levels favour structures that topple OFF the
// table (win = every block cleared over an edge), so keep footprints tight and use
// low `friction` on pieces that should slide clear.
//
// BLOCK BUDGET: keep each level under ~28 dynamic blocks. Rapier's WASM solver +
// mobile Safari get expensive past that, AND every block must be cleared within a
// tight ball budget — a huge pile is unwinnable, not just slow. `buildLevels`
// warns in dev if a level exceeds the cap.

const MAX_BLOCKS = 28;

const NEON = {
  cyan: 0x12f7ff,
  magenta: 0xff2bd6,
  violet: 0x8a5bff,
  yellow: 0xffe45e,
  green: 0x4bffa5,
  orange: 0xff8a3d,
};
const PALETTE = Object.values(NEON);

let _ci = 0;
const nextColor = () => PALETTE[_ci++ % PALETTE.length];
const reset = () => (_ci = 0);

const GAP = 0.004; // hair gap avoids initial interpenetration -> rock-solid load

// A single vertical column of boxes.
function column(n, { cx = 0, cz = 0, bw = 1, bh = 0.8, bd = 1 } = {}) {
  const blocks = [];
  for (let i = 0; i < n; i++) {
    blocks.push({
      shape: 'box',
      pos: [cx, bh / 2 + i * (bh + GAP), cz],
      size: [bw, bh, bd],
      color: nextColor(),
    });
  }
  return blocks;
}

// A Jenga tower: `layers` layers of 3 bars, orientation alternating 90°.
// Inherently stable at load, spectacular when it topples.
//
// `pull` = list of layer indices whose CENTRE bar is slid out along its length
// (a half-pulled Jenga piece). The end pokes out past the stack as a hittable
// "critical block": knock it clear and that layer loses its middle support, so
// a good hit can leverage the whole tower apart. The two outer bars still bridge
// the gap, so the stack loads rock-solid. `friction` tunes how readily toppled
// bars slide off the table.
function jenga(layers, { cx = 0, cz = 0, barLen = 3, barW = 0.96, barH = 0.6, pull = [], friction } = {}) {
  const blocks = [];
  const step = barW + GAP;
  const pullOut = barLen * 0.42; // how far the critical piece protrudes
  for (let l = 0; l < layers; l++) {
    const y = barH / 2 + l * (barH + GAP);
    const pi = pull.indexOf(l);
    for (let k = -1; k <= 1; k++) {
      const nudge = k === 0 && pi >= 0 ? pullOut * (pi % 2 === 0 ? 1 : -1) : 0;
      if (l % 2 === 0) {
        blocks.push({ shape: 'box', pos: [cx + nudge, y, cz + k * step], size: [barLen, barH, barW], color: nextColor(), friction });
      } else {
        blocks.push({ shape: 'box', pos: [cx + k * step, y, cz + nudge], size: [barW, barH, barLen], color: nextColor(), friction });
      }
    }
  }
  return blocks;
}

// A tapering spire: boxes shrink as they rise, capped with a small cube.
function spire(n, { cx = 0, cz = 0, base = 1.9, top = 0.8, bh = 0.6 } = {}) {
  const blocks = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const w = base + (top - base) * t;
    blocks.push({ shape: 'box', pos: [cx, bh / 2 + i * (bh + GAP), cz], size: [w, bh, w], color: nextColor() });
  }
  return blocks;
}

// A staggered brick wall (running bond). Alternate rows are offset half a brick
// and one brick shorter, so joints don't line up -> loads rock-solid, topples as
// a slab. `cols` = bricks on the even rows, `rows` = courses high.
function wall(cols, rows, { cx = 0, cz = 0, bw = 0.92, bh = 0.5, bd = 0.6, friction } = {}) {
  const blocks = [];
  const step = bw + GAP;
  for (let r = 0; r < rows; r++) {
    const y = bh / 2 + r * (bh + GAP);
    const odd = r % 2 === 1;
    const n = odd ? cols - 1 : cols;
    const rowW = n * step;
    for (let c = 0; c < n; c++) {
      const x = cx - rowW / 2 + step / 2 + c * step;
      blocks.push({ shape: 'box', pos: [x, y, cz], size: [bw, bh, bd], color: nextColor(), friction });
    }
  }
  return blocks;
}

// A row of tall, thin slabs — dominoes. Knock the first and the chain topples,
// each falling slab shoving the next ("tall items that fall over and push
// others"). `t` (thin) is along +x, the travel direction; `spacing` must sit
// between `t` and the slab height so a falling slab reaches its neighbour. Low
// `friction` lets the felled pile slide off a tight table. `curve` bends the run
// into an arc so the cascade sweeps toward a table edge.
function dominoes(n, { cx = 0, cz = 0, spacing = 0.62, w = 1.0, h = 1.7, t = 0.24, curve = 0, friction = 0.34 } = {}) {
  const blocks = [];
  for (let i = 0; i < n; i++) {
    blocks.push({
      shape: 'box',
      pos: [cx + i * spacing, h / 2, cz + curve * i * i],
      size: [t, h, w],
      color: nextColor(),
      friction,
    });
  }
  return blocks;
}

// A cluster of upright "pins" (skittles) to be bowled over — thin uprights the
// roller / debris scatters. Laid out in a triangular rack pointing uphill (-x).
function pins(rows, { cx = 0, cz = 0, spacing = 0.8, r = 0.32, h = 1.4, friction = 0.4 } = {}) {
  const blocks = [];
  for (let row = 0; row < rows; row++) {
    const count = row + 1;
    const x = cx + row * spacing * 0.9;
    for (let i = 0; i < count; i++) {
      const z = cz + (i - (count - 1) / 2) * spacing;
      blocks.push({ shape: 'cyl', axis: 'y', pos: [x, h / 2, z], radius: r, height: h, color: nextColor(), friction });
    }
  }
  return blocks;
}

// A ramp: an elevated flat shelf (the high ground) with a plank sloping down off
// its downhill (+x) edge to the table, and an optional cylinder resting on the
// shelf top. The roller sits on the FLAT shelf so it loads stable; a knock sends
// it over the edge, onto the plank and rolling downhill to smash whatever waits
// at the bottom. Two-point support (shelf edge + table) holds the plank solid.
// `dir` is the downhill direction along x (+1 = slopes down toward +x, -1 toward
// -x), so two ramps can face each other without the buggy mirror-a-built-ramp
// dance. The roller parks on the flat shelf, uphill of the ramp edge.
function ramp({ cx = 0, cz = 0, rise = 2.0, run = 3.2, width = 2.2, thick = 0.4, shelfW = 1.7, dir = 1, roller = true, rollerR = 0.55 } = {}) {
  const blocks = [];
  // Elevated shelf; flat top at y = rise.
  blocks.push({ shape: 'box', pos: [cx, rise / 2, cz], size: [shelfW, rise, width], color: nextColor() });
  // Down-ramp from the shelf's downhill edge to the table.
  const edgeX = cx + dir * (shelfW / 2);
  const theta = Math.atan2(rise, run);
  const len = Math.hypot(run, rise) + 0.3;
  blocks.push({
    shape: 'box',
    // Lift the plank so its underside rests ON the shelf top + table (not through them).
    pos: [edgeX + dir * (run / 2), rise / 2 + (thick / 2) * Math.cos(theta), cz],
    size: [len, thick, width],
    rot: [0, 0, -dir * theta],
    color: nextColor(),
    friction: 0.5,
  });
  // Roller parked on the flat shelf top, held by a low chock at the downhill lip.
  // A cylinder can't rest stably on a slope and drifts off a bare flat shelf as
  // the platform settles; the chock stops that idle creep, yet a solid hit rolls
  // the boulder straight over it and down the ramp.
  if (roller) {
    const chockH = 0.22;
    const chockX = edgeX - dir * 0.12; // just inside the shelf's downhill edge
    blocks.push({ shape: 'box', pos: [chockX, rise + chockH / 2, cz], size: [0.2, chockH, width * 0.9], color: nextColor(), friction: 0.6 });
    blocks.push({
      shape: 'cyl',
      axis: 'z',
      pos: [chockX - dir * (rollerR + 0.12), rise + rollerR + GAP, cz],
      radius: rollerR,
      height: width * 0.85,
      color: nextColor(),
    });
  }
  return blocks;
}

// A swing-frame KICKER. A Π-shaped frame (two vertical posts joined by a top bar,
// all fixed grey mechanism) with a heavy "boot" arm hinged at the top-bar centre
// (axis Z). The boot is authored HORIZONTAL, pointing -x, propped up by a coloured
// PIN bar (a playable target). Shoot the pin out and the boot swings down through
// the frame, reaching the bottom at full speed to kick blocks off the +x edge.
// Returns the frame + boot + pin; author the target blocks separately.
// `barY` = hinge / top-bar height, `arm` = boot length, `postX` = post spread.
// Side-on Π swing-frame so the whole swing arc + pin face the camera. The two
// posts sit front/back (in Z) joined by a top bar; the boot hinges at the top-bar
// centre (axis Z) and swings in the X-Y plane. It's authored HORIZONTAL pointing
// -x, propped by a coloured PIN in the swing plane (hittable). Shoot the pin and
// the boot swings down through the bottom and kicks the blocks off the +x edge
// (clear — no post lives in X). `fixed` frame parts ride the turntable.
function swingKicker({ barY = 3.0, arm = 2.5, postZ = 1.0, bootW = 0.9, pinColor = NEON.yellow } = {}) {
  const pinTop = barY - 0.2; // just under the boot's far end
  return [
    // Π frame (grey mechanism, fixed): posts front/back in Z, top bar spanning Z.
    { shape: 'box', fixed: true, mechanism: true, pos: [0, barY / 2, -postZ], size: [0.4, barY, 0.3] },
    { shape: 'box', fixed: true, mechanism: true, pos: [0, barY / 2, postZ], size: [0.4, barY, 0.3] },
    { shape: 'box', fixed: true, mechanism: true, pos: [0, barY + 0.15, 0], size: [0.4, 0.3, postZ * 2 + 0.3] },
    // Boot: hinged at the top-bar centre (axis Z), horizontal, pointing -x.
    {
      shape: 'box',
      mechanism: true,
      pos: [-arm / 2, barY, 0],
      size: [arm, 0.3, bootW],
      rot: [0, 0, Math.PI],
      density: 8, // heavy boot -> a solid kick
      hinge: { anchor: [0, barY, 0], axis: [0, 0, 1] },
    },
    // Pin: a coloured (playable) bar in the swing plane, propping the boot's far end.
    { shape: 'box', pos: [-arm, pinTop / 2, 0], size: [0.35, pinTop, bootW * 0.85], color: pinColor },
  ];
}

function buildLevels() {
  const levels = [];

  // L1 (TEMP) — KICKER. Prototype up front for testing: a Π swing-frame with a
  // boot held horizontal by a coloured pin. Shoot the pin and the boot swings down
  // through the frame and kicks the neon blocks off the far edge.
  reset();
  levels.push({
    name: 'KICKER',
    par: 3,
    airstrikes: 1,
    spin: 0.12, // rides the turntable (frame + boot + pin + targets spin together)
    blocks: [
      ...swingKicker({ barY: 3.0, arm: 2.5, postZ: 1.0, bootW: 0.9, pinColor: NEON.yellow }),
      // Targets at the bottom of the swing, kicked off the +x edge (clear path).
      { shape: 'box', pos: [0.5, 0.5, 0], size: [0.85, 1.0, 0.85], color: NEON.magenta, density: 0.4 },
      { shape: 'box', pos: [1.4, 0.5, 0], size: [0.85, 1.0, 0.85], color: NEON.cyan, density: 0.4 },
    ],
  });

  // LIFT OFF. A lone tall column. One good hit topples it.
  reset();
  levels.push({
    name: 'LIFT OFF',
    par: 2,
    airstrikes: 0,
    blocks: column(6, { bw: 1.1, bh: 0.85, bd: 1.1 }),
  });

  // L2 — TWIN SPIRES. Two tall columns; knock both down.
  reset();
  levels.push({
    name: 'TWIN SPIRES',
    par: 3,
    airstrikes: 1,
    spin: 0.25,
    blocks: [
      ...column(6, { cx: -1.0, bw: 0.95, bh: 0.8, bd: 0.95 }),
      ...column(6, { cx: 1.0, bw: 0.95, bh: 0.8, bd: 0.95 }),
    ],
  });

  // L3 — JENGA. Rebalanced to be genuinely fragile for a par 3. A full jenga
  // collapses into a pile that stays ON the table (why the old 7-layer version was
  // near-impossible to fully clear): so this one is short (3 layers = 9 bars), on a
  // tight footprint, with EVERY middle bar half-pulled and slippery (low friction)
  // — a clean hit topples it and the bars slide off the edges.
  reset();
  levels.push({
    name: 'JENGA',
    par: 3,
    airstrikes: 1,
    spin: 0.12, // gentle turntable (every level spins)
    blocks: jenga(3, { barLen: 2.1, barW: 0.8, barH: 0.52, pull: [0, 1, 2], friction: 0.26 }),
  });

  // L4 — DRUM TOWER. Plates and upright drums; a side-log crown that rolls.
  reset();
  levels.push({
    name: 'DRUM TOWER',
    par: 4,
    airstrikes: 1,
    spin: 0.3,
    blocks: [
      { shape: 'box', pos: [0, 0.25, 0], size: [2.2, 0.5, 2.2], color: NEON.violet },
      { shape: 'cyl', pos: [0, 0.5 + GAP + 0.7, 0], radius: 0.85, height: 1.4, axis: 'y', color: NEON.cyan },
      { shape: 'box', pos: [0, 1.9 + 0.2, 0], size: [2.0, 0.4, 2.0], color: NEON.magenta },
      { shape: 'cyl', pos: [0, 2.5 + 0.7, 0], radius: 0.8, height: 1.4, axis: 'y', color: NEON.yellow },
      { shape: 'box', pos: [0, 3.9 + 0.2, 0], size: [1.9, 0.4, 1.9], color: NEON.green },
      { shape: 'cyl', pos: [0, 4.3 + 0.5, 0], radius: 0.5, height: 2.4, axis: 'x', color: NEON.orange },
    ],
  });

  // L5 — DOMINO RUN. A compact line of dominoes: tip the near one and the chain
  // shoves the whole run off the tight table. First taste of the topple-chain.
  reset();
  levels.push({
    name: 'DOMINO RUN',
    par: 3,
    airstrikes: 1,
    spin: 0.1,
    blocks: dominoes(6, { cx: -1.5, spacing: 0.6, w: 1.4, h: 1.8, t: 0.24 }),
  });

  // L6 — ZIGGURAT. A tall tapering spire behind a counter-rotating shield.
  reset();
  levels.push({
    name: 'ZIGGURAT',
    par: 5,
    airstrikes: 2,
    shield: { arms: 3, speed: -0.12 },
    blocks: spire(8, { base: 2.0, top: 0.7, bh: 0.62 }),
  });

  // L7 — BOWLING. A cylinder parked on a ramp; knock it downhill to bowl through
  // a triangular rack of pins at the bottom.
  reset();
  levels.push({
    name: 'BOWLING',
    par: 4,
    airstrikes: 1,
    spin: 0.08,
    blocks: [
      ...ramp({ cx: -1.9, rise: 2.0, run: 2.6, width: 2.4, rollerR: 0.6 }),
      // Rack sits downhill of where the plank meets the table, clear of it.
      ...pins(3, { cx: 2.1, spacing: 0.72, r: 0.3, h: 1.4 }),
    ],
  });

  // L8 — THE TERRACE. The plinth idea, extended with a slope: a raised shelf with
  // a ramp, a small tower perched on the high ground to be tipped down the slope.
  reset();
  levels.push({
    name: 'THE TERRACE',
    par: 4,
    airstrikes: 1,
    spin: 0.12,
    blocks: [
      ...ramp({ cx: -1.6, rise: 1.8, run: 2.8, width: 2.6, roller: false }),
      ...column(3, { cx: -1.6, bw: 1.0, bh: 0.7, bd: 1.6 }).map((b) => ({ ...b, pos: [b.pos[0], b.pos[1] + 1.8, b.pos[2]] })),
    ],
  });

  // L9 — THE WALL. A staggered brick wall. Punch a hole low and it slumps.
  reset();
  levels.push({
    name: 'THE WALL',
    par: 4,
    airstrikes: 1,
    spin: 0.14,
    blocks: wall(5, 4, { bw: 0.94, bh: 0.5, bd: 0.7, friction: 0.5 }),
  });

  // L10 — THE CITADEL. Four tall corner spires bound by a bridge and a crown.
  reset();
  levels.push({
    name: 'THE CITADEL',
    par: 6,
    airstrikes: 2,
    spin: 0.12,
    shield: { arms: 4, speed: -0.1 },
    blocks: [
      ...column(5, { cx: -1.2, cz: -1.2, bw: 0.9, bh: 0.8, bd: 0.9 }),
      ...column(5, { cx: 1.2, cz: -1.2, bw: 0.9, bh: 0.8, bd: 0.9 }),
      ...column(5, { cx: -1.2, cz: 1.2, bw: 0.9, bh: 0.8, bd: 0.9 }),
      ...column(5, { cx: 1.2, cz: 1.2, bw: 0.9, bh: 0.8, bd: 0.9 }),
      { shape: 'box', pos: [0, 4.2, -1.2], size: [3.3, 0.35, 0.9], color: NEON.cyan },
      { shape: 'box', pos: [0, 4.2, 1.2], size: [3.3, 0.35, 0.9], color: NEON.magenta },
      // A beam crown (was a free drum that just rolled off the roof on its own).
      { shape: 'box', pos: [0, 4.725, 0], size: [1.3, 0.7, 2.8], color: NEON.yellow },
      { shape: 'box', pos: [0, 5.525, 0], size: [1.3, 0.9, 1.3], color: NEON.violet },
    ],
  });

  // L11 — TOTEM. An alternating cube/drum stack — top-heavy and wobbly on a
  // spinning table, primed to keel over.
  reset();
  levels.push({
    name: 'TOTEM',
    par: 4,
    airstrikes: 1,
    spin: 0.3,
    blocks: [
      { shape: 'box', pos: [0, 0.45, 0], size: [1.7, 0.9, 1.7], color: NEON.violet },
      { shape: 'cyl', pos: [0, 0.9 + GAP + 0.6, 0], radius: 0.72, height: 1.2, axis: 'y', color: NEON.cyan },
      { shape: 'box', pos: [0, 2.1 + 0.5, 0], size: [1.5, 1.0, 1.5], color: NEON.magenta },
      { shape: 'cyl', pos: [0, 3.1 + GAP + 0.55, 0], radius: 0.66, height: 1.1, axis: 'y', color: NEON.yellow },
      { shape: 'box', pos: [0, 4.2 + 0.55, 0], size: [1.3, 1.1, 1.3], color: NEON.green },
      { shape: 'cyl', pos: [0, 5.3 + 0.45, 0], radius: 0.42, height: 1.9, axis: 'x', color: NEON.orange },
    ],
  });

  // L12 — DOMINO CASCADE. A longer, curving domino run that sweeps round into a
  // small spire — knock the chain to fell the tower it runs into.
  reset();
  levels.push({
    name: 'DOMINO CASCADE',
    par: 5,
    airstrikes: 2,
    spin: 0.1,
    blocks: [
      ...dominoes(7, { cx: -2.2, cz: -1.4, spacing: 0.6, w: 1.1, h: 1.7, t: 0.24, curve: 0.06 }),
      ...spire(4, { cx: 2.0, cz: 0.6, base: 1.4, top: 0.6, bh: 0.6 }),
    ],
  });

  // L13 — THE SPILLWAY. A boulder poised above a domino run: bowl it down the ramp
  // and it barrels through the whole chain (roller feeding dominoes — two
  // mechanisms in one).
  reset();
  levels.push({
    name: 'THE SPILLWAY',
    par: 4,
    airstrikes: 2,
    spin: 0.08,
    blocks: [
      ...ramp({ cx: -2.0, rise: 2.2, run: 2.2, width: 2.2, shelfW: 2.0, rollerR: 0.6 }),
      // Chain starts downhill of where the plank meets the table.
      ...dominoes(4, { cx: 1.7, spacing: 0.6, w: 1.6, h: 1.7, t: 0.24 }),
    ],
  });

  // L14 — THE GATE. Two towers spanned by a heavy lintel, with drums perched on
  // top. Drop a leg and the whole gateway comes down.
  reset();
  levels.push({
    name: 'THE GATE',
    par: 5,
    airstrikes: 2,
    spin: 0.12,
    blocks: [
      ...column(5, { cx: -1.5, bw: 0.9, bh: 0.7, bd: 1.2 }),
      ...column(5, { cx: 1.5, bw: 0.9, bh: 0.7, bd: 1.2 }),
      { shape: 'box', pos: [0, 3.5 + 0.3, 0], size: [4.0, 0.6, 1.3], color: NEON.violet, density: 2 },
      { shape: 'cyl', pos: [-0.9, 4.4 + 0.5, 0], radius: 0.5, height: 1.1, axis: 'z', color: NEON.yellow },
      { shape: 'cyl', pos: [0.9, 4.4 + 0.5, 0], radius: 0.5, height: 1.1, axis: 'z', color: NEON.green },
    ],
  });

  // L15 — AVALANCHE. A big boulder on a tall, steep ramp above a deep rack of
  // pins. Send it and it flattens the lot. (One heavy roller reads better than a
  // pyramid of logs, which just spread and roll off a flat shelf.)
  reset();
  levels.push({
    name: 'AVALANCHE',
    par: 5,
    airstrikes: 2,
    spin: 0.08,
    blocks: [
      ...ramp({ cx: -1.9, rise: 2.4, run: 2.6, width: 2.6, shelfW: 2.4, rollerR: 0.62 }),
      // Deep rack, set clear of the plank foot so the boulder does the demolition.
      ...pins(4, { cx: 2.4, spacing: 0.62, r: 0.28, h: 1.5 }),
    ],
  });

  // L16 — SPINNER. A spire crowned with a rolling drum, on a brisk turntable
  // behind a shield. Timing the shield gaps matters now.
  reset();
  levels.push({
    name: 'SPINNER',
    par: 5,
    airstrikes: 2,
    spin: 0.2,
    shield: { arms: 3, speed: -0.16 },
    blocks: [
      ...spire(6, { base: 1.9, top: 0.9, bh: 0.62 }),
      { shape: 'cyl', pos: [0, 6 * 0.624 + 0.5, 0], radius: 0.45, height: 2.0, axis: 'x', color: NEON.orange },
    ],
  });

  // L17 — THE KEEP. A fortified citadel: four towers, cross-bridges, a shielded,
  // spinning bailey and a heavy keep on top.
  reset();
  levels.push({
    name: 'THE KEEP',
    par: 6,
    airstrikes: 2,
    spin: 0.18,
    shield: { arms: 4, speed: -0.1 },
    blocks: [
      ...column(4, { cx: -1.4, cz: -1.4, bw: 0.85, bh: 0.8, bd: 0.85 }),
      ...column(4, { cx: 1.4, cz: -1.4, bw: 0.85, bh: 0.8, bd: 0.85 }),
      ...column(4, { cx: -1.4, cz: 1.4, bw: 0.85, bh: 0.8, bd: 0.85 }),
      ...column(4, { cx: 1.4, cz: 1.4, bw: 0.85, bh: 0.8, bd: 0.85 }),
      { shape: 'box', pos: [0, 3.4, -1.4], size: [3.6, 0.35, 0.8], color: NEON.cyan },
      { shape: 'box', pos: [0, 3.4, 1.4], size: [3.6, 0.35, 0.8], color: NEON.magenta },
      { shape: 'box', pos: [0, 4.0, 0], size: [2.0, 0.9, 2.0], color: NEON.violet },
    ],
  });

  // L18 — HANGING GARDENS. Two stepped terraces (sloped shelves), each carrying a
  // little tower to be tipped off its ledge.
  reset();
  levels.push({
    name: 'HANGING GARDENS',
    par: 6,
    airstrikes: 2,
    spin: 0.12,
    blocks: [
      // Two short inward terraces (their planks stop short of centre so they don't
      // collide), each carrying a little tower on the high ground.
      ...ramp({ cx: -2.6, dir: 1, rise: 1.6, run: 1.3, width: 2.6, roller: false }),
      ...column(3, { cx: -2.6, bw: 0.9, bh: 0.6, bd: 1.5 }).map((b) => ({ ...b, pos: [b.pos[0], b.pos[1] + 1.6, b.pos[2]] })),
      ...ramp({ cx: 2.6, dir: -1, rise: 1.6, run: 1.3, width: 2.6, roller: false }),
      ...column(3, { cx: 2.6, bw: 0.9, bh: 0.6, bd: 1.5 }).map((b) => ({ ...b, pos: [b.pos[0], b.pos[1] + 1.6, b.pos[2]] })),
    ],
  });

  // L19 — THE COLOSSEUM. A square ring of walls guarding a central spire, spinning
  // behind a shield. Breach the ring, then topple the core.
  reset();
  levels.push({
    name: 'THE COLOSSEUM',
    par: 7,
    airstrikes: 2,
    spin: 0.16,
    shield: { arms: 4, speed: -0.1 },
    blocks: [
      ...wall(3, 2, { cz: -2.1, bw: 0.9, bh: 0.55, bd: 0.6 }),
      ...wall(3, 2, { cz: 2.1, bw: 0.9, bh: 0.55, bd: 0.6 }),
      ...wall(3, 2, { cz: 0, bw: 0.9, bh: 0.55, bd: 0.6 }).map((b) => rotateY90(b, -2.1)),
      ...wall(3, 2, { cz: 0, bw: 0.9, bh: 0.55, bd: 0.6 }).map((b) => rotateY90(b, 2.1)),
      ...spire(4, { base: 1.5, top: 0.7, bh: 0.62 }),
    ],
  });

  // L20 — ARMAGEDDON. The finale: a domino chain, a boulder ramp, twin towers, on
  // a fast shielded turntable. Everything, all at once. Airstrike-friendly.
  reset();
  levels.push({
    name: 'ARMAGEDDON',
    par: 8,
    airstrikes: 3,
    spin: 0.2,
    shield: { arms: 4, speed: -0.14 },
    blocks: [
      // Bare slope (no roller — a boulder can't stay parked on a spinning shelf).
      ...ramp({ cx: -2.8, cz: -1.6, rise: 2.0, run: 2.4, width: 1.8, roller: false }),
      ...column(4, { cx: -2.6, cz: 1.6, bw: 0.85, bh: 0.7, bd: 0.85 }),
      ...column(4, { cx: 2.6, cz: -1.6, bw: 0.85, bh: 0.7, bd: 0.85 }),
      ...dominoes(4, { cx: 1.2, cz: 1.6, spacing: 0.62, w: 1.2, h: 1.7, t: 0.24 }),
      { shape: 'box', pos: [0, 0.45, 0], size: [1.6, 0.9, 1.6], color: NEON.violet },
      { shape: 'cyl', pos: [0, 0.9 + 0.7, 0], radius: 0.6, height: 1.4, axis: 'y', color: NEON.green },
    ],
  });

  // ===== PROTOTYPES (test via ?level=N) — not part of the main progression =====

  // L21 — SLIP (proto). A SLOPING base: everything is authored flat then the whole
  // table + stack tilts, so blocks sit precariously — knock one off balance and it
  // slides down the slope and off the low edge. (Static: a sloped turntable would
  // just wobble.)
  reset();
  levels.push({
    name: 'SLIP (proto)',
    par: 3,
    airstrikes: 1,
    tilt: 0.16, // ~9° sloping base; downhill toward -x
    blocks: [
      ...column(3, { cx: 1.3, bw: 1.0, bh: 0.8, bd: 1.0 }),
      { shape: 'box', pos: [0, 0.5, 0], size: [1.0, 1.0, 1.0], color: NEON.cyan },
      { shape: 'box', pos: [0, 1.5 + GAP, 0], size: [1.0, 1.0, 1.0], color: NEON.magenta },
      { shape: 'box', pos: [-1.3, 0.5, 0], size: [1.0, 1.0, 1.0], color: NEON.yellow },
    ],
  });

  // Dev guard: flag any level that blew the block budget.
  if (import.meta.env?.DEV) {
    levels.forEach((lv, i) => {
      if (lv.blocks.length > MAX_BLOCKS) {
        console.warn(`Level ${i + 1} "${lv.name}" has ${lv.blocks.length} blocks (> ${MAX_BLOCKS} budget)`);
      }
    });
  }

  return levels;
}

// Rotate a box spec 90° about Y (swap its x/z footprint) and drop it at cz. Used
// to turn a wall built along x into the side walls of a square ring.
function rotateY90(b, cz) {
  const spec = { ...b, pos: [cz, b.pos[1], b.pos[0]] };
  if (b.size) spec.size = [b.size[2], b.size[1], b.size[0]];
  return spec;
}

export const LEVELS = buildLevels();
export const NEON_COLORS = NEON;
