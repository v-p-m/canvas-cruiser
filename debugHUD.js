const DebugHUD = {
  fps: 0,
  frameCount: 0,
  lastFpsTime: 0,

  update(timestamp) {
    if (!DEBUG) return;
    this.frameCount++;
    if (timestamp - this.lastFpsTime >= 500) {
      // update every 500ms
      this.fps = Math.round(
        this.frameCount / ((timestamp - this.lastFpsTime) / 1000),
      );
      this.frameCount = 0;
      this.lastFpsTime = timestamp;
    }
  },

  draw(ctx) {
    if (!DEBUG) return;

    // FPS counter — top right corner
    const fpsColor =
      this.fps >= 55 ? "#00FF88" : this.fps >= 30 ? "#FFD700" : "#FF4444";

    ctx.font = "bold 14px monospace";
    ctx.fillStyle = fpsColor;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(`${this.fps} FPS`, canvas.width - 12, 70);

    // Banner
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, canvas.height - 36, canvas.width, 36);
    ctx.fillStyle = "#FFD700";
    ctx.font = "14px monospace";

    if (DEBUG) {
      SPAWN_POSITIONS.forEach((pos, i) => {
        const sx = pos.x - camera.x;
        const sy = pos.y - camera.y;

        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.fillStyle = i === 0 ? "#FF0000" : "#FF8800";
        ctx.fill();
        ctx.strokeStyle = "white";
        ctx.lineWidth = 1.5;
        ctx.stroke();

        ctx.fillStyle = "white";
        ctx.font = "bold 11px monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(i === 0 ? "P" : `A${i}`, sx, sy);
      });
    }

    if (WaypointEditor.active) {
      ctx.fillText(
        `WAYPOINT EDITOR  |  CLICK: place  |  DRAG: move  |  Z: undo  |  P: export  |  ${WaypointEditor.waypoints.length} points`,
        canvas.width / 2,
        canvas.height - 18,
      );
    } else {
      ctx.fillText(
        `DEBUG | E: waypoint editor  | T: track editor | C: config | B: debug off`,
        canvas.width / 2,
        canvas.height - 18,
      );
    }
  },
};
