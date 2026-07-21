// Level definitions.
//
// Each block spec:
//   { shape: 'box', pos:[x,y,z], size:[w,h,d], rot?:[x,y,z] euler radians, color }
//   { shape: 'cyl', pos:[x,y,z], radius, height, axis:'x'|'y'|'z', color }
//
// The table top sits at y = 0. Blocks are authored resting ON the table (y > 0)
// with exact stacking contacts so they load perfectly stable. The table footprint
// is computed from the base layer (see computeBounds in game.js) so it is never
// bigger than the base of the tower. Levels favour TALL towers that topple.

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
function jenga(layers, { cx = 0, cz = 0, barLen = 3, barW = 0.96, barH = 0.6 } = {}) {
  const blocks = [];
  const step = barW + GAP;
  for (let l = 0; l < layers; l++) {
    const y = barH / 2 + l * (barH + GAP);
    for (let k = -1; k <= 1; k++) {
      if (l % 2 === 0) {
        blocks.push({ shape: 'box', pos: [cx, y, cz + k * step], size: [barLen, barH, barW], color: nextColor() });
      } else {
        blocks.push({ shape: 'box', pos: [cx + k * step, y, cz], size: [barW, barH, barLen], color: nextColor() });
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

function buildLevels() {
  const levels = [];

  // L1 — LIFT OFF. A lone tall column. One good hit topples it.
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
    spin: 0.25, // slow turntable
    blocks: [
      ...column(6, { cx: -1.0, bw: 0.95, bh: 0.8, bd: 0.95 }),
      ...column(6, { cx: 1.0, bw: 0.95, bh: 0.8, bd: 0.95 }),
    ],
  });

  // L3 — JENGA. Rock-solid on load, glorious collapse. 7 layers tall.
  reset();
  levels.push({
    name: 'JENGA',
    par: 3,
    airstrikes: 1,
    blocks: jenga(7, { barLen: 2.9, barW: 0.94, barH: 0.58 }),
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
      // Crowning log lies on its side across the top -> rolls when disturbed.
      { shape: 'cyl', pos: [0, 4.3 + 0.5, 0], radius: 0.5, height: 2.4, axis: 'x', color: NEON.orange },
    ],
  });

  // L5 — ZIGGURAT. A tall tapering spire.
  reset();
  levels.push({
    name: 'ZIGGURAT',
    par: 5,
    airstrikes: 2,
    blocks: spire(8, { base: 2.0, top: 0.7, bh: 0.62 }),
  });

  // L6 — THE CITADEL. Four tall corner spires bound by a bridge and a crown.
  reset();
  levels.push({
    name: 'THE CITADEL',
    par: 6,
    airstrikes: 2,
    spin: 0.18,
    blocks: [
      ...column(5, { cx: -1.2, cz: -1.2, bw: 0.9, bh: 0.8, bd: 0.9 }),
      ...column(5, { cx: 1.2, cz: -1.2, bw: 0.9, bh: 0.8, bd: 0.9 }),
      ...column(5, { cx: -1.2, cz: 1.2, bw: 0.9, bh: 0.8, bd: 0.9 }),
      ...column(5, { cx: 1.2, cz: 1.2, bw: 0.9, bh: 0.8, bd: 0.9 }),
      // Bridge slabs linking the tops.
      { shape: 'box', pos: [0, 4.2, -1.2], size: [3.3, 0.35, 0.9], color: NEON.cyan },
      { shape: 'box', pos: [0, 4.2, 1.2], size: [3.3, 0.35, 0.9], color: NEON.magenta },
      // Roof drums that roll off once the bridge goes.
      { shape: 'cyl', pos: [0, 4.9, 0], radius: 0.55, height: 3.0, axis: 'z', color: NEON.yellow },
      { shape: 'box', pos: [0, 5.6, 0], size: [1.3, 0.9, 1.3], color: NEON.violet },
    ],
  });

  return levels;
}

export const LEVELS = buildLevels();
export const NEON_COLORS = NEON;
