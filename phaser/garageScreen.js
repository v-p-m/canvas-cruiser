// The garage screen, modeled on phaser/recordsScreen.js: a draw function and
// a click handler that agree on one array of hit rectangles, state living on
// Garage rather than in here. Only reachable from the menu — same reason
// RecordsScreen gives for "back" always meaning the menu.
const GarageScreen = {
  hitAreas: [],

  LABEL: { engine: "🔧 ENGINE", tires: "🛞 TIRES", steering: "🎯 STEERING" },
  FIELD: { engine: "speed + accel", tires: "grip", steering: "turn" },

  draw() {
    const ctx = UI.ctx;
    ctx.fillStyle = "rgba(0, 0, 0, 0.85)";
    ctx.fillRect(0, 0, UI.width, UI.height);
    ctx.textAlign = "center";

    ctx.fillStyle = "#FFD700";
    ctx.font = "bold 26px 'Courier New'";
    ctx.fillText("🔧 GARAGE 🔧", UI.width / 2, 90);

    ctx.fillStyle = "#888";
    ctx.font = "bold 18px 'Courier New'";
    ctx.fillText(`${Garage.points()} points`, UI.width / 2, 122);

    const colX = [UI.width * 0.2, UI.width * 0.5, UI.width * 0.8];

    this.hitAreas = [];

    GARAGE_PARTS.forEach((part, i) => {
      const x = colX[i];
      const tier = Garage.tier(part);
      const cost = Garage.nextCost(part);
      const maxed = cost === null;
      const afford = !maxed && Garage.canAfford(part);

      ctx.fillStyle = "#FFD700";
      ctx.font = "bold 22px 'Courier New'";
      ctx.fillText(this.LABEL[part], x, 170);

      ctx.fillStyle = "white";
      ctx.font = "20px 'Courier New'";
      ctx.fillText(`Tier ${tier}/${GARAGE_MAX_TIER}`, x, 210);

      ctx.fillStyle = "#888";
      ctx.font = "14px 'Courier New'";
      ctx.fillText(
        `×${GARAGE_TIER_MULT[tier].toFixed(2)} ${this.FIELD[part]}`,
        x,
        236,
      );

      const w = 160;
      const h = 36;
      const bx = x - w / 2;
      const by = 260;
      const hovered = !maxed && isHovered(bx, by, w, h);

      if (!maxed) this.hitAreas.push({ action: "buy", part, x: bx, y: by, w, h });

      ctx.fillStyle = maxed
        ? "rgba(255,255,255,0.05)"
        : hovered
          ? "rgba(255,215,0,0.28)"
          : afford
            ? "rgba(255,215,0,0.12)"
            : "rgba(255,255,255,0.06)";
      ctx.beginPath();
      ctx.roundRect(bx, by, w, h, 8);
      ctx.fill();

      ctx.fillStyle = maxed ? "#666" : afford ? (hovered ? "#FFD700" : "#DDD") : "#666";
      ctx.font = "16px 'Courier New'";
      ctx.fillText(maxed ? "MAXED" : `BUY — ${cost} pts`, x, by + 24);
    });

    const cx = UI.width / 2;
    ctx.font = "18px 'Courier New'";
    const backText = "ESC / G — Back to menu";
    const w = ctx.measureText(backText).width + 32;
    const h = 28;
    const bx = cx - w / 2;
    const by = 330;
    const hovered = isHovered(bx, by, w, h);
    this.hitAreas.push({ action: "back", x: bx, y: by, w, h });

    if (hovered) {
      ctx.fillStyle = "rgba(255,215,0,0.12)";
      ctx.beginPath();
      ctx.roundRect(bx, by, w, h, 6);
      ctx.fill();
    }
    ctx.fillStyle = hovered ? "#FFD700" : "#AAA";
    ctx.fillText(backText, cx, by + 20);

    UI.canvas.style.cursor = this.hitAreas.some((a) => isHovered(a.x, a.y, a.w, a.h))
      ? "pointer"
      : "default";
  },

  // `actions`: { back, buy }.
  handleClick(actions, x, y) {
    const hit = hitTest(this.hitAreas, x, y);
    if (!hit) return;
    if (hit.action === "back") actions.back();
    else if (hit.action === "buy") actions.buy(hit.part);
  },
};
