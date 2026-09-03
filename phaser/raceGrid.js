// The starting grid, the start line and the lap gate.
//
// These three are one contract, not three features: the grid puts the field
// behind the line, tile 9 is the line, and the gate is the stretch of lap that
// has to be driven before a crossing counts. `applyTrackSpawns`,
// `trackProgress` and `updateLapGate` in game.js are ported here with their
// geometry unchanged — the track files already encode all of it, and a subtly
// wrong port is exactly the failure the track-authoring skill warns about:
// laps and standings that disagree with the layout rather than crash.
//
// The grid is track data. Only the liveries are code, because those are the
// cars' identity rather than the circuit's, and a track with no `spawn` block
// still has to start a race — hence the waypoint-0 fallback.
//
// Deliberately NOT here: the debug panel's spawn sliders. They nudge the field
// in place by overwriting the grid's x/y after it has been filled, and they
// live on editor.html — which is where finding grid coordinates to paste into a
// track file is the job. On this page the track file is the single source, and
// keeping it that way is what stops a saved slider position from quietly
// re-arranging a shipped grid.

// Player first, then the five opponents, in grid order — pole is index 0.
const GRID_LIVERIES = [
  "#e01b1b", // player
  "#0077ff",
  "#ff7700",
  "#00cc44",
  "#cc00cc",
  "#ffd400",
];

const RaceGrid = {
  // Fractions of the lap, by distance — see updateGate().
  LAP_GATE_FROM: 0.4,
  LAP_GATE_TO: 0.65,

  // How far past the tarmac the start line reaches, along its own length.
  // The tile-9 run spans exactly the road's tiles and stops dead at them,
  // while the road field is blurred out past the tile edge and the verge
  // beyond that is driveable at a price — so a car one pixel outside the run
  // as it crossed lost barely any speed and the whole lap, and a driver who
  // ran wide over the line, or went round the outside of the pack off the
  // start, was silently put a lap down for the rest of the race. Clipping the
  // grass at the line costs grip. It does not cost the lap.
  LINE_MARGIN: 64, // world px, added to each end of the line

  liveries: GRID_LIVERIES,

  // Six slots, filled from the loaded track's `spawn` block. A track without
  // one — straight out of the editor, say — gets the field stacked behind
  // waypoint 0 facing waypoint 1: two lanes 34px either side of the line, 60px
  // apart along it, which is the spacing both shipped grids use.
  build(world) {
    const grid = (world.data && world.data.spawn) || [];
    const wps = (world.data && world.data.waypoints) || [];

    return GRID_LIVERIES.map((color, i) => {
      if (grid[i])
        return { x: grid[i].x, y: grid[i].y, angle: grid[i].angle, color };

      const a = wps[0] || { x: 100, y: 100 };
      const b = wps[1] || { x: a.x + 1, y: a.y };
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const tx = (b.x - a.x) / len;
      const ty = (b.y - a.y) / len;
      const side = i % 2 ? 34 : -34;
      const back = 140 + i * 60;
      return {
        x: a.x - tx * back - ty * side,
        y: a.y - ty * back + tx * side,
        angle: Math.atan2(tx, -ty),
        color,
      };
    });
  },

  // How far round the lap a car is, as a fraction of the lap's length: project
  // onto every waypoint segment and keep the nearest. The answer is in lap
  // distance rather than waypoint index because waypoints are not evenly
  // spaced — this circuit's segments run 248px to 1040px — so anything
  // reasoning about position on the lap has to mean distance or it says
  // something different on every track laid out.
  progress(world, entity) {
    const wps = world.data && world.data.waypoints;
    if (!wps || wps.length === 0) return 0;

    const n = wps.length;
    let total = 0;
    let best = 0;
    let bestDist = Infinity;

    for (let i = 0; i < n; i++) {
      const a = wps[i];
      const b = wps[(i + 1) % n];
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const len2 = abx * abx + aby * aby || 1;

      let t = ((entity.x - a.x) * abx + (entity.y - a.y) * aby) / len2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;

      const dx = entity.x - (a.x + abx * t);
      const dy = entity.y - (a.y + aby * t);
      const d = dx * dx + dy * dy;

      const len = Math.sqrt(len2);
      if (d < bestDist) {
        bestDist = d;
        best = total + len * t;
      }
      total += len;
    }

    return total > 0 ? best / total : 0;
  },

  // A crossing only counts once the car has been round the far side of the
  // circuit. The gate is a stretch of lap rather than a point so it can't be
  // jumped, and it is nowhere near the start line — anything close to it would
  // be re-armed by the same reversing it exists to stop.
  updateGate(world, entity) {
    if (!((world.data && world.data.waypoints) || []).length) {
      entity.passedGate = true; // nothing to check against; don't block laps
      return;
    }
    const p = this.progress(world, entity);
    if (p >= this.LAP_GATE_FROM && p <= this.LAP_GATE_TO)
      entity.passedGate = true;
  },

  // Tile 9 is the start line, and a lap is the transition *onto* it — nothing
  // else. What has moved since 0.19.0 is only how wide "onto it" is: the
  // painted cells, stretched by LINE_MARGIN along the line and by nothing at
  // all across it, since across is the direction cars cross in and a lap
  // counted early is a worse bug than one counted late.
  onStartLine(world, entity) {
    const line = this.startLine(world);
    if (!line) return false;
    return (
      entity.x >= line.x0 &&
      entity.x < line.x1 &&
      entity.y >= line.y0 &&
      entity.y < line.y1
    );
  },

  // The line as one world-space rectangle, built from the tile-9 cells the
  // first time a loaded track asks for it. Keyed on the track *data* rather
  // than rebuilt per call: `worldTrack` is reloaded in place when the circuit
  // changes, but it is handed a new data object when it is, so a circuit
  // change rebuilds this and nothing has to remember to invalidate it.
  startLine(world) {
    const data = world && world.data;
    if (!data || !data.map) return null;
    if (this._lineFor !== data) {
      this._lineFor = data;
      this._line = buildStartLine(data, this.LINE_MARGIN);
    }
    return this._line;
  },

  _lineFor: null,
  _line: null,

  // World position at a fraction of the lap — the inverse of progress(), so
  // anything measured in lap distance can be drawn back onto the track.
  ringPoint(world, f) {
    const wps = world.data.waypoints;
    const n = wps.length;
    const seg = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const a = wps[i];
      const b = wps[(i + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      seg.push(len);
      total += len;
    }

    let want = total * (((f % 1) + 1) % 1);
    for (let i = 0; i < n; i++) {
      if (want <= seg[i] || i === n - 1) {
        const a = wps[i];
        const b = wps[(i + 1) % n];
        const t = seg[i] > 0 ? Math.min(want / seg[i], 1) : 0;
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
      want -= seg[i];
    }
    return { x: wps[0].x, y: wps[0].y };
  },
};

// The tile-9 cells' bounds in world px, with the margin on the line's own
// axis. Every circuit paints the line as a straight run across the road — one
// column or one row, which is all a single stroke of the tile editor can lay
// down — so the longer side of the bounds *is* the line, and the shorter one
// is the depth cars cross through. A square patch has no across-track axis to
// pick out, so it gets the margin both ways rather than an arbitrary one.
function buildStartLine(data, margin) {
  const ts = data.tileSize;
  let gx0 = Infinity;
  let gy0 = Infinity;
  let gx1 = -Infinity;
  let gy1 = -Infinity;

  for (let gy = 0; gy < data.map.length; gy++) {
    const row = data.map[gy];
    for (let gx = 0; gx < row.length; gx++) {
      if (row[gx] !== 9) continue;
      if (gx < gx0) gx0 = gx;
      if (gx > gx1) gx1 = gx;
      if (gy < gy0) gy0 = gy;
      if (gy > gy1) gy1 = gy;
    }
  }
  if (gx0 === Infinity) return null; // no line painted; laps are counted nowhere

  const line = {
    x0: gx0 * ts,
    y0: gy0 * ts,
    x1: (gx1 + 1) * ts,
    y1: (gy1 + 1) * ts,
  };
  const w = line.x1 - line.x0;
  const h = line.y1 - line.y0;
  if (w >= h) {
    line.x0 -= margin;
    line.x1 += margin;
  }
  if (h >= w) {
    line.y0 -= margin;
    line.y1 += margin;
  }
  return line;
}
