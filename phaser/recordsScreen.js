// The records screen, ported off screens.js's drawLeaderboard/
// handleLeaderboardClick (screens.js:790-898). Same trade-off as the menu and
// HUD — see phaser/menuScreen.js's header.
//
// Only reachable from the menu on this page (Q, or the menu row). The legacy
// screen can also open mid-race and hands you back to a paused race — that
// needs pause/resume machinery this port doesn't have yet, so "back" here
// always means the menu. `phaser/recordsScene.js` is what owns that.
const RecordsScreen = {
  hitAreas: [],

  // `state`: { trackLabel, classLabel }. Reads Records.highScores/
  // bestTotalTimes directly — the caller is expected to have called
  // Records.select() for the track+class being shown before drawing.
  draw(state) {
    const ctx = UI.ctx;
    ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillRect(0, 0, UI.width, UI.height);
    ctx.textAlign = "center";

    ctx.fillStyle = "#888";
    ctx.font = "bold 18px 'Courier New'";
    ctx.fillText(
      `${state.trackLabel.toUpperCase()} · ${state.classLabel}`,
      UI.width / 2,
      90,
    );

    const colX = [UI.width * 0.2, UI.width * 0.5, UI.width * 0.8];
    const columns = [
      { title: "🏁 TOP 5 LAPS 🏁", entries: Records.highScores },
      {
        title: "🏆 TOP 3 · 5-LAP 🏆",
        entries: Records.bestTotalTimes.race5 || [],
      },
      {
        title: "🏆 TOP 3 · 10-LAP 🏆",
        entries: Records.bestTotalTimes.race10 || [],
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
          ctx.fillText(`${i + 1}. ${formatTime(score)}s`, x, 220 + i * 36),
        );
      }
    });

    const cx = UI.width / 2;
    ctx.font = "18px 'Courier New'";

    this.hitAreas = [];
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
        text: "ESC / Q — Back to menu",
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

      this.hitAreas.push({ action: btn.action, x, y, w, h });

      if (hovered) {
        ctx.fillStyle = btn.hoverFill;
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6);
        ctx.fill();
      }
      ctx.fillStyle = hovered ? btn.hoverColor : btn.color;
      ctx.fillText(btn.text, cx, btn.y);
    });

    UI.canvas.style.cursor = this.hitAreas.some((a) => isHovered(a.x, a.y, a.w, a.h))
      ? "pointer"
      : "default";
  },

  // `actions`: { back, clear }.
  handleClick(actions, x, y) {
    const hit = hitTest(this.hitAreas, x, y);
    if (!hit) return;
    if (hit.action === "back") actions.back();
    else if (hit.action === "clear") actions.clear();
  },
};
