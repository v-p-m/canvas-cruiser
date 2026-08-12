// The start menu, ported off screens.js's drawStartMenu / drawSelectorRow /
// drawStartButton / handleMenuClick (screens.js:94-374) onto the UI overlay
// canvas (phaser/uiCanvas.js). The drawing is verbatim where the legacy
// globals it read have a Phaser-side equivalent; where they don't yet (no
// pause screen, no DEBUG tools on this page) the row is either dropped or
// left visible but wired to a "not yet ported" stub — see PORTING.md step 5.
// Sound landed in step 6: M mutes, by key (phaser/soundHooks.js, page-wide)
// or by clicking this row.
//
// State lives on the caller (MenuScene), not in here, so this file stays the
// same shape as screens.js: a draw function and a click handler that agree on
// one array of hit rectangles.
const MenuScreen = {
  ROWS: 4, // 0 track, 1 class, 2 mode, 3 START — same layout as game.js's MENU_ROWS
  START_ROW: 3,

  hitAreas: [],

  moveCursor(state, dir) {
    state.row = (state.row + dir + this.ROWS) % this.ROWS;
  },

  // LEFT/RIGHT on the row under the cursor.
  changeRow(state, dir, actions) {
    if (state.row === 0) actions.cycleTrack(dir);
    else if (state.row === 1) actions.cycleClass(dir);
    else if (state.row === 2) this.cycleMode(state, dir);
  },

  cycleMode(state, dir) {
    state.selectedMode =
      (state.selectedMode + dir + PHASER_MODES.length) % PHASER_MODES.length;
  },

  drawSelectorRow(cx, y, opts) {
    const ctx = UI.ctx;
    const boxW = 360;
    const boxH = 40;
    const boxX = cx - boxW / 2;
    const boxY = y - 28;
    const arrowW = 46;

    ctx.fillStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 8);
    ctx.fill();

    if (opts.focused) {
      ctx.strokeStyle = "#FFD700";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(boxX, boxY, boxW, boxH, 8);
      ctx.stroke();
    }

    ctx.font = "13px 'Courier New'";
    ctx.textAlign = "right";
    ctx.fillStyle = opts.focused ? "#AAA" : "#666";
    ctx.fillText(opts.label, boxX - 14, y - 4);

    const arrows = [
      { x: boxX, glyph: "◀", action: opts.prevAction },
      { x: boxX + boxW - arrowW, glyph: "▶", action: opts.nextAction },
    ];
    ctx.font = "20px 'Courier New'";
    ctx.textAlign = "center";
    for (const a of arrows) {
      const hovered = isHovered(a.x, boxY, arrowW, boxH);
      this.hitAreas.push({ x: a.x, y: boxY, w: arrowW, h: boxH, action: a.action });
      if (hovered) {
        ctx.fillStyle = "rgba(255,215,0,0.25)";
        ctx.beginPath();
        ctx.roundRect(a.x, boxY, arrowW, boxH, 8);
        ctx.fill();
      }
      ctx.fillStyle = hovered ? "#FFD700" : "#888";
      ctx.fillText(a.glyph, a.x + arrowW / 2, y - 4);
    }

    // The circuit label goes grey while the next one is still baking, the
    // only sign the menu gives that ENTER/click is being ignored.
    ctx.font = "22px 'Courier New'";
    ctx.fillStyle = opts.dim ? "#888" : "#FFD700";
    ctx.fillText(opts.text, cx, y - 2);
  },

  drawStartButton(cx, y, focused) {
    const ctx = UI.ctx;
    const boxW = 300;
    const boxH = 44;
    const boxX = cx - boxW / 2;
    const boxY = y - 30;
    const hovered = isHovered(boxX, boxY, boxW, boxH);
    const lit = hovered || focused;

    this.hitAreas.push({ x: boxX, y: boxY, w: boxW, h: boxH, action: "start" });

    ctx.fillStyle = lit ? "#FFD700" : "rgba(255,215,0,0.25)";
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 8);
    ctx.fill();

    ctx.font = "bold 24px 'Courier New'";
    ctx.textAlign = "center";
    ctx.fillStyle = lit ? "#000" : "#FFD700";
    ctx.fillText("▶  START", cx, y);
  },

  draw(state) {
    const ctx = UI.ctx;
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillRect(0, 0, UI.width, UI.height);

    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "center";
    ctx.fillStyle = "#FFD700";
    ctx.font = "bold 50px 'Courier New'";
    ctx.fillText("🏎️ CANVAS CRUISER 🏎️", UI.width / 2, 118);
    ctx.font = "bold 12px 'Courier New'";
    ctx.fillText("v" + window.BUILD, UI.width / 2, 156);

    const cx = UI.width / 2;
    this.hitAreas = [];

    this.drawSelectorRow(cx, 196, {
      label: "TRACK",
      text: PHASER_TRACKS[state.selectedTrack].label,
      prevAction: "trackPrev",
      nextAction: "trackNext",
      focused: state.row === 0,
      dim: state.trackLoading,
    });
    this.drawSelectorRow(cx, 244, {
      label: "CLASS",
      text: EngineClass.label(),
      prevAction: "classPrev",
      nextAction: "classNext",
      focused: state.row === 1,
    });
    this.drawSelectorRow(cx, 292, {
      label: "MODE",
      text: PHASER_MODES[state.selectedMode].label,
      prevAction: "modePrev",
      nextAction: "modeNext",
      focused: state.row === 2,
    });

    this.drawStartButton(cx, 366, state.row === this.START_ROW);

    // Controls. K/Q/I/M/B name screens and systems this page hasn't grown
    // yet (key bindings, records, credits, sound, debug tools) — steps 5
    // (later parts), 6 and 8. They stay on the menu for visual parity with
    // the legacy screen and so the layout doesn't jump as each one lands;
    // clicking or pressing one now is a no-op stub, not a dead end, so the
    // menu never claims to do something it silently doesn't.
    const controlsY = 430;
    const lineSpacing = 30;
    const groupGap = 18;
    const gutter = 20;
    ctx.font = "16px 'Courier New'";

    const actions = [
      { key: "K", action: "Key bindings", id: "keybindings" },
      { key: "Q", action: "Records", id: "leaderboard" },
      { key: "I", action: "Credits", id: "credits" },
      {
        key: "M",
        action: typeof Sound !== "undefined" && Sound.muted ? "Sound: OFF" : "Sound: ON",
        id: "mute",
      },
      { key: "B", action: state.debug ? "DEBUG: ON" : "DEBUG: OFF", id: "debug" },
    ];

    const hints = [
      { key: "UP / DOWN", action: "Select row" },
      { key: "LEFT / RIGHT", action: "Change" },
      { key: "ENTER", action: "Start" },
    ];

    const controls = [...actions, ...hints.map((h) => ({ ...h, hint: true }))];

    controls.forEach((item, i) => {
      const y = controlsY + i * lineSpacing + (item.hint ? groupGap : 0);

      const keyW = ctx.measureText(item.key).width;
      const actionW = ctx.measureText(item.action).width;
      const rowX = cx - gutter - keyW - 8;
      const rowW = keyW + actionW + 2 * gutter + 16;
      const rowY = y - 16;
      const rowH = lineSpacing - 8;
      const hovered = item.id && isHovered(rowX, rowY, rowW, rowH);

      if (item.id) {
        this.hitAreas.push({ x: rowX, y: rowY, w: rowW, h: rowH, action: item.id });
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

    UI.canvas.style.cursor = this.hitAreas.some((a) => isHovered(a.x, a.y, a.w, a.h))
      ? "pointer"
      : "default";
  },

  // `actions` is the bag of callbacks MenuScene supplies: cycleTrack/
  // cycleClass/start are the only ones with anything behind them yet.
  handleClick(state, actions, x, y) {
    const hit = hitTest(this.hitAreas, x, y);
    if (!hit) return;

    switch (hit.action) {
      case "modePrev":
        this.cycleMode(state, -1);
        break;
      case "modeNext":
        this.cycleMode(state, 1);
        break;
      case "trackPrev":
        actions.cycleTrack(-1);
        break;
      case "trackNext":
        actions.cycleTrack(1);
        break;
      case "classPrev":
        actions.cycleClass(-1);
        break;
      case "classNext":
        actions.cycleClass(1);
        break;
      case "start":
        actions.start();
        break;
      case "debug":
        state.debug = !state.debug;
        break;
      case "leaderboard":
        actions.openRecords();
        break;
      case "credits":
        actions.openCredits();
        break;
      case "mute":
        if (typeof Sound !== "undefined") Sound.toggleMute();
        break;
      case "keybindings":
        console.info(`[menu] ${hit.action} — not yet ported, see PORTING.md step 5`);
        break;
    }
  },
};

// Shared across the UI overlay's screens — kept here since the menu was the
// first one built.
function isHovered(x, y, w, h) {
  return (
    mousePos.x >= x && mousePos.x <= x + w && mousePos.y >= y && mousePos.y <= y + h
  );
}

function hitTest(areas, x, y) {
  return areas.find((a) => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h);
}
