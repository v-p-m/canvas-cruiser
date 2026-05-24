const GAME_VERSION = "0.8.5";

// --- Debug flag ---
let DEBUG = false;

let laps = 0;
let hasStarted = false;
let onFinishLine = false;
let lapStartTime = 0;
let currentLapTime = 0;
let bestLapTime = 0;
let isMenu = true;
let isRacing = false;
let highScores = JSON.parse(localStorage.getItem("highScores")) || [];
let isLeaderboard = false;
let savedSpeed = 0;
let gameMode = "free"; // "free" | "race5" | "race10"
let selectedMode = 0; // menu cursor
let weatherWetFromLap = null;
let weatherWetToLap = null;
let totalRaceStart = 0;
let totalRaceTime = 0;
let isRaceFinished = false;
let leaderboardFrom = "game"; // "game" | "menu"
let isKeyBindings = false;

const MODES = [
  { id: "free", label: "Free Drive" },
  { id: "race5", label: "5 Lap Race" },
  { id: "race10", label: "10 Lap Race" },
];

const SPAWN_POSITIONS = [
  { x: 550, y: 200, angle: Math.PI / 2, color: null }, // player
  { x: 440, y: 200, angle: Math.PI / 2, color: "#0077ff" }, // AI 1
  { x: 505, y: 275, angle: Math.PI / 2, color: "#ff7700" }, // AI 2
  { x: 390, y: 275, angle: Math.PI / 2, color: "#00cc44" }, // AI 3
  { x: 335, y: 200, angle: Math.PI / 2, color: "#cc00cc" }, // AI 4
];

const opponents = [];

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const camera = {
  x: 0,
  y: 0,
  width: window.innerWidth,
  height: window.innerHeight,
};

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
};
const carImage = new Image();
carImage.src = "assets/car_player.png";

const PersonalBest = {
  active: false,
  timer: 0,
  duration: 3000, // ms to show the banner
  lastBest: null,

  trigger(time) {
    this.active = true;
    this.timer = this.duration;
    this.lastBest = time;
  },

  update(dt) {
    if (!this.active) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.active = false;
    }
  },

  draw(ctx, canvasWidth) {
    if (!this.active) return;

    const alpha = Math.min(1, this.timer / 500); // fade out last 500ms
    const cx = canvasWidth / 2;
    const y = 120;

    ctx.save();
    ctx.globalAlpha = alpha;

    // Banner
    ctx.fillStyle = "#FFD700";
    ctx.font = "bold 32px 'Courier New'";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`🏆 NEW BEST: ${this.lastBest}s`, cx, y);

    // Underline
    const textWidth = ctx.measureText(`🏆 NEW BEST: ${this.lastBest}s`).width;
    ctx.strokeStyle = "#FFD700";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - textWidth / 2, y + 22);
    ctx.lineTo(cx + textWidth / 2, y + 22);
    ctx.stroke();

    ctx.restore();
  },
};

const keys = {};

// --- Offscreen canvas for baked skid marks ---
const skidCanvas = document.createElement("canvas");
const skidCtx = skidCanvas.getContext("2d");

function resizeSkidCanvas() {
  if (worldTrack.data) {
    // Cap at actual screen size — skid marks outside view
    // are repainted when the player returns anyway
    skidCanvas.width = Math.min(
      worldTrack.data.map[0].length * worldTrack.data.tileSize,
      2048,
    );
    skidCanvas.height = Math.min(
      worldTrack.data.map.length * worldTrack.data.tileSize,
      2048,
    );
  }
}

let skidDirty = false;

// ─────────────────────────────────────────
// RAIN SYSTEM
// ─────────────────────────────────────────
const Rain = {
  active: false,
  intensity: 0, // 0→1, lerps toward targetIntensity
  targetIntensity: 0,
  drops: [],
  MAX_DROPS: 600,
  puddles: [], // static world-space puddles drawn on track
  MAX_PUDDLES: 40,

  // How much rain damps player grip / friction
  GRIP_PENALTY: 0.55, // multiplied onto driftGrip when fully wet
  FRICTION_BONUS: 0.015, // added to friction (closer to 1 = less slowdown)

  toggle() {
    if (this.targetIntensity === 0) {
      this.targetIntensity = 1;
      this.active = true;
      this._spawnPuddles();
    } else {
      this.targetIntensity = 0;
    }
  },

  _spawnPuddles() {
    if (!worldTrack.data) return;
    this.puddles = [];
    const { map, tileSize } = worldTrack.data;
    const roadTiles = [];
    map.forEach((row, ty) =>
      row.forEach((id, tx) => {
        if (id >= 2 && id <= 9) roadTiles.push({ tx, ty });
      }),
    );
    const count = Math.min(this.MAX_PUDDLES, roadTiles.length);
    for (let i = 0; i < count; i++) {
      const tile = roadTiles[Math.floor(Math.random() * roadTiles.length)];
      this.puddles.push({
        x:
          tile.tx * tileSize +
          tileSize / 2 +
          (Math.random() - 0.5) * tileSize * 0.6,
        y:
          tile.ty * tileSize +
          tileSize / 2 +
          (Math.random() - 0.5) * tileSize * 0.6,
        rx: 10 + Math.random() * 22,
        ry: 5 + Math.random() * 12,
        alpha: 0.18 + Math.random() * 0.18,
        ripple: Math.random() * Math.PI * 2,
      });
    }
  },

  _spawnDrop() {
    return {
      // screen-space — reposition each frame so they always fill viewport
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      len: 8 + Math.random() * 10,
      speed: 14 + Math.random() * 10,
      alpha: 0.25 + Math.random() * 0.35,
    };
  },

  update(delta) {
    // Lerp intensity
    const step = 0.008 * delta;
    if (this.intensity < this.targetIntensity)
      this.intensity = Math.min(this.targetIntensity, this.intensity + step);
    else if (this.intensity > this.targetIntensity)
      this.intensity = Math.max(this.targetIntensity, this.intensity - step);

    if (this.intensity <= 0) {
      this.active = false;
      return;
    }
    if (this.targetIntensity > 0) this.active = true;

    // Maintain drop pool
    const desiredDrops = Math.floor(this.intensity * this.MAX_DROPS);
    while (this.drops.length < desiredDrops) this.drops.push(this._spawnDrop());
    while (this.drops.length > desiredDrops) this.drops.pop();

    // Move drops
    this.drops.forEach((d) => {
      d.y += d.speed * delta;
      d.x += 2 * delta; // slight angle
      if (d.y > canvas.height + 20) {
        d.y = -20;
        d.x = Math.random() * canvas.width;
      }
    });

    // Animate puddle ripples
    this.puddles.forEach((p) => {
      p.ripple += 0.04 * delta;
    });

    // Apply wet handling to player
    const wet = this.intensity;
    const BASE_GRIP = 0.1;
    const BASE_FRICTION = 0.96;
    car.driftGrip = BASE_GRIP * (1 - wet * (1 - this.GRIP_PENALTY));
    car.friction = BASE_FRICTION + wet * this.FRICTION_BONUS;

    // Apply to AI
    opponents.forEach((ai) => {
      ai.grip = 0.15 * (1 - wet * (1 - this.GRIP_PENALTY));
    });
  },

  drawPuddles() {
    if (this.intensity <= 0) return;
    this.puddles.forEach((p) => {
      const sx = p.x - camera.x;
      const sy = p.y - camera.y;
      if (
        sx < -60 ||
        sx > canvas.width + 60 ||
        sy < -40 ||
        sy > canvas.height + 40
      )
        return;

      ctx.save();
      ctx.globalAlpha = p.alpha * this.intensity;
      ctx.translate(sx, sy);

      // Puddle ellipse
      ctx.fillStyle = "#6aaccc";
      ctx.beginPath();
      ctx.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.fill();

      // Ripple ring
      const rScale = 0.5 + 0.5 * Math.abs(Math.sin(p.ripple));
      ctx.strokeStyle = "rgba(150,200,230,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.rx * rScale, p.ry * rScale, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    });
  },

  drawDrops() {
    if (this.intensity <= 0) return;
    ctx.save();
    ctx.strokeStyle = `rgba(174, 214, 241, ${0.55 * this.intensity})`;
    ctx.lineWidth = 1;
    this.drops.forEach((d) => {
      ctx.globalAlpha = d.alpha * this.intensity;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + 2, d.y + d.len);
      ctx.stroke();
    });
    ctx.restore();
  },

  drawOverlay() {
    if (this.intensity <= 0) return;
    // Slight blue-grey tint over the whole scene
    ctx.save();
    ctx.globalAlpha = 0.1 * this.intensity;
    ctx.fillStyle = "#6a9ab0";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
  },

  drawHUD() {
    ctx.save();
    ctx.font = "bold 16px 'Courier New'";
    ctx.textAlign = "left";

    // Active rain label
    if (this.intensity > 0 || this.targetIntensity > 0) {
      ctx.fillStyle =
        this.intensity > 0.5
          ? `rgba(174,214,241,${0.7 + 0.3 * this.intensity})`
          : "#aaa";
      ctx.fillText(
        this.intensity > 0.05 ? `🌧  WET TRACK` : `🌤  DRYING...`,
        16,
        canvas.height - 48,
      );
    }

    // Pre-race forecast hint (before hasStarted, in a race mode)
    if (
      !hasStarted &&
      !isMenu &&
      (gameMode === "race5" || gameMode === "race10")
    ) {
      const wet = weatherWetFromLap !== null;
      if (gameMode === "race5") {
        ctx.fillStyle = wet
          ? "rgba(174,214,241,0.85)"
          : "rgba(200,230,200,0.85)";
        ctx.fillText(
          wet ? `🌧  FORECAST: WET RACE` : `☀️  FORECAST: DRY RACE`,
          16,
          canvas.height - 48,
        );
      } else {
        // race10 — show the wet window
        if (wet) {
          const to = weatherWetToLap ? `lap ${weatherWetToLap - 1}` : "end";
          ctx.fillStyle = "rgba(174,214,241,0.85)";
          ctx.fillText(
            `🌧  RAIN: lap ${weatherWetFromLap} → ${to}`,
            16,
            canvas.height - 48,
          );
        } else {
          ctx.fillStyle = "rgba(200,230,200,0.85)";
          ctx.fillText(`☀️  FORECAST: DRY RACE`, 16, canvas.height - 48);
        }
      }
    }

    ctx.restore();
  },
};

function paintSkidMark(x, y, angle) {
  // Skip if outside skid canvas bounds
  if (x < 0 || y < 0 || x > skidCanvas.width || y > skidCanvas.height) return;

  skidCtx.save();
  skidCtx.translate(x, y);
  skidCtx.rotate(angle);
  skidCtx.fillStyle = "rgba(0, 0, 0, 0.15)";
  const offset = car.width / 2 - 4;
  skidCtx.fillRect(-offset, car.height / 4, 6, 10);
  skidCtx.fillRect(offset - 6, car.height / 4, 6, 10);
  skidCtx.restore();
  skidDirty = true;
}

// --- Input ---
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();

  // Forward to track editor first
  if (TrackEditor.active && TrackEditor.handleKeyDown(e)) return;

  // Leaderboard ESC — first, before anything else
  if (key === "escape" && isLeaderboard) {
    isLeaderboard = false;
    if (leaderboardFrom === "menu") {
      isMenu = true;
      isRacing = false;
    } else {
      isRacing = true;
      car.speed = savedSpeed;
      savedSpeed = 0;
    }
    return;
  }

  // Menu navigation
  if (isMenu) {
    if (e.key === "ArrowUp") {
      selectedMode = (selectedMode - 1 + MODES.length) % MODES.length;
      return;
    }
    if (e.key === "ArrowDown") {
      selectedMode = (selectedMode + 1) % MODES.length;
      return;
    }
    if (key === "k") {
      isMenu = false;
      isKeyBindings = true;
      KeyBindings.lastRejected = null;
      return;
    }
    if (key === "q") {
      isMenu = false;
      isLeaderboard = true;
      leaderboardFrom = "menu";
      return;
    }
    if (key === "enter" || key === " ") {
      gameMode = MODES[selectedMode].id;
      isMenu = false;
      isRacing = false;
      scheduleWeather();
      StartLights.begin();
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
    if (key === "enter" && KeyBindings._rows) {
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
    if (key === "r") {
      resetRace();
      scheduleWeather();
      isMenu = false;
      isRacing = false;
      StartLights.begin();
    }
    if (key === "escape") {
      isMenu = true;
      resetRace();
    }
    return;
  }

  // General ESC
  if (key === "escape") {
    resetRace();
    isMenu = true;
    isRacing = false;
    isLeaderboard = false;
    return;
  }

  if (key === "r") {
    resetRace();
    scheduleWeather();
    isMenu = false;
    isRacing = false;
    StartLights.begin();
    return;
  }

  // Q key handler:
  if (key === "q") {
    isLeaderboard = !isLeaderboard;

    if (isLeaderboard) {
      leaderboardFrom = "game";
      savedSpeed = car.speed;
      car.speed = 0;
    } else {
      if (leaderboardFrom === "menu") {
        isMenu = true;
        isRacing = false;
      } else {
        isRacing = true;
        car.speed = savedSpeed;
        savedSpeed = 0;
      }
    }
    return;
  }

  if (key === "c" && isLeaderboard) {
    clearHighScores();
    return;
  }

  if (key === "p" && !isMenu) {
    Rain.toggle();
    return;
  }

  if (key === "b") {
    DEBUG = !DEBUG;
    console.log(`Debug ${DEBUG ? "ON" : "OFF"}`);
    if (!DEBUG) WaypointEditor.active = false; // close editor when debug turns off
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

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  camera.width = canvas.width;
  camera.height = canvas.height;
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());

canvas.addEventListener("mousedown", (e) => {
  canvas.focus();
  if (isKeyBindings) {
    KeyBindings.handleClick(e.clientX, e.clientY);
    return;
  }
  if (TrackEditor.active) {
    TrackEditor.handleMouseDown(e.clientX, e.clientY, e.button);
    return;
  }
  WaypointEditor.handleMouseDown(e.clientX, e.clientY);
});

canvas.addEventListener("mousemove", (e) => {
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

  if (highScores[0] === parsed && parsed !== previousBest) {
    PersonalBest.trigger(time);
  }
}

function clearHighScores() {
  if (confirm("Clear all high scores and records?")) {
    highScores = [];
    bestLapTime = 0;
    localStorage.removeItem("highScores");
    localStorage.removeItem("bestLap");
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
  totalRaceTime = 0;
  totalRaceStart = 0;

  // Clear rain
  if (Rain.targetIntensity > 0) Rain.toggle();

  // Player
  car.x = SPAWN_POSITIONS[0].x;
  car.y = SPAWN_POSITIONS[0].y;
  car.angle = SPAWN_POSITIONS[0].angle;
  car.speed = 0;
  car.velocityX = 0;
  car.velocityY = 0;

  // AI — reset from same spawn list
  for (let i = 0; i < opponents.length; i++) {
    const s = SPAWN_POSITIONS[i + 1];
    opponents[i].x = s.x;
    opponents[i].y = s.y;
    opponents[i].angle = s.angle;
    opponents[i].speed = 0;
    opponents[i].velocityX = 0;
    opponents[i].velocityY = 0;
    opponents[i].currentWaypoint = 0;
    opponents[i].startDelay = Math.random() * 400;
    opponents[i].basMaxSpeed = 7.5 + Math.random() * 2.5;
    opponents[i].maxSpeed = opponents[i].basMaxSpeed;
  }

  laps = 0;
  hasStarted = false;
  currentLapTime = 0;
  onFinishLine = false;

  skidCtx.clearRect(0, 0, skidCanvas.width, skidCanvas.height);
}

// --- Collision ---
function checkTileCollision(x, y) {
  if (!worldTrack.data || !worldTrack.data.map) return;
  const gridX = Math.floor(x / worldTrack.data.tileSize);
  const gridY = Math.floor(y / worldTrack.data.tileSize);

  if (
    worldTrack.data.map[gridY] &&
    worldTrack.data.map[gridY][gridX] !== undefined
  ) {
    const tileID = worldTrack.data.map[gridY][gridX];

    if (tileID === 1) {
      car.speed *= -0.5;
      car.x -= car.velocityX * 2;
      car.y -= car.velocityY * 2;
    }

    if (tileID === 0) car.speed *= 0.92;

    if (tileID === 9) {
      if (!onFinishLine) {
        onFinishLine = true;
        if (!hasStarted) {
          hasStarted = true;
          laps = 1;
          totalRaceStart = Date.now();
          lapStartTime = Date.now();
          applyWeatherForLap(1); // apply scheduled weather from lap 1
        } else {
          const lapTime = ((Date.now() - lapStartTime) / 1000).toFixed(2);
          lapStartTime = Date.now();
          laps++;
          applyWeatherForLap(laps); // check weather schedule each lap

          const targetLaps =
            gameMode === "race5" ? 5 : gameMode === "race10" ? 10 : null;

          if (targetLaps && laps > targetLaps) {
            // Race complete
            totalRaceTime = ((Date.now() - totalRaceStart) / 1000).toFixed(2);
            isRaceFinished = true;
            isRacing = false;
          } else {
            // Normal lap save
            saveLapTime(lapTime);
          }
        }
      }
    } else {
      onFinishLine = false;
    }
  }
}

// --- Draw helpers ---
function drawCar() {
  ctx.save();
  ctx.translate(car.x - camera.x, car.y - camera.y); // screen space
  ctx.rotate(car.angle);

  if (carImage.complete && carImage.naturalWidth > 0) {
    // Draw the sprite centered on the car's position
    ctx.drawImage(
      carImage,
      -car.width / 2,
      -car.height / 2,
      car.width,
      car.height,
    );
  } else {
    // Fallback: original rectangle car while image loads
    const w = car.width;
    const h = car.height;
    ctx.fillStyle = "#333";
    ctx.fillRect(-w / 2 - 2, -h / 2 + 5, 8, 12);
    ctx.fillRect(w / 2 - 6, -h / 2 + 5, 8, 12);
    ctx.fillRect(-w / 2 - 2, h / 2 - 15, 8, 12);
    ctx.fillRect(w / 2 - 6, h / 2 - 15, 8, 12);
    ctx.fillStyle = "#d00";
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = "#add8e6";
    ctx.fillRect(-w / 2 + 4, -h / 2 + 10, w - 8, 12);
  }

  ctx.restore();
}

function drawStartMenu() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = "center";
  ctx.fillStyle = "#FFD700";
  ctx.font = "bold 50px 'Courier New'";
  ctx.fillText("🏎️ CANVAS CRUISER 🏎️", canvas.width / 2, 150);
  ctx.font = "bold 12px 'Courier New'";
  ctx.fillText("v" + GAME_VERSION, canvas.width / 2, 200);

  // Mode selector
  const cx = canvas.width / 2;
  const modesStartY = 260;

  ctx.font = "22px 'Courier New'";
  MODES.forEach((mode, i) => {
    const y = modesStartY + i * 52;
    const selected = i === selectedMode;

    const boxW = 300;
    const boxH = 40;
    const boxX = cx - boxW / 2;
    const boxY = y - 28;

    // Highlight box
    ctx.fillStyle = selected ? "#FFD700" : "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 8);
    ctx.fill();

    ctx.fillStyle = selected ? "#000" : "#AAA";
    ctx.fillText(selected ? `▶  ${mode.label}` : mode.label, cx, y);
  });

  // Controls
  const controlsY = modesStartY + MODES.length * 52 + 40;
  const lineSpacing = 32;
  const gutter = 20;
  ctx.font = "16px 'Courier New'";

  const controls = [
    { key: "UP / DOWN", action: "Select mode" },
    { key: "ENTER", action: "Start" },
    { key: "LEFT / RIGHT", action: "Steer" },
    { key: "K", action: "Key bindings" },
    { key: "R", action: "Reset" },
    { key: "Q", action: "Top 5 Best Laps" },
    { key: "B", action: "DEBUG" },
    { key: "ESC", action: "Back to Menu" },
  ];

  controls.forEach((item, i) => {
    const y = controlsY + i * lineSpacing;
    ctx.textAlign = "right";
    ctx.fillStyle = "#888";
    ctx.fillText(item.key, cx - gutter, y);
    ctx.textAlign = "center";
    ctx.fillStyle = "white";
    ctx.fillText(":", cx, y);
    ctx.textAlign = "left";
    ctx.fillStyle = "white";
    ctx.fillText(item.action, cx + gutter, y);
  });
}

function drawUI() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(0, 0, canvas.width, 60);
  ctx.fillStyle = "#00FF00";
  ctx.font = "bold 20px 'Courier New'";
  ctx.textAlign = "left";

  const lapCount = gameMode === "race5" ? 5 : gameMode === "race10" ? 10 : null;
  const lapLabel = !hasStarted
    ? "Let's compete!"
    : lapCount
      ? `LAP ${laps} / ${lapCount}`
      : `LAP ${laps}`;

  ctx.fillText(lapLabel, 20, 35);
  ctx.textAlign = "right";
  ctx.fillText(
    `${Math.round(Math.abs(car.speed) * 10)} KM/H`,
    canvas.width - 20,
    35,
  );
  ctx.textAlign = "center";
  if (hasStarted) {
    currentLapTime = ((Date.now() - lapStartTime) / 1000).toFixed(2);
    ctx.fillText(`TIME: ${currentLapTime}s`, canvas.width / 2, 35);
  }
}

function drawLeaderboard() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#FFD700";
  ctx.textAlign = "center";
  ctx.font = "bold 40px 'Courier New'";
  ctx.fillText("🏁 TOP 5 BEST LAPS 🏁", canvas.width / 2, 150);
  ctx.fillStyle = "white";
  ctx.font = "24px 'Courier New'";
  highScores.forEach((score, i) =>
    ctx.fillText(`${i + 1}. ${score}s`, canvas.width / 2, 220 + i * 40),
  );

  // Back hint
  ctx.font = "18px 'Courier New'";
  ctx.fillStyle = "#AAA";
  ctx.fillText(
    leaderboardFrom === "menu"
      ? "ESC / Q — Back to menu"
      : "ESC / Q — Back to race",
    canvas.width / 2,
    420,
  );
  ctx.fillText("C — Clear records", canvas.width / 2, 450);
}

function drawRaceFinished() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const cx = canvas.width / 2;

  ctx.textAlign = "center";
  ctx.fillStyle = "#FFD700";
  ctx.font = "bold 48px 'Courier New'";
  ctx.fillText("🏁 RACE FINISHED 🏁", cx, 160);

  const lapCount = gameMode === "race5" ? 5 : 10;
  ctx.fillStyle = "white";
  ctx.font = "28px 'Courier New'";
  ctx.fillText(`${lapCount} laps completed`, cx, 230);

  ctx.font = "bold 36px 'Courier New'";
  ctx.fillStyle = "#00FF88";
  ctx.fillText(`Total: ${totalRaceTime}s`, cx, 300);

  // Personal best indicator
  if (highScores.length > 0 && parseFloat(totalRaceTime) === highScores[0]) {
    ctx.fillStyle = "#FFD700";
    ctx.font = "bold 24px 'Courier New'";
    ctx.fillText("🏆 New Best Total!", cx, 350);
  }

  ctx.font = "20px 'Courier New'";
  ctx.fillStyle = "#AAA";
  ctx.fillText("R  — Race again", cx, 420);
  ctx.fillText("ESC — Main menu", cx, 455);
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

  StartLights.update(timestamp);
  PersonalBest.update(dt);
  DebugHUD.update(timestamp);
  Rain.update(delta);

  if (!StartLights.active && !isRacing && !isMenu) {
    isRacing = true;
  }

  // UPDATE
  if (isRacing && !isMenu && !isLeaderboard) {
    const accel = keys[KeyBindings.bindings.accelerate];
    const braking = keys[KeyBindings.bindings.brake];
    const left = keys[KeyBindings.bindings.left];
    const right = keys[KeyBindings.bindings.right];

    if (accel) car.speed += car.acceleration * delta;
    else if (braking) car.speed -= car.acceleration * delta;
    else car.speed *= Math.pow(0.95, delta);

    if (car.speed > car.maxSpeed) car.speed = car.maxSpeed;
    if (car.speed < -car.maxSpeed / 2) car.speed = -car.maxSpeed / 2;
    if (!accel && !braking && Math.abs(car.speed) < 0.01) car.speed = 0;

    if (car.speed !== 0) {
      const flip = car.speed > 0 ? 1 : -1;

      if (left) car.angle -= car.turnSpeed * flip * delta;
      if (right) car.angle += car.turnSpeed * flip * delta;

      if (left || right) {
        const scrubFactor =
          0.94 + 0.04 * (1 - Math.abs(car.speed) / car.maxSpeed);
        car.speed *= Math.pow(scrubFactor, delta);

        if (Math.abs(car.speed) > 5) {
          paintSkidMark(car.x, car.y, car.angle);
        }
      }
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
    car.velocityX += (targetVx - car.velocityX) * car.driftGrip * delta;
    car.velocityY += (targetVy - car.velocityY) * car.driftGrip * delta;

    car.x += car.velocityX * delta;
    car.y += car.velocityY * delta;
    checkTileCollision(car.x, car.y);
  }

  // Camera always follows — runs during countdown too
  camera.x = car.x - camera.width / 2;
  camera.y = car.y - camera.height / 2;

  // DRAW
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (worldTrack.bakedCanvas) {
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
    if (srcW > 0 && srcH > 0) {
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
        // hide skid marks while editing
        ctx.drawImage(
          skidCanvas,
          srcX,
          srcY,
          srcW,
          srcH,
          dstX,
          dstY,
          srcW,
          srcH,
        );
      Rain.drawPuddles(); // world-space puddles, before cars
    }
  }

  // Cars — screen space
  if (!isMenu && !TrackEditor.active) drawCar();
  if (!TrackEditor.active) opponents.forEach((ai) => ai.draw());

  Rain.drawOverlay(); // scene tint
  Rain.drawDrops(); // screen-space streaks

  if (DEBUG && !TrackEditor.active) WaypointEditor.draw(ctx);
  if (DEBUG) TrackEditor.draw(ctx);
  if (DEBUG && !TrackEditor.active) DebugHUD.draw(ctx);

  if (isMenu) drawStartMenu();
  else if (isKeyBindings) KeyBindings.draw(ctx, canvas);
  else if (isRaceFinished) drawRaceFinished();
  else if (isLeaderboard) drawLeaderboard();
  else if (!TrackEditor.active) drawUI();

  StartLights.draw(ctx, canvas.width, canvas.height);
  PersonalBest.draw(ctx, canvas.width);
  Rain.drawHUD();

  requestAnimationFrame(gameLoop);
}

// --- Init ---
async function initGame() {
  KeyBindings.load();
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
