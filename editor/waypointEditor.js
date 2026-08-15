const WaypointEditor = {
  active: false,
  waypoints: [],
  dragIndex: -1, // which waypoint is being dragged
  dragOffsetX: 0,
  dragOffsetY: 0,
  dragFrom: null, // where the dragged waypoint started, for the undo stack
  panFromX: null, // last position of a right-button pan, screen px
  panFromY: null,
  hoverX: null, // last cursor position, screen px — the insert preview reads it
  hoverY: null,
  history: [], // edits, newest last
  GRAB_RADIUS: 20, // world px — how close you need to click to grab a waypoint
  INSERT_RADIUS: 20, // *screen* px — how close to the line a click lands in it
  UNDO_LIMIT: 100, // edits remembered

  init(existingWaypoints) {
    this.waypoints = existingWaypoints || [];
    this.history = []; // a different ring — nothing here is undoable onto it
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

  // The closest run of line to a world point, as the segment's index and the
  // foot of the perpendicular on it — or null if nothing is within reach. The
  // ring closes, so the last segment is the one running back to waypoint 0 and
  // a hit on it appends.
  //
  // Unlike the grab ring this reach is in screen pixels, which is why it is
  // divided by the zoom here. A grab has to stay in world units or zooming out
  // makes one radius swallow its neighbours; a segment has no neighbours to be
  // confused with — there is one nearest line — so what matters is only that
  // the dashed line stays as easy to hit as it looks.
  nearestSegment(worldX, worldY) {
    const n = this.waypoints.length;
    if (n < 2) return null;

    let best = null;
    for (let i = 0; i < n; i++) {
      const a = this.waypoints[i];
      const b = this.waypoints[(i + 1) % n];
      const vx = b.x - a.x;
      const vy = b.y - a.y;
      const len2 = vx * vx + vy * vy || 1;
      const t = clamp(((worldX - a.x) * vx + (worldY - a.y) * vy) / len2, 0, 1);
      const px = a.x + vx * t;
      const py = a.y + vy * t;
      const d = Math.hypot(worldX - px, worldY - py);
      if (!best || d < best.d) best = { index: i, d, x: px, y: py };
    }
    return best.d <= this.INSERT_RADIUS / viewZoom ? best : null;
  },

  // Where a click would land right now, or null if it would append. Drawn as a
  // ghost, because the only other way to find out where a point lands in the
  // order is to place one and read the labels.
  insertPreview() {
    if (!this.active || this.hoverX === null || this.dragIndex !== -1)
      return null;
    if (this.findNear(this.hoverX, this.hoverY) !== -1) return null; // a grab
    return this.nearestSegment(
      screenToWorldX(this.hoverX),
      screenToWorldY(this.hoverY),
    );
  },

  // Every edit, so Z undoes the last thing done rather than the last thing in
  // the array — the moment a point could go into the middle of the ring those
  // stopped being the same thing.
  remember(entry) {
    this.history.push(entry);
    if (this.history.length > this.UNDO_LIMIT) this.history.shift();
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
      this.dragFrom = { x: this.waypoints[hit].x, y: this.waypoints[hit].y };
      this.dragOffsetX = this.waypoints[hit].x - screenToWorldX(screenX);
      this.dragOffsetY = this.waypoints[hit].y - screenToWorldY(screenY);
      return;
    }

    // Place a new waypoint. On the line it goes *into* it: the ring is an
    // ordered loop, so a marker appended to the end runs between the last
    // corner and the first however carefully it was clicked, and refining a
    // corner meant re-ordering the exported list by hand.
    const worldX = Math.round(screenToWorldX(screenX));
    const worldY = Math.round(screenToWorldY(screenY));
    const seg = this.nearestSegment(worldX, worldY);
    const at = seg ? seg.index + 1 : this.waypoints.length;
    this.waypoints.splice(at, 0, { x: worldX, y: worldY });
    this.remember({ type: "add", index: at });
    console.log(
      `Waypoint ${at} ${seg ? "inserted" : "added"}:`,
      worldX,
      worldY,
    );
  },

  handleMouseMove(screenX, screenY, buttons) {
    if (!this.active) return;
    this.hoverX = screenX;
    this.hoverY = screenY;

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
      const wp = this.waypoints[this.dragIndex];
      // A grab that let go where it started is not an edit, and putting it on
      // the stack would spend a press of Z doing nothing visible.
      if (this.dragFrom && (wp.x !== this.dragFrom.x || wp.y !== this.dragFrom.y)) {
        this.remember({
          type: "move",
          index: this.dragIndex,
          x: this.dragFrom.x,
          y: this.dragFrom.y,
        });
        console.log(`Waypoint ${this.dragIndex} moved to:`, wp.x, wp.y);
      }
      this.dragIndex = -1;
      this.dragFrom = null;
    }
  },

  // Strictly last-in-first-out, which is what keeps the recorded indices
  // meaning what they meant: everything placed or moved after an entry has
  // already been taken back by the time that entry is reached.
  undo() {
    if (!this.active) return;
    const last = this.history.pop();
    if (!last) return;

    if (last.type === "add") {
      const removed = this.waypoints.splice(last.index, 1)[0];
      console.log(`Waypoint ${last.index} removed:`, removed);
      return;
    }
    const wp = this.waypoints[last.index];
    if (wp) {
      wp.x = last.x;
      wp.y = last.y;
      console.log(`Waypoint ${last.index} put back:`, wp);
    }
  },

  export() {
    console.log("=== WAYPOINTS ===");
    console.log(JSON.stringify(this.waypoints, null, 2));
    console.log("=================");
  },

  draw(ctx) {
    if (!DEBUG) return;

    const ghost = this.insertPreview();
    // Everything in here is drawn inside the free camera's zoom, so anything
    // that has to stay the size it was drawn at divides by it. The insert cue
    // does: its reach is in screen pixels, and a 3px highlight rendered 1px
    // wide at 0.4x is not a highlight. The markers themselves deliberately do
    // not — see the grab ring in findNear().
    const px = 1 / viewZoom;

    ctx.save();
    this.waypoints.forEach((wp, i) => {
      const sx = wp.x - camera.x;
      const sy = wp.y - camera.y;
      const isDragging = i === this.dragIndex;

      // Line to next waypoint — solid where a click would open it up
      const next = this.waypoints[(i + 1) % this.waypoints.length];
      if (next && this.waypoints.length > 1) {
        const opening = ghost && ghost.index === i;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(next.x - camera.x, next.y - camera.y);
        ctx.strokeStyle = opening
          ? "rgba(255, 221, 0, 0.9)"
          : "rgba(255, 255, 0, 0.4)";
        ctx.lineWidth = opening ? 3 * px : 1.5;
        if (!opening) ctx.setLineDash([6, 4]);
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

    // The point a click would drop into the highlighted segment, numbered with
    // the index it would take.
    if (ghost) {
      const gx = ghost.x - camera.x;
      const gy = ghost.y - camera.y;
      ctx.beginPath();
      ctx.arc(gx, gy, 10 * px, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 221, 0, 0.35)";
      ctx.fill();
      ctx.strokeStyle = "#FFDD00";
      ctx.lineWidth = 1.5 * px;
      ctx.setLineDash([3 * px, 3 * px]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = "#FFDD00";
      ctx.font = `bold ${11 * px}px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`+${ghost.index + 1}`, gx, gy - 18 * px);
    }
    ctx.restore();
  },
};
