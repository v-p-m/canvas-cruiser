// debugHud.js

const DebugHUD = {
  draw(ctx) {
    if (!DEBUG) return;

    // Banner
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, canvas.height - 36, canvas.width, 36);
    ctx.fillStyle = "#FFD700";
    ctx.font = "14px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (WaypointEditor.active) {
      ctx.fillText(
        `WAYPOINT EDITOR  |  CLICK: place  |  DRAG: move  |  Z: undo  |  P: export  |  ${WaypointEditor.waypoints.length} points`,
        canvas.width / 2,
        canvas.height - 18,
      );
    } else {
      ctx.fillText(
        `DEBUG  |  E: waypoint editor  |  D: debug off`,
        canvas.width / 2,
        canvas.height - 18,
      );
    }
  },
};
