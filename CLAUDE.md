# STACKZ — agent guide

Tap-to-launch neon demolition PWA. Three.js (render) + Rapier/WASM (physics) +
Vite/PWA. Fullscreen mobile-first, **iOS Safari is the target** — respect that in
audio (gesture unlock, `webkitAudioContext`) and input (pointer events, safe-area).

## Commands

- `npm run dev` — dev server (HMR)
- `npm run build` — production build to `dist/` (also generates the PWA SW). Run
  this after edits to catch import/API errors. A Claude Code `PostToolUse` hook
  (`.claude/settings.json` → `.claude/hooks/build-check.sh`) auto-builds after any
  edit to `src/*.js`, `src/*.css`, `index.html`, or `vite.config.js` and blocks on
  failure (needs `jq`).
- `npm run preview -- --port 4173` — serve `dist/` for headless testing
- `node scripts/gen-icons.mjs` — regenerate PWA icons from `public/favicon.svg`

Deploy is automatic: push to `main` → GitHub Actions builds and publishes to
Pages (https://arallsopp.github.io/stackz/). See `.github/workflows/deploy.yml`.

## Architecture (single responsibility per module)

| Module | Responsibility | Must NOT do |
|--------|----------------|-------------|
| `main.js` | Boot, fullscreen request, expose `window.__game` for tests | game logic |
| `game.js` | Orchestrator: game loop, level lifecycle, subsystem wiring | DOM, storage |
| `render.js` | Three.js scene, camera framing, table/mesh factories, bloom | physics, rules |
| `physics.js` | Rapier world: bodies, colliders, turntable, shield, impacts | Three.js, DOM |
| `airstrike.js` | The C-130: model load/orient, flight spline, bombs, collider | scoring, HUD |
| `shield.js` | Counter-rotating shield visuals + physics wiring | game rules |
| `audio.js` | Web Audio synthesis + mute (persistence injected) | storage keys, DOM |
| `store.js` | All localStorage (best scores, airstrike bank, wins, mute) | game logic |
| `hud.js` | All DOM: HUD, overlays, buttons, flash | physics, rules |
| `config.js` | Cross-cutting gameplay tuning constants | logic |
| `levels.js` | Level data + authoring helpers (column/jenga/spire/wall/dominoes/pins/ramp) | runtime state |

Dependency direction: `game` depends on everything; subsystems depend only on
`render`/`physics` primitives and `config`. Keep it that way. `render.js`
re-exports `THREE` so other modules import it from there (one Three instance).

## Game loop (`game.js#_frame`)

Fixed-timestep physics (`FIXED_TIMESTEP`, capped at `MAX_SUBSTEPS`), then sync
meshes to bodies, rotate the table/shield to their physics angles, update the
airstrike, check win. `state`: `menu | playing | won | lost`. `window.__game` is
the test/debug handle (`__game.loadLevel(n)`, `__game.store`, `__game._frames`).

**Shots are ballistic** (`game._fire`): the tap is raycast onto the struck block
(else a point at the tower's depth), then the ball is launched to ARC through it —
horizontal speed fixed at `BALL_SPEED`, a vertical term cancels `GRAVITY` — so
far/high stacks are reachable, not dropping short.

**Modes** (`store.mode`, toggled on the start screen, persisted):
- `normal` — authored par, SKIP hidden.
- `learning` — SKIP shown; par auto-tunes via `store.learnedPar/recordParSample`
  (running average of shots-to-clear, seeded with the authored par; a FAILED run
  records `budget + FAIL_PAR_INCREMENT` so par climbs when a level is too hard).
  `game.par` (effective par) drives the ball budget, HUD, and stars.

## Coordinate system & conventions

- Table top is at **y = 0**; blocks rest above it. A block is **cleared** when it
  falls below `CLEAR_Y`, culled below `CULL_Y`. Win = all blocks cleared.
- Table is sized per level to the base footprint (`_computeBounds`) and rendered
  grey (neutral, "not part of the level"). It spins slowly (turntable).
- Camera auto-frames the whole table + tower (+ shield) in portrait
  (`render.frameScene`); recomputed on resize.
- Airstrike flies along a spline: enters over the camera, out over the target
  (nose away), loops in the background, returns over the camera. Nose follows the
  spline tangent via `lookAt`; the model is rigged so its nose is local **-Z**.

## Adding a level

Append to `LEVELS` in `levels.js`. Fields:
`{ name, par, spin?, shield?: { arms, speed }, blocks: [...] }`. Block specs:
`{ shape:'box', pos:[x,y,z], size:[w,h,d], rot?:[x,y,z], color, friction?, restitution?, density? }`
or `{ shape:'cyl', pos:[x,y,z], radius, height, axis:'x'|'y'|'z', color, ... }`.
The optional physics fields fall through to Rapier defaults when omitted; **low
`friction` is the main tool for fragility** — it lets toppled pieces slide off the
table. Author blocks resting on the table (y>0) with exact contacts (a tiny `GAP`)
so they load stable. Airstrikes are a **global** bank (Store), not per-level.

**Every level spins** — `spin` defaults to `DEFAULT_SPIN`; don't set `spin: 0`.
The turntable fights delicate structures: tall/tippy stacks and dominoes want a
gentle spin (~0.1–0.14), and a **roller on a ramp needs the gentlest of all
(~0.08)** because a spinning shelf works a parked boulder loose over ~5–7s (fine —
players fire well before that, and a self-released boulder just rolls down anyway).
When adding a delicate level, drive it headless for 4–8s and confirm nothing
self-solves in the pre-fire window.

Helpers: `column / jenga / spire / wall / dominoes / pins / ramp` build common
structures; `rotateY90` composes walls into a ring. `ramp({ dir, roller })` makes
an elevated shelf + sloped plank, with an optional boulder held by a low **chock**
at the lip (idle-stable, but a real hit rolls it over and down); `dir` (+1/-1) is
the downhill direction so two ramps can face each other.

Two hard constraints, both from the win rule (**every block must clear off an
edge**):
- **Things that fall flat stay put.** A domino/pin toppling onto the table does
  NOT clear — only pieces that go over an edge do. Keep footprints tight and
  friction low so collapses slide off; a full jenga piles up and is near-unclearable.
- **A cylinder can't rest on a slope** (rolls) and drifts off a bare flat shelf
  as it settles — always chock a parked roller. Keep a ramp's plank foot clear of
  any pins/dominoes below it (the plank landing among them shoves them off at load).

**Block budget ~28/level** (`MAX_BLOCKS`, dev-warns): Rapier/mobile Safari and the
tight ball budget both punish big piles.

**Par is set by human playtest, not guessed.** Headless drives verify *stability*
(loads solid, never self-solves, no WASM panic) reliably; they can't judge
difficulty. Ship provisional pars, then calibrate from the player's real attempts.

A **SKIP** button (top-centre, `#skip-btn` → `onSkip`) jumps levels while
authoring/testing — visible only in **Learning mode** (see Game loop § Modes).

## Physics gotchas (learned the hard way — don't reintroduce)

- **Never call `world.getCollider()` (or any world method) inside a Rapier event
  callback** (`drainCollisionEvents`). It re-enters WASM → "recursive use of an
  object". Collect handles in the callback, resolve them after (see
  `physics.step`).
- **Never touch a removed body.** Calling into a culled body (e.g. `isSleeping`)
  panics WASM ("unreachable") and poisons the instance → permanent freeze. The
  airstrike explodes against `getLiveBodies()` (current blocks), never a snapshot.
- **Kinematic colliders must spawn at their real start position**, not the origin
  — a first-step teleport imparts enormous velocity (the plane collider once
  launched the whole stack into orbit). See `addPlaneCollider(half, pos)`.
- Reset airstrike + shield **before** `physics.reset()` so their bodies are freed
  from the still-valid world.

## Testing

No unit tests; verify behaviour by driving the built app in headless system
Chrome via Playwright (installed transiently — `npm i -D playwright`, use
`channel: 'chrome'`, then uninstall). Pattern: `preview` on :4173, click
`#start-btn`, then drive via `window.__game`. Check for `pageerror` (WASM panics
surface there), assert `__game._frames` keeps advancing (hang detection), and
screenshot to a scratch dir for visual checks. Then `npm uninstall playwright`.

## Attribution

C-130 model: "c130-hercules" by slava2019, CC-BY-4.0 (credited on the start
screen and in the README — keep it).
