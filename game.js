const GAME_VERSION = "0.7.4";

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
let totalRaceStart = 0;
let totalRaceTime = 0;
let isRaceFinished = false;

const MODES = [
  { id: "free", label: "Free Drive" },
  { id: "race5", label: "5 Lap Race" },
  { id: "race10", label: "10 Lap Race" },
];

const SPAWN_POSITIONS = [
  { x: 550, y: 200, angle: Math.PI / 2, color: null }, // player
  { x: 400, y: 200, angle: Math.PI / 2, color: "#0077ff" }, // AI 1
  { x: 475, y: 275, angle: Math.PI / 2, color: "#ff7700" }, // AI 2
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
  width: 30,
  height: 50,
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
    skidCanvas.width = worldTrack.data.map[0].length * worldTrack.data.tileSize;
    skidCanvas.height = worldTrack.data.map.length * worldTrack.data.tileSize;
  } else {
    skidCanvas.width = 4096;
    skidCanvas.height = 4096;
  }
}

function paintSkidMark(x, y, angle) {
  skidCtx.save();
  skidCtx.translate(x, y);
  skidCtx.rotate(angle);
  skidCtx.fillStyle = "rgba(0, 0, 0, 0.15)";
  const offset = car.width / 2 - 4;
  skidCtx.fillRect(-offset, car.height / 4, 6, 10);
  skidCtx.fillRect(offset - 6, car.height / 4, 6, 10);
  skidCtx.restore();
}

// --- Input ---
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();

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
    if (key === "enter" || key === " ") {
      gameMode = MODES[selectedMode].id;
      isMenu = false;
      isRacing = false;
      StartLights.begin();
      return;
    }
    return;
  }

  // Race finished screen
  if (isRaceFinished) {
    if (key === "r") {
      resetRace();
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
  if (key === "escape") {
    resetRace();
    isMenu = true;
    isRacing = false;
    isLeaderboard = false;
    return;
  }

  if (key === "r") {
    resetRace();
    isMenu = false;
    isRacing = false;
    StartLights.begin();
    return;
  }

  // Q key handler:
  if (key === "q" && !isMenu) {
    isLeaderboard = !isLeaderboard;
    isRacing = !isLeaderboard;

    if (isLeaderboard) {
      savedSpeed = car.speed; // opening — save
      car.speed = 0;
    } else {
      car.speed = savedSpeed; // closing — restore
      savedSpeed = 0;
    }
    return;
  }

  if (key === "c" && isLeaderboard) {
    clearHighScores();
    return;
  }

  if (key === "d") {
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
  if (key === "z" && DEBUG) {
    WaypointEditor.undo();
    return;
  }
  if (key === "p" && DEBUG) {
    e.preventDefault();
    WaypointEditor.export();
    return;
  }

  if (isMenu) {
    if (key === "enter" || key === " ") {
      isMenu = false;
      isRacing = false;
      StartLights.begin();
    }
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

canvas.addEventListener("mousedown", (e) => {
  canvas.focus();
  WaypointEditor.handleMouseDown(e.clientX, e.clientY);
});

canvas.addEventListener("mousemove", (e) => {
  WaypointEditor.handleMouseMove(e.clientX, e.clientY);
});

canvas.addEventListener("mouseup", () => {
  WaypointEditor.handleMouseUp();
});

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

function resetRace() {
  isLeaderboard = false;
  isRaceFinished = false;
  totalRaceTime = 0;
  totalRaceStart = 0;

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
        } else {
          const lapTime = ((Date.now() - lapStartTime) / 1000).toFixed(2);
          lapStartTime = Date.now();
          laps++;

          const targetLaps =
            gameMode === "race5" ? 5 : gameMode === "race10" ? 10 : null;

          if (targetLaps && laps > targetLaps) {
            // Race complete
            totalRaceTime = ((Date.now() - totalRaceStart) / 1000).toFixed(2);
            isRaceFinished = true;
            isRacing = false;
            //opponents.forEach((ai) => (ai.speed = 0));
            opponents.forEach((ai) =>
              ai.update(worldTrack.data.waypoints, isRacing, car.x, car.y),
            );
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
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

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

  ctx.restore();
}

function drawStartMenu() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.textAlign = "center";
  ctx.fillStyle = "#FFD700";
  ctx.font = "bold 50px 'Courier New'";
  ctx.fillText("🏎️ CANVAS CRUISER 🏎️", canvas.width / 2, 150);

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
    { key: "R", action: "Reset" },
    { key: "Q", action: "Top 5 Best Laps" },
    { key: "C", action: "Clear records (on best laps screen)" },
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

    // Lateral nudge
    const impactForce = Math.sqrt(pushX * pushX + pushY * pushY);

    // nudge line:
    const nudge = impactForce * DebugConfig.values.collisionNudge;

    if (impactForce > DebugConfig.values.collisionHardImpact) {
      a.velocityX -= pushX * aRatio * nudge;
      a.velocityY -= pushY * aRatio * nudge;
      b.velocityX += pushX * bRatio * nudge;
      b.velocityY += pushY * bRatio * nudge;

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

  StartLights.update(timestamp);
  PersonalBest.update(dt);
  DebugHUD.update(timestamp);

  if (!StartLights.active && !isRacing && !isMenu) {
    isRacing = true;
  }

  // UPDATE
  if (isRacing && !isMenu && !isLeaderboard) {
    if (keys["ArrowUp"]) car.speed += car.acceleration;
    else if (keys["ArrowDown"]) car.speed -= car.acceleration;
    else car.speed *= 0.95;

    if (car.speed > car.maxSpeed) car.speed = car.maxSpeed;
    if (car.speed < -car.maxSpeed / 2) car.speed = -car.maxSpeed / 2;
    if (Math.abs(car.speed) < 0.1) car.speed = 0;

    if (car.speed !== 0) {
      const flip = car.speed > 0 ? 1 : -1;
      const turningLeft = keys["ArrowLeft"];
      const turningRight = keys["ArrowRight"];

      if (turningLeft) car.angle -= car.turnSpeed * flip;
      if (turningRight) car.angle += car.turnSpeed * flip;

      if (turningLeft || turningRight) {
        const scrubFactor =
          0.94 + 0.04 * (1 - Math.abs(car.speed) / car.maxSpeed);
        car.speed *= scrubFactor;

        if (Math.abs(car.speed) > 5) {
          paintSkidMark(car.x, car.y, car.angle);
        }
      }
    }

    // AI update
    opponents.forEach((ai) =>
      ai.update(worldTrack.data.waypoints, isRacing, car.x, car.y, opponents),
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
    car.velocityX += (targetVx - car.velocityX) * car.driftGrip;
    car.velocityY += (targetVy - car.velocityY) * car.driftGrip;

    car.x += car.velocityX;
    car.y += car.velocityY;
    checkTileCollision(car.x, car.y);
  }

  // Camera always follows — runs during countdown too
  camera.x = car.x - camera.width / 2;
  camera.y = car.y - camera.height / 2;

  // DRAW
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  worldTrack.draw();
  ctx.drawImage(skidCanvas, 0, 0);

  opponents.forEach((ai) => ai.draw());
  if (!isMenu) drawCar();

  ctx.restore();

  // DEBUG HUD
  if (DEBUG) WaypointEditor.draw(ctx);
  if (DEBUG) DebugHUD.draw(ctx);

  if (isMenu) drawStartMenu();
  else if (isRaceFinished) drawRaceFinished();
  else if (isLeaderboard) drawLeaderboard();
  else drawUI();

  StartLights.draw(ctx, canvas.width, canvas.height);
  PersonalBest.draw(ctx, canvas.width);

  requestAnimationFrame(gameLoop);
}

// --- Init ---
async function initGame() {
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
