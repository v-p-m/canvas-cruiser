// The championship standings, drawn between rounds and once more at the end
// of the last one. Modeled on phaser/garageScreen.js and recordsScreen.js: a
// draw function and a click handler that agree on one array of hit rectangles,
// with all the state on `Series` rather than in here.
//
// It is a screen of its own rather than a panel bolted under the results
// table, for two reasons. The results screen is already six classified rows
// deep before it gets to the garage line, and a second six-row table under it
// would push the buttons off a short window. And the gap between rounds is
// where the garage is *supposed* to be visited — a screen with its own "spend
// your points" button is what makes that a step in the series rather than
// something the player has to remember to go and do from the main menu.
const SeriesScreen = {
  hitAreas: [],

  ROW_H: 32, // px per standings row

  draw() {
    const ctx = UI.ctx;
    const cx = UI.width / 2;
    const done = Series.complete();
    const table = Series.standings();
    const me = table.find((r) => r.isPlayer);

    ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
    ctx.fillRect(0, 0, UI.width, UI.height);
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";

    const champion = done && me && me.position === 1;
    ctx.fillStyle = champion ? "#FFD700" : "#FFFFFF";
    ctx.font = "bold 34px 'Courier New'";
    ctx.fillText(
      done ? (champion ? "🏆 SERIES CHAMPION 🏆" : "🏁 SERIES OVER 🏁") : "🏆 CHAMPIONSHIP 🏆",
      cx,
      86,
    );

    ctx.fillStyle = "#888";
    ctx.font = "16px 'Courier New'";
    ctx.fillText(
      `${EngineClass.current().label} · ${SERIES_LAPS} laps · ${SERIES_ROUNDS} rounds`,
      cx,
      114,
    );

    this.hitAreas = [];
    this.drawCalendar(cx, 146, done);
    const tableBottom = this.drawTable(cx, 196, table);
    this.drawFooter(cx, tableBottom + 34, done, me);

    UI.canvas.style.cursor = this.hitAreas.some((a) => isHovered(a.x, a.y, a.w, a.h))
      ? "pointer"
      : "default";
  },

  // The circuits, in order, with the one about to be raced lit. The calendar is
  // fixed at the start (Series.begin) precisely so it can be shown like this —
  // the player always knows what is still to come.
  //
  // The type size is fitted rather than fixed: four track names and their
  // separators run past 550px at 15px, which is wider than a short window, and
  // a calendar that runs off both edges tells the player less than a small one.
  drawCalendar(cx, y, done) {
    const ctx = UI.ctx;
    const labels = Series.calendar.map(
      (id, i) => (PHASER_TRACKS.find((t) => t.id === id) || { label: id }).label,
    );
    const sep = "  ›  ";
    let size = 15;
    let sepW, widths, total;
    for (;;) {
      ctx.font = `${size}px 'Courier New'`;
      sepW = ctx.measureText(sep).width;
      widths = labels.map((l) => ctx.measureText(l).width);
      total = widths.reduce((a, b) => a + b, 0) + sepW * (labels.length - 1);
      if (total <= UI.width - 48 || size <= 10) break;
      size--;
    }

    let x = cx - total / 2;
    ctx.textAlign = "left";
    labels.forEach((label, i) => {
      const raced = i < Series.results.length;
      const next = !done && i === Series.round;
      ctx.fillStyle = next ? "#FFD700" : raced ? "#AAA" : "#666";
      ctx.font = next ? `bold ${size}px 'Courier New'` : `${size}px 'Courier New'`;
      ctx.fillText(label, x, y);
      x += widths[i];
      if (i < labels.length - 1) {
        ctx.fillStyle = "#555";
        ctx.font = `${size}px 'Courier New'`;
        ctx.fillText(sep, x, y);
        x += sepW;
      }
    });
  },

  // Returns the y the table ended at, so the footer below doesn't have to
  // re-derive it from a field count.
  drawTable(cx, top, table) {
    const ctx = UI.ctx;
    const posX = cx - 300;
    const chipX = cx - 252;
    const nameX = cx - 228;
    // One column per round, spread across a fixed band so the header, the
    // per-round positions and the points column stay lined up whatever
    // SERIES_ROUNDS is — this was three hardcoded x's, which is exactly the
    // kind of thing that silently drops a round when the calendar grows.
    const ROUND_L = 30;
    const ROUND_R = 230;
    const span = SERIES_ROUNDS > 1 ? (ROUND_R - ROUND_L) / (SERIES_ROUNDS - 1) : 0;
    const roundX = Array.from({ length: SERIES_ROUNDS }, (_, i) => cx + ROUND_L + span * i);
    const ptsX = cx + 300;

    ctx.font = "15px 'Courier New'";
    ctx.fillStyle = "#666";
    ctx.textAlign = "left";
    ctx.fillText("POS  DRIVER", posX, top - 12);
    ctx.textAlign = "center";
    roundX.forEach((x, i) => ctx.fillText(`R${i + 1}`, x, top - 12));
    ctx.textAlign = "right";
    ctx.fillText("PTS", ptsX, top - 12);

    // An empty championship — the standings opened before round 1 has been
    // run. Nothing to rank yet, and a bare table with headers and no rows
    // reads as a bug rather than as a series that hasn't started.
    if (table.length === 0) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#666";
      ctx.font = "16px 'Courier New'";
      ctx.fillText("No rounds run yet", cx, top + 24);
      return top + 40;
    }

    table.forEach((row, i) => {
      const y = top + i * this.ROW_H + 18;

      if (row.isPlayer) {
        ctx.fillStyle = "rgba(255,215,0,0.12)";
        ctx.beginPath();
        ctx.roundRect(posX - 14, y - 20, ptsX - posX + 28, this.ROW_H - 4, 6);
        ctx.fill();
      }

      const lead = row.position === 1;
      const color = row.isPlayer ? "#FFD700" : lead ? "#FFF" : "#DDD";
      ctx.font = row.isPlayer ? "bold 18px 'Courier New'" : "18px 'Courier New'";
      ctx.textAlign = "left";
      ctx.fillStyle = color;
      ctx.fillText(`${row.position}.`, posX, y);

      ctx.fillStyle = row.color;
      ctx.fillRect(chipX, y - 13, 14, 14);

      ctx.fillStyle = color;
      ctx.fillText(row.name, nameX, y);

      // Each round's finishing position, so the table shows *how* the points
      // were made — a win and a last is a different championship from two
      // thirds, and on a six-car grid they are worth the same.
      ctx.textAlign = "center";
      ctx.font = "15px 'Courier New'";
      roundX.forEach((x, r) => {
        const pos = row.rounds[r];
        ctx.fillStyle = pos === 1 ? "#FFD700" : pos ? "#999" : "#444";
        ctx.fillText(pos ? `P${pos}` : "–", x, y);
      });

      ctx.textAlign = "right";
      ctx.font = row.isPlayer ? "bold 18px 'Courier New'" : "18px 'Courier New'";
      ctx.fillStyle = color;
      ctx.fillText(String(row.points), ptsX, y);

      // What this round paid, alongside the total it went into.
      if (row.gained > 0) {
        ctx.font = "13px 'Courier New'";
        ctx.fillStyle = "#00AA44";
        ctx.textAlign = "left";
        ctx.fillText(`+${row.gained}`, ptsX + 12, y);
      }
    });

    return top + table.length * this.ROW_H;
  },

  drawFooter(cx, y, done, me) {
    const ctx = UI.ctx;
    ctx.textAlign = "center";

    if (done) {
      if (Series.bonus > 0) {
        ctx.fillStyle = "#FFD700";
        ctx.font = "bold 20px 'Courier New'";
        ctx.fillText(`🔧 +${Series.bonus} garage points for the championship`, cx, y);
        y += 30;
      }
      ctx.fillStyle = "#888";
      ctx.font = "15px 'Courier New'";
      ctx.fillText(`${Garage.points()} garage points to spend`, cx, y);
      y += 36;
    } else {
      const track = Series.currentTrack();
      ctx.fillStyle = "#FFF";
      ctx.font = "bold 20px 'Courier New'";
      ctx.fillText(`NEXT — ${Series.roundLabel()} · ${track ? track.label : "?"}`, cx, y);
      y += 26;
      ctx.fillStyle = "#888";
      ctx.font = "15px 'Courier New'";
      ctx.fillText(`${Garage.points()} garage points to spend`, cx, y);
      y += 36;
    }

    const buttons = done
      ? [{ action: "menu", text: "ENTER / ESC — Main menu", primary: true }]
      : [
          { action: "start", text: `ENTER — Start ${Series.roundLabel().toLowerCase()}`, primary: true },
          { action: "garage", text: "G — Garage" },
          { action: "menu", text: "ESC — Main menu (series is saved)" },
        ];

    buttons.forEach((btn, i) => {
      const by = y + i * 36;
      ctx.font = btn.primary ? "bold 18px 'Courier New'" : "17px 'Courier New'";
      const w = ctx.measureText(btn.text).width + 36;
      const h = 30;
      const bx = cx - w / 2;
      const hovered = isHovered(bx, by, w, h);

      this.hitAreas.push({ action: btn.action, x: bx, y: by, w, h });

      if (hovered || btn.primary) {
        ctx.fillStyle = hovered ? "rgba(255,215,0,0.28)" : "rgba(255,215,0,0.12)";
        ctx.beginPath();
        ctx.roundRect(bx, by, w, h, 6);
        ctx.fill();
      }
      ctx.fillStyle = hovered || btn.primary ? "#FFD700" : "#AAA";
      ctx.fillText(btn.text, cx, by + 21);
    });
  },

  // `actions`: { start, garage, menu }.
  handleClick(actions, x, y) {
    const hit = hitTest(this.hitAreas, x, y);
    if (!hit) return;
    if (hit.action === "start") actions.start();
    else if (hit.action === "garage") actions.garage();
    else if (hit.action === "menu") actions.menu();
  },
};
