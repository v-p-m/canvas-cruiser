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

// The collision aftermath. All of it is dormant until phaser/impacts.js sets
// `entity.spin`/`entity.unsettle`, so a lap driven clean costs nothing.
// Kept high enough that the yaw integrates into a real rotation rather than a
// twitch: total swing is roughly rate / (1 - SPIN_DECAY), so 0.95 turns
// Impacts.YAW_MAX into most of a spin and a light knock into a few degrees.
const SPIN_DECAY = 0.95; // of the yaw rate kept per frame
const UNSETTLE_GRIP_LOSS = 0.6; // of grip, at a full-strength hit
const UNSETTLE_FRAMES = 30; // to bleed a full-strength hit back to zero
// Steering authority lost while unsettled. Without this the yaw is symmetric
// on paper and wildly asymmetric in play: the AI's pure-pursuit controller
// counter-steers on the very next frame, exactly and without hesitation, so it
// cancels a spin as soon as the rate falls under its own turn rate — while the
// player, who has to see it and react, wears the whole thing. The car that has
// just been hit is sideways and its tires are not pointing where it is going;
// taking the steering away for that moment is both what really happens and the
// one version of this that costs a human and a bot the same.
//
// Measured, on one staged rear-quarter hit (closing 5, 17px offset, 100cc dry,
// a skill-1 car alone on the circuit, ground covered over the next two seconds
// against a no-hit control at the same point of the lap): the identical hit
// costs the shipped driver **3.5%** and a driver 450ms late **43%**. The bot is
// not shrugging off the impact model, it is out-reacting it — ai.js's steering
// is a Schmitt trigger that flips to full lock the frame heading error passes
// ~2.1°, which is a reaction time no human has.
//
// Taking the last quarter of the steering away is the principled end of that —
// a car pointing 30° off its own velocity does not get to steer — but on its
// own it is worth nothing, and the reason is worth not re-learning: at closing
// 5 the window only fills to 0.6 (Impacts.UNSETTLE_PER_SPEED), so 0.75 -> 1
// moved the loss from 45% to 60% and the trigger corrected fine on the rest.
// It is UNSETTLE_PER_SPEED that decides whether this number is reached at all.
const UNSETTLE_STEER_LOSS = 1; // of turnSpeed, at a full-strength hit

// Cornering scrub, graded by how sideways the car actually is rather than by
// whether a steering key is down. The flat version charged the full rate for
// any frame with left or right held — 6% of the car's speed at the top of the
// range, 0.94^6 over a 100ms stab — which is a handbrake on the small
// corrections a lap is mostly made of, and it is why the car felt like it fell
// over every time the player straightened it out.
//
// Slip is the honest measure of what a tire is scrubbing: the heading rotates
// at `turnSpeed` while the grip lerp drags the velocity back at `driftGrip`,
// so a held lock settles at sin(slip) = turnSpeed / driftGrip = 0.6 and a real
// corner still saturates this well before the apex, at exactly the old rate. A
// tap never gets there — one frame of lock is 0.06 rad with the velocity still
// pointing where it was — so turn-in is nearly free and the slide is not.
//
// Measured at 100cc, throttle held, from a pinned top speed (so this is the
// scrub alone) — speed left after N frames of lock, flat rate vs graded:
//
//   1f (17ms)   -6.0% -> -0.7%     20f (333ms)  -40.4% -> -31.6%
//   3f (50ms)  -12.9% -> -1.9%     40f (667ms)  -48.8% -> -46.6%
//   6f (100ms) -21.0% -> -4.6%    120f+          identical, both 4.80
//
// It is not free: a solo skill-1 car on Super Circuit, 100cc dry, laps 3.6%
// quicker (10.669s -> 10.283s) because it carries more speed through turn-in
// and brakes more to pay for it (1.5% of frames -> 3.8%). Holding the old
// field pace would want CORNER_MARGIN in ai.js at ~0.567 rather than 0.64.
const SCRUB_FULL_SLIP = 0.5; // sin of heading-vs-velocity angle that scrubs in full
const SCRUB_AT_MAX = 0.06; // of speed shed per frame, fully sideways at maxSpeed
const SCRUB_AT_REST = 0.02; // ... and the same, at a standstill

// Reads the velocity rather than `entity.speed`, because the whole point is
// the difference between a car that is turning and a car that is sliding.
function slipSin(entity, vx, vy) {
  const mag = Math.hypot(vx, vy);
  if (mag < 0.01) return 0;
  const lateral = vx * Math.cos(entity.angle) + vy * Math.sin(entity.angle);
  return Math.min(1, Math.abs(lateral) / mag);
}

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
    const lock =
      entity.turnSpeed * (1 - UNSETTLE_STEER_LOSS * (entity.unsettle || 0));
    if (input.left) entity.angle -= lock * flip * delta;
    if (input.right) entity.angle += lock * flip * delta;

    if (entity.speed !== 0 && (input.left || input.right)) {
      const load = Math.min(
        1,
        slipSin(entity, body.velocity.x, body.velocity.y) / SCRUB_FULL_SLIP,
      );
      const rate =
        SCRUB_AT_REST +
        (SCRUB_AT_MAX - SCRUB_AT_REST) *
          (Math.abs(entity.speed) / entity.maxSpeed);
      entity.speed *= Math.pow(1 - rate * load, delta);
    }

    // --- collision yaw (phaser/impacts.js) ---
    // Not part of the port: `spin` is only ever non-zero in the moment after a
    // contact, so a lap driven clean runs the same lines as before this
    // existed. It is added on top of the steering rather than handed to Matter
    // because the line above writes `angle` outright — a body Matter was also
    // rotating would have its rotation thrown away every frame.
    if (entity.spin) {
      entity.angle += entity.spin * delta;
      entity.spin *= Math.pow(SPIN_DECAY, delta);
      if (Math.abs(entity.spin) < 0.0005) entity.spin = 0;
    }

    // --- grip (stepCarMotion) ---
    // A collision leaves Matter's velocity pointing somewhere the throttle
    // never asked for; reading it back here is what lets an impact actually
    // push the car off line instead of being overwritten next frame.
    const targetVx = Math.sin(entity.angle) * entity.speed;
    const targetVy = -Math.cos(entity.angle) * entity.speed;
    let grip = entity.driftGrip * Rain.gripScale() * Rain.puddleGripAt(entity);

    // A car that has just been hit is unsettled: full grip would pull the
    // sideways velocity Matter gave it back onto the heading within a few
    // frames, which is exactly why a hit used to be a stutter and not a slide.
    // Decays on the same per-frame `delta` unit as everything else here.
    if (entity.unsettle > 0) {
      grip *= 1 - UNSETTLE_GRIP_LOSS * entity.unsettle;
      entity.unsettle = Math.max(0, entity.unsettle - delta / UNSETTLE_FRAMES);
    }

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
