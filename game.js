const GAME_VERSION = "0.5.6";

let laps = 0;
let hasStarted = false;
let onFinishLine = false;
let lapStartTime = 0;
let currentLapTime = 0;
let bestLapTime = 0;
let isMenu = true;
let isRacing = false; // Start as false so car doesn't move in menu
let highScores = JSON.parse(localStorage.getItem("highScores")) || [];
let skidMarks = [];
const MAX_SKID_MARKS = 500; // Prevent memory lag

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

// SINGLE Event Listener for everything
window.addEventListener("keydown", (e) => {
  const key = e.key.toLowerCase();

  // 1. ESC Logic (Global)
  if (key === "escape") {
    isMenu = true;
    isRacing = false;
    resetRace(); // Reset position and timers
    return;
  }

  // 2. Menu Logic
  if (isMenu) {
    if (key === "enter" || key === " ") {
      isMenu = false;
      isRacing = true;
    }
    return;
  }

  // Reset logic (only allowed in Menu or Leaderboard)
  if ((isMenu || !isRacing) && key === "c") {
    clearHighScores();
    return;
  }

  keys[e.key] = true;

  // 3. Racing Logic
  if (key === "q") {
    isRacing = !isRacing;
    if (!isRacing) car.speed = 0;
  }
});

window.addEventListener("keyup", (e) => (keys[e.key] = false));

window.addEventListener("resize", () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  camera.width = canvas.width;
  camera.height = canvas.height;
});

const worldTrack = new Track(ctx);

async function initGame() {
  await worldTrack.load("track.json");
  // Default spawn
  car.x = 5 * 64;
  car.y = 3 * 64 + 32;
  car.angle = Math.PI / 2;
}

initGame();

function saveLapTime(time) {
  highScores.push(parseFloat(time));
  highScores.sort((a, b) => a - b);
  highScores = highScores.slice(0, 5);
  localStorage.setItem("highScores", JSON.stringify(highScores));
}

function drawCar() {
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

  const w = car.width;
  const h = car.height;

  // Wheels
  ctx.fillStyle = "#333";
  ctx.fillRect(-w / 2 - 2, -h / 2 + 5, 8, 12);
  ctx.fillRect(w / 2 - 6, -h / 2 + 5, 8, 12);
  ctx.fillRect(-w / 2 - 2, h / 2 - 15, 8, 12);
  ctx.fillRect(w / 2 - 6, h / 2 - 15, 8, 12);

  // Body
  ctx.fillStyle = "#d00";
  ctx.fillRect(-w / 2, -h / 2, w, h);

  // Glass
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

  // --- ALIGNED CONTROLS ---
  const centerX = canvas.width / 2;
  const startY = 280;
  const lineSpacing = 35;
  const gutter = 20; // Space between the ':' and the text

  ctx.font = "20px 'Courier New'";

  const controls = [
    { key: "UP / DOWN", action: "Gas & Brake" },
    { key: "LEFT / RIGHT", action: "Steer" },
    { key: "Q", action: "Top 5 Best Laps" },
    { key: "C", action: "Clear Records" },
    { key: "ESC", action: "Back to Menu" },
  ];

  controls.forEach((item, i) => {
    const y = startY + i * lineSpacing;

    // 1. Draw the Key (Right Aligned)
    ctx.textAlign = "right";
    ctx.fillStyle = "#AAA"; // Slightly dimmer for keys
    ctx.fillText(item.key, centerX - gutter, y);

    // 2. Draw the Separator (Centered)
    ctx.textAlign = "center";
    ctx.fillStyle = "white";
    ctx.fillText(":", centerX, y);

    // 3. Draw the Action (Left Aligned)
    ctx.textAlign = "left";
    ctx.fillStyle = "white";
    ctx.fillText(item.action, centerX + gutter, y);
  });

  // --- BLINKING PROMPT ---
  // Positioned exactly 80px below the last control line
  const promptY = startY + controls.length * lineSpacing + 60;

  ctx.textAlign = "center";
  ctx.font = "bold 26px 'Courier New'";

  // Blinking logic
  if (Math.floor(Date.now() / 500) % 2) {
    ctx.fillStyle = "#00FF00";
    ctx.fillText("PRESS [ENTER] TO RACE", centerX, promptY);
  }
}

function drawUI() {
  if (!isRacing && !isMenu) {
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
    return;
  }

  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(0, 0, canvas.width, 60);
  ctx.fillStyle = "#00FF00";
  ctx.font = "bold 20px 'Courier New'";
  ctx.textAlign = "left";
  ctx.fillText(hasStarted ? `LAP ${laps}` : "GO! GO! GO!", 20, 35);
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

function checkTileCollision(x, y) {
  if (!worldTrack.data || !worldTrack.data.map) return;
  const gridX = Math.floor(x / worldTrack.data.tileSize);
  const gridY = Math.floor(y / worldTrack.data.tileSize);

  if (
    worldTrack.data.map[gridY] &&
    worldTrack.data.map[gridY][gridX] !== undefined
  ) {
    const tileID = worldTrack.data.map[gridY][gridX];

    // 1. WALL COLLISION
    if (tileID === 1) {
      car.speed *= -0.5;
      car.x -= car.velocityX * 2;
      car.y -= car.velocityY * 2;
    }

    // 2. GRASS PENALTY (NEW)
    if (tileID === 0) car.speed *= 0.92;

    // 3. FINISH LINE
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

function update() {
  if (!isRacing || isMenu) return;

  // 1. Acceleration
  if (keys["ArrowUp"]) car.speed += car.acceleration;
  else if (keys["ArrowDown"]) car.speed -= car.acceleration;
  else car.speed *= 0.95;

  // 2. Speed Caps
  if (car.speed > car.maxSpeed) car.speed = car.maxSpeed;
  if (car.speed < -car.maxSpeed / 2) car.speed = -car.maxSpeed / 2;
  if (Math.abs(car.speed) < 0.1) car.speed = 0;

  // 3. Steering & DYNAMIC TIRE SCRUB
  if (car.speed !== 0) {
    const flip = car.speed > 0 ? 1 : -1;
    const turningLeft = keys["ArrowLeft"];
    const turningRight = keys["ArrowRight"];

    if (turningLeft) car.angle -= car.turnSpeed * flip;
    if (turningRight) car.angle += car.turnSpeed * flip;

    // RESTORED: Dynamic Tire Scrub Logic
    if (turningLeft || turningRight) {
      // Calculate a penalty based on current speed
      const scrubFactor =
        0.94 + 0.04 * (1 - Math.abs(car.speed) / car.maxSpeed);
      car.speed *= scrubFactor;

      if (Math.abs(car.speed) > 7) console.log("Drifting/Scrubbing!");

      if (Math.abs(car.speed) > 5) {
        // Only at higher speeds
        skidMarks.push({
          x: car.x,
          y: car.y,
          angle: car.angle,
        });

        // Keep the array small to prevent lag
        if (skidMarks.length > 500) skidMarks.shift();
      }
    }
  }

  // 4. Velocity & Drift
  const targetVx = Math.sin(car.angle) * car.speed;
  const targetVy = -Math.cos(car.angle) * car.speed;
  car.velocityX += (targetVx - car.velocityX) * car.driftGrip;
  car.velocityY += (targetVy - car.velocityY) * car.driftGrip;

  // 5. Position & Collision
  car.x += car.velocityX;
  car.y += car.velocityY;
  checkTileCollision(car.x, car.y);

  // 6. Camera Follow
  camera.x = car.x - camera.width / 2;
  camera.y = car.y - camera.height / 2;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.translate(-camera.x, -camera.y);
  worldTrack.draw();

  // DRAW SKID MARKS
  ctx.fillStyle = "rgba(0, 0, 0, 0.15)"; // Dark grey, slightly transparent

  skidMarks.forEach((mark) => {
    ctx.save();
    ctx.translate(mark.x, mark.y);
    ctx.rotate(mark.angle);

    // Draw two skid marks (Left and Right wheel)
    // Offset by half the car's width to match the wheels
    const offset = car.width / 2 - 4;

    // Left Rear Tire Mark
    ctx.fillRect(-offset, car.height / 4, 6, 10);
    // Right Rear Tire Mark
    ctx.fillRect(offset - 6, car.height / 4, 6, 10);

    ctx.restore();
  });

  if (!isMenu) drawCar();
  ctx.restore();

  if (isMenu) drawStartMenu();
  else drawUI();

  requestAnimationFrame(draw);
}

function clearHighScores() {
  if (confirm("Clear all high scores and records?")) {
    highScores = [];
    bestLapTime = 0;
    localStorage.removeItem("highScores");
    localStorage.removeItem("bestLap");
    console.log("Local history cleared.");
  }
}

function resetRace() {
  // Reset Car Position to Start Line
  car.x = 5 * 64;
  car.y = 3 * 64 + 32;
  car.angle = Math.PI / 2;
  car.speed = 0;
  car.velocityX = 0;
  car.velocityY = 0;

  // Reset Session Data
  laps = 0;
  hasStarted = false;
  currentLapTime = 0;
  onFinishLine = false;
}

// Fixed game loop
setInterval(update, 1000 / 60);
draw();
