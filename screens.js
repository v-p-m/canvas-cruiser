// ─────────────────────────────────────────────────────────────────────
// Screens — every pixel of UI the game draws onto the canvas: the start
// menu, the in-race HUD, the records screen and the results screen, plus
// the hit-testing that makes their buttons clickable.
//
// Each draw function rebuilds its own hit areas from the same numbers it
// draws with, so the boxes can't drift out of step with the text when the
// window resizes or a row appears.
//
// Layout reads sizes off `camera`, never `canvas`: the canvas backing
// store is scaled by devicePixelRatio, `camera` is in CSS pixels.
// ─────────────────────────────────────────────────────────────────────

// Last known mouse position, used for hover highlighting.
const mousePos = { x: -1, y: -1 };

// Clickable regions, rebuilt every frame by the screen that owns them.
let menuHitAreas = [];
let leaderboardHitAreas = [];
let raceFinishedHitAreas = [];

const hitTest = (areas, x, y) =>
  areas.find((a) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h);

const isHovered = (x, y, w, h) =>
  mousePos.x >= x &&
  mousePos.x <= x + w &&
  mousePos.y >= y &&
  mousePos.y <= y + h;

// One banner, two weights. Every completed lap flashes its time; a lap that
// beat the record keeps the trophy, the gold and twice as long on screen.
// Giving an ordinary lap the full treatment would spend it — a lap comes
// round every 13 seconds or so and the banner sits over the racing line.
const LapBanner = {
  active: false,
  timer: 0,
  time: null,
  best: false,

  BEST_MS: 3000, // ms a personal best holds
  LAP_MS: 1600, // ms an ordinary lap holds
  FADE_MS: 500, // ms of fade at the tail

  show(time, isBest) {
    this.active = true;
    this.time = time;
    this.best = isBest;
    this.timer = isBest ? this.BEST_MS : this.LAP_MS;
  },

  update(dt) {
    if (!this.active) return;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.active = false;
    }
  },

  draw(ctx) {
    if (!this.active) return;

    const text = this.best ? `🏆 NEW BEST: ${this.time}s` : `LAP: ${this.time}s`;
    const cx = camera.width / 2;
    const y = 120;

    ctx.save();
    ctx.globalAlpha = Math.min(1, this.timer / this.FADE_MS);

    ctx.fillStyle = this.best ? "#FFD700" : "#FFFFFF";
    ctx.font = this.best ? "bold 32px 'Courier New'" : "bold 24px 'Courier New'";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, cx, y);

    // Underline — part of what makes a best read as more than a lap time
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

// ─────────────────────────────────────────
// Start menu
// ─────────────────────────────────────────
function drawStartMenu() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
  ctx.fillRect(0, 0, camera.width, camera.height);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "center";
  ctx.fillStyle = "#FFD700";
  ctx.font = "bold 50px 'Courier New'";
  ctx.fillText("🏎️ CANVAS CRUISER 🏎️", camera.width / 2, 150);
  ctx.font = "bold 12px 'Courier New'";
  ctx.fillText("v" + GAME_VERSION, camera.width / 2, 200);

  // Mode selector
  const cx = camera.width / 2;
  const modesStartY = 260;

  menuHitAreas = [];

  ctx.font = "22px 'Courier New'";
  MODES.forEach((mode, i) => {
    const y = modesStartY + i * 52;
    const selected = i === selectedMode;

    const boxW = 300;
    const boxH = 40;
    const boxX = cx - boxW / 2;
    const boxY = y - 28;
    const hovered = isHovered(boxX, boxY, boxW, boxH);

    menuHitAreas.push({
      x: boxX,
      y: boxY,
      w: boxW,
      h: boxH,
      action: "mode",
      index: i,
    });

    // Highlight box
    ctx.fillStyle = selected
      ? "#FFD700"
      : hovered
        ? "rgba(255,215,0,0.25)"
        : "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 8);
    ctx.fill();

    ctx.fillStyle = selected ? "#000" : hovered ? "#FFD700" : "#AAA";
    ctx.fillText(selected ? `▶  ${mode.label}` : mode.label, cx, y);
  });

  // Controls — clickable actions first, then the keyboard-only hints below a
  // gap, so the two kinds never interleave. ESC swaps groups: it resumes a
  // paused race (clickable) but is only an in-race reminder otherwise.
  const controlsY = modesStartY + MODES.length * 52 + 40;
  const lineSpacing = 32;
  const groupGap = 18;
  const gutter = 20;
  ctx.font = "16px 'Courier New'";

  const actions = [
    { key: "ENTER", action: "Start", id: "start" },
    { key: "K", action: "Key bindings", id: "keybindings" },
    { key: "Q", action: "Records", id: "leaderboard" },
    { key: "M", action: Sound.muted ? "Sound: OFF" : "Sound: ON", id: "mute" },
    { key: "B", action: "DEBUG", id: "debug" },
  ];
  if (racePaused) {
    actions.push({ key: "ESC", action: "Resume race", id: "resume" });
  }

  const hints = [
    { key: "UP / DOWN", action: "Select mode" },
    { key: "LEFT / RIGHT", action: "Steer" },
    { key: "R", action: "Reset" },
  ];
  if (!racePaused) hints.push({ key: "ESC", action: "Back to Menu" });

  const controls = [...actions, ...hints.map((h) => ({ ...h, hint: true }))];

  controls.forEach((item, i) => {
    const y = controlsY + i * lineSpacing + (item.hint ? groupGap : 0);

    // Hit box spans the whole "KEY : Action" line
    const keyW = ctx.measureText(item.key).width;
    const actionW = ctx.measureText(item.action).width;
    const rowX = cx - gutter - keyW - 8;
    const rowW = keyW + actionW + 2 * gutter + 16;
    const rowY = y - 16;
    const rowH = lineSpacing - 8;
    const hovered = item.id && isHovered(rowX, rowY, rowW, rowH);

    if (item.id) {
      menuHitAreas.push({
        x: rowX,
        y: rowY,
        w: rowW,
        h: rowH,
        action: item.id,
      });
    }

    if (hovered) {
      ctx.fillStyle = "rgba(255,215,0,0.12)";
      ctx.beginPath();
      ctx.roundRect(rowX, rowY, rowW, rowH, 6);
      ctx.fill();
    }

    const keyColor = hovered ? "#FFD700" : item.hint ? "#666" : "#888";
    const textColor = hovered ? "#FFD700" : item.hint ? "#888" : "white";

    ctx.textAlign = "right";
    ctx.fillStyle = keyColor;
    ctx.fillText(item.key, cx - gutter, y);
    ctx.textAlign = "center";
    ctx.fillStyle = textColor;
    ctx.fillText(":", cx, y);
    ctx.textAlign = "left";
    ctx.fillStyle = textColor;
    ctx.fillText(item.action, cx + gutter, y);
  });

  canvas.style.cursor = menuHitAreas.some((a) =>
    isHovered(a.x, a.y, a.w, a.h),
  )
    ? "pointer"
    : "default";
}

function handleMenuClick(x, y) {
  const hit = hitTest(menuHitAreas, x, y);
  if (!hit) return;

  switch (hit.action) {
    case "mode":
      selectedMode = hit.index;
      startSelectedMode();
      break;
    case "start":
      startSelectedMode();
      break;
    case "keybindings":
      openKeyBindings();
      break;
    case "leaderboard":
      openLeaderboardFromMenu();
      break;
    case "mute":
      Sound.toggleMute();
      break;
    case "debug":
      toggleDebug();
      break;
    case "resume":
      resumePausedRace();
      break;
  }
}

// ─────────────────────────────────────────
// In-race HUD
// ─────────────────────────────────────────
const HUD_GAP = 20; // px between readouts in the top bar

function drawUI() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(0, 0, camera.width, 60);
  ctx.fillStyle = "#00FF00";
  ctx.font = "bold 20px 'Courier New'";
  ctx.textAlign = "left";

  const lapCount = raceLapTarget();
  const lapLabel = !hasStarted
    ? "Let's compete!"
    : lapCount
      ? `LAP ${laps} / ${lapCount}`
      : `LAP ${laps}`;

  ctx.fillText(lapLabel, 20, 35);

  // Position, next to the lap counter. Free Drive has nothing to place.
  let leftBlockEnd = 20 + ctx.measureText(lapLabel).width;
  if (lapCount) {
    const pos = playerPosition();
    const posText = `P${pos}/${opponents.length + 1}`;
    ctx.fillStyle = pos === 1 ? "#FFD700" : "#00FF00";
    ctx.fillText(posText, 20 + 190, 35);
    ctx.fillStyle = "#00FF00";
    leftBlockEnd = 20 + 190 + ctx.measureText(posText).width;
  }

  ctx.textAlign = "right";
  ctx.fillText(
    `${Math.round(Math.abs(car.speed) * 10)} KM/H`,
    camera.width - 20,
    35,
  );
  ctx.textAlign = "center";
  if (hasStarted) {
    // Past the flag the running clock is timing a lap that will never be
    // completed, so it gives way to the total the player actually earned.
    let timeText;
    if (finishHoldTimer > 0) {
      timeText = `TOTAL: ${totalRaceTime}s`;
    } else {
      currentLapTime = ((performance.now() - lapStartTime) / 1000).toFixed(2);
      timeText = `TIME: ${currentLapTime}s`;
    }
    ctx.fillText(timeText, camera.width / 2, 35);

    // The last lap sits immediately left of the running clock: the two are
    // read against each other, so they belong side by side rather than at
    // opposite ends of the bar. Dimmer than the live time, gold when that lap
    // is the record. Narrow windows drop it instead of overlapping the lap
    // and position block — those two are load-bearing, this is reference.
    if (lastLapTime !== null) {
      const lastText = `LAST: ${lastLapTime}s`;
      const right =
        camera.width / 2 - ctx.measureText(timeText).width / 2 - HUD_GAP;
      if (right - ctx.measureText(lastText).width > leftBlockEnd + HUD_GAP) {
        ctx.textAlign = "right";
        ctx.fillStyle =
          parseFloat(lastLapTime) === highScores[0] ? "#FFD700" : "#00AA44";
        ctx.fillText(lastText, right, 35);
        ctx.fillStyle = "#00FF00";
        ctx.textAlign = "center";
      }
    }
  }

  drawMinimap();
}

// ─────────────────────────────────────────
// Minimap
//
// The whole track is 2048×1600 and the camera shows a fraction of it, so
// without this you corner blind. The baked track canvas is already the
// picture we want — scaled down it costs one drawImage — with a dot per
// car and a rectangle marking the view.
// ─────────────────────────────────────────
const MINIMAP_MAX = 190; // px, longest edge
const MINIMAP_MARGIN = 16; // px from the screen corner

function drawMinimap() {
  if (!worldTrack.bakedCanvas || TrackEditor.active) return;

  const src = worldTrack.bakedCanvas;
  const scale = MINIMAP_MAX / Math.max(src.width, src.height);
  const w = src.width * scale;
  const h = src.height * scale;
  const x = camera.width - w - MINIMAP_MARGIN;
  const y = camera.height - h - MINIMAP_MARGIN;

  ctx.save();

  // The camera runs past the world edges near the corners of the map, so
  // everything inside the frame is clipped to it — otherwise the viewport
  // rectangle trails off across the track.
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.globalAlpha = 0.75;
  ctx.drawImage(src, x, y, w, h);
  ctx.globalAlpha = 1;

  // Viewport rectangle
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(
    x + camera.x * scale,
    y + camera.y * scale,
    camera.width * scale,
    camera.height * scale,
  );

  const dot = (wx, wy, color, r) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x + wx * scale, y + wy * scale, r, 0, Math.PI * 2);
    ctx.fill();
  };

  opponents.forEach((ai) => dot(ai.x, ai.y, ai.color, 2.5));

  // Player last and ringed, so it stays findable in a pack
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  dot(car.x, car.y, PLAYER_COLOR, 3.5);
  ctx.beginPath();
  ctx.arc(x + car.x * scale, y + car.y * scale, 5, 0, Math.PI * 2);
  ctx.stroke();

  ctx.restore();

  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
}

// ─────────────────────────────────────────
// Records
// ─────────────────────────────────────────
function drawLeaderboard() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
  ctx.fillRect(0, 0, camera.width, camera.height);
  ctx.textAlign = "center";

  const colX = [camera.width * 0.2, camera.width * 0.5, camera.width * 0.8];
  const columns = [
    {
      title: "🏁 TOP 5 LAPS 🏁",
      entries: Array.isArray(highScores) ? highScores : [],
    },
    {
      title: "🏆 TOP 3 · 5-LAP 🏆",
      entries: Array.isArray(bestTotalTimes.race5) ? bestTotalTimes.race5 : [],
    },
    {
      title: "🏆 TOP 3 · 10-LAP 🏆",
      entries: Array.isArray(bestTotalTimes.race10) ? bestTotalTimes.race10 : [],
    },
  ];

  columns.forEach((col, ci) => {
    const x = colX[ci];
    ctx.fillStyle = "#FFD700";
    ctx.font = "bold 26px 'Courier New'";
    ctx.fillText(col.title, x, 150);

    ctx.fillStyle = "white";
    ctx.font = "22px 'Courier New'";
    if (col.entries.length === 0) {
      ctx.fillStyle = "#888";
      ctx.fillText("— no times yet —", x, 220);
    } else {
      col.entries.forEach((score, i) =>
        ctx.fillText(`${i + 1}. ${score}s`, x, 220 + i * 36),
      );
    }
  });

  // Footer — both lines are clickable buttons
  const cx = camera.width / 2;
  ctx.font = "18px 'Courier New'";

  leaderboardHitAreas = [];
  const buttons = [
    {
      action: "clear",
      text: "C — Clear records",
      y: 420,
      color: "#AAA",
      hoverColor: "#FF6666",
      hoverFill: "rgba(255,68,68,0.15)",
    },
    {
      action: "back",
      text:
        leaderboardFrom === "menu"
          ? "ESC / Q — Back to menu"
          : "ESC / Q — Back to race",
      y: 460,
      color: "#AAA",
      hoverColor: "#FFD700",
      hoverFill: "rgba(255,215,0,0.12)",
    },
  ];

  buttons.forEach((btn) => {
    const w = ctx.measureText(btn.text).width + 32;
    const h = 28;
    const x = cx - w / 2;
    const y = btn.y - 20;
    const hovered = isHovered(x, y, w, h);

    leaderboardHitAreas.push({ action: btn.action, x, y, w, h });

    if (hovered) {
      ctx.fillStyle = btn.hoverFill;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 6);
      ctx.fill();
    }
    ctx.fillStyle = hovered ? btn.hoverColor : btn.color;
    ctx.fillText(btn.text, cx, btn.y);
  });

  canvas.style.cursor = leaderboardHitAreas.some((a) =>
    isHovered(a.x, a.y, a.w, a.h),
  )
    ? "pointer"
    : "default";
}

function handleLeaderboardClick(x, y) {
  const hit = hitTest(leaderboardHitAreas, x, y);
  if (!hit) return;

  if (hit.action === "back") closeLeaderboard();
  else if (hit.action === "clear") clearHighScores();
}

// ─────────────────────────────────────────
// Results
// ─────────────────────────────────────────
function drawRaceFinished() {
  ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
  ctx.fillRect(0, 0, camera.width, camera.height);

  const cx = camera.width / 2;

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = playerFinishPosition === 1 ? "#FFD700" : "#FFFFFF";
  ctx.font = "bold 44px 'Courier New'";
  ctx.fillText(
    playerFinishPosition === 1 ? "🏆 YOU WIN 🏆" : "🏁 RACE FINISHED 🏁",
    cx,
    100,
  );

  ctx.fillStyle = "#AAA";
  ctx.font = "20px 'Courier New'";
  ctx.fillText(
    `${raceLapTarget()} laps · finished P${playerFinishPosition} of ${finishOrder.length}`,
    cx,
    138,
  );

  // Classification table
  const rowH = 34;
  const tableTop = 180;
  const colName = cx - 210;
  const colTime = cx + 230;

  ctx.font = "18px 'Courier New'";
  ctx.fillStyle = "#666";
  ctx.textAlign = "left";
  ctx.fillText("POS  DRIVER", colName, tableTop - 12);
  ctx.textAlign = "right";
  ctx.fillText("TOTAL", colTime, tableTop - 12);

  finishOrder.forEach((entry, i) => {
    const y = tableTop + i * rowH + 18;

    if (entry.isPlayer) {
      ctx.fillStyle = "rgba(255,215,0,0.12)";
      ctx.beginPath();
      ctx.roundRect(colName - 14, y - 20, colTime - colName + 28, rowH - 4, 6);
      ctx.fill();
    }

    ctx.font = entry.isPlayer ? "bold 20px 'Courier New'" : "20px 'Courier New'";
    ctx.fillStyle = entry.isPlayer ? "#FFD700" : "#DDD";
    ctx.textAlign = "left";
    ctx.fillText(`${entry.position}.`, colName, y);

    // Colour chip, so the results read against the cars on track
    ctx.fillStyle = entry.color;
    ctx.fillRect(colName + 44, y - 13, 14, 14);

    ctx.fillStyle = entry.isPlayer ? "#FFD700" : "#DDD";
    ctx.fillText(entry.name, colName + 68, y);

    // Cars still circulating when the player took the flag have no total,
    // so they show how far they had got instead of an invented time.
    ctx.textAlign = "right";
    ctx.fillStyle = entry.dnf ? "#777" : entry.isPlayer ? "#FFD700" : "#DDD";
    ctx.fillText(
      entry.dnf ? `lap ${entry.laps}/${raceLapTarget()}` : `${entry.time}s`,
      colTime,
      y,
    );
  });

  let y = tableTop + finishOrder.length * rowH + 40;

  if (isNewBestTotal) {
    ctx.textAlign = "center";
    ctx.fillStyle = "#FFD700";
    ctx.font = "bold 22px 'Courier New'";
    ctx.fillText("🏆 New Best Total!", cx, y);
    y += 38;
  }

  // Footer — both lines are clickable buttons
  ctx.textAlign = "center";
  ctx.font = "18px 'Courier New'";

  raceFinishedHitAreas = [];
  const buttons = [
    { action: "again", text: "R  — Race again", y, hoverColor: "#FFD700" },
    { action: "menu", text: "ESC — Main menu", y: y + 34, hoverColor: "#FFD700" },
  ];

  buttons.forEach((btn) => {
    const w = ctx.measureText(btn.text).width + 32;
    const h = 28;
    const bx = cx - w / 2;
    const by = btn.y - 20;
    const hovered = isHovered(bx, by, w, h);

    raceFinishedHitAreas.push({ action: btn.action, x: bx, y: by, w, h });

    if (hovered) {
      ctx.fillStyle = "rgba(255,215,0,0.12)";
      ctx.beginPath();
      ctx.roundRect(bx, by, w, h, 6);
      ctx.fill();
    }
    ctx.fillStyle = hovered ? btn.hoverColor : "#AAA";
    ctx.fillText(btn.text, cx, btn.y);
  });

  canvas.style.cursor = raceFinishedHitAreas.some((a) =>
    isHovered(a.x, a.y, a.w, a.h),
  )
    ? "pointer"
    : "default";
}

function handleRaceFinishedClick(x, y) {
  const hit = hitTest(raceFinishedHitAreas, x, y);
  if (!hit) return;

  if (hit.action === "again") restartRace();
  else if (hit.action === "menu") exitRaceToMenu();
}
