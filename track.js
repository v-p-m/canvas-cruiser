class Track {
  constructor(ctx) {
    this.ctx = ctx;
    this.data = null;
    this.tileSize = 64;
  }

  async load(url) {
    const response = await fetch(url);
    this.data = await response.json();
    this.tileSize = this.data.tileSize;
  }

  draw() {
    // Guard clause: Don't draw if data hasn't loaded yet
    if (!this.data || !this.data.map) return;

    this.data.map.forEach((row, y) => {
      row.forEach((tileID, x) => {
        const posX = x * this.tileSize;
        const posY = y * this.tileSize;

        // Choose color based on tileID
        switch (tileID) {
          case 0:
            this.ctx.fillStyle = "#2d5a27"; // Grass
            break;
          case 1:
            this.ctx.fillStyle = "#1a1a1a"; // Wall
            break;
          case 2:
          case 3:
          case 4:
          case 5:
          case 6:
          case 7:
            this.ctx.fillStyle = "#444444"; // Road
            break;
          case 8:
          case 9:
            // 1. Draw White Base
            this.ctx.fillStyle = "#FFFFFF";
            this.ctx.fillRect(posX, posY, this.tileSize, this.tileSize);

            // 2. Draw Two Black Squares (Top-Left and Bottom-Right)
            this.ctx.fillStyle = "#000000";
            const half = this.tileSize / 2;
            this.ctx.fillRect(posX, posY, half, half); // Top-Left
            this.ctx.fillRect(posX + half, posY + half, half, half); // Bottom-Right
            break;
          default:
            this.ctx.fillStyle = "#ff00ff"; // Error Pink
        }

        // Draw the tile square
        this.ctx.fillRect(posX, posY, this.tileSize, this.tileSize);

        // Draw subtle grid lines for debugging
        this.ctx.strokeStyle = "rgba(0,0,0,0.1)";
        this.ctx.strokeRect(posX, posY, this.tileSize, this.tileSize);
      });
    });
  }
}
