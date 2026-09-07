// ─────────────────────────────────────────
// NIGHT SYSTEM
//
// Night is scheduled per race in game.js, alongside — and independently of —
// the weather, so a race can be dry-day, wet-day, dry-night or a night
// thunderstorm. It is purely visual: no grip, no speed, no AI change. The
// opponents can "see" as well as they ever could, which is deliberate, since
// anything that cost the player pace and not them would be exactly the
// asymmetry CLAUDE.md warns about.
//
// The dark and the light are one layer, built at MASK_SCALE and blitted over
// the scene once — see `drawLightLayer`, which is where the whole technique
// and the measurements behind it are written down. Everything that layer is
// drawn from is baked once and blitted per light: forty live gradients a frame
// is how this would get expensive.
//
// Sizes come from `camera`, not `canvas`: on a HiDPI display the canvas
// backing store is bigger than the drawing surface by devicePixelRatio.
// ─────────────────────────────────────────
const Night = {
  active: false,
  intensity: 0, // 0→1, lerps toward targetIntensity
  targetIntensity: 0,
  lights: [], // world-space floodlights around the circuit

  // How dark it gets where nothing is lit. Not 1 — a silhouette of the kerb
  // you are about to hit is worth more than the atmosphere of losing it.
  DARKNESS: 0.88,
  WET_EXTRA: 0.06, // added under rain: a storm at night is darker than a clear one
  NIGHT_COLOR: "#060b1a",
  FADE: 0.01, // intensity per frame — ~1.7s, so the lights come up over the countdown

  MASK_SCALE: 0.5, // veil resolution as a fraction of CSS px

  // --- Floodlights ---
  LIGHT_SPACING: 250, // world px along the racing line between pylons
  LIGHT_REACH: 170, // world px the search for the verge gives up at
  LIGHT_VERGE: 30, // world px past the road edge the pylon stands
  LIGHT_RADIUS: 175, // world px of the lit pool
  // The pylon stands on the verge but its lamp is aimed across the circuit, so
  // the pool is thrown this far inboard of the mast. Centred on the mast
  // instead, most of every floodlight lands on the grass.
  POOL_OFFSET: 80, // world px toward the track
  // Low, because the hole cut in the veil is what makes a pool read as lit —
  // this is only the colour of the light on top of it.
  POOL_ALPHA: 0.2, // warm wash over the tarmac under one
  HOLE_SPREAD: 1.0, // how far out the veil clears, as a multiple of the pool
  MAX_LIGHTS: 72,

  // --- Headlights ---
  HEAD_REACH: 300, // world px the beam throws
  HEAD_SPREAD: 0.34, // rad, half-angle of one beam
  HEAD_SPACING: 11, // world px between the two lamps
  HEAD_ALPHA: 0.3, // warm wash along the beam
  TAIL_ALPHA: 0.55,

  // --- Liveries ---
  // The one thing the veil cannot reach is a car standing in a floodlight, and
  // six liveries lit like noon were the only daytime objects left on a night
  // circuit. Physically a lit car should be lit; it looks better dark, and the
  // tail lights have something to be brighter than.
  LIVERY_DIM: 0.5, // how far the paint is pulled toward the night at full dark
  LIVERY_STEPS: 4, // quantised — see liveryDim()

  _mask: null,
  _maskCtx: null,
  _pool: null, // baked radial gradient, warm
  _hole: null, // baked radial gradient, white — what cuts the veil
  _beams: null, // baked twin cone, apexes at the bottom edge pointing up

  toggle() {
    this.targetIntensity = this.targetIntensity === 0 ? 1 : 0;
    if (this.targetIntensity > 0) this.active = true;
  },

  clear() {
    this.targetIntensity = 0;
  },

  // ───────────────────────────────────────────────────────────────────
  // Placing the lights
  // ───────────────────────────────────────────────────────────────────

  // Pylons stand on the verge, which means finding it: walk the waypoint
  // polygon at a fixed spacing and march sideways from each station until the
  // road field falls away. Marching beats an offset from the tile grid because
  // the visible edge is the blurred field, not the tile boundary — the same
  // reason the AI clears its ring against `sampleRoad` rather than the map.
  buildLights() {
    this.lights = [];
    if (typeof worldTrack === "undefined" || !worldTrack.data) return;
    const wps = worldTrack.data.waypoints || [];
    if (wps.length < 2) return;

    const worldW = worldTrack.data.map[0].length * worldTrack.data.tileSize;
    const worldH = worldTrack.data.map.length * worldTrack.data.tileSize;

    let side = 1; // alternates, so both verges are lit
    let carry = 0; // distance owed from the previous segment
    for (let i = 0; i < wps.length; i++) {
      const a = wps[i];
      const b = wps[(i + 1) % wps.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const nx = -dy / len;
      const ny = dx / len;

      for (let d = carry; d < len; d += this.LIGHT_SPACING) {
        const t = d / len;
        const px = a.x + dx * t;
        const py = a.y + dy * t;
        const spot =
          this._verge(px, py, nx * side, ny * side) ||
          this._verge(px, py, -nx * side, -ny * side);
        side = -side;
        if (!spot) continue;
        if (spot.x < 8 || spot.y < 8 || spot.x > worldW - 8 || spot.y > worldH - 8)
          continue;
        // A hairpin doubles back on itself, so two stations a long way apart
        // along the line can want the same patch of grass.
        if (
          this.lights.some(
            (l) => Math.hypot(l.x - spot.x, l.y - spot.y) < this.LIGHT_SPACING * 0.5,
          )
        )
          continue;

        this.lights.push({
          x: spot.x,
          y: spot.y,
          // Toward the track, so the lamp head hangs over the kerb it lights
          ax: -spot.nx,
          ay: -spot.ny,
          px: spot.x - spot.nx * this.POOL_OFFSET,
          py: spot.y - spot.ny * this.POOL_OFFSET,
          bright: 0.85 + Math.random() * 0.3, // a stamped-out row reads as wallpaper
        });
        if (this.lights.length >= this.MAX_LIGHTS) return;
      }
      carry = (this.LIGHT_SPACING - ((len - carry) % this.LIGHT_SPACING)) % this.LIGHT_SPACING;
    }
  },

  _verge(px, py, nx, ny) {
    const STEP = 8; // world px
    for (let d = STEP; d <= this.LIGHT_REACH; d += STEP) {
      if (worldTrack.sampleRoad(px + nx * d, py + ny * d) < 0.35) {
        const out = d + this.LIGHT_VERGE;
        return { x: px + nx * out, y: py + ny * out, nx, ny };
      }
    }
    return null;
  },

  // ───────────────────────────────────────────────────────────────────
  // Baked sprites
  // ───────────────────────────────────────────────────────────────────

  _radial(size, stops) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    const r = size / 2;
    const grad = g.createRadialGradient(r, r, 0, r, r, r);
    stops.forEach(([at, col]) => grad.addColorStop(at, col));
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return c;
  },

  _bakeBeams() {
    const S = 192;
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const g = c.getContext("2d");
    // Softened at bake time, once: a hard wedge edge is the difference between
    // a headlight and a spotlight in a stage play.
    g.filter = "blur(7px)";
    const spread = this.HEAD_SPREAD;
    const lateral = (this.HEAD_SPACING / this.HEAD_REACH) * S;
    for (const dir of [-1, 1]) {
      const ax = S / 2 + dir * lateral;
      const ay = S;
      const grad = g.createRadialGradient(ax, ay, 0, ax, ay, S);
      // Warm, not white: `destination-out` only reads alpha, so the one baked
      // sprite can be the additive beam on the road and the hole it burns in
      // the veil at the same time.
      grad.addColorStop(0, "rgba(255,247,222,1)");
      grad.addColorStop(0.3, "rgba(255,243,206,0.8)");
      grad.addColorStop(0.75, "rgba(255,236,186,0.22)");
      grad.addColorStop(1, "rgba(255,232,178,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(ax, ay);
      g.arc(ax, ay, S, -Math.PI / 2 - spread, -Math.PI / 2 + spread);
      g.closePath();
      g.fill();
    }
    return c;
  },

  _bake() {
    if (this._pool) return;
    this._pool = this._radial(160, [
      [0, "rgba(255,232,186,0.95)"],
      [0.35, "rgba(255,214,150,0.55)"],
      [0.72, "rgba(255,196,120,0.16)"],
      [1, "rgba(255,190,110,0)"],
    ]);
    // Peaks just short of opaque: even under a floodlight the night should
    // still be tinted, or the lit patches look like daylight cut out with
    // scissors.
    this._hole = this._radial(160, [
      [0, "rgba(255,255,255,0.94)"],
      [0.3, "rgba(255,255,255,0.66)"],
      [0.62, "rgba(255,255,255,0.2)"],
      [1, "rgba(255,255,255,0)"],
    ]);
    this._beams = this._bakeBeams();
  },

  resize() {
    if (!this._mask) {
      this._mask = document.createElement("canvas");
      this._maskCtx = this._mask.getContext("2d");
    }
    this._mask.width = Math.max(1, Math.round(camera.width * this.MASK_SCALE));
    this._mask.height = Math.max(1, Math.round(camera.height * this.MASK_SCALE));
  },

  // ───────────────────────────────────────────────────────────────────
  // Frame
  // ───────────────────────────────────────────────────────────────────

  update(delta) {
    const step = this.FADE * delta;
    if (this.intensity < this.targetIntensity)
      this.intensity = Math.min(this.targetIntensity, this.intensity + step);
    else if (this.intensity > this.targetIntensity)
      this.intensity = Math.max(this.targetIntensity, this.intensity - step);
    this.active = this.intensity > 0;
  },

  // How far the car sprites are darkened, for CarSprites to bake in. Quantised
  // to LIVERY_STEPS because that cache holds one bake per colour and a value
  // lerped continuously through the fade would bake a fresh set of sprites for
  // every car on every frame of it.
  liveryDim() {
    if (this.intensity <= 0) return 0;
    return (
      (Math.ceil(this.intensity * this.LIVERY_STEPS) / this.LIVERY_STEPS) *
      this.LIVERY_DIM
    );
  },

  darkness() {
    const wet = typeof Rain !== "undefined" ? Rain.intensity : 0;
    return this.DARKNESS + wet * this.WET_EXTRA;
  },

  _visible(x, y, pad) {
    const sx = x - camera.x;
    const sy = y - camera.y;
    return (
      sx > -pad && sx < viewWidth() + pad && sy > -pad && sy < viewHeight() + pad
    );
  },

  // The whole of night, in one layer and one blit.
  //
  // The obvious build is two passes — additive warmth on the scene for the
  // lights, then a veil with holes cut in it — and it measured at +18ms a frame
  // on a software rasteriser, three times the cost of the entire day frame.
  // `lighter` over a viewport's worth of pool is not cheap, and the veil was a
  // second full-viewport alpha blit on top of it.
  //
  // So the light and the dark go into the same RGBA layer instead: fill it
  // dark, cut the lit patches out with `destination-out`, then paint the warm
  // back over the cut with a low alpha. Lit ground ends up a faint warm wash
  // over the daytime artwork and unlit ground ends up under the veil, which is
  // the same picture — a floodlight cannot make tarmac brighter than the
  // sunlit tarmac the sprite was drawn as anyway. All of it happens at
  // MASK_SCALE, and the one thing that touches the viewport at full size is
  // the blit at the end.
  drawLightLayer(cars) {
    if (this.intensity <= 0 || !this._mask) return;
    this._bake();
    const g = this._maskCtx;
    const s = this.MASK_SCALE;

    g.setTransform(s, 0, 0, s, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = this.NIGHT_COLOR;
    g.fillRect(0, 0, camera.width, camera.height);

    // Into world units, so the culling and the placement below are the same
    // as everything else in this file rather than a copy with a zoom in it.
    g.setTransform(s * viewZoom, 0, 0, s * viewZoom, 0, 0);
    g.translate(-camera.x, -camera.y);

    const hole = this.LIGHT_RADIUS * this.HOLE_SPREAD;
    const reach = this.HEAD_REACH;

    g.globalCompositeOperation = "destination-out";
    this.lights.forEach((l) => {
      if (!this._visible(l.px, l.py, hole)) return;
      g.globalAlpha = Math.min(1, l.bright);
      g.drawImage(this._hole, l.px - hole, l.py - hole, hole * 2, hole * 2);
    });
    g.globalAlpha = 0.85;
    cars.forEach((e) => {
      if (!this._visible(e.x, e.y, reach)) return;
      this._beamTransform(g, e);
      g.drawImage(this._beams, -reach / 2, -reach, reach, reach);
      g.restore();
    });

    g.globalCompositeOperation = "source-over";
    const r = this.LIGHT_RADIUS;
    this.lights.forEach((l) => {
      if (!this._visible(l.px, l.py, r)) return;
      g.globalAlpha = this.POOL_ALPHA * l.bright;
      g.drawImage(this._pool, l.px - r, l.py - r, r * 2, r * 2);
    });
    g.globalAlpha = this.HEAD_ALPHA;
    cars.forEach((e) => {
      if (!this._visible(e.x, e.y, reach)) return;
      this._beamTransform(g, e);
      g.drawImage(this._beams, -reach / 2, -reach, reach, reach);
      g.restore();
    });

    // Nearest neighbour on the way up. The layer is the lowest-frequency thing
    // on screen — gradients and nothing else — so the stair-stepping filtering
    // would smooth away is not visible, and the filter is most of the blit.
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = this.intensity * this.darkness();
    ctx.drawImage(this._mask, 0, 0, camera.width, camera.height);
    ctx.restore();
  },

  // The lamps themselves — the pylon heads and the cars' tail lights. Objects,
  // not light, and drawn after the layer so the veil does not put them out. A
  // tail light also sits inside its own car's footprint, so it has to come
  // after the sprites regardless.
  drawLamps(cars) {
    if (this.intensity <= 0) return;
    const a = Math.min(1, this.intensity * 1.5);

    ctx.save();
    ctx.globalAlpha = a;
    ctx.lineWidth = 3;
    this.lights.forEach((l) => {
      if (!this._visible(l.x, l.y, 40)) return;
      const x = l.x - camera.x;
      const y = l.y - camera.y;
      ctx.strokeStyle = "#2b2f3a";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + l.ax * 13, y + l.ay * 13);
      ctx.stroke();
      ctx.fillStyle = "#3a3f4c";
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff3d0";
      ctx.beginPath();
      ctx.arc(x + l.ax * 13, y + l.ay * 13, 3.2, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.globalAlpha = this.TAIL_ALPHA * this.intensity;
    ctx.fillStyle = "#ff3018";
    cars.forEach((e) => {
      if (!this._visible(e.x, e.y, 60)) return;
      const cos = Math.cos(e.angle);
      const sin = Math.sin(e.angle);
      const back = e.height * 0.44;
      for (const side of [-1, 1]) {
        const lx = side * e.width * 0.28;
        ctx.beginPath();
        ctx.arc(
          e.x - camera.x + lx * cos - back * sin,
          e.y - camera.y + lx * sin + back * cos,
          2.6,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
    });
    ctx.restore();
  },

  // Leaves the context saved and translated so the beam sprite draws with its
  // apexes on the car's nose and its length up the screen — the caller
  // restores. The sprite is baked pointing up, which is angle 0, with the
  // apexes on its bottom edge: drawn `reach` tall at (-reach/2, -reach) it
  // lands with the lamps on the origin and the throw out in front.
  _beamTransform(g, e) {
    g.save();
    g.translate(e.x, e.y);
    g.rotate(e.angle);
    g.translate(0, -e.height * 0.42);
  },

  drawHUD() {
    if (this.intensity <= 0 && this.targetIntensity <= 0) return;
    ctx.save();
    ctx.font = "bold 16px 'Courier New'";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(198,206,240,0.85)";
    ctx.fillText("🌙  NIGHT RACE", 16, camera.height - 72);
    ctx.restore();
  },
};
