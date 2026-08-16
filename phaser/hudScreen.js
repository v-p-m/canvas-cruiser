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
// Not carried over yet, and a separate later step, not an oversight: the gold
// "beat the record" treatment on LAP_BEST and the LAST readout — there is no
// loaded highScores table on this page until step 8 decides how records
// survive the physics change. TOTAL does appear the instant the player
// finishes, and the HUD keeps drawing through RaceScene's finish hold, which
// is the point of the hold — the last lap and the total get their moment
// before the results cover them.
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

    this.drawDamage(p, now);
    this.drawMinimap(scene);
    HudBanner.draw();
  },

  // The condition of both wings, for as long as either is less than perfect.
  //
  // The artwork already says most of it — the plane narrows, then goes
  // (WING_ROWS in carSprites.js) — but at speed the player is reading the road
  // a car-length ahead, not their own nose, and the handling change lands in
  // the next corner rather than at the moment of the hit. This is the one place
  // that names it, and it stays up: a warning that faded would be a warning
  // about a thing that has not gone away.
  //
  // The bar is the part that earns its pixels. Wings carry condition, so a hit
  // that does not break one still moves the car closer to losing it, and that
  // has to be something the driver can *see* rather than a number the physics
  // keeps to itself — a wing failing on a light tap because of hidden wear is
  // the same unfairness as a random roll. It also gives the last stint of a
  // race a thing to manage: a bar at a quarter is a reason to leave more room.
  //
  // Under the top bar rather than in it. The bar's four readouts are all
  // numbers that are always there, and slotting an intermittent one among them
  // would move them; this hangs below and takes its own space, in the corner
  // the eye already goes to for the speed.
  drawDamage(p, now) {
    if (!Damage.hurt(p)) return;
    const ctx = UI.ctx;
    const rows = [];
    if (p.wings.front < 1) rows.push(["FRONT WING", p.wings.front]);
    if (p.wings.rear < 1) rows.push(["REAR WING", p.wings.rear]);

    // A slow blink for the first couple of seconds after a wing cracks or
    // breaks, then steady. Both happen inside a collision the player is already
    // busy surviving, and something that appears without moving is something
    // that gets noticed a corner too late.
    const lit = p.wingFlash <= 0 || Math.floor(now / 140) % 2 === 0;

    ctx.save();
    ctx.font = "bold 14px 'Courier New'";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    const BAR_W = 46;
    const right = UI.width - 20;
    rows.forEach(([label, hp], i) => {
      const gone = hp <= 0;
      const y = 78 + i * 22;
      const textW = ctx.measureText(label).width;
      const w = textW + BAR_W + 26;

      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(right - w + 6, y - 10, w, 20);

      // Amber while it is still attached, red once it is not — the colour is
      // the state, so the two never have to be told apart by reading.
      const strong = gone ? "#FF4433" : "#FFAA22";
      ctx.fillStyle = lit ? strong : gone ? "#7a1d15" : "#7a5410";
      ctx.fillText(label, right - BAR_W - 10, y);

      const bx = right - BAR_W;
      ctx.fillStyle = "rgba(255,255,255,0.16)";
      ctx.fillRect(bx, y - 5, BAR_W, 10);
      if (gone) {
        // Nothing left to fill, so the ✕ carries it — a mark that means "gone"
        // is legible without being read, which the words beside it are not
        // while the player is in the middle of a corner.
        ctx.textAlign = "center";
        ctx.fillStyle = lit ? strong : "#7a1d15";
        ctx.fillText("✕", bx + BAR_W / 2, y);
        ctx.textAlign = "right";
      } else {
        ctx.fillStyle = strong;
        ctx.fillRect(bx, y - 5, BAR_W * hp, 10);
      }
    });
    ctx.restore();
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

    // worldView, not scrollX/Y + width/height: those are the camera's scroll
    // before its zoom and its size in *backing-store* pixels, so under
    // RenderScale's setZoom(renderDpr) the box would sit off-centre and be
    // renderDpr times too big. worldView is the span actually on screen.
    const view = scene.cameras.main.worldView;
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(
      x + view.x * scale,
      y + view.y * scale,
      view.width * scale,
      view.height * scale,
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
