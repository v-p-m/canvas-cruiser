// ─────────────────────────────────────────────────────────────────────
// Car sprites — the open-wheel car every entrant drives, as a pixel grid
// baked to a canvas rather than shipped as a PNG.
//
// One grid, one hex per car: the body colour is substituted at bake time
// and its shade and highlight are derived from it, so adding a rival is a
// colour in SPAWN_POSITIONS and nothing else. That is also why the art is
// here as text — a recolour or a nudged pixel is a readable diff, which a
// binary sprite sheet never is.
//
// The bake is sized in device pixels, so the draw call downstream is 1:1
// and never resamples the pixel grid; `invalidate()` drops the cache when
// resizeCanvas() changes the render scale. Rotation stays live and
// smoothed — it anti-aliases the silhouette without touching the blocks
// inside it, and pre-rotated frames would cost 64 bakes a car to remove a
// shimmer nothing at this size shows.
// ─────────────────────────────────────────────────────────────────────

const CAR_SPRITE_W = 34; // px, matches car.width / AICar.width
const CAR_SPRITE_H = 56; // px, matches car.height / AICar.height

// Nose up, because that is the orientation ctx.rotate(entity.angle) expects.
//
//   B body (per-car colour)   D its shade, flanks and seams   L its highlight
//   T tyre   t sidewall sheen   W wing   w wing plane   G helmet   K shadow
// prettier-ignore
const CAR_PIXELS = [
  "..BBBWWWWWWWWWWWWWWWWWWWWWWWWBBB..",
  "..BBBwwwwwwwwwwwwwwwwwwwwwwwwBBB..",
  "..BBBwwwwwwwwwwwwwwwwwwwwwwwwBBB..",
  "..BBBWWWWWWWWWWWWWWWWWWWWWWWWBBB..",
  "..BBB..........DBBD..........BBB..",
  "..BBB..........DBBD..........BBB..",
  "..TTTT.........DBBD.........TTTT..",
  ".TTTTTT........DBBD........TTTTTT.",
  ".TTtTTT.......DBBBBD.......TTtTTT.",
  ".TTtTTTDDDDDDDDBBBBDDDDDDDDTTtTTT.",
  ".TTtTTT.......DBBBBD.......TTtTTT.",
  ".TTtTTT.......DBBBBD.......TTtTTT.",
  ".TTtTTT.......DBBBBD.......TTtTTT.",
  ".TTtTTT.......DBBBBD.......TTtTTT.",
  ".TTtTTTDDDDDDDDBBBBDDDDDDDDTTtTTT.",
  ".TTtTTT.......DBBBBD.......TTtTTT.",
  ".TTTTTT.......DBBBBD.......TTTTTT.",
  "..TTTT........DBBBBD........TTTT..",
  "..............DBBBBD..............",
  ".............DBBLLBBD.............",
  ".............DBBLLBBD.............",
  ".............DBBLLBBD.............",
  ".............DBBLLBBD.............",
  ".............DBBLLBBD.............",
  ".............DBBLLBBD.............",
  "...........DBBDDDDDDBBD...........",
  "..........DBBBDKKKKDBBBD..........",
  "........DBBBBBDGGGGDBBBBBD........",
  "........DKKKDBDKKKKDBDKKKD........",
  "........DKKKDBDGGGGDBDKKKD........",
  "........DBBBDBDGGGGDBDBBBD........",
  "........DBBBDBDGGGGDBDBBBD........",
  "........DBBBDBDKKKKDBDBBBD........",
  "........DBBBDBDDDDDDBDBBBD........",
  "........DBBBDBBDDDDBBDBBBD........",
  "........DBBBDBBDLLDBBDBBBD........",
  "........DBBBDBBDLLDBBDBBBD........",
  "........DBBBDBBDLLDBBDBBBD........",
  ".TTTTT..DBBBDBBDLLDBBDBBBD..TTTTT.",
  "TTTTTTT.DBBBDBBBLLBBBDBBBD.TTTTTTT",
  "TTTtTTT.DBBBDBBBLLBBBDBBBD.TTTtTTT",
  "TTTtTTTDDDBBDBBBLLBBBDBBDDDTTTtTTT",
  "TTTtTTT.DBBBDBBBLLBBBDBBBD.TTTtTTT",
  "TTTtTTT.DBBBDBBBLLBBBDBBBD.TTTtTTT",
  "TTTtTTT..DBBDBBBLLBBBDBBD..TTTtTTT",
  "TTTtTTT...DBBBBBLLBBBBBD...TTTtTTT",
  "TTTtTTT...DBBBBBLLBBBBBD...TTTtTTT",
  "TTTtTTTDDD.DBBBBLLBBBBD.DDDTTTtTTT",
  "TTTtTTT.....DBBBLLBBBD.....TTTtTTT",
  "TTTtTTT.....DBBBLLBBBD.....TTTtTTT",
  "TTTTTTT.....DBBBLLBBBD.....TTTTTTT",
  ".TTTTT......DBBBLLBBBD......TTTTT.",
  "...BBBWWWWWWWWWWWWWWWWWWWWWWBBB...",
  "...BBBwwwwwwwwwwwwwwwwwwwwwwBBB...",
  "...BBBwwwwwwwwwwwwwwwwwwwwwwBBB...",
  "...BBBWWWWWWWWWWWWWWWWWWWWWWBBB...",
];

// Everything not the body colour. The wing is neutral so five cars still
// read as one grid of machinery with five liveries on it.
const CAR_PALETTE = {
  T: "#1a1a1a",
  t: "#4a4a4a",
  W: "#2a2a2a",
  w: "#3c3c3c",
  G: "#dddde6",
  K: "#141414",
};

// Mix a hex toward black or white. Shading each livery off its own body
// colour keeps a green car's shadow green instead of grey.
function mixColor(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  const ch = (shift) => {
    const v = (n >> shift) & 0xff;
    return Math.round(v + (target - v) * t);
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

const CarSprites = {
  cache: new Map(),

  get(color) {
    let sprite = this.cache.get(color);
    if (!sprite) {
      sprite = this.bake(color);
      this.cache.set(color, sprite);
    }
    return sprite;
  },

  bake(color) {
    const scale = renderDpr;
    const c = document.createElement("canvas");
    c.width = Math.round(CAR_SPRITE_W * scale);
    c.height = Math.round(CAR_SPRITE_H * scale);
    const g = c.getContext("2d");

    const palette = {
      ...CAR_PALETTE,
      B: color,
      D: mixColor(color, -0.55),
      L: mixColor(color, 0.3),
    };

    // Runs of the same colour go out as one fillRect: at 34 px wide most
    // rows are three or four spans, not thirty-four cells.
    for (let y = 0; y < CAR_PIXELS.length; y++) {
      const row = CAR_PIXELS[y];
      let x = 0;
      while (x < row.length) {
        const ch = row[x];
        let end = x;
        while (end < row.length && row[end] === ch) end++;
        if (ch !== ".") {
          g.fillStyle = palette[ch];
          g.fillRect(
            Math.round(x * scale),
            Math.round(y * scale),
            Math.round(end * scale) - Math.round(x * scale),
            Math.round((y + 1) * scale) - Math.round(y * scale),
          );
        }
        x = end;
      }
    }
    return c;
  },

  // The bakes are sized against renderDpr, so they are wrong the moment it
  // moves — a window resize, the Quality ladder, or the Max dpr slider.
  invalidate() {
    this.cache.clear();
  },
};
