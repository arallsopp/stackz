import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

// Owns the Three.js scene, camera, lights and the bloom post pipeline.
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.raycaster = new THREE.Raycaster();
    this._initRenderer();
    this._initScene();
    this._initComposer();
    this._initEnvironment();
    this.resize();
  }

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: window.devicePixelRatio < 2,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05010f);
    this.scene.fog = new THREE.FogExp2(0x05010f, 0.028);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
    this.camera.position.set(0, 4.2, 12.5);
    this.camera.lookAt(0, 1.8, 0);
  }

  _initComposer() {
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.9, 0.6, 0.6);
    this.composer.addPass(this.bloom);
  }

  _initEnvironment() {
    // Key + rim lights for the synthwave mood.
    const ambient = new THREE.AmbientLight(0x2a1a5a, 0.9);
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(6, 14, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 50;
    key.shadow.camera.left = -12;
    key.shadow.camera.right = 12;
    key.shadow.camera.top = 12;
    key.shadow.camera.bottom = -12;
    key.shadow.bias = -0.0004;
    this.scene.add(key);

    const rimA = new THREE.PointLight(0x12f7ff, 0.9, 60);
    rimA.position.set(-10, 3, 6);
    this.scene.add(rimA);
    const rimB = new THREE.PointLight(0xff2bd6, 0.9, 60);
    rimB.position.set(10, 3, 6);
    this.scene.add(rimB);

    // Infinite neon grid floor far below to sell the void the debris falls into.
    const grid = new THREE.GridHelper(200, 100, 0x8a5bff, 0x2a1a5a);
    grid.position.y = -14;
    this.scene.add(grid);

    // Starfield backdrop.
    this._addStars();
  }

  // A hazard-striped tech-plate texture for the table top, so it unmistakably
  // reads as scenery ("don't shoot me") rather than a block. Cached + reused.
  _platformTexture() {
    if (this._platTex) return this._platTex;
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');

    // Base plate.
    g.fillStyle = '#5c616b';
    g.fillRect(0, 0, S, S);

    // Inner panel grid (reads as machined plating).
    g.strokeStyle = 'rgba(20,22,28,0.55)';
    g.lineWidth = 2;
    const step = S / 8;
    for (let i = 1; i < 8; i++) {
      g.beginPath();
      g.moveTo(i * step, 0);
      g.lineTo(i * step, S);
      g.moveTo(0, i * step);
      g.lineTo(S, i * step);
      g.stroke();
    }

    // Diagonal hazard chevrons around the border.
    const band = 30;
    g.save();
    g.beginPath();
    g.rect(0, 0, S, S);
    g.rect(band, band, S - 2 * band, S - 2 * band);
    g.clip('evenodd');
    g.fillStyle = '#20222a';
    g.fillRect(0, 0, S, S);
    g.strokeStyle = '#e6c02e';
    g.lineWidth = 12;
    for (let x = -S; x < S * 2; x += 34) {
      g.beginPath();
      g.moveTo(x, -10);
      g.lineTo(x + S + 20, S + 10);
      g.stroke();
    }
    g.restore();

    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    this._platTex = tex;
    return tex;
  }

  // Build the table (the target surface) sized to the tower's base. Top face y=0.
  // `tilt` (radians about Z) tilts the whole table into a SLOPING base.
  setPlatform({ hx, hy, hz, tilt = 0 }) {
    if (this.platform) this.remove(this.platform);
    this._platformTilt = tilt;
    const g = new THREE.Group();

    // Neutral grey + hazard texture so the base clearly reads as "not part of the
    // level" — players were shooting the table thinking it was a block.
    const topMat = new THREE.MeshStandardMaterial({
      color: 0x8b909a,
      map: this._platformTexture(),
      metalness: 0.2,
      roughness: 0.7,
      emissive: 0x24262c,
      emissiveIntensity: 0.35,
    });
    const top = new THREE.Mesh(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2), topMat);
    top.position.y = -hy;
    top.receiveShadow = true;
    g.add(top);

    // Subtle grey edge so the table rim reads against the dark void (not neon).
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2)),
      new THREE.LineBasicMaterial({ color: 0x9aa0ac })
    );
    edges.position.y = -hy;
    g.add(edges);

    // Four grey legs, inset from the corners, tapering into the void.
    const legMat = new THREE.MeshStandardMaterial({
      color: 0x3a3d45,
      metalness: 0.3,
      roughness: 0.6,
      emissive: 0x141519,
      emissiveIntensity: 0.3,
    });
    const legH = 3.2;
    const inset = 0.35;
    const lx = Math.max(hx - inset, 0.12);
    const lz = Math.max(hz - inset, 0.12);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, legH, 8), legMat);
        leg.position.set(sx * lx, -hy * 2 - legH / 2, sz * lz);
        leg.castShadow = true;
        g.add(leg);
      }
    }

    this.scene.add(g);
    this.platform = g;
    this.updatePlatform(0);
  }

  // Orient the table mesh each frame: spin about Y for turntables, or hold the
  // fixed Z-tilt for sloping-base levels.
  updatePlatform(angle) {
    if (!this.platform) return;
    if (this._platformTilt) this.platform.rotation.set(0, 0, this._platformTilt);
    else this.platform.rotation.set(0, angle, 0);
  }

  _addStars() {
    const N = 600;
    const positions = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 160;
      positions[i * 3 + 1] = Math.random() * 80 - 10;
      positions[i * 3 + 2] = -20 - Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({ color: 0x9ad7ff, size: 0.35, transparent: true, opacity: 0.7 });
    this.scene.add(new THREE.Points(geo, mat));
  }

  // ---- mesh factories -------------------------------------------------------

  _neonMaterial(color) {
    return new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.55,
      metalness: 0.3,
      roughness: 0.35,
    });
  }

  // Grey metallic finish for mechanism parts (hinge posts, kicker arms) so they
  // read as "hardware you use", not neon "targets you must clear".
  _mechanismMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x9aa0ac,
      emissive: 0x2a2d33,
      emissiveIntensity: 0.4,
      metalness: 0.6,
      roughness: 0.45,
    });
  }

  makeBox(size, color, mechanism = false) {
    const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
    const mesh = new THREE.Mesh(geo, mechanism ? this._mechanismMaterial() : this._neonMaterial(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  makeCylinder(radius, height, color, mechanism = false) {
    const geo = new THREE.CylinderGeometry(radius, radius, height, 24);
    const mesh = new THREE.Mesh(geo, mechanism ? this._mechanismMaterial() : this._neonMaterial(color));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  makeBall(radius, color = 0xffffff) {
    const geo = new THREE.SphereGeometry(radius, 20, 16);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: 0x12f7ff,
      emissiveIntensity: 1.4,
      metalness: 0.2,
      roughness: 0.2,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    this.scene.add(mesh);
    return mesh;
  }

  remove(mesh) {
    if (!mesh) return;
    this.scene.remove(mesh);
    mesh.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
  }

  // Project a world point to screen pixels (for flying HUD tokens to overlays).
  toScreen(v) {
    const p = v.clone().project(this.camera);
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
  }

  // First intersection point of the CURRENT pointer ray (set by the preceding
  // pointerRay call) with the given meshes, or null. Lets the game aim a lobbed
  // shot at exactly the block that was tapped.
  raycastPoint(meshes) {
    if (!meshes || !meshes.length) return null;
    const hits = this.raycaster.intersectObjects(meshes, false);
    return hits.length ? hits[0].point.clone() : null;
  }

  // Screen point (clientX/Y) -> normalized ray direction from the camera.
  pointerRay(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.raycaster.ray;
  }

  // Position the camera so the whole table AND the full tower height fit in the
  // (portrait) viewport, so the player can always tell how many blocks remain.
  // Returns the camera base position (for screen-shake to restore to).
  frameScene({ hx, hz, maxY }) {
    this._frame = { hx, hz, maxY };
    const aspect = this.camera.aspect;
    const halfV = Math.tan((this.camera.fov * Math.PI) / 180 / 2);

    // Vertical span: table top through the crown, plus a little headroom.
    const spanY = maxY + 2.0;
    const targetY = maxY * 0.44;
    // Horizontal span: the largest footprint dimension plus margin.
    const spanX = 2 * Math.max(hx, hz) + 1.4;

    const dForHeight = spanY / 2 / halfV;
    const dForWidth = spanX / 2 / (halfV * aspect);
    const dist = Math.max(dForHeight, dForWidth) * 1.06;

    // Gentle, near-eye-level angle (like the original), not looking down.
    this.camera.position.set(0, targetY + dist * 0.2, dist);
    this._target = new THREE.Vector3(0, targetY, 0);
    this.camera.lookAt(this._target);
    // Approx world-Y of the top of the viewport, so the fly-over stays in frame.
    this.viewTopY = targetY + dist * halfV;
    return this.camera.position.clone();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    // Re-fit the current level to the new aspect/orientation.
    if (this._frame) return this.frameScene(this._frame);
    return null;
  }

  render() {
    this.composer.render();
  }
}

export { THREE };
