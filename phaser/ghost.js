// The ghost: the player's record lap, driven again beside them.
//
// Free Drive was the one mode with nothing in it to race. The field is out
// there, but nobody is counting its laps, and the only thing the mode had to
// offer was a number on the records screen — a lap time with no lap attached
// to it. This is the lap: the record for this circuit and class, recorded as
// the path the car took and played back as a translucent copy of the player's
// own car that leaves the line the moment they do. A driver can *see* where
// the time was — the corner the ghost carries more into, the exit it gets on
// the throttle sooner — which is what a time trial is for.
//
// It is scenery. No body, nothing the physics or the AI can see, nothing that
// collides — the same standing as the crowd. It is also only *shown* in Free
// Drive: in a lap race it would be a seventh car in the pack that nothing can
// hit, which reads as a bug in traffic. It is *recorded* in every mode,
// though, because Records.saveLapTime() runs in every mode: the record is the
// record wherever it was set, and a ghost that only knew about Free Drive laps
// would be chasing a slower lap than the one on the sheet.
//
// The trace is sampled at ~30 Hz and stored as one flat array of integers —
// milliseconds since the crossing, world px, centiradians, and lap progress in
// ten-thousandths — because localStorage is a string store and a lap on
// Ironwood Marathon is a minute long. Progress is in the sample so the HUD's
// delta is a scan along the trace, not a RaceGrid.progress() per sample per
// frame. One ghost per "track:class", the same key the lap records use, in its
// own localStorage key so the records' own parser is untouched; cleared with
// the records (Records.clear) and with the physics version (Records.resetOnce)
// — a ghost from a different physics is as meaningless as its time.
//
// Where the lap boundary is read from: `entity.laps`, never `lapStart` on its
// own. RaceScene.resumeFromMenu() shifts every car's `lapStart` forward by the
// time spent in the menu without any crossing having happened, and a recorder
// keyed on that would throw the lap away at every ESC. `now - lapStart` is
// continuous across the pause for exactly the same reason, which is what makes
// the playback clock below the right one.
const GHOST_SAMPLE_MS = 30; // ms between trace samples — every other frame at 60 Hz
const GHOST_ALPHA = 0.45; // the ghost's opacity, over the road
const GHOST_DEPTH = 1.8; // under the cars (2), over the debris (1.6)
const GHOST_ANGLE_SCALE = 100; // centiradians in the store
const GHOST_PROGRESS_SCALE = 10000; // lap progress in ten-thousandths
const GHOST_STRIDE = 5; // ints per sample: t, x, y, angle, progress

const Ghost = {
  all: {}, // "track:class" -> { time, samples }
  key: null,
  live: null, // the trace being driven against this race, or null

  // The recorder.
  buffer: [],
  completed: null, // the lap that just ended, until commit() files it or the next one replaces it
  lapsSeen: 0,
  lastSampleT: -Infinity,

  // The player.
  sprite: null,
  bodyImg: null,
  wheelImgs: null,
  playIndex: 0, // cursor into the live trace, by time
  scanIndex: 0, // cursor into the live trace, by progress
  shownLaps: 0,

  load() {
    this.all = {};
    try {
      const parsed = JSON.parse(localStorage.getItem("ghostLaps"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const k of Object.keys(parsed)) {
          const g = parsed[k];
          if (
            g &&
            typeof g.time === "number" &&
            Array.isArray(g.samples) &&
            g.samples.length >= 2 * GHOST_STRIDE &&
            g.samples.length % GHOST_STRIDE === 0 &&
            g.samples.every(Number.isFinite)
          )
            this.all[k] = { time: g.time, samples: g.samples };
        }
      } else if (parsed !== null) localStorage.removeItem("ghostLaps");
    } catch {
      localStorage.removeItem("ghostLaps");
    }
  },

  save() {
    try {
      localStorage.setItem("ghostLaps", JSON.stringify(this.all));
    } catch {
      /* private mode, or the quota — the lap still counts, the ghost just won't outlive the tab */
    }
  },

  // Safe before load(): Records.resetOnce() runs first and may call this.
  clear() {
    this.all = {};
    this.live = null;
    try {
      localStorage.removeItem("ghostLaps");
    } catch {
      /* private mode — nothing was persisted to begin with */
    }
  },

  select(trackId, classId) {
    this.key = `${trackId}:${classId}`;
    this.live = this.all[this.key] || null;
    this.playIndex = 0;
    this.scanIndex = 0;
  },

  // Per race. The sprite belongs to the scene and went with it — "race again"
  // restarts the scene, and a container from its previous life is a destroyed
  // object.
  reset() {
    this.buffer = [];
    this.completed = null;
    this.lapsSeen = 0;
    this.lastSampleT = -Infinity;
    this.sprite = null;
    this.bodyImg = null;
    this.wheelImgs = null;
    this.playIndex = 0;
    this.scanIndex = 0;
    this.shownLaps = 0;
  },

  // Every racing frame, after the player's RaceLaps.update() — that is what
  // stamps `lapStart` on the crossing frame, so the first sample of a lap is
  // at t = 0 and on the line.
  record(world, p, now) {
    if (p.laps !== this.lapsSeen) {
      this.completed = this.buffer;
      this.buffer = [];
      this.lapsSeen = p.laps;
      this.lastSampleT = -Infinity;
    }
    if (!p.lapStart) return; // still on the grid, before the arming crossing
    const t = now - p.lapStart;
    if (t - this.lastSampleT < GHOST_SAMPLE_MS) return;
    this.lastSampleT = t;
    this.buffer.push(
      Math.round(t),
      Math.round(p.x),
      Math.round(p.y),
      Math.round(p.angle * GHOST_ANGLE_SCALE),
      Math.round(RaceGrid.progress(world, p) * GHOST_PROGRESS_SCALE),
    );
  },

  // The lap that just ended was the record: file it, and drive against it
  // from the next crossing. Called from the same place the banner goes gold.
  commit(time) {
    const samples = this.completed;
    if (!this.key || !samples || samples.length < 2 * GHOST_STRIDE) return;
    this.all[this.key] = { time, samples };
    this.live = this.all[this.key];
    this.playIndex = 0;
    this.scanIndex = 0;
    this.save();
  },

  // Free Drive only, and only when there is a record to drive.
  shows() {
    return RaceLaps.target === null && !!this.live;
  },

  // The player's own car, at GHOST_ALPHA. The same body-plus-front-wheels
  // container spawnCar() builds, with the wheels left straight: the trace
  // carries no steering, and at this opacity nobody can tell.
  spawn(scene, color, dim) {
    const sprite = scene.add
      .container(0, 0)
      .setDepth(GHOST_DEPTH)
      .setAlpha(GHOST_ALPHA)
      .setVisible(false);
    const bodyImg = scene.add
      .image(0, 0, scene.carTexture(color, dim, "--"))
      .setDisplaySize(CAR_W, CAR_H);
    const wheelKey = scene.wheelTexture(dim);
    const sx = CAR_W / CAR_SPRITE_W;
    const sy = CAR_H / CAR_SPRITE_H;
    const wheelImgs = FRONT_WHEELS.map((b) =>
      scene.add
        .image(
          (b.x + b.w / 2 - CAR_SPRITE_W / 2) * sx,
          (b.y + b.h / 2 - CAR_SPRITE_H / 2) * sy,
          wheelKey,
        )
        .setDisplaySize(b.w * sx, b.h * sy),
    );
    sprite.add([bodyImg, ...wheelImgs]);
    this.sprite = sprite;
    this.bodyImg = bodyImg;
    this.wheelImgs = wheelImgs;
    this.color = color;
  },

  // Once a frame. The ghost's clock is the player's own lap clock, so it
  // leaves the line when they do and is hidden until they have crossed it
  // once; when it has finished its lap it waits at the line for the player's
  // next crossing, rather than lapping on its own.
  update(scene, p, now, dim) {
    if (!this.shows()) {
      if (this.sprite) this.sprite.setVisible(false);
      return;
    }
    if (!this.sprite) this.spawn(scene, GRID_LIVERIES[0], dim);
    if (!p.lapStart) {
      this.sprite.setVisible(false);
      return;
    }
    if (p.laps !== this.shownLaps) {
      this.shownLaps = p.laps;
      this.playIndex = 0;
      this.scanIndex = 0;
    }

    const s = this.live.samples;
    const n = s.length / GHOST_STRIDE;
    const t = now - p.lapStart;
    if (t > s[(n - 1) * GHOST_STRIDE]) {
      this.sprite.setVisible(false);
      return;
    }
    // A cursor rather than a search: t only moves forward within a lap.
    let i = this.playIndex;
    if (t < s[i * GHOST_STRIDE]) i = 0;
    while (i + 1 < n && s[(i + 1) * GHOST_STRIDE] <= t) i++;
    this.playIndex = i;

    const a = i * GHOST_STRIDE;
    const b = Math.min(n - 1, i + 1) * GHOST_STRIDE;
    const span = s[b] - s[a];
    const f = span > 0 ? (t - s[a]) / span : 0;
    const x = s[a + 1] + (s[b + 1] - s[a + 1]) * f;
    const y = s[a + 2] + (s[b + 2] - s[a + 2]) * f;
    // Shortest arc, in case a stored angle wrapped between two samples.
    let da = (s[b + 3] - s[a + 3]) / GHOST_ANGLE_SCALE;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const angle = s[a + 3] / GHOST_ANGLE_SCALE + da * f;

    this.sprite.setPosition(x, y).setRotation(angle).setVisible(true);
    // The night dim moves the texture under every car; the ghost follows the
    // same key the cars do.
    this.bodyImg.setTexture(scene.carTexture(this.color, dim, "--"));
    const wheelKey = scene.wheelTexture(dim);
    for (const w of this.wheelImgs) w.setTexture(wheelKey);
  },

  // Seconds the player is behind (positive) or ahead of (negative) the ghost
  // at this point of the lap — the time the ghost took to reach where the
  // player is now, against the time the player has taken. Null when there is
  // nothing to compare against yet.
  delta(world, p, now) {
    if (!this.shows() || !p.lapStart) return null;
    const s = this.live.samples;
    const n = s.length / GHOST_STRIDE;
    const prog = RaceGrid.progress(world, p) * GHOST_PROGRESS_SCALE;
    let i = this.scanIndex;
    // Progress climbs along a lap trace, so the cursor only walks forward —
    // unless the player has just crossed the line, and it is 0 again. The
    // trace's own tail can hold a sample or two past the line, where progress
    // has wrapped to 0 before the counter saw the crossing, and the walk stops
    // short of those rather than reading them as the start of the lap.
    if (prog < s[i * GHOST_STRIDE + 4] - GHOST_PROGRESS_SCALE / 2) i = 0;
    while (
      i + 1 < n &&
      s[(i + 1) * GHOST_STRIDE + 4] <= prog &&
      s[(i + 1) * GHOST_STRIDE + 4] >= s[i * GHOST_STRIDE + 4]
    )
      i++;
    this.scanIndex = i;
    return (now - p.lapStart - s[i * GHOST_STRIDE]) / 1000;
  },
};
