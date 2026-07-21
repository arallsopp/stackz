import { THREE } from './render.js';

const SHIELD_COLOR = 0xff2bd6;

// A counter-rotating defensive shield: a glowing base ring with several vertical
// arms that orbit the tower, blocking incoming shots at certain angles/times.
// Owns its visuals; delegates the kinematic colliders to Physics. Designed to
// grow into cylindrical sleeves with cut-outs on harder levels (see build()).
export class Shield {
  constructor(renderer, physics) {
    this.renderer = renderer;
    this.physics = physics;
    this.group = null;
  }

  get active() {
    return !!this.group;
  }

  reset() {
    if (this.group) this.renderer.remove(this.group);
    this.group = null;
    this.physics.removeShield();
  }

  // cfg: { radius, height, arms=3, speed } — `speed` (rad/s) is typically
  // opposite the platform spin so the shield counter-rotates.
  build(cfg) {
    this.reset();
    const { radius, height, arms = 3, speed = -0.8 } = cfg;
    this.physics.addShield({ radius, height, arms, spin: speed });

    const mat = new THREE.MeshStandardMaterial({
      color: SHIELD_COLOR,
      emissive: SHIELD_COLOR,
      emissiveIntensity: 0.6,
      metalness: 0.3,
      roughness: 0.35,
    });

    const group = new THREE.Group();
    // Base ring.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.12, 12, 48), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.15;
    group.add(ring);

    // Vertical arms.
    const armH = Math.max(height - 0.3, 0.5);
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.4, armH, 0.4), mat);
      arm.position.set(Math.cos(a) * radius, 0.15 + armH / 2, Math.sin(a) * radius);
      arm.castShadow = true;
      group.add(arm);
    }

    this.renderer.scene.add(group);
    this.group = group;
  }

  update() {
    if (this.group) this.group.rotation.y = this.physics.shieldAngle;
  }
}
