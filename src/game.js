import { Renderer, THREE } from './render.js';
import { Physics } from './physics.js';
import { Airstrike } from './airstrike.js';
import { Audio } from './audio.js';
import { LEVELS } from './levels.js';

const FIXED = 1 / 60;
const CLEAR_Y = -2.5; // a block below this has fallen off the platform
const CULL_Y = -18; // fully remove meshes/bodies past this
const MAX_BALLS = 6;

export class Game {
  constructor() {
    this.blocks = [];
    this.balls = [];
    this.levelIndex = 0;
    this.shots = 0;
    this.state = 'menu'; // menu | playing | won
    this._accum = 0;
    this._last = 0;
    this.shake = 0;
    this._camBase = new THREE.Vector3();
  }

  async init() {
    this.renderer = new Renderer(document.getElementById('scene'));
    this.physics = await Physics.load();
    this.audio = new Audio();
    this.airstrike = new Airstrike(this.renderer, this.physics);
    this.airstrike.audio = this.audio;
    this.airstrike.onDetonate = () => this._kick(0.5);
    this.airstrike.onComplete = () => this._checkWin(true);
    // Always explode against bodies still in the world (never a stale snapshot).
    this.airstrike.getLiveBodies = () => this.blocks.map((b) => b.body);
    // Load the real C-130 model; if it fails we keep the cartoon sprite.
    try {
      await this.airstrike.loadModel(import.meta.env.BASE_URL + 'models/c130-hercules/scene.gltf');
    } catch (e) {
      console.warn('C-130 model failed to load, using sprite fallback:', e);
    }
    this._camBase.copy(this.renderer.camera.position);

    // Physical collision sounds (suppressed briefly after each level loads while
    // the stack settles, so we don't get a clatter on spawn).
    this._impactMuteUntil = 0;
    this.physics.onImpact = (strength) => {
      if (performance.now() < this._impactMuteUntil) return;
      this.audio.impact(strength);
    };

    this._bindUI();
    window.addEventListener('resize', () => this._onResize());

    document.getElementById('loading').classList.add('hidden');
    requestAnimationFrame((t) => this._frame(t));
  }

  _bindUI() {
    const el = (id) => document.getElementById(id);
    this.ui = {
      hud: el('hud'),
      level: el('hud-level'),
      shots: el('hud-shots'),
      par: el('hud-par'),
      airstrikeBtn: el('airstrike-btn'),
      airstrikeCount: el('airstrike-count'),
      muteBtn: el('mute-btn'),
      startScreen: el('start-screen'),
      winScreen: el('win-screen'),
      winShots: el('win-shots'),
      winPar: el('win-par'),
      stars: el('stars'),
    };
    this._syncMuteButton();

    el('start-btn').addEventListener('click', () => {
      this.audio.unlock();
      this.audio.click();
      this._start();
    });
    el('replay-btn').addEventListener('click', () => {
      this.audio.click();
      this.loadLevel(this.levelIndex);
    });
    el('next-btn').addEventListener('click', () => {
      this.audio.click();
      this.levelIndex = (this.levelIndex + 1) % LEVELS.length;
      this.loadLevel(this.levelIndex);
    });
    this.ui.airstrikeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._callAirstrike();
    });
    this.ui.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.audio.unlock(); // also serves as an unlock gesture on iOS
      this.audio.toggle();
      this._syncMuteButton();
    });

    // Tap-to-fire on the canvas.
    const canvas = this.renderer.canvas;
    canvas.addEventListener('pointerdown', (e) => {
      this.audio.resume(); // keep the context alive across backgrounding
      if (this.state !== 'playing') return;
      this._fire(e.clientX, e.clientY);
    });
  }

  _syncMuteButton() {
    const muted = this.audio.isMuted();
    this.ui.muteBtn.textContent = muted ? '🔇' : '🔊';
    this.ui.muteBtn.classList.toggle('is-muted', muted);
    this.ui.muteBtn.setAttribute('aria-pressed', String(muted));
  }

  _start() {
    this.ui.startScreen.classList.add('hidden');
    this.ui.hud.classList.remove('hidden');
    this.ui.airstrikeBtn.classList.remove('hidden');
    this.ui.muteBtn.classList.remove('hidden');
    this.loadLevel(0);
  }

  // ---- level management -----------------------------------------------------

  loadLevel(index) {
    // Tear down previous level. Reset the airstrike BEFORE the physics world is
    // recreated so any in-flight bombs release their (soon-invalid) bodies first.
    this.airstrike.reset();
    for (const b of this.blocks) this.renderer.remove(b.mesh);
    for (const b of this.balls) this.renderer.remove(b.mesh);
    this.blocks = [];
    this.balls = [];

    const level = LEVELS[index];
    // Size the table to the tower's base and frame the camera to fit it all.
    const { platform, maxY } = this._computeBounds(level);
    this._bounds = { maxY, hx: Math.max(platform.hx, platform.hz) };
    this.physics.reset(platform, level.spin || 0);
    this.renderer.setPlatform(platform);

    this.levelIndex = index;
    this.shots = 0;
    this.airstrikesLeft = level.airstrikes;
    this.state = 'playing';
    this._impactMuteUntil = performance.now() + 500; // let the stack settle quietly

    for (const spec of level.blocks) this._spawnBlock(spec);

    this._camBase.copy(this.renderer.frameScene({ ...platform, maxY }));

    this.ui.winScreen.classList.add('hidden');
    this.ui.level.textContent = index + 1;
    this.ui.par.textContent = level.par;
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
        const e = new THREE.Euler(...spec.rot);
        const q = new THREE.Quaternion().setFromEuler(e);
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
    const origin = ray.origin.clone().add(ray.direction.clone().multiplyScalar(1.2));
    const speed = 34;
    const vel = ray.direction.clone().multiplyScalar(speed);

    const body = this.physics.addBall({ x: origin.x, y: origin.y, z: origin.z }, { x: vel.x, y: vel.y, z: vel.z });
    const mesh = this.renderer.makeBall(0.38);
    this.balls.push({ body, mesh, life: 0 });

    // Cap concurrent balls.
    while (this.balls.length > MAX_BALLS) {
      const old = this.balls.shift();
      this.physics.remove(old.body);
      this.renderer.remove(old.mesh);
    }

    this.shots++;
    this._updateHud();
    this._flash(clientX, clientY);
    this._kick(0.18);
    this.audio.fire();
  }

  _callAirstrike() {
    if (this.state !== 'playing' || this.airstrikesLeft <= 0 || this.airstrike.active) return;
    this.audio.click();
    const live = this.blocks.filter((b) => !b.cleared).map((b) => b.body);
    if (!this.airstrike.launch(live, this._bounds)) return;
    this.airstrikesLeft--;
    this.shots += 2; // powerful, so it carries a scoring cost
    this._updateHud();
  }

  // ---- main loop ------------------------------------------------------------

  _frame(t) {
    requestAnimationFrame((tt) => this._frame(tt));
    this._frames = (this._frames || 0) + 1;
    if (!this._last) this._last = t;
    let dt = (t - this._last) / 1000;
    this._last = t;
    if (dt > 0.1) dt = 0.1; // avoid spiral of death after tab switch

    if (this.state !== 'menu') {
      this._accum += dt;
      let steps = 0;
      while (this._accum >= FIXED && steps < 5) {
        this.physics.step();
        this._accum -= FIXED;
        steps++;
      }
      this._sync(dt);
      // Keep the table mesh aligned with the (possibly spinning) physics platform.
      if (this.renderer.platform) this.renderer.platform.rotation.y = this.physics.platformAngle;
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
    // Win when every block has been knocked off the platform.
    const remaining = this.blocks.filter((b) => !b.cleared).length;
    if (remaining > 0) return;
    // Don't declare victory mid-airstrike unless it's the completion callback.
    if (this.airstrike.busy && !force) return;
    this._win();
  }

  _win() {
    this.state = 'won';
    this.audio.win();
    const level = LEVELS[this.levelIndex];
    const stars = this._stars(this.shots, level.par);
    this.ui.winShots.textContent = this.shots;
    this.ui.winPar.textContent = level.par;
    const starEls = this.ui.stars.querySelectorAll('.star');
    starEls.forEach((s, i) => s.classList.toggle('on', i < stars));
    setTimeout(() => this.ui.winScreen.classList.remove('hidden'), 700);
  }

  _stars(shots, par) {
    if (shots <= par) return 3;
    if (shots <= par + 2) return 2;
    return 1;
  }

  // ---- juice ----------------------------------------------------------------

  _updateHud() {
    this.ui.shots.textContent = this.shots;
    this.ui.airstrikeCount.textContent = this.airstrikesLeft;
    this.ui.airstrikeBtn.disabled = this.airstrikesLeft <= 0;
  }

  _flash(x, y) {
    let f = document.querySelector('.flash');
    if (!f) {
      f = document.createElement('div');
      f.className = 'flash';
      document.getElementById('app').appendChild(f);
    }
    f.style.setProperty('--fx', `${x}px`);
    f.style.setProperty('--fy', `${y}px`);
    f.classList.remove('go');
    void f.offsetWidth; // restart animation
    f.classList.add('go');
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
