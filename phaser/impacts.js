// What a car-to-car hit costs, and what it looks like.
//
// Matter has resolved contacts since 0.14.0, but only as a shove: it moved the
// bodies apart and changed `body.velocity`, and then the very next frame
// MatterCar.step's grip term lerped that velocity straight back onto
// `entity.speed × heading`. `entity.speed` is what the car actually carries
// between frames, and nothing here ever touched it — so a hit was a visual
// stutter that cost nothing, in either direction. Hitting someone was free and
// being hit was free.
//
// The four things this adds are the four things a real contact does, and
// each one is read off the *closing velocity* rather than the penetration
// depth the sound used to use. Depth is how far two boxes overlapped by the
// time the detector noticed, which is mostly a function of how fast the pair
// was already moving together — a slow car leaning on another at 1px/frame
// registers the same "force" as a genuine punt if it leans far enough.
//
//   1. speed — the component of the impulse along each car's own heading is
//      written into `entity.speed`, so a hit from behind shoves you *forward*
//      (the bump-pass) and a head-on scrub takes the speed away. Lateral goes
//      to Matter as it always did.
//   2. scrub — an inelastic loss off *both* cars, graded by severity, because
//      (1) only moves momentum between the two headings: without this a
//      side-swipe costs neither car anything and a hit never slows anyone.
//   3. yaw — an off-centre hit spins the car, by the impact parameter (how far
//      the two centres are offset across the normal), so a full-speed ram into
//      a rear quarter is a PIT and a square hit up the tail is not — the lever
//      arm there is 0, by geometry, and no amount of speed changes that.
//      It decays rather than being capped under the steering rate: `angle` is
//      written outright by the steering model, so what makes a spin survivable
//      is that the yaw always bleeds away, not that it stayed small.
//   4. grip — a hit leaves the car unsettled for a moment, so the slide Matter
//      just gave it survives long enough to be a slide.
//
// Timing note: matter-js triggers `collisionStart` *before* its own resolver
// runs, so `body.velocity` here is still the pre-impact velocity. That is what
// makes the closing speed below the real approach speed, and it is why this
// estimates the impulse (equal masses, MATTER_CAR.RESTITUTION) instead of
// reading a velocity delta that has not happened yet.

const Impacts = {
  RUB_SPEED: 0.4, // px/frame — below this a contact is two cars leaning, not a hit
  SPEED_TRANSFER: 0.75, // of the along-heading impulse, into entity.speed
  // The inelastic half. SPEED_TRANSFER only *moves* momentum between the two
  // cars along their headings, so on its own a rear-end shoves the car in front
  // faster and a side-swipe costs neither car anything — nothing is ever lost.
  // Real bodywork does not do that, and neither did resolveCollision(), which
  // took `speed *= 0.85` off both cars on a hard hit. This is that rule back,
  // graded by severity instead of a threshold: it is what makes hitting someone
  // slow *them*, whatever the geometry. Both cars pay the same, per CLAUDE.md —
  // a scrub the player takes and the AI doesn't is the old regression exactly.
  SCRUB_PER_SPEED: 0.06, // of speed, per px/frame of closing speed
  SCRUB_MAX: 0.35, // of speed — a shunt is not a handbrake
  YAW_PER_SLIP: 0.02, // rad/frame of spin per px/frame of tangential impulse
  // Not a "stays under CAR_STATS.turnSpeed (0.06) so it is always catchable"
  // cap any more — that guaranteed recoverability by making a deliberate
  // rear-corner ram integrate to ~25° total, which is a twitch and not a PIT.
  // Recoverability comes from SPIN_DECAY instead: the yaw always bleeds to
  // nothing, so even a full spin ends with the driver back in charge, facing
  // the wrong way, having lost the time. That is a penalty; a permanent spin
  // would be a respawn.
  YAW_MAX: 0.1, // rad/frame
  // Set so that a hit worth calling a hit *fills* the window: at 0.12 a closing
  // speed of 5 only reached 0.6, which left the AI 40% of its steering — and
  // 40% of a correctly-signed full lock is most of what that correction is
  // worth, so UNSETTLE_STEER_LOSS had nothing to take. Measured on the staged
  // rear-quarter hit in matterCar.js's note: 0.12 -> 0.22 takes the same hit
  // from costing the shipped AI 3.5% of two seconds' ground to 10.6%, while a
  // driver 450ms late still pays ~40% either way. That is the gap between what
  // a hit costs a bot and what it costs a human closing from 12x to under 4x,
  // which is the whole point — see CLAUDE.md on why it cannot be closed by
  // charging the two of them differently.
  //
  // Ordinary racing contact is 0.3-2.2 px/frame (see HARD_HIT below), so it
  // still only fills the window to 0.07-0.48: this makes a *shunt* expensive,
  // not a race.
  UNSETTLE_PER_SPEED: 0.22, // of the grip-loss window, per px/frame of closing speed
  // Measured, not guessed: over a race plus three engineered rams, ordinary
  // racing contact runs 0.3–2.2 px/frame of closing speed and a full-speed
  // rear-end reads ~9.9. So the rub gate sits just under the racing band and
  // sparks want to be inside it — at 2.5 they only ever fired on a ram.
  HARD_HIT: 1.2, // px/frame — sparks above this
  SHAKE_FULL: 3, // px/frame of closing speed that shakes the camera flat out
  // Deliberately restrained. The camera is following the car the player is
  // steering, so shake here is not decoration — it is noise on the one thing
  // they are reading to place the car. Enough to register the hit, not enough
  // to cost them the corner they are in the middle of.
  SHAKE_MIN_MS: 70,
  SHAKE_MAX_MS: 100,
  SHAKE_MIN: 0.0006, // of viewport, at the rub threshold
  SHAKE_MAX: 0.0035, // of viewport, at SHAKE_FULL and above

  // Counters for the `?debug=1` panel — "is this even running" is the question
  // this file is hardest to answer by eye, since a hit that lands below
  // RUB_SPEED is supposed to look like nothing at all.
  count: 0,
  hardest: 0,

  init(scene) {
    this.count = 0;
    this.hardest = 0;

    // Metal on metal. Same "bake a canvas, no PNGs" rule as sprayTexture();
    // one shared emitter, fired by hand at the contact point, because a
    // collision is an event and not a shape any emit zone describes.
    // Additive, and that is the whole difference between "sparks" and "a small
    // brown puff". Sparks are hot metal: they read as light *added* to whatever
    // is behind them, so they carry over dark tarmac and at night, where an
    // alpha-blended dark orange dot on grey asphalt is invisible in motion.
    // Fast, short-lived and thrown wide for the same reason — a spark shower is
    // over in a quarter of a second and its shape is the give-away.
    this.emitter = scene.add
      .particles(0, 0, scene.sprayTexture(), {
        lifespan: { min: 120, max: 320 },
        speed: { min: 80, max: 340 },
        scale: { start: 1.4, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [0xffffff, 0xfff3c4, 0xffc247, 0xff7a1a],
        blendMode: "ADD",
        gravityY: 0,
        quantity: 0,
        frequency: -1,
      })
      .setDepth(2.5); // over the cars — sparks come off the bodywork, not out from under it
  },

  // One `collisionstart` event. `cars` maps a Matter body back to the car it
  // belongs to; anything not in it is the map-bounds wall, which was never
  // what any of this was tuned against.
  handle(scene, event, cars) {
    for (const pair of event.pairs) {
      const a = cars.get(pair.bodyA);
      const b = cars.get(pair.bodyB);
      if (!a || !b) continue;

      // Matter's normal points from bodyB *to* bodyA, not the other way round —
      // its own resolver is what settles it, pushing A along `+normal` and B
      // along `-normal`. Get this backwards and every real hit computes a
      // negative closing speed, fails the RUB_SPEED gate below, and the whole
      // file goes silently dormant: an engineered full-speed rear-end measured
      // -9.86 when it should have read +9.86.
      const n = pair.collision.normal;
      const rvx = b.body.velocity.x - a.body.velocity.x;
      const rvy = b.body.velocity.y - a.body.velocity.y;
      const closing = rvx * n.x + rvy * n.y;
      if (closing < this.RUB_SPEED) continue;

      // Equal masses, so each car takes half of the closing speed plus the
      // restitution Matter is about to hand back — apart, along the same
      // directions the resolver will use.
      const j = closing * 0.5 * (1 + MATTER_CAR.RESTITUTION);
      const contact = this.contactPoint(pair);

      this.applyTo(a, b, n.x * j, n.y * j, closing);
      this.applyTo(b, a, -n.x * j, -n.y * j, closing);

      this.count++;
      if (closing > this.hardest) this.hardest = closing;

      Sound.impact(closing);
      if (closing >= this.HARD_HIT) this.spark(contact, closing);
      if (a === scene.player || b === scene.player) this.shake(scene, closing);
    }
  },

  // The average of the contact points Matter found — where on the bodywork the
  // hit landed, which is where the sparks come from. Only the sparks: the yaw's
  // lever arm deliberately does *not* use this, for the reason in applyTo().
  // Falls back to the midpoint of the two centres if the pair carries no
  // supports at all.
  //
  // `supports` is a preallocated [null, null] and `supportCount` is how many of
  // it this collision filled — iterating the array itself averages in the
  // *previous* collision's second point, which is a lever arm from another
  // corner of the map.
  contactPoint(pair) {
    const c = pair.collision;
    const n = c.supportCount || 0;
    if (!n)
      return {
        x: (pair.bodyA.position.x + pair.bodyB.position.x) / 2,
        y: (pair.bodyA.position.y + pair.bodyB.position.y) / 2,
      };
    let x = 0;
    let y = 0;
    for (let i = 0; i < n; i++) {
      x += c.supports[i].x;
      y += c.supports[i].y;
    }
    return { x: x / n, y: y / n };
  },

  // One car's share of the hit. `dvx/dvy` is the velocity change it is about
  // to take, in world units; `other` is the car that hit it, which is what the
  // lever arm below is measured against.
  applyTo(car, other, dvx, dvy, closing) {
    const e = car.entity;

    // Split the impulse in the car's own frame: forward goes into the speed it
    // carries between frames, sideways is left to Matter (and to the grip
    // window below, which is what lets it last long enough to feel).
    const hx = Math.sin(e.angle);
    const hy = -Math.cos(e.angle);
    // Scrub first, then the transfer: the loss is off the speed the car
    // *arrived* with, and the shove it receives is not something it then gets
    // to lose a third of again in the same frame.
    e.speed *= 1 - Math.min(this.SCRUB_MAX, closing * this.SCRUB_PER_SPEED);
    e.speed += (dvx * hx + dvy * hy) * this.SPEED_TRANSFER;

    // Off-centre hits rotate. `inertia: Infinity` means Matter will not do this
    // for us by design (see matterCar.js) — the steering model writes `angle`
    // outright and would fight a body Matter was also spinning, so the yaw is
    // ours, bounded, and decayed back to nothing in MatterCar.step().
    //
    // The lever arm is the **impact parameter**: how far the two centres are
    // offset perpendicular to the collision normal. The obvious choice — the
    // contact point's own offset from this car's centre — measured almost no
    // yaw at all on the one manoeuvre that most wants it. Two aligned cars in a
    // rear-end touch along a whole edge, Matter reports a support at each end
    // of it, and their midpoint sits within a pixel or two of the centreline
    // however far the cars are staggered. Averaging is what destroys the
    // signal. The centre-to-centre offset does not: it is ~0 for a square hit
    // up the tail and a full car's width for one on the corner, which is
    // exactly the geometry that decides whether a ram is a punt or a PIT.
    const dx = other.body.position.x - car.body.position.x;
    const dy = other.body.position.y - car.body.position.y;
    const nx = dvx / (Math.hypot(dvx, dvy) || 1);
    const ny = dvy / (Math.hypot(dvx, dvy) || 1);
    const along = dx * nx + dy * ny;
    const rx = dx - along * nx; // the perpendicular part, in world units
    const ry = dy - along * ny;
    const lever = (rx * dvy - ry * dvx) / (e.height / 2);
    e.spin = clampAbs(
      (e.spin || 0) + lever * this.YAW_PER_SLIP,
      this.YAW_MAX,
    );

    // Unsettled: the tires are not pointing where the car is going and for a
    // moment they do not get to argue about it.
    e.unsettle = Math.min(
      1,
      (e.unsettle || 0) + closing * this.UNSETTLE_PER_SPEED,
    );
  },

  spark(at, closing) {
    if (!this.emitter) return;
    const n = Math.min(24, Math.round(closing * 4));
    this.emitter.emitParticleAt(at.x, at.y, n);
  },

  // Only ever the player's own hits — this is the main camera, and the UI is
  // on its own canvas over the top, so nothing the player reads moves with it.
  shake(scene, closing) {
    const f = Math.min(1, (closing - this.RUB_SPEED) / this.SHAKE_FULL);
    scene.cameras.main.shake(
      this.SHAKE_MIN_MS + (this.SHAKE_MAX_MS - this.SHAKE_MIN_MS) * f,
      this.SHAKE_MIN + (this.SHAKE_MAX - this.SHAKE_MIN) * f,
      true, // restart a shake already running — a scrum is one hit, not a queue
    );
  },
};

function clampAbs(v, max) {
  return v > max ? max : v < -max ? -max : v;
}
