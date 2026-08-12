// The in-race HUD and minimap, ported off screens.js's drawUI / drawMinimap
// (screens.js:651-785) onto the UI overlay canvas. Same trade-off as the
// menu (see phaser/menuScreen.js's header): the drawing is verbatim where the
// legacy globals it read have a Phaser-side equivalent.
//
// The legacy HUD reads game.js's own module-level race state (laps,
// hasStarted, lastLapTime, ...) because updateLapCounter's isPlayer branch
// writes it there every frame. RaceLaps.update() deliberately has no such
// branch (see phaser/raceLaps.js's header) — every car, the player included,
// only ever gets written to on its own entity. So this file reads
// scene.player.entity directly instead, and it is the one place on this page
// that is allowed to treat the player as special, because a HUD showing one
// car's numbers is what a HUD *is*.
//
// Not carried over yet, and each is a separate later step, not an oversight:
// - The gold "beat the record" treatment on LAP_BEST and the LAST readout —
//   there is no loaded highScores table on this page until step 8 decides
//   how records survive the physics change.
// - The roll-out hold between the flag and the results screen
//   (finishHoldTimer) — it exists to delay a results screen that isn't
//   ported yet, so TOTAL simply appears the instant the player finishes.
const HUD_GAP = 20; // px between readouts in the top bar, same as screens.js

function formatTime(seconds) {
  return Number(seconds).toFixed(3);
}

// One banner, two weights — ported off screens.js's LapBanner. `isBest` is
// always false for now (see the file header); the shape stays so step 8 only
// has to change the call site, not this object.
const HudBanner = {
  active: false,
  timer: 0,
  time: null,
  best: false,

  BEST_MS: 3000,
  LAP_MS: 1600,
  FADE_MS: 500,

  show(time, isBest) {
    this.active = true;
    this.time = time;
    this.best = isBest;
    this.timer = isBest ? this.BEST_MS : this.LAP_MS;
  },

  update(dtMs) {
    if (!this.active) return;
    this.timer -= dtMs;
    if (this.timer <= 0) this.active = false;
  },

  draw() {
    if (!this.active) return;
    const ctx = UI.ctx;

    const time = formatTime(this.time);
    const text = this.best ? `🏆 NEW BEST: ${time}s` : `LAP: ${time}s`;
    const cx = UI.width / 2;
    const y = 120;

    ctx.save();
    ctx.globalAlpha = Math.min(1, this.timer / this.FADE_MS);

    ctx.fillStyle = this.best ? "#FFD700" : "#FFFFFF";
    ctx.font = this.best ? "bold 32px 'Courier New'" : "bold 24px 'Courier New'";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, y);

    if (this.best) {
      const textWidth = ctx.measureText(text).width;
      ctx.strokeStyle = "#FFD700";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx - textWidth / 2, y + 22);
      ctx.lineTo(cx + textWidth / 2, y + 22);
      ctx.stroke();
    }

    ctx.restore();
  },
};

const MINIMAP_MAX = 190; // px, longest edge — same as screens.js
const MINIMAP_MARGIN = 16; // px from the screen corner

const HudScreen = {
  // `scene` is the RaceScene. `standings` is passed in rather than recomputed
  // here — the scene already sorts the field once a frame for its own debug
  // report, and position is cheap to read off the same pass. `now` is the
  // same clock RaceLaps.update() timed this frame's laps on (Phaser's loop
  // time, not performance.now()), so a running lap clock and a completed
  // lap's time agree with each other under a hand-stepped headless run too.
  draw(scene, standings, now) {
    const ctx = UI.ctx;
    const p = scene.player.entity;
    const target = RaceLaps.target;
    const hasStarted = p.laps > 0;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, UI.width, 60);
    ctx.fillStyle = "#00FF00";
    ctx.font = "bold 20px 'Courier New'";
    ctx.textAlign = "left";

    const shownLaps = target ? Math.min(p.laps, target) : p.laps;
    const lapLabel = !hasStarted
      ? "Let's compete!"
      : target
        ? `LAP ${shownLaps} / ${target}`
        : `LAP ${shownLaps}`;

    ctx.fillText(lapLabel, 20, 35);

    let leftBlockEnd = 20 + ctx.measureText(lapLabel).width;
    if (target) {
      const pos = standings.find((e) => e.isPlayer).position;
      const posText = `P${pos}/${scene.cars.length}`;
      ctx.fillStyle = pos === 1 ? "#FFD700" : "#00FF00";
      ctx.fillText(posText, 20 + 190, 35);
      ctx.fillStyle = "#00FF00";
      leftBlockEnd = 20 + 190 + ctx.measureText(posText).width;
    }

    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(Math.abs(p.speed) * 10)} KM/H`, UI.width - 20, 35);
    ctx.textAlign = "center";
    if (hasStarted) {
      let timeText;
      if (p.finished) {
        timeText = `TOTAL: ${formatTime(p.finishTime)}s`;
      } else {
        const currentLapTime = (now - p.lapStart) / 1000;
        timeText = `TIME: ${formatTime(currentLapTime)}s`;
      }
      ctx.fillText(timeText, UI.width / 2, 35);

      if (p.lastLapTime !== null) {
        const lastText = `LAST: ${formatTime(p.lastLapTime)}s`;
        const right = UI.width / 2 - ctx.measureText(timeText).width / 2 - HUD_GAP;
        if (right - ctx.measureText(lastText).width > leftBlockEnd + HUD_GAP) {
          ctx.textAlign = "right";
          ctx.fillStyle = "#00AA44"; // gold-if-record awaits step 8
          ctx.fillText(lastText, right, 35);
          ctx.fillStyle = "#00FF00";
          ctx.textAlign = "center";
        }
      }
    }

    this.drawMinimap(scene);
    HudBanner.draw();
  },

  drawMinimap(scene) {
    const src = scene.world.bakedCanvas;
    if (!src) return;
    const ctx = UI.ctx;

    const scale = MINIMAP_MAX / Math.max(src.width, src.height);
    const w = src.width * scale;
    const h = src.height * scale;
    const x = UI.width - w - MINIMAP_MARGIN;
    const y = UI.height - h - MINIMAP_MARGIN;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    ctx.globalAlpha = 0.75;
    ctx.drawImage(src, x, y, w, h);
    ctx.globalAlpha = 1;

    const cam = scene.cameras.main;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      x + cam.scrollX * scale,
      y + cam.scrollY * scale,
      cam.width * scale,
      cam.height * scale,
    );

    const dot = (wx, wy, color, r) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x + wx * scale, y + wy * scale, r, 0, Math.PI * 2);
      ctx.fill();
    };

    // Every entry but the player, then the player last and ringed, so it
    // stays findable in a pack — same order screens.js draws in.
    scene.entries.forEach((e) => {
      if (!e.isPlayer) dot(e.entity.x, e.entity.y, e.color, 2.5);
    });

    const player = scene.entries[0];
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    dot(player.entity.x, player.entity.y, player.color, 3.5);
    ctx.beginPath();
    ctx.arc(x + player.entity.x * scale, y + player.entity.y * scale, 5, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  },
};
