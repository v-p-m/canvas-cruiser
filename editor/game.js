// Declared in index.html, because that is the file that can invalidate this one.
const GAME_VERSION = window.BUILD;

// --- Debug flag ---
let DEBUG = false;

let laps = 0;
let hasStarted = false;
let onFinishLine = false;
let lapStartTime = 0;
let currentLapTime = 0;
let lastLapTime = null; // the previous lap's time, or null before one is done
let bestLapTime = 0;
let isMenu = true;
let isRacing = false;
// Records are per track and per engine class — a lap of Snake Valley is a
// different piece of road from a lap of Super Circuit, and a 250cc lap of
// either is a different car, so one table of times would be comparing things
// that were never in the same race. Both stores are keyed `trackId:classId`;
// `highScores` and `bestTotalTimes` below are the loaded combination's slice of
// them, which is what every screen reads.
let allHighScores = {}; // "track:class" → [lap times]
let allBestTotals = {}; // "track:class" → { mode: [total times] }
let highScores = [];
let bestTotalTimes = {};
let isNewBestTotal = false;
let isLeaderboard = false;
let savedSpeed = 0;
let racePaused = false;
let gameMode = "free"; // "free" | "race5" | "race10"
let selectedMode = 1; // which mode START begins — the 5 lap race
// The menu is three pickers and a button: 0 track, 1 class, 2 mode, 3 START.
// UP/DOWN moves the cursor and LEFT/RIGHT changes whatever it is sitting on,
// so every choice works the same way and none of them needs its own key.
const MENU_ROWS = 4;
const MENU_START_ROW = 3;
let menuRow = 2; // opens on the mode, the row most races start by changing
let weatherWetFromLap = null;
let weatherWetToLap = null;
let totalRaceStart = 0;
let totalRaceTime = 0;
let isRaceFinished = false;
let finishHoldTimer = 0; // ms left of the roll-out before the results appear
let leaderboardFrom = "game"; // "game" | "menu"
let isKeyBindings = false;
let isCredits = false; // modal over the menu, so `isMenu` stays true with it

// Final classification, built the moment the player crosses the line — see
// finishRace(). Opponents still on track are classified where they stand.
let finishOrder = [];
let playerFinishPosition = 0;

const MODES = [
  { id: "free", label: "Free Drive" },
  { id: "race5", label: "5 Lap Race" },
  { id: "race10", label: "10 Lap Race" },
];

// The circuits, in menu order — one file each, in tracks/. `id` keys the
// records and the debug panel's saved grid, so renaming one starts its tables
// over; the file and the label are free to change.
//
// Every track is the same 40×28 tiles: the camera, the minimap and the skid
// layer all size themselves from the map, so circuits of different extents
// quietly changed how much road you could see at once.
const TRACKS = [
  {
    id: "super",
    file: "tracks/super-circuit.json",
    label: "Super Circuit",
  },
  {
    id: "valley",
    file: "tracks/snake-valley.json",
    label: "Snake Valley",
  },
  {
    id: "coastal",
    file: "tracks/coastal-sprint.json",
    label: "Coastal Sprint",
  },
  {
    id: "redrock",
    file: "tracks/redrock-sweeper.json",
    label: "Redrock Sweeper",
  },
];
let selectedTrack = 0; // index into TRACKS — the one the menu is offering
let loadedTrack = -1; // the one actually baked into worldTrack
let trackLoading = false;
try {
  const saved = localStorage.getItem("track");
  const i = TRACKS.findIndex((t) => t.id === saved);
  if (i >= 0) selectedTrack = i;
} catch {
  /* private-mode localStorage — the default track is fine */
}

function currentTrack() {
  return TRACKS[Math.min(selectedTrack, TRACKS.length - 1)];
}

// Staggered starting grid, behind the finish line. The field is six so it
// divides into three complete rows of two rather than leaving one car alone at
// the back of a lane.
//
// The coordinates are the loaded track's `spawn` block — where the line is is
// the track's business — and only the colours live here, because those are the
// cars' identity rather than the circuit's. applyTrackSpawns() fills the rest
// in; the debug sliders then nudge these in place.
const SPAWN_POSITIONS = [
  { x: 0, y: 0, angle: 0, color: null }, // player
  { x: 0, y: 0, angle: 0, color: "#0077ff" }, // AI 1
  { x: 0, y: 0, angle: 0, color: "#ff7700" }, // AI 2
  { x: 0, y: 0, angle: 0, color: "#00cc44" }, // AI 3
  { x: 0, y: 0, angle: 0, color: "#cc00cc" }, // AI 4
  { x: 0, y: 0, angle: 0, color: "#ffd400" }, // AI 5
];

// A track without a `spawn` block — one straight out of the track editor, say
// — still has to start a race, so the grid falls back to stacking the field on
// waypoint 0 facing waypoint 1. Two lanes 34px either side of the line, 60px
// apart along it, which is the spacing both shipped grids use.
function applyTrackSpawns() {
  const grid = (worldTrack.data && worldTrack.data.spawn) || [];
  const wps = (worldTrack.data && worldTrack.data.waypoints) || [];

  SPAWN_POSITIONS.forEach((pos, i) => {
    if (grid[i]) {
      pos.x = grid[i].x;
      pos.y = grid[i].y;
      pos.angle = grid[i].angle;
      return;
    }
    const a = wps[0] || { x: 100, y: 100 };
    const b = wps[1] || { x: a.x + 1, y: a.y };
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const tx = (b.x - a.x) / len;
    const ty = (b.y - a.y) / len;
    const side = i % 2 ? 34 : -34;
    const back = 140 + i * 60;
    pos.x = a.x - tx * back - ty * side;
    pos.y = a.y - ty * back + tx * side;
    pos.angle = Math.atan2(tx, -ty);
  });
}

const opponents = [];

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// The camera is also the authority on viewport size, in CSS pixels. Nothing
// outside resizeCanvas() should read canvas.width/height: the backing store
// is devicePixelRatio times larger, and mixing the two silently halves the
// UI on a retina display.
const camera = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
};

// --- Free camera (editors opened from the menu) ---
// In a race you pan by driving, which is why the waypoint editor never needed
// a camera of its own. Opened from the menu there is nothing to drive, so the
// view becomes free: `editorView` is where it looks and `viewZoom` how far
// out. camera.x/y is set from it every frame, so every `- camera.x` in the
// codebase keeps working; the zoom is a context scale around the world pass,
// which is why nothing else had to learn about it.
// 0.4 is the rung that fits all 40×28 tiles on a 1280-wide window at once.
const ZOOM_STEPS = [0.4, 0.55, 0.75, 1, 1.5, 2];
const DEFAULT_ZOOM_STEP = 3; // ZOOM_STEPS[3] === 1
let viewZoom = 1;
const editorView = { x: 0, y: 0 };

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// The world rectangle on screen. At 1x this is the viewport; zoomed out it is
// larger than it, which is the whole point.
function viewWidth() {
  return camera.width / viewZoom;
}

function viewHeight() {
  return camera.height / viewZoom;
}

function screenToWorldX(sx) {
  return sx / viewZoom + camera.x;
}

function screenToWorldY(sy) {
  return sy / viewZoom + camera.y;
}

// True while an editor owns the screen from the menu — the only time the free
// camera is in effect. In a race the editors keep the racing camera at 1x.
function freeCameraActive() {
  return menuEditorOpen() && !TrackEditor.active;
}

// Arrows pan, +/- zoom, 0 back to 1x. The step is in world pixels but scaled
// by the zoom, so a press always moves the view one tile's worth of screen
// rather than crawling once you are looking at the whole map.
function handleFreeCameraKey(e) {
  if (!freeCameraActive()) return false;
  const step = (worldTrack.data ? worldTrack.data.tileSize : 64) / viewZoom;
  switch (e.key) {
    case "ArrowLeft":
      panEditorView(-step, 0);
      return true;
    case "ArrowRight":
      panEditorView(step, 0);
      return true;
    case "ArrowUp":
      panEditorView(0, -step);
      return true;
    case "ArrowDown":
      panEditorView(0, step);
      return true;
    case "+":
    case "=":
      zoomEditorView(1, camera.width / 2, camera.height / 2);
      return true;
    case "-":
    case "_":
      zoomEditorView(-1, camera.width / 2, camera.height / 2);
      return true;
    case "0":
      // Back to 1x about the middle of the screen, so what you were looking at
      // is still what you are looking at.
      zoomEditorView(
        DEFAULT_ZOOM_STEP - ZOOM_STEPS.indexOf(viewZoom),
        camera.width / 2,
        camera.height / 2,
      );
      return true;
  }
  return false;
}

function resetEditorView() {
  viewZoom = 1;
  editorView.x = camera.x;
  editorView.y = camera.y;
}

// Keeps the map in view: pinned to its edges while it is bigger than the
// screen, centred once the zoom has pulled far enough out to show all of it.
function clampEditorView() {
  const worldW = worldTrack.bakedCanvas ? worldTrack.bakedCanvas.width : 0;
  const worldH = worldTrack.bakedCanvas ? worldTrack.bakedCanvas.height : 0;
  const slackX = worldW - viewWidth();
  const slackY = worldH - viewHeight();
  editorView.x = slackX > 0 ? clamp(editorView.x, 0, slackX) : slackX / 2;
  editorView.y = slackY > 0 ? clamp(editorView.y, 0, slackY) : slackY / 2;
}

function panEditorView(dx, dy) {
  editorView.x += dx;
  editorView.y += dy;
  clampEditorView();
}

// Zoom about a screen point — the map stays under the pointer, so stepping out
// to find a corner and back in on it is one gesture rather than a hunt.
function zoomEditorView(dir, anchorX, anchorY) {
  const i = ZOOM_STEPS.indexOf(viewZoom);
  const step = clamp(
    (i < 0 ? DEFAULT_ZOOM_STEP : i) + dir,
    0,
    ZOOM_STEPS.length - 1,
  );
  const next = ZOOM_STEPS[step];
  if (next === viewZoom) return;
  const wx = screenToWorldX(anchorX);
  const wy = screenToWorldY(anchorY);
  viewZoom = next;
  editorView.x = wx - anchorX / viewZoom;
  editorView.y = wy - anchorY / viewZoom;
  clampEditorView();
}

// Render at the display's real pixel density. The CSS keeps the element at
// 100vw/100vh whatever the backing store is, so all we do is oversize the
// buffer and scale the context to match — every draw call stays in CSS px.
//
// The cap is a framerate decision, not a memory one. Every frame repaints the
// whole viewport from the baked track and the skid layer, and then hands a
// backing store that size to the compositor, so cost is linear in dpr² — 1.5x
// is 2.25x the pixels of 1x. How much a machine can afford varies enormously
// with whether its browser rasterises canvas on the GPU, which is why `Quality`
// gets to lower this on its own; the `C` panel's Max dpr slider overrides both
// and the `B` overlay reports what it settled on.
const MAX_DPR = 1.5;

// The scale actually in force. Everything drawing to `ctx` works in CSS px and
// should never need this — it is here for the two places that care about the
// physical pixel ratio, resampling quality and the debug readout.
let renderDpr = 1;

function currentMaxDpr() {
  // DebugConfig.values is empty until DebugConfig.load(), which runs well
  // after the first resizeCanvas() call below.
  const manual = DebugConfig.values.maxDpr || MAX_DPR;
  return Quality.auto ? Math.min(manual, Quality.cap) : manual;
}

function resizeCanvas() {
  renderDpr = Math.min(window.devicePixelRatio || 1, currentMaxDpr());
  camera.width = window.innerWidth;
  camera.height = window.innerHeight;
  canvas.width = Math.round(camera.width * renderDpr);
  canvas.height = Math.round(camera.height * renderDpr);
  // setTransform, not scale — resize fires repeatedly and scale compounds.
  ctx.setTransform(renderDpr, 0, 0, renderDpr, 0, 0);
  ctx.imageSmoothingEnabled = true;
  CarSprites.invalidate(); // the sprites are baked at the old renderDpr
  Night.resize(); // the darkness veil is a viewport-sized layer of its own
}
resizeCanvas();

const car = {
  x: 0,
  y: 0,
  width: 34,
  height: 56,
  angle: 0,
  speed: 0,
  velocityX: 0,
  velocityY: 0,

  // acceleration / maxSpeed / turnSpeed / driftGrip / friction are not written
  // here: applyCarStats() owns them, for this car and every opponent alike.
  mods: null,

  // Race state, shared in shape with AICar so updateLapCounter and the
  // standings can treat the player as just another entry
  laps: 0,
  onFinishLine: false,
  passedGate: false,
  finished: false,
  finishPosition: 0,
  finishTime: 0,
  raceStart: 0,
};
// One source of truth for the player's livery: it paints the sprite and the
// colour chip beside "YOU" in the standings, which have to agree.
const PLAYER_COLOR = "#e01b1b";

// There is one car on the grid, six times over, and its numbers are in
// carStats.js — shared verbatim with the game page, so a stat tuned against the
// pace car here means the same thing there. The opponents used to be a
// different vehicle — twice the grip, a steering controller that could swing
// the nose four times as fast as the player's lock, a speed ceiling off-road
// instead of the player's drag — which is why no player tuning ever
// transferred to them and why the field either walked away or drove into the
// scenery whenever a number moved.

const keys = {};

// --- Offscreen canvas for baked skid marks ---
//
// World-space, so a mark stays where it was laid down. It used to be
// clamped to 2048px, which happens to be exactly the current track's width
// — anything larger silently lost every mark past the cut. Oversized tracks
// now drop the layer's resolution instead of its extent, and the context
// transform keeps paintSkidMark working in plain world coordinates.
const SKID_MAX_EDGE = 4096; // px
const SKID_SLIP = 2.4; // world px/frame of lateral slide before a mark is laid
const SKID_REF_GRIP = 0.1; // the grip SKID_SLIP was measured at — car.driftGrip
const skidCanvas = document.createElement("canvas");
const skidCtx = skidCanvas.getContext("2d");
let skidScale = 1;

function resizeSkidCanvas() {
  if (!worldTrack.data) return;
  const w = worldTrack.data.map[0].length * worldTrack.data.tileSize;
  const h = worldTrack.data.map.length * worldTrack.data.tileSize;
  skidScale = Math.min(1, SKID_MAX_EDGE / Math.max(w, h));
  skidCanvas.width = Math.round(w * skidScale);
  skidCanvas.height = Math.round(h * skidScale);
  skidCtx.setTransform(skidScale, 0, 0, skidScale, 0, 0);
}

function clearSkidMarks() {
  // clearRect goes through the scale transform, so these are world units
  skidCtx.clearRect(
    0,
    0,
    skidCanvas.width / skidScale,
    skidCanvas.height / skidScale,
  );
}

// Takes the whole entity, not loose coordinates: the wheel offsets come from
// its own body, so an opponent lays its own track width rather than the
// player's.
function paintSkidMark(entity) {
  // World coordinates — the layer's scale transform maps them onto it
  if (
    entity.x < 0 ||
    entity.y < 0 ||
    entity.x > skidCanvas.width / skidScale ||
    entity.y > skidCanvas.height / skidScale
  )
    return;

  skidCtx.save();
  skidCtx.translate(entity.x, entity.y);
  skidCtx.rotate(entity.angle);
  skidCtx.fillStyle = "rgba(0, 0, 0, 0.15)";
  const offset = entity.width / 2 - 4;
  skidCtx.fillRect(-offset, entity.height / 4, 6, 10);
  skidCtx.fillRect(offset - 6, entity.height / 4, 6, 10);
  skidCtx.restore();
}

// Sideways component of the velocity — what the tires are scrubbing off.
// Shared, so an opponent is judged sliding by exactly the same measure as
// the player.
function lateralSlip(entity) {
  return Math.abs(
    entity.velocityX * Math.cos(entity.angle) +
      entity.velocityY * Math.sin(entity.angle),
  );
}

// Slip is the velocity grip has not pulled onto the heading yet, so it scales
// as 1/grip — the same corner leaves a grippier car sliding proportionally
// less. A single absolute threshold therefore quietly asks more of whoever
// grips harder. The whole field runs the player's grip now, so this only
// matters once a part upgrade moves one car's `driftGrip` off the others' —
// which is exactly when a fixed number would stop meaning the same manoeuvre.
// Rain is deliberately not in here: it lowers grip to make the cars slide,
// and dividing that back out would erase the point.
function skidThreshold(entity) {
  return SKID_SLIP * (SKID_REF_GRIP / entity.driftGrip);
}

// --- Menu actions (shared by keyboard and mouse) ---

function moveMenuCursor(dir) {
  menuRow = (menuRow + dir + MENU_ROWS) % MENU_ROWS;
}

// LEFT / RIGHT on the row under the cursor. START is a button, so there is
// nothing to change on it.
function changeMenuRow(dir) {
  if (menuRow === 0) cycleTrack(dir);
  else if (menuRow === 1) cycleClass(dir);
  else if (menuRow === 2) cycleMode(dir);
}

// Unlike the track and the class, the mode costs nothing to change and is not
// persisted — it only decides what startSelectedMode() begins.
function cycleMode(dir) {
  selectedMode = (selectedMode + dir + MODES.length) % MODES.length;
}

// Step to another circuit. A paused race can't survive the road under it being
// replaced, so it is dropped here rather than left to resume onto a track it
// was never run on.
function cycleTrack(dir) {
  if (TRACKS.length < 2) return;
  selectedTrack = (selectedTrack + dir + TRACKS.length) % TRACKS.length;
  try {
    localStorage.setItem("track", currentTrack().id);
  } catch {
    /* private mode — the choice just won't outlive the tab */
  }
  racePaused = false;
  savedSpeed = 0;
  applySelectedTrack();
}

// Step to another engine class. Nothing has to be reloaded — the class is two
// multipliers — but the records on screen belong to the class as well as the
// track, and apply() is what puts the new top speed on the car.
function cycleClass(dir) {
  if (ENGINE_CLASSES.length < 2) return;
  EngineClass.cycle(dir);
  // Pre-init the sliders have no values yet and apply() would multiply the
  // class into `undefined`; init() is about to apply them anyway.
  if (DebugConfig.ready) DebugConfig.apply();
  selectRecords();
  racePaused = false; // as in cycleTrack: a paused race can't change car
  savedSpeed = 0;
}

function startSelectedMode() {
  if (trackLoading) return; // the new track is still baking
  resetRace();
  racePaused = false;
  savedSpeed = 0;
  gameMode = MODES[selectedMode].id;
  isMenu = false;
  isRacing = false;
  scheduleWeather();
  scheduleNight();
  StartLights.begin();
}

function openKeyBindings() {
  isMenu = false;
  isKeyBindings = true;
  KeyBindings.lastRejected = null;
}

function openLeaderboardFromMenu() {
  isMenu = false;
  isLeaderboard = true;
  leaderboardFrom = "menu";
}

function openCredits() {
  isCredits = true;
  creditsScroll = 0; // always opens on the top of the roll
}

function closeCredits() {
  isCredits = false;
}

function toggleDebug() {
  DEBUG = !DEBUG;
  console.log(`Debug ${DEBUG ? "ON" : "OFF"}`);
  if (!DEBUG) {
    WaypointEditor.active = false; // close editors when debug turns off
    TrackEditor.close();
  }
}

// The tools DEBUG unlocks, in one place because both the race and the menu
// reach them — B on the menu used to turn on a mode the menu had no keys for,
// so the only way to an editor was to start a race first and edit around a
// moving car.
function handleDebugKey(key, e) {
  if (!DEBUG) return false;
  if (key === "c" && !isLeaderboard) {
    DebugConfig.toggle();
    return true;
  }
  if (key === "e") {
    WaypointEditor.toggle();
    return true;
  }
  if (key === "t") {
    TrackEditor.toggle();
    return true;
  }
  if (key === "z") {
    WaypointEditor.undo();
    return true;
  }
  if (key === "p") {
    e.preventDefault();
    WaypointEditor.export();
    return true;
  }
  return false;
}

// An editor opened from the menu takes the screen off it: the menu is a
// full-screen dim and would bury the very thing being edited, and its mouse
// hit areas would eat the clicks meant for the map. Closing the editor brings
// it back.
function menuEditorOpen() {
  return isMenu && DEBUG && (TrackEditor.active || WaypointEditor.active);
}

// --- The waypoint editor's pace car ---
//
// A ring that reads fine standing still can still put a car in the grass: what
// a marker costs only shows in the line a driver takes through it. So the
// editor runs one opponent on the markers being edited — `ringFor()` checksums
// them every frame, so the line rebuilds under the car while one is dragged.
//
// It is a reference driver rather than a rival: full skill, no line offset, no
// wander, no grid delay, because anything random in the car is noise in the
// answer. The other five stay parked and hidden — a queue nose to tail on the
// same line says nothing about the line and covers the markers underneath it.
//
// It races nothing, so it is deliberately outside the race: no lap counting, no
// collisions, no skid marks, no engine note. The free camera stays free as
// well; zoom out to follow it, or leave it on the corner being cut and wait for
// the car to come round.
const PACE_STUCK_MS = 1200; // stationary this long and it goes back on the line
const PACE_STUCK_SPEED = 0.3; // world px/frame that still counts as stationary
let paceRunning = false;
let paceStuckTimer = 0;

function paceCarActive() {
  return menuEditorOpen() && WaypointEditor.active && !TrackEditor.active;
}

function paceCar() {
  return opponents[0] || null;
}

function parkPaceCar() {
  const ai = paceCar();
  if (!ai) return;
  const s = SPAWN_POSITIONS[1];
  ai.x = s.x;
  ai.y = s.y;
  ai.angle = s.angle;
  ai.prevAngle = s.angle;
  ai.steer = 0;
  ai.speed = 0;
  ai.velocityX = 0;
  ai.velocityY = 0;
  ai.currentWaypoint = 0;
  ai.steerDir = 0;
}

function startPaceCar() {
  paceRunning = true;
  paceStuckTimer = 0;
  parkPaceCar();
  const ai = paceCar();
  if (ai) applyCarStats(ai); // the class picker may have moved since the race
}

function stopPaceCar() {
  paceRunning = false;
  parkPaceCar();
  const ai = paceCar();
  if (ai) ai.rollDriver(); // hand back the traits the reference driver ate
}

// Dropped back on the ring facing the way it runs. Dragging a marker across the
// map strands the car that was driving to it, and a dead car on the grass
// demonstrates nothing.
function placePaceCarOnLine(ai, waypoints) {
  const ring = ringFor(waypoints);
  const n = ring.pts.length;
  const i = nearestPoint(ai.x, ai.y, ring.pts);
  const p = ring.pts[i];
  const q = ring.pts[(i + 1) % n];
  ai.x = p.x;
  ai.y = p.y;
  ai.angle = Math.atan2(q.x - p.x, -(q.y - p.y));
  ai.prevAngle = ai.angle;
  ai.speed = 0;
  ai.velocityX = 0;
  ai.velocityY = 0;
  ai.currentWaypoint = (i + 1) % n;
  ai.steerDir = 0;
  paceStuckTimer = 0;
}

function updatePaceCar(delta) {
  const ai = paceCar();
  const waypoints = WaypointEditor.waypoints;
  if (!ai || waypoints.length < 2) return;

  // Re-asserted every frame, not just on open: the debug panel re-rolls the
  // whole field's traits whenever a slider moves, and a pace car that quietly
  // picked up 40px of line offset is answering a different question.
  ai.skill = 1;
  ai.lineOffset = 0;
  ai.wander = 0;
  ai.startDelay = 0;

  // No player to chase and nobody to avoid — the catch-up and avoidance terms
  // would both move the aim point off the ring being read.
  stepCarControls(ai, ai.drive(waypoints, null, [], delta), delta);
  updateSteerVisual(ai, delta);
  stepCarMotion(ai, delta);

  if (Math.abs(ai.speed) < PACE_STUCK_SPEED) {
    paceStuckTimer += (delta / 60) * 1000; // delta frames to ms
    if (paceStuckTimer > PACE_STUCK_MS) placePaceCarOnLine(ai, waypoints);
  } else {
    paceStuckTimer = 0;
  }
}

// Leaves the records screen, returning wherever it was opened from.
function closeLeaderboard() {
  isLeaderboard = false;
  if (leaderboardFrom === "menu") {
    isMenu = true;
    isRacing = false;
  } else {
    isRacing = true;
    car.speed = savedSpeed;
    savedSpeed = 0;
  }
}

// The two ways off the results screen, shared by the keys and the buttons.
function restartRace() {
  resetRace();
  racePaused = false;
  scheduleWeather();
  scheduleNight();
  isMenu = false;
  isRacing = false;
  StartLights.begin();
}

function exitRaceToMenu() {
  isMenu = true;
  racePaused = false;
  resetRace();
}

function resumePausedRace() {
  isMenu = false;
  isRacing = true;
  car.speed = savedSpeed;
  savedSpeed = 0;
  racePaused = false;
}

// --- Input ---
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();

  // Browsers only allow an AudioContext to start from a user gesture
  Sound.unlock();

  // Forward to track editor first
  if (TrackEditor.active && TrackEditor.handleKeyDown(e)) return;

  // Mute works from every screen except the rebind one, which needs to see
  // the key itself so it can report it as reserved.
  if (key === "m" && !isKeyBindings) {
    Sound.toggleMute();
    return;
  }

  // Leaderboard ESC — first, before anything else
  if (key === "escape" && isLeaderboard) {
    closeLeaderboard();
    return;
  }

  // Menu navigation
  if (isMenu) {
    // The credits popup is modal: it eats every menu key while it is up, so
    // ESC can't resume a paused race and Enter can't start one behind it.
    if (isCredits) {
      if (key === "escape" || key === "i" || key === "enter") closeCredits();
      else if (e.key === "ArrowDown") scrollCredits(40);
      else if (e.key === "ArrowUp") scrollCredits(-40);
      return;
    }
    // With an editor up the menu is not on screen, so nothing that belongs to
    // it may fire behind it — ENTER especially, which would start a race on a
    // half-drawn map. ESC closes the editor (the track editor takes its own
    // ESC above) rather than resuming a paused race.
    if (menuEditorOpen()) {
      if (key === "escape") WaypointEditor.active = false;
      // The overlay's banner offers B as the way out, and it shuts both
      // editors on the way — so it has to still be live behind them.
      else if (key === "b") toggleDebug();
      else if (!handleFreeCameraKey(e)) handleDebugKey(key, e);
      return;
    }
    if (key === "i") {
      openCredits();
      return;
    }
    if (key === "escape" && racePaused) {
      resumePausedRace();
      return;
    }
    if (e.key === "ArrowUp") {
      moveMenuCursor(-1);
      return;
    }
    if (e.key === "ArrowDown") {
      moveMenuCursor(1);
      return;
    }
    if (e.key === "ArrowLeft") {
      changeMenuRow(-1);
      return;
    }
    if (e.key === "ArrowRight") {
      changeMenuRow(1);
      return;
    }
    if (key === "k") {
      openKeyBindings();
      return;
    }
    if (key === "q") {
      openLeaderboardFromMenu();
      return;
    }
    if (key === "b") {
      toggleDebug();
      return;
    }
    if (handleDebugKey(key, e)) return;
    if (key === "enter" || key === " ") {
      startSelectedMode();
      return;
    }
    return;
  }
  // Key binding screen
  if (isKeyBindings) {
    if (KeyBindings.handleRebind(e.key)) return; // consuming a rebind

    if (key === "escape") {
      isKeyBindings = false;
      isMenu = true;
      KeyBindings.listening = null;
      return;
    }
    if (key === "r") {
      KeyBindings.reset();
      return;
    }
    if (key === "enter" && KeyBindings._hitAreas) {
      // Enter selects the focused row — cycle through actions
      const actions = ["accelerate", "brake", "left", "right"];
      const cur = actions.indexOf(KeyBindings.listening);
      KeyBindings.startListening(actions[(cur + 1) % actions.length]);
      return;
    }
    return;
  }
  // Race finished screen
  if (isRaceFinished) {
    if (key === "r") restartRace();
    if (key === "escape") exitRaceToMenu();
    return;
  }

  // General ESC — pause the race and return to the menu; ESC again from the
  // menu resumes it (see the isMenu block above).
  if (key === "escape") {
    savedSpeed = car.speed;
    car.speed = 0;
    isRacing = false;
    isMenu = true;
    isLeaderboard = false;
    racePaused = true;
    return;
  }

  if (key === "r") {
    resetRace();
    racePaused = false;
    scheduleWeather();
    scheduleNight();
    isMenu = false;
    isRacing = false;
    StartLights.begin();
    return;
  }

  // Q key handler:
  if (key === "q") {
    if (isLeaderboard) {
      closeLeaderboard();
    } else {
      isLeaderboard = true;
      leaderboardFrom = "game";
      savedSpeed = car.speed;
      car.speed = 0;
    }
    return;
  }

  if (key === "c" && isLeaderboard) {
    clearHighScores();
    return;
  }

  if (key === "p" && !isMenu && !DEBUG) {
    Rain.toggle();
    return;
  }

  if (key === "n" && !isMenu && !DEBUG) {
    Night.toggle();
    return;
  }

  if (key === "b") {
    toggleDebug();
    return;
  }
  if (handleDebugKey(key, e)) return;
  keys[e.key] = true;
});

window.addEventListener("keyup", (e) => (keys[e.key] = false));

window.addEventListener("blur", () => {
  for (const k in keys) keys[k] = false;
});

window.addEventListener("resize", () => {
  resizeCanvas();
  // A different viewport is a different workload, and the resize itself
  // costs a frame or two — judging the new size on samples from the old one
  // is how dragging a window bigger would drop the resolution permanently.
  Quality.viewportChanged();
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("mousedown", (e) => {
  canvas.focus();
  Sound.unlock();
  // An editor opened from the menu owns the mouse — the menu's hit areas are
  // not drawn, so testing against them would paint tiles into dead clicks.
  if (isMenu && !menuEditorOpen()) {
    if (e.button === 0) {
      if (isCredits) handleCreditsClick(e.clientX, e.clientY);
      else handleMenuClick(e.clientX, e.clientY);
    }
    return;
  }
  if (isLeaderboard) {
    if (e.button === 0) handleLeaderboardClick(e.clientX, e.clientY);
    return;
  }
  if (isRaceFinished) {
    if (e.button === 0) handleRaceFinishedClick(e.clientX, e.clientY);
    return;
  }
  if (isKeyBindings) {
    if (
      e.button === 0 &&
      KeyBindings.handleClick(e.clientX, e.clientY) === "back"
    ) {
      isKeyBindings = false;
      isMenu = true;
    }
    return;
  }
  if (TrackEditor.active) {
    TrackEditor.handleMouseDown(e.clientX, e.clientY, e.button);
    return;
  }
  WaypointEditor.handleMouseDown(e.clientX, e.clientY, e.button);
});

canvas.addEventListener("mousemove", (e) => {
  mousePos.x = e.clientX;
  mousePos.y = e.clientY;
  if (isKeyBindings || isLeaderboard || isRaceFinished) return;
  if (isMenu && !menuEditorOpen()) return;
  if (TrackEditor.active) {
    TrackEditor.handleMouseMove(e.clientX, e.clientY, e.buttons);
    return;
  }
  WaypointEditor.handleMouseMove(e.clientX, e.clientY, e.buttons);
});

canvas.addEventListener("mouseup", () => {
  if (TrackEditor.active) {
    TrackEditor.handleMouseUp();
    return;
  }
  WaypointEditor.handleMouseUp();
});

canvas.addEventListener(
  "wheel",
  (e) => {
    if (isMenu && isCredits) {
      scrollCredits(e.deltaY);
      e.preventDefault(); // don't rubber-band the page behind the popup
      return;
    }
    // The track editor's wheel is its tile palette, so only the free camera's
    // is spare — which is the one place a wheel means zoom anyway.
    if (freeCameraActive()) {
      e.preventDefault();
      zoomEditorView(e.deltaY > 0 ? -1 : 1, e.clientX, e.clientY);
      return;
    }
    TrackEditor.handleWheel(e);
  },
  { passive: false },
);

const worldTrack = new Track(ctx);

// --- Track loading ---

// Picking a circuit is a fetch and a bake, so the menu can ask for another one
// before this one has finished. Rather than race two loads into the same Track
// object, this keeps going until what is baked matches what is selected: the
// last press wins, and nothing interleaves.
async function applySelectedTrack() {
  if (trackLoading) return;
  trackLoading = true;
  try {
    while (loadedTrack !== selectedTrack) {
      const want = selectedTrack;
      await worldTrack.load(TRACKS[want].file);
      loadedTrack = want;
      onTrackLoaded();
    }
  } catch (err) {
    if (loadedTrack < 0) throw err; // nothing baked yet — initGame reports it
    console.error("Failed to load track:", err);
    selectedTrack = loadedTrack; // stay on the circuit that is actually up
  } finally {
    trackLoading = false;
  }
}

// Everything that was cut to fit the old track: the waypoint ring, the grid,
// the skid layer's world size, and which records table is on screen.
function onTrackLoaded() {
  WaypointEditor.init(worldTrack.data.waypoints);
  Night.buildLights(); // the pylons stand on this circuit's verges
  applyTrackSpawns();
  DebugConfig.adoptSpawns();
  selectRecords();
  resizeSkidCanvas(); // reallocating the layer is also what wipes it
  resetRace();
}

// --- Scoring ---

// What the stores are keyed by. Track ids never contain a colon, which is what
// lets upgradeKey() below tell an old key from a new one.
function recordsKey() {
  return `${currentTrack().id}:${EngineClass.current().id}`;
}

// Every key written before engine classes existed was a bare track id, and
// every time behind it was set in what is now 100cc.
function upgradeKey(key) {
  return key.includes(":") ? key : `${key}:${DEFAULT_CLASS_ID}`;
}

// Both tables were flat when there was one circuit: `highScores` an array of
// laps, `bestTotalTimes` a map of mode → totals. Either shape read off disk is
// taken as the first track's, so nobody loses the times they set before there
// was a second one — and whatever shape it arrives in, a key without a class
// becomes a 100cc key rather than being dropped.
function loadRecords() {
  allHighScores = {};
  allBestTotals = {};

  try {
    const parsed = JSON.parse(localStorage.getItem("highScores"));
    if (Array.isArray(parsed)) allHighScores[upgradeKey(TRACKS[0].id)] = parsed;
    else if (parsed && typeof parsed === "object") {
      for (const id of Object.keys(parsed))
        if (Array.isArray(parsed[id]))
          allHighScores[upgradeKey(id)] = parsed[id];
    } else if (parsed !== null) localStorage.removeItem("highScores");
  } catch {
    localStorage.removeItem("highScores");
  }

  try {
    const parsed = JSON.parse(localStorage.getItem("bestTotalTimes"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const flat = Object.values(parsed).some(Array.isArray);
      const byTrack = flat ? { [TRACKS[0].id]: parsed } : parsed;
      for (const id of Object.keys(byTrack)) {
        const modes = byTrack[id];
        if (!modes || typeof modes !== "object") continue;
        const key = upgradeKey(id);
        allBestTotals[key] = {};
        for (const mode of Object.keys(modes))
          if (Array.isArray(modes[mode]))
            allBestTotals[key][mode] = modes[mode];
      }
    } else if (parsed !== null) {
      localStorage.removeItem("bestTotalTimes");
    }
  } catch {
    localStorage.removeItem("bestTotalTimes");
  }

  selectRecords();
}

// Points the live tables at the loaded track and class's slice of the stores.
function selectRecords() {
  const key = recordsKey();
  highScores = allHighScores[key] || (allHighScores[key] = []);
  bestTotalTimes = allBestTotals[key] || (allBestTotals[key] = {});
}

// The clock's resolution is the millisecond: a recorded time is rounded to one
// the moment it is taken, so what gets sorted, compared against the record and
// written to localStorage is the same number the player is shown. Rounding
// only at the point of drawing would let two laps print 36.500 with one of
// them holding the record.
const toMillis = (ms) => Math.round(ms) / 1000;

// Times are carried as numbers of seconds and only ever turned into text here
// — a lap that came out at exactly 36.5, or 36, would print a digit or two
// short of every other time on the same screen.
function formatTime(seconds) {
  return Number(seconds).toFixed(3);
}

function saveLapTime(time) {
  const previousBest = highScores[0] || null;

  highScores.push(time);
  highScores.sort((a, b) => a - b);
  highScores = highScores.slice(0, 5);
  allHighScores[recordsKey()] = highScores;
  localStorage.setItem("highScores", JSON.stringify(allHighScores));

  lastLapTime = time;
  LapBanner.show(time, highScores[0] === time && time !== previousBest);
}

function saveTotalTime(mode, time) {
  const list = bestTotalTimes[mode] || [];
  const previousBest = list[0];

  isNewBestTotal = previousBest === undefined || time < previousBest;

  list.push(time);
  list.sort((a, b) => a - b);
  bestTotalTimes[mode] = list.slice(0, 3);
  localStorage.setItem("bestTotalTimes", JSON.stringify(allBestTotals));
}

function clearHighScores() {
  if (confirm("Clear all records, on every track and in every class?")) {
    allHighScores = {};
    allBestTotals = {};
    bestLapTime = 0;
    localStorage.removeItem("highScores");
    localStorage.removeItem("bestLap");
    localStorage.removeItem("bestTotalTimes");
    selectRecords();
  }
}

// ─────────────────────────────────────────
// RACE CONDITIONS
// ─────────────────────────────────────────

// Rolled per race and independent of the weather, so the four combinations all
// come up — including the one worth turning up for, rain at night. Unlike the
// rain it does not move mid-race: a circuit that got dark on lap 4 would read
// as a bug, and the lights coming up over the countdown is the shot.
const NIGHT_CHANCE = 0.3;

function scheduleNight() {
  Night.clear();
  if (gameMode !== "race5" && gameMode !== "race10") return; // free drive: N
  if (Math.random() < NIGHT_CHANCE) Night.toggle();
}

function scheduleWeather() {
  weatherWetFromLap = null;
  weatherWetToLap = null;

  if (gameMode === "race5") {
    // 50/50 — either the whole race is wet, or completely dry
    if (Math.random() < 0.5) {
      weatherWetFromLap = 1; // rain from lap 1
      weatherWetToLap = null; // stays wet all race
    }
  } else if (gameMode === "race10") {
    // Rain covers ~5 laps starting at a random lap between 1 and 6
    const start = 1 + Math.floor(Math.random() * 6); // 1–6
    const duration = 4 + Math.floor(Math.random() * 3); // 4–6 laps
    weatherWetFromLap = start;
    weatherWetToLap = start + duration; // rain stops when this lap begins
  }
  // free drive: no schedule — player uses P to toggle
}

function applyWeatherForLap(lap) {
  if (gameMode !== "race5" && gameMode !== "race10") return;
  const shouldBeWet =
    weatherWetFromLap !== null &&
    lap >= weatherWetFromLap &&
    (weatherWetToLap === null || lap < weatherWetToLap);
  const currentlyWet = Rain.targetIntensity > 0;
  if (shouldBeWet && !currentlyWet) Rain.toggle();
  if (!shouldBeWet && currentlyWet) Rain.toggle();
}

function resetRace() {
  isLeaderboard = false;
  isRaceFinished = false;
  finishHoldTimer = 0;
  totalRaceTime = 0;
  totalRaceStart = 0;
  finishOrder = [];
  playerFinishPosition = 0;
  nextFinishPosition = 1;

  // Clear rain and put the lights back up
  if (Rain.targetIntensity > 0) Rain.toggle();
  Night.clear();

  // Player
  car.x = SPAWN_POSITIONS[0].x;
  car.y = SPAWN_POSITIONS[0].y;
  car.angle = SPAWN_POSITIONS[0].angle;
  car.prevAngle = car.angle;
  car.steer = 0;
  car.speed = 0;
  car.velocityX = 0;
  car.velocityY = 0;
  car.laps = 0;
  car.onFinishLine = false;
  car.passedGate = false;
  car.finished = false;

  // AI — reset from the same spawn list, and re-roll the traits that make
  // one opponent feel different from another. These used to persist across
  // a restart, so every rerun of a race played out the same way. What gets
  // re-rolled is the *driver*: the car is the player's, every time, and
  // applyCarStats says so rather than a second copy of the numbers here.
  for (let i = 0; i < opponents.length; i++) {
    const s = SPAWN_POSITIONS[i + 1];
    const ai = opponents[i];
    ai.x = s.x;
    ai.y = s.y;
    ai.angle = s.angle;
    ai.prevAngle = s.angle;
    ai.steer = 0;
    ai.speed = 0;
    ai.velocityX = 0;
    ai.velocityY = 0;
    ai.currentWaypoint = 0;
    ai.steerDir = 0;
    ai.startDelay = Math.random() * 400;
    applyCarStats(ai);
    ai.rollDriver();
    ai.laps = 0;
    ai.onFinishLine = false;
    ai.passedGate = false;
    ai.finished = false;
    ai.finishTime = 0;
    ai.finishPosition = 0;
  }

  laps = 0;
  hasStarted = false;
  currentLapTime = 0;
  lastLapTime = null;
  onFinishLine = false;

  clearSkidMarks();
}

// ─────────────────────────────────────────
// RACE ORDER
//
// Opponents used to drive the track without ever being scored against it:
// nothing counted their laps, so a "5 Lap Race" was really a time trial
// with moving obstacles. Both the player and the AI now run through the
// same lap counter, and are ranked by the same progress metric.
// ─────────────────────────────────────────

let nextFinishPosition = 1;

function raceLapTarget() {
  return gameMode === "race5" ? 5 : gameMode === "race10" ? 10 : null;
}

// How far around the lap a car is, as a fraction of the lap's length. Found
// by projecting onto every waypoint segment and keeping the nearest — with 11
// waypoints and 6 cars that is 66 projections a frame, far cheaper than the
// bookkeeping needed to track it incrementally, and it can't desync.
//
// The answer is in lap distance rather than waypoint index because waypoints
// are not evenly spaced: this track's segments run 248px to 1040px, so
// "waypoint 4 of 11" is not "36% of the way round". Anything that reasons
// about position on the lap — the gate, the standings — has to mean distance,
// or it says something different on every track laid out.
//
// Waypoint 0 sits just before the start line, so laps and this fraction step
// over within ~30px of each other and `laps + progress` rises smoothly.
function trackProgress(entity) {
  const wps = worldTrack.data && worldTrack.data.waypoints;
  if (!wps || wps.length === 0) return 0;

  const n = wps.length;
  let total = 0;
  let best = 0;
  let bestDist = Infinity;

  for (let i = 0; i < n; i++) {
    const a = wps[i];
    const b = wps[(i + 1) % n];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const len2 = abx * abx + aby * aby || 1;

    let t = ((entity.x - a.x) * abx + (entity.y - a.y) * aby) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;

    const dx = entity.x - (a.x + abx * t);
    const dy = entity.y - (a.y + aby * t);
    const d = dx * dx + dy * dy;

    const len = Math.sqrt(len2);
    if (d < bestDist) {
      bestDist = d;
      best = total + len * t;
    }
    total += len;
  }

  return total > 0 ? best / total : 0;
}

function raceScore(entity) {
  return (entity.laps || 0) + trackProgress(entity);
}

// Every car, most advanced first. Cars that have taken the flag are locked
// to the order they finished in; the rest are sorted live by progress.
function raceStandings() {
  const entries = [
    { entity: car, isPlayer: true, name: "YOU", color: PLAYER_COLOR },
    ...opponents.map((ai, i) => ({
      entity: ai,
      isPlayer: false,
      name: `CPU ${i + 1}`,
      color: ai.color,
    })),
  ];

  for (const e of entries) {
    e.finished = !!e.entity.finished;
    e.laps = e.entity.laps || 0;
    e.score = e.finished ? Infinity : raceScore(e.entity);
  }

  entries.sort((a, b) => {
    if (a.finished && b.finished)
      return a.entity.finishPosition - b.entity.finishPosition;
    if (a.finished !== b.finished) return a.finished ? -1 : 1;
    return b.score - a.score;
  });

  entries.forEach((e, i) => (e.position = i + 1));
  return entries;
}

function playerPosition() {
  return raceStandings().find((e) => e.isPlayer).position;
}

// The flag does not cut straight to the results: the car brakes itself to a
// stop and the last lap's time gets its moment on screen first. The table is
// still built here, at the instant of crossing, so nothing in it can drift
// while the hold plays out — an opponent gaining a place after the player has
// already finished would read as the results reordering themselves.
const FINISH_HOLD_MS = 3000; // ms between taking the flag and the results

// Called once the player takes the flag. Everyone still circulating is
// classified where they stand rather than being left to finish — waiting
// out the rest of the field after your own race is over is nobody's idea of
// fun.
function finishRace() {
  const target = raceLapTarget();
  finishOrder = raceStandings().map((e) => ({
    position: e.position,
    name: e.name,
    color: e.color,
    isPlayer: e.isPlayer,
    dnf: !e.finished,
    laps: Math.min(e.laps, target),
    time: e.entity.finishTime,
  }));

  playerFinishPosition = finishOrder.find((e) => e.isPlayer).position;
  finishHoldTimer = FINISH_HOLD_MS;
}

// A crossing only counts once the car has been round the far side of the
// circuit. Rolling back and forth over the start line used to score a lap
// per pass, which beat driving the track. The gate is a stretch of lap rather
// than a single point so it can't be jumped, and it is deliberately nowhere
// near the start line — anything close to it would be re-armed by the same
// reversing it exists to stop.
//
// Measured in lap distance, so it means the same stretch of road whatever a
// track's waypoint count or spacing: four waypoints or two hundred, the gate
// is still the run between two fifths and two thirds of the way round.
const LAP_GATE_FROM = 0.4; // fraction of the lap, by distance
const LAP_GATE_TO = 0.65;

function updateLapGate(entity) {
  if (!(worldTrack.data.waypoints || []).length) {
    entity.passedGate = true; // no waypoints to check against; don't block laps
    return;
  }
  const p = trackProgress(entity);
  if (p >= LAP_GATE_FROM && p <= LAP_GATE_TO) entity.passedGate = true;
}

// World position at a fraction of the lap — the inverse of trackProgress, so
// anything measured in lap distance can be drawn back onto the track.
function ringPoint(f) {
  const wps = worldTrack.data.waypoints;
  const n = wps.length;
  const seg = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = wps[i];
    const b = wps[(i + 1) % n];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    seg.push(len);
    total += len;
  }

  let want = total * (((f % 1) + 1) % 1);
  for (let i = 0; i < n; i++) {
    if (want <= seg[i] || i === n - 1) {
      const a = wps[i];
      const b = wps[(i + 1) % n];
      const t = seg[i] > 0 ? Math.min(want / seg[i], 1) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    want -= seg[i];
  }
  return { x: wps[0].x, y: wps[0].y };
}

// Debug overlay for the waypoint ring: the arc that arms a lap, and where each
// car projects onto the ring. The projection is the interesting half — the
// gate and the standings both run on it, so a car latched to the wrong segment
// explains a wrong race position or a lap that won't count far quicker than
// either symptom does on its own.
const GATE_ARC_STEPS = 40; // segments the gate arc is drawn in

function drawLapGate(ctx) {
  const wps = worldTrack.data && worldTrack.data.waypoints;
  if (!wps || wps.length < 2) return;

  ctx.save();

  // The whole ring first, so the gate reads as a slice of it
  ctx.beginPath();
  wps.forEach((wp, i) => {
    const x = wp.x - camera.x;
    const y = wp.y - camera.y;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Gate arc, walked in even slices of lap distance so corners inside it bend
  const from = LAP_GATE_FROM;
  const to = LAP_GATE_TO;
  ctx.beginPath();
  for (let k = 0; k <= GATE_ARC_STEPS; k++) {
    const q = ringPoint(from + ((to - from) * k) / GATE_ARC_STEPS);
    const x = q.x - camera.x;
    const y = q.y - camera.y;
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = "rgba(0, 255, 136, 0.55)";
  ctx.lineWidth = 14;
  ctx.lineCap = "butt";
  ctx.stroke();

  // Small type over track art and over the band itself; outline it or half
  // the labels land on something the same colour as they are
  const label = (text, x, y, color) => {
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.lineWidth = 3;
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };

  const mid = ringPoint((from + to) / 2);
  ctx.font = "bold 11px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  label("LAP GATE", mid.x - camera.x, mid.y - camera.y - 16, "#00FF88");

  if (!isMenu) {
    const cars = [{ e: car, name: "YOU" }].concat(
      opponents.map((ai, i) => ({ e: ai, name: `${i + 1}` })),
    );

    for (const { e, name } of cars) {
      const p = trackProgress(e);
      const q = ringPoint(p);
      const sx = q.x - camera.x;
      const sy = q.y - camera.y;
      const tint = e.passedGate ? "#00FF88" : "#FF8844";

      // Tie the marker to the car it belongs to — with six of them on one
      // ring the dots are meaningless on their own
      ctx.beginPath();
      ctx.moveTo(e.x - camera.x, e.y - camera.y);
      ctx.lineTo(sx, sy);
      ctx.strokeStyle = tint;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, Math.PI * 2);
      ctx.fillStyle = tint;
      ctx.fill();

      ctx.font = "bold 10px monospace";
      label(`${name} ${(p * 100).toFixed(0)}% L${e.laps}`, sx, sy - 12, tint);
    }
  }

  ctx.restore();
}

// Shared lap counter. `entity` needs .x/.y/.laps/.onFinishLine/.finished;
// everything player-specific hangs off the isPlayer branch.
function updateLapCounter(entity, isPlayer) {
  if (entity.finished) return;

  updateLapGate(entity);

  const map = worldTrack.data.map;
  const ts = worldTrack.data.tileSize;
  const gx = Math.floor(entity.x / ts);
  const gy = Math.floor(entity.y / ts);
  const onLine = map[gy] !== undefined && map[gy][gx] === 9;

  if (!onLine) {
    entity.onFinishLine = false;
    if (isPlayer) onFinishLine = false;
    return;
  }
  if (entity.onFinishLine) return;
  entity.onFinishLine = true;
  if (isPlayer) onFinishLine = true;

  const now = performance.now();
  const target = raceLapTarget();

  // First crossing arms the race rather than completing a lap. Every car
  // times from its own first crossing, which is what the player's total has
  // always meant — keeping it that way leaves saved records comparable.
  if (entity.laps === 0) {
    entity.laps = 1;
    entity.passedGate = false;
    entity.raceStart = now;
    if (isPlayer) {
      hasStarted = true;
      laps = 1;
      totalRaceStart = now;
      lapStartTime = now;
      applyWeatherForLap(1);
    }
    return;
  }

  // Crossing the line the wrong way, or without having been round, is not a
  // lap — the car still gets its onFinishLine latch above so the next honest
  // crossing counts normally.
  if (!entity.passedGate) return;
  entity.passedGate = false;

  entity.laps++;

  // The crossing that takes the flag completed a lap like any other, and it
  // is usually the quickest one. Recording it below the finish branch meant a
  // 5-lap race only ever offered four of its laps to the records.
  if (isPlayer) {
    const lapTime = toMillis(now - lapStartTime);
    lapStartTime = now;
    saveLapTime(lapTime);
  }

  if (target && entity.laps > target) {
    entity.finished = true;
    entity.finishPosition = nextFinishPosition++;
    entity.finishTime = toMillis(now - entity.raceStart);

    if (isPlayer) {
      totalRaceTime = entity.finishTime;
      saveTotalTime(gameMode, totalRaceTime);
      laps = target;
      finishRace();
    }
    return;
  }

  if (isPlayer) {
    laps = entity.laps;
    applyWeatherForLap(laps);
  }
}

// --- Collision ---

// The map edge is the only hard barrier — everything inside it, dirt
// included, is drivable. Killing just the outward velocity component
// lets a car slide along the edge instead of sticking to it.
function clampToWorld(entity) {
  if (!worldTrack.data || !worldTrack.data.map) return;
  const ts = worldTrack.data.tileSize;
  const maxX = worldTrack.data.map[0].length * ts;
  const maxY = worldTrack.data.map.length * ts;
  const r = Math.max(entity.width, entity.height) / 2;

  if (entity.x < r) {
    entity.x = r;
    if (entity.velocityX < 0) entity.velocityX = 0;
  } else if (entity.x > maxX - r) {
    entity.x = maxX - r;
    if (entity.velocityX > 0) entity.velocityX = 0;
  }

  if (entity.y < r) {
    entity.y = r;
    if (entity.velocityY < 0) entity.velocityY = 0;
  } else if (entity.y > maxY - r) {
    entity.y = maxY - r;
    if (entity.velocityY > 0) entity.velocityY = 0;
  }
}

// Average "offroadness" under the four wheels rather than at the car's
// centre. A 34×56 car sampled at one point can hang half its body over the
// grass at zero cost, and then loses grip all at once when the centre
// finally crosses; per-wheel, dropping two wheels onto the dirt costs about
// half of what going fully off does, and a clipped kerb costs a little.
const WHEEL_INSET_X = 0.36; // of half-width
const WHEEL_INSET_Y = 0.34; // of half-height

function wheelOffRoad(entity) {
  if (!worldTrack.field) return 0;

  const cos = Math.cos(entity.angle);
  const sin = Math.sin(entity.angle);
  const hw = (entity.width / 2) * WHEEL_INSET_X * 2;
  const hh = (entity.height / 2) * WHEEL_INSET_Y * 2;

  let sum = 0;
  for (let i = 0; i < 4; i++) {
    const lx = i & 1 ? hw : -hw;
    const ly = i & 2 ? hh : -hh;
    sum += worldTrack.offRoad(
      entity.x + lx * cos - ly * sin,
      entity.y + lx * sin + ly * cos,
    );
  }
  return sum / 4;
}

const OFFROAD_DRAG = 0.08; // fraction of speed shed per frame, fully off the road

// Cornering scrub, graded by slip. Kept in step with phaser/matterCar.js,
// which carries the reasoning and the measurements — the short version is that
// charging the full rate for any frame with a steering key down cost a 100ms
// correction a fifth of the car's speed, and slip is what tells a turn-in
// apart from a slide. A held lock settles at sin(slip) = turnSpeed / driftGrip
// = 0.6, so a real corner still pays the old rate.
const SCRUB_FULL_SLIP = 0.5; // sin of heading-vs-velocity angle that scrubs in full
const SCRUB_AT_MAX = 0.06; // of speed shed per frame, fully sideways at maxSpeed
const SCRUB_AT_REST = 0.02; // ... and the same, at a standstill

function slipSin(entity) {
  const mag = Math.hypot(entity.velocityX, entity.velocityY);
  if (mag < 0.01) return 0;
  const lateral =
    entity.velocityX * Math.cos(entity.angle) +
    entity.velocityY * Math.sin(entity.angle);
  return Math.min(1, Math.abs(lateral) / mag);
}

// --- The car, for whoever is driving it ---
//
// Split in two because the collision pass has to sit between the halves: a
// shove has to land after the driver has chosen this frame's inputs and
// before the car is integrated, or a car is pushed out of a gap it has
// already been moved through. The player's keys and AIDriver's decisions both arrive
// here as the same four booleans, so there is exactly one set of physics on
// the grid.
//
// `rollOut` is the fifth input and not a key: past the flag the player is a
// passenger and the car brakes itself to a standstill. It stops at zero
// rather than braking through it, which would back the car over its own
// finish line.
function stepCarControls(entity, input, delta) {
  if (input.rollOut) {
    const drop = entity.acceleration * delta;
    entity.speed =
      Math.abs(entity.speed) <= drop
        ? 0
        : entity.speed - Math.sign(entity.speed) * drop;
  } else if (input.accel)
    entity.speed += entity.acceleration * Rain.accelScale() * delta;
  else if (input.brake) entity.speed -= entity.acceleration * delta;
  else entity.speed *= Math.pow(entity.friction + Rain.frictionBonus(), delta);

  if (entity.speed > entity.maxSpeed) entity.speed = entity.maxSpeed;
  if (entity.speed < -entity.maxSpeed / 2) entity.speed = -entity.maxSpeed / 2;
  if (!input.accel && !input.brake && Math.abs(entity.speed) < 0.01)
    entity.speed = 0;

  const flip = entity.speed >= 0 ? 1 : -1;
  if (input.left) entity.angle -= entity.turnSpeed * flip * delta;
  if (input.right) entity.angle += entity.turnSpeed * flip * delta;

  // Cornering scrub. The opponents never paid this, which is a good part of
  // why they could carry speed through a corner the player had to brake for.
  if (entity.speed !== 0 && (input.left || input.right)) {
    const load = Math.min(1, slipSin(entity) / SCRUB_FULL_SLIP);
    const rate =
      SCRUB_AT_REST +
      (SCRUB_AT_MAX - SCRUB_AT_REST) *
        (Math.abs(entity.speed) / entity.maxSpeed);
    entity.speed *= Math.pow(1 - rate * load, delta);
  }
}

function stepCarMotion(entity, delta) {
  const targetVx = Math.sin(entity.angle) * entity.speed;
  const targetVy = -Math.cos(entity.angle) * entity.speed;
  const grip =
    entity.driftGrip * Rain.gripScale() * Rain.puddleGripAt(entity);
  entity.velocityX += (targetVx - entity.velocityX) * grip * delta;
  entity.velocityY += (targetVy - entity.velocityY) * grip * delta;

  entity.x += entity.velocityX * delta;
  entity.y += entity.velocityY * delta;
  clampToWorld(entity);

  // Per-frame decay has to be raised to `delta`, like the friction above —
  // applied straight it would drag twice as hard at 120fps as at 60. The
  // opponents used to get a speed *ceiling* off the road instead, which let
  // them run the grass at a flat 45% forever rather than bleeding to a crawl.
  const offRoad = wheelOffRoad(entity);
  if (offRoad > 0) entity.speed *= Math.pow(1 - OFFROAD_DRAG * offRoad, delta);
}

// --- Draw helpers ---

// The slice of the baked world that lands on screen this frame, in CSS px,
// or null when none of it does. Both world layers share it, and so does the
// decision about whether the frame still needs clearing.
function worldViewRect() {
  if (!worldTrack.bakedCanvas) return null;

  // Source and destination are both in world pixels — the zoom is a context
  // scale wrapped around the blit, not something this has to divide into.
  const view = TrackEditor.getViewOffset() || camera;
  const srcX = Math.max(0, Math.floor(view.x));
  const srcY = Math.max(0, Math.floor(view.y));
  const dstX = Math.max(0, Math.floor(-view.x));
  const dstY = Math.max(0, Math.floor(-view.y));
  const srcW = Math.min(
    worldTrack.bakedCanvas.width - srcX,
    viewWidth() - dstX,
  );
  const srcH = Math.min(
    worldTrack.bakedCanvas.height - srcY,
    viewHeight() - dstY,
  );

  return srcW > 0 && srcH > 0 ? { srcX, srcY, dstX, dstY, srcW, srcH } : null;
}

function worldCoversViewport(rect) {
  return (
    !!rect &&
    rect.dstX === 0 &&
    rect.dstY === 0 &&
    rect.srcW >= viewWidth() &&
    rect.srcH >= viewHeight()
  );
}

function drawCar() {
  CarSprites.draw(ctx, car, PLAYER_COLOR);
}

// Whoever is on track this frame, in the same order the sprites are drawn in.
// Night lights every car the same way, so this has to agree with the block in
// gameLoop that draws them or a car ends up with headlights and no body.
function litCars() {
  const out = [];
  if (!isMenu && !TrackEditor.active) out.push(car);
  if (paceCarActive()) {
    const p = paceCar();
    if (p) out.push(p);
  } else if (!TrackEditor.active) {
    for (const ai of opponents) out.push(ai);
  }
  return out;
}


let lastTime = 0;

function resolveCollision(a, b) {
  let finalPushX = 0,
    finalPushY = 0,
    finalARatio = 1,
    finalBRatio = 1;
  let didCollide = false;

  // Separation loop — position only, no velocity changes here
  for (let iter = 0; iter < 3; iter++) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    const cos = Math.cos(-a.angle);
    const sin = Math.sin(-a.angle);

    const localX = dx * cos - dy * sin;
    const localY = dx * sin + dy * cos;

    const halfW = a.width * DebugConfig.values.collisionHalfW;
    const halfH = a.height * DebugConfig.values.collisionHalfH;

    const overlapX = halfW - Math.abs(localX);
    const overlapY = halfH - Math.abs(localY);

    if (overlapX <= 0 || overlapY <= 0) return;

    let pushLocalX = 0;
    let pushLocalY = 0;

    if (overlapX < overlapY) {
      pushLocalX = overlapX * Math.sign(localX);
    } else {
      pushLocalY = overlapY * Math.sign(localY);
    }

    const cos2 = Math.cos(a.angle);
    const sin2 = Math.sin(a.angle);

    const pushX = pushLocalX * cos2 - pushLocalY * sin2;
    const pushY = pushLocalX * sin2 + pushLocalY * cos2;

    const totalSpeed = Math.abs(a.speed) + Math.abs(b.speed) + 0.001;
    const aRatio = Math.abs(b.speed) / totalSpeed;
    const bRatio = Math.abs(a.speed) / totalSpeed;

    // Separate
    a.x -= pushX * aRatio;
    a.y -= pushY * aRatio;
    b.x += pushX * bRatio;
    b.y += pushY * bRatio;

    // Track the last resolved push for the impulse step below
    finalPushX = pushX;
    finalPushY = pushY;
    finalARatio = aRatio;
    finalBRatio = bRatio;
    didCollide = true;
  }
  // Apply velocity impulse exactly once, after all position separation is done.
  // Clamp nudge so a large overlap can never launch a car across the map.
  if (didCollide) {
    const impactForce = Math.sqrt(
      finalPushX * finalPushX + finalPushY * finalPushY,
    );

    if (impactForce > DebugConfig.values.collisionHardImpact) {
      const MAX_NUDGE = 2.5;
      const nudge = Math.min(
        impactForce * DebugConfig.values.collisionNudge,
        MAX_NUDGE,
      );

      a.velocityX -= finalPushX * finalARatio * nudge;
      a.velocityY -= finalPushY * finalARatio * nudge;
      b.velocityX += finalPushX * finalBRatio * nudge;
      b.velocityY += finalPushY * finalBRatio * nudge;

      Sound.impact(impactForce);

      // Only punish very hard impacts, and punish both cars the same. The
      // opponents used to take this on a `speedMultiplier` floored at 0.7,
      // so a hit that cost the player 15% of its speed outright cost them a
      // recoverable 10% of a ceiling they were rarely against.
      if (impactForce > 3) {
        a.speed *= 0.85;
        b.speed *= 0.85;
      }
    }
  }
}

// --- Unified game loop ---
function gameLoop(timestamp) {
  const dt = timestamp - lastTime;
  lastTime = timestamp;

  // Normalised delta — 1.0 at 60fps, 0.5 at 120fps, 2.0 at 30fps
  const delta = Math.min(dt / (1000 / 60), 3); // cap at 3 to prevent huge jumps after tab switch

  // True whenever a menu/overlay screen owns input — the race must not
  // auto-resume or keep updating physics in the background while shown.
  const inOverlay = isMenu || isKeyBindings || isLeaderboard || isRaceFinished;

  // Escape during the countdown drops to the menu with the sequence still
  // running, so it has to be held rather than left to tick — otherwise it
  // counts down behind the menu and now beeps over it too.
  StartLights.update(timestamp, inOverlay);
  LapBanner.update(dt);
  // Raw dt, not the clamped delta — a frame that took 40ms is the whole
  // signal here, and `delta` throws that away above 50ms.
  Quality.sample(dt);
  DebugHUD.update(timestamp);
  Rain.update(delta);
  Night.update(delta);

  // Same reason the countdown is held above: a hold left running behind the
  // menu would drop the player onto the results the moment they came back.
  if (finishHoldTimer > 0 && !inOverlay) {
    finishHoldTimer -= dt;
    if (finishHoldTimer <= 0) {
      finishHoldTimer = 0;
      isRaceFinished = true;
      isRacing = false;
    }
  }

  if (!StartLights.active && !isRacing && !inOverlay) {
    isRacing = true;
  }

  // UPDATE
  let throttle = false;
  let slip = 0;

  if (isRacing && !inOverlay) {
    // Past the flag the player is a passenger — the keys do nothing and the
    // car brakes itself down. The opponents are deliberately left racing:
    // they are still on their own lap, and the table was already taken.
    const rollingOut = finishHoldTimer > 0;

    const playerInput = {
      rollOut: rollingOut,
      accel: !rollingOut && !!keys[KeyBindings.bindings.accelerate],
      brake: !rollingOut && !!keys[KeyBindings.bindings.brake],
      left: !rollingOut && !!keys[KeyBindings.bindings.left],
      right: !rollingOut && !!keys[KeyBindings.bindings.right],
    };
    throttle = playerInput.accel;

    // CONTROLS — six drivers, one car. The only difference between these two
    // lines is where the four booleans came from.
    stepCarControls(car, playerInput, delta);
    opponents.forEach((ai) =>
      stepCarControls(
        ai,
        ai.drive(worldTrack.data.waypoints, car, opponents, delta),
        delta,
      ),
    );

    // Front-wheel artwork, off the yaw they all just produced
    updateSteerVisual(car, delta);
    opponents.forEach((ai) => updateSteerVisual(ai, delta));

    // AI vs AI
    for (let i = 0; i < opponents.length; i++) {
      for (let j = i + 1; j < opponents.length; j++) {
        resolveCollision(opponents[i], opponents[j]);
      }
    }

    // Player vs AI
    opponents.forEach((ai) => resolveCollision(car, ai));

    // MOTION — after the shoves, so a car cannot be pushed out of a gap it
    // has already been integrated through.
    stepCarMotion(car, delta);
    opponents.forEach((ai) => stepCarMotion(ai, delta));

    updateLapCounter(car, true);
    opponents.forEach((ai) => updateLapCounter(ai, false));

    slip = lateralSlip(car);

    // Marks come from the tires actually sliding, not from the steering key
    // being down. Slip builds over ~10 frames after the wheel goes over, so a
    // tap or a mid-straight correction never reaches the threshold while a
    // committed corner does — and a shove from another car marks the tarmac
    // even though nothing was steered. The opponents run the same rule, scaled
    // to their own grip; they slide under their own steering, so the corners
    // rubber up whether or not the player is the one abusing them.
    if (slip > skidThreshold(car)) paintSkidMark(car);
    opponents.forEach((ai) => {
      if (lateralSlip(ai) > skidThreshold(ai)) paintSkidMark(ai);
    });
  }

  // The waypoint editor's pace car runs where the race does not — the menu is
  // an overlay, so the block above never ran this frame.
  if (paceCarActive()) {
    if (!paceRunning) startPaceCar();
    updatePaceCar(delta);
  } else if (paceRunning) {
    stopPaceCar();
  }

  Sound.update(
    car.speed,
    car.maxSpeed,
    throttle,
    slip,
    isRacing && !inOverlay && !TrackEditor.active,
  );

  // Camera always follows — runs during countdown too, except where the free
  // camera has taken it (an editor open from the menu, with no car driving it).
  if (freeCameraActive()) {
    clampEditorView(); // the window can be resized under it
    camera.x = editorView.x;
    camera.y = editorView.y;
  } else {
    viewZoom = 1; // the free camera is the only thing that moves it
    camera.x = car.x - camera.width / 2;
    camera.y = car.y - camera.height / 2;
  }

  // DRAW
  const world = worldViewRect();

  // The baked track is opaque, so wherever it reaches all four edges the
  // clear underneath it is dead work — and it is a full-viewport pass.
  if (!worldCoversViewport(world)) {
    ctx.clearRect(0, 0, camera.width, camera.height);
  }

  // Everything from here to the matching restore is drawn in world pixels
  // relative to camera.x/y, so one scale is the whole of the free camera's
  // zoom — the track, the cars, the waypoints and the debug rings all follow
  // it without knowing it exists. It is exactly 1 outside the editors.
  ctx.save();
  ctx.scale(viewZoom, viewZoom);

  if (world) {
    const { srcX, srcY, dstX, dstY, srcW, srcH } = world;

    // Both world layers span the viewport, and the devicePixelRatio scale on
    // the context makes each drawImage a resample of every pixel on screen —
    // the two of them were the whole frame budget at 2x. Nearest neighbour is
    // about twice as fast, and when magnifying it is sharper than the smoothed
    // version rather than worse. Below 1x it is not: dropping pixels out of the
    // baked track makes the kerbs crawl, so that rung pays for the filter.
    ctx.imageSmoothingEnabled = renderDpr < 1;
    ctx.drawImage(
      worldTrack.bakedCanvas,
      srcX,
      srcY,
      srcW,
      srcH,
      dstX,
      dstY,
      srcW,
      srcH,
    );
    if (!TrackEditor.active)
      // hide skid marks while editing. The skid layer may be at a lower
      // resolution than the world, so its source rect is scaled.
      ctx.drawImage(
        skidCanvas,
        srcX * skidScale,
        srcY * skidScale,
        srcW * skidScale,
        srcH * skidScale,
        dstX,
        dstY,
        srcW,
        srcH,
      );
    ctx.imageSmoothingEnabled = true; // sprites and the minimap still want it

    Rain.drawPuddles(); // world-space puddles, before cars
  }

  // Cars — world space
  // Only night reads this, so a day frame does not even build the list.
  const lit = Night.active && !TrackEditor.active ? litCars() : [];
  if (!isMenu && !TrackEditor.active) drawCar();
  if (paceCarActive()) paceCar()?.draw();
  else if (!TrackEditor.active) opponents.forEach((ai) => ai.draw());

  ctx.restore();

  Rain.drawOverlay(); // scene tint — a full-viewport fill, so outside the zoom
  if (!TrackEditor.active) Night.drawLightLayer(lit); // the night goes over the
  Rain.drawDrops(); // tint and under the rain, so the streaks read as caught in it
  Rain.drawSplashes(); // where the drops just drawn are landing

  // Back into world pixels: the lamps, the gate band and the waypoint ring are
  // drawn on the road, not on the screen.
  ctx.save();
  ctx.scale(viewZoom, viewZoom);
  if (!TrackEditor.active) Night.drawLamps(lit); // over the veil, or it puts them out
  if (DEBUG && !TrackEditor.active) drawLapGate(ctx);
  if (DEBUG && !TrackEditor.active) WaypointEditor.draw(ctx);
  ctx.restore();

  if (DEBUG) TrackEditor.draw(ctx);
  // On the menu the overlay is drawn after the panel instead — see below.
  if (DEBUG && !isMenu && !TrackEditor.active) DebugHUD.draw(ctx);

  // The clickable overlays own the cursor; clear it everywhere else — an
  // editor that took the screen off the menu included, or the pointer the menu
  // left behind stays on the map.
  if (
    (!isMenu || menuEditorOpen()) &&
    !isKeyBindings &&
    !isLeaderboard &&
    !isRaceFinished &&
    canvas.style.cursor !== "default"
  ) {
    canvas.style.cursor = "default";
  }

  if (isMenu) {
    if (!menuEditorOpen()) {
      drawStartMenu();
      // Drawn after the menu, so the menu's own hover pass can't take the
      // cursor back off the popup's buttons.
      if (isCredits) drawCredits();
    }
    // After the panel, not before it: the menu is a full-screen 80% dim, and
    // under it the one line naming the keys DEBUG just enabled is unreadable.
    // Not over the credits, which eat those keys while they are up.
    if (DEBUG && !isCredits && !TrackEditor.active) DebugHUD.draw(ctx);
  } else if (isKeyBindings) KeyBindings.draw(ctx, camera, mousePos);
  else if (isRaceFinished) drawRaceFinished();
  else if (isLeaderboard) drawLeaderboard();
  else if (!TrackEditor.active) drawUI();

  // Same reason the countdown is frozen above: a held sequence must not leave
  // its lights sitting on the menu.
  if (!inOverlay) StartLights.draw(ctx, camera.width, camera.height);

  // Race-only overlays. These sit on top of everything, so they have to be
  // held back on the screens that own the display — a "WET TRACK" label
  // across the results table reads as part of the results.
  if (!inOverlay && !TrackEditor.active) {
    LapBanner.draw(ctx);
    Rain.drawHUD();
    Night.drawHUD();
  }

  DebugHUD.endFrame();
  requestAnimationFrame(gameLoop);
}

// --- Init ---
async function initGame() {
  try {
    await initGameUnsafe();
  } catch (err) {
    console.error("Failed to initialize game:", err);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, camera.width, camera.height);
    ctx.fillStyle = "#FF4444";
    ctx.font = "bold 24px 'Courier New'";
    ctx.textAlign = "center";
    ctx.fillText(
      "Failed to load the game. Please refresh the page.",
      camera.width / 2,
      camera.height / 2,
    );
  }
}

async function initGameUnsafe() {
  KeyBindings.load();
  Sound.load();
  EngineClass.load(); // before loadRecords — the class is half the records key
  await loadCredits();
  loadRecords();
  // Whichever circuit was last raced, plus everything cut to fit it — the
  // player is already on its grid by the time this resolves.
  await applySelectedTrack();

  // AI — created from spawn list
  for (let i = 1; i < SPAWN_POSITIONS.length; i++) {
    const s = SPAWN_POSITIONS[i];
    opponents.push(new AICar(ctx, s.x, s.y, s.color));
  }

  requestAnimationFrame(gameLoop);

  DebugConfig.init();

  // editor.html opens straight into the tools. This loop is no longer the
  // game — index.html is — so there is nothing to unlock DEBUG *from*, and
  // making the one page whose whole purpose is the editors ask for them twice
  // was ceremony. The track editor is a keypress away on T; the waypoint one
  // is the tool that wants the free camera and the pace car, so it opens.
  if (window.EDITOR_PAGE) {
    DEBUG = true;
    WaypointEditor.toggle();
  }
}

initGame();
