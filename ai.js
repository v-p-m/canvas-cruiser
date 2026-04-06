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
    this.currentWaypoint = 0;
    this.turnSpeed = 0.08;
    this.velocityX = 0;
    this.velocityY = 0;
  }

  update(waypoints, isRacing) {
    if (!isRacing || !waypoints || waypoints.length === 0) return;

    const target = waypoints[this.currentWaypoint];
    const dx = target.x - this.x;
    const dy = target.y - this.y;

    // 1. Steering — normalise with atan2 instead of while loops
    const targetAngle = Math.atan2(dx, -dy);
    const angleDiff = Math.atan2(
      Math.sin(targetAngle - this.angle),
      Math.cos(targetAngle - this.angle),
    );
    this.angle += angleDiff * this.turnSpeed;

    // 2. Speed — ease off on sharp corners
    const cornerFactor = 1 - Math.min(Math.abs(angleDiff) / Math.PI, 1) * 0.5;
    this.speed = this.maxSpeed * cornerFactor;

    // 3. Move
    this.x += Math.sin(this.angle) * this.speed;
    this.y -= Math.cos(this.angle) * this.speed;

    // 4. Advance waypoint — squared distance avoids Math.sqrt
    const distSq = dx * dx + dy * dy;
    if (distSq < 100 * 100) {
      this.currentWaypoint = (this.currentWaypoint + 1) % waypoints.length;
    }
  }

  // Simple circle-based overlap check against another car
  resolveCollision(other) {
    const dx = other.x - this.x;
    const dy = other.y - this.y;
    const distSq = dx * dx + dy * dy;
    const minDist = this.width; // treat both cars as circles of radius ~width

    if (distSq < minDist * minDist && distSq > 0) {
      const dist = Math.sqrt(distSq);
      const overlap = (minDist - dist) / 2;
      const nx = dx / dist;
      const ny = dy / dist;

      // Push both cars apart equally
      this.x -= nx * overlap;
      this.y -= ny * overlap;
      other.x += nx * overlap;
      other.y += ny * overlap;

      // Dampen speed on impact
      this.speed *= 0.7;
      other.speed *= 0.7;
    }
  }

  draw() {
    this.ctx.save();
    this.ctx.translate(this.x, this.y);
    this.ctx.rotate(this.angle);

    const w = this.width;
    const h = this.height;

    // All four wheels (matching player car)
    this.ctx.fillStyle = "#333";
    this.ctx.fillRect(-w / 2 - 2, -h / 2 + 5, 8, 12); // front left
    this.ctx.fillRect(w / 2 - 6, -h / 2 + 5, 8, 12); // front right
    this.ctx.fillRect(-w / 2 - 2, h / 2 - 15, 8, 12); // rear left
    this.ctx.fillRect(w / 2 - 6, h / 2 - 15, 8, 12); // rear right

    // Body
    this.ctx.fillStyle = this.color;
    this.ctx.fillRect(-w / 2, -h / 2, w, h);

    // Windshield
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    this.ctx.fillRect(-w / 2 + 5, -h / 2 + 10, w - 10, 10);

    this.ctx.restore();
  }
}
