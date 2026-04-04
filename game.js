const GAME_VERSION = "0.2.0";
console.log(`Canvas Cruiser Engine Loaded: v${GAME_VERSION}`);

async function initGame() {
  await worldTrack.load("track.json");
  if (worldTrack.data.version !== GAME_VERSION) {
    console.warn("Warning: Track version mismatch!");
  }
}

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const car = {
  x: canvas.width / 2,
  y: canvas.height / 2,
  width: 30,
  height: 50,
  angle: 0,
  speed: 0,
  acceleration: 0.2,
  friction: 0.05,
  maxSpeed: 10,
  turnSpeed: 0.06,
  velocityX: 0,
  velocityY: 0,
  friction: 0.96, // Higher friction = grippy, Lower = ice-like
  driftGrip: 0.1, // How fast the car "catches" the road (0.01 to 0.2)
};

const keys = {};

window.addEventListener("keydown", (e) => (keys[e.key] = true));
window.addEventListener("keyup", (e) => (keys[e.key] = false));

function update() {
  // 1. Handle Input (Acceleration/Braking)
  if (keys["ArrowUp"]) {
    car.speed += car.acceleration;
  } else if (keys["ArrowDown"]) {
    car.speed -= car.acceleration;
  } else {
    car.speed *= 0.95; // Passive slow down
  }

  // 2. NEW: Hard Cap on Speed
  if (car.speed > car.maxSpeed) car.speed = car.maxSpeed;
  if (car.speed < -car.maxSpeed / 2) car.speed = -car.maxSpeed / 2;
  if (Math.abs(car.speed) < 0.1) car.speed = 0;

  // 3. Steering (Only if moving)
  if (car.speed !== 0) {
    const flip = car.speed > 0 ? 1 : -1;
    const isTurning = keys["ArrowLeft"] || keys["ArrowRight"];

    if (keys["ArrowLeft"]) car.angle -= car.turnSpeed * flip;
    if (keys["ArrowRight"]) car.angle += car.turnSpeed * flip;

    // TIRE SCRUB: Slow down while turning
    if (isTurning) {
      // Reduces speed by a small percentage (e.g., 2%) every frame while turning
      car.speed *= 0.98;
    }
  }

  // 4. Calculate Velocity Targets
  const targetVx = Math.sin(car.angle) * car.speed;
  const targetVy = -Math.cos(car.angle) * car.speed;

  // 5. Apply Drift and Friction to VECTORS
  car.velocityX += (targetVx - car.velocityX) * car.driftGrip;
  car.velocityY += (targetVy - car.velocityY) * car.driftGrip;

  // This ensures the actual movement never exceeds the max speed + a tiny drift buffer
  const currentTotalSpeed = Math.sqrt(car.velocityX ** 2 + car.velocityY ** 2);
  if (currentTotalSpeed > car.maxSpeed) {
    const ratio = car.maxSpeed / currentTotalSpeed;
    car.velocityX *= ratio;
    car.velocityY *= ratio;
  }

  // 6. Update Position
  car.x += car.velocityX;
  car.y += car.velocityY;

  // 7. Boundaries (Keep your previous logic here)
  if (car.x < 0) car.x = 0;
  if (car.x > canvas.width) car.x = canvas.width;
  if (car.y < 0) car.y = 0;
  if (car.y > canvas.height) car.y = canvas.height;
}

const worldTrack = new Track(ctx);
worldTrack.load("track.json");

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  worldTrack.draw();

  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);

  // Draw Car Box
  ctx.fillStyle = "red";
  ctx.fillRect(-car.width / 2, -car.height / 2, car.width, car.height);

  // Draw "Front" indicator
  ctx.fillStyle = "white";
  ctx.fillRect(-car.width / 2, -car.height / 2, car.width, 10);

  ctx.restore();

  requestAnimationFrame(() => {
    update();
    draw();
  });
}

draw();
