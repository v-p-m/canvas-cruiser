// Bodywork damage: the wings, and what losing one does to the car.
//
// Every charge in phaser/impacts.js is temporary. Speed comes back on the
// throttle, `spin` and `unsettle` decay to nothing inside a second, and that is
// the right shape for racing contact — which is nearly all contact. But it does
// mean the hardest hit of the race and a firm nudge differ only in how long the
// next second is. Nothing one driver does to another is still true a lap later.
//
// A wing is. It is the one part of an open-wheeler that is both fragile and
// load-bearing on the handling, which makes it the natural thing to lose: it
// takes a real shunt to break, it does not come back, and what it costs is not
// a number on the HUD — it is the corner the driver is about to take.
//
// Three rules this is built on:
//
//   1. It goes through `mods`. carStats.js calls that "the only sanctioned way
//      for one car to differ", and a torn-off wing is exactly that: a part that
//      is no longer fitted. Nothing here writes `entity.turnSpeed` or
//      `entity.driftGrip`; it rewrites the car's mods and lets applyCarStats()
//      do the multiplying, which is the same rule rain.js and engineClass.js
//      already follow and for the same reason — one place multiplies, or the
//      engine class and the damage each quietly overwrite the other.
//   2. Every car, the same. The player and all five opponents break on the same
//      hit and pay the same for it. That is CLAUDE.md's central rule, and it is
//      also why the AI needs no code of its own to drive a damaged car: its
//      corner speed is `R × turnSpeed × margin` (ai.js), so a broken front wing
//      makes it lift for every corner on the circuit without knowing why.
//   3. It costs traction, not top speed. `mods.speed` is deliberately untouched
//      — a damaged car is not a slower car down the straight, it is a car that
//      cannot carry what it has into the corner. That keeps the penalty a
//      *driving* penalty (which is what makes it recoverable by driving better)
//      and keeps a damaged backmarker from becoming a rolling chicane.
//   4. Wear is always visible. Each wing carries condition rather than a
//      boolean, so hits short of a break still count — and the moment hidden
//      state can decide whether a wing survives, the player has to be able to
//      see it. A wing that lets go on a light tap because of damage nobody
//      showed them is the exact unfairness FATIGUE_MIN's determinism is there
//      to avoid, arriving by another door. So condition is on the car (the
//      plane's outer sections go first), on the HUD, and in the debug panel;
//      the sprite tell is the one that matters most, because it is also how a
//      driver reads that the car ahead is wounded.
//
// ── The aero, and why these two numbers are not one number ──────────────────
//
// The handling model settles a steady corner at sin(slip) = turnSpeed /
// driftGrip (see matterCar.js's SCRUB_FULL_SLIP note) — 0.06/0.1 = 0.6 on an
// undamaged car. So the two wings have two different levers, and the split is
// the real one:
//
//   front wing gone → turnSpeed × 0.82 → 0.049/0.1  = 0.49
//     The car turns in less *and* slides less: understeer. Which is what it
//     feels like — you ask for the apex, the car goes straight on, and the only
//     answer is to arrive slower.
//   rear wing gone → driftGrip × 0.78 → 0.06/0.078 = 0.77
//     The car turns in as sharply as it ever did and then keeps going round:
//     oversteer. Loose, quick to point, and it will bite.
//
// Two things fall out of that ratio rather than being tuned in:
//
//   - A broken rear wing is not just looser, it is slower, because
//     SCRUB_FULL_SLIP is 0.5: an undamaged car only saturates the cornering
//     scrub around the apex, and a loose one is past it for the whole corner.
//   - Both wings gone lands at 0.049/0.078 = 0.63, back beside the stock 0.6.
//     The balance returns and the grip does not — neutral, slow to turn, short
//     at both ends, which is what a car with no aero is. Nothing enforces that;
//     it is the same equation doing its job.
//
// The floor both numbers have to stay clear of is turnSpeed/driftGrip = 1,
// where a held lock has no steady state at all and the car just spins. With the
// front wing still on, that is driftGrip at 0.6 of stock. 0.78 is not near it by
// accident.
//
// Measured, and both predictions hold — a solo skill-1 car, Super Circuit,
// 100cc dry, hand-stepped Matter, mean of the timed laps, against the fraction
// of frames spent past SCRUB_FULL_SLIP:
//
//   intact      10.367s     —        0.0% of frames sideways
//   front off   11.008s   +6.2%      0.0%   ... understeer: it slides *less*
//   rear off    10.750s   +3.7%      1.6%   ... oversteer, and the scrub is
//                                            where the time goes
//   both off    11.428s  +10.2%      0.5%   ... balance back, grip gone
//
// So a wing is worth roughly half a second a lap and both are worth a second —
// two to five seconds over a five-lap race. Enough to lose a race that was
// close, not enough to end one, which is the whole reason it is a handling
// penalty and not a speed one.
//
// One asymmetry worth knowing before either number is touched: the front-wing
// loss is purely geometric (corner speed is R × turnSpeed), so a human pays
// exactly the 6.2% above. The rear-wing loss is a *slide*, and ai.js's
// pure-pursuit controller catches slides on the frame they start — so 3.7% is
// the floor of what it costs, and a human pays more. Same shape as the reaction
// gap in matterCar.js's UNSETTLE_STEER_LOSS note, and for the same reason.

const Damage = {
  // px/frame of *end-on* closing speed that tears a wing off. impacts.js
  // measured the bands this sits between: ordinary racing contact runs 0.3–2.2
  // and a full-speed rear-end reads ~9.9, with sparks (HARD_HIT) starting at
  // 1.2. So this is a long way above door-to-door racing and below a flat-out
  // ram: it wants to be the misjudged braking zone, the one contact a race
  // might see none of.
  //
  // Measured against a whole race rather than assumed from those bands. Six
  // cars, six laps of Super, hand-stepped, every contact that reached the wing
  // test logged with the number the test is made against (closing × how square
  // it was): 58 contacts, p50 0.06, p90 0.51, p99 1.17, **max 1.41**. Nothing
  // in a clean race comes close — a threshold of 2 would still have broken
  // nothing all afternoon. What does reach it, staged head-to-tail: a car
  // arriving 4 px/frame faster than the one in front, square on, which on the
  // HUD is about 40 KM/H of unclosed gap at the braking point. That is a
  // mistake, not a move.
  //
  // Not a threshold any more, though: it is the point at which *one* hit is
  // enough. See FATIGUE_MIN.
  BREAK_SPEED: 4, // px/frame

  // ── Wear, and why there is a floor under it ────────────────────────────────
  //
  // A wing has condition, not a boolean, so a shunt that does not quite break
  // one still leaves it weaker — three trips through the same braking zone
  // eventually cost what one big mistake costs. Without this the model is a
  // cliff: closing 3.9 is free forever and 4.0 is a wing.
  //
  // The danger in accumulating anything is attrition: the measured race above
  // is 58 contacts over six laps, and if every one of them chips something then
  // the field is wingless by half distance and a broken wing no longer says
  // anything about how anyone drove. So the shape is the one real materials
  // have. Below the endurance limit a structure takes unlimited cycles and does
  // not care; above it, damage per cycle climbs superlinearly, because the
  // energy in an impact goes as the square of the speed:
  //
  //     wear = ((severity - FATIGUE_MIN) / (BREAK_SPEED - FATIGUE_MIN))²
  //
  // clamped into 0..1, off a wing that starts at 1. At the values below:
  //
  //     severity 1.4 (the hardest clean-race contact measured)   0     — free
  //     severity 2.0    0.04   ... 25 of them
  //     severity 2.5    0.16   ... 7
  //     severity 3.0    0.36   ... 3
  //     severity 3.5    0.64   ... 2
  //     severity 4.0    1.00   ... 1, exactly as before
  //
  // Measured, and it corrects the guess this was first written on: the floor is
  // *not* what prevents attrition — the exponent is. Replaying 94 contacts over
  // a 20-lap distance through the curve at a range of floors, as condition lost
  // across the field's twelve wings:
  //
  //     FATIGUE_MIN 0    1.49 of 12      1.0    0.04 of 12
  //     FATIGUE_MIN 0.5  0.38 of 12      1.5+   0.00 of 12
  //
  // So even with no floor whatsoever a clean race barely marks the field, because
  // a p50 contact of 0.06 is worth (0.06/4)² ≈ 0.0002 and always will be. What
  // the floor buys is *exactly* zero rather than nearly zero, which is worth
  // having — "I have been racing cleanly and my wing is at 96%" is a worse
  // conversation than "it is at 100%" — and it is what lets the floor sit low
  // enough for the band above it to be wide. 1.5 against a clean-racing maximum
  // of 1.41 is a thin margin on paper and a free one in practice: a contact at
  // 1.6 costs 0.0016. Trading margin for band width is the right way round,
  // because the band is where "several lesser hits" actually lives.
  //
  // Confirmed on staged repeats of one identical rear-end, counting how many it
  // takes to put the nose on the floor: a firm one (~2.4) more than twelve, a
  // hard one (~3.0) four, a heavy one (~3.5) two, a punt (~4.5) one. And
  // twenty consecutive under-floor contacts leave the wing at exactly 1.000,
  // which is the property the floor is there for.
  FATIGUE_MIN: 1.5, // px/frame of end-on severity below which a hit costs the wing nothing

  // Condition at or below which the wing is visibly coming apart (carSprites.js
  // blanks the outer plane) and the HUD starts warning. Not a handling change:
  // see the note on that below.
  CRACKED_AT: 0.5, // of condition

  // Deterministic, not a roll. A wing that survives one shunt and not an
  // identical one reads as the game cheating, and every driver in the race
  // needs to be able to learn where the line is from the far side of it. It
  // also keeps the headless harness able to stage a break on demand — a roll
  // here would make every A/B on the numbers below noise. The drama comes from
  // the geometry instead: which end, and how square the hit was.
  //
  // How square is `face`: the cosine of this car's share of the impulse against
  // its own heading. A hit up the tail pushes the car forward along it, one on
  // the nose pushes it back, and a side-swipe pushes it sideways. That is the
  // face that was struck, read straight off the collision normal — a cleaner
  // signal than the contact point, for the same reason impacts.js's yaw does
  // not use the contact point either. Below this the hit landed on a flank,
  // where there is no wing to break however hard it was.
  //
  // The case that settles it, staged: a T-bone into a car turned across the
  // road, closing 7.6. The car that arrived nose-first loses its front wing and
  // the one that was struck amidships loses nothing — it still pays the speed,
  // yaw and grip in impacts.js, which is what a hard hit costs, but there is no
  // wing on a flank to lose.
  FACE_MIN: 0.5, // cos — 60° either side of head-on or tail-on

  // Condition is structural only: a wing works fully right up until it does not
  // work at all. That is what carbon actually does — it is stiff until it
  // fails, with no soft middle — and it is also the better game. Fading the
  // downforce out across the condition bar would spread the penalty so thin
  // that no single part of it is perceptible, and the break itself, which is
  // the moment the whole feature exists for, would arrive as the last 10% of a
  // slide the player had already stopped noticing. It also keeps every lap time
  // measured below valid: a car is either on the intact numbers or the broken
  // ones, never somewhere in between.
  FRONT_TURN: 0.82, // of turnSpeed, front wing gone
  REAR_GRIP: 0.78, // of driftGrip, rear wing gone

  FLASH_MS: 2000, // how long the HUD tell flashes after a break or a fresh crack

  // Counters for the `?debug=1` panel, same reason impacts.js carries its own:
  // over a clean race this file does nothing at all, and "nothing happened" and
  // "it is broken" look identical from the outside.
  breaks: 0,

  init(scene) {
    this.breaks = 0;

    // Carbon fibre off the bodywork. Not additive like impacts.js's sparks —
    // sparks are hot metal and read as light added to the scene, but debris is
    // an object, and an additively-blended chunk over dark tarmac glows like an
    // ember. Neutral grey for the same reason the wing itself is neutral in
    // CAR_PIXELS: the machinery is one grid with six liveries on it, and
    // body-coloured shrapnel would say the paint came off instead.
    this.debris = scene.add
      .particles(0, 0, this.debrisTexture(scene), {
        lifespan: { min: 300, max: 700 },
        speed: { min: 40, max: 180 },
        scale: { start: 1, end: 0.7 },
        alpha: { start: 1, end: 0 },
        rotate: { start: 0, end: 540 }, // tumbling, which is what says "part" and not "puff"
        tint: [0x1e1e1e, 0x3c3c3c, 0x6a6a6a, 0x9a9a9a],
        gravityY: 0,
        quantity: 0,
        frequency: -1,
      })
      .setDepth(1.6); // under the cars: it has left the car and is on the road now
  },

  // A hard little square, unlike sprayTexture()'s soft dot — debris has edges.
  // Same "bake a canvas, no PNGs" rule as everything else that draws here.
  debrisTexture(scene) {
    const key = "debris";
    if (scene.textures.exists(key)) return key;
    const c = document.createElement("canvas");
    c.width = 3;
    c.height = 3;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; // white, so the tint list above is what colours it
    g.fillRect(0, 0, 3, 3);
    scene.textures.addCanvas(key, c);
    return key;
  },

  // Called from spawnCar for every car, player included. `mods` as it is at
  // this moment is the car *as built* — the opponents' AI_TOP_SPEED and
  // whatever the part upgrades eventually fit — and `fitted` is that snapshot,
  // not a second source of truth: `mods` stays what the car is now, and this is
  // what it was before anything fell off it.
  reset(entity) {
    entity.wings = { front: 1, rear: 1 }; // condition, 1 = as new, 0 = gone
    entity.wingFlash = 0; // ms of HUD flash left after the most recent damage
    entity.fitted = { ...entity.mods };
  },

  // One car's share of one contact, from impacts.js's applyTo(). `dvx/dvy` is
  // the impulse this car is about to take and `closing` the approach speed
  // along the normal — the same two numbers every other charge there is read
  // off, so a hit cannot break a wing without also costing the speed, yaw and
  // grip that go with it.
  onImpact(car, dvx, dvy, closing) {
    const e = car.entity;
    if (!e.wings) return; // the editor page's pace car, or a car spawned before reset()

    const mag = Math.hypot(dvx, dvy) || 1;
    // Heading, in the game's compass convention (0 = north) — the same two
    // lines matterCar.js and impacts.js use.
    const face =
      (dvx * Math.sin(e.angle) + dvy * -Math.cos(e.angle)) / mag;
    if (Math.abs(face) < this.FACE_MIN) return;

    // Graded by how square it was: a glancing hit at the edge of FACE_MIN puts
    // half its closing speed through the wing, and only half of it counts.
    const severity = closing * Math.abs(face);
    if (severity <= this.FATIGUE_MIN) return; // under the endurance limit, and free

    const excess = Math.min(
      1,
      (severity - this.FATIGUE_MIN) / (this.BREAK_SPEED - this.FATIGUE_MIN),
    );

    // Shoved forward means it was hit from behind. Both cars in a rear-end
    // damage a wing, and they damage different ones: the car doing the shunting
    // hurts its nose and inherits understeer, the car being shunted hurts its
    // rear wing and inherits oversteer. That symmetry is the point — the pass
    // is still there for the taking, it just costs the driver who forces it as
    // much as the driver who gets forced.
    this.wear(car, face > 0 ? "rear" : "front", excess * excess);
  },

  // Take `amount` of condition off one wing, and break it if that empties it.
  wear(car, end, amount) {
    const e = car.entity;
    if (e.wings[end] <= 0) return; // already gone; a second hit on it is just a hit

    const was = e.wings[end];
    e.wings[end] = Math.max(0, was - amount);

    // Only the two transitions a driver can actually see are worth announcing:
    // the wing starting to come apart, and the wing leaving. Chipping condition
    // off one that already looked chipped is not news, and a HUD that flashes
    // for every contact is a HUD nobody reads.
    const cracked = was > this.CRACKED_AT && e.wings[end] <= this.CRACKED_AT;
    const gone = e.wings[end] <= 0;
    if (cracked || gone) e.wingFlash = this.FLASH_MS;

    if (!gone) {
      // Still attached, so the stats do not move — condition is structural
      // only (see FRONT_TURN). A piece of it has gone, though, and that wants
      // to be seen leaving.
      if (cracked) {
        this.shed(e, end, 3);
        Sound.crack();
      }
      return;
    }

    this.breaks++;
    this.refit(e);
    this.shed(e, end, 12);
    Sound.crack();
  },

  // Force one wing off outright, whatever condition it was in. Nothing on the
  // impact path calls this — it is for staging a break in a headless check,
  // where the point is the car that comes out of it and not the hit that got
  // it there.
  breakWing(car, end) {
    this.wear(car, end, 1);
  },

  // The car's stats, re-derived from what is still bolted to it. Rebuilt from
  // `fitted` every time rather than multiplied onto whatever `mods` currently
  // holds, so no amount of contact can compound into a car that cannot be
  // driven at all: a wing is either there or it is not, and there is one of
  // each. Condition never enters here — see FRONT_TURN.
  refit(entity) {
    const f = entity.fitted;
    entity.mods = {
      speed: f.speed,
      accel: f.accel,
      turn: f.turn * (entity.wings.front > 0 ? 1 : this.FRONT_TURN),
      grip: f.grip * (entity.wings.rear > 0 ? 1 : this.REAR_GRIP),
    };
    applyCarStats(entity); // the one place that multiplies — see carStats.js
  },

  // Bodywork leaving the car, thrown from the end it came off. Placed past the
  // bodywork (the wing is the outermost four rows of CAR_PIXELS) and spread
  // across the car's full width, because that is the span of the part. `per` is
  // what separates a corner breaking off from the whole plane going.
  shed(entity, end, per) {
    if (!this.debris) return;
    const cos = Math.cos(entity.angle);
    const sin = Math.sin(entity.angle);
    const along = (end === "front" ? -1 : 1) * entity.height * 0.5;
    for (let i = 0; i < 3; i++) {
      const lat = (i - 1) * entity.width * 0.35;
      this.debris.emitParticleAt(
        entity.x + lat * cos - along * sin,
        entity.y + lat * sin + along * cos,
        per,
      );
    }
  },

  // Ticked per car from RaceScene's own sprite loop — the flash is the only
  // state here that moves on its own, and one decrement is cheaper than a timer
  // per car that has to be cancelled when the scene restarts.
  update(entity, deltaMs) {
    if (entity.wingFlash > 0) entity.wingFlash -= deltaMs;
  },

  // The sprite state, as the cache key carSprites.js and RaceScene's texture
  // manager both key on: one character per end, front first — `-` intact, `c`
  // coming apart, `x` gone. Always two characters, so "--" is an undamaged car
  // and the editor page (which calls CarSprites.get with two arguments and has
  // no damage model) lands on the same default.
  //
  // Nine states rather than four now, but the cache only ever holds the ones a
  // race actually reaches, and the overwhelming majority of cars stay on "--"
  // for the whole race and cost no extra bake at all.
  wingKey(entity) {
    if (!entity.wings) return "--";
    const s = (hp) => (hp <= 0 ? "x" : hp <= this.CRACKED_AT ? "c" : "-");
    return s(entity.wings.front) + s(entity.wings.rear);
  },

  // Anything to show the driver at all — including a wing still attached but
  // visibly coming apart, which is the state the whole HP model exists to make
  // legible.
  hurt(entity) {
    return !!entity.wings && (entity.wings.front < 1 || entity.wings.rear < 1);
  },

  broken(entity) {
    return (
      !!entity.wings && (entity.wings.front <= 0 || entity.wings.rear <= 0)
    );
  },
};
