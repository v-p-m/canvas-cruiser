// The menu's own copy of TRACKS / MODES out of game.js (game.js:53-77).
//
// Duplicated rather than shared: game.js is the legacy loop's file and
// PORTING.md's whole premise is that it stays untouched for the length of the
// port, so the Phaser page can't load it for a 20-line data table without
// dragging in everything else game.js owns. Four circuits and three modes is a
// small enough list that keeping it in sync by eye is cheap — if this ever
// grows, promote it to a shared file both pages load. Track and class ids
// must stay colon-free (see CLAUDE.md); nothing here changes that contract.
const PHASER_TRACKS = [
  { id: "super", file: "tracks/super-circuit.json", label: "Super Circuit" },
  { id: "valley", file: "tracks/snake-valley.json", label: "Snake Valley" },
  { id: "coastal", file: "tracks/coastal-sprint.json", label: "Coastal Sprint" },
  { id: "redrock", file: "tracks/redrock-sweeper.json", label: "Redrock Sweeper" },
];

const PHASER_MODES = [
  { id: "free", label: "Free Drive", laps: null },
  { id: "race5", label: "5 Lap Race", laps: 5 },
  { id: "race10", label: "10 Lap Race", laps: 10 },
];
