const aiCarImages = {};
const aiImageSources = {
  "#0077ff": "assets/car_blue.png",
  "#ff7700": "assets/car_orange.png",
  "#00cc44": "assets/car_green.png",
  "#cc00cc": "assets/car_purple.png",
};

for (const [color, src] of Object.entries(aiImageSources)) {
  const img = new Image();
  img.src = src;
  aiCarImages[color] = img;
}

class AICar {
  constructor(ctx, x, y, color = "#0077ff") {
    this.ctx = ctx;
    this.x = x;
    this.y = y;
    this.color = color;
    this.width = 34;
    this.height = 56;
    this.angle = Math.PI / 2;
    this.speed = 0;
    this.speedMultiplier = 1.0;
    this.currentWaypoint = 0;
    this.turnSpeed = 0.08;
    this.velocityX = 0;
    this.velocityY = 0;
    this.grip = 0.15;
    this.lineOffset = (Math.random() - 0.5) * 40;
    this.startDelay = Math.random() * 800; // 0–800ms random delay
    this.basMaxSpeed = 7.5 + Math.random() * 1.5; // fixed base
    this.maxSpeed = this.basMaxSpeed;
    this.lapSpeedOffset = 0; // varies each lap
    this.lastWaypoint = -1;
  }

  applyRepulsion(others, delta = 1) {
    const REPULSION_RADIUS = DebugConfig.values.aiRepulsionRadius; // 120 - px — start pushing apart at this distance
    const REPULSION_FORCE = DebugConfig.values.aiRepulsionForce; //0.3 - how strongly they push apart

    others.forEach((other) => {
      if (other === this) return;

      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < REPULSION_RADIUS * REPULSION_RADIUS && distSq > 0) {
        const dist = Math.sqrt(distSq);
        const strength = (1 - dist / REPULSION_RADIUS) * REPULSION_FORCE;

        // Push this car away from other
        this.velocityX += (dx / dist) * strength * delta;
        this.velocityY += (dy / dist) * strength * delta;
      }
    });
  }

  update(waypoints, isRacing, playerX, playerY, others, delta = 1) {
    if (!isRacing || !waypoints || waypoints.length === 0) return;

    // Burn down the start delay before moving
    if (this.startDelay > 0) {
      this.startDelay -= (delta / 60) * 1000; // convert delta frames to ms
      return;
    }

    let current = waypoints[this.currentWaypoint];
    let next = waypoints[(this.currentWaypoint + 1) % waypoints.length];

    const dx = current.x - this.x;
    const dy = current.y - this.y;
    const distSq = dx * dx + dy * dy;

    if (distSq < 120 * 120) {
      const prev = this.currentWaypoint;
      this.currentWaypoint = (this.currentWaypoint + 1) % waypoints.length;

      // Recalculate current and next after advancing
      current = waypoints[this.currentWaypoint];
      next = waypoints[(this.currentWaypoint + 1) % waypoints.length];
    }

    // Perpendicular offset for varied racing line
    const perpX = -(current.y - next.y);
    const perpY = current.x - next.x;
    const perpLen = Math.sqrt(perpX * perpX + perpY * perpY) || 1;

    const targetX = current.x + (perpX / perpLen) * this.lineOffset;
    const targetY = current.y + (perpY / perpLen) * this.lineOffset;

    // Steering
    const targetAngle = Math.atan2(targetX - this.x, -(targetY - this.y));
    const angleDiff = Math.atan2(
      Math.sin(targetAngle - this.angle),
      Math.cos(targetAngle - this.angle),
    );
    this.angle += angleDiff * this.turnSpeed * delta;

    // Rubber banding — must be declared before use
    let rubberBand = 1.0;
    if (playerX !== undefined && playerY !== undefined) {
      const dxP = playerX - this.x;
      const dyP = playerY - this.y;
      const distToPlayer = Math.sqrt(dxP * dxP + dyP * dyP);
      if (distToPlayer > 400) rubberBand = 1.15;
      if (distToPlayer < 100) rubberBand = 0.88;
    }

    // Decay multiplier back to 1 each frame
    this.speedMultiplier = Math.min(1.0, this.speedMultiplier + 0.02 * delta);

    // Speed — ease off on sharp corners, apply rubber band and multiplier
    const cornerFactor = 1 - Math.min(Math.abs(angleDiff) / Math.PI, 1) * 0.5;
    const targetSpeed =
      this.maxSpeed * cornerFactor * rubberBand * this.speedMultiplier;
    this.speed += (targetSpeed - this.speed) * 0.05 * delta;

    // Velocity-based movement
    const targetVx = Math.sin(this.angle) * this.speed;
    const targetVy = -Math.cos(this.angle) * this.speed;
    this.velocityX += (targetVx - this.velocityX) * this.grip * delta;
    this.velocityY += (targetVy - this.velocityY) * this.grip * delta;
    this.x += this.velocityX * delta;
    this.y += this.velocityY * delta;

    // Advance waypoint
    if (distSq < 80 * 80) {
      this.currentWaypoint = (this.currentWaypoint + 1) % waypoints.length;
    }

    this.applyRepulsion(others, delta);
  }

  drawCollisionBox(ctx) {
    ctx.save();
    ctx.translate(this.x - camera.x, this.y - camera.y); // screen space
    ctx.rotate(this.angle);

    const hw = this.width / 2;
    const hh = this.height / 2;

    ctx.strokeStyle = "rgba(255, 0, 0, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);

    ctx.restore();
  }

  draw() {
    this.ctx.save();
    this.ctx.translate(this.x - camera.x, this.y - camera.y);
    this.ctx.rotate(this.angle);

    const w = this.width;
    const h = this.height;
    const img = aiCarImages[this.color];

    if (img && img.complete && img.naturalWidth > 0) {
      this.ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      // Fallback: original rectangle while image loads
      this.ctx.fillStyle = "#333";
      this.ctx.fillRect(-w / 2 - 2, -h / 2 + 5, 8, 12);
      this.ctx.fillRect(w / 2 - 6, -h / 2 + 5, 8, 12);
      this.ctx.fillRect(-w / 2 - 2, h / 2 - 15, 8, 12);
      this.ctx.fillRect(w / 2 - 6, h / 2 - 15, 8, 12);
      this.ctx.fillStyle = this.color;
      this.ctx.fillRect(-w / 2, -h / 2, w, h);
      this.ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
      this.ctx.fillRect(-w / 2 + 5, -h / 2 + 10, w - 10, 10);
    }

    this.ctx.restore();

    if (DEBUG) this.drawCollisionBox(this.ctx);
  }
}
