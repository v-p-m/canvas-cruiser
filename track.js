class Track {
  constructor(ctx) {
    this.ctx = ctx;
    this.data = null;
    this.tileSize = 64;
    this.bakedCanvas = null;
  }

  async load(url) {
    const response = await fetch(url);
    this.data = await response.json();
    this.tileSize = this.data.tileSize;
    this.bake(); // draw once, never again
  }

  bake() {
    const cols = this.data.map[0].length;
    const rows = this.data.map.length;

    this.bakedCanvas = document.createElement("canvas");
    this.bakedCanvas.width = cols * this.tileSize;
    this.bakedCanvas.height = rows * this.tileSize;

    const bCtx = this.bakedCanvas.getContext("2d");
    const ts = this.tileSize;

    // Helper — is this tile a road (2-9)?
    const isRoad = (tx, ty) => {
      if (ty < 0 || ty >= rows || tx < 0 || tx >= cols) return false;
      const id = this.data.map[ty][tx];
      return id >= 2 && id <= 9;
    };

    // Helper — is this tile grass (0)?
    const isGrass = (tx, ty) => {
      if (ty < 0 || ty >= rows || tx < 0 || tx >= cols) return false;
      return this.data.map[ty][tx] === 0;
    };

    this.data.map.forEach((row, ty) => {
      row.forEach((tileID, tx) => {
        const posX = tx * ts;
        const posY = ty * ts;

        // ─────────────────────────────────────────
        // GRASS (0)
        // ─────────────────────────────────────────
        if (tileID === 0) {
          // Base grass
          bCtx.fillStyle = "#2d5a27";
          bCtx.fillRect(posX, posY, ts, ts);

          // Subtle darker patches — seeded by position so stable
          const seed = tx * 7 + ty * 13;
          for (let i = 0; i < 6; i++) {
            const px = posX + ((seed * (i + 3) * 17) % ts);
            const py = posY + ((seed * (i + 5) * 11) % ts);
            const pw = 4 + ((seed * (i + 1) * 7) % 10);
            const ph = 3 + ((seed * (i + 2) * 5) % 8);
            bCtx.fillStyle = "rgba(0,0,0,0.08)";
            bCtx.fillRect(px, py, pw, ph);
          }

          // Lighter highlight patches
          for (let i = 0; i < 4; i++) {
            const px = posX + ((seed * (i + 2) * 19) % ts);
            const py = posY + ((seed * (i + 4) * 13) % ts);
            const pw = 3 + ((seed * (i + 3) * 9) % 8);
            const ph = 2 + ((seed * (i + 1) * 7) % 6);
            bCtx.fillStyle = "rgba(255,255,255,0.04)";
            bCtx.fillRect(px, py, pw, ph);
          }
          return;
        }

        // ─────────────────────────────────────────
        // WALL (1)
        // ─────────────────────────────────────────
        if (tileID === 1) {
          // Dark base
          bCtx.fillStyle = "#1a1a1a";
          bCtx.fillRect(posX, posY, ts, ts);

          // Tyre barrier stripes — red/white alternating
          const stripeW = ts / 4;
          for (let i = 0; i < 4; i++) {
            bCtx.fillStyle = i % 2 === 0 ? "#8B0000" : "#555";
            bCtx.fillRect(posX + i * stripeW, posY, stripeW, ts);
          }

          // Dark overlay to tone it down
          bCtx.fillStyle = "rgba(0,0,0,0.45)";
          bCtx.fillRect(posX, posY, ts, ts);
          return;
        }

        // ─────────────────────────────────────────
        // FINISH LINE (8, 9)
        // ─────────────────────────────────────────
        if (tileID === 8 || tileID === 9) {
          const half = ts / 2;
          bCtx.fillStyle = "#FFFFFF";
          bCtx.fillRect(posX, posY, ts, ts);
          bCtx.fillStyle = "#000000";
          bCtx.fillRect(posX, posY, half, half);
          bCtx.fillRect(posX + half, posY + half, half, half);
          return;
        }

        // ─────────────────────────────────────────
        // ROAD (2-7)
        // ─────────────────────────────────────────
        if (tileID >= 2 && tileID <= 7) {
          // 1. Base asphalt
          bCtx.fillStyle = "#3a3a3a";
          bCtx.fillRect(posX, posY, ts, ts);

          // 2. Asphalt grain — subtle noise
          const seed = tx * 7 + ty * 13;
          for (let i = 0; i < 12; i++) {
            const px = posX + ((seed * (i + 3) * 17) % ts);
            const py = posY + ((seed * (i + 5) * 11) % ts);
            const sz = 1 + ((seed * i) % 3);
            bCtx.fillStyle = `rgba(0,0,0,${0.04 + ((seed * i) % 8) * 0.01})`;
            bCtx.fillRect(px, py, sz, sz);
          }
          for (let i = 0; i < 8; i++) {
            const px = posX + ((seed * (i + 7) * 23) % ts);
            const py = posY + ((seed * (i + 9) * 19) % ts);
            const sz = 1 + ((seed * i) % 2);
            bCtx.fillStyle = `rgba(255,255,255,${0.02 + ((seed * i) % 5) * 0.01})`;
            bCtx.fillRect(px, py, sz, sz);
          }

          // 3. Rumble strips — on road edges that border grass
          const rumbleW = 6;
          const stripeLen = 12;
          const stripeGap = 8;

          // Top edge
          if (isGrass(tx, ty - 1)) {
            for (let s = 0; s < ts; s += stripeLen + stripeGap) {
              bCtx.fillStyle =
                s % ((stripeLen + stripeGap) * 2) === 0 ? "#CC0000" : "#FFDD00";
              bCtx.fillRect(
                posX + s,
                posY,
                Math.min(stripeLen, ts - s),
                rumbleW,
              );
            }
          }
          // Bottom edge
          if (isGrass(tx, ty + 1)) {
            for (let s = 0; s < ts; s += stripeLen + stripeGap) {
              bCtx.fillStyle =
                s % ((stripeLen + stripeGap) * 2) === 0 ? "#CC0000" : "#FFDD00";
              bCtx.fillRect(
                posX + s,
                posY + ts - rumbleW,
                Math.min(stripeLen, ts - s),
                rumbleW,
              );
            }
          }
          // Left edge
          if (isGrass(tx - 1, ty)) {
            for (let s = 0; s < ts; s += stripeLen + stripeGap) {
              bCtx.fillStyle =
                s % ((stripeLen + stripeGap) * 2) === 0 ? "#CC0000" : "#FFDD00";
              bCtx.fillRect(
                posX,
                posY + s,
                rumbleW,
                Math.min(stripeLen, ts - s),
              );
            }
          }
          // Right edge
          if (isGrass(tx + 1, ty)) {
            for (let s = 0; s < ts; s += stripeLen + stripeGap) {
              bCtx.fillStyle =
                s % ((stripeLen + stripeGap) * 2) === 0 ? "#CC0000" : "#FFDD00";
              bCtx.fillRect(
                posX + ts - rumbleW,
                posY + s,
                rumbleW,
                Math.min(stripeLen, ts - s),
              );
            }
          }

          // 4. Centre line dashes — only on tiles with road on both sides horizontally OR vertically
          const roadLeft = isRoad(tx - 1, ty);
          const roadRight = isRoad(tx + 1, ty);
          const roadUp = isRoad(tx, ty - 1);
          const roadDown = isRoad(tx, ty + 1);

          const horizontal = roadLeft && roadRight;
          const vertical = roadUp && roadDown;

          bCtx.fillStyle = "rgba(255, 255, 255, 0.25)";

          if (horizontal && !vertical) {
            // Dashed centre line running left-right
            const cy = posY + ts / 2 - 1;
            const dashW = 16;
            const dashGap = 12;
            for (let s = 0; s < ts; s += dashW + dashGap) {
              bCtx.fillRect(posX + s, cy, Math.min(dashW, ts - s), 3);
            }
          } else if (vertical && !horizontal) {
            // Dashed centre line running top-bottom
            const cx = posX + ts / 2 - 1;
            const dashH = 16;
            const dashGap = 12;
            for (let s = 0; s < ts; s += dashH + dashGap) {
              bCtx.fillRect(cx, posY + s, 3, Math.min(dashH, ts - s));
            }
          }

          // 5. Subtle edge darkening — faux ambient occlusion
          const aoSize = 6;
          const aoAlpha = 0.18;

          // Only darken edges that border non-road tiles
          if (!isRoad(tx, ty - 1)) {
            const grad = bCtx.createLinearGradient(0, posY, 0, posY + aoSize);
            grad.addColorStop(0, `rgba(0,0,0,${aoAlpha})`);
            grad.addColorStop(1, "rgba(0,0,0,0)");
            bCtx.fillStyle = grad;
            bCtx.fillRect(posX, posY, ts, aoSize);
          }
          if (!isRoad(tx, ty + 1)) {
            const grad = bCtx.createLinearGradient(
              0,
              posY + ts - aoSize,
              0,
              posY + ts,
            );
            grad.addColorStop(0, "rgba(0,0,0,0)");
            grad.addColorStop(1, `rgba(0,0,0,${aoAlpha})`);
            bCtx.fillStyle = grad;
            bCtx.fillRect(posX, posY + ts - aoSize, ts, aoSize);
          }
          if (!isRoad(tx - 1, ty)) {
            const grad = bCtx.createLinearGradient(posX, 0, posX + aoSize, 0);
            grad.addColorStop(0, `rgba(0,0,0,${aoAlpha})`);
            grad.addColorStop(1, "rgba(0,0,0,0)");
            bCtx.fillStyle = grad;
            bCtx.fillRect(posX, posY, aoSize, ts);
          }
          if (!isRoad(tx + 1, ty)) {
            const grad = bCtx.createLinearGradient(
              posX + ts - aoSize,
              0,
              posX + ts,
              0,
            );
            grad.addColorStop(0, "rgba(0,0,0,0)");
            grad.addColorStop(1, `rgba(0,0,0,${aoAlpha})`);
            bCtx.fillStyle = grad;
            bCtx.fillRect(posX + ts - aoSize, posY, aoSize, ts);
          }
        }
      });
    });
  }

  draw() {
    if (!this.bakedCanvas) return;
    // Single drawImage instead of hundreds of fillRect calls
    this.ctx.drawImage(this.bakedCanvas, 0, 0);
  }
}
