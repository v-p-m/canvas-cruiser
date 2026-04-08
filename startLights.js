// startLights.js

const StartLights = {
  active: false,
  count: null, // 3, 2, 1, 0 (0 = GO!)
  timer: 0,
  interval: 1000, // ms per step
  goDisplayTime: 800,
  _lastTick: 0,

  begin() {
    this.active = true;
    this.count = 3;
    this._lastTick = performance.now();
  },

  // Returns true while the sequence is still running
  isBlocking() {
    return this.active;
  },

  update(timestamp) {
    if (!this.active) return;

    const elapsed = timestamp - this._lastTick;

    // Use shorter duration when showing GO
    const duration = this.count === 0 ? 400 : 1000;

    if (elapsed >= duration) {
      this._lastTick = timestamp;
      this.count--;

      if (this.count < 0) {
        this.active = false;
        this.count = null;
      }
    }
  },

  draw(ctx, canvasWidth, canvasHeight) {
    if (!this.active) return;

    const label = this.count === 0 ? "GO!" : String(this.count);
    const isGo = this.count === 0;
    const bgColor = isGo ? "rgba(0, 180, 0, 0.82)" : "rgba(200, 0, 0, 0.82)";
    const borderColor = isGo ? "#00FF88" : "#FF4444";
    const glowColor = isGo ? "#00FF88" : "#FF4444";

    const boxW = 280;
    const boxH = 180;
    const boxX = (canvasWidth - boxW) / 2;
    const boxY = (canvasHeight - boxH) / 2 - 40;
    const cx = canvasWidth / 2;
    const cy = boxY + boxH / 2;

    // Box with glow — no separate ellipse needed
    ctx.save();
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 40;
    ctx.fillStyle = bgColor;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, boxH, 16);
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // Number / GO!
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#FFFFFF";
    ctx.font = `bold ${isGo ? 90 : 110}px 'Courier New'`;
    ctx.fillText(label, cx, cy);
    ctx.restore();

    // Dots
    const dotR = 10;
    const dotGap = 36;
    const dotsY = boxY + boxH + 28;

    for (let i = 0; i < 3; i++) {
      const dotX = cx + (i - 1) * dotGap;
      const lit = this.count !== 0 && i < this.count;
      ctx.beginPath();
      ctx.arc(dotX, dotsY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = lit ? "#FF4444" : "rgba(255,255,255,0.15)";
      ctx.fill();
      ctx.strokeStyle = lit ? "#FF8888" : "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  },
};
