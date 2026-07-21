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
  // `spin` (rad/s) makes the table a slowly-rotating kinematic turntable that
  // carries the whole structure around via friction.
  reset(platform, spin = 0) {
    // Rapier worlds are cheap to recreate; do that on every level load.
    this.world = new RAPIER.World({ x: 0, y: -20.0, z: 0 });
    // A stiffer solver keeps tall stacks rock-solid at load.
    this.world.numSolverIterations = 12;
    this.eventQueue = new RAPIER.EventQueue(true);
    this.spin = spin;
    this.platformAngle = 0;
    this.planeCollider = null; // stale ref from the previous world
    this.shieldBody = null;
    this.shieldSpin = 0;
    this.shieldAngle = 0;
    this._addPlatform(platform, spin);
  }

  // A counter-rotating shield: `arms` vertical bars orbiting the tower (well
  // outside it) on one kinematic body, so incoming shots are blocked at certain
  // angles/times. Arms rise from `ringY` (below the table) to `top`, at the wide
  // `radius`. `spin` (rad/s, opposite the platform and slower) sets the rate.
  addShield({ radius, top, ringY = -1.4, arms = 3, spin = -0.5 }) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const armH = Math.max(top - ringY, 0.5);
    const y = ringY + armH / 2;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2;
      const col = RAPIER.ColliderDesc.cuboid(0.22, armH / 2, 0.22)
        .setTranslation(Math.cos(a) * radius, y, Math.sin(a) * radius)
        .setRestitution(0.3)
        .setFriction(0.4);
      this.world.createCollider(col, body);
    }
    this.shieldBody = body;
    this.shieldSpin = spin;
    this.shieldAngle = 0;
    return body;
  }

  removeShield() {
    if (this.shieldBody && this.world) this.world.removeRigidBody(this.shieldBody);
    this.shieldBody = null;
    this.shieldSpin = 0;
  }

  // A moving kinematic box the Hercules carries, so it physically shoves any
  // blocks it clips during a low pass. Must spawn at the plane's start position
  // (far from the stack) — spawning at the origin would teleport through the
  // tower on the first step and launch everything into orbit.
  addPlaneCollider(half, pos) {
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pos.x, pos.y, pos.z);
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z);
    this.world.createCollider(col, body);
    this.planeCollider = body;
    return body;
  }

  movePlaneCollider(pos, quat) {
    if (!this.planeCollider) return;
    this.planeCollider.setNextKinematicTranslation(pos);
    this.planeCollider.setNextKinematicRotation(quat);
  }

  removePlaneCollider() {
    if (this.planeCollider && this.world) this.world.removeRigidBody(this.planeCollider);
    this.planeCollider = null;
  }

  _addPlatform({ hx, hy, hz }, spin) {
    // Spinning tables are kinematic (position-based) so contacts impart the
    // turntable's surface velocity to the blocks resting on it.
    const desc = (spin ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed())
      .setTranslation(0, -hy, 0);
    const body = this.world.createRigidBody(desc);
    // Extra friction so the structure grips the turntable instead of sliding.
    const colDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.95).setRestitution(0.0);
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
      .setRestitution(restitution)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
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
      .setRestitution(restitution)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    this.world.createCollider(col, body);
    return body;
  }

  // A supply crate/ball that parachutes down: high linear damping gives it a slow,
  // floaty descent (drag), light + bouncy so it barely disturbs the stack.
  addParachute(pos, radius = 0.3) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setLinearDamping(4.5) // parachute drag -> gentle terminal velocity
      .setAngularDamping(1.5);
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.ball(radius)
      .setDensity(0.5)
      .setFriction(0.6)
      .setRestitution(0.2)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
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
      .setRestitution(0.25)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
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
    // Advance the turntable one fixed tick before solving, so Rapier derives the
    // contact velocity that drags the resting structure around.
    if (this.spin) {
      this.platformAngle += this.spin / 60;
      const a = this.platformAngle * 0.5;
      this.platformBody.setNextKinematicRotation({ x: 0, y: Math.sin(a), z: 0, w: Math.cos(a) });
    }
    if (this.shieldBody) {
      this.shieldAngle += this.shieldSpin / 60;
      const a = this.shieldAngle * 0.5;
      this.shieldBody.setNextKinematicRotation({ x: 0, y: Math.sin(a), z: 0, w: Math.cos(a) });
    }
    this.world.step(this.eventQueue);
    // Turn newly-started contacts into impact events for audio. IMPORTANT: only
    // collect handles inside the drain callback — calling world.getCollider()
    // there re-enters Rapier ("recursive use of an object" / unsafe aliasing).
    // Look the bodies up afterwards, outside the callback.
    if (this.onImpact) {
      const pairs = (this._pairs ||= []);
      pairs.length = 0;
      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        if (started) pairs.push(h1, h2);
      });
      for (let i = 0; i < pairs.length; i += 2) {
        const s = Math.max(this._bodySpeed(pairs[i]), this._bodySpeed(pairs[i + 1]));
        if (s > 1.2) this.onImpact(s);
      }
    }
  }

  _bodySpeed(colliderHandle) {
    const col = this.world.getCollider(colliderHandle);
    const body = col?.parent();
    if (!body) return 0;
    const v = body.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  remove(body) {
    if (body && this.world) this.world.removeRigidBody(body);
  }
}
