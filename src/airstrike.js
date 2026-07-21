import { THREE } from './render.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// The C-130 Hercules flies over and air-drops a crate of 5 supply balls, which
// parachute down into the level and then fly up to top up your ball counter — a
// resupply, not a bombing run (so it no longer voids your score). Uses a real
// low-poly glTF model when available (slava2019, CC-BY-4.0), falling back to a
// hand-drawn cartoon sprite if the model fails to load.
export class Airstrike {
  constructor(renderer, physics) {
    this.renderer = renderer;
    this.physics = physics;
    this.plane = null;
    this.active = false;
    this.supplies = [];
    this.props = [];
    this.onSupply = null; // (worldPos) => game delivers +1 ball to the HUD counter
    this.onComplete = null;
    this._planeTex = null;
    this._propTex = null;
    this.template = null; // normalised glTF model, reused per run
    this._planeHalfH = 1;
    this._maxSupplies = 5;
  }

  // Load + normalise the glTF C-130 so the nose points along the holder's -Z and
  // the tail fin points +Y (up). The outer `template` is then steered each frame
  // with lookAt() so the nose follows the flight path. Robust to the model's
  // native orientation: it locates the tail-fin tip (highest vertex) to identify
  // the fuselage axis and the nose direction, rather than assuming the longest
  // axis is the fuselage (for a plane the longest horizontal is the wingspan).
  // Safe to await; on failure we keep the cartoon sprite.
  async loadModel(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    const model = gltf.scene;
    model.updateMatrixWorld(true);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
      }
    });

    const box = new THREE.Box3().setFromObject(model);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Highest world-space vertex ≈ the tail-fin tip (at the BACK of the fuselage).
    const fin = new THREE.Vector3(0, -Infinity, 0);
    const v = new THREE.Vector3();
    model.traverse((o) => {
      if (!o.isMesh) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        if (v.y > fin.y) fin.copy(v);
      }
    });

    // Fuselage = the horizontal axis the tail fin sits at the end of.
    const rx = Math.abs(fin.x - center.x) / (size.x / 2 || 1);
    const rz = Math.abs(fin.z - center.z) / (size.z / 2 || 1);
    // Rotate about Y so the nose (opposite the fin) points toward -Z.
    let yaw;
    if (rx >= rz) {
      // Fuselage along X; fin at -X ⇒ nose at +X ⇒ map +X→-Z (yaw +90°), else -90°.
      yaw = fin.x < center.x ? Math.PI / 2 : -Math.PI / 2;
    } else {
      // Fuselage along Z; fin at -Z ⇒ nose at +Z ⇒ rotate 180°, else already correct.
      yaw = fin.z < center.z ? Math.PI : 0;
    }

    const holder = new THREE.Group();
    model.position.sub(center);
    holder.add(model);
    holder.rotation.y = yaw;
    holder.scale.setScalar(5.5 / Math.max(size.x, size.z));
    holder.updateMatrixWorld(true);

    // Collider half-extents from the FINAL oriented bounds.
    const fbox = new THREE.Box3().setFromObject(holder);
    const fs = new THREE.Vector3();
    fbox.getSize(fs);
    this._planeHalf = { x: fs.x / 2, y: fs.y / 2, z: fs.z / 2 };
    this._planeHalfH = fs.y / 2;

    const template = new THREE.Group();
    template.add(holder);
    this.template = template;
    // lookAt() aims the holder's local -Z at the target. The model's nose ended up
    // along +Z after the orientation fix above, so aim -Z BEHIND the plane (against
    // the tangent) to swing the nose forward along the flight path.
    this._noseSign = -1;
    return true;
  }

  get busy() {
    return this.active || this.supplies.length > 0;
  }

  reset() {
    this.audio?.stopDrone();
    this._removePlane();
    this.physics.removePlaneCollider();
    this._collider = null;
    for (const s of this.supplies) {
      this.physics.remove(s.body);
      this.renderer.remove(s.ball);
      this.renderer.remove(s.canopy);
    }
    this.supplies = [];
    this.props = [];
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

  // The model is a single instance reused each run (only one plane flies at a
  // time), so removal must NOT dispose its shared geometry/materials.
  _removePlane() {
    if (!this.plane) return;
    if (this.plane === this.template) this.renderer.scene.remove(this.plane);
    else this.renderer.remove(this.plane); // sprite fallback: dispose its resources
    this.plane = null;
  }

  _buildPlaneSprite(Wp) {
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

  // Launch a resupply run. `bounds` = { maxY, hx } from the current level. The
  // plane enters over the camera, flies away over the target dropping the crate,
  // loops in the background, then returns over the camera and exits.
  launch(bodies, bounds = { maxY: 4, hx: 2 }) {
    if (this.active) return false;
    const Wp = 3.8;
    this.props = [];
    this.plane = this.template || this._buildPlaneSprite(Wp);

    const cam = this.renderer.camera.position;
    const camY = cam.y;
    const camZ = cam.z;
    const top = this.renderer.viewTopY ?? bounds.maxY + 2;
    const halfH = this.template ? this._planeHalfH : Wp / 4;
    // Bomb-run altitude: clears a normal tower (bombs do the work); the collider
    // only knocks blocks/debris that poke up into the flight path.
    const dropY = Math.min(bounds.maxY + 1.3, top - halfH - 0.2);

    const V = THREE.Vector3;
    const pts = [
      new V(0, camY + 3.5, camZ + 6), // behind/above camera (enters over the top)
      new V(0, dropY + 0.8, camZ * 0.45), // crests into view, top-middle, nose away
      new V(0, dropY, -0.6), // fairly level pass over the target (drop)
      new V(0, dropY + 0.8, -camZ * 0.7), // gentle climb away into the background
      new V(camZ * 0.6, dropY + 2.5, -camZ * 1.1), // far-background loop apex
      new V(camZ * 0.55, dropY + 1.5, -camZ * 0.05), // returning down the side
      new V(camZ * 0.22, camY + 1.2, camZ * 0.6), // back over the camera (nose toward us)
      new V(camZ * 0.06, camY + 3.5, camZ + 7), // exits up and behind
    ];
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this._speed = this.curve.getLength() / 6.0;
    this._u = 0;
    this._duration = 6.0;
    // Air-drop the 5-crate resupply, staggered, during the low pass over the target.
    this._supplyCount = 0;
    this._supplyTimer = 0;

    this.renderer.scene.add(this.plane);

    this.audio?.startDrone();
    this.active = true;
    return true;
  }

  // A parachuting supply ball: a glowing sphere under a neon canopy.
  _spawnSupply() {
    const p = this.plane.position;
    const spread = 2.6;
    const tx = (Math.random() - 0.5) * spread;
    const tz = (Math.random() - 0.5) * spread;
    const body = this.physics.addParachute({ x: p.x, y: p.y - 1.2, z: p.z }, 0.3);
    // Drift toward the footprint so crates land in the level, not off the side.
    body.setLinvel({ x: (tx - p.x) * 0.25, y: -1.5, z: (tz - p.z) * 0.25 }, true);

    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 12),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x12f7ff, emissiveIntensity: 1.4, metalness: 0.2, roughness: 0.3 })
    );
    ball.castShadow = true;
    const canopy = new THREE.Mesh(
      new THREE.ConeGeometry(0.62, 0.55, 12, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xff2bd6, emissive: 0xff2bd6, emissiveIntensity: 0.7, metalness: 0.1, roughness: 0.5, side: THREE.DoubleSide })
    );
    this.renderer.scene.add(ball);
    this.renderer.scene.add(canopy);
    this.supplies.push({ body, ball, canopy, life: 0, delivered: false });
    this.audio?.bombDrop();
  }

  // Hand off one landed crate to the game (which flies +1 up to the ball counter),
  // then clear its physics body + meshes.
  _deliver(s) {
    s.delivered = true;
    const t = s.body.translation();
    this.onSupply?.(new THREE.Vector3(t.x, Math.max(t.y, 0.5), t.z));
    this.physics.remove(s.body);
    this.renderer.remove(s.ball);
    this.renderer.remove(s.canopy);
  }

  update(dt) {
    if (this.active && this.plane) {
      this._u += dt / this._duration;
      const u = Math.min(this._u, 1);
      const pos = this.curve.getPointAt(u, (this._pv ||= new THREE.Vector3()));
      const tan = this.curve.getTangentAt(u, (this._tv ||= new THREE.Vector3()));
      this.plane.position.copy(pos);
      if (this.template) {
        // Point the nose along the flight tangent (lookAt aims local -Z).
        const look = (this._lv ||= new THREE.Vector3()).copy(pos).addScaledVector(tan, this._noseSign);
        this.plane.lookAt(look);
      } else {
        this.plane.quaternion.copy(this.renderer.camera.quaternion); // sprite: face camera
      }
      for (const prop of this.props) prop.rotation.z -= dt * 34;

      // Air-drop the crate, one crate every ~0.14s, across the low pass.
      if (u > 0.28 && this._supplyCount < this._maxSupplies) {
        this._supplyTimer -= dt;
        if (this._supplyTimer <= 0) {
          this._spawnSupply();
          this._supplyCount++;
          this._supplyTimer = 0.14;
        }
      }

      if (this._u >= 1) {
        this._removePlane();
        this.active = false;
        this.audio?.stopDrone();
      }
    }

    // Parachuting crates: descend, then deliver when landed (or after a timeout).
    for (let i = this.supplies.length - 1; i >= 0; i--) {
      const s = this.supplies[i];
      s.life += dt;
      const t = s.body.translation();
      s.ball.position.set(t.x, t.y, t.z);
      s.canopy.position.set(t.x, t.y + 0.78, t.z);
      const v = s.body.linvel();
      const settled = t.y < 0.75 && Math.hypot(v.x, v.y, v.z) < 1.3;
      if (!s.delivered && (settled || s.life > 5)) {
        this._deliver(s);
        this.supplies.splice(i, 1);
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
