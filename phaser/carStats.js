// The car's numbers — one set, for the player and every opponent alike.
//
// This is `applyCarStats()` out of game.js, ported across unchanged. It gets a
// file of its own rather than a literal in the scene because the whole point of
// it is that there is exactly one of it. The opponents used to take their
// acceleration, grip and lock from a second set of numbers, so nothing tuned
// for the player ever transferred and every attempt to balance the field moved
// a value that only existed on one side of the grid.
//
// `mods` is the only sanctioned way for one car to differ, and it is a part
// fitted to a car — not a handicap given to a driver. What makes one opponent
// slower than another, and slower than the player, is `AICar.rollDriver()`:
// skill scales how much of the geometric corner limit the driver dares use and
// how much its aim wanders, and it loses the time in the corners the way a
// worse driver actually does. Reaching for a stat here instead is the
// regression CLAUDE.md warns about.

// Coasting decay. Not a slider because the rain's FRICTION_BONUS is defined as
// an offset from it, and a second copy of the number is how those two drifted
// apart before.
const CAR_FRICTION = 0.96;

const NO_MODS = Object.freeze({ speed: 1, accel: 1, turn: 1, grip: 1 });

// The tuning panel is step 5 of the port. Until it lands there is nothing to
// read a saved value out of, so the shipped defaults *are* the tuning — seeded
// from debugConfig.js's own literal rather than copied, because a second copy
// of the AI numbers here would immediately be the one that went stale. Without
// this, ai.js falls through its `??` fallbacks to a skill floor of 0.9 against
// the 0.85 the game actually ships.
if (typeof DebugConfig !== "undefined" && !Object.keys(DebugConfig.values).length)
  DebugConfig.values = { ...DebugConfig.defaults };

function applyCarStats(entity, v = DebugConfig.values) {
  const mods = entity.mods || NO_MODS;
  entity.acceleration =
    v.playerAcceleration * EngineClass.accelScale() * mods.accel;
  entity.maxSpeed = v.playerMaxSpeed * EngineClass.speedScale() * mods.speed;
  entity.turnSpeed = v.playerTurnSpeed * mods.turn;
  entity.driftGrip = v.playerDriftGrip * mods.grip;
  entity.friction = CAR_FRICTION;
}
