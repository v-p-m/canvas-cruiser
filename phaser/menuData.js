// The menu's own copy of TRACKS / MODES out of game.js (game.js:53-77).
//
// Duplicated rather than shared: game.js is the legacy loop's file and
// PORTING.md's whole premise is that it stays untouched for the length of the
// port, so the Phaser page can't load it for a 20-line data table without
// dragging in everything else game.js owns. Five circuits and four modes is a
// small enough list that keeping it in sync by eye is cheap — if this ever
// grows, promote it to a shared file both pages load. Track and class ids
// must stay colon-free (see CLAUDE.md); nothing here changes that contract.
//
// The mode lists have deliberately diverged since 0.17.0: the series mode
// below is a scene handoff (phaser/seriesScene.js), and the editor page has no
// such scene, so putting it in game.js's MODES would give that page a menu row
// that starts nothing. The copy exists so the two pages *can* differ where one
// has machinery the other doesn't.
const PHASER_TRACKS = [
  { id: "super", file: "tracks/super-circuit.json", label: "Super Circuit" },
  { id: "valley", file: "tracks/snake-valley.json", label: "Snake Valley" },
  { id: "coastal", file: "tracks/coastal-sprint.json", label: "Coastal Sprint" },
  { id: "redrock", file: "tracks/redrock-sweeper.json", label: "Redrock Sweeper" },
  { id: "ironwood", file: "tracks/ironwood-marathon.json", label: "Ironwood Marathon" },
];

const PHASER_MODES = [
  { id: "free", label: "Free Drive", laps: null },
  { id: "race5", label: "5 Lap Race", laps: 5 },
  { id: "race10", label: "10 Lap Race", laps: 10 },
  // Not a race length: `series` is what MenuScene.startRace() branches on to
  // hand off to SeriesScene, which is the only thing that starts a round and
  // the only thing that sets RaceLaps.target for one. `laps` is carried
  // anyway, off series.js's own constant rather than a second copy of the
  // number, so anything reading the table generically still sees the truth.
  { id: "series", label: `${SERIES_ROUNDS}-Race Series`, laps: SERIES_LAPS, series: true },
];
