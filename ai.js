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
//
// 0.15.0 took this from 0.86 to 0.64 to give the player a little more room.
// It is the right dial for that because it is the only one that costs time in
// the corners without costing precision: measured on Super Circuit, seeded, a
// full five-car field, mean best lap over the field, the wheels stay on the
// road either side of the change (off-road 0.4% → 0.5% of a lap). Lowering the
// skill band instead buys pace back at half the rate and pays for it in
// wander, which is a field that wobbles rather than one that brakes.
//
//   Super 100cc dry   10.46 → 10.79  (+3.1%)
//   Super 100cc wet   11.84 → 12.48  (+5.4%)   — WET_MARGIN multiplies this
//   Super 250cc dry    8.67 →  9.25  (+6.7%)
//   Snake Valley 100cc dry 13.43 → 13.60  (+1.3%)
//
// The spread is the constant telling the truth about what it does: it only
// binds where a corner binds. Valley's corners are open enough that almost
// nothing does, and the wet and 250cc are where they bite hardest — which is
// where the player was losing anyway, so the relief lands where it was wanted.
const CORNER_MARGIN = 0.64; // fraction of the geometric limit a perfect driver takes
const LOOKAHEAD_DIST = 1200; // world px — stop scanning once this far ahead

// The driver spread. These live here, beside the rest of the driver's numbers,
// rather than in the tuning panel's defaults: the game page does not load
// debugConfig.js any more, and when the shipped value was only in that literal
// the fallbacks below silently raced a different field — a skill floor of 0.9
// against the 0.85 the game actually ships.
const SKILL_MIN = 0.85;
const SKILL_MAX = 0.95;
const LINE_OFFSET_RANGE = 40; // world px of lateral line preference, full width

// The shipped number, unless the editor page's slider panel is loaded and has
// been dragged. Same rule as carStats.js: the constants above are the truth,
// and the panel is an override that may not be there at all.
function tunedAI(key, fallback) {
  const v = typeof DebugConfig === "undefined" ? null : DebugConfig.values;
  return v?.[key] ?? fallback;
}

// THE LINE. A dozen markers hold a circuit, so the line they describe is a
// polygon: every corner's turning is concentrated at a single vertex with
// nothing on either side of it. Chasing those markers one at a time is what
// made the cornering look sharp — measured on Super Circuit, the aim sat still
// for a second and then moved a median of 55° of bearing in the one frame the
// marker advanced, against 0.2° in every frame between. The driver answered
// each jump with one unbroken hold of full lock, fifteen a lap sweeping 76° to
// 134° of heading apiece, and drove the twelve-sided polygon that implies: half
// the lap dead straight, a ninth of it pivoting at the lock, nothing in between.
//
// Resampling the markers and rounding them gives a line that *contains* its
// corners, so the same turning is spread over an entry, an apex and an exit —
// and, as a second effect worth as much, gives `cornerRadius` something real to
// read. Three markers 400px apart around a 90° vertex describe no corner the
// braking model can see; a rounded line at 20px does.
//
// The rounding is a moving average, which cuts inside the markers — it is
// bounded to a few tens of px by the span, and this is the *only* place the
// line moves off them. Aiming off the ring is what has been tried twice and
// measured wrong twice: at 0.4 of the entry slide the dry 100cc lap went from
// 11.5s to 18.5s with over half of it off the road.
const RING_SPACING = 20; // world px between resampled points
const RING_SMOOTH_SPAN = 3; // points either side averaged, per pass
const RING_SMOOTH_PASSES = 2; // together: a corner rounded over ~120px of line
const RING_CURV_SPAN = 4; // points either side the radius is measured across

// Clearance. Both shipped rings were cut taut against the inside kerb, which
// was right for a driver that swung wide of everything it aimed at: the old
// one spent a quarter of the lap with a wheel off and none of it in trouble.
// A driver that *tracks* the line inherits the kerb instead — the same ring
// drove 58% of the lap off the road, a tenth of it half the car deep.
//
// Rather than re-cut the shipped circuits for one driver, the ring is pushed
// off the edge where it does not fit, by sampling the same road field the
// physics collide against. It is one-sided on purpose: a point with room for
// the car either side is left exactly where it was authored, so the taut
// corner-cutting line — which was measured faster than a textbook racing line
// — survives everywhere it is legal, and only the kerbs move.
//
// What sets the distance is tracking error, not the car: it is half a car wide,
// and it still wants 54px because at a hairpin it runs up to 47px off its own
// line. This is a cliff and not a dial — 34px leaves the dry lap at 0.159 of
// off-road drag, 54 at 0.017, 64 at 0.008, and 74 pinches the line badly enough
// that the driver starts braking for its own kerbs (10.9s becomes 13.9s). 54
// buys the margin.
const RING_CLEARANCE = 54; // world px probed either side
const RING_CLEAR_STEP = 8; // world px moved per pass
const RING_CLEAR_PASSES = 6; // enough to walk a point clear of the widest overhang

// Where to point: a fixed distance ahead along that line — pure pursuit. The
// bound at both ends is the whole tuning. Too short and the loop is under-
// damped: at 14 frames, under the car's own 117px turn radius at pace, it wove
// down the straights and lost 2s a lap to the scrub. Too long and it stops
// tracking the line and takes the chord across it — at 26 frames on the raw
// markers, 72% of the lap had a wheel off the road.
const LOOKAHEAD_FRAMES = 20; // frames of travel the aim point runs ahead
const LOOKAHEAD_MIN = 70; // world px — floor, so a stopped car still has a target
const LOOKAHEAD_MAX = 190; // world px — ceiling

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

// Rain. Grip scales, so the driver gives the corner more room and brakes
// earlier for it. The five WET_* constants that used to live here existed only
// to undo the opponents' double grip and to hand back the pace that cost them;
// with one car on the grid there is nothing to undo.
//
// Before 0.14.0 this constant carried the *whole* balance of a wet race,
// because the player was barely slowed by rain and the opponents were slowed
// by this number alone — nothing the rain touched limited the player (max
// speed untouched, cornering geometric, and the friction bonus made a
// coasting car shed *less*), so the corner margin below was the only knob
// that made rain cost anyone anything. Driving the dry policy through a fully
// wet lap cost 0.7s — the whole physical price of rain, and what a player who
// didn't lift paid.
//
// rain.js's own constants changed that: GRIP_PENALTY dropped (0.55 → 0.42),
// the friction bonus that used to give a wet car *more* coasting speed is
// gone, and a puddle underfoot now costs extra grip of its own
// (`Rain.puddleGripAt`), gated on actual speed so it reads as aquaplaning
// rather than a second ambient penalty. That is real physics, and it falls on
// the player exactly as it falls on every AICar — the dry-policy-through-rain
// measure above is now 1.4s/lap (Phaser build, Super Circuit, deterministic
// reference car per the harness below), double what it was.
//
// WET_MARGIN's job has shrunk accordingly: it no longer has to make up for an
// unaffected player, just add a little extra caution on top of a corner grip
// everyone already pays for — so this went *up* (gentler cut), not down.
// Per lap, one deterministic reference car (skill 1, no wander, no line
// offset, player argument nulled to kill catch-up — see ai-wet-margin in
// memory for the harness): Super Circuit 100cc dry 9.85s, wet at 1.0 (physics
// only) 11.23s, wet at this value 11.37s. The margin's own contribution is
// ~0.15s now, down from most of a 2-second swing pre-0.14.0; wheel-off stays
// flat at ~2% either side of it, so the extra caution buys style, not safety,
// on this circuit. Only Super Circuit was re-measured this session — Snake
// Valley hasn't been checked against the new physics yet.
const WET_MARGIN = 0.85; // fraction of the dry corner margin when fully wet

// Catch-up, measured as a gap in waypoints along the track rather than in
// straight-line pixels — two cars either side of a hairpin are close in
// pixels and half a corner apart in the race. Equal machinery means this can
// no longer be top speed: a trailing car that out-drags the player is driving
// a faster car, which is the thing this rewrite exists to end. It buys
// aggression instead — later braking and more of the geometric limit — so
// they close in the corners, where a driver can actually find time.
const CATCHUP_GAIN = 0.12; // max fraction added to the corner margin
const CATCHUP_FULL = 1200; // world px behind at which the gain is maxed

// ...and the mirror of it, which was missing until 0.15.0: the band only ever
// helped an opponent that was *behind* the player, which is the one case the
// player does not need help with. Drop to last and nothing in the driver knew
// it was clear, so the field simply drove away and the race was over on lap
// one.
//
// This is still not top speed. `maxSpeed` remains the single number
// applyCarStats() hands every car; a clear leader just stops asking for all of
// it, the way a driver with a pit board sits off the limit. Both halves fall
// off with the gap and are zero at zero, so a leader being caught is back on
// the shipped pace on the same frame — the racing the player actually sees,
// wheel to wheel, is untouched. Only the drive away from a beaten player is.
//
// Two terms because a corner margin alone cannot be felt from behind: neither
// shipped circuit binds the speed model everywhere, so on the long runs the
// leader would ease nothing at all. The lift is what closes a straight; the
// ease is what stops the lift being handed straight back at the next corner.
//
// The dead zone is the half of this that had to be measured. Catch-up ramps
// from zero because a car right behind the player should already be trying;
// a leader is the opposite — a four-second margin at half distance is a race,
// not a beaten player, and a band that has already given away most of its
// lift there is rubber-banding a fight the player is still in. Super Circuit
// is ~5700 world px round, so these two are "nothing inside three seconds,
// everything by a lap down".
//
// Measured on Super Circuit, 100cc, dry, seeded, the five-car field driving
// against a ghost player lapping at a fixed pace (a parked player saturates
// the band by accident, and the real car cannot be driven headlessly) — mean
// best lap over the field, and how far up the road the field is after four
// laps:
//
//   ghost 15.0s/lap (beaten)   10.53s → 10.95s  (+4.0%), 560 → 525 ring pts
//   ghost 10.5s/lap (racing)   10.32s → 10.69s  (+3.6%), 253 → 218 ring pts
//
// The second line is the one to watch when re-tuning: a ghost only 2% off the
// field's own pace still ends the run four seconds down, which is past the
// dead zone — so "racing" here means the gap that *accumulates* over five
// laps, not a car in the mirrors. Widening LEAD_FROM is what buys that back.
const LEAD_LIFT = 0.08; // max fraction of top speed a clear leader gives away
const LEAD_EASE = 0.1; // max fraction off the corner margin, same conditions
const LEAD_FROM = 1500; // world px ahead before any of it starts
const LEAD_FULL = 6000; // world px ahead at which both are maxed

// Avoidance is a driver behaviour, so it moves the aim point rather than the
// velocity. Shoving velocity around directly — which is what this used to do
// — is a force no player has, and it let the field untangle itself out of
// contact the player had to steer out of.
const AVOID_RADIUS = 120; // px — start aiming away at this distance
const AVOID_STRENGTH = 55; // px of lateral aim offset at full closeness

// Index of the ring point nearest a position. Both cars are measured the same
// way so the systematic offset between "closest point" and "point being
// chased" cancels out of the gap.
function nearestPoint(x, y, pts) {
  let best = 0;
  let bestSq = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const dx = pts[i].x - x;
    const dy = pts[i].y - y;
    const dSq = dx * dx + dy * dy;
    if (dSq < bestSq) {
      bestSq = dSq;
      best = i;
    }
  }
  return best;
}

// Radius of the circle through a point and its neighbours `span` either side —
// the corner, as the line actually describes it. Three collinear points give
// zero area and an infinite radius, which is a straight and exactly the right
// answer. The span is what makes it readable on a 20px ring: neighbours that
// close are a straight everywhere, corners included.
function cornerRadius(pts, i, span) {
  const n = pts.length;
  const a = pts[(((i - span) % n) + n) % n];
  const b = pts[i];
  const c = pts[(i + span) % n];

  const ab = Math.hypot(b.x - a.x, b.y - a.y);
  const bc = Math.hypot(c.x - b.x, c.y - b.y);
  const ca = Math.hypot(a.x - c.x, a.y - c.y);
  const area2 = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));

  if (area2 < 1e-6) return Infinity;
  return (ab * bc * ca) / (2 * area2);
}

// The markers, resampled at RING_SPACING and rounded — see THE LINE above.
// Built once and cached: the checksum is over the *markers*, so a dozen of
// them cost nothing to re-check every frame, and the ring rebuilds itself
// while the waypoint editor is dragging one about.
let ringCache = { key: 0, count: 0, cleared: false, ring: null };

function smoothRing(pts) {
  const m = pts.length;
  const out = new Array(m);
  for (let i = 0; i < m; i++) {
    let sx = 0;
    let sy = 0;
    for (let k = -RING_SMOOTH_SPAN; k <= RING_SMOOTH_SPAN; k++) {
      const q = pts[(((i + k) % m) + m) % m];
      sx += q.x;
      sy += q.y;
    }
    out[i] = {
      x: sx / (2 * RING_SMOOTH_SPAN + 1),
      y: sy / (2 * RING_SMOOTH_SPAN + 1),
    };
  }
  return out;
}

// One pass of the clearance walk: every point that has the road field falling
// away on one side within RING_CLEARANCE steps away from it, sideways only.
// Moving a point *along* the line would shuffle the spacing and, at a hairpin,
// the order; across it can only change where the corner is taken.
function clearRing(pts) {
  if (typeof worldTrack === "undefined" || !worldTrack.field) return pts;

  const m = pts.length;
  const out = new Array(m);
  for (let i = 0; i < m; i++) {
    const a = pts[(i - 1 + m) % m];
    const b = pts[(i + 1) % m];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;

    const p = pts[i];
    const left = worldTrack.sampleRoad(
      p.x - nx * RING_CLEARANCE,
      p.y - ny * RING_CLEARANCE,
    );
    const right = worldTrack.sampleRoad(
      p.x + nx * RING_CLEARANCE,
      p.y + ny * RING_CLEARANCE,
    );

    // Only the side that is actually off the road pulls. Both clear, or both
    // gone — a point stranded on the grass has no side to prefer — and it
    // stays put.
    let push = 0;
    if (left < 0.5 && right >= 0.5) push = 1;
    else if (right < 0.5 && left >= 0.5) push = -1;

    out[i] = {
      x: p.x + nx * push * RING_CLEAR_STEP,
      y: p.y + ny * push * RING_CLEAR_STEP,
    };
  }
  return out;
}

function buildRing(waypoints) {
  let pts = [];
  const n = waypoints.length;
  for (let i = 0; i < n; i++) {
    const a = waypoints[i];
    const b = waypoints[(i + 1) % n];
    const steps = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / RING_SPACING));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }

  const m = pts.length;
  for (let pass = 0; pass < RING_SMOOTH_PASSES; pass++) pts = smoothRing(pts);
  for (let pass = 0; pass < RING_CLEAR_PASSES; pass++) {
    pts = smoothRing(clearRing(pts));
  }

  // Per-point corner radius and the length of the segment leaving it, both
  // wanted every frame by every car and neither of them changing.
  const radius = new Array(m);
  const seg = new Array(m);
  for (let i = 0; i < m; i++) {
    radius[i] = cornerRadius(pts, i, RING_CURV_SPAN);
    const b = pts[(i + 1) % m];
    seg[i] = Math.hypot(b.x - pts[i].x, b.y - pts[i].y);
  }
  return { pts, radius, seg };
}

function ringFor(waypoints) {
  let key = 0;
  for (let i = 0; i < waypoints.length; i++) {
    key = (key + waypoints[i].x * 3 + waypoints[i].y * 7) % 1e9;
  }
  // `cleared` is part of the key: a ring built before the road field was
  // rasterised never had a kerb to be pushed off, and has to be thrown away
  // once there is one.
  const cleared = typeof worldTrack !== "undefined" && !!worldTrack.field;
  if (
    !ringCache.ring ||
    ringCache.key !== key ||
    ringCache.count !== waypoints.length ||
    ringCache.cleared !== cleared
  ) {
    ringCache = { key, count: waypoints.length, cleared, ring: buildRing(waypoints) };
  }
  return ringCache.ring;
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
    this.startDelay = Math.random() * 100; // ms

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
  rollDriver() {
    const lo = tunedAI("aiSkillMin", SKILL_MIN);
    const hi = tunedAI("aiSkillMax", SKILL_MAX);
    this.skill = lo + Math.random() * (hi - lo);
    this.lineOffset =
      (Math.random() - 0.5) * tunedAI("aiLineOffsetRange", LINE_OFFSET_RANGE);
    this.wander = Math.max(0, (1 - this.skill) * WANDER_PX);
    this.wanderPhase = Math.random() * Math.PI * 2;
  }

  // How much of the geometric corner limit this driver is willing to use,
  // this frame: their own skill, less what the rain has taken, plus whatever
  // being behind is worth — or minus what being clear is.
  cornerMargin(catchup, lead = 0) {
    const wet = 1 - Rain.intensity * (1 - WET_MARGIN);
    const base = tunedAI("aiCornerMargin", CORNER_MARGIN) * wet;
    return base * this.skill * (1 + catchup * CATCHUP_GAIN - lead * LEAD_EASE);
  }

  // The fastest this car can be going *now* and still be down to every corner
  // in range by the time it reaches it. Each point of line in the scan
  // contributes sqrt(v² + 2·a·d) — the arrival speed its radius allows, worked
  // back over the distance still to run — and the driver obeys the tightest.
  targetSpeed(ring, margin, lift = 0) {
    const n = ring.pts.length;
    let limit = this.maxSpeed * (1 - lift * LEAD_LIFT);
    let d = Math.hypot(
      ring.pts[this.currentWaypoint].x - this.x,
      ring.pts[this.currentWaypoint].y - this.y,
    );

    for (let step = 0; step < n; step++) {
      const i = (this.currentWaypoint + step) % n;

      const r = ring.radius[i];
      if (r !== Infinity) {
        const corner = r * this.turnSpeed * margin;
        const allowed = Math.sqrt(corner * corner + 2 * this.acceleration * d);
        if (allowed < limit) limit = allowed;
      }

      d += ring.seg[i];
      if (d > LOOKAHEAD_DIST) break;
    }
    return limit;
  }

  // How far down the segment leading to the point being approached the car is,
  // as a fraction. It is a projection and not a proximity test: a car shoved
  // wide, or one taking a metre of line offset, is still level with the same
  // piece of track, where a radius check either advances it early or strands it
  // against a point it never passes close enough to.
  segmentProgress(ring) {
    const n = ring.pts.length;
    const prev = ring.pts[(this.currentWaypoint - 1 + n) % n];
    const cur = ring.pts[this.currentWaypoint];
    const vx = cur.x - prev.x;
    const vy = cur.y - prev.y;
    const len2 = vx * vx + vy * vy || 1;
    const t = ((this.x - prev.x) * vx + (this.y - prev.y) * vy) / len2;
    return { prev, cur, t: Math.min(1, Math.max(0, t)), passed: t >= 1 };
  }

  // Commit to the next point of line once the car is level with this one.
  // Bounded by the ring length so a car facing the wrong way down the track
  // cannot walk the whole lap in one frame.
  advancePath(ring) {
    const n = ring.pts.length;
    for (let step = 0; step < n; step++) {
      if (!this.segmentProgress(ring).passed) return;
      this.currentWaypoint = (this.currentWaypoint + 1) % n;
    }
  }

  // Where to point: a point LOOKAHEAD further along the line, pushed sideways
  // by this driver's line offset and again by anyone close enough to hit.
  aimPoint(ring, others) {
    const n = ring.pts.length;
    const { prev, cur, t } = this.segmentProgress(ring);

    // Walk on round the ring from the point the car is level with until the
    // lookahead is spent. Distance is measured along the line rather than
    // straight from the car, so the target keeps its distance through a corner
    // instead of being dragged across it.
    let ahead = Math.abs(this.speed) * LOOKAHEAD_FRAMES;
    ahead = Math.min(LOOKAHEAD_MAX, Math.max(LOOKAHEAD_MIN, ahead));

    let x = prev.x + (cur.x - prev.x) * t;
    let y = prev.y + (cur.y - prev.y) * t;
    let dirX = cur.x - prev.x;
    let dirY = cur.y - prev.y;
    for (let step = 0; step < n; step++) {
      const wp = ring.pts[(this.currentWaypoint + step) % n];
      const dx = wp.x - x;
      const dy = wp.y - y;
      const d = Math.hypot(dx, dy);
      if (d > 0) {
        dirX = dx;
        dirY = dy;
        if (d >= ahead) {
          x += (dx / d) * ahead;
          y += (dy / d) * ahead;
          break;
        }
        ahead -= d;
      }
      x = wp.x;
      y = wp.y;
    }

    // Perpendicular offset for a varied racing line, off the direction the
    // ring runs where the aim point landed.
    const perpX = dirY;
    const perpY = -dirX;
    const perpLen = Math.hypot(perpX, perpY) || 1;

    const lateral =
      this.lineOffset + Math.sin(this.wanderPhase) * this.wander;
    x += (perpX / perpLen) * lateral;
    y += (perpY / perpLen) * lateral;

    const radius = tunedAI("aiAvoidRadius", AVOID_RADIUS);
    const strength = tunedAI("aiAvoidStrength", AVOID_STRENGTH);
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

    const ring = ringFor(waypoints);
    const n = ring.pts.length;

    // Advance once, here. There used to be a second check at the bottom of
    // this function testing the *same* proximity against a tighter radius, so
    // any close approach burned two waypoints in one frame and the car cut the
    // corner that followed.
    this.advancePath(ring);

    const aim = this.aimPoint(ring, others);

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

    // Catch-up, in track run along the line rather than pixels of separation.
    // Signed: behind the player it buys aggression, ahead of them it pays some
    // back. Only one of the two is ever non-zero.
    let catchup = 0;
    let lead = 0;
    if (player) {
      const mine = nearestPoint(this.x, this.y, ring.pts);
      const theirs = nearestPoint(player.x, player.y, ring.pts);
      let gap = (((mine - theirs) % n) + n) % n;
      if (gap > n / 2) gap -= n; // signed — negative is behind the player
      if (gap < 0) catchup = Math.min((-gap * RING_SPACING) / CATCHUP_FULL, 1);
      else
        lead = Math.min(
          Math.max((gap * RING_SPACING - LEAD_FROM) / (LEAD_FULL - LEAD_FROM), 0),
          1,
        );

      // The index gap wraps at half a lap, so a car more than that clear reads
      // as being just as far *behind*. That was survivable while the band only
      // added aggression to a trailing car; with a lift on the other side the
      // sign flip is a cliff, and it lands on exactly the player this exists
      // for — the one being lapped, who would watch the leader answer by
      // driving harder. Lap count breaks the tie: it is coarse, but it is
      // unambiguous, and it only has to decide which side of zero we are on.
      const lapGap = this.laps - player.laps;
      if (lapGap > 0) {
        lead = 1;
        catchup = 0;
      } else if (lapGap < 0) {
        catchup = 1;
        lead = 0;
      }
    }

    // PEDALS. The corner limit, less a lift for being badly mis-pointed —
    // floored at zero so a car that has been spun is never handed a negative
    // target and asked to reverse out of it.
    const headingErr = Math.min(Math.abs(angleDiff) / Math.PI, 1);
    const target =
      this.targetSpeed(ring, this.cornerMargin(catchup, lead), lead) *
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
