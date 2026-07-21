import { Renderer, THREE } from './render.js';
import { Physics } from './physics.js';
import { Airstrike } from './airstrike.js';
import { Shield } from './shield.js';
import { Audio } from './audio.js';
import { Store } from './store.js';
import { Hud } from './hud.js';
import { LEVELS } from './levels.js';
import {
  FIXED_TIMESTEP,
  MAX_SUBSTEPS,
  CLEAR_Y,
  CULL_Y,
  MAX_BALLS,
  BALL_SPEED,
  BALL_RADIUS,
  DEFAULT_SPIN,
  AIRSTRIKE_SHOT_COST,
  WINS_PER_AIRSTRIKE,
  STAR_PAR_OFFSET_2,
  SHAKE_FIRE,
  SHAKE_EXPLOSION,
} from './config.js';

const MODEL_URL = import.meta.env.BASE_URL + 'models/c130-hercules/scene.gltf';
const SETTLE_QUIET_MS = 500; // suppress impact sounds while a level settles

// Orchestrator: owns the game loop and level lifecycle, and wires the subsystems
// (Renderer, Physics, Airstrike, Shield, Audio, Store, Hud) together. It holds no
// DOM or storage details of its own — those live in Hud and Store respectively.
export class Game {
  constructor() {
    this.blocks = [];
    this.balls = [];
    this.levelIndex = 0;
    this.shots = 0;
    this.state = 'menu'; // menu | playing | won
    this._accum = 0;
    this._last = 0;
    this._frames = 0;
    this._impactMuteUntil = 0;
    this.shake = 0;
    this._camBase = new THREE.Vector3();
  }

  async init() {
    this.renderer = new Renderer(document.getElementById('scene'));
    this.physics = await Physics.load();
    this.store = new Store();
    this.audio = new Audio({
      muted: this.store.muted,
      onMuteChange: (m) => {
        this.store.muted = m;
      },
    });
    this.shield = new Shield(this.renderer, this.physics);
    this.airstrike = new Airstrike(this.renderer, this.physics);
    this.airstrike.audio = this.audio;
    this.airstrike.onDetonate = () => this._kick(SHAKE_EXPLOSION);
    this.airstrike.onComplete = () => this._checkWin(true);
    // Always explode against bodies still in the world (never a stale snapshot).
    this.airstrike.getLiveBodies = () => this.blocks.map((b) => b.body);
    try {
      await this.airstrike.loadModel(MODEL_URL);
    } catch (e) {
      console.warn('C-130 model failed to load, using sprite fallback:', e);
    }

    // Physical collision sounds (muted briefly after each level load while the
    // stack settles, so we don't get a clatter on spawn).
    this.physics.onImpact = (strength) => {
      if (performance.now() >= this._impactMuteUntil) this.audio.impact(strength);
    };

    this.hud = new Hud({
      onStart: () => {
        this.audio.unlock();
        this.audio.click();
        this._start();
      },
      onReplay: () => {
        this.audio.click();
        this.loadLevel(this.levelIndex);
      },
      onNext: () => {
        this.audio.click();
        this.loadLevel((this.levelIndex + 1) % LEVELS.length);
      },
      onAirstrike: () => this._callAirstrike(),
      onToggleMute: () => {
        this.audio.unlock(); // doubles as an iOS unlock gesture
        this.hud.setMuted(this.audio.toggle());
      },
    });
    this.hud.setMuted(this.audio.isMuted());

    // Tap-to-fire on the canvas (input stays with the game; display with the Hud).
    this.renderer.canvas.addEventListener('pointerdown', (e) => {
      this.audio.resume(); // keep the context alive across backgrounding
      if (this.state === 'playing') this._fire(e.clientX, e.clientY);
    });
    window.addEventListener('resize', () => this._onResize());

    this._camBase.copy(this.renderer.camera.position);
    this.hud.hideLoading();
    requestAnimationFrame((t) => this._frame(t));
  }

  _start() {
    this.hud.enterGame();
    this.loadLevel(0);
  }

  // ---- level management -----------------------------------------------------

  loadLevel(index) {
    // Tear down previous level. Reset airstrike + shield BEFORE the physics world
    // is recreated so their bodies are released from the still-valid world first.
    this.airstrike.reset();
    this.shield.reset();
    for (const b of this.blocks) this.renderer.remove(b.mesh);
    for (const b of this.balls) this.renderer.remove(b.mesh);
    this.blocks = [];
    this.balls = [];

    const level = LEVELS[index];
    // Size the table to the tower's base and frame the camera to fit it all.
    const { platform, maxY } = this._computeBounds(level);
    this._bounds = { maxY, hx: Math.max(platform.hx, platform.hz) };
    this.physics.reset(platform, level.spin ?? DEFAULT_SPIN);
    this.renderer.setPlatform(platform);

    this.levelIndex = index;
    this.shots = 0;
    this.state = 'playing';
    this._impactMuteUntil = performance.now() + SETTLE_QUIET_MS;

    for (const spec of level.blocks) this._spawnBlock(spec);

    // Optional counter-rotating shield on harder levels. It enlarges the scene,
    // so the camera framing accounts for its radius and height.
    let frame = { hx: platform.hx, hz: platform.hz, maxY };
    if (level.shield) {
      const radius = Math.max(platform.hx, platform.hz) + 0.6;
      const height = maxY + 0.6;
      this.shield.build({ radius, height, arms: level.shield.arms, speed: level.shield.speed });
      frame = { hx: radius, hz: radius, maxY: Math.max(maxY, height) };
    }
    this._camBase.copy(this.renderer.frameScene(frame));

    this.hud.hideWin();
    this.hud.setLevel(index + 1);
    this.hud.setPar(level.par);
    this._updateHud();
  }

  // Footprint of the base layer -> table size; tallest block top -> maxY.
  _computeBounds(level) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
    for (const s of level.blocks) {
      const [x, y, z] = s.pos;
      let hw, hd, top, bottom;
      if (s.shape === 'box') {
        hw = s.size[0] / 2; hd = s.size[2] / 2;
        top = y + s.size[1] / 2; bottom = y - s.size[1] / 2;
      } else {
        const r = s.radius, hh = s.height / 2;
        if (s.axis === 'x') { hw = hh; hd = r; top = y + r; bottom = y - r; }
        else if (s.axis === 'z') { hw = r; hd = hh; top = y + r; bottom = y - r; }
        else { hw = r; hd = r; top = y + hh; bottom = y - hh; }
      }
      maxY = Math.max(maxY, top);
      // Only the base layer (resting on the table) defines the footprint.
      if (bottom <= 0.09) {
        minX = Math.min(minX, x - hw); maxX = Math.max(maxX, x + hw);
        minZ = Math.min(minZ, z - hd); maxZ = Math.max(maxZ, z + hd);
      }
    }
    const hx = Math.max(Math.abs(minX), Math.abs(maxX), 0.4);
    const hz = Math.max(Math.abs(minZ), Math.abs(maxZ), 0.4);
    return { platform: { hx, hy: 0.5, hz }, maxY };
  }

  _onResize() {
    const base = this.renderer.resize();
    if (base) this._camBase.copy(base);
  }

  _spawnBlock(spec) {
    const pos = new THREE.Vector3(...spec.pos);
    if (spec.shape === 'box') {
      const [w, h, d] = spec.size;
      let quat = null;
      if (spec.rot) {
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...spec.rot));
        quat = { x: q.x, y: q.y, z: q.z, w: q.w };
      }
      const body = this.physics.addBox(pos, { x: w / 2, y: h / 2, z: d / 2 }, quat);
      const mesh = this.renderer.makeBox(spec.size, spec.color);
      this.blocks.push({ mesh, body, cleared: false });
    } else if (spec.shape === 'cyl') {
      // Rapier cylinder axis is local Y; rotate to lay logs on their side.
      const q = new THREE.Quaternion();
      if (spec.axis === 'x') q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
      else if (spec.axis === 'z') q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      const quat = { x: q.x, y: q.y, z: q.z, w: q.w };
      const body = this.physics.addCylinder(pos, spec.height / 2, spec.radius, quat);
      const mesh = this.renderer.makeCylinder(spec.radius, spec.height, spec.color);
      this.blocks.push({ mesh, body, cleared: false });
    }
  }

  // ---- actions --------------------------------------------------------------

  _fire(clientX, clientY) {
    const ray = this.renderer.pointerRay(clientX, clientY);
    // Launch from just in front of the camera, flying toward the tapped point.
    const origin = ray.origin.clone().addScaledVector(ray.direction, 1.2);
    const vel = ray.direction.clone().multiplyScalar(BALL_SPEED);
    const body = this.physics.addBall(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: vel.x, y: vel.y, z: vel.z },
      BALL_RADIUS
    );
    const mesh = this.renderer.makeBall(BALL_RADIUS);
    this.balls.push({ body, mesh, life: 0 });

    // Cap concurrent balls.
    while (this.balls.length > MAX_BALLS) {
      const old = this.balls.shift();
      this.physics.remove(old.body);
      this.renderer.remove(old.mesh);
    }

    this.shots++;
    this._updateHud();
    this.hud.flash(clientX, clientY);
    this._kick(SHAKE_FIRE);
    this.audio.fire();
  }

  _callAirstrike() {
    if (this.state !== 'playing' || this.store.airstrikes <= 0 || this.airstrike.active) return;
    this.audio.click();
    const live = this.blocks.filter((b) => !b.cleared).map((b) => b.body);
    if (!this.airstrike.launch(live, this._bounds)) return;
    this.store.spendAirstrike(); // scarce, global resource
    this.shots += AIRSTRIKE_SHOT_COST; // powerful, so it carries a scoring cost
    this._updateHud();
  }

  // ---- main loop ------------------------------------------------------------

  _frame(t) {
    requestAnimationFrame((tt) => this._frame(tt));
    this._frames++;
    if (!this._last) this._last = t;
    let dt = (t - this._last) / 1000;
    this._last = t;
    if (dt > 0.1) dt = 0.1; // avoid a spiral of death after a tab switch

    if (this.state !== 'menu') {
      this._accum += dt;
      let steps = 0;
      while (this._accum >= FIXED_TIMESTEP && steps < MAX_SUBSTEPS) {
        this.physics.step();
        this._accum -= FIXED_TIMESTEP;
        steps++;
      }
      this._sync(dt);
      // Keep the table mesh aligned with the (spinning) physics platform + shield.
      if (this.renderer.platform) this.renderer.platform.rotation.y = this.physics.platformAngle;
      this.shield.update();
      this.airstrike.update(dt);
      this._checkWin(false);
    }

    this._applyShake(dt);
    this.renderer.render();
  }

  _sync(dt) {
    // Blocks: sync transforms, flag cleared, cull the fallen.
    for (let i = this.blocks.length - 1; i >= 0; i--) {
      const b = this.blocks[i];
      const t = b.body.translation();
      const r = b.body.rotation();
      b.mesh.position.set(t.x, t.y, t.z);
      b.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (!b.cleared && t.y < CLEAR_Y) b.cleared = true;
      if (t.y < CULL_Y) {
        this.physics.remove(b.body);
        this.renderer.remove(b.mesh);
        this.blocks.splice(i, 1);
      }
    }
    // Balls: sync + cull.
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const ball = this.balls[i];
      ball.life += dt;
      const t = ball.body.translation();
      ball.mesh.position.set(t.x, t.y, t.z);
      if (t.y < CULL_Y || ball.life > 12) {
        this.physics.remove(ball.body);
        this.renderer.remove(ball.mesh);
        this.balls.splice(i, 1);
      }
    }
  }

  _checkWin(force) {
    if (this.state !== 'playing') return;
    // Win when every block has been knocked off the table.
    if (this.blocks.some((b) => !b.cleared)) return;
    // Don't declare victory mid-airstrike unless it's the completion callback.
    if (this.airstrike.busy && !force) return;
    this._win();
  }

  _win() {
    this.state = 'won';
    this.audio.win();
    const level = LEVELS[this.levelIndex];

    // Persist progress: personal best per level + a win toward airstrike refills.
    const isBest = this.store.recordScore(this.levelIndex, this.shots);
    this.store.registerWin(WINS_PER_AIRSTRIKE);
    const best = this.store.bestScore(this.levelIndex);

    this.hud.showWin({
      shots: this.shots,
      par: level.par,
      stars: this._stars(this.shots, level.par),
      bestText: isBest ? '★ NEW BEST!' : `Best: ${best} shots`,
    });
    this._updateHud(); // reflect any airstrike replenishment
  }

  _stars(shots, par) {
    if (shots <= par) return 3;
    if (shots <= par + STAR_PAR_OFFSET_2) return 2;
    return 1;
  }

  // ---- juice ----------------------------------------------------------------

  _updateHud() {
    this.hud.setShots(this.shots);
    this.hud.setAirstrikes(this.store.airstrikes);
  }

  _kick(amount) {
    this.shake = Math.min(this.shake + amount, 1.2);
  }

  _applyShake(dt) {
    const cam = this.renderer.camera;
    if (this.shake > 0.001) {
      const s = this.shake * 0.35;
      cam.position.set(
        this._camBase.x + (Math.random() - 0.5) * s,
        this._camBase.y + (Math.random() - 0.5) * s,
        this._camBase.z + (Math.random() - 0.5) * s * 0.5
      );
      this.shake = Math.max(0, this.shake - dt * 3);
    } else {
      cam.position.copy(this._camBase);
    }
  }
}
