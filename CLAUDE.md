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
| `levels.js` | Level data + authoring helpers (column/jenga/spire/wall) | runtime state |

Dependency direction: `game` depends on everything; subsystems depend only on
`render`/`physics` primitives and `config`. Keep it that way. `render.js`
re-exports `THREE` so other modules import it from there (one Three instance).

## Game loop (`game.js#_frame`)

Fixed-timestep physics (`FIXED_TIMESTEP`, capped at `MAX_SUBSTEPS`), then sync
meshes to bodies, rotate the table/shield to their physics angles, update the
airstrike, check win. `state`: `menu | playing | won`. `window.__game` is the
test/debug handle (`__game.loadLevel(n)`, `__game.store`, `__game._frames`).

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
`{ shape:'box', pos:[x,y,z], size:[w,h,d], rot?:[x,y,z], color }` or
`{ shape:'cyl', pos:[x,y,z], radius, height, axis:'x'|'y'|'z', color }`. Author
blocks resting on the table (y>0) with exact contacts (a tiny `GAP`) so they load
stable. Helpers `column/jenga/spire/wall` build common structures. `spin`
defaults to `DEFAULT_SPIN` if omitted. Airstrikes are a **global** bank (Store),
not per-level.

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
