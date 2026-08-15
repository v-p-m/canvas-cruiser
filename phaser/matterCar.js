// The car as a Matter body.
//
// This is the 0.14.0 replacement for `stepCarControls`/`stepCarMotion` in
// game.js, and it is deliberately a *port* rather than a rewrite: the throttle,
// steering, cornering-scrub and drift-grip maths below are the same lines, in
// the same order, with the same constants. What changes hands is integration
// and contact — Matter advances the position and resolves car-to-car impacts,
// which is the thing the hand-rolled `resolveCollision` never did properly.
//
// Keeping the handling identical is what makes the swap testable: a lap time
// that moves is a bug in the port, not a tuning question. Once the port is
// trusted, individual terms can be handed to Matter one at a time (air
// friction, angular damping, restitution) and each one re-measured on its own.
//
// The car is NOT walled in. There are no static bodies at the road edge,
// because the game has never had them — running wide costs you grip and time
// via OFFROAD_DRAG, not a barrier. Adding walls is a gameplay change and does
// not belong in a physics port.

const MATTER_CAR = {
  FRICTION_AIR: 0, // the speed scalar owns drag; Matter must not double it
  DENSITY: 0.002, // tuned so a t-bone shoves but does not launch
  RESTITUTION: 0.2, // arcade-ish nudge, not a billiard-ball bounce
};

// game.js:1656 — same insets, same four corners. Kept as a straight copy
// rather than a shared import (there are no modules on this page) so a
// change to one has to be a conscious change to both.
const WHEEL_INSET_X = 0.36; // of half-width
const WHEEL_INSET_Y = 0.34; // of half-height

function wheelOffRoad(entity, world) {
  const cos = Math.cos(entity.angle);
  const sin = Math.sin(entity.angle);
  const hw = (entity.width / 2) * WHEEL_INSET_X * 2;
  const hh = (entity.height / 2) * WHEEL_INSET_Y * 2;

  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const lx = i & 1 ? hw : -hw;
    const ly = i & 2 ? hh : -hh;
    sum += world.offRoad(
      entity.x + lx * cos - ly * sin,
      entity.y + lx * sin + ly * cos,
    );
  }
  return sum / 4;
}

const MatterCar = {
  // Matter's own damping would fight the `friction`/`OFFROAD_DRAG` terms below
  // and make the sliders lie, so the body is created inert and this file does
  // all of the forcing.
  // `angle` is the grid's, in the game's convention (0 = north): the field has
  // to be pointing down the road from frame zero, before step() has run once.
  create(scene, x, y, w, h, angle = 0) {
    const body = scene.matter.add.rectangle(x, y, w, h, {
      angle,
      frictionAir: MATTER_CAR.FRICTION_AIR,
      density: MATTER_CAR.DENSITY,
      restitution: MATTER_CAR.RESTITUTION,
      // A car spun by a hit and left spinning is unrecoverable with a steering
      // model that writes `angle` outright, so rotation stays ours.
      inertia: Infinity,
    });
    return body;
  },

  // `entity` carries the same stats `applyCarStats()` fills in — acceleration,
  // maxSpeed, turnSpeed, driftGrip, friction — so the player and the AI go
  // through this with the same code, exactly as CLAUDE.md requires.
  step(body, entity, input, delta, world) {
    // --- throttle (stepCarControls) ---
    if (input.rollOut) {
      const drop = entity.acceleration * delta;
      entity.speed =
        Math.abs(entity.speed) <= drop
          ? 0
          : entity.speed - Math.sign(entity.speed) * drop;
    } else if (input.accel)
      entity.speed += entity.acceleration * Rain.accelScale() * delta;
    else if (input.brake) entity.speed -= entity.acceleration * delta;
    else entity.speed *= Math.pow(entity.friction + Rain.frictionBonus(), delta);

    if (entity.speed > entity.maxSpeed) entity.speed = entity.maxSpeed;
    if (entity.speed < -entity.maxSpeed / 2) entity.speed = -entity.maxSpeed / 2;
    if (!input.accel && !input.brake && Math.abs(entity.speed) < 0.01)
      entity.speed = 0;

    // --- steering (stepCarControls) ---
    const flip = entity.speed >= 0 ? 1 : -1;
    if (input.left) entity.angle -= entity.turnSpeed * flip * delta;
    if (input.right) entity.angle += entity.turnSpeed * flip * delta;

    if (entity.speed !== 0 && (input.left || input.right)) {
      const scrubFactor =
        0.94 + 0.04 * (1 - Math.abs(entity.speed) / entity.maxSpeed);
      entity.speed *= Math.pow(scrubFactor, delta);
    }

    // --- grip (stepCarMotion) ---
    // A collision leaves Matter's velocity pointing somewhere the throttle
    // never asked for; reading it back here is what lets an impact actually
    // push the car off line instead of being overwritten next frame.
    const targetVx = Math.sin(entity.angle) * entity.speed;
    const targetVy = -Math.cos(entity.angle) * entity.speed;
    const grip =
      entity.driftGrip * Rain.gripScale() * Rain.puddleGripAt(entity);

    const vx = body.velocity.x + (targetVx - body.velocity.x) * grip * delta;
    const vy = body.velocity.y + (targetVy - body.velocity.y) * grip * delta;

    const M = Phaser.Physics.Matter.Matter;
    M.Body.setVelocity(body, { x: vx, y: vy });
    M.Body.setAngle(body, entity.angle);

    // --- off-road drag (stepCarMotion) ---
    // The legacy loop's wheelOffRoad() (game.js:1659), verbatim — a single
    // centre-point sample here measured 0% of frames over the wheel-clip
    // threshold against the legacy loop's 1.6%, for the same AI line on the
    // same circuit, and cost ~3% of a lap: a car clipping the grass with one
    // wheel while its centre is still on tarmac paid nothing. Sampled from
    // the same blurred road field the artwork is painted from either way, so
    // the physics still cannot disagree with what the player can see.
    const offRoad = world ? wheelOffRoad(entity, world) : 0;
    if (offRoad > 0)
      entity.speed *= Math.pow(1 - MatterCar.OFFROAD_DRAG * offRoad, delta);

    // The entity stays the source of truth for everything downstream — laps,
    // standings, skid marks and the sprite all read x/y/angle, and none of them
    // should have to know a Matter body exists.
    entity.x = body.position.x;
    entity.y = body.position.y;
    entity.velocityX = body.velocity.x;
    entity.velocityY = body.velocity.y;
  },

  OFFROAD_DRAG: 0.08, // fraction of speed shed per frame, fully off the road
};
