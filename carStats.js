// The car's numbers — one set, for the player and every opponent alike, and one
// set across both pages: the game (index.html, Phaser) and the editor
// (editor.html, the legacy loop that hosts the track and waypoint tools).
//
// The opponents used to take their acceleration, grip and lock from a second
// set of numbers, so nothing tuned for the player ever transferred and every
// attempt to balance the field moved a value that only existed on one side of
// the grid. These are those numbers, and there is exactly one of them.
//
// `mods` is the only sanctioned way for one car to differ, and it is a part
// fitted to a car — not a handicap given to a driver. What makes one opponent
// slower than another, and slower than the player, is `AICar.rollDriver()`:
// skill scales how much of the geometric corner limit the driver dares use and
// how much its aim wanders, and it loses the time in the corners the way a
// worse driver actually does. Reaching for a stat here instead is the
// regression CLAUDE.md warns about.

// Coasting decay. Not tunable because the rain's FRICTION_BONUS was defined as
// an offset from it, and a second copy of the number is how those two drifted
// apart before.
const CAR_FRICTION = 0.96;

// The 100cc baseline. What the cars actually get is these times the selected
// engine class's multiplier — applyCarStats() below is where the two meet, so
// there is one place that multiplies. Only speed and acceleration scale by
// class; turn speed and grip deliberately do not (see engineClass.js).
const CAR_STATS = {
  acceleration: 0.2,
  maxSpeed: 10,
  turnSpeed: 0.06,
  driftGrip: 0.1,
};

// Steering feel. The lock used to be a switch: any frame with left or right
// held turned the car at exactly `turnSpeed`, from the first frame, at every
// speed. That is what makes a tap cost twenty degrees and a twitch at the top
// of the range snap the car sideways. It lives here rather than in either of
// the two step functions because the player and the AI have to steer the same
// car (see CLAUDE.md's last convention).
//
// The lock ramps in instead of snapping to full, and how long that ramp takes
// is what scales with speed — not the lock it arrives at. That distinction is
// the whole design:
//
//   * a flick is caught near the bottom of the ramp, so it is worth under a
//     degree instead of seven, and the faster the car the less it buys;
//   * a corner is held long enough to reach the top of the ramp, so the
//     steady-state lock is still `turnSpeed` and a corner is still worth
//     exactly what it was.
//
// Scaling the *lock* with speed instead does the first job and undoes the
// second — it is a straight cut to how tight a circle the car can describe,
// and it measured -14% of the field's pace at Super Circuit 100cc (a skill-1
// car alone, dry: 10.46s -> 11.96s) for a top-speed radius that only moved
// from 167 to 278 world px. Slowing the ramp costs the turn-in and nothing
// else.
//
// The ramp is a **curve, not a line**, and both of its numbers are a feel
// dial, so it is worth knowing which does what. A linear ramp is slow at both
// ends: it has to be long to make the flick small, and being long is exactly
// what makes the car feel like it will not turn in. Curving it separates the
// two — STEER_RISE_FRAMES_FAST is how soon full lock arrives (the corner), and
// STEER_RISE_CURVE is how hard the bottom of the press is held down (the
// flick). Raising the exponent buys a smaller flick without touching turn-in.
//
// Measured at top speed (100cc, throttle held, degrees of heading bought by
// one press of a given length). The shipped row is `3->8, curve 2`; the others
// were driven and are kept because the shape of the trade is the useful part:
//
//   ramp            50ms     80ms    120ms    200ms    400ms    800ms
//   before          6.60    13.20    19.80    36.31    79.21   161.71
//   3->8, curve 3   0.21     1.54     5.74    23.38    66.30   148.80
//   3->8, curve 2   0.71     3.27     8.91    27.03    69.93   152.44
//   2->6, curve 2   1.40     6.52    15.09    31.58    74.48   157.00
//   2->5, curve 2   2.19    10.22    17.35    33.85    76.76   159.27
//
// Cubing it was tried first and overshot: a deliberate click is 80-120ms, and
// at 1.5-5.7deg that is under a tenth of what the same click used to do, which
// reads as the car ignoring you. Squaring lands a click at a third of its old
// value — small enough to be a correction rather than a lurch, big enough to
// be worth making. Shortening the ramp instead (the 2->6 and 2->5 rows) gets
// there by giving the flick back, which is the thing this exists to remove.
//
// Coming back is not the same motion as going out: a slow return is the car
// declining to be straightened, and a counter-steer would have to cross the
// whole range twice before it answered. STEER_DROP_FRAMES is the rate toward
// centre, and through it.
//
// The scrub is untouched and so is what a corner costs. Driven round a
// constant-radius turn at full throttle, speed at any given angle of heading
// turned is within 0.15 of what it was (6.93 against 6.83 at 69deg) and both
// settle at the same 4.83. What a corner costs is *time*: full lock arrives
// 133ms in rather than on the first frame.
//
// That time is what the lap pace below is, a skill-1 car alone on the circuit,
// no catch-up, mean of four flying laps:
//
//   Super 100cc dry   10.46 -> 10.99  (+5.1%)
//   Super 100cc wet   12.84 -> 14.45  (+12.6%)
//   Super 250cc dry    9.02 ->  9.56  (+6.0%)
//   Snake Valley 100cc 13.30 -> 13.88  (+4.4%)
//
// Most of that is the *opponents'* controller, not the car: ai.js steers with
// a Schmitt trigger that flips to full lock and back within a few frames, and
// any ramp at all costs it those pulses. A ramp reaching full lock in 50ms —
// three frames, barely a ramp — still measured +4.3% at Super 100cc, so only
// about a point of the figures above is the length tuned here. A human does
// not steer in two-frame pulses and will not pay that part.
const STEER_RISE_FRAMES = 3; // frames from centre to full lock, at a standstill
const STEER_RISE_FRAMES_FAST = 8; // ... and at maxSpeed
const STEER_RISE_CURVE = 2; // exponent on the ramp; 1 is a straight line
const STEER_DROP_FRAMES = 5; // frames back to centre, or across it

// Walks the car's steering toward what the driver is asking for and returns
// the lock it has this frame, signed: -1 is full left, +1 full right. Both
// keys held cancel to centre, exactly as the old pair of opposed `if`s did.
//
// The ask is either the keyboard's two booleans or `input.steer`, a lock
// between -1 and 1, which wins when it is there. A key is a switch, and the
// only way a human can ask for less than everything is to hold it for less
// time — which is exactly what the ramp above turns into a partial lock. A
// driver that is not a pair of switches can say how much it wants outright,
// and ai.js does. What it gets is a steering wheel, not a quicker car: the
// ramp, the rates and the lock at the top of them are the ones below, so a
// held request settles at the same `turnSpeed` the player's key does.
//
// Two fields, because the ramp is curved: `steerHold` is how far up the ramp
// the ask has walked, and `steerLock` is what that is worth. Rate limiting the
// lock directly instead would make the curve a lie — the drop rate would apply
// to the curved value, so a release from full lock would take a different time
// than a release from half.
function stepSteerLock(entity, input, delta) {
  const want =
    typeof input.steer === "number"
      ? Math.max(-1, Math.min(1, input.steer))
      : (input.right ? 1 : 0) - (input.left ? 1 : 0);

  // The ramp is walked in hold units and `want` is a lock, so a proportional
  // ask has to be un-curved on the way in: half lock has to buy half the yaw,
  // not the quarter the curve would otherwise make of it. Centre and full lock
  // are fixed points of that, so the keyboard's path through here is untouched.
  const target =
    want === 0
      ? 0
      : Math.sign(want) * Math.pow(Math.abs(want), 1 / STEER_RISE_CURVE);

  let hold = entity.steerHold || 0;
  const t = entity.maxSpeed
    ? Math.min(1, Math.abs(entity.speed) / entity.maxSpeed)
    : 0;
  const rise =
    STEER_RISE_FRAMES + (STEER_RISE_FRAMES_FAST - STEER_RISE_FRAMES) * t;
  // Away from centre is the ramp; toward it — or through it, which is what a
  // counter-steer is — is the fast rate. Winding *off* part of a lock that is
  // still held is a release too, and goes at the same rate: only the hand
  // going on the wheel is slow.
  const winding =
    target !== 0 && hold * target >= 0 && Math.abs(target) > Math.abs(hold);
  const frames = winding ? rise : STEER_DROP_FRAMES;
  const step = delta / frames;
  if (hold < target) hold = Math.min(target, hold + step);
  else if (hold > target) hold = Math.max(target, hold - step);
  entity.steerHold = hold;
  entity.steerLock =
    Math.sign(hold) * Math.pow(Math.abs(hold), STEER_RISE_CURVE);
  return entity.steerLock;
}

// Both halves of the ramp, back to centre. A car put back on the grid with a
// lock still wound on drives off the line steering, so every respawn has to
// clear this the way it clears the speed.
function resetSteerLock(entity) {
  entity.steerHold = 0;
  entity.steerLock = 0;
}

const NO_MODS = Object.freeze({ speed: 1, accel: 1, turn: 1, grip: 1 });

// The shipped number, unless the editor page's slider panel is loaded and has
// something to say about it. The game page does not load debugConfig.js at all
// — the panel tunes the legacy physics, and half its sliders would be lying
// about what they control now that the race runs on Matter — so this has to
// answer without it. `values` carries the panel's legacy key names, which is
// why the lookup is `player`-prefixed and this table is not.
function tunedStat(key) {
  const v = typeof DebugConfig === "undefined" ? null : DebugConfig.values;
  const k = `player${key[0].toUpperCase()}${key.slice(1)}`;
  return v?.[k] ?? CAR_STATS[key];
}

function applyCarStats(entity) {
  const mods = entity.mods || NO_MODS;
  entity.acceleration =
    tunedStat("acceleration") * EngineClass.accelScale() * mods.accel;
  entity.maxSpeed = tunedStat("maxSpeed") * EngineClass.speedScale() * mods.speed;
  entity.turnSpeed = tunedStat("turnSpeed") * mods.turn;
  entity.driftGrip = tunedStat("driftGrip") * mods.grip;
  entity.friction = CAR_FRICTION;
}
