import RAPIER from '@dimforge/rapier3d-compat';

// Thin wrapper around a Rapier world tuned for stacked-block demolition.
export class Physics {
  constructor() {
    this.RAPIER = RAPIER;
    this.world = null;
    this.eventQueue = null;
  }

  static async load() {
    await RAPIER.init();
    return new Physics();
  }

  // `platform` = { hx, hy, hz }, sized per level to the tower's base footprint.
  reset(platform) {
    // Rapier worlds are cheap to recreate; do that on every level load.
    this.world = new RAPIER.World({ x: 0, y: -20.0, z: 0 });
    // A stiffer solver keeps tall stacks rock-solid at load.
    this.world.numSolverIterations = 12;
    this.eventQueue = new RAPIER.EventQueue(true);
    this._addPlatform(platform);
  }

  _addPlatform({ hx, hy, hz }) {
    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -hy, 0);
    const body = this.world.createRigidBody(bodyDesc);
    const colDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.9).setRestitution(0.0);
    this.world.createCollider(colDesc, body);
    this.platformBody = body;
  }

  // Create a dynamic box. Returns the rigid body.
  addBox(pos, halfExtents, quat, { density = 1, friction = 0.7, restitution = 0.05 } = {}) {
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z);
    if (quat) desc.setRotation(quat);
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setDensity(density)
      .setFriction(friction)
      .setRestitution(restitution);
    this.world.createCollider(col, body);
    return body;
  }

  // Create a dynamic cylinder (local axis = Y; caller supplies rotation for side-lying logs).
  addCylinder(pos, halfHeight, radius, quat, { density = 1, friction = 0.55, restitution = 0.05 } = {}) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      // A touch of angular damping so logs roll and settle instead of spinning forever.
      .setAngularDamping(0.15);
    if (quat) desc.setRotation(quat);
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cylinder(halfHeight, radius)
      .setDensity(density)
      .setFriction(friction)
      .setRestitution(restitution);
    this.world.createCollider(col, body);
    return body;
  }

  // The player's projectile: a heavy, fast sphere.
  addBall(pos, velocity, radius = 0.38) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinvel(velocity.x, velocity.y, velocity.z)
      .setCcdEnabled(true); // continuous collision so fast balls don't tunnel
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.ball(radius)
      .setDensity(6.0)
      .setFriction(0.4)
      .setRestitution(0.25);
    this.world.createCollider(col, body);
    return body;
  }

  // Radial explosion impulse applied to every dynamic body near `center`.
  explode(center, radius, power, bodies) {
    for (const b of bodies) {
      if (!b || b.isSleeping?.()) b?.wakeUp?.();
      const t = b.translation();
      const dx = t.x - center.x;
      const dy = t.y - center.y;
      const dz = t.z - center.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > radius) continue;
      const falloff = 1 - dist / radius;
      const inv = dist > 0.001 ? 1 / dist : 0;
      // Bias the impulse upward so debris fountains outward and off the platform.
      const mag = power * falloff * b.mass();
      b.applyImpulse(
        { x: dx * inv * mag, y: (dy * inv + 0.9) * mag, z: dz * inv * mag },
        true
      );
      b.applyTorqueImpulse(
        {
          x: (Math.random() - 0.5) * mag * 0.4,
          y: (Math.random() - 0.5) * mag * 0.4,
          z: (Math.random() - 0.5) * mag * 0.4,
        },
        true
      );
    }
  }

  step() {
    this.world.step(this.eventQueue);
  }

  remove(body) {
    if (body && this.world) this.world.removeRigidBody(body);
  }
}
