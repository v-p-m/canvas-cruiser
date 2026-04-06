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
    this.maxSpeed = 7.5 + Math.random() * 1.5; // Randomized difficulty
    this.currentWaypoint = 0;
    this.turnSpeed = 0.08;
  }

  update(waypoints, isRacing) {
    if (!isRacing || !waypoints || waypoints.length === 0) return;

    const target = waypoints[this.currentWaypoint];
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // 1. Calculate steering
    const targetAngle = Math.atan2(dx, -dy);
    let angleDiff = targetAngle - this.angle;

    // Normalize angle to -PI to PI
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;

    // Smooth steering
    this.angle += angleDiff * this.turnSpeed;

    // 2. Constant movement
    this.speed = this.maxSpeed;
    this.x += Math.sin(this.angle) * this.speed;
    this.y -= Math.cos(this.angle) * this.speed;

    // 3. Cycle waypoints
    if (distance < 100) {
      this.currentWaypoint = (this.currentWaypoint + 1) % waypoints.length;
    }
  }

  draw() {
    this.ctx.save();
    this.ctx.translate(this.x, this.y);
    this.ctx.rotate(this.angle);

    // Simple AI Car Body
    this.ctx.fillStyle = "#333"; // Wheels
    this.ctx.fillRect(-this.width / 2 - 2, -this.height / 2 + 5, 8, 12);
    this.ctx.fillRect(this.width / 2 - 6, -this.height / 2 + 5, 8, 12);

    this.ctx.fillStyle = this.color;
    this.ctx.fillRect(
      -this.width / 2,
      -this.height / 2,
      this.width,
      this.height,
    );

    // Windshield
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    this.ctx.fillRect(
      -this.width / 2 + 5,
      -this.height / 2 + 10,
      this.width - 10,
      10,
    );

    this.ctx.restore();
  }
}
