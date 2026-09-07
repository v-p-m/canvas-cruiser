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

// Finish line, in world pixels. The square must divide the tile size so
// the checker stays in phase across a run of finish tiles.
const FINISH_THICKNESS = 24;
const FINISH_SQUARE = 8;

// Dirt run-off. The tile grid only knows "dirt" or "not dirt", so the
// coverage field is blurred wide and then pushed around by noise: the
// 0.5 crossing wanders, strands patches of dirt out in the grass and
// tufts of grass back into the dirt, and never lines up with a tile.
const DIRT_BLUR_PASSES = 3;
const DIRT_NOISE_SCALE = 46; // world px per noise cell
const DIRT_NOISE_AMP = 0.72; // how far the noise drags the edge
const DIRT_EDGE_SOFTNESS = 0.06; // field units of feathering
const DIRT_COLOR = [138, 90, 43];
const GRASS_COLOR = [45, 90, 39];

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Bilinear read of a coverage field at a world position, edges clamped.
function sampleField(field, x, y) {
  const w = field.w;
  const h = field.h;

  let gx = x / field.cell - 0.5;
  let gy = y / field.cell - 0.5;
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

  const f = field.data;
  const top = f[y0 * w + x0] * (1 - fx) + f[y0 * w + x1] * fx;
  const bot = f[y1 * w + x0] * (1 - fx) + f[y1 * w + x1] * fx;
  return top * (1 - fy) + bot * fy;
}

// Deterministic 2D hash → [0,1), and the value noise built on it.
function hash2(ix, iy) {
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);

  return (
    (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy
  );
}

// Two octaves is enough to keep the terrain edge from reading as a
// single wobble without costing a third pass over every pixel.
function fbm2(x, y) {
  return valueNoise(x, y) * 0.65 + valueNoise(x * 2.7 + 31.4, y * 2.7 + 17.9) * 0.35;
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

    // Cached ground artwork, and the dirt layout it was rendered for
    this.groundCanvas = null;
    this.groundKey = null;
  }

  async load(url) {
    const response = await fetch(`${url}?v=${window.BUILD}`);
    this.data = await response.json();
    this.tileSize = this.data.tileSize;
    this.bake(); // draw once, never again
  }

  // ───────────────────────────────────────────────────────────────────
  // Field
  // ───────────────────────────────────────────────────────────────────

  // Rasterise the tiles matching `match` at sub-tile resolution and blur,
  // giving a smooth 0..1 coverage field over the map.
  buildField(match, passes) {
    const map = this.data.map;
    const sub = FIELD_SUBDIV;
    const fw = map[0].length * sub;
    const fh = map.length * sub;

    const src = new Float32Array(fw * fh);
    for (let cy = 0; cy < fh; cy++) {
      const row = map[(cy / sub) | 0];
      for (let cx = 0; cx < fw; cx++) {
        if (match(row[(cx / sub) | 0])) src[cy * fw + cx] = 1;
      }
    }

    const dst = new Float32Array(fw * fh);
    for (let p = 0; p < passes; p++) {
      boxBlurAxis(src, dst, fw, fh, FIELD_BLUR_RADIUS, true);
      boxBlurAxis(dst, src, fw, fh, FIELD_BLUR_RADIUS, false);
    }

    return { data: src, w: fw, h: fh, cell: this.tileSize / sub };
  }

  buildRoadField() {
    const f = this.buildField((id) => id >= 2 && id <= 9, FIELD_BLUR_PASSES);
    this.field = f.data;
    this.fieldW = f.w;
    this.fieldH = f.h;
    this.fieldCell = f.cell;
  }

  // Bilinear "roadness" at a world position. 1 = deep tarmac, 0 = well
  // clear of it, 0.5 = exactly on the visible edge.
  sampleRoad(x, y) {
    if (!this.field) return 1;
    return sampleField(
      { data: this.field, w: this.fieldW, h: this.fieldH, cell: this.fieldCell },
      x,
      y
    );
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

  // Grass, and dirt run-off on the border tiles. Terrain goes under every
  // tile, including the road ones — the smoothed road is painted over the
  // top, and rounding a corner exposes a little of what was hiding beneath.
  //
  // Tile 1 is dirt rather than a barrier: it's drivable, just slow. The
  // map edge itself is the hard limit (see clampToWorld in game.js).
  paintTerrain(bCtx) {
    const ts = this.tileSize;

    this.paintGround(bCtx);

    this.data.map.forEach((row, ty) => {
      row.forEach((tileID, tx) => {
        const posX = tx * ts;
        const posY = ty * ts;

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

  // Grass and dirt as one continuous surface. Rather than filling tiles,
  // every pixel picks its colour from the blurred dirt coverage nudged by
  // noise, so the two meet along a ragged natural edge; a slow mottle over
  // the top keeps both from reading as flat paint.
  //
  // This is ~95% of the cost of a bake and depends on nothing but the dirt
  // tiles, so the result is kept and re-blitted. The track editor re-bakes on
  // every painted tile; without the cache, each one costs a full re-render.
  paintGround(bCtx) {
    const key = this.dirtKey();
    if (!this.groundCanvas || this.groundKey !== key) {
      this.groundCanvas = this.renderGround();
      this.groundKey = key;
    }
    bCtx.drawImage(this.groundCanvas, 0, 0);
  }

  // Identifies the only input the ground artwork has: which tiles are dirt,
  // and how big the map is.
  dirtKey() {
    const rows = this.data.map.map((row) =>
      row.map((id) => (id === 1 ? "1" : "0")).join("")
    );
    return `${this.tileSize}|${rows.join(",")}`;
  }

  renderGround() {
    const w = this.data.map[0].length * this.tileSize;
    const h = this.data.map.length * this.tileSize;

    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");

    const dirt = this.buildField((id) => id === 1, DIRT_BLUR_PASSES);

    const img = g.createImageData(w, h);
    const px = img.data;

    const edgeScale = 1 / DIRT_NOISE_SCALE;
    const lo = 0.5 - DIRT_EDGE_SOFTNESS;
    const hi = 0.5 + DIRT_EDGE_SOFTNESS;

    const [gr, gg, gb] = GRASS_COLOR;
    const [dr, dg, db] = DIRT_COLOR;

    // Three million iterations, so the two samplers are unrolled by hand
    // rather than called: the dirt field's row indices and vertical weights
    // are fixed per scanline, and the mottle noise only needs re-hashing when
    // it crosses a lattice cell — every 50px, not every pixel. The arithmetic
    // is in the same order as sampleField/valueNoise, so the output is
    // bit-identical to calling them.
    const fd = dirt.data;
    const fw = dirt.w;
    const fh = dirt.h;
    const cell = dirt.cell;

    let i = 0;
    for (let y = 0; y < h; y++) {
      let gy = y / cell - 0.5;
      if (gy < 0) gy = 0;
      else if (gy > fh - 1) gy = fh - 1;
      const y0 = gy | 0;
      const y1 = Math.min(y0 + 1, fh - 1);
      const fy = gy - y0;
      const rowTop = y0 * fw;
      const rowBot = y1 * fw;

      const ny = y * edgeScale;

      const my = y * 0.02;
      const miy = Math.floor(my);
      const mfy = my - miy;
      const muy = mfy * mfy * (3 - 2 * mfy);
      let mix = NaN; // forces a hash on the first pixel of every row
      let ma = 0;
      let mb = 0;
      let mc = 0;
      let md = 0;

      for (let x = 0; x < w; x++, i += 4) {
        let gx = x / cell - 0.5;
        if (gx < 0) gx = 0;
        else if (gx > fw - 1) gx = fw - 1;
        const x0 = gx | 0;
        const x1 = Math.min(x0 + 1, fw - 1);
        const fx = gx - x0;

        const top = fd[rowTop + x0] * (1 - fx) + fd[rowTop + x1] * fx;
        const bot = fd[rowBot + x0] * (1 - fx) + fd[rowBot + x1] * fx;
        const d = top * (1 - fy) + bot * fy;

        // The noise only matters where the two surfaces actually meet.
        let cover;
        if (d <= 0.001) cover = 0;
        else if (d >= 0.999) cover = 1;
        else {
          const n = (fbm2(x * edgeScale, ny) - 0.5) * DIRT_NOISE_AMP;
          cover = smoothstep(lo, hi, d + n);
        }

        const mx = x * 0.02;
        const mixNow = Math.floor(mx);
        if (mixNow !== mix) {
          mix = mixNow;
          ma = hash2(mixNow, miy);
          mb = hash2(mixNow + 1, miy);
          mc = hash2(mixNow, miy + 1);
          md = hash2(mixNow + 1, miy + 1);
        }
        const mfx = mx - mixNow;
        const mux = mfx * mfx * (3 - 2 * mfx);
        const m =
          0.92 +
          ((ma * (1 - mux) + mb * mux) * (1 - muy) +
            (mc * (1 - mux) + md * mux) * muy) *
            0.16;

        px[i] = (gr + (dr - gr) * cover) * m;
        px[i + 1] = (gg + (dg - gg) * cover) * m;
        px[i + 2] = (gb + (db - gb) * cover) * m;
        px[i + 3] = 255;
      }
    }

    g.putImageData(img, 0, 0);
    return c;
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
    bCtx.fillStyle = "#8b8b8b";
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

    bCtx.strokeStyle = "#D42A2A";
    bCtx.lineDashOffset = 0;
    bCtx.stroke(this.roadPath);

    bCtx.strokeStyle = "#F5F5F5";
    bCtx.lineDashOffset = RUMBLE_DASH;
    bCtx.stroke(this.roadPath);

    bCtx.restore();
  }

  // The finish tiles are whole 64px cells, but the painted line is a thin
  // band down the middle of them: it runs across the track, so it stays
  // thin along whichever axis the run of finish tiles doesn't extend.
  // Checker squares are placed on a world-aligned grid so consecutive
  // tiles of the same run join up seamlessly.
  paintFinishLine(bCtx) {
    const ts = this.tileSize;
    const map = this.data.map;
    const isFinish = (tx, ty) =>
      map[ty] !== undefined && (map[ty][tx] === 8 || map[ty][tx] === 9);

    bCtx.save();
    bCtx.clip(this.roadPath);

    map.forEach((row, ty) => {
      row.forEach((tileID, tx) => {
        if (tileID !== 8 && tileID !== 9) return;

        const across = isFinish(tx, ty - 1) || isFinish(tx, ty + 1);
        const inset = (ts - FINISH_THICKNESS) / 2;
        const x = tx * ts + (across ? inset : 0);
        const y = ty * ts + (across ? 0 : inset);
        const w = across ? FINISH_THICKNESS : ts;
        const h = across ? ts : FINISH_THICKNESS;

        bCtx.save();
        bCtx.beginPath();
        bCtx.rect(x, y, w, h);
        bCtx.clip();

        bCtx.fillStyle = "#FFFFFF";
        bCtx.fillRect(x, y, w, h);

        bCtx.fillStyle = "#000000";
        const i0 = Math.floor(x / FINISH_SQUARE);
        const j0 = Math.floor(y / FINISH_SQUARE);
        const i1 = Math.ceil((x + w) / FINISH_SQUARE);
        const j1 = Math.ceil((y + h) / FINISH_SQUARE);
        for (let j = j0; j < j1; j++) {
          for (let i = i0; i < i1; i++) {
            if ((i + j) % 2 !== 0) continue;
            bCtx.fillRect(
              i * FINISH_SQUARE,
              j * FINISH_SQUARE,
              FINISH_SQUARE,
              FINISH_SQUARE
            );
          }
        }

        bCtx.restore();
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
