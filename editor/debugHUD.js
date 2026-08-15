const DebugHUD = {
  fps: 0,
  frameCount: 0,
  lastFpsTime: 0,

  // Frame budget, split two ways. `loopMs` is everything gameLoop does; the
  // gap between it and `frameMs` is what the browser spends outside our code
  // — rasterising the queued canvas commands and handing the backing store to
  // the compositor. That half is invisible to any timer inside the loop, and
  // on a machine without GPU canvas raster it is the half that hurts, so the
  // two numbers are what tell you whether to cut drawing or cut resolution.
  loopMs: 0,
  frameMs: 0,
  voicesPerSec: 0,
  _loopStart: 0,
  _loopAccum: 0,
  _lastImpactCount: 0,

  update(timestamp) {
    if (!DEBUG) return;
    this._loopStart = performance.now();
    this.frameCount++;
    if (timestamp - this.lastFpsTime >= 500) {
      // update every 500ms
      const elapsed = timestamp - this.lastFpsTime;
      this.fps = Math.round(this.frameCount / (elapsed / 1000));
      this.frameMs = elapsed / this.frameCount;
      this.loopMs = this._loopAccum / this.frameCount;
      this.voicesPerSec = Math.round(
        ((Sound.impactCount - this._lastImpactCount) * 1000) / elapsed,
      );
      this._lastImpactCount = Sound.impactCount;
      this._loopAccum = 0;
      this.frameCount = 0;
      this.lastFpsTime = timestamp;
    }
  },

  // Called at the very end of gameLoop, before the next rAF is queued.
  endFrame() {
    if (!DEBUG) return;
    this._loopAccum += performance.now() - this._loopStart;
  },

  draw(ctx) {
    if (!DEBUG) return;

    ctx.save();

    // FPS counter — top right corner
    const fpsColor =
      this.fps >= 55 ? "#00FF88" : this.fps >= 30 ? "#FFD700" : "#FF4444";

    ctx.font = "bold 14px monospace";
    ctx.fillStyle = fpsColor;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.fillText(`${this.fps} FPS`, camera.width - 12, 70);

    ctx.font = "12px monospace";
    ctx.fillStyle = "#AAA";
    ctx.fillText(
      `${this.frameMs.toFixed(1)}ms frame / ${this.loopMs.toFixed(1)}ms loop`,
      camera.width - 12,
      88,
    );
    ctx.fillText(
      `${renderDpr.toFixed(2)}x dpr  ${canvas.width}x${canvas.height}`,
      camera.width - 12,
      104,
    );
    // Software canvas raster is the one machine difference big enough to
    // change the answer to "why is this slow", so it gets said out loud.
    ctx.fillStyle = Quality.software ? "#FF4444" : "#AAA";
    ctx.fillText(Quality.status(), camera.width - 12, 120);
    ctx.fillText(Quality.renderer.slice(0, 38), camera.width - 12, 136);
    ctx.fillStyle = "#AAA";
    ctx.fillText(
      Sound.muted
        ? "audio muted"
        : `audio on  ${this.voicesPerSec}/s impact voices`,
      camera.width - 12,
      152,
    );

    // Ring position and gate state — the two numbers behind both the lap
    // counter and the race order
    if (!isMenu && worldTrack.data && worldTrack.data.waypoints) {
      const n = worldTrack.data.waypoints.length;
      ctx.fillStyle = car.passedGate ? "#00FF88" : "#FF8844";
      ctx.fillText(
        `lap ${(trackProgress(car) * 100).toFixed(0)}%  ${n} wps  gate ${car.passedGate ? "armed" : "spent"}`,
        camera.width - 12,
        168,
      );
      ctx.fillStyle = "#AAA";
    }

    // Banner
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, camera.height - 36, camera.width, 36);
    ctx.fillStyle = "#FFD700";
    ctx.font = "14px monospace";

    if (DEBUG) {
      // The grid markers are on the road, not on the screen, so they take the
      // free camera's zoom the same way everything else in world space does.
      ctx.save();
      ctx.scale(viewZoom, viewZoom);
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
      ctx.restore();
    }

    if (WaypointEditor.active) {
      // The pan and zoom half of the line is only true where the free camera
      // is — in a race the view is still the car's.
      const view = freeCameraActive()
        ? `  |  RMB / ARROWS: pan  |  WHEEL: zoom ${viewZoom}x (0: reset)`
        : "";
      this.banner(
        ctx,
        `WAYPOINT EDITOR  |  CLICK: place  |  ON LINE: insert  |  DRAG: move  |  Z: undo  |  P: export${view}  |  ${WaypointEditor.waypoints.length} points`,
      );
    } else {
      this.banner(
        ctx,
        `DEBUG | E: waypoint editor  | T: track editor | C: config | B: debug off`,
      );
    }

    ctx.restore();
  },

  // The key line across the bottom of an editor. It has outgrown 1280px once
  // per hint added to it, and it is centred, so overflowing loses both ends of
  // it at the same time — it shrinks to the window rather than being trimmed
  // by hand every time.
  banner(ctx, text) {
    for (let size = 14; size >= 9; size--) {
      ctx.font = `${size}px monospace`;
      if (ctx.measureText(text).width <= camera.width - 24) break;
    }
    ctx.fillText(text, camera.width / 2, camera.height - 18);
  },
};
