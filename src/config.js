// Central gameplay tuning. Keep cross-cutting constants here so they're easy to
// find and adjust; module-specific physics/render details stay in their modules.

// --- simulation loop ---
export const FIXED_TIMESTEP = 1 / 60; // physics step size (seconds)
export const MAX_SUBSTEPS = 5; // cap per frame to avoid a spiral of death

// --- world thresholds ---
export const CLEAR_Y = -2.5; // a block below this has fallen off the table (cleared)
export const CULL_Y = -18; // remove meshes/bodies once they fall past this

// --- projectiles ---
export const MAX_BALLS = 6; // concurrent player balls on screen before the oldest is culled
export const BALL_SPEED = 34; // launch speed
export const BALL_RADIUS = 0.38;

// The per-level ball budget (the ammo you count down to zero) is derived from the
// level's par: you get `par + BALL_BUDGET_BONUS` balls. Run out and the level is
// lost. Par itself is still the 3-star target.
export const BALL_BUDGET_BONUS = 1;
export const LOSE_GRACE_MS = 3500; // after the last ball, wait this long for the dust to settle before declaring a loss

// --- table ---
// The table is drawn slightly larger than the tower's base so it visibly reads as
// scenery ("not part of the level") rather than a block to shoot at.
export const PLATFORM_MARGIN = 0.4;

// --- turntable ---
export const DEFAULT_SPIN = 0.18; // rad/s; every level turns unless it overrides `spin`

// --- scoring / economy ---
export const WINS_PER_AIRSTRIKE = 5; // +1 airstrike bank per this many wins
export const STAR_PAR_OFFSET_2 = 2; // <= par+this earns 2 stars (<= par earns 3)

// --- camera shake ---
export const SHAKE_FIRE = 0.18;
export const SHAKE_EXPLOSION = 0.5;
