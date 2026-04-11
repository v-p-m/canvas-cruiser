const WaypointEditor = {
  active: false,
  waypoints: [],
  dragIndex: -1, // which waypoint is being dragged
  dragOffsetX: 0,
  dragOffsetY: 0,
  GRAB_RADIUS: 20, // px — how close you need to click to grab a waypoint

  init(existingWaypoints) {
    this.waypoints = existingWaypoints || [];
  },

  toggle() {
    if (!DEBUG) return;
    this.active = !this.active;
    console.log(`Waypoint editor ${this.active ? "ON" : "OFF"}`);
  },

  // Find waypoint index near screen coords, returns -1 if none
  findNear(screenX, screenY) {
    for (let i = 0; i < this.waypoints.length; i++) {
      const sx = this.waypoints[i].x - camera.x;
      const sy = this.waypoints[i].y - camera.y;
      const dx = screenX - sx;
      const dy = screenY - sy;
      if (dx * dx + dy * dy < this.GRAB_RADIUS * this.GRAB_RADIUS) return i;
    }
    return -1;
  },

  handleMouseDown(screenX, screenY) {
    if (!this.active) return;

    const hit = this.findNear(screenX, screenY);
    if (hit !== -1) {
      // Grab existing waypoint
      this.dragIndex = hit;
      this.dragOffsetX = this.waypoints[hit].x - camera.x - screenX;
      this.dragOffsetY = this.waypoints[hit].y - camera.y - screenY;
    } else {
      // Place new waypoint
      const worldX = screenX + camera.x;
      const worldY = screenY + camera.y;
      this.waypoints.push({ x: Math.round(worldX), y: Math.round(worldY) });
      console.log(
        `Waypoint ${this.waypoints.length - 1} added:`,
        worldX,
        worldY,
      );
    }
  },

  handleMouseMove(screenX, screenY) {
    if (!this.active || this.dragIndex === -1) return;
    this.waypoints[this.dragIndex].x = Math.round(screenX + camera.x);
    this.waypoints[this.dragIndex].y = Math.round(screenY + camera.y);
  },

  handleMouseUp() {
    if (this.dragIndex !== -1) {
      console.log(
        `Waypoint ${this.dragIndex} moved to:`,
        this.waypoints[this.dragIndex].x,
        this.waypoints[this.dragIndex].y,
      );
      this.dragIndex = -1;
    }
  },

  undo() {
    if (!this.active) return;
    const removed = this.waypoints.pop();
    if (removed) console.log("Removed last waypoint:", removed);
  },

  export() {
    console.log("=== WAYPOINTS ===");
    console.log(JSON.stringify(this.waypoints, null, 2));
    console.log("=================");
  },

  draw(ctx) {
    if (!DEBUG) return;

    this.waypoints.forEach((wp, i) => {
      const sx = wp.x - camera.x;
      const sy = wp.y - camera.y;
      const isDragging = i === this.dragIndex;

      // Line to next waypoint
      const next = this.waypoints[(i + 1) % this.waypoints.length];
      if (next && this.waypoints.length > 1) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(next.x - camera.x, next.y - camera.y);
        ctx.strokeStyle = "rgba(255, 255, 0, 0.4)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Outer grab ring — shows clickable area
      if (this.active) {
        ctx.beginPath();
        ctx.arc(sx, sy, this.GRAB_RADIUS, 0, Math.PI * 2);
        ctx.strokeStyle = isDragging
          ? "rgba(255, 255, 0, 0.6)"
          : "rgba(255, 255, 255, 0.15)";
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Main circle
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fillStyle = isDragging
        ? "rgba(255, 220, 0, 0.9)"
        : this.active
          ? "rgba(255, 80, 80, 0.7)"
          : "rgba(255, 0, 0, 0.4)";
      ctx.fill();
      ctx.strokeStyle = isDragging
        ? "#FFDD00"
        : this.active
          ? "#FF8888"
          : "#FF4444";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Index label
      ctx.fillStyle = isDragging ? "#000" : "white";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(i, sx, sy);
    });
  },
};
