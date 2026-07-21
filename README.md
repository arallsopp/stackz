# STACKZ — Neon Demolition

A fullscreen, mobile-first PWA casual game. **Tap to launch balls** at the point you
touch and obliterate stacked 3D neon structures. Clear the platform in as few shots
as you can — or call in an **AIRSTRIKE** and let a C-130 Hercules carpet-bomb the lot.

Built with **Three.js** (rendering + bloom) and **Rapier** (Rust/WASM rigid-body
physics), bundled by **Vite** with an offline-capable service worker.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

Build a static, installable PWA:

```bash
npm run build
npm run preview    # serves dist/ over the network for phone testing
```

Open the preview URL on your phone and **Add to Home Screen** to install it fullscreen.

## How it plays

- **Tap** anywhere to fire a heavy ball toward that point.
- **AIRSTRIKE** button calls a cartoon C-130 Hercules bomber run (limited uses per
  level, +2 to your shot score — powerful but costly).
- **Goal:** knock every block off the table. Fewer shots = more stars (★★★ at par).
- **Physics is real:** tall towers topple, and cylinders roll on their sides and
  tumble off the edge when they gain momentum.

The **table** is sized per level to the tower's base (never bigger) and the camera
auto-frames the whole table + tower in portrait, so you can always see how many
blocks remain. Six levels ship, favouring tall, toppling structures (Jenga included).

## Project layout

| File | Role |
|------|------|
| `src/main.js` | Entry point, fullscreen request, service-worker boot |
| `src/game.js` | Orchestrator: game loop, input, HUD, win/star logic |
| `src/render.js` | Three.js scene, lights, bloom, mesh factories |
| `src/physics.js` | Rapier world wrapper (bodies, cylinders, ball, explosion) |
| `src/airstrike.js` | The Hercules bomber, bombs and detonations |
| `src/levels.js` | Level definitions + platform dimensions |
| `scripts/gen-icons.mjs` | Regenerates PWA icons from `public/favicon.svg` (`node scripts/gen-icons.mjs`) |

## Tuning knobs

- **Levels:** edit `src/levels.js` — `par`, `airstrikes`, `spin` (rad/s; makes the
  table a slowly-rotating turntable that carries the structure), and the block list
  (`box`/`cyl` specs). Helpers build columns/jenga/spires.
- **Ball power:** `speed` in `game.js#_fire`.
- **Airstrike power/radius:** `physics.explode(...)` call in `airstrike.js#_detonate`.
- **Platform size:** `PLATFORM` in `src/levels.js`.

## Credits

This work is based on ["c130-hercules"](https://sketchfab.com/3d-models/c130-hercules-d97fffc327fc45779b4c0b36c12b61da)
by [slava2019](https://sketchfab.com/slava2019) licensed under
[CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/).

## Notes

- `window.__game` is exposed for debugging (jump levels via
  `__game.loadLevel(n)`, inspect `__game.blocks`).
- Gravity is set stronger than earth (`-20`) so stacks settle snappily on mobile.
