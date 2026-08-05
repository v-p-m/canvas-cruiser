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
let creditsHitAreas = [];
let creditsPanel = null; // credits modal frame, for click-away dismissal

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
  // The credits popup takes the input; highlighting rows under it would light
  // them up through the dim as if they were still live.
  const live = !isCredits;

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
    const hovered = live && isHovered(boxX, boxY, boxW, boxH);

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
    { key: "I", action: "Credits", id: "credits" },
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
    const hovered = live && item.id && isHovered(rowX, rowY, rowW, rowH);

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
    case "credits":
      openCredits();
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
// Credits
// ─────────────────────────────────────────

// The roll lives in credits.json so adding a tester is a data edit, not a code
// edit. This copy is the fallback the game shows if that file is missing or
// unparseable — the same "bad data is dropped, never trusted" rule the
// localStorage readers in game.js follow.
const CREDITS_FALLBACK = {
  sections: [
    { role: "Created by", names: ["v-p-m"] },
    { role: "Code assistance", names: ["Claude (Anthropic)"] },
  ],
  footer: "Pure HTML5 Canvas · no engine, no dependencies",
};
let Credits = CREDITS_FALLBACK;

// Never throws and never rejects: the credits are decoration, and initGame()
// treats anything thrown out of startup as a fatal "failed to load".
async function loadCredits() {
  try {
    const res = await fetch("credits.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const sections = (Array.isArray(data.sections) ? data.sections : [])
      .filter((s) => s && typeof s.role === "string" && Array.isArray(s.names))
      .map((s) => ({
        role: s.role,
        names: s.names.filter((n) => typeof n === "string" && n.trim() !== ""),
      }))
      // A section nobody has been added to yet is a placeholder, not a blank
      // heading to draw — credits.json ships with two of them.
      .filter((s) => s.names.length > 0);

    if (sections.length === 0) return; // keep the fallback rather than draw nothing
    Credits = {
      sections,
      footer:
        typeof data.footer === "string" ? data.footer : CREDITS_FALLBACK.footer,
    };
  } catch (err) {
    console.warn("credits.json unavailable, using the built-in roll:", err);
  }
}

const CREDITS_PANEL_W = 480; // px, before the small-window clamp
const CREDITS_ROLE_H = 22; // px per role heading
const CREDITS_NAME_H = 28; // px per name line
const CREDITS_SECTION_GAP = 20; // px between sections
const CREDITS_MARGIN = 30; // px of viewport left around the panel
const CREDITS_HEAD_H = 96; // px of title block, fixed above the scroll
const CREDITS_FOOT_H = 96; // px of footer + close button, fixed below it
const CREDITS_LEAD = 20; // px above the first line, inside the scroll window

let creditsScroll = 0; // px the name list is scrolled down by

function scrollCredits(dy) {
  creditsScroll += dy;
}

// Breaks a section's names into lines that fit `maxW`, keeping each name
// whole — wrapping mid-name would read as two people. Assumes the caller has
// already set the name font on ctx.
function wrapNames(names, maxW) {
  const lines = [];
  let line = "";
  names.forEach((name, i) => {
    const piece = i < names.length - 1 ? `${name},` : name;
    const merged = line ? `${line} ${piece}` : piece;
    if (line && ctx.measureText(merged).width > maxW) {
      lines.push(line);
      line = piece;
    } else {
      line = merged;
    }
  });
  if (line) lines.push(line);
  return lines;
}

// A modal, not a screen: the menu keeps drawing underneath and the backdrop
// only dims it, so it reads as a popup over the game rather than a page the
// menu navigated away to.
function drawCredits() {
  creditsHitAreas = [];

  ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
  ctx.fillRect(0, 0, camera.width, camera.height);

  const w = Math.min(CREDITS_PANEL_W, camera.width - 2 * CREDITS_MARGIN);
  const cx = camera.width / 2;

  // Lay the roll out before the panel is sized: how many lines a section takes
  // depends on the wrap, and the wrap depends on the width, so the height can
  // only be known once. Rebuilt every frame like every other hit area here —
  // this is a static modal, and a stale layout is worse than a few measureText
  // calls.
  const textW = w - 48;
  ctx.font = "bold 20px 'Courier New'";
  const lines = [];
  Credits.sections.forEach((section, i) => {
    if (i > 0) lines.push({ kind: "gap", h: CREDITS_SECTION_GAP });
    lines.push({ kind: "role", text: section.role.toUpperCase(), h: CREDITS_ROLE_H });
    wrapNames(section.names, textW).forEach((text) =>
      lines.push({ kind: "name", text, h: CREDITS_NAME_H }),
    );
  });

  // The scroll window opens CREDITS_LEAD above the first baseline, so the top
  // role's ascenders aren't shaved off; that lead is part of the content, and
  // both the panel height and the scroll range have to count it or the last
  // line gets clipped with nothing to scroll to.
  const contentH = lines.reduce((sum, l) => sum + l.h, CREDITS_LEAD);
  const fullH = CREDITS_HEAD_H + contentH + CREDITS_FOOT_H;
  const h = Math.min(fullH, camera.height - 2 * CREDITS_MARGIN);
  const x = (camera.width - w) / 2;
  const y = (camera.height - h) / 2;
  creditsPanel = { x, y, w, h };

  const bodyTop = y + CREDITS_HEAD_H - CREDITS_LEAD;
  const bodyBottom = y + h - CREDITS_FOOT_H;
  const viewH = Math.max(0, bodyBottom - bodyTop);

  // Only the name list scrolls; the title and the way out stay put.
  const maxScroll = Math.max(0, contentH - viewH);
  creditsScroll = Math.max(0, Math.min(creditsScroll, maxScroll));

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.7)";
  ctx.shadowBlur = 30;
  ctx.fillStyle = "rgba(14, 14, 20, 0.97)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "#FFD700";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 14);
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#FFD700";
  ctx.font = "bold 30px 'Courier New'";
  ctx.fillText("CREDITS", cx, y + 52);

  ctx.strokeStyle = "rgba(255,215,0,0.35)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 40, y + 74);
  ctx.lineTo(x + w - 40, y + 74);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(x + 1, bodyTop, w - 2, viewH);
  ctx.clip();

  let ty = bodyTop + CREDITS_LEAD - creditsScroll;
  lines.forEach((line) => {
    if (line.kind === "role") {
      ctx.fillStyle = "#777";
      ctx.font = "14px 'Courier New'";
      ctx.fillText(line.text, cx, ty);
    } else if (line.kind === "name") {
      ctx.fillStyle = "#FFF";
      ctx.font = "bold 20px 'Courier New'";
      ctx.fillText(line.text, cx, ty + 18);
    }
    ty += line.h;
  });
  ctx.restore();

  // Fade the clipped edges rather than slicing a name in half, and only on the
  // side there is actually more roll to reach.
  const fade = (top) => {
    const gy = top ? bodyTop : bodyBottom;
    const g = ctx.createLinearGradient(0, gy, 0, gy + (top ? 22 : -22));
    g.addColorStop(0, "rgba(14, 14, 20, 0.97)");
    g.addColorStop(1, "rgba(14, 14, 20, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(x + 1, top ? gy : gy - 22, w - 2, 22);
  };
  if (creditsScroll > 0) fade(true);
  if (creditsScroll < maxScroll) fade(false);

  if (maxScroll > 0) {
    const trackH = viewH - 8;
    const thumbH = Math.max(24, trackH * (viewH / contentH));
    const thumbY = bodyTop + 4 + (trackH - thumbH) * (creditsScroll / maxScroll);
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.fillRect(x + w - 12, bodyTop + 4, 4, trackH);
    ctx.fillStyle = "rgba(255,215,0,0.45)";
    ctx.fillRect(x + w - 12, thumbY, 4, thumbH);
  }

  const footTop = y + h - CREDITS_FOOT_H;
  ctx.fillStyle = "#666";
  ctx.font = "14px 'Courier New'";
  ctx.fillText(Credits.footer, cx, footTop + 26);
  ctx.fillText("v" + GAME_VERSION, cx, footTop + 46);

  // Corner ×, the affordance a popup is expected to carry
  const closeSize = 26;
  const closeX = x + w - closeSize - 14;
  const closeY = y + 14;
  const closeHot = isHovered(closeX, closeY, closeSize, closeSize);
  creditsHitAreas.push({
    x: closeX,
    y: closeY,
    w: closeSize,
    h: closeSize,
    action: "close",
  });

  if (closeHot) {
    ctx.fillStyle = "rgba(255,215,0,0.15)";
    ctx.beginPath();
    ctx.roundRect(closeX, closeY, closeSize, closeSize, 6);
    ctx.fill();
  }
  ctx.fillStyle = closeHot ? "#FFD700" : "#888";
  ctx.font = "bold 20px 'Courier New'";
  ctx.textBaseline = "middle";
  ctx.fillText("×", closeX + closeSize / 2, closeY + closeSize / 2 + 1);
  ctx.textBaseline = "alphabetic";

  // Footer button, worded like every other way out of a screen
  const label = "ESC — Close";
  ctx.font = "18px 'Courier New'";
  const bw = ctx.measureText(label).width + 32;
  const bh = 30;
  const bx = cx - bw / 2;
  const by = y + h - 48;
  const bHot = isHovered(bx, by, bw, bh);
  creditsHitAreas.push({ x: bx, y: by, w: bw, h: bh, action: "close" });

  if (bHot) {
    ctx.fillStyle = "rgba(255,215,0,0.12)";
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6);
    ctx.fill();
  }
  ctx.fillStyle = bHot ? "#FFD700" : "#AAA";
  ctx.fillText(label, cx, by + 21);

  canvas.style.cursor = creditsHitAreas.some((a) =>
    isHovered(a.x, a.y, a.w, a.h),
  )
    ? "pointer"
    : "default";
}

function handleCreditsClick(x, y) {
  const hit = hitTest(creditsHitAreas, x, y);
  if (hit) {
    if (hit.action === "close") closeCredits();
    return;
  }
  // Click-away dismisses; a click that lands on the panel itself is swallowed,
  // or dragging a selection across the names would close the popup.
  const p = creditsPanel;
  const onPanel =
    p && x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
  if (!onPanel) closeCredits();
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
