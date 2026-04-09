// waypointEditor.js

const WaypointEditor = {
  active: false,
  waypoints: [],

  init(existingWaypoints) {
    if (!DEBUG) return;
    this.waypoints = existingWaypoints || [];
    console.log("Waypoint editor ready. Press E to toggle.");
  },

  toggle() {
    if (!DEBUG) return;
    this.active = !this.active;
    console.log(`Waypoint editor ${this.active ? "ON" : "OFF"}`);
  },

  // Call this from the canvas click handler
  handleClick(screenX, screenY) {
    if (!this.active) return;

    // Convert screen coords to world coords using camera
    const worldX = screenX + camera.x;
    const worldY = screenY + camera.y;

    this.waypoints.push({ x: Math.round(worldX), y: Math.round(worldY) });
    console.log(`Waypoint ${this.waypoints.length - 1} added:`, worldX, worldY);
  },

  // Remove last waypoint
  undo() {
    if (!this.active) return;
    const removed = this.waypoints.pop();
    if (removed) console.log("Removed last waypoint:", removed);
  },

  // Prints the full array to console — copy/paste into track.json
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

      // Circle
      ctx.beginPath();
      ctx.arc(sx, sy, 14, 0, Math.PI * 2);
      ctx.fillStyle = this.active
        ? "rgba(255, 80, 80, 0.7)"
        : "rgba(255, 0, 0, 0.4)";
      ctx.fill();
      ctx.strokeStyle = this.active ? "#FF8888" : "#FF4444";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Index label
      ctx.fillStyle = "white";
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(i, sx, sy);
    });

    // Editor status banner
    if (this.active) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, canvas.height - 36, canvas.width, 36);
      ctx.fillStyle = "#FFD700";
      ctx.font = "14px monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(
        `WAYPOINT EDITOR  |  CLICK: place  |  Z: undo  |  P: export to console  |  ${this.waypoints.length} points`,
        canvas.width / 2,
        canvas.height - 18,
      );
    }
  },
};
