import { THREE } from './render.js';

// The comedic payoff: a C-130 Hercules flies over the platform and carpet-bombs
// everything. Built entirely from primitives so it needs no external assets.
export class Airstrike {
  constructor(renderer, physics) {
    this.renderer = renderer;
    this.physics = physics;
    this.plane = null;
    this.active = false;
    this.bombs = [];
    this.explosions = [];
    this.props = [];
    this.onDetonate = null; // (center) => void, for screen shake / flash
    this.onComplete = null;
  }

  get busy() {
    return this.active || this.bombs.length > 0 || this.explosions.length > 0;
  }

  // Tear everything down. MUST be called before the physics world is recreated,
  // otherwise in-flight bombs/targets reference bodies from a destroyed world.
  reset() {
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

  _buildPlane() {
    const g = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({
      color: 0x3a4a5a,
      metalness: 0.7,
      roughness: 0.35,
      emissive: 0x0a1a2a,
      emissiveIntensity: 0.4,
    });
    const accent = new THREE.MeshStandardMaterial({
      color: 0x12f7ff,
      emissive: 0x12f7ff,
      emissiveIntensity: 0.8,
      metalness: 0.4,
      roughness: 0.3,
    });

    // Fuselage (cylinder laid along X).
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 5.2, 20), body);
    fuse.rotation.z = Math.PI / 2;
    g.add(fuse);
    // Nose cone.
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 20), body);
    nose.rotation.z = -Math.PI / 2;
    nose.position.x = 3.1;
    g.add(nose);
    // Tail cone.
    const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.4, 20), body);
    tailCone.rotation.z = Math.PI / 2;
    tailCone.position.x = -3.1;
    g.add(tailCone);

    // High wing.
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.16, 8.4), body);
    wing.position.y = 0.5;
    g.add(wing);
    // Tail plane + vertical fin.
    const stab = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.14, 3.4), body);
    stab.position.set(-2.7, 0.2, 0);
    g.add(stab);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.6, 0.16), accent);
    fin.position.set(-2.8, 0.9, 0);
    g.add(fin);

    // Four turboprop engines with spinning props.
    for (const z of [-2.7, -1.2, 1.2, 2.7]) {
      const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 1.1, 12), body);
      nacelle.rotation.z = Math.PI / 2;
      nacelle.position.set(0.35, 0.42, z);
      g.add(nacelle);

      const hub = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 10), accent);
      hub.rotation.z = -Math.PI / 2;
      hub.position.set(1.0, 0.42, z);
      g.add(hub);

      const prop = new THREE.Group();
      prop.position.set(0.95, 0.42, z);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.4, 0.14), accent);
        blade.rotation.x = (i * Math.PI * 2) / 3;
        prop.add(blade);
      }
      g.add(prop);
      this.props.push(prop);
    }

    // Nav lights.
    const red = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xff2b4d })
    );
    red.position.set(0.5, 0.55, 4.2);
    g.add(red);
    const green = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0x4bffa5 })
    );
    green.position.set(0.5, 0.55, -4.2);
    g.add(green);

    g.scale.setScalar(0.85);
    return g;
  }

  // Launch a run over the target `bodies` (array of live rigid bodies).
  launch(bodies) {
    if (this.active) return false;
    this.targets = bodies;
    this.props = [];
    this.plane = this._buildPlane();
    // Fly left -> right, high over the stack, angled slightly toward camera.
    this.plane.position.set(-22, 10.5, 1.5);
    this.plane.rotation.y = 0;
    this.renderer.scene.add(this.plane);
    this.active = true;
    this._dropTimer = 0;
    this._dropCount = 0;
    this._maxDrops = 7;
    this.speed = 12; // units/sec
    return true;
  }

  _spawnBomb() {
    const p = this.plane.position;
    const body = this.physics.addBall({ x: p.x, y: p.y - 0.4, z: p.z }, { x: 3, y: -2, z: 0 }, 0.22);
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
  }

  _detonate(center) {
    // Physics kick — strong and wide so debris is thrown clear of the platform.
    this.physics.explode(center, 5.2, 16, this.targets);
    // Visual: expanding shell + flash.
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
    // Move the plane and drop its payload.
    if (this.active && this.plane) {
      this.plane.position.x += this.speed * dt;
      for (const prop of this.props) prop.rotation.x += dt * 40;

      // Carpet-bomb while passing over the platform region.
      const overTarget = this.plane.position.x > -5 && this.plane.position.x < 5;
      this._dropTimer -= dt;
      if (overTarget && this._dropTimer <= 0 && this._dropCount < this._maxDrops) {
        this._spawnBomb();
        this._dropCount++;
        this._dropTimer = 0.14;
      }

      if (this.plane.position.x > 24) {
        this.renderer.remove(this.plane);
        this.plane = null;
        this.active = false;
      }
    }

    // Advance bombs; detonate near the deck or on long timeout.
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

    // Fade explosion shells.
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const e = this.explosions[i];
      e.life += dt;
      const k = e.life / e.max;
      const s = 0.4 + k * 5.5;
      e.mesh.scale.setScalar(s);
      e.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
      e.light.intensity = 6 * (1 - k);
      if (e.life >= e.max) {
        this.renderer.remove(e.mesh);
        this.renderer.scene.remove(e.light);
        this.explosions.splice(i, 1);
      }
    }

    // Signal completion once everything has settled.
    if (this._wasBusy && !this.busy) {
      this._wasBusy = false;
      this.onComplete?.();
    }
    if (this.busy) this._wasBusy = true;
  }
}
