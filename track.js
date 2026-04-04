class Track {
  constructor(ctx) {
    this.ctx = ctx;
    this.data = null;
  }

  async load(url) {
    const response = await fetch(url);
    this.data = await response.json();
  }

  draw() {
    if (!this.data) return;

    const { ctx, data } = this;

    // 1. Draw the Road (Asphalt)
    ctx.strokeStyle = data.color || "#444";
    ctx.lineWidth = data.lineWidth || 100;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(data.points[0].x, data.points[0].y);
    for (let i = 1; i < data.points.length; i++) {
      ctx.lineTo(data.points[i].x, data.points[i].y);
    }
    ctx.closePath();
    ctx.stroke();

    // 2. Draw Center Line (Dashed)
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.setLineDash([20, 20]); // [Dash length, Gap length]
    ctx.stroke();
    ctx.setLineDash([]); // Reset for other drawings
  }
}
