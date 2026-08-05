const GAME_VERSION = "0.11.0";

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
let highScores = [];
try {
  const parsed = JSON.parse(localStorage.getItem("highScores"));
  if (Array.isArray(parsed)) highScores = parsed;
  else if (parsed !== null) localStorage.removeItem("highScores");
} catch {
  localStorage.removeItem("highScores");
}
let bestTotalTimes = {};
try {
  const parsed = JSON.parse(localStorage.getItem("bestTotalTimes"));
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    for (const mode of Object.keys(parsed)) {
      if (Array.isArray(parsed[mode])) bestTotalTimes[mode] = parsed[mode];
    }
  } else if (parsed !== null) {
    localStorage.removeItem("bestTotalTimes");
  }
} catch {
  localStorage.removeItem("bestTotalTimes");
}
let isNewBestTotal = false;
let isLeaderboard = false;
let savedSpeed = 0;
let racePaused = false;
let gameMode = "free"; // "free" | "race5" | "race10"
let selectedMode = 0; // menu cursor
let weatherWetFromLap = null;
let weatherWetToLap = null;
let totalRaceStart = 0;
let totalRaceTime = 0;
let isRaceFinished = false;
let finishHoldTimer = 0; // ms left of the roll-out before the results appear
let leaderboardFrom = "game"; // "game" | "menu"
let isKeyBindings = false;

// Final classification, built the moment the player crosses the line — see
// finishRace(). Opponents still on track are classified where they stand.
let finishOrder = [];
let playerFinishPosition = 0;

const MODES = [
  { id: "free", label: "Free Drive" },
  { id: "race5", label: "5 Lap Race" },
  { id: "race10", label: "10 Lap Race" },
];

// Staggered starting grid on the top straight, behind the finish line.
// The straight runs y 128–320, so the two lanes sit at 190 and 258 — a car
// is 34 wide across the grid and 56 long along it, which leaves both lanes
// clear of the kerbs and every pair far enough apart that the collision
// solver has nothing to separate on the line.
const SPAWN_POSITIONS = [
  { x: 560, y: 190, angle: Math.PI / 2, color: null }, // player
  { x: 500, y: 258, angle: Math.PI / 2, color: "#0077ff" }, // AI 1
  { x: 440, y: 190, angle: Math.PI / 2, color: "#ff7700" }, // AI 2
  { x: 380, y: 258, angle: Math.PI / 2, color: "#00cc44" }, // AI 3
  { x: 320, y: 190, angle: Math.PI / 2, color: "#cc00cc" }, // AI 4
];

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
}
resizeCanvas();

const car = {
  x: 0,
  y: 0,
  width: 34,
  height: 56,
  angle: 0,
  speed: 0,
  acceleration: 0.2,
  maxSpeed: 10,
  turnSpeed: 0.06,
  velocityX: 0,
  velocityY: 0,
  friction: 0.96,
  driftGrip: 0.1,

  // Race state, shared in shape with AICar so updateLapCounter and the
  // standings can treat the player as just another entry
  laps: 0,
  onFinishLine: false,
  finished: false,
  finishPosition: 0,
  finishTime: 0,
  raceStart: 0,
};
// One source of truth for the player's livery: it paints the sprite and the
// colour chip beside "YOU" in the standings, which have to agree.
const PLAYER_COLOR = "#e01b1b";

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
// grips harder, and that is how the opponents stopped marking: aiGrip went
// 0.15 → 0.2 for the racing, their slip fell under a 2.4 tuned at 0.15, and
// four cars laid two scuffs a race. Scaling the threshold by grip asks both
// for the same manoeuvre instead of the same number, and keeps doing so when
// either grip slider moves. Rain is deliberately not in here: it lowers grip
// to make the cars slide, and dividing that back out would erase the point.
function skidThreshold(entity) {
  const grip = entity.driftGrip ?? entity.grip; // player / opponent
  return SKID_SLIP * (SKID_REF_GRIP / grip);
}

// --- Menu actions (shared by keyboard and mouse) ---
function startSelectedMode() {
  resetRace();
  racePaused = false;
  savedSpeed = 0;
  gameMode = MODES[selectedMode].id;
  isMenu = false;
  isRacing = false;
  scheduleWeather();
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

function toggleDebug() {
  DEBUG = !DEBUG;
  console.log(`Debug ${DEBUG ? "ON" : "OFF"}`);
  if (!DEBUG) WaypointEditor.active = false; // close editor when debug turns off
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
    if (key === "escape" && racePaused) {
      resumePausedRace();
      return;
    }
    if (e.key === "ArrowUp") {
      selectedMode = (selectedMode - 1 + MODES.length) % MODES.length;
      return;
    }
    if (e.key === "ArrowDown") {
      selectedMode = (selectedMode + 1) % MODES.length;
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

  if (key === "b") {
    toggleDebug();
    return;
  }
  if (key === "c" && DEBUG && !isLeaderboard) {
    DebugConfig.toggle();
    return;
  }
  if (key === "e" && DEBUG) {
    WaypointEditor.toggle();
    return;
  }
  if (key === "t" && DEBUG) {
    TrackEditor.toggle();
    return;
  }
  if (key === "z" && DEBUG) {
    WaypointEditor.undo();
    return;
  }
  if (key === "p" && DEBUG) {
    e.preventDefault();
    WaypointEditor.export();
    return;
  }
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
  if (isMenu) {
    if (e.button === 0) handleMenuClick(e.clientX, e.clientY);
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
  WaypointEditor.handleMouseDown(e.clientX, e.clientY);
});

canvas.addEventListener("mousemove", (e) => {
  mousePos.x = e.clientX;
  mousePos.y = e.clientY;
  if (isMenu || isKeyBindings || isLeaderboard || isRaceFinished) return;
  if (TrackEditor.active) {
    TrackEditor.handleMouseMove(e.clientX, e.clientY, e.buttons);
    return;
  }
  WaypointEditor.handleMouseMove(e.clientX, e.clientY);
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
    TrackEditor.handleWheel(e);
  },
  { passive: false },
);

const worldTrack = new Track(ctx);

// --- Scoring ---
function saveLapTime(time) {
  const parsed = parseFloat(time);
  const previousBest = highScores[0] || null;

  highScores.push(parsed);
  highScores.sort((a, b) => a - b);
  highScores = highScores.slice(0, 5);
  localStorage.setItem("highScores", JSON.stringify(highScores));

  lastLapTime = time;
  LapBanner.show(time, highScores[0] === parsed && parsed !== previousBest);
}

function saveTotalTime(mode, time) {
  const parsed = parseFloat(time);
  const list = bestTotalTimes[mode] || [];
  const previousBest = list[0];

  isNewBestTotal = previousBest === undefined || parsed < previousBest;

  list.push(parsed);
  list.sort((a, b) => a - b);
  bestTotalTimes[mode] = list.slice(0, 3);
  localStorage.setItem("bestTotalTimes", JSON.stringify(bestTotalTimes));
}

function clearHighScores() {
  if (confirm("Clear all high scores and records?")) {
    highScores = [];
    bestLapTime = 0;
    bestTotalTimes = {};
    localStorage.removeItem("highScores");
    localStorage.removeItem("bestLap");
    localStorage.removeItem("bestTotalTimes");
  }
}

// ─────────────────────────────────────────
// WEATHER SCHEDULING
// ─────────────────────────────────────────
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

  // Clear rain
  if (Rain.targetIntensity > 0) Rain.toggle();

  // Player
  car.x = SPAWN_POSITIONS[0].x;
  car.y = SPAWN_POSITIONS[0].y;
  car.angle = SPAWN_POSITIONS[0].angle;
  car.speed = 0;
  car.velocityX = 0;
  car.velocityY = 0;
  car.laps = 0;
  car.onFinishLine = false;
  car.finished = false;

  // AI — reset from the same spawn list, and re-roll the traits that make
  // one opponent feel different from another. These used to persist across
  // a restart, so every rerun of a race played out the same way.
  const cfg = DebugConfig.values;
  for (let i = 0; i < opponents.length; i++) {
    const s = SPAWN_POSITIONS[i + 1];
    const ai = opponents[i];
    ai.x = s.x;
    ai.y = s.y;
    ai.angle = s.angle;
    ai.speed = 0;
    ai.velocityX = 0;
    ai.velocityY = 0;
    ai.speedMultiplier = 1;
    ai.currentWaypoint = 0;
    ai.startDelay = Math.random() * 400;
    ai.lineOffset = (Math.random() - 0.5) * (cfg.aiLineOffsetRange ?? 40);
    ai.baseMaxSpeed =
      (cfg.aiMaxSpeedMin ?? 8.3) +
      Math.random() * ((cfg.aiMaxSpeedMax ?? 9.6) - (cfg.aiMaxSpeedMin ?? 8.3));
    ai.maxSpeed = ai.baseMaxSpeed;
    ai.laps = 0;
    ai.onFinishLine = false;
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

// How far around the lap a car is, as a fractional waypoint index. Found by
// projecting onto every waypoint segment and keeping the nearest — with 11
// waypoints and 6 cars that is 66 projections a frame, far cheaper than the
// bookkeeping needed to track it incrementally, and it can't desync.
//
// Waypoint 0 sits just before the start line, so laps and this index step
// over within ~30px of each other and `laps * n + progress` rises smoothly.
function trackProgress(entity) {
  const wps = worldTrack.data && worldTrack.data.waypoints;
  if (!wps || wps.length === 0) return 0;

  const n = wps.length;
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

    if (d < bestDist) {
      bestDist = d;
      best = i + t;
    }
  }

  return best;
}

function raceScore(entity) {
  const n = (worldTrack.data.waypoints || []).length || 1;
  return (entity.laps || 0) * n + trackProgress(entity);
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
// out four CPU cars after your own race is over is nobody's idea of fun.
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

// Shared lap counter. `entity` needs .x/.y/.laps/.onFinishLine/.finished;
// everything player-specific hangs off the isPlayer branch.
function updateLapCounter(entity, isPlayer) {
  if (entity.finished) return;

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

  entity.laps++;

  // The crossing that takes the flag completed a lap like any other, and it
  // is usually the quickest one. Recording it below the finish branch meant a
  // 5-lap race only ever offered four of its laps to the records.
  if (isPlayer) {
    const lapTime = ((now - lapStartTime) / 1000).toFixed(2);
    lapStartTime = now;
    saveLapTime(lapTime);
  }

  if (target && entity.laps > target) {
    entity.finished = true;
    entity.finishPosition = nextFinishPosition++;
    entity.finishTime = ((now - entity.raceStart) / 1000).toFixed(2);

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

function updatePlayerSurface(delta) {
  if (!worldTrack.data || !worldTrack.data.map) return;

  const offRoad = wheelOffRoad(car);
  // Per-frame decay has to be raised to `delta`, like the friction above —
  // applied straight it would drag twice as hard at 120fps as at 60.
  if (offRoad > 0) car.speed *= Math.pow(1 - 0.08 * offRoad, delta);

  updateLapCounter(car, true);
}

// --- Draw helpers ---

// The slice of the baked world that lands on screen this frame, in CSS px,
// or null when none of it does. Both world layers share it, and so does the
// decision about whether the frame still needs clearing.
function worldViewRect() {
  if (!worldTrack.bakedCanvas) return null;

  const view = TrackEditor.getViewOffset() || camera;
  const srcX = Math.max(0, Math.floor(view.x));
  const srcY = Math.max(0, Math.floor(view.y));
  const dstX = Math.max(0, Math.floor(-view.x));
  const dstY = Math.max(0, Math.floor(-view.y));
  const srcW = Math.min(
    worldTrack.bakedCanvas.width - srcX,
    camera.width - dstX,
  );
  const srcH = Math.min(
    worldTrack.bakedCanvas.height - srcY,
    camera.height - dstY,
  );

  return srcW > 0 && srcH > 0 ? { srcX, srcY, dstX, dstY, srcW, srcH } : null;
}

function worldCoversViewport(rect) {
  return (
    !!rect &&
    rect.dstX === 0 &&
    rect.dstY === 0 &&
    rect.srcW >= camera.width &&
    rect.srcH >= camera.height
  );
}

function drawCar() {
  ctx.save();
  ctx.translate(car.x - camera.x, car.y - camera.y); // screen space
  ctx.rotate(car.angle);

  // Centred on the car's position, so rotation turns it about its middle
  ctx.drawImage(
    CarSprites.get(PLAYER_COLOR),
    -car.width / 2,
    -car.height / 2,
    car.width,
    car.height,
  );

  ctx.restore();
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

      // Only punish very hard impacts
      if (impactForce > 3) {
        if (a.speedMultiplier !== undefined)
          a.speedMultiplier = Math.max(0.7, a.speedMultiplier * 0.9);
        else a.speed *= 0.85;
        if (b.speedMultiplier !== undefined)
          b.speedMultiplier = Math.max(0.7, b.speedMultiplier * 0.9);
        else b.speed *= 0.85;
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

    const accel = !rollingOut && keys[KeyBindings.bindings.accelerate];
    const braking = !rollingOut && keys[KeyBindings.bindings.brake];
    const left = !rollingOut && keys[KeyBindings.bindings.left];
    const right = !rollingOut && keys[KeyBindings.bindings.right];
    throttle = !!accel;

    // car.friction, not a second hardcoded constant — it is what the rain's
    // FRICTION_BONUS has always meant to raise, and never could while the
    // coast rate was written out separately here.
    if (rollingOut) {
      // Toward zero from either side, and stopping there — braking straight
      // through it would back the car over its own finish line.
      const drop = car.acceleration * delta;
      car.speed =
        Math.abs(car.speed) <= drop
          ? 0
          : car.speed - Math.sign(car.speed) * drop;
    } else if (accel) car.speed += car.acceleration * delta;
    else if (braking) car.speed -= car.acceleration * delta;
    else car.speed *= Math.pow(car.friction + Rain.frictionBonus(), delta);

    if (car.speed > car.maxSpeed) car.speed = car.maxSpeed;
    if (car.speed < -car.maxSpeed / 2) car.speed = -car.maxSpeed / 2;
    if (!accel && !braking && Math.abs(car.speed) < 0.01) car.speed = 0;

    const flip = car.speed >= 0 ? 1 : -1;

    if (left) car.angle -= car.turnSpeed * flip * delta;
    if (right) car.angle += car.turnSpeed * flip * delta;

    if (car.speed !== 0 && (left || right)) {
      const scrubFactor =
        0.94 + 0.04 * (1 - Math.abs(car.speed) / car.maxSpeed);
      car.speed *= Math.pow(scrubFactor, delta);
    }

    // AI update
    opponents.forEach((ai) =>
      ai.update(
        worldTrack.data.waypoints,
        isRacing,
        car.x,
        car.y,
        opponents,
        delta,
      ),
    );
    opponents.forEach(clampToWorld);

    // AI vs AI
    for (let i = 0; i < opponents.length; i++) {
      for (let j = i + 1; j < opponents.length; j++) {
        resolveCollision(opponents[i], opponents[j]);
      }
    }

    // Player vs AI
    opponents.forEach((ai) => resolveCollision(car, ai));

    const targetVx = Math.sin(car.angle) * car.speed;
    const targetVy = -Math.cos(car.angle) * car.speed;
    const grip = car.driftGrip * Rain.gripScale();
    car.velocityX += (targetVx - car.velocityX) * grip * delta;
    car.velocityY += (targetVy - car.velocityY) * grip * delta;

    car.x += car.velocityX * delta;
    car.y += car.velocityY * delta;
    clampToWorld(car);
    updatePlayerSurface(delta);
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

  Sound.update(
    car.speed,
    car.maxSpeed,
    throttle,
    slip,
    isRacing && !inOverlay && !TrackEditor.active,
  );

  // Camera always follows — runs during countdown too
  camera.x = car.x - camera.width / 2;
  camera.y = car.y - camera.height / 2;

  // DRAW
  const world = worldViewRect();

  // The baked track is opaque, so wherever it reaches all four edges the
  // clear underneath it is dead work — and it is a full-viewport pass.
  if (!worldCoversViewport(world)) {
    ctx.clearRect(0, 0, camera.width, camera.height);
  }

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

  // Cars — screen space
  if (!isMenu && !TrackEditor.active) drawCar();
  if (!TrackEditor.active) opponents.forEach((ai) => ai.draw());

  Rain.drawOverlay(); // scene tint
  Rain.drawDrops(); // screen-space streaks

  if (DEBUG && !TrackEditor.active) WaypointEditor.draw(ctx);
  if (DEBUG) TrackEditor.draw(ctx);
  if (DEBUG && !TrackEditor.active) DebugHUD.draw(ctx);

  // The clickable overlays own the cursor; clear it everywhere else.
  if (
    !isMenu &&
    !isKeyBindings &&
    !isLeaderboard &&
    !isRaceFinished &&
    canvas.style.cursor !== "default"
  ) {
    canvas.style.cursor = "default";
  }

  if (isMenu) drawStartMenu();
  else if (isKeyBindings) KeyBindings.draw(ctx, camera, mousePos);
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
  await worldTrack.load("track.json");
  WaypointEditor.init(worldTrack.data.waypoints);
  resizeSkidCanvas();

  // Player
  car.x = SPAWN_POSITIONS[0].x;
  car.y = SPAWN_POSITIONS[0].y;
  car.angle = SPAWN_POSITIONS[0].angle;

  // AI — created from spawn list
  for (let i = 1; i < SPAWN_POSITIONS.length; i++) {
    const s = SPAWN_POSITIONS[i];
    opponents.push(new AICar(ctx, s.x, s.y, s.color));
  }

  requestAnimationFrame(gameLoop);

  DebugConfig.init();
}

initGame();
