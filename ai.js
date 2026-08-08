// The opponents drive the player's car.
//
// They used to drive a different one — twice the grip, a proportional
// steering controller that could swing the nose four times faster than the
// player's lock, a speed ceiling off the road instead of the player's drag,
// and no cornering scrub. Nothing tuned for the player ever transferred, and
// every attempt to balance the field moved a number that only existed on one
// side of the grid. What follows is a *driver*: it reads the track and
// returns the same four booleans the keyboard produces, and `stepCarControls`
// / `stepCarMotion` in game.js are the whole of the physics for both.
//
// The consequence worth holding on to while tuning: at the player's grip the
// cars cannot hold the line flat out. Anticipatory corner braking was
// measured here as not worth it and the comment said so for a year — that
// reading was taken at the old 0.2 grip and does not survive the change.
// Braking for corners is now the single largest thing the driver does.

// Corner speed comes out of the steering geometry, not a friction circle.
// Cornering steadily the heading turns at exactly `turnSpeed`, because the
// lock is bang-bang and there is no partial input, so the path the car sweeps
// has radius speed / turnSpeed however sideways the grip is letting it sit.
// Invert that and a corner of radius R can be carried at R * turnSpeed.
//
// Grip deliberately does not appear: it sets how far the car slides in the
// corner, not how tight a circle it can describe. What it does change is how
// far the slide carries the car off the marker it aimed at, and that is what
// the margin below pays for.
const CORNER_MARGIN = 0.86; // fraction of the geometric limit a perfect driver takes
const LOOKAHEAD_MARKERS = 5; // waypoints scanned ahead for something to brake for
const LOOKAHEAD_DIST = 1200; // world px — stop scanning once this far ahead

// When to stop chasing a marker and commit to the next one. Turning in early
// has now been tried twice and measured wrong twice — once as a fixed aim
// between the two markers, and once scaled to the speed/grip distance the car
// covers going straight while the velocity catches the nose up, which is a
// real effect and still not a reason to do this. On a track this narrow it
// cuts the apex onto the inside grass: at 0.4 of the entry slide the dry
// 100cc lap went from 11.5s to 18.5s with over half of it off the road.
const ADVANCE_RADIUS = 120; // px

// Bang-bang steering needs a deadband or the car saws at the rate limit all
// the way down every straight. Both thresholds are in frames of the car's own
// lock rather than in radians, because that is the only quantum available:
// there is no partial input, so an error smaller than one frame of `turnSpeed`
// cannot be corrected — it can only be thrown to the other side of zero.
// Anything below the smallest correction the car can make has to be a
// deadband, and tying it to `turnSpeed` keeps that true when the lock moves.
//
// Note there is no anticipation term. The heading has no inertia — it stops
// the instant the key comes up — so predicting where the nose will be and
// releasing early only inverts the decision, which is how the first cut of
// this sawed left-right every frame and steered nowhere.
const STEER_ON = 0.6; // frames of lock worth of heading error that starts a correction
const STEER_OFF = 0.3; // frames of lock it has to fall back inside to stop

// Throttle hysteresis, in px/frame. Between target and target+band the driver
// coasts; without it the pedals chatter every frame at the corner speed.
const BRAKE_BAND = 0.2;

// Line precision — how steadily a driver holds the aim point, as a slow lateral
// wander on it. This is what separates the field on a circuit where nothing
// needs braking for: neither shipped track has a corner that binds the speed
// model at 100cc in the dry, so the corner margin alone would have every driver
// identical there and only spread them at 250cc and in the wet.
//
// It costs time through cornering scrub, which is the dominant loss on this car
// — steering is expensive, so a driver who steers more to hold the same line is
// simply slower. Reaction lag was tried here first and is unusable: holding a
// stale decision even one frame doubles the control period, the deadband below
// goes unstable, and the lap goes from 11.6s to 15.4s. It is a cliff, not a dial.
const WANDER_PX = 140; // lateral aim wander at skill 0; scales with 1 - skill
const WANDER_RATE = 0.05; // rad/frame — slow enough to read as drift, not shake

// Lift for being mis-pointed. This is a recovery term, not a racing line: a
// car that has been shoved or has run wide is aimed somewhere it can't reach
// at speed, and backing off is how it gets its nose round.
const HEADING_BRAKE = 0.35;

// Counter-steer. Pointing the nose at the marker is not the same as going
// there: cornering steadily the velocity lags the heading by atan(turnSpeed /
// grip) — 31° dry, 48° once the rain has taken its grip off — so a driver that
// aims its nose at the apex travels wide of it.
//
// Only a third of the lag is steered against, and the gain matters far more
// than the idea: the slip angle is *caused* by the steering, so compensating
// for all of it is positive feedback and the cars spiral. At 1.0 the dry lap
// went from 11.5s to 17.2s. At 0.3 it costs 0.03s and halves the time the
// field spends with a wheel off the road, 4.0% of a lap to 2.9%.
const CRAB_COMP = 0.3; // fraction of the measured slip angle steered against

// Rain. Grip scales, so the corner speed comes down and the driver brakes
// earlier for it. The five WET_* constants that used to live here existed only
// to undo the opponents' double grip and to hand back the pace that cost them;
// with one car on the grid there is nothing to undo.
//
// It only bites at 250cc — at 100cc even a fully wet corner still allows more
// speed than the car has, and moving this between 0.45 and 0.75 changes a wet
// 100cc lap by 0.02s. What it is set from is the 250cc wet case, where 0.45 is
// both quicker and tidier than 0.75 (12.5s and 14.9% of the lap properly off
// the road, against 13.2s and 18.2%).
//
// That 15% is the floor, not a number left on the table: braking harder still
// does not move it. At 48° of slip the car is presented sideways, and a 34×56
// body crabbing at 48° covers 64px across its own direction of travel instead
// of 34 — the wheels hang over the edge with the car dead on line. 250cc in
// the rain is meant to look like that.
const WET_MARGIN = 0.45; // fraction of the dry corner margin when fully wet

// Catch-up, measured as a gap in waypoints along the track rather than in
// straight-line pixels — two cars either side of a hairpin are close in
// pixels and half a corner apart in the race. Equal machinery means this can
// no longer be top speed: a trailing car that out-drags the player is driving
// a faster car, which is the thing this rewrite exists to end. It buys
// aggression instead — later braking and more of the geometric limit — so
// they close in the corners, where a driver can actually find time.
const CATCHUP_GAIN = 0.12; // max fraction added to the corner margin
const CATCHUP_FULL = 2.5; // waypoints behind at which the gain is maxed

// Avoidance is a driver behaviour, so it moves the aim point rather than the
// velocity. Shoving velocity around directly — which is what this used to do
// — is a force no player has, and it let the field untangle itself out of
// contact the player had to steer out of.
const AVOID_RADIUS = 120; // px — start aiming away at this distance
const AVOID_STRENGTH = 55; // px of lateral aim offset at full closeness

// Index of the waypoint nearest a point. Both cars are measured the same way
// so the systematic offset between "closest marker" and "marker being chased"
// cancels out of the gap.
function nearestWaypoint(x, y, waypoints) {
  let best = 0;
  let bestSq = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i].x - x;
    const dy = waypoints[i].y - y;
    const dSq = dx * dx + dy * dy;
    if (dSq < bestSq) {
      bestSq = dSq;
      best = i;
    }
  }
  return best;
}

// Radius of the circle through a marker and its two neighbours — the corner,
// as the track actually describes it. Three markers in a line give zero area
// and an infinite radius, which is a straight and exactly the right answer.
function cornerRadius(waypoints, i) {
  const n = waypoints.length;
  const a = waypoints[(i - 1 + n) % n];
  const b = waypoints[i];
  const c = waypoints[(i + 1) % n];

  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  const bc = Math.hypot(c.x - b.x, c.y - b.y);
  const ca = Math.hypot(a.x - c.x, a.y - c.y);
  const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

  if (area2 < 1e-6) return Infinity;
  return (ab * bc * ca) / (2 * area2);
}

class AICar {
  constructor(ctx, x, y, color = "#0077ff") {
    this.ctx = ctx;
    this.x = x;
    this.y = y;
    this.color = color;
    this.width = 34;
    this.height = 56;
    this.angle = Math.PI / 2;
    this.speed = 0;
    this.velocityX = 0;
    this.velocityY = 0;

    // The car. applyCarStats() fills acceleration / maxSpeed / turnSpeed /
    // driftGrip / friction from the same sliders the player's come from, and
    // `mods` is the per-car hook the part upgrades will use.
    this.mods = null;

    // The driver. rollDriver() re-rolls these every race; they are seeded
    // here because the constructor runs before DebugConfig.apply().
    this.skill = 1;
    this.lineOffset = 0;
    this.wander = 0;
    this.wanderPhase = 0;
    this.currentWaypoint = 0;
    this.steerDir = 0;
    this.startDelay = Math.random() * 400; // ms

    // Race state — counted by updateLapCounter in game.js, which drives
    // both the player and every opponent through the same code
    this.laps = 0;
    this.onFinishLine = false;
    this.passedGate = false;
    this.finished = false;
    this.finishPosition = 0;
    this.finishTime = 0;
    this.raceStart = 0;
  }

  // Everything that makes one opponent different from another. It is all
  // driving, none of it machinery: a slower rival gives the corner more room
  // and takes a wider line, and loses the time there rather than being handed
  // a lower top speed it could never have chosen.
  rollDriver(v = DebugConfig.values) {
    const lo = v.aiSkillMin ?? 0.9;
    const hi = v.aiSkillMax ?? 1.0;
    this.skill = lo + Math.random() * (hi - lo);
    this.lineOffset = (Math.random() - 0.5) * (v.aiLineOffsetRange ?? 40);
    this.wander = Math.max(0, (1 - this.skill) * WANDER_PX);
    this.wanderPhase = Math.random() * Math.PI * 2;
  }

  // How much of the geometric corner limit this driver is willing to use,
  // this frame: their own skill, less what the rain has taken, plus whatever
  // being behind is worth.
  cornerMargin(catchup) {
    const wet = 1 - Rain.intensity * (1 - WET_MARGIN);
    const base = (DebugConfig.values.aiCornerMargin ?? CORNER_MARGIN) * wet;
    return base * this.skill * (1 + catchup * CATCHUP_GAIN);
  }

  // The fastest this car can be going *now* and still be down to every corner
  // in range by the time it reaches it. Each marker in the scan contributes
  // sqrt(v² + 2·a·d) — the arrival speed it allows, worked back over the
  // distance still to run — and the driver obeys the tightest of them.
  targetSpeed(waypoints, margin) {
    const n = waypoints.length;
    let limit = this.maxSpeed;
    let px = this.x;
    let py = this.y;
    let d = 0;

    for (let step = 0; step < LOOKAHEAD_MARKERS; step++) {
      const i = (this.currentWaypoint + step) % n;
      const wp = waypoints[i];
      d += Math.hypot(wp.x - px, wp.y - py);
      px = wp.x;
      py = wp.y;

      const r = cornerRadius(waypoints, i);
      if (r !== Infinity) {
        const corner = r * this.turnSpeed * margin;
        const allowed = Math.sqrt(corner * corner + 2 * this.acceleration * d);
        if (allowed < limit) limit = allowed;
      }

      if (d > LOOKAHEAD_DIST) break;
    }
    return limit;
  }

  // Where to point: the marker being chased, pushed sideways by this driver's
  // line offset and again by anyone close enough to hit.
  aimPoint(waypoints, others) {
    const n = waypoints.length;
    const current = waypoints[this.currentWaypoint];
    const next = waypoints[(this.currentWaypoint + 1) % n];

    // Perpendicular offset for a varied racing line. Aiming anywhere between
    // this marker and the next one was tried, to make the cars turn in early;
    // on a track this narrow it just cuts the apex onto the inside grass and
    // trebled the time they spent off the road.
    const perpX = -(current.y - next.y);
    const perpY = current.x - next.x;
    const perpLen = Math.hypot(perpX, perpY) || 1;

    const lateral =
      this.lineOffset + Math.sin(this.wanderPhase) * this.wander;
    let x = current.x + (perpX / perpLen) * lateral;
    let y = current.y + (perpY / perpLen) * lateral;

    const radius = DebugConfig.values.aiAvoidRadius ?? AVOID_RADIUS;
    const strength = DebugConfig.values.aiAvoidStrength ?? AVOID_STRENGTH;
    for (const other of others) {
      if (other === this) continue;
      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= radius * radius || distSq === 0) continue;

      const dist = Math.sqrt(distSq);
      const push = (1 - dist / radius) * strength;
      x += (dx / dist) * push;
      y += (dy / dist) * push;
    }
    return { x, y };
  }

  // One frame of driving. Returns the same input object the keyboard fills in
  // for the player; game.js feeds it straight to stepCarControls.
  drive(waypoints, player, others, delta = 1) {
    const idle = { accel: false, brake: false, left: false, right: false };
    if (!waypoints || waypoints.length === 0) return idle;

    // Burn down the start delay before moving. Coasting, not braking — the
    // car is stationary on the grid and there is nothing to shed.
    if (this.startDelay > 0) {
      this.startDelay -= (delta / 60) * 1000; // delta frames to ms
      return idle;
    }

    this.wanderPhase += WANDER_RATE * delta;

    const n = waypoints.length;
    const current = waypoints[this.currentWaypoint];
    const dx = current.x - this.x;
    const dy = current.y - this.y;

    // Advance once, here. There used to be a second check at the bottom of
    // this function testing the *same* distance against a tighter radius, so
    // any approach inside 80px burned two waypoints in one frame and the car
    // cut the corner that followed.
    if (dx * dx + dy * dy < ADVANCE_RADIUS * ADVANCE_RADIUS) {
      this.currentWaypoint = (this.currentWaypoint + 1) % n;
    }

    const aim = this.aimPoint(waypoints, others);

    // STEERING. Bang-bang, at the player's lock, through a Schmitt trigger in
    // units of that lock so it does not chatter around dead centre. The nose
    // is aimed short of the marker by however far the car is already sliding,
    // so it is the velocity that arrives there — see CRAB_COMP.
    const bearing = Math.atan2(aim.x - this.x, -(aim.y - this.y));
    let crab = 0;
    if (Math.abs(this.speed) > 0.5) {
      const velAngle = Math.atan2(this.velocityX, -this.velocityY);
      crab = Math.atan2(
        Math.sin(velAngle - this.angle),
        Math.cos(velAngle - this.angle),
      );
    }
    const targetAngle = bearing - crab * CRAB_COMP;
    const angleDiff = Math.atan2(
      Math.sin(targetAngle - this.angle),
      Math.cos(targetAngle - this.angle),
    );
    const err = Math.abs(angleDiff);
    if (this.steerDir !== 0 && err < this.turnSpeed * STEER_OFF)
      this.steerDir = 0;
    else if (err > this.turnSpeed * STEER_ON)
      this.steerDir = Math.sign(angleDiff);

    // Catch-up, in waypoints of track rather than pixels of separation.
    let catchup = 0;
    if (player) {
      const mine = nearestWaypoint(this.x, this.y, waypoints);
      const theirs = nearestWaypoint(player.x, player.y, waypoints);
      let gap = (((mine - theirs) % n) + n) % n;
      if (gap > n / 2) gap -= n; // signed — negative is behind the player
      if (gap < 0) catchup = Math.min(-gap / CATCHUP_FULL, 1);
    }

    // PEDALS. The corner limit, less a lift for being badly mis-pointed —
    // floored at zero so a car that has been spun is never handed a negative
    // target and asked to reverse out of it.
    const headingErr = Math.min(Math.abs(angleDiff) / Math.PI, 1);
    const target =
      this.targetSpeed(waypoints, this.cornerMargin(catchup)) *
      Math.max(0, 1 - headingErr * HEADING_BRAKE);

    return {
      accel: this.speed < target,
      brake: this.speed > target + BRAKE_BAND,
      left: this.steerDir < 0,
      right: this.steerDir > 0,
    };
  }

  drawCollisionBox(ctx) {
    ctx.save();
    ctx.translate(this.x - camera.x, this.y - camera.y); // screen space
    ctx.rotate(this.angle);

    const hw = this.width / 2;
    const hh = this.height / 2;

    ctx.strokeStyle = "rgba(255, 0, 0, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);

    ctx.restore();
  }

  draw() {
    CarSprites.draw(this.ctx, this, this.color);

    if (DEBUG) this.drawCollisionBox(this.ctx);
  }
}
