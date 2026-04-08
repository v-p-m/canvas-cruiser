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

    const isGo = this.count === 0;
    const dotR = 14;
    const dotGap = 48;
    const dotsY = 60 + 24 + dotR; // just below the 60px HUD bar
    const cx = canvasWidth / 2;

    for (let i = 0; i < 3; i++) {
      const dotX = cx + (i - 1) * dotGap;
      const lit = !isGo && i < this.count;

      // Glow
      ctx.save();
      ctx.shadowColor = lit ? "#FF4444" : isGo ? "#00FF88" : "transparent";
      ctx.shadowBlur = lit || isGo ? 20 : 0;

      ctx.beginPath();
      ctx.arc(dotX, dotsY, dotR, 0, Math.PI * 2);
      ctx.fillStyle = isGo
        ? "#00FF88"
        : lit
          ? "#FF4444"
          : "rgba(255,255,255,0.15)";
      ctx.fill();

      ctx.strokeStyle = isGo
        ? "#00FF88"
        : lit
          ? "#FF8888"
          : "rgba(255,255,255,0.2)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  },
};
