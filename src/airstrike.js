import { THREE } from './render.js';

// The comedic payoff: a cartoon C-130 Hercules flies over and carpet-bombs the
// stack. The plane is drawn as a camouflaged cartoon sprite (angry eyes, red
// trim, spinning props) on a billboard — matching the classic cartoon look.
export class Airstrike {
  constructor(renderer, physics) {
    this.renderer = renderer;
    this.physics = physics;
    this.plane = null;
    this.active = false;
    this.bombs = [];
    this.explosions = [];
    this.props = [];
    this.onDetonate = null;
    this.onComplete = null;
    this._planeTex = null;
    this._propTex = null;
  }

  get busy() {
    return this.active || this.bombs.length > 0 || this.explosions.length > 0;
  }

  reset() {
    this.audio?.stopDrone();
    if (this.plane) this.renderer.remove(this.plane);
    this.plane = null;
    for (const b of this.bombs) {
      this.physics.remove(b.body);
      this.renderer.remove(b.mesh);
    }
    for (const e of this.explosions) {
      this.renderer.remove(e.mesh);
      this.renderer.scene.remove(e.light);
    }
    this.bombs = [];
    this.explosions = [];
    this.props = [];
    this.targets = [];
    this.active = false;
    this._wasBusy = false;
  }

  // ---- cartoon plane sprite -------------------------------------------------

  _planeTexture() {
    if (this._planeTex) return this._planeTex;
    const W = 1024;
    const H = 512;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');

    const camoBase = '#5c6e33';
    const camoDark = '#36461d';
    const camoBrown = '#5a4126';
    const outline = '#161810';

    g.lineJoin = 'round';
    g.lineCap = 'round';

    // --- high wing (drawn behind fuselage), swept back toward the tail (left) ---
    g.save();
    g.beginPath();
    g.moveTo(250, 208);
    g.lineTo(792, 190);
    g.lineTo(812, 224);
    g.lineTo(276, 244);
    g.closePath();
    g.fillStyle = camoDark;
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = outline;
    g.stroke();
    g.restore();

    // --- engine nacelles hanging under the wing, props facing forward (right) ---
    this._engineFronts = [];
    const nacY = 250;
    for (const ex of [360, 476, 592, 708]) {
      g.save();
      roundRect(g, ex - 40, nacY - 18, 84, 36, 16);
      g.fillStyle = camoBase;
      g.fill();
      g.lineWidth = 7;
      g.strokeStyle = outline;
      g.stroke();
      // spinner hub
      g.beginPath();
      g.ellipse(ex + 46, nacY, 10, 15, 0, 0, Math.PI * 2);
      g.fillStyle = '#20240f';
      g.fill();
      g.restore();
      this._engineFronts.push({ u: (ex + 52) / W, v: nacY / H });
    }

    // --- fuselage body ---
    const cx = 540;
    const cy = 300;
    g.save();
    // body silhouette: long ellipse + upswept tail wedge
    g.beginPath();
    g.ellipse(cx, cy, 420, 92, 0, 0, Math.PI * 2);
    // tail boom kicking up to the left
    g.moveTo(180, cy - 40);
    g.lineTo(150, cy - 96);
    g.lineTo(96, cy - 92);
    g.lineTo(150, cy + 30);
    g.closePath();
    g.fillStyle = camoBase;
    g.fill();

    // camo patches (clipped to the body ellipse)
    g.save();
    g.beginPath();
    g.ellipse(cx, cy, 420, 92, 0, 0, Math.PI * 2);
    g.clip();
    const blobs = [
      [360, 270, 70, 40, camoDark],
      [520, 320, 90, 46, camoBrown],
      [660, 268, 80, 42, camoDark],
      [780, 315, 70, 40, camoBrown],
      [430, 340, 60, 34, camoDark],
      [880, 292, 55, 44, camoDark],
      [250, 300, 60, 40, camoBrown],
    ];
    for (const [bx, by, rx, ry, col] of blobs) {
      g.beginPath();
      g.ellipse(bx, by, rx, ry, 0, 0, Math.PI * 2);
      g.fillStyle = col;
      g.fill();
    }
    // belly shading
    g.beginPath();
    g.ellipse(cx, cy + 78, 420, 70, 0, 0, Math.PI * 2);
    g.fillStyle = 'rgba(0,0,0,0.28)';
    g.fill();
    g.restore();

    // body outline
    g.beginPath();
    g.ellipse(cx, cy, 420, 92, 0, 0, Math.PI * 2);
    g.lineWidth = 9;
    g.strokeStyle = outline;
    g.stroke();
    g.restore();

    // --- red cheat line along the upper fuselage ---
    g.beginPath();
    g.moveTo(240, cy - 6);
    g.lineTo(900, cy - 20);
    g.lineWidth = 9;
    g.strokeStyle = '#e23b4e';
    g.stroke();

    // --- black radome nose (right) ---
    g.beginPath();
    g.ellipse(930, cy + 6, 42, 52, 0, 0, Math.PI * 2);
    g.fillStyle = '#181a10';
    g.fill();

    // --- vertical tail fin (left) with Indonesian flag ---
    g.save();
    g.beginPath();
    g.moveTo(150, cy - 70);
    g.lineTo(112, cy - 168);
    g.lineTo(70, cy - 150);
    g.lineTo(120, cy - 40);
    g.closePath();
    g.fillStyle = camoBase;
    g.fill();
    g.lineWidth = 8;
    g.strokeStyle = outline;
    g.stroke();
    // flag: red over white
    g.fillStyle = '#e23b4e';
    g.fillRect(96, cy - 150, 40, 15);
    g.fillStyle = '#f4f4f0';
    g.fillRect(96, cy - 135, 40, 15);
    g.restore();
    // horizontal stabiliser
    g.beginPath();
    roundRect(g, 96, cy - 66, 96, 20, 8);
    g.fillStyle = camoDark;
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = outline;
    g.stroke();

    // --- angry cartoon eyes near the nose (right) ---
    for (const [ex, ey] of [[812, 268], [872, 280]]) {
      g.beginPath();
      g.ellipse(ex, ey, 30, 34, 0, 0, Math.PI * 2);
      g.fillStyle = '#f6f6f0';
      g.fill();
      g.lineWidth = 5;
      g.strokeStyle = outline;
      g.stroke();
      // pupil looking forward-down
      g.beginPath();
      g.arc(ex + 12, ey + 12, 12, 0, Math.PI * 2);
      g.fillStyle = '#121208';
      g.fill();
    }
    // angry eyebrows (thick, slanting down toward the nose)
    g.lineWidth = 13;
    g.strokeStyle = outline;
    g.beginPath();
    g.moveTo(786, 232);
    g.lineTo(842, 252);
    g.stroke();
    g.beginPath();
    g.moveTo(852, 246);
    g.lineTo(906, 268);
    g.stroke();

    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    this._planeTex = tex;
    return tex;
  }

  _propTexture() {
    if (this._propTex) return this._propTex;
    const S = 128;
    const c = document.createElement('canvas');
    c.width = S;
    c.height = S;
    const g = c.getContext('2d');
    g.translate(S / 2, S / 2);
    // faint motion-blur disc
    g.beginPath();
    g.arc(0, 0, 58, 0, Math.PI * 2);
    g.fillStyle = 'rgba(180,190,200,0.12)';
    g.fill();
    // three blades
    g.fillStyle = 'rgba(25,28,15,0.85)';
    for (let i = 0; i < 3; i++) {
      g.save();
      g.rotate((i * Math.PI * 2) / 3);
      g.beginPath();
      g.ellipse(0, -34, 7, 30, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
    // hub
    g.beginPath();
    g.arc(0, 0, 9, 0, Math.PI * 2);
    g.fillStyle = '#2a2e14';
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    this._propTex = tex;
    return tex;
  }

  _buildPlane(Wp) {
    const Hp = Wp / 2;
    const group = new THREE.Group();

    const tex = this._planeTexture();
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const body = new THREE.Mesh(new THREE.PlaneGeometry(Wp, Hp), mat);
    group.add(body);

    // Spinning props positioned over the engine fronts recorded during drawing.
    this.props = [];
    const propSize = Wp * 0.17;
    const propMat = new THREE.MeshBasicMaterial({
      map: this._propTexture(),
      transparent: true,
      depthWrite: false,
    });
    for (const e of this._engineFronts) {
      const prop = new THREE.Mesh(new THREE.PlaneGeometry(propSize, propSize), propMat);
      prop.position.set((e.u - 0.5) * Wp, (0.5 - e.v) * Hp, 0.05);
      group.add(prop);
      this.props.push(prop);
    }
    return group;
  }

  // Launch a run over `bodies`. `bounds` = { maxY, hx } from the current level.
  launch(bodies, bounds = { maxY: 4, hx: 2 }) {
    if (this.active) return false;
    this.targets = bodies;
    const Wp = 3.8;
    this.plane = this._buildPlane(Wp);
    // Fly just above the crown, but keep it inside the top of the viewport.
    const top = this.renderer.viewTopY ?? bounds.maxY + 2;
    this._flyY = Math.min(bounds.maxY + 1.2, top - Wp / 4 - 0.2);
    this._dropHalf = bounds.hx + 0.8;
    this.plane.position.set(-9, this._flyY, 0.6);
    this.renderer.scene.add(this.plane);
    this.audio?.startDrone();
    this.active = true;
    this._dropTimer = 0.25;
    this._dropCount = 0;
    this._maxDrops = 8;
    this.speed = 6.5;
    this._t = 0;
    return true;
  }

  _spawnBomb() {
    const p = this.plane.position;
    const body = this.physics.addBall({ x: p.x, y: p.y - 0.6, z: 0 }, { x: 2.5, y: -2, z: 0 }, 0.22);
    const mesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.16, 0.5, 6, 10),
      new THREE.MeshStandardMaterial({
        color: 0xffe45e,
        emissive: 0xff8a3d,
        emissiveIntensity: 0.9,
        metalness: 0.6,
        roughness: 0.3,
      })
    );
    mesh.castShadow = true;
    this.renderer.scene.add(mesh);
    this.bombs.push({ body, mesh, life: 0 });
    this.audio?.bombDrop();
  }

  _detonate(center) {
    this.audio?.explosion();
    this.physics.explode(center, 5.2, 16, this.targets);
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0xffe45e, transparent: true, opacity: 0.9 })
    );
    shell.position.copy(center);
    this.renderer.scene.add(shell);
    const light = new THREE.PointLight(0xffb347, 6, 14, 2);
    light.position.copy(center);
    this.renderer.scene.add(light);
    this.explosions.push({ mesh: shell, light, life: 0, max: 0.55 });
    this.onDetonate?.(center);
  }

  update(dt) {
    if (this.active && this.plane) {
      this._t += dt;
      this.plane.position.x += this.speed * dt;
      this.plane.position.y = this._flyY + Math.sin(this._t * 3) * 0.15;
      for (const prop of this.props) prop.rotation.z -= dt * 34;

      const overTarget = Math.abs(this.plane.position.x) < this._dropHalf;
      this._dropTimer -= dt;
      if (overTarget && this._dropTimer <= 0 && this._dropCount < this._maxDrops) {
        this._spawnBomb();
        this._dropCount++;
        this._dropTimer = 0.13;
      }
      if (this.plane.position.x > 10) {
        this.renderer.remove(this.plane);
        this.plane = null;
        this.active = false;
        this.audio?.stopDrone();
      }
    }

    for (let i = this.bombs.length - 1; i >= 0; i--) {
      const b = this.bombs[i];
      b.life += dt;
      const t = b.body.translation();
      b.mesh.position.set(t.x, t.y, t.z);
      const r = b.body.rotation();
      b.mesh.quaternion.set(r.x, r.y, r.z, r.w);
      if (t.y <= 0.55 || t.y < -3 || b.life > 4) {
        this._detonate(new THREE.Vector3(t.x, Math.max(t.y, 0.4), t.z));
        this.physics.remove(b.body);
        this.renderer.remove(b.mesh);
        this.bombs.splice(i, 1);
      }
    }

    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.life += dt;
      const k = e.life / e.max;
      e.mesh.scale.setScalar(0.4 + k * 5.5);
      e.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
      e.light.intensity = 6 * (1 - k);
      if (e.life >= e.max) {
        this.renderer.remove(e.mesh);
        this.renderer.scene.remove(e.light);
        this.explosions.splice(i, 1);
      }
    }

    if (this._wasBusy && !this.busy) {
      this._wasBusy = false;
      this.onComplete?.();
    }
    if (this.busy) this._wasBusy = true;
  }
}

// Canvas rounded-rectangle path helper.
function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
