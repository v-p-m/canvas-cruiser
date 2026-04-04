const GAME_VERSION = "0.5.0";

let laps = 0;
let hasStarted = false; // New flag to handle the first crossing
let onFinishLine = false;
let lapStartTime = 0;
let currentLapTime = 0;
let bestLapTime = 0;

function drawUI() {
  // 1. Semi-transparent background bar for the top
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(0, 0, canvas.width, 60);

  ctx.fillStyle = "white";
  ctx.font = "bold 20px 'Courier New', Courier, monospace";
  ctx.textAlign = "left";

  // 2. Lap Info
  const lapDisplay = laps > 0 ? `LAP: ${laps}` : "START LINE";
  ctx.fillText(lapDisplay, 20, 35);

  // 3. Speedometer (Right side)
  ctx.textAlign = "right";
  const speedDisplay = Math.round(Math.abs(car.speed) * 10);
  ctx.fillText(`${speedDisplay} KM/H`, canvas.width - 20, 35);

  // 4. Timer (Center)
  ctx.textAlign = "center";
  if (hasStarted) {
    currentLapTime = ((Date.now() - lapStartTime) / 1000).toFixed(2);
    ctx.fillText(`TIME: ${currentLapTime}s`, canvas.width / 2, 35);
  } else {
    ctx.fillText("READY?", canvas.width / 2, 35);
  }
}

// 1. Initialize Canvas FIRST
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
canvas.width = 24 * 64;
canvas.height = 18 * 64;

// 2. Define Track and Load
const worldTrack = new Track(ctx);

async function initGame() {
  await worldTrack.load("track.json");

  // Compatibility check: Use points if they exist, otherwise default to tile (1,1)
  if (
    worldTrack.data &&
    worldTrack.data.points &&
    worldTrack.data.points.length > 0
  ) {
    const startPoint = worldTrack.data.points[0];
    car.x = startPoint.x;
    car.y = startPoint.y;
  } else {
    // Start car in the middle lane (row 3) of the top straight
    car.x = 5 * 64;
    car.y = 3 * 64 + 32;
    car.angle = Math.PI / 2; // Point the car to the right (90 degrees)
  }
}

initGame();

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
window.addEventListener("keydown", (e) => (keys[e.key] = true));
window.addEventListener("keyup", (e) => (keys[e.key] = false));

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
    if (tileID === 0) {
      car.speed *= 0.92; // Constant drag while on grass
    }

    // 3. FINISH LINE
    if (tileID === 9) {
      if (!onFinishLine) {
        onFinishLine = true;
        if (!hasStarted) {
          hasStarted = true;
        } else {
          laps++;
          // Save Best Lap Logic
          if (bestLapTime === 0 || currentLapTime < bestLapTime) {
            bestLapTime = currentLapTime;
          }
        }
        lapStartTime = Date.now();
      }
    } else {
      onFinishLine = false;
    }
  }
}

function update() {
  if (keys["ArrowUp"]) {
    car.speed += car.acceleration;
  } else if (keys["ArrowDown"]) {
    car.speed -= car.acceleration;
  } else {
    car.speed *= 0.95;
  }

  if (car.speed > car.maxSpeed) car.speed = car.maxSpeed;
  if (car.speed < -car.maxSpeed / 2) car.speed = -car.maxSpeed / 2;
  if (Math.abs(car.speed) < 0.1) car.speed = 0;

  if (car.speed !== 0) {
    const flip = car.speed > 0 ? 1 : -1;
    if (keys["ArrowLeft"]) car.angle -= car.turnSpeed * flip;
    if (keys["ArrowRight"]) car.angle += car.turnSpeed * flip;
    if (keys["ArrowLeft"] || keys["ArrowRight"]) car.speed *= 0.98;
  }

  const targetVx = Math.sin(car.angle) * car.speed;
  const targetVy = -Math.cos(car.angle) * car.speed;

  car.velocityX += (targetVx - car.velocityX) * car.driftGrip;
  car.velocityY += (targetVy - car.velocityY) * car.driftGrip;

  // Final movement
  car.x += car.velocityX;
  car.y += car.velocityY;

  // RUN COLLISION CHECK
  checkTileCollision(car.x, car.y);

  // Screen Boundaries
  if (car.x < 0) car.x = 0;
  if (car.x > canvas.width) car.x = canvas.width;
  if (car.y < 0) car.y = 0;
  if (car.y > canvas.height) car.y = canvas.height;
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Draw World first
  worldTrack.draw();

  // 2. Draw Car second
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = "red";
  ctx.fillRect(-car.width / 2, -car.height / 2, car.width, car.height);
  ctx.fillStyle = "white";
  ctx.fillRect(-car.width / 2, -car.height / 2, car.width, 10);
  ctx.restore();

  // 3. Draw UI LAST (So it's always on top)
  drawUI();

  requestAnimationFrame(draw);
}

// Start the loop
updateLoop();
function updateLoop() {
  update();
  setTimeout(updateLoop, 1000 / 60); // Stable 60fps logic
}
draw();
