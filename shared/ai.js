// The opponents drive the player's car.
//
// They used to drive a different one — twice the grip, a proportional
// steering controller that could swing the nose four times faster than the
// player's lock, a speed ceiling off the road instead of the player's drag,
// and no cornering scrub. Nothing tuned for the player ever transferred, and
// every attempt to balance the field moved a number that only existed on one
// side of the grid. What follows is a *driver*: it reads the track and works
// the same controls the keyboard does — the throttle and the brake as the
// keyboard's own booleans, the steering as a lock on the wheel the player's
// keys wind — and `stepCarControls` / `stepCarMotion` in game.js are the whole
// of the physics for both.
//
// The consequence worth holding on to while tuning: at the player's grip the
// cars cannot hold the line flat out. Anticipatory corner braking was
// measured here as not worth it and the comment said so for a year — that
// reading was taken at the old 0.2 grip and does not survive the change.
// Braking for corners is now the single largest thing the driver does.

// Corner speed comes out of the steering geometry, not a friction circle. At
// full lock the heading turns at exactly `turnSpeed`, so the tightest path the
// car can sweep has radius speed / turnSpeed however sideways the grip is
// letting it sit. Invert that and a corner of radius R can be carried at
// R * turnSpeed.
//
// It is a ceiling, and it stays one under a proportional controller: at the
// margin below the corner only needs that fraction of the lock, and the
// controller asks for exactly what the error is worth — up to all of it for
// anything tighter, which is what keeps the ceiling reachable and this line
// true. The carStats.js ramp is on the same side of it: it scales the *time*
// to full lock and not the lock, so what a corner costs is a moment of
// turn-in, not radius.
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
const SKILL_MIN = 0.80;
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

// The steering controller. This was a Schmitt trigger until 0.18.0 — full lock
// the frame the heading error passed 0.6 frames of it (~2.1 degrees), nothing
// again below 0.3 — because the driver's only output was the keyboard's two
// booleans and there is no way to ask a switch for a third of the wheel. It
// worked while a key bought full lock on the frame it went down: a corner
// needing 60% of the lock was driven as 60% duty cycle, one to three frames on
// and one to two off, and the mean came out right. It also looked like exactly
// what it was. Traced over a lap it is a square wave — 31% of frames at full
// lock, 69% at dead centre and *nothing at all* in between — and that is the
// "snapping between headings" this replaces.
//
// carStats.js's ramp did not fix that and could not: it fills the histogram in
// (50% near centre, 14% still pinned at full lock) but the wheel is still being
// thrown from one stop toward the other, and the pulse no longer buys the lock
// it used to, so the duty cycle stopped adding up. Held against the same lap
// through the same corners, this controller reaches full lock on 0.5% of
// frames, moves the wheel 0.053 of its range per frame against the trigger's
// 0.087 and the pre-ramp trigger's 0.371, and crosses centre 3 times a run
// where they cross it 22 and 43.
//
// So the driver asks for a lock instead — `input.steer`, honoured by
// `stepSteerLock` — and the ask has two parts:
//
//   * SWEEP, the rate the aim line is itself turning at, divided by the lock
//     that rate is worth. This is the whole of a steady corner, and it is what
//     makes the loop settle with the nose *on* the aim point rather than
//     beside it. Without it a proportional controller has to sit a standing
//     error to keep asking for the lock it needs, so the car tracks the line
//     from outside it and every gain is slower than the trigger: 11.10s at the
//     stiffest usable gain against the trigger's 11.00, and monotonically
//     worse from there (11.17 / 11.26 / 11.37 / 11.53 / 11.73 at gain 1.5
//     through 6, and the same shape on Snake Valley). With it, 10.85.
//   * GAIN, the error the rest of the wheel is worth, in frames of the car's
//     own lock — the trigger's unit, and the one that stays meaningful when
//     `turnSpeed` moves. It only has the transients to handle, so it sits on a
//     plateau rather than a cliff: 10.867 / 10.864 / 10.845 / 10.854 at 1, 2,
//     3 and 4. 3 is the middle of it and the smoothest of the four.
//
// SWEEP is 1 because 1 is the identity — supply exactly the turn rate the line
// is asking for — and either side of it measured worse for the reason you
// would expect: 0.5 under-turns and gives most of the gain back (11.08), 1.5
// over-turns and buys 0.07s by putting the wheels on the kerbs, 0.4% of a lap
// off the road to 0.9%. Differencing the raw aim bearing instead of the
// crab-compensated angle the driver is actually tracking is worse in the dry
// (10.93) and much worse in the wet (15.44): the slip is part of what the
// wheel has to supply, not noise on top of it.
//
// SLACK is the deadband, and it is on the finished ask rather than on the
// error, because what it is really for is letting the wheel come back to
// *exactly* centre. `stepCarControls` charges cornering scrub on any frame the
// lock is non-zero, so a controller that always asks for a little is always
// paying, and hands are off the wheel far less than the trigger's release half
// ever was. It is a straight trade against precision — dry 10.851 / 10.854 /
// 10.925 / 11.021 / 11.149 and wet 15.213 / 15.098 / 15.085 / 15.021 / 14.966
// at 0, 0.05, 0.10, 0.20 and 0.35 — so it is set where the dry is still free.
//
// Two things this does not fix, and they are the same thing. The scrub gate is
// most of what the trigger's pace ever was: pre-0.18.0 code, the trigger, no
// ramp, and the gate held open for the one line's difference laps 11.02s
// against 10.46s — the entire 0.18.0 regression, before any of this existed.
// No smooth controller can dodge frames the way a square wave does, and it
// costs most in the wet, where the slide saturates the scrub's own slip term
// and the trigger is at dead centre 41% of the time. Judge the two drivers
// with that gate open, which is the only way to compare them on the wheel
// rather than on the loophole, and this one is quicker everywhere:
//
//   dry / wet            gate as shipped        gate held open
//   0.18.0 trigger       10.998 / 14.442        11.162 / 15.485
//   this controller      10.854 / 15.098        10.864 / 15.277
//
// The right-hand column is the comparison; the left-hand one is what ships.
// Read the rows the other way and the same thing shows up as an asymmetry:
// opening the gate costs the trigger 1.5% dry and 7% wet, and costs this
// controller 0.1%, because it was never taking the discount. WET_MARGIN cannot
// buy the wet column back — 0.70 measures 15.40 and 1.00 measures 15.00, so
// more caution is *slower*, not faster: the scrub is charged on time spent
// turning, not on speed carried.
const STEER_GAIN = 3; // frames of lock worth of heading error that asks for all of it
const STEER_SWEEP = 1.0; // of the aim line's own turn rate, fed straight to the wheel
const STEER_SLACK = 0.05; // of the lock — under this the driver asks for nothing at all

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

// TRAFFIC. Avoidance is a driver behaviour, so it moves the aim point and the
// pedals rather than the velocity. Shoving velocity around directly — which is
// what this used to do — is a force no player has, and it let the field
// untangle itself out of contact the player had to steer out of.
//
// What replaced *that* was still not a driver looking where it was going: an
// isotropic push, the aim point shoved directly away from every car inside a
// radius. Directly away from a car dead ahead is backwards, so the one case
// that matters pulled the target into the follower's own bonnet — which
// shortens the lookahead instead of picking a side — and nothing anywhere ever
// lifted. The driver braked for corners and drove into cars.
//
// So the field is read the way the line already is: where each car sits
// *along* the ring, and how far it is *across* it. Both come off the ring
// rather than off the bonnet, because a cone in the car's own heading frame
// loses the car in front halfway round every corner, which is exactly where it
// is about to hit it.
//
// Those two numbers are the two things a driver actually does about traffic:
//
//   * PULL OUT, while there is road to pull out onto — a lateral offset on the
//     aim point, away from the side the other car is on, through the same
//     wheel the line offset and the wander already turn. It is probed against
//     `worldTrack.sampleRoad` before it is taken, so a dodge is a lane change
//     and never a trip through the grass.
//   * LIFT, which is what is left when there is nowhere to go. Being down to
//     the speed of the car in front by the time you reach it is the same
//     problem as being down to the corner's speed by the time you reach that,
//     so it is the same arithmetic — sqrt(v² + 2·a·d) over the gap that is
//     left — and the pedals obey whichever of the two is tighter.
//
// Both fall to nothing as the gap opens, so a car in clear air drives the
// shipped line at the shipped pace: this can only cost time where it is buying
// something, and what it buys is a crash that does not happen.
//
// Measured on the game page, seeded, five cars with the skill spread pinned so
// both arms race the same drivers, four laps each. A contact is a
// `collisionstart` pair. "Clear" is the field alone on the circuit; "blocked"
// parks a sixth car on the racing line and holds it there, so the only
// question the run asks is what the field does when it arrives at something
// that will not move:
//
//                        clear             blocked
//                        contacts   lap    contacts  hit it  wings lost
//   Super 100cc  before      43.2  11.420     133.2    17.2      8.4
//                after        4.2  11.450       5.4     5.8      0.6
//   Snake Valley before      23.7  14.057     129.7    16.7      8.7
//                after        8.0  14.073       5.0    12.3      1.7
//   Super 250cc  before      35.7   9.718
//                after        4.0   9.795
//   Super wet    before      45.7  15.298
//                after       15.3  15.471
//
// Ninety per cent of the contact for 0.3% of the lap, and the blocked column
// is what says whether that was worth having: the field used to arrive at a
// stopped car and take its own race apart on it — 133 contacts and eight
// broken wings — where it now files past for five. The pace it does cost is
// the lift, and it lands where more lifting is called for: 0.8% at 250cc and
// 1.1% in the wet. Valley's blocked column is the one that did not come all
// the way — it has the tighter road, so there is more often nowhere to go and
// the drivers queue and nudge instead of passing.
//
// The horizon is not the lever, which is worth knowing before tuning it: at
// 250 / 450 / 700 the contacts are flat (4.3 / 4.0 / 4.7 clear, 6.3 / 5.0 /
// 6.3 blocked) and only the pace drifts, 11.424 / 11.448 / 11.478. It is set
// where it is for a reason the contact count cannot see — v²/2a is a 250px
// braking distance at 100cc and ~350 at 250cc, and a horizon inside that is a
// driver who cannot brake in time however hard it tries.
const TRAFFIC_SCAN = 450; // world px of line ahead searched for traffic
const TRAFFIC_WIDTH = 46; // world px across the line that counts as in the way
const TRAFFIC_GAP = 70; // world px held to the car in front at matched speed

// The pull *is* the lever, and it is a straight trade against the lift it
// saves you from: over 200 / 300 / 450 / 600 px of ramp the contacts fall
// 12.7 / 5.7 / 4.7 / 1.7 and the lap goes 11.399 / 11.429 / 11.450 / 11.530.
// 450 is the knee — past it each further car-length of warning is bought at
// twice the pace, and a driver that eases off the line 600px early for someone
// it was never going to reach is not being careful, it is being timid.
const AVOID_AHEAD = 450; // world px of line ahead the lateral push reaches
const AVOID_WIDTH = 90; // world px across the line the lateral push reaches
const AVOID_BEHIND = 70; // world px of car alongside that still pushes
const AVOID_PULL = 70; // world px of lateral aim offset at full strength
const AVOID_STRAIGHT = 8; // world px of lane offset under which no side is preferred
const TRAFFIC_CREEP = 1.5; // px/frame the lift will not take a blocked car below

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

// Where a point sits across the line: signed distance from the ring point it
// is nearest, measured along the same perpendicular `aimPoint` offsets its
// target along — so a car's lane and a dodge are one number with one sign.
function laneOffset(ring, idx, x, y) {
  const n = ring.pts.length;
  const a = ring.pts[(idx - 1 + n) % n];
  const b = ring.pts[(idx + 1) % n];
  const tx = b.x - a.x;
  const ty = b.y - a.y;
  const len = Math.hypot(tx, ty) || 1;
  return ((x - ring.pts[idx].x) * ty - (y - ring.pts[idx].y) * tx) / len;
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
    this.lastTarget = undefined;
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
    // The steering has one frame of memory (`sweep`), and a car put back on
    // the grid is nowhere near where it was aiming.
    this.lastTarget = undefined;
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
  // by this driver's line offset and again by `dodge`, which is what the
  // traffic scan wants for the car it is trying not to hit.
  aimPoint(ring, dodge) {
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
    const px = perpX / perpLen;
    const py = perpY / perpLen;

    // A dodge is only a lane change if there is a lane to change into. Probe
    // the road field where the offset target would land and hand the pull back
    // in halves until it fits, rather than steering off in the name of not
    // hitting anything: the lift in drive() is what covers a pass that isn't
    // on. Probed at the aim point and not at the car, because the room that
    // decides a move is the room where the move ends up.
    if (dodge !== 0 && typeof worldTrack !== "undefined" && worldTrack.field) {
      for (let tries = 0; tries < 4; tries++) {
        const onRoad =
          worldTrack.sampleRoad(
            x + px * (lateral + dodge),
            y + py * (lateral + dodge),
          ) >= 0.5;
        if (onRoad) break;
        dodge = tries < 3 ? dodge * 0.5 : 0;
      }
    }

    x += px * (lateral + dodge);
    y += py * (lateral + dodge);
    return { x, y };
  }

  // The field, as this driver sees it: for every other car, where it sits
  // along the line being chased and how far it is across it. Ring steps rather
  // than pixels of separation for the same reason catch-up counts them — two
  // cars either side of a hairpin are close in pixels and half a corner apart
  // in the race — and the distance is then summed off `ring.seg` rather than
  // taken as steps × spacing, because the smoothing and the clearance walk
  // both move points and a braking distance wants the real one.
  //
  // Returns the lateral aim offset the driver wants (`dodge`) and the nearest
  // car actually in its path (`block`), which is the one it may have to lift
  // for. Cars behind still push sideways — that is a driver not leaning on
  // someone alongside — but only a car ahead can be lifted for.
  scanTraffic(ring, mine, others, player) {
    const n = ring.pts.length;
    const scan = tunedAI("aiTrafficScan", TRAFFIC_SCAN);
    const pull = tunedAI("aiAvoidPull", AVOID_PULL);
    const myLane = laneOffset(ring, mine, this.x, this.y);

    // The lift and the pull have their own reaches and only the longer of the
    // two decides whether a car is worth looking at at all.
    const range = Math.max(scan, AVOID_AHEAD);

    let dodge = 0;
    let block = null;
    // -1 is the player, who is not in `others` on either page: the field is
    // handed its own cars there, and a driver that is careful with everyone
    // except the one car with a person in it is the one that matters.
    for (let k = -1; k < others.length; k++) {
      const other = k < 0 ? player : others[k];
      if (!other || other === this) continue;

      const idx = nearestPoint(other.x, other.y, ring.pts);
      let steps = (((idx - mine) % n) + n) % n;
      if (steps > n / 2) steps -= n;
      const reach = steps * RING_SPACING; // nominal, and only used to reject
      if (reach > range || reach < -AVOID_BEHIND) continue;

      let gap = 0;
      for (let s = 0; s < Math.abs(steps); s++) {
        gap += ring.seg[(((mine + (steps > 0 ? s : -s - 1)) % n) + n) % n];
      }
      if (steps < 0) gap = -gap;
      if (gap > range || gap < -AVOID_BEHIND) continue;

      const lane = laneOffset(ring, idx, other.x, other.y) - myLane;
      const across = Math.abs(lane);

      // The pull, ramped in both axes so it arrives as a lean on the wheel and
      // not a swerve: full only for a car right on the nose and dead level
      // across the line, nothing at either edge of the box.
      if (across < AVOID_WIDTH && gap < AVOID_AHEAD) {
        const near = gap >= 0 ? 1 - gap / AVOID_AHEAD : 1 + gap / AVOID_BEHIND;
        // A car square in front has no side of its own to be on, so the driver
        // commits to its own preferred line instead of dithering on the sign
        // of a number that is about to change.
        const side =
          across < AVOID_STRAIGHT
            ? this.lineOffset >= 0
              ? -1
              : 1
            : Math.sign(lane);
        dodge -= side * (1 - across / AVOID_WIDTH) * near * pull;
      }

      if (
        gap > 0 &&
        gap < scan &&
        across < TRAFFIC_WIDTH &&
        (!block || gap < block.gap)
      ) {
        block = { gap, speed: Math.max(0, other.speed) };
      }
    }
    return { dodge, block };
  }

  // One frame of driving. Returns the same input object the keyboard fills in
  // for the player, bar the steering, which is a lock rather than two keys;
  // game.js feeds it straight to stepCarControls.
  drive(waypoints, player, others, delta = 1) {
    const idle = { accel: false, brake: false, steer: 0 };
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

    // Where this car is on the ring, once: the traffic scan and the catch-up
    // band below both measure their gaps from it, and both have to measure
    // every car the same way for the systematic offset between "nearest point"
    // and "point being chased" to cancel out of the answer.
    const mine = nearestPoint(this.x, this.y, ring.pts);
    const traffic = this.scanTraffic(ring, mine, others, player);

    const aim = this.aimPoint(ring, traffic.dodge);

    // STEERING. Proportional, in units of the car's own lock, handed on as
    // `input.steer`. The nose is aimed short of the marker by however far the
    // car is already sliding, so it is the velocity that arrives there — see
    // CRAB_COMP.
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
    // How fast the line the driver is tracking is turning, in locks. Taken
    // between frames rather than off the ring's curvature because it has to
    // include the car's own drift across the line, which is most of what a
    // wet lap is; and off `targetAngle` rather than `bearing`, so the slip the
    // crab term is already aiming around is fed to the wheel with it.
    let sweep = 0;
    if (this.lastTarget !== undefined && delta > 0) {
      sweep =
        Math.atan2(
          Math.sin(targetAngle - this.lastTarget),
          Math.cos(targetAngle - this.lastTarget),
        ) /
        delta /
        this.turnSpeed;
    }
    this.lastTarget = targetAngle;
    // The slack is subtracted rather than switched, so the ask stays
    // continuous across its edge: a step there is a trigger again, in
    // miniature, and it saws for the same reason the old one did.
    const want =
      sweep * STEER_SWEEP + angleDiff / this.turnSpeed / STEER_GAIN;
    const live = Math.max(0, Math.abs(want) - STEER_SLACK);
    const steer = Math.max(-1, Math.min(1, Math.sign(want) * live));

    // Catch-up, in track run along the line rather than pixels of separation.
    // Signed: behind the player it buys aggression, ahead of them it pays some
    // back. Only one of the two is ever non-zero.
    let catchup = 0;
    let lead = 0;
    if (player) {
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
    let target =
      this.targetSpeed(ring, this.cornerMargin(catchup, lead), lead) *
      Math.max(0, 1 - headingErr * HEADING_BRAKE);

    // ...and down to the speed of the car in front by the time we arrive at
    // it, which is the corner model's own arithmetic run over the gap that is
    // left once the following distance is taken out of it. It is a ceiling
    // like the corner is, so the tighter of the two is what the pedals see,
    // and it lets go the moment the dodge above has taken the car out of the
    // corridor — which is what makes this a pass rather than a queue.
    if (traffic.block) {
      const room = Math.max(
        0,
        traffic.block.gap - tunedAI("aiFollowGap", TRAFFIC_GAP),
      );
      const follow = Math.sqrt(
        traffic.block.speed * traffic.block.speed +
          2 * this.acceleration * room,
      );
      // Never all the way to a stop, and this is not a nicety: a car whose
      // target is zero asks for neither pedal, so it sits at zero forever.
      // Steering does not save it — `angle` is written whatever the speed, so
      // it can turn its wheel all it likes and still never roll anywhere the
      // dodge is pointing, and the scan it is stopped by does not change
      // either. Measured against a car parked on the racing line, two of five
      // drivers stopped nose to tail behind it and stayed there for the rest
      // of the race. A creep is what a driver in that position actually does:
      // keep rolling, and go round.
      target = Math.min(target, Math.max(follow, TRAFFIC_CREEP));
    }

    // No `left`/`right`: a pair of booleans could only say "all of it", which
    // is the thing this stopped doing. `stepSteerLock` reads whichever of the
    // two the caller supplies.
    return {
      accel: this.speed < target,
      brake: this.speed > target + BRAKE_BAND,
      steer,
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
