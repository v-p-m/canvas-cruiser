// ─────────────────────────────────────────
// RAIN SYSTEM
//
// Weather is scheduled per race in game.js; this file owns what the rain
// itself does — the drop pool, the world-space puddles, the screen tint,
// and the wetness every car reads its grip penalty from.
//
// Sizes come from `camera`, not `canvas`: on a HiDPI display the canvas
// backing store is bigger than the drawing surface by devicePixelRatio.
// ─────────────────────────────────────────
const Rain = {
  active: false,
  intensity: 0, // 0→1, lerps toward targetIntensity
  targetIntensity: 0,
  drops: [],
  MAX_DROPS: 600,
  puddles: [], // static world-space puddles drawn on track
  MAX_PUDDLES: 40,
  splashes: [], // short-lived rings where a drop just hit the ground
  SPLASH_LIFE: 10, // delta units (~frames at 60fps) a splash ring lives

  // How much rain damps grip / friction
  GRIP_PENALTY: 0.42, // scales driftGrip when fully wet
  FRICTION_BONUS: 0, // real asphalt doesn't coast faster wet — see BUILD 0.14.0 notes

  // Puddles used to be scenery: GRIP_PENALTY is a constant scale, so a fully
  // wet lap felt like one uniform-viscosity corner rather than rain. A puddle
  // underneath the car is the moment that should read as *weather* — a sharp,
  // speed-gated grip drop rather than the ambient one — so aquaplaning is
  // its own multiplier, keyed to actual puddle geometry instead of a re-skin
  // of the intensity scalar.
  HYDRO_PENALTY: 0.55, // extra grip multiplier at full speed in a puddle
  HYDRO_SPEED_FLOOR: 0.35, // fraction of maxSpeed below which a puddle does nothing

  // Wet asphalt is darker, not just cooler — the old overlay was a light
  // blue-grey haze that read as a colour grade rather than a soaked track.
  // A darker, more opaque fill does the same full-viewport-blit trick
  // (see the perf notes in memory) but actually reads as "wet" rather than
  // "tinted". Plain alpha blending rather than a multiply composite: on the
  // Phaser page this paints onto UI.ctx, a *separate* transparent canvas
  // stacked over the Phaser one (see phaser/worldCamera.js) — the browser
  // composites the two normally regardless of what ctx.globalCompositeOperation
  // says, so `multiply` here would only affect drawing already on UI.ctx
  // (next to none) and be a no-op against the scene underneath. Normal
  // alpha-over works identically on both pages, which `multiply` would not.
  OVERLAY_ALPHA: 0.3, // at full intensity
  OVERLAY_COLOR: "#1c2733",

  toggle() {
    if (this.targetIntensity === 0) {
      this.targetIntensity = 1;
      this.active = true;
      this._spawnPuddles();
    } else {
      this.targetIntensity = 0;
    }
  },

  _spawnPuddles() {
    if (!worldTrack.data) return;
    this.puddles = [];
    const { map, tileSize } = worldTrack.data;
    const roadTiles = [];
    map.forEach((row, ty) =>
      row.forEach((id, tx) => {
        if (id >= 2 && id <= 9) roadTiles.push({ tx, ty });
      }),
    );
    // Keep drawing until the quota is filled rather than taking a fixed
    // number of attempts — the road-edge rejection below used to eat into
    // the count, so a wet race got noticeably fewer puddles than asked for.
    const quota = Math.min(this.MAX_PUDDLES, roadTiles.length);
    for (
      let tries = 0;
      this.puddles.length < quota && tries < quota * 8;
      tries++
    ) {
      const tile = roadTiles[Math.floor(Math.random() * roadTiles.length)];
      const px =
        tile.tx * tileSize +
        tileSize / 2 +
        (Math.random() - 0.5) * tileSize * 0.6;
      const py =
        tile.ty * tileSize +
        tileSize / 2 +
        (Math.random() - 0.5) * tileSize * 0.6;
      // Corner tiles are only partly tarmac now — skip spots the smoothed
      // road edge has cut away
      if (worldTrack.sampleRoad(px, py) < 0.65) continue;
      this.puddles.push({
        x: px,
        y: py,
        rx: 10 + Math.random() * 22,
        ry: 5 + Math.random() * 12,
        alpha: 0.3 + Math.random() * 0.25,
        ripple: Math.random() * Math.PI * 2,
      });
    }
  },

  _spawnDrop() {
    return {
      // screen-space — reposition each frame so they always fill viewport
      x: Math.random() * camera.width,
      y: Math.random() * camera.height,
      len: 8 + Math.random() * 10,
      speed: 14 + Math.random() * 10,
      alpha: 0.25 + Math.random() * 0.35,
      // Where this drop lands and splashes — not the bottom of the viewport,
      // or every splash would queue up in one line there instead of reading
      // as rain hitting the road across the whole screen.
      landY: camera.height * (0.3 + Math.random() * 0.7),
    };
  },

  update(delta) {
    // Lerp intensity
    const step = 0.008 * delta;
    if (this.intensity < this.targetIntensity)
      this.intensity = Math.min(this.targetIntensity, this.intensity + step);
    else if (this.intensity > this.targetIntensity)
      this.intensity = Math.max(this.targetIntensity, this.intensity - step);

    if (this.intensity <= 0) {
      this.active = false;
      return;
    }
    if (this.targetIntensity > 0) this.active = true;

    // Maintain drop pool
    const desiredDrops = Math.floor(this.intensity * this.MAX_DROPS);
    while (this.drops.length < desiredDrops) this.drops.push(this._spawnDrop());
    while (this.drops.length > desiredDrops) this.drops.pop();

    // Move drops
    this.drops.forEach((d) => {
      d.y += d.speed * delta;
      d.x += 2 * delta; // slight angle
      if (d.y >= d.landY) {
        this.splashes.push({ x: d.x, y: d.landY, age: 0 });
        d.y = -20;
        d.x = Math.random() * camera.width;
        d.landY = camera.height * (0.3 + Math.random() * 0.7);
      }
    });

    // Age out splashes. Bounded by drop count and fall speed, not a cap of
    // its own — at MAX_DROPS a handful are ever alive at once.
    for (let i = this.splashes.length - 1; i >= 0; i--) {
      const s = this.splashes[i];
      s.age += delta;
      if (s.age > this.SPLASH_LIFE) this.splashes.splice(i, 1);
    }

    // Animate puddle ripples
    this.puddles.forEach((p) => {
      p.ripple += 0.04 * delta;
    });
  },

  // Wetness as multipliers the cars read, rather than absolute values the
  // rain writes onto them. The old version reconstructed the dry constants
  // from its own copy and assigned them every frame, so anything the
  // DebugConfig sliders had set was quietly overwritten on the next tick.
  gripScale() {
    return 1 - this.intensity * (1 - this.GRIP_PENALTY);
  },

  frictionBonus() {
    return this.intensity * this.FRICTION_BONUS;
  },

  // A second, independent multiplier a car reads alongside gripScale() —
  // never folded into it, because it has to stay zero everywhere the car
  // isn't over a puddle, and gripScale() has no notion of position. Takes
  // the whole entity rather than x/y: it needs speed too, and every caller
  // already has one. `driftGrip` composes by multiplication (see
  // applyCarStats/entity.mods), so this scales the same way rather than
  // overwriting it.
  puddleGripAt(entity) {
    if (this.intensity <= 0 || !entity.maxSpeed) return 1;
    const speedFrac = Math.abs(entity.speed) / entity.maxSpeed;
    if (speedFrac <= this.HYDRO_SPEED_FLOOR) return 1;
    const speedT =
      (speedFrac - this.HYDRO_SPEED_FLOOR) / (1 - this.HYDRO_SPEED_FLOOR);
    for (const p of this.puddles) {
      const dx = (entity.x - p.x) / p.rx;
      const dy = (entity.y - p.y) / p.ry;
      if (dx * dx + dy * dy > 1) continue;
      return 1 - this.HYDRO_PENALTY * speedT * this.intensity;
    }
    return 1;
  },

  drawPuddles() {
    if (this.intensity <= 0) return;
    this.puddles.forEach((p) => {
      const sx = p.x - camera.x;
      const sy = p.y - camera.y;
      // Against the world rect, not the viewport: zoomed out by an editor's
      // free camera the two are not the same, and puddles in the half of the
      // map beyond the viewport would drop out.
      if (
        sx < -60 ||
        sx > viewWidth() + 60 ||
        sy < -40 ||
        sy > viewHeight() + 40
      )
        return;

      ctx.save();
      ctx.globalAlpha = p.alpha * this.intensity;
      ctx.translate(sx, sy);

      // Puddle ellipse — darker than the old fill (#6aaccc): standing water
      // over dark wet asphalt reads as deep, not as a light blue wash.
      ctx.fillStyle = "#3d6478";
      ctx.beginPath();
      ctx.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
      ctx.fill();

      // Ripple ring
      const rScale = 0.5 + 0.5 * Math.abs(Math.sin(p.ripple));
      ctx.strokeStyle = "rgba(150,200,230,0.5)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(0, 0, p.rx * rScale, p.ry * rScale, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    });
  },

  drawDrops() {
    if (this.intensity <= 0) return;
    ctx.save();
    ctx.strokeStyle = `rgba(174, 214, 241, ${0.55 * this.intensity})`;
    ctx.lineWidth = 1;
    this.drops.forEach((d) => {
      ctx.globalAlpha = d.alpha * this.intensity;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x + 2, d.y + d.len);
      ctx.stroke();
    });
    ctx.restore();
  },

  // Screen-space, same as the drops that spawn them — a flattened ellipse so
  // it reads as a ring on the ground plane rather than a circle floating in
  // front of the camera, same trick drawPuddles() uses for its ripple.
  drawSplashes() {
    if (this.intensity <= 0 || this.splashes.length === 0) return;
    ctx.save();
    ctx.strokeStyle = "rgba(200,225,245,0.9)";
    ctx.lineWidth = 1;
    this.splashes.forEach((s) => {
      const t = s.age / this.SPLASH_LIFE;
      ctx.globalAlpha = (1 - t) * 0.5 * this.intensity;
      const r = 2 + t * 5;
      ctx.beginPath();
      ctx.ellipse(s.x, s.y, r, r * 0.4, 0, 0, Math.PI * 2);
      ctx.stroke();
    });
    ctx.restore();
  },

  drawOverlay() {
    if (this.intensity <= 0) return;
    ctx.save();
    ctx.globalAlpha = this.OVERLAY_ALPHA * this.intensity;
    ctx.fillStyle = this.OVERLAY_COLOR;
    ctx.fillRect(0, 0, camera.width, camera.height);
    ctx.restore();
  },

  drawHUD() {
    ctx.save();
    ctx.font = "bold 16px 'Courier New'";
    ctx.textAlign = "left";

    // Active rain label
    if (this.intensity > 0 || this.targetIntensity > 0) {
      ctx.fillStyle =
        this.intensity > 0.5
          ? `rgba(174,214,241,${0.7 + 0.3 * this.intensity})`
          : "#aaa";
      ctx.fillText(
        this.intensity > 0.05 ? `🌧  WET TRACK` : `🌤  DRYING...`,
        16,
        camera.height - 48,
      );
    }

    // Pre-race forecast hint (before hasStarted, in a race mode)
    if (
      !hasStarted &&
      !isMenu &&
      (gameMode === "race5" || gameMode === "race10")
    ) {
      const wet = weatherWetFromLap !== null;
      if (gameMode === "race5") {
        ctx.fillStyle = wet
          ? "rgba(174,214,241,0.85)"
          : "rgba(200,230,200,0.85)";
        ctx.fillText(
          wet ? `🌧  FORECAST: WET RACE` : `☀️  FORECAST: DRY RACE`,
          16,
          camera.height - 48,
        );
      } else {
        // race10 — show the wet window
        if (wet) {
          const to = weatherWetToLap ? `lap ${weatherWetToLap - 1}` : "end";
          ctx.fillStyle = "rgba(174,214,241,0.85)";
          ctx.fillText(
            `🌧  RAIN: lap ${weatherWetFromLap} → ${to}`,
            16,
            camera.height - 48,
          );
        } else {
          ctx.fillStyle = "rgba(200,230,200,0.85)";
          ctx.fillText(`☀️  FORECAST: DRY RACE`, 16, camera.height - 48);
        }
      }
    }

    ctx.restore();
  },
};
