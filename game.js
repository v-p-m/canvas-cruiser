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
  maxSpeed: 5,
  turnSpeed: 0.04,
};

const keys = {};

window.addEventListener("keydown", (e) => (keys[e.key] = true));
window.addEventListener("keyup", (e) => (keys[e.key] = false));

function update() {
  // Forward / Backward
  if (keys["ArrowUp"]) car.speed += car.acceleration;
  if (keys["ArrowDown"]) car.speed -= car.acceleration;

  // Apply Friction
  if (car.speed > 0) car.speed -= car.friction;
  if (car.speed < 0) car.speed += car.friction;
  if (Math.abs(car.speed) < car.friction) car.speed = 0;

  // Speed Limit
  if (car.speed > car.maxSpeed) car.speed = car.maxSpeed;
  if (car.speed < -car.maxSpeed / 2) car.speed = -car.maxSpeed / 2;

  // Steering (only if moving)
  if (car.speed !== 0) {
    const flip = car.speed > 0 ? 1 : -1;
    if (keys["ArrowLeft"]) car.angle -= car.turnSpeed * flip;
    if (keys["ArrowRight"]) car.angle += car.turnSpeed * flip;
  }

  // Move Car
  car.x += Math.sin(car.angle) * car.speed;
  car.y -= Math.cos(car.angle) * car.speed;

  // Screen Boundaries
  if (car.x < 0) car.x = 0;
  if (car.x > canvas.width) car.x = canvas.width;
  if (car.y < 0) car.y = 0;
  if (car.y > canvas.height) car.y = canvas.height;

  // Optional: Stop speed on impact
  if (
    car.x <= 0 ||
    car.x >= canvas.width ||
    car.y <= 0 ||
    car.y >= canvas.height
  ) {
    car.speed = 0;
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

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
