// The results screen, ported off screens.js's drawRaceFinished/
// handleRaceFinishedClick (screens.js:903-1027). Drawn by RaceScene itself
// once `scene.finishOrder` exists — there's no separate Phaser scene for it,
// the way there's none for the in-race HUD, because it's an overlay on a race
// that's still there underneath, not a screen you navigate to.
//
// The legacy screen's roll-out hold is kept: RaceScene classifies the field at
// the flag but sits on the table for FINISH_HOLD_MS while the car coasts to a
// stop under the HUD, and only then does `scene.finishOrder` exist.
const ResultsScreen = {
  hitAreas: [],

  // `scene` is the RaceScene.
  draw(scene) {
    const ctx = UI.ctx;
    const p = scene.player.entity;
    const finishOrder = scene.finishOrder;

    ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
    ctx.fillRect(0, 0, UI.width, UI.height);

    const cx = UI.width / 2;

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = p.finishPosition === 1 ? "#FFD700" : "#FFFFFF";
    ctx.font = "bold 44px 'Courier New'";
    ctx.fillText(
      p.finishPosition === 1 ? "🏆 YOU WIN 🏆" : "🏁 RACE FINISHED 🏁",
      cx,
      100,
    );

    ctx.fillStyle = "#AAA";
    ctx.font = "20px 'Courier New'";
    ctx.fillText(
      `${EngineClass.current().label} · ${RaceLaps.target || "?"} laps · finished P${p.finishPosition} of ${finishOrder.length}`,
      cx,
      138,
    );

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

      ctx.fillStyle = entry.color;
      ctx.fillRect(colName + 44, y - 13, 14, 14);

      ctx.fillStyle = entry.isPlayer ? "#FFD700" : "#DDD";
      ctx.fillText(entry.name, colName + 68, y);

      ctx.textAlign = "right";
      ctx.fillStyle = entry.dnf ? "#777" : entry.isPlayer ? "#FFD700" : "#DDD";
      ctx.fillText(
        entry.dnf ? `lap ${entry.laps}/${RaceLaps.target}` : `${formatTime(entry.time)}s`,
        colTime,
        y,
      );
    });

    let y = tableTop + finishOrder.length * rowH + 40;

    if (scene.isNewBestTotal) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#FFD700";
      ctx.font = "bold 22px 'Courier New'";
      ctx.fillText("🏆 New Best Total!", cx, y);
      y += 38;
    }

    // Only the top 3 pay (Garage.awardForFinish), so most finishes see no
    // "+N" line — the total is still worth showing either way.
    if (scene.garagePointsAwarded > 0) {
      ctx.textAlign = "center";
      ctx.fillStyle = "#FFD700";
      ctx.font = "bold 20px 'Courier New'";
      ctx.fillText(`🔧 +${scene.garagePointsAwarded} garage points`, cx, y);
      y += 30;
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "#888";
    ctx.font = "16px 'Courier New'";
    ctx.fillText(`${Garage.points()} garage points total`, cx, y);
    y += 34;

    ctx.textAlign = "center";
    ctx.font = "18px 'Courier New'";

    this.hitAreas = [];
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

      this.hitAreas.push({ action: btn.action, x: bx, y: by, w, h });

      if (hovered) {
        ctx.fillStyle = "rgba(255,215,0,0.12)";
        ctx.beginPath();
        ctx.roundRect(bx, by, w, h, 6);
        ctx.fill();
      }
      ctx.fillStyle = hovered ? btn.hoverColor : "#AAA";
      ctx.fillText(btn.text, cx, btn.y);
    });

    UI.canvas.style.cursor = this.hitAreas.some((a) => isHovered(a.x, a.y, a.w, a.h))
      ? "pointer"
      : "default";
  },

  // `actions`: { again, menu }.
  handleClick(actions, x, y) {
    const hit = hitTest(this.hitAreas, x, y);
    if (!hit) return;
    if (hit.action === "again") actions.again();
    else if (hit.action === "menu") actions.menu();
  },
};
