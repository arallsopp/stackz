import RAPIER from '@dimforge/rapier3d-compat';

// Collision group for hinge posts + kicker arms: membership bit 1, filter = all
// EXCEPT bit 1. So these jointed parts don't collide with EACH OTHER (a jointed
// pair overlaps at the hinge, and that penetration otherwise jams the joint solid)
// but still collide with everything else — blocks, balls, pins.
export const GROUP_MECH = 0x0002fffd;

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
    this.mountBodies = []; // kinematic frames that ride the turntable
    this._addPlatform(platform, spin);
  }

  // A counter-rotating shield: `arms` vertical bars orbiting the tower (well
  // outside it) on one kinematic body, so incoming shots are blocked at certain
  // angles/times. Arms rise from `ringY` (below the table) to `top`, at the wide
  // `radius`. `spin` (rad/s, opposite the platform and slower) sets the rate.
  addShield({ radius, top, ringY = -1.4, arms = 3, spin = -0.5, width = 0.22 }) {
    const body = this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
    const armH = Math.max(top - ringY, 0.5);
    const y = ringY + armH / 2;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2;
      const col = RAPIER.ColliderDesc.cuboid(width, armH / 2, width)
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

  _addPlatform({ hx, hy, hz, tilt = 0, hole = null }, spin) {
    // Spinning tables are kinematic (position-based) so contacts impart the
    // turntable's surface velocity to the blocks resting on it.
    const desc = spin ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.fixed();
    if (tilt) {
      // Rigidly rotate the flat table about the world origin (its top-face centre)
      // by `tilt` about Z -> a SLOPING base. (Tilt levels don't spin.) The blocks
      // are rotated by the same amount in game.js so they load in contact.
      desc.setTranslation(hy * Math.sin(tilt), -hy * Math.cos(tilt), 0)
        .setRotation({ x: 0, y: 0, z: Math.sin(tilt / 2), w: Math.cos(tilt / 2) });
    } else {
      desc.setTranslation(0, -hy, 0);
    }
    const body = this.world.createRigidBody(desc);
    if (hole) {
      // A ring table: 4 walls around a central hole (open to the void), so pieces
      // knocked inward drop through and are cleared. Colliders offset from the body.
      const wx = (hx - hole.hx) / 2, wz = (hz - hole.hz) / 2;
      const walls = [
        [wx, hz, -(hx + hole.hx) / 2, 0], // left
        [wx, hz, (hx + hole.hx) / 2, 0], // right
        [hole.hx, wz, 0, -(hz + hole.hz) / 2], // front
        [hole.hx, wz, 0, (hz + hole.hz) / 2], // back
      ];
      for (const [whx, whz, cx, cz] of walls) {
        const col = RAPIER.ColliderDesc.cuboid(whx, hy, whz)
          .setTranslation(cx, 0, cz)
          .setFriction(0.95)
          .setRestitution(0.0);
        this.world.createCollider(col, body);
      }
    } else {
      // Extra friction so the structure grips the turntable instead of sliding.
      const colDesc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.95).setRestitution(0.0);
      this.world.createCollider(colDesc, body);
    }
    this.platformBody = body;
  }

  // A fixed (immovable) box — a hinge post / anchor for pivots. In GROUP_MECH so
  // it won't collide with (and jam) the arm jointed to it.
  addFixedBox(pos, half, quat) {
    const desc = RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z);
    if (quat) desc.setRotation(quat);
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setFriction(0.8)
      .setRestitution(0.1)
      .setCollisionGroups(GROUP_MECH);
    this.world.createCollider(col, body);
    return body;
  }

  // A box MOUNTED to the turntable: a kinematic body that orbits + spins with the
  // platform, so a rigid frame (a hinge post/bar) rides the spinning table instead
  // of standing still while the loose blocks slide out from under it. Spawned at
  // its real (already-orbited) start transform to avoid a first-step teleport.
  addMountBox(pos, half, quat) {
    const a = this.platformAngle || 0;
    const t = this._orbit(pos, a);
    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(t.x, t.y, t.z)
      .setRotation(this._spinQuat(a, quat));
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cuboid(half.x, half.y, half.z)
      .setFriction(0.9)
      .setRestitution(0.1)
      .setCollisionGroups(GROUP_MECH);
    this.world.createCollider(col, body);
    this.mountBodies.push({ body, pos: { x: pos.x, y: pos.y, z: pos.z }, quat: quat || { x: 0, y: 0, z: 0, w: 1 } });
    return body;
  }

  _orbit(p, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return { x: p.x * c + p.z * s, y: p.y, z: -p.x * s + p.z * c };
  }
  _spinQuat(a, q) {
    return this._qmul({ x: 0, y: Math.sin(a / 2), z: 0, w: Math.cos(a / 2) }, q || { x: 0, y: 0, z: 0, w: 1 });
  }
  _qmul(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  }

  // Hinge `armBody` to `anchorBody` with a revolute (single-axis) joint at
  // `worldAnchor`, rotating about `worldAxis`. Gravity then swings the arm — a
  // "boot on a knee" that kicks blocks when its cocking pin is knocked away.
  linkRevolute(armBody, anchorBody, worldAnchor, worldAxis) {
    const a1 = this._localPoint(anchorBody, worldAnchor);
    const a2 = this._localPoint(armBody, worldAnchor);
    const ax = this._localDir(anchorBody, worldAxis);
    const params = RAPIER.JointData.revolute(a1, a2, ax);
    return this.world.createImpulseJoint(params, anchorBody, armBody, true);
  }

  // Rotate vector v by quaternion q (x,y,z,w) — no THREE dependency here.
  _qrot(v, q) {
    const { x, y, z, w } = q;
    const tx = 2 * (y * v.z - z * v.y);
    const ty = 2 * (z * v.x - x * v.z);
    const tz = 2 * (x * v.y - y * v.x);
    return { x: v.x + w * tx + (y * tz - z * ty), y: v.y + w * ty + (z * tx - x * tz), z: v.z + w * tz + (x * ty - y * tx) };
  }
  // World point -> body-local frame (inverse of the body's transform).
  _localPoint(body, w) {
    const t = body.translation(), r = body.rotation();
    return this._qrot({ x: w.x - t.x, y: w.y - t.y, z: w.z - t.z }, { x: -r.x, y: -r.y, z: -r.z, w: r.w });
  }
  // World direction -> body-local frame (rotation only).
  _localDir(body, d) {
    const r = body.rotation();
    return this._qrot(d, { x: -r.x, y: -r.y, z: -r.z, w: r.w });
  }

  // Create a dynamic box. Returns the rigid body. `group` sets collision groups
  // (e.g. GROUP_MECH for a hinged kicker arm so it won't jam against its post).
  addBox(pos, halfExtents, quat, { density = 1, friction = 0.7, restitution = 0.05, group } = {}) {
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z);
    if (quat) desc.setRotation(quat);
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setDensity(density)
      .setFriction(friction)
      .setRestitution(restitution)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS);
    if (group != null) col.setCollisionGroups(group);
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

  // A dynamic spherical block (a target you knock off the table). Local sphere,
  // so rotation is irrelevant. A touch of angular damping so it settles.
  addSphere(pos, radius, { density = 1, friction = 0.5, restitution = 0.1 } = {}) {
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pos.x, pos.y, pos.z)
      .setAngularDamping(0.15);
    const body = this.world.createRigidBody(desc);
    const col = RAPIER.ColliderDesc.ball(radius)
      .setDensity(density)
      .setFriction(friction)
      .setRestitution(restitution)
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
    // Carry any mounted frames around with the turntable (orbit + spin in sync).
    for (const m of this.mountBodies) {
      m.body.setNextKinematicTranslation(this._orbit(m.pos, this.platformAngle));
      m.body.setNextKinematicRotation(this._spinQuat(this.platformAngle, m.quat));
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
