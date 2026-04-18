class AICar {
  constructor(ctx, x, y, color = "#0077ff") {
    this.ctx = ctx;
    this.x = x;
    this.y = y;
    this.color = color;
    this.width = 30;
    this.height = 50;
    this.angle = Math.PI / 2;
    this.speed = 0;
    this.maxSpeed = 7.5 + Math.random() * 1.5;
    this.speedMultiplier = 1.0;
    this.currentWaypoint = 0;
    this.turnSpeed = 0.08;
    this.velocityX = 0;
    this.velocityY = 0;
    this.grip = 0.15;
    this.lineOffset = (Math.random() - 0.5) * 40;
  }

  applyRepulsion(others) {
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
        this.velocityX += (dx / dist) * strength;
        this.velocityY += (dy / dist) * strength;
      }
    });
  }

  update(waypoints, isRacing, playerX, playerY, others) {
    if (!isRacing || !waypoints || waypoints.length === 0) return;

    const current = waypoints[this.currentWaypoint];
    const next = waypoints[(this.currentWaypoint + 1) % waypoints.length];

    const dx = current.x - this.x;
    const dy = current.y - this.y;
    const distSq = dx * dx + dy * dy;

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
    this.angle += angleDiff * this.turnSpeed;

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
    this.speedMultiplier = Math.min(1.0, this.speedMultiplier + 0.02);

    // Speed — ease off on sharp corners, apply rubber band and multiplier
    const cornerFactor = 1 - Math.min(Math.abs(angleDiff) / Math.PI, 1) * 0.5;
    this.speed =
      this.maxSpeed * cornerFactor * rubberBand * this.speedMultiplier;

    // Velocity-based movement
    const targetVx = Math.sin(this.angle) * this.speed;
    const targetVy = -Math.cos(this.angle) * this.speed;
    this.velocityX += (targetVx - this.velocityX) * this.grip;
    this.velocityY += (targetVy - this.velocityY) * this.grip;
    this.x += this.velocityX;
    this.y += this.velocityY;

    // Advance waypoint
    if (distSq < 80 * 80) {
      this.currentWaypoint = (this.currentWaypoint + 1) % waypoints.length;
    }

    this.applyRepulsion(others);
  }

  drawCollisionBox(ctx) {
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // drawCollisionBox
    const hw = this.width / 2; // = 15
    const hh = this.height / 2; // = 25

    ctx.strokeStyle = "rgba(255, 0, 0, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);

    ctx.restore();
  }

  draw() {
    this.ctx.save();
    this.ctx.translate(this.x, this.y);
    this.ctx.rotate(this.angle);

    const w = this.width;
    const h = this.height;

    this.ctx.fillStyle = "#333";
    this.ctx.fillRect(-w / 2 - 2, -h / 2 + 5, 8, 12);
    this.ctx.fillRect(w / 2 - 6, -h / 2 + 5, 8, 12);
    this.ctx.fillRect(-w / 2 - 2, h / 2 - 15, 8, 12);
    this.ctx.fillRect(w / 2 - 6, h / 2 - 15, 8, 12);

    this.ctx.fillStyle = this.color;
    this.ctx.fillRect(-w / 2, -h / 2, w, h);

    this.ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    this.ctx.fillRect(-w / 2 + 5, -h / 2 + 10, w - 10, 10);

    this.ctx.restore();

    if (DEBUG) this.drawCollisionBox(this.ctx);
  }
}
