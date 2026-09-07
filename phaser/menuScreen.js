// The start menu, ported off screens.js's drawStartMenu / drawSelectorRow /
// drawStartButton / handleMenuClick (screens.js:94-374) onto the UI overlay
// canvas (phaser/uiCanvas.js). The drawing is verbatim where the legacy
// globals it read have a Phaser-side equivalent. Where none arrived, the row
// went rather than staying as a button that lies: DEBUG is the one that never
// came back (see the controls block below). The legacy pause screen's own two
// rows did arrive, in 0.20.0 — this menu *is* the pause screen now, so ESC
// (resume) and R (restart) are appended to the same list, but only while there
// is a race frozen behind it. M mutes, by key (phaser/soundHooks.js,
// page-wide) or by clicking its row.
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
    else if (state.row === 2) this.cycleMode(state, dir, actions);
  },

  cycleMode(state, dir, actions) {
    state.selectedMode =
      (state.selectedMode + dir + PHASER_MODES.length) % PHASER_MODES.length;
    // Landing on the series mode with a championship already running points
    // the TRACK row (and the backdrop bake behind it) at the round that is
    // actually next — the row is locked from there, so it must not be left
    // showing a circuit the series isn't going to.
    actions.syncSeries();
  },

  // A championship in progress owns the TRACK and CLASS rows: the calendar
  // was fixed when it began and the class is part of the title. Both rows stay
  // visible and go dim rather than disappearing, so the player can see what
  // the series is running under.
  seriesMode(state) {
    return !!PHASER_MODES[state.selectedMode].series;
  },

  seriesLocked(state) {
    // A championship whose last round is already in the book locks nothing:
    // there is no next round to hold the calendar or the class for, only a
    // final table left to go and look at.
    return this.seriesMode(state) && Series.active && !Series.complete();
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

  drawStartButton(cx, y, focused, label = "▶  START") {
    const ctx = UI.ctx;
    // Measured, not fixed at 300: a championship's label carries the round it
    // is about to run ("CONTINUE · ROUND 4 OF 4"), which is half again as wide
    // as "START" and hung out over both ends of the box.
    ctx.font = "bold 24px 'Courier New'";
    const boxW = Math.max(300, ctx.measureText(label).width + 56);
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

    ctx.textAlign = "center";
    ctx.fillStyle = lit ? "#000" : "#FFD700";
    ctx.fillText(label, cx, y);
  },

  // The circuits the championship visits, under the MODE row: the whole
  // calendar before START is pressed, because a series is a commitment to a
  // specific set of races and the player should see which ones. Once it is
  // running, the round about to be raced is lit.
  drawSeriesLine(state, cx, y) {
    const ctx = UI.ctx;
    const running = Series.active;
    const ids = running
      ? Series.calendar
      : Array.from(
          { length: SERIES_ROUNDS },
          (_, i) => PHASER_TRACKS[(state.selectedTrack + i) % PHASER_TRACKS.length].id,
        );
    const labels = ids.map((id) => (PHASER_TRACKS.find((t) => t.id === id) || { label: id }).label);

    // Fitted, not fixed: four track names and their separators are wider than
    // a short window at 13px, and a calendar running off both edges of the
    // menu says less than a smaller one that fits.
    const sep = "  ›  ";
    let size = 13;
    let sepW, widths, total;
    for (;;) {
      ctx.font = `${size}px 'Courier New'`;
      sepW = ctx.measureText(sep).width;
      widths = labels.map((l) => ctx.measureText(l).width);
      total = widths.reduce((a, b) => a + b, 0) + sepW * (labels.length - 1);
      if (total <= UI.width - 40 || size <= 9) break;
      size--;
    }

    let x = cx - total / 2;
    ctx.textAlign = "left";
    labels.forEach((label, i) => {
      const next = running && i === Series.round;
      const raced = running && i < Series.results.length;
      ctx.fillStyle = next ? "#FFD700" : raced ? "#888" : "#CCC";
      ctx.fillText(label, x, y);
      x += widths[i];
      if (i < labels.length - 1) {
        ctx.fillStyle = "#888";
        ctx.fillText(sep, x, y);
        x += sepW;
      }
    });
  },

  draw(state) {
    const ctx = UI.ctx;
    // A scrim, not a blackout. At the legacy 0.8 the backdrop was a bake of a
    // mostly-dark circuit under near-opaque black and the menu read as sitting
    // on nothing; MenuScene now drifts a lit, rained-on track behind it, which
    // is worth seeing. Everything on top is either gold or in its own panel,
    // so this only has to knock the tarmac back, not hide it.
    // It eases off after dark, where night.js's own veil (DARKNESS 0.88) has
    // already done the job twice over and the two stacked put the floodlights
    // out.
    const dark = typeof Night === "undefined" ? 0 : Night.intensity;
    ctx.fillStyle = `rgba(0, 0, 0, ${0.5 - 0.22 * dark})`;
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

    const locked = this.seriesLocked(state);

    this.drawSelectorRow(cx, 196, {
      label: locked ? "ROUND" : "TRACK",
      text: PHASER_TRACKS[state.selectedTrack].label,
      prevAction: "trackPrev",
      nextAction: "trackNext",
      focused: state.row === 0,
      dim: state.trackLoading || locked,
    });
    this.drawSelectorRow(cx, 244, {
      label: "CLASS",
      text: EngineClass.label(),
      prevAction: "classPrev",
      nextAction: "classNext",
      focused: state.row === 1,
      dim: locked,
    });
    this.drawSelectorRow(cx, 292, {
      label: "MODE",
      text: PHASER_MODES[state.selectedMode].label,
      prevAction: "modePrev",
      nextAction: "modeNext",
      focused: state.row === 2,
    });

    if (this.seriesMode(state)) this.drawSeriesLine(state, cx, 326);

    this.drawStartButton(
      cx,
      366,
      state.row === this.START_ROW,
      this.seriesMode(state)
        ? Series.complete()
          ? "▶  FINAL STANDINGS"
          : Series.active
            ? `▶  CONTINUE · ${Series.roundLabel()}`
            : "▶  START SERIES"
        : "▶  START",
    );

    // Controls. B (DEBUG) used to sit here as a stub waiting for the editors
    // to land. They landed on editor.html instead — they need the legacy
    // loop's free camera and pace car, and what they author is a track file,
    // which this page reads either way — so there is nothing here for B to
    // unlock and the row is gone. What is left of DEBUG on this page is the
    // `?debug=1` overlay, which wants no key and no menu row.
    const controlsY = 430;
    const lineSpacing = 30;
    const groupGap = 18;
    const gutter = 20;
    ctx.font = "16px 'Courier New'";

    const actions = [
      { key: "K", action: "Key bindings", id: "keybindings" },
      { key: "Q", action: "Records", id: "leaderboard" },
      { key: "G", action: "Garage", id: "garage" },
      // The only way out of a championship short of finishing it, and it only
      // appears while there is one to leave — a series survives ESC out of a
      // race on purpose, so without this the menu would offer to continue the
      // same one forever.
      ...(Series.active
        ? [
            {
              key: "X",
              action: Series.complete() ? "Discard final standings" : "Abandon series",
              id: "abandonSeries",
            },
          ]
        : []),
      { key: "I", action: "Credits", id: "credits" },
      {
        key: "M",
        action: typeof Sound !== "undefined" && Sound.muted ? "Sound: OFF" : "Sound: ON",
        id: "mute",
      },
      // Last, and only while there is a race frozen behind this menu — the
      // same row screens.js:262 appends for the same reason. It is the one
      // clickable ESC the menu ever has: with no paused race, ESC here does
      // nothing and the row would be a button that lies. R is the same
      // bargain for the other thing that can be done with a frozen race, and
      // is deliberately the results screen's own "race again" key.
      ...(state.paused
        ? [
            { key: "ESC", action: "Resume race", id: "resume" },
            { key: "R", action: "Restart race", id: "restart" },
          ]
        : []),
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

  // `actions` is the bag of callbacks MenuScene supplies — everything the menu
  // can do that isn't purely its own picker state.
  handleClick(state, actions, x, y) {
    const hit = hitTest(this.hitAreas, x, y);
    if (!hit) return;

    switch (hit.action) {
      case "modePrev":
        this.cycleMode(state, -1, actions);
        break;
      case "modeNext":
        this.cycleMode(state, 1, actions);
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
      case "leaderboard":
        actions.openRecords();
        break;
      case "garage":
        actions.openGarage();
        break;
      case "abandonSeries":
        actions.abandonSeries();
        break;
      case "credits":
        actions.openCredits();
        break;
      case "mute":
        if (typeof Sound !== "undefined") Sound.toggleMute();
        break;
      case "keybindings":
        actions.openKeyBindings();
        break;
      case "resume":
        actions.resumeRace();
        break;
      case "restart":
        actions.restartRace();
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
