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

// The two front tyres, as boxes in the pixel grid below. They are lifted out
// of the body bake and drawn as their own images so they can be rotated on
// top of it — an open-wheeler whose front wheels never move reads as a decal.
// The suspension arms are deliberately outside the boxes: they stay welded to
// the tub while the wheel turns, which is what the real linkage does.
const FRONT_WHEELS = [
  { x: 1, y: 6, w: 6, h: 12 },
  { x: 27, y: 6, w: 6, h: 12 },
];

const MAX_STEER_ANGLE = 0.42; // rad — visual lock, not a physics quantity

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

function inFrontWheel(x, y) {
  return FRONT_WHEELS.some(
    (b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h,
  );
}

const CarSprites = {
  cache: new Map(),
  wheelSprite: null,

  get(color) {
    let sprite = this.cache.get(color);
    if (!sprite) {
      sprite = this.bake(color);
      this.cache.set(color, sprite);
    }
    return sprite;
  },

  // One wheel serves every car and both sides: the tyre carries no body
  // colour, and the grid is symmetric about the car's centreline.
  wheel() {
    if (!this.wheelSprite) {
      const b = FRONT_WHEELS[0];
      this.wheelSprite = this.bakeRegion(null, b.x, b.y, b.w, b.h);
    }
    return this.wheelSprite;
  },

  bake(color) {
    return this.bakeRegion(color, 0, 0, CAR_SPRITE_W, CAR_SPRITE_H, true);
  },

  // Bakes the slice of the grid inside (ox, oy, w, h). `skipWheels` blanks
  // the front-tyre boxes so the body and the wheels are never drawn twice.
  bakeRegion(color, ox, oy, w, h, skipWheels = false) {
    const scale = renderDpr;
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const g = c.getContext("2d");

    const palette = {
      ...CAR_PALETTE,
      B: color,
      D: mixColor(color || "#888888", -0.55),
      L: mixColor(color || "#888888", 0.3),
    };

    // Runs of the same colour go out as one fillRect: at 34 px wide most
    // rows are three or four spans, not thirty-four cells.
    for (let y = oy; y < oy + h; y++) {
      const row = CAR_PIXELS[y];
      let x = ox;
      while (x < ox + w) {
        const ch = row[x];
        let end = x;
        while (end < ox + w && row[end] === ch) end++;
        if (ch !== "." && !(skipWheels && inFrontWheel(x, y))) {
          g.fillStyle = palette[ch];
          g.fillRect(
            Math.round((x - ox) * scale),
            Math.round((y - oy) * scale),
            Math.round((end - ox) * scale) - Math.round((x - ox) * scale),
            Math.round((y + 1 - oy) * scale) - Math.round((y - oy) * scale),
          );
        }
        x = end;
      }
    }
    return c;
  },

  // The whole car, centred on (entity.x, entity.y) in world space and turned
  // to entity.angle. Body and steered wheels are one call so no draw site can
  // ship a car missing its front tyres.
  draw(ctx, entity, color) {
    const sx = entity.width / CAR_SPRITE_W;
    const sy = entity.height / CAR_SPRITE_H;
    const steer = (entity.steer || 0) * MAX_STEER_ANGLE;

    ctx.save();
    ctx.translate(entity.x - camera.x, entity.y - camera.y); // screen space
    ctx.rotate(entity.angle);

    ctx.drawImage(
      this.get(color),
      -entity.width / 2,
      -entity.height / 2,
      entity.width,
      entity.height,
    );

    const wheel = this.wheel();
    for (const b of FRONT_WHEELS) {
      const cx = (b.x + b.w / 2 - CAR_SPRITE_W / 2) * sx;
      const cy = (b.y + b.h / 2 - CAR_SPRITE_H / 2) * sy;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(steer);
      ctx.drawImage(
        wheel,
        (-b.w / 2) * sx,
        (-b.h / 2) * sy,
        b.w * sx,
        b.h * sy,
      );
      ctx.restore();
    }

    ctx.restore();
  },

  // The bakes are sized against renderDpr, so they are wrong the moment it
  // moves — a window resize, the Quality ladder, or the Max dpr slider.
  invalidate() {
    this.cache.clear();
    this.wheelSprite = null;
  },
};

// Steering angle for the artwork, from the yaw the entity actually produced
// this frame — the player and the AI turn through completely different code
// but both end up moving `angle`, so reading the result covers both and
// nothing has to be plumbed through the input handler or the waypoint follower.
function updateSteerVisual(entity, delta) {
  const STEER_RETURN = 0.25; // per frame, toward the new lock
  const prev = entity.prevAngle === undefined ? entity.angle : entity.prevAngle;
  const turned = Math.atan2(
    Math.sin(entity.angle - prev),
    Math.cos(entity.angle - prev),
  );
  entity.prevAngle = entity.angle;

  const rate = delta > 0 ? turned / delta : 0;
  const target = Math.max(-1, Math.min(1, rate / (entity.turnSpeed || 0.06)));
  const steer = entity.steer || 0;
  entity.steer = steer + (target - steer) * Math.min(1, STEER_RETURN * delta);
}
