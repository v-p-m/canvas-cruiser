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
