// The five rivals, by name.
//
// Until 0.22.0 the opponents were "CPU 1" to "CPU 5", and each one's skill was
// a fresh draw from a uniform band every race. That is a field, not a set of
// rivals: the orange car that beat you on Snake Valley had nothing to do with
// the orange car that parked itself at Redrock, and a four-round championship
// was a title fight against nobody in particular. A driver has to be the same
// driver on every circuit for the standings table to be a story rather than
// a scoreboard, and for "watch out for the blue one" to be advice.
//
// What a profile is: a *driver*, and only a driver — the same three numbers
// rollDriver() in shared/ai.js has always rolled, with the draw replaced by a
// character. `skill` is the centre of the band that driver's corner margin is
// taken from, `spread` the half-width of the per-race noise around it (so
// consistency is itself a trait: the front-runner is metronomic, the wild one
// takes a podium some days and last on others), and `line` the lateral
// preference in world px, its sign fixed, so one rival always hugs the inside
// and another always runs the outside. No machinery is touched here: an
// opponent's car is the player's car with Garage.fieldDevelopment() applied,
// exactly as before, and the door CLAUDE.md keeps shut stays shut.
//
// The profiles are in grid order, slot 1 to slot 5 — the player is slot 0 and
// starts last — and that is one rank for three things: the livery
// (GRID_LIVERIES in raceGrid.js), the driver here, and the machinery
// (FIELD_DEV_SPREAD in garage.js, front row to backmarker). The front row is
// both the best driver and the best-developed car, which is what a works team
// is, and it means the debug panel's `skill` and `m` columns tell one story
// rather than two.
//
// The centres average 0.875, which is the mean of the uniform SKILL_MIN..
// SKILL_MAX draw they replace, so the field's overall pace — measured for the
// garage's development table — does not move. What moves is the shape: a
// front-loaded field strings out more than a uniform one does. If the rivals
// stop overtaking each other, `spread` is the dial, not the centres.
//
// Game page only. The editor page's pace car calls rollDriver() with no
// profile and keeps its random draw, which is what its skill sliders tune.
const DRIVERS = [
  { name: "AALTO", skill: 0.94, spread: 0.01, line: 14 }, // the front-runner
  { name: "OKAFOR", skill: 0.905, spread: 0.03, line: -10 }, // quick, a little variable
  { name: "MORAES", skill: 0.875, spread: 0.02, line: 6 }, // the midfield
  { name: "KOVAC", skill: 0.845, spread: 0.05, line: -16 }, // the wild one
  { name: "BRENNAN", skill: 0.81, spread: 0.02, line: 10 }, // the backmarker
];
