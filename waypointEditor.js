const WaypointEditor = {
  active: false,
  waypoints: [],
  dragIndex: -1, // which waypoint is being dragged
  dragOffsetX: 0,
  dragOffsetY: 0,
  panFromX: null, // last position of a right-button pan, screen px
  panFromY: null,
  GRAB_RADIUS: 20, // world px — how close you need to click to grab a waypoint

  init(existingWaypoints) {
    this.waypoints = existingWaypoints || [];
  },

  toggle() {
    if (!DEBUG) return;
    this.active = !this.active;
    // Opened from the menu the view is free (see the free camera in game.js),
    // and it starts where the racing camera was left.
    if (this.active) resetEditorView();
    console.log(`Waypoint editor ${this.active ? "ON" : "OFF"}`);
  },

  // Find waypoint index near screen coords, returns -1 if none. The compare is
  // in world units so the grab ring stays the ring that is drawn — zoomed out
  // it shrinks with the map rather than swallowing half the lap.
  findNear(screenX, screenY) {
    const wx = screenToWorldX(screenX);
    const wy = screenToWorldY(screenY);
    for (let i = 0; i < this.waypoints.length; i++) {
      const dx = wx - this.waypoints[i].x;
      const dy = wy - this.waypoints[i].y;
      if (dx * dx + dy * dy < this.GRAB_RADIUS * this.GRAB_RADIUS) return i;
    }
    return -1;
  },

  handleClick(screenX, screenY) {
    if (!this.active) return;
    this.waypoints.push({
      x: Math.round(screenToWorldX(screenX)),
      y: Math.round(screenToWorldY(screenY)),
    });
  },

  handleMouseDown(screenX, screenY, button) {
    if (!this.active) return;

    // Right-drag pans. Placing a point is the left button's job, so the right
    // one is free, and dragging the map beats forty presses of an arrow key.
    if (button === 2) {
      this.panFromX = screenX;
      this.panFromY = screenY;
      return;
    }

    const hit = this.findNear(screenX, screenY);
    if (hit !== -1) {
      // Grab existing waypoint
      this.dragIndex = hit;
      this.dragOffsetX = this.waypoints[hit].x - screenToWorldX(screenX);
      this.dragOffsetY = this.waypoints[hit].y - screenToWorldY(screenY);
    } else {
      // Place new waypoint
      const worldX = screenToWorldX(screenX);
      const worldY = screenToWorldY(screenY);
      this.waypoints.push({ x: Math.round(worldX), y: Math.round(worldY) });
      console.log(
        `Waypoint ${this.waypoints.length - 1} added:`,
        worldX,
        worldY,
      );
    }
  },

  handleMouseMove(screenX, screenY, buttons) {
    if (!this.active) return;

    if (buttons & 2 && this.panFromX !== null) {
      // The drag is in screen pixels; the view moves in world ones.
      panEditorView(
        (this.panFromX - screenX) / viewZoom,
        (this.panFromY - screenY) / viewZoom,
      );
      this.panFromX = screenX;
      this.panFromY = screenY;
      return;
    }

    if (this.dragIndex === -1) return;
    this.waypoints[this.dragIndex].x = Math.round(screenToWorldX(screenX));
    this.waypoints[this.dragIndex].y = Math.round(screenToWorldY(screenY));
  },

  handleMouseUp() {
    this.panFromX = null;
    this.panFromY = null;
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

    ctx.save();
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
    ctx.restore();
  },
};
