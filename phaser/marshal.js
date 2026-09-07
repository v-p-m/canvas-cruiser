// The flag marshal — a person on the verge at the start line, who waves the
// chequered flag once the race is in its final lap.
//
// Art, and why it is here rather than in carSprites.js: same technique, same
// derivation — one body colour, its shade and its highlight computed off it at
// bake time (mixColor/mixHex, borrowed from carSprites.js so a marshal and a
// car are lit by the same arithmetic) — but nothing on the editor page draws
// one, and the root is the set of files both pages load. So the grid lives
// beside the scene that shows it.
//
// The flag is two sprites, not an animation strip: the marshal is baked once
// and the flag is baked once, and the wave is the flag rotated about the hands
// every frame. That is exactly what carSprites.js does with the front wheels,
// for the same reason — a strip would be a dozen bakes per night-dim step to
// remove nothing anyone can see at this size, and a rotation is smooth at any
// frame rate.
//
// The chequers are generated rather than typed. Everything else in this file's
// artwork is a decision about where a pixel goes; a checkerboard is a formula,
// and 140 hand-typed cells of one can only ever be wrong.
//
// The figure itself is drawn the way the old top-down shooters draw a person,
// Ultimate Tapan Kaikki being the reference: a **hard near-black outline right
// round the silhouette**, a rounded mass rather than a box, and a head big
// enough to see, ringed by that same outline and sitting *inside* the
// shoulders rather than in front of them. The outline is what does the work —
// the cars get their edge from a shade derived off their own paint, which is
// right for something 34 px long lit from above, but an 18 px figure standing
// on grass or on tarmac has no silhouette at all without a line round it.

// One cell, one world px — the same 1:1 the car sprite is drawn at (34 cells,
// 34 world px), so nothing here is ever resampled either.
//
// It is 1:1 against a *measured* size, not a chosen one. The car's cockpit is
// four px of helmet across, and shoulders are about two and a half heads wide
// seen from above, so a person standing beside that car is ten px across the
// shoulders and about sixteen hand to hand. Earlier passes drew the figure at
// twenty-five hand to hand, which is a metre and a half of shoulder — a marshal
// who could not have got into the car they are waving at.
//
// Both grids are sized in even cells on purpose: renderDpr's other stop is 1.5,
// and an odd count bakes to a half pixel that has to be rounded and then
// resampled on the way back down.
const MARSHAL_WIDTH = 16; // world px, over the whole 16-cell grid
const MARSHAL_STANDOFF = 10; // world px past the road edge, so nobody clips them
// How far back up the straight the post is, against the direction of travel.
// Standing dead level with the line puts a chequered flag over the chequered
// paint, and at half the angles of the sweep the two line up into one stripe —
// so the flag is waved at the cars on their way to the line rather than across
// the thing it is painted to look like.
const MARSHAL_BEFORE_LINE = 52; // world px
const MARSHAL_REACH = 220; // world px of sideways march looking for the verge
const MARSHAL_VERGE = 0.35; // road-field value below which this is not road

// Where the pole sits in the marshal's own grid: the middle of one of the two
// hands — the far end of the figure, not its centreline, because that is what
// is gripping it. The flag rotates about this point.
const FLAG_PIVOT = { x: 14, y: 6 }; // cells

const FLAG_W = 14; // cells
const FLAG_H = 20; // cells — panel plus the pole down to the pivot
const FLAG_PANEL_H = 10; // cells of chequers, at the far end from the hands
const FLAG_SQUARE = 2; // cells per chequer
const FLAG_POLE_W = 2; // cells

// The wave. REST is where the flag is held the rest of the race — back and
// down across the body, which reads as furled at this size without needing a
// second bake of a furled flag.
const WAVE_SWING = 0.85; // rad either side of straight out
const WAVE_RATE = 7.5; // rad/s of phase — a little over one sweep a second
const REST_ANGLE = 2.5; // rad, flag held down at their side
const RAISE_MS = 500; // ms to bring it up into the wave

// A waved flag is at full stretch where it is moving fastest and furls at the
// ends of the stroke, where it has stopped to turn around. The swing is a sine
// of the phase, so its speed is the cosine of it — which is the whole ripple.
const RIPPLE_MIN = 0.72; // fraction of the flag's width at the ends of a stroke

// Facing up (-y), the way RaceGrid's own angles are measured, so the rotation
// that points them at the road is atan2(dx, -dy).
//
// The figure reads left to right as **hand — body and head — hand**, and that
// is the whole composition. From directly overhead an arm is foreshortened to
// almost nothing: what is actually visible is a hand out beside each shoulder,
// with the outline running between it and the body, so the three read as three
// blobs on one line rather than as limbs. Every earlier pass here drew the arms
// reaching *forward* into the frame, which is a three-quarter view smuggled
// into a top-down one, and it came out as a bag with a handle every time.
//
// So the sprite is wider than it is deep, the head sits on the body's own
// centre — overhead, a head sits *on* the shoulders — and the flag is held in
// one of the two hands. FLAG_PIVOT is that hand, well off the centreline, which
// is what hinges the sweep at the end of an arm instead of the middle of a
// chest.
//
//   O outline   B jacket   D its shade (down the flanks and across the tail)
//   L its highlight, on the leading edge only — a band across the shoulders as
//     well puts two light bars on a figure that already has a light cap, and
//     they read as labels on a bag rather than as one person
//   S hands   C cap, its shaded half   H the lit half of the same cap
//
// The cap is four cells across at its ends and six through the middle. Cutting
// the corners off a four-wide one instead — narrow, wide, wide, narrow — is a
// plus sign, not a head, and it read as a first-aid badge on the coat every
// time. Six cells is what buys a corner to cut at all.
//
// Two things here are what stop the coat reading as a **belly**, and both are
// about where the bright orange is rather than what shape the outline is:
//
//  * The shaded tail is solid. It used to keep a run of coat colour down its
//    centre, and a bright lobe walled in by shade on three sides is a paunch —
//    it is the only thing the eye can read it as.
//  * The head is centred on the body's full length, tail included, and it is
//    big enough to hold that centre. A small cap sitting well back leaves four
//    or five rows of unbroken coat in front of it, and that expanse is a gut
//    however neatly it is outlined.
// prettier-ignore
const MARSHAL_PIXELS = [
  "......OOOO......",
  "....OOLLLLOO....",
  "...OBBBBBBBBO...",
  "OOOOBBBHHBBBOOOO",
  "OSSOBBHHHHBBOSSO",
  "OSSOBBHHHHBBOSSO",
  "OSSOBBCCCCBBOSSO",
  "OSSOBBBCCBBBOSSO",
  "OOOOBBBBBBBBOOOO",
  "...OBBBBBBBBO...",
  "....ODDDDDDO....",
  "......OOOO......",
];

const MARSHAL_COAT = "#ef7d1a"; // hi-vis, and the one colour the rest derives from

// The cap is the driver's helmet colour, and deliberately: it is the one light
// thing on the figure, so the head reads as a head at this size instead of the coat
// reading as a crate, and a marshal and a driver end up wearing the same white
// on the same green. It is domed — base, then a brighter crown — because a flat
// disc inside a black ring reads as a hole in the coat.
//
// The near-black is the *outer* silhouette only. Ringing the head in it as well
// was the version that read as a lens set into a bag rather than a head on a
// pair of shoulders: at six cells across, a hard line all the way round a light
// disc is most of the disc. What seats the head instead is the shadow it casts
// on the coat behind it — one row of the coat's own shade, in the direction the
// light in this game already comes from. It is the same near-black the cars'
// darkest pixels use, so nothing on the circuit is blacker than anything else.
const MARSHAL_PALETTE = {
  O: "#141414",
  S: "#d9a06a",
  C: "#dcd5c6",
  H: "#f4f0e6",
};

const FLAG_PALETTE = {
  a: "#f2f2f2",
  b: "#141414",
  P: "#6b5030",
};

function flagGrid() {
  const rows = [];
  const poleFrom = (FLAG_W - FLAG_POLE_W) / 2;
  for (let y = 0; y < FLAG_H; y++) {
    let row = "";
    for (let x = 0; x < FLAG_W; x++) {
      if (y < FLAG_PANEL_H) {
        const dark =
          (Math.floor(x / FLAG_SQUARE) + Math.floor(y / FLAG_SQUARE)) % 2;
        row += dark ? "b" : "a";
      } else {
        row += x >= poleFrom && x < poleFrom + FLAG_POLE_W ? "P" : ".";
      }
    }
    rows.push(row);
  }
  return rows;
}

// Every fixed colour pulled toward the night sky, the way carSprites.js dims a
// car's whole palette rather than its paint alone: a coat dimmed on its own
// would leave a near-white cap as the brightest thing on the circuit, which is
// the same mistake, one figure smaller.
function dimmed(colors, dim) {
  const out = {};
  for (const k in colors)
    out[k] = dim > 0 ? mixHex(colors[k], NIGHT_LIVERY, dim) : colors[k];
  return out;
}

const Marshal = {
  // Baked in device pixels, like every other sprite in the game, so the draw
  // downstream never resamples the grid. RenderScale.apply() is what throws
  // this away when the scale moves.
  bake(rows, palette) {
    const scale = renderDpr;
    const w = rows[0].length;
    const h = rows.length;
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const g = c.getContext("2d");

    // Runs of one colour go out as one fillRect — same reason carSprites.js
    // does it, and it matters more here: the chequers are 2-cell runs and the
    // coat is one run a row.
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      let x = 0;
      while (x < w) {
        const ch = row[x];
        let end = x;
        while (end < w && row[end] === ch) end++;
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

  // The coat is dimmed *before* its shade and its highlight are derived from
  // it, so after dark the marshal's own shadow stays orange rather than
  // drifting to grey — exactly the order CarSprites.bakeRegion() derives a
  // livery in, and the reason those three are not simply run through dimmed()
  // with the rest: mixColor() hands back `rgb(...)`, which mixHex() cannot
  // parse, and dimming a derived colour a second time is a different answer
  // anyway.
  body(dim) {
    const coat = dim > 0 ? mixHex(MARSHAL_COAT, NIGHT_LIVERY, dim) : MARSHAL_COAT;
    return this.bake(MARSHAL_PIXELS, {
      ...dimmed(MARSHAL_PALETTE, dim),
      B: coat,
      D: mixColor(coat, -0.55),
      L: mixColor(coat, 0.3),
    });
  },

  flag(dim) {
    if (!this._flagGrid) this._flagGrid = flagGrid();
    return this.bake(this._flagGrid, dimmed(FLAG_PALETTE, dim));
  },

  // Where the marshal stands: at the start line, out on the verge. Found by
  // marching sideways along the line's own long axis until the road field says
  // this is no longer road — the same technique Night.buildLights() uses to
  // stand its floodlights, and for the same reason, which is that a new
  // circuit has to post its own marshal without anyone editing a track file.
  //
  // The long axis is the one to walk: the painted tile-9 run spans the road
  // and stops at it, so walking along it is walking off the side of the track,
  // while walking across it is driving the lap.
  post(world) {
    const line = RaceGrid.startLine(world);
    if (!line) return null;

    const along =
      line.x1 - line.x0 >= line.y1 - line.y0 ? { x: 1, y: 0 } : { x: 0, y: 1 };

    // Backed up the straight along the ring rather than along the line's own
    // short axis, because that axis has no sign: which way round the circuit
    // is driven is a fact about the waypoints, not about the painted tiles.
    // Waypoint 0 sits within ~30px of the line (see RaceLaps.score), so a short
    // step along the ring from there is the direction of travel at it.
    const here = RaceGrid.ringPoint(world, 0);
    const ahead = RaceGrid.ringPoint(world, 0.02);
    const run = Math.hypot(ahead.x - here.x, ahead.y - here.y) || 1;
    const cx =
      (line.x0 + line.x1) / 2 - ((ahead.x - here.x) / run) * MARSHAL_BEFORE_LINE;
    const cy =
      (line.y0 + line.y1) / 2 - ((ahead.y - here.y) / run) * MARSHAL_BEFORE_LINE;

    const worldW = world.data.map[0].length * world.data.tileSize;
    const worldH = world.data.map.length * world.data.tileSize;

    let best = null;
    for (const side of [1, -1]) {
      const dx = along.x * side;
      const dy = along.y * side;
      for (let d = 8; d <= MARSHAL_REACH; d += 8) {
        if (world.sampleRoad(cx + dx * d, cy + dy * d) >= MARSHAL_VERGE) continue;
        const x = cx + dx * (d + MARSHAL_STANDOFF);
        const y = cy + dy * (d + MARSHAL_STANDOFF);
        if (x < 16 || y < 16 || x > worldW - 16 || y > worldH - 16) break;
        // Nearest verge wins: a marshal's post is at the edge of the track,
        // and on a circuit whose start line runs to the map edge one side can
        // be a field away.
        if (!best || d < best.d)
          best = { d, x, y, angle: Math.atan2(-dx, dy) }; // facing back at the road
        break;
      }
    }
    return best;
  },

  // Called once the circuit is baked. Returns quietly on a track whose start
  // line is unpaintable or hemmed in — a missing marshal is scenery that isn't
  // there, and nothing else in the race reads this.
  init(scene, world) {
    this.container = null;
    this.phase = 0;
    this.raise = 0;

    const spot = this.post(world);
    if (!spot) return;

    const cell = MARSHAL_WIDTH / MARSHAL_PIXELS[0].length;
    this.container = scene.add
      .container(spot.x, spot.y)
      .setRotation(spot.angle)
      .setDepth(3); // over the cars: they are on the road, the marshal is not

    this.bodyImg = scene.add.image(0, 0, this.bodyTexture(scene, 0));
    this.flagImg = scene.add
      .image(
        (FLAG_PIVOT.x - MARSHAL_PIXELS[0].length / 2) * cell,
        (FLAG_PIVOT.y - MARSHAL_PIXELS.length / 2) * cell,
        this.flagTexture(scene, 0),
      )
      .setOrigin(0.5, 1); // the pole's foot, in their hands, is what it turns about

    this.container.add([this.bodyImg, this.flagImg]);
    this.cell = cell;
  },

  // Through the scene's own baked-texture cache, so these are tracked
  // alongside the car sprites and thrown out with them when the render scale
  // moves — a marshal baked at the old dpr is the same stale sprite a car
  // baked at it would be.
  bodyTexture(scene, dim) {
    return scene.bakedTexture(`marshal@${dim}`, () => this.body(dim));
  },

  flagTexture(scene, dim) {
    return scene.bakedTexture(`flag@${dim}`, () => this.flag(dim));
  },

  // `waving` is the race telling the marshal the field is on its last lap.
  // The dim is passed in rather than read here so the marshal fades into the
  // night on the same frame's value as the cars do.
  update(scene, deltaMs, waving, dim) {
    if (!this.container) return;

    const dir = waving ? 1 : -1;
    this.raise = Math.max(0, Math.min(1, this.raise + (dir * deltaMs) / RAISE_MS));
    // The phase runs whenever the flag is off its rest position, so the sweep
    // is already under way as it comes up rather than starting once it is
    // there — a flag that rises rigid and then begins to move reads as two
    // animations played in sequence.
    if (this.raise > 0) this.phase += (WAVE_RATE * deltaMs) / 1000;

    const swing = WAVE_SWING * Math.sin(this.phase);
    this.flagImg.setRotation(REST_ANGLE + (swing - REST_ANGLE) * this.raise);

    const ripple =
      RIPPLE_MIN + (1 - RIPPLE_MIN) * Math.abs(Math.cos(this.phase)) * this.raise;

    // Re-pointed and re-sized every frame for the same reason the cars' own
    // sprites are re-pointed: a night fade or a render-scale step swaps the
    // texture under them, and setTexture takes the new frame's pixel size with
    // it. Handing back a world-px size each frame is what keeps a marshal the
    // same size through both.
    this.bodyImg.setTexture(this.bodyTexture(scene, dim));
    this.bodyImg.setDisplaySize(
      MARSHAL_PIXELS[0].length * this.cell,
      MARSHAL_PIXELS.length * this.cell,
    );
    this.flagImg.setTexture(this.flagTexture(scene, dim));
    this.flagImg.setDisplaySize(
      FLAG_W * this.cell * ripple,
      FLAG_H * this.cell,
    );
  },
};
