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

    this.data.map.forEach((row, y) => {
      row.forEach((tileID, x) => {
        const posX = x * this.tileSize;
        const posY = y * this.tileSize;
        const half = this.tileSize / 2;

        switch (tileID) {
          case 0:
            bCtx.fillStyle = "#2d5a27";
            bCtx.fillRect(posX, posY, this.tileSize, this.tileSize);
            break;
          case 1:
            bCtx.fillStyle = "#1a1a1a";
            bCtx.fillRect(posX, posY, this.tileSize, this.tileSize);
            break;
          case 2:
          case 3:
          case 4:
          case 5:
          case 6:
          case 7:
            bCtx.fillStyle = "#444444";
            bCtx.fillRect(posX, posY, this.tileSize, this.tileSize);
            break;
          case 8:
          case 9:
            bCtx.fillStyle = "#FFFFFF";
            bCtx.fillRect(posX, posY, this.tileSize, this.tileSize);
            bCtx.fillStyle = "#000000";
            bCtx.fillRect(posX, posY, half, half);
            bCtx.fillRect(posX + half, posY + half, half, half);
            break;
          default:
            bCtx.fillStyle = "#ff00ff";
            bCtx.fillRect(posX, posY, this.tileSize, this.tileSize);
        }

        // Grid lines — remove this in production, costs nothing baked
        // but was costing a strokeRect per tile per frame before
        if (DEBUG) {
          bCtx.strokeStyle = "rgba(0,0,0,0.1)";
          bCtx.strokeRect(posX, posY, this.tileSize, this.tileSize);
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
