// ─────────────────────────────────────────────────────────────────────
// Smoothed road field
//
// The map is authored on a 64px tile grid, which by itself only ever
// produces 90° corners. Instead of drawing (and colliding against) the
// tiles directly, we rasterise the road tiles at sub-tile resolution,
// box-blur that mask a few times, and treat the 0.5 iso-level of the
// result as the real road edge. Blurring a hard step leaves straight
// edges exactly where they were but rounds corners, with a radius set
// by the blur width.
//
// Both the baked artwork and the physics read from this one field, so
// what you see and what you drive on can't disagree.
// ─────────────────────────────────────────────────────────────────────
const FIELD_SUBDIV = 4; // field cells per tile — 64/4 = 16px cells
const FIELD_BLUR_RADIUS = 2; // cells
const FIELD_BLUR_PASSES = 3; // ≈39px sigma → ≈50px corner radius
const ROAD_ISO = 0.5;

// Road edge treatments, in world pixels
const RUMBLE_WIDTH = 6;
const RUMBLE_DASH = 14;
const AO_SIZE = 6;

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// One separable box-blur pass with clamped edges, via a sliding sum.
function boxBlurAxis(src, dst, w, h, radius, horizontal) {
  const norm = 1 / (radius * 2 + 1);
  const outer = horizontal ? h : w;
  const inner = horizontal ? w : h;
  const step = horizontal ? 1 : w;

  for (let o = 0; o < outer; o++) {
    const base = horizontal ? o * w : o;
    const tap = (i) => src[base + Math.min(inner - 1, Math.max(0, i)) * step];

    let sum = 0;
    for (let i = -radius; i <= radius; i++) sum += tap(i);

    for (let i = 0; i < inner; i++) {
      dst[base + i * step] = sum * norm;
      sum -= tap(i - radius);
      sum += tap(i + radius + 1);
    }
  }
}

class Track {
  constructor(ctx) {
    this.ctx = ctx;
    this.data = null;
    this.tileSize = 64;
    this.bakedCanvas = null;

    // Smoothed roadness field
    this.field = null;
    this.fieldW = 0;
    this.fieldH = 0;
    this.fieldCell = 0;
    this.roadPath = null;

    this.grainTile = null;
  }

  async load(url) {
    const response = await fetch(url);
    this.data = await response.json();
    this.tileSize = this.data.tileSize;
    this.bake(); // draw once, never again
  }

  // ───────────────────────────────────────────────────────────────────
  // Field
  // ───────────────────────────────────────────────────────────────────

  buildRoadField() {
    const map = this.data.map;
    const rows = map.length;
    const cols = map[0].length;
    const sub = FIELD_SUBDIV;
    const fw = cols * sub;
    const fh = rows * sub;

    let src = new Float32Array(fw * fh);
    for (let cy = 0; cy < fh; cy++) {
      const row = map[(cy / sub) | 0];
      for (let cx = 0; cx < fw; cx++) {
        const id = row[(cx / sub) | 0];
        if (id >= 2 && id <= 9) src[cy * fw + cx] = 1;
      }
    }

    const dst = new Float32Array(fw * fh);
    for (let p = 0; p < FIELD_BLUR_PASSES; p++) {
      boxBlurAxis(src, dst, fw, fh, FIELD_BLUR_RADIUS, true);
      boxBlurAxis(dst, src, fw, fh, FIELD_BLUR_RADIUS, false);
    }

    this.field = src;
    this.fieldW = fw;
    this.fieldH = fh;
    this.fieldCell = this.tileSize / sub;
  }

  // Bilinear "roadness" at a world position. 1 = deep tarmac, 0 = well
  // clear of it, 0.5 = exactly on the visible edge.
  sampleRoad(x, y) {
    if (!this.field) return 1;
    const w = this.fieldW;
    const h = this.fieldH;
    const cell = this.fieldCell;

    let gx = x / cell - 0.5;
    let gy = y / cell - 0.5;
    if (gx < 0) gx = 0;
    else if (gx > w - 1) gx = w - 1;
    if (gy < 0) gy = 0;
    else if (gy > h - 1) gy = h - 1;

    const x0 = gx | 0;
    const y0 = gy | 0;
    const x1 = Math.min(x0 + 1, w - 1);
    const y1 = Math.min(y0 + 1, h - 1);
    const fx = gx - x0;
    const fy = gy - y0;

    const f = this.field;
    const top = f[y0 * w + x0] * (1 - fx) + f[y0 * w + x1] * fx;
    const bot = f[y1 * w + x0] * (1 - fx) + f[y1 * w + x1] * fx;
    return top * (1 - fy) + bot * fy;
  }

  // 0 = solidly on tarmac, 1 = fully off it. Ramps over roughly ±20px
  // around the road edge rather than snapping at a tile boundary, so
  // clipping a kerb bleeds grip progressively.
  offRoad(x, y) {
    return 1 - smoothstep(0.3, 0.7, this.sampleRoad(x, y));
  }

  // ───────────────────────────────────────────────────────────────────
  // Contour extraction (marching squares at the 0.5 iso-level)
  // ───────────────────────────────────────────────────────────────────

  traceRoadContours() {
    const f = this.field;
    const w = this.fieldW;
    const h = this.fieldH;
    const cell = this.fieldCell;

    const pts = new Map(); // edge key → intersection point
    const segs = []; // [entryKey, exitKey], oriented road-on-the-left
    const adj = new Map(); // edge key → segment indices

    const at = (i, j) => f[j * w + i];

    // Every intersection lies on a unique lattice edge, so keying by
    // that edge makes neighbouring cells agree on the point exactly.
    const hPoint = (i, j) => {
      const k = `h${i},${j}`;
      if (!pts.has(k)) {
        const v0 = at(i, j);
        const t = (ROAD_ISO - v0) / (at(i + 1, j) - v0);
        pts.set(k, { x: (i + 0.5 + t) * cell, y: (j + 0.5) * cell });
      }
      return k;
    };
    const vPoint = (i, j) => {
      const k = `v${i},${j}`;
      if (!pts.has(k)) {
        const v0 = at(i, j);
        const t = (ROAD_ISO - v0) / (at(i, j + 1) - v0);
        pts.set(k, { x: (i + 0.5) * cell, y: (j + 0.5 + t) * cell });
      }
      return k;
    };

    const addSeg = (ka, kb) => {
      const idx = segs.length;
      segs.push([ka, kb]);
      for (const k of [ka, kb]) {
        const list = adj.get(k);
        if (list) list.push(idx);
        else adj.set(k, [idx]);
      }
    };

    for (let j = 0; j < h - 1; j++) {
      for (let i = 0; i < w - 1; i++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i + 1, j + 1);
        const d = at(i, j + 1);

        let code = 0;
        if (a >= ROAD_ISO) code |= 1;
        if (b >= ROAD_ISO) code |= 2;
        if (c >= ROAD_ISO) code |= 4;
        if (d >= ROAD_ISO) code |= 8;
        if (code === 0 || code === 15) continue;

        const T = () => hPoint(i, j);
        const B = () => hPoint(i, j + 1);
        const L = () => vPoint(i, j);
        const R = () => vPoint(i + 1, j);

        switch (code) {
          case 1: addSeg(L(), T()); break;
          case 2: addSeg(T(), R()); break;
          case 3: addSeg(L(), R()); break;
          case 4: addSeg(R(), B()); break;
          case 6: addSeg(T(), B()); break;
          case 7: addSeg(L(), B()); break;
          case 8: addSeg(B(), L()); break;
          case 9: addSeg(B(), T()); break;
          case 11: addSeg(B(), R()); break;
          case 12: addSeg(R(), L()); break;
          case 13: addSeg(R(), T()); break;
          case 14: addSeg(T(), L()); break;
          // Saddles — the cell centre decides which way the road joins up
          case 5:
            if ((a + b + c + d) / 4 >= ROAD_ISO) {
              addSeg(R(), T());
              addSeg(L(), B());
            } else {
              addSeg(L(), T());
              addSeg(R(), B());
            }
            break;
          case 10:
            if ((a + b + c + d) / 4 >= ROAD_ISO) {
              addSeg(T(), L());
              addSeg(B(), R());
            } else {
              addSeg(T(), R());
              addSeg(B(), L());
            }
            break;
        }
      }
    }

    // Chain segments into closed loops. Orientation is consistent across
    // a loop, so outer boundaries and holes wind opposite ways and a
    // nonzero fill punches the holes out for free.
    const used = new Array(segs.length).fill(false);
    const loops = [];

    for (let s = 0; s < segs.length; s++) {
      if (used[s]) continue;
      const loop = [];
      let cur = s;
      let entry = segs[s][0];

      for (;;) {
        used[cur] = true;
        const [ka, kb] = segs[cur];
        const exit = ka === entry ? kb : ka;
        loop.push(pts.get(entry));

        const next = (adj.get(exit) || []).find((n) => !used[n]);
        if (next === undefined) {
          loop.push(pts.get(exit));
          break;
        }
        entry = exit;
        cur = next;
      }

      if (loop.length > 2) loops.push(loop);
    }

    return loops;
  }

  buildRoadPath(loops) {
    const path = new Path2D();
    for (const loop of loops) {
      path.moveTo(loop[0].x, loop[0].y);
      for (let i = 1; i < loop.length; i++) path.lineTo(loop[i].x, loop[i].y);
      path.closePath();
    }
    return path;
  }

  // ───────────────────────────────────────────────────────────────────
  // Baking
  // ───────────────────────────────────────────────────────────────────

  bake() {
    const cols = this.data.map[0].length;
    const rows = this.data.map.length;

    this.buildRoadField();

    this.bakedCanvas = document.createElement("canvas");
    this.bakedCanvas.width = cols * this.tileSize;
    this.bakedCanvas.height = rows * this.tileSize;

    const bCtx = this.bakedCanvas.getContext("2d");

    this.paintTerrain(bCtx);

    this.roadPath = this.buildRoadPath(this.traceRoadContours());
    this.paintRoad(bCtx);
    this.paintRumbleStrips(bCtx);
    this.paintFinishLine(bCtx);
    this.paintEdgeShading(bCtx);
  }

  // Grass and walls. Grass goes under every non-wall tile, including the
  // road ones — the smoothed road is painted over the top, and rounding a
  // corner exposes a little of the grass that was hiding beneath it.
  paintTerrain(bCtx) {
    const ts = this.tileSize;

    this.data.map.forEach((row, ty) => {
      row.forEach((tileID, tx) => {
        const posX = tx * ts;
        const posY = ty * ts;

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
        // GRASS (everything else)
        // ─────────────────────────────────────────
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
      });
    });
  }

  // Deterministic speckle tile, repeated across the road as asphalt grain.
  makeGrainTile() {
    if (this.grainTile) return this.grainTile;

    const size = 64;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const g = c.getContext("2d");

    let seed = 1337;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

    for (let i = 0; i < 260; i++) {
      const px = Math.floor(rnd() * size);
      const py = Math.floor(rnd() * size);
      const sz = 1 + Math.floor(rnd() * 2);
      g.fillStyle =
        rnd() < 0.6
          ? `rgba(0,0,0,${0.04 + rnd() * 0.06})`
          : `rgba(255,255,255,${0.02 + rnd() * 0.03})`;
      g.fillRect(px, py, sz, sz);
    }

    this.grainTile = c;
    return c;
  }

  paintRoad(bCtx) {
    bCtx.fillStyle = "#3a3a3a";
    bCtx.fill(this.roadPath);

    bCtx.save();
    bCtx.clip(this.roadPath);
    bCtx.fillStyle = bCtx.createPattern(this.makeGrainTile(), "repeat");
    bCtx.fillRect(0, 0, this.bakedCanvas.width, this.bakedCanvas.height);
    bCtx.restore();
  }

  // Stroking the contour and clipping to the road leaves a band hugging
  // the inside of the edge; the dash pattern is spaced along the contour's
  // own arc length, so stripes stay square to the road through corners.
  paintRumbleStrips(bCtx) {
    bCtx.save();
    bCtx.clip(this.roadPath);
    bCtx.lineWidth = RUMBLE_WIDTH * 2;
    bCtx.lineCap = "butt";
    bCtx.setLineDash([RUMBLE_DASH, RUMBLE_DASH]);

    bCtx.strokeStyle = "#CC0000";
    bCtx.lineDashOffset = 0;
    bCtx.stroke(this.roadPath);

    bCtx.strokeStyle = "#FFDD00";
    bCtx.lineDashOffset = RUMBLE_DASH;
    bCtx.stroke(this.roadPath);

    bCtx.restore();
  }

  paintFinishLine(bCtx) {
    const ts = this.tileSize;
    const half = ts / 2;

    bCtx.save();
    bCtx.clip(this.roadPath);
    this.data.map.forEach((row, ty) => {
      row.forEach((tileID, tx) => {
        if (tileID !== 8 && tileID !== 9) return;
        const posX = tx * ts;
        const posY = ty * ts;
        bCtx.fillStyle = "#FFFFFF";
        bCtx.fillRect(posX, posY, ts, ts);
        bCtx.fillStyle = "#000000";
        bCtx.fillRect(posX, posY, half, half);
        bCtx.fillRect(posX + half, posY + half, half, half);
      });
    });
    bCtx.restore();
  }

  // Faux ambient occlusion — nested strokes of decreasing width clipped to
  // the road accumulate into a soft gradient along the whole edge.
  paintEdgeShading(bCtx) {
    bCtx.save();
    bCtx.clip(this.roadPath);
    bCtx.strokeStyle = "rgba(0,0,0,0.035)";
    for (let i = AO_SIZE; i >= 1; i--) {
      bCtx.lineWidth = i * 2;
      bCtx.stroke(this.roadPath);
    }
    bCtx.restore();
  }

  draw() {
    if (!this.bakedCanvas) return;
    // Single drawImage instead of hundreds of fillRect calls
    this.ctx.drawImage(this.bakedCanvas, 0, 0);
  }
}
