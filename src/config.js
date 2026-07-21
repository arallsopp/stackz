// Central gameplay tuning. Keep cross-cutting constants here so they're easy to
// find and adjust; module-specific physics/render details stay in their modules.

// --- simulation loop ---
export const FIXED_TIMESTEP = 1 / 60; // physics step size (seconds)
export const MAX_SUBSTEPS = 5; // cap per frame to avoid a spiral of death

// --- world thresholds ---
export const CLEAR_Y = -2.5; // a block below this has fallen off the table (cleared)
export const CULL_Y = -18; // remove meshes/bodies once they fall past this

// --- projectiles ---
export const MAX_BALLS = 6; // concurrent player balls before the oldest is culled
export const BALL_SPEED = 34; // launch speed
export const BALL_RADIUS = 0.38;

// --- turntable ---
export const DEFAULT_SPIN = 0.18; // rad/s; every level turns unless it overrides `spin`

// --- scoring / economy ---
export const AIRSTRIKE_SHOT_COST = 2; // shots added when an airstrike is used
export const WINS_PER_AIRSTRIKE = 5; // +1 airstrike bank per this many wins
export const STAR_PAR_OFFSET_2 = 2; // <= par+this earns 2 stars (<= par earns 3)

// --- camera shake ---
export const SHAKE_FIRE = 0.18;
export const SHAKE_EXPLOSION = 0.5;
