const GAME_VERSION = "0.7.1";

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

// --- Debug flag ---
const DEBUG = false;

// --- Input ---
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();

  if (key === "escape") {
    isMenu = true;
    isRacing = false;
    resetRace();
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

const worldTrack = new Track(ctx);

// --- Scoring ---
function saveLapTime(time) {
  highScores.push(parseFloat(time));
  highScores.sort((a, b) => a - b);
  highScores = highScores.slice(0, 5);
  localStorage.setItem("highScores", JSON.stringify(highScores));
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

  // Player
  car.x = 5 * 64;
  car.y = 3 * 64 + 32;
  car.angle = Math.PI / 2;
  car.speed = 0;
  car.velocityX = 0;
  car.velocityY = 0;

  // AI
  opponents[0].x = 5 * 64;
  opponents[0].y = 3 * 64 + 100;
  opponents[0].angle = Math.PI / 2;
  opponents[0].speed = 0;
  opponents[0].currentWaypoint = 0;

  opponents[1].x = 5 * 64;
  opponents[1].y = 3 * 64 + 160;
  opponents[1].angle = Math.PI / 2;
  opponents[1].speed = 0;
  opponents[1].currentWaypoint = 0;

  // Session
  laps = 0;
  hasStarted = false;
  currentLapTime = 0;
  onFinishLine = false;

  // Skid marks
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
        } else {
          laps++;
          saveLapTime(currentLapTime);
        }
        lapStartTime = Date.now();
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

  const centerX = canvas.width / 2;
  const startY = 280;
  const lineSpacing = 35;
  const gutter = 20;

  ctx.font = "20px 'Courier New'";

  const controls = [
    { key: "UP / DOWN", action: "Gas & Brake" },
    { key: "LEFT / RIGHT", action: "Steer" },
    { key: "R", action: "Reset" },
    { key: "Q", action: "Top 5 Best Laps" },
    { key: "C", action: "Clear Records" },
    { key: "ESC", action: "Back to Menu" },
  ];

  controls.forEach((item, i) => {
    const y = startY + i * lineSpacing;
    ctx.textAlign = "right";
    ctx.fillStyle = "#AAA";
    ctx.fillText(item.key, centerX - gutter, y);
    ctx.textAlign = "center";
    ctx.fillStyle = "white";
    ctx.fillText(":", centerX, y);
    ctx.textAlign = "left";
    ctx.fillStyle = "white";
    ctx.fillText(item.action, centerX + gutter, y);
  });

  const promptY = startY + controls.length * lineSpacing + 60;
  ctx.textAlign = "center";
  ctx.font = "bold 26px 'Courier New'";
  if (Math.floor(Date.now() / 500) % 2) {
    ctx.fillStyle = "#00FF00";
    ctx.fillText("PRESS [ENTER] TO RACE", centerX, promptY);
  }
}

function drawUI() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(0, 0, canvas.width, 60);
  ctx.fillStyle = "#00FF00";
  ctx.font = "bold 20px 'Courier New'";
  ctx.textAlign = "left";
  ctx.fillText(hasStarted ? `LAP ${laps}` : "Let's compete!", 20, 35);
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

// --- Unified game loop ---
function gameLoop(timestamp) {
  StartLights.update(timestamp);
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

    opponents.forEach((ai) => ai.update(worldTrack.data.waypoints, isRacing));

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

      // AI vs AI collisions
      for (let i = 0; i < opponents.length; i++) {
        for (let j = i + 1; j < opponents.length; j++) {
          opponents[i].resolveCollision(opponents[j]);
        }
      }

      // AI vs player collisions
      opponents.forEach((ai) => ai.resolveCollision(car));
    }

    const targetVx = Math.sin(car.angle) * car.speed;
    const targetVy = -Math.cos(car.angle) * car.speed;
    car.velocityX += (targetVx - car.velocityX) * car.driftGrip;
    car.velocityY += (targetVy - car.velocityY) * car.driftGrip;

    car.x += car.velocityX;
    car.y += car.velocityY;
    checkTileCollision(car.x, car.y);
  }

  // Camera always follows car — runs during countdown too
  camera.x = car.x - camera.width / 2;
  camera.y = car.y - camera.height / 2;

  // DRAW
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-camera.x, -camera.y);

  worldTrack.draw();

  // Single drawImage instead of 500 save/restore pairs
  ctx.drawImage(skidCanvas, 0, 0);

  // Waypoint debug — gated, zero cost in production
  if (DEBUG && worldTrack.data?.waypoints) {
    ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
    ctx.font = "bold 16px Arial";
    worldTrack.data.waypoints.forEach((wp, i) => {
      ctx.beginPath();
      ctx.arc(wp.x, wp.y, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.fillText(i, wp.x - 5, wp.y + 5);
      ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
    });
  }

  opponents.forEach((ai) => ai.draw());

  if (!isMenu) drawCar();

  ctx.restore();

  if (isMenu) drawStartMenu();
  else if (isLeaderboard) drawLeaderboard();
  else drawUI();

  StartLights.draw(ctx, canvas.width, canvas.height);

  requestAnimationFrame(gameLoop);
}

// --- Init ---
async function initGame() {
  await worldTrack.load("track.json");
  resizeSkidCanvas();

  car.x = 5 * 64;
  car.y = 3 * 64 + 32;
  car.angle = Math.PI / 2;

  opponents.push(new AICar(ctx, 5 * 64, 3 * 64 + 100, "#0077ff"));
  opponents.push(new AICar(ctx, 5 * 64, 3 * 64 + 160, "#ff7700"));

  requestAnimationFrame(gameLoop);
}

initGame();
