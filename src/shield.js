import { THREE } from './render.js';

// Grey so it reads as neutral hardware, not a neon target.
const SHIELD_COLOR = 0x9aa0ac;

// A counter-rotating defensive shield: a grey base ring with several vertical
// arms that orbit the tower well OUTSIDE it, blocking incoming shots at certain
// angles/times. It is deliberately much wider than the tower — it must never
// touch the blocks, and there has to be room for knocked-off blocks to fall
// between the base and the ring. The ring itself sits BELOW the table top so
// falling blocks drop past it rather than landing on it. Owns its visuals;
// delegates the kinematic colliders to Physics.
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

  // cfg: { radius, top, ringY, arms=3, speed } — `radius` is the (wide) orbit
  // radius, `ringY` the base-ring height (below the table top, y<0), `top` the
  // height the arms reach. `speed` (rad/s) is opposite the platform spin, and
  // slower, so the shield counter-rotates lazily.
  build(cfg) {
    this.reset();
    const { radius, top, ringY = -1.4, arms = 3, speed = -0.5 } = cfg;
    this.physics.addShield({ radius, top, ringY, arms, spin: speed });

    const mat = new THREE.MeshStandardMaterial({
      color: SHIELD_COLOR,
      emissive: 0x2a2d33,
      emissiveIntensity: 0.4,
      metalness: 0.55,
      roughness: 0.5,
    });

    const group = new THREE.Group();
    // Base ring, low and wide so blocks fall off the table INSIDE it and drop past.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.16, 12, 64), mat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = ringY;
    group.add(ring);

    // Vertical arms rising from the ring up past the tower top.
    const armH = Math.max(top - ringY, 0.5);
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.45, armH, 0.45), mat);
      arm.position.set(Math.cos(a) * radius, ringY + armH / 2, Math.sin(a) * radius);
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
