// The flag marshal — the *role*: a person posted on the verge at the start
// line, who waves the chequered flag once the race is in its final lap.
//
// The body is not here. Since 0.21.0 the figure, its palette, its baking and
// its verge-finding are phaser/human.js, and what this file owns is everything
// that makes that figure a marshal rather than anyone else standing trackside:
// the coat, where the post is, the flag, and the wave. A second trackside
// person is a second file this size, not a second copy of the art.
//
// The flag is a sprite, not an animation strip: it is baked once and the wave
// is that bake rotated about the hands every frame. That is exactly what
// carSprites.js does with the front wheels, for the same reason — a strip would
// be a dozen bakes per night-dim step to remove nothing anyone can see at this
// size, and a rotation is smooth at any frame rate.
//
// The chequers are generated rather than typed. Everything in this game's
// artwork is otherwise a decision about where a pixel goes; a checkerboard is a
// formula, and 140 hand-typed cells of one can only ever be wrong.

// Hi-vis, which is what a marshal wears — and it is passed to Human rather than
// baked into it, because the coat is the one thing that says which job this
// figure has.
const MARSHAL_COAT = "#ef7d1a";

// How far back up the straight the post is, against the direction of travel.
// Standing dead level with the line puts a chequered flag over the chequered
// paint, and at half the angles of the sweep the two line up into one stripe —
// so the flag is waved at the cars on their way to the line rather than across
// the thing it is painted to look like.
const MARSHAL_BEFORE_LINE = 52; // world px

const FLAG_W = 14; // cells
const FLAG_H = 20; // cells — panel plus the pole down to the hands
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

const Marshal = {
  flag(dim) {
    if (!this._flagGrid) this._flagGrid = flagGrid();
    return Human.bake(this._flagGrid, Human.dimPalette(FLAG_PALETTE, dim));
  },

  // Alongside the figure and the cars in the scene's own baked-texture cache,
  // so a render-scale step throws the flag out with everything else it invalidates.
  flagTexture(scene, dim) {
    return scene.bakedTexture(`flag@${dim}`, () => this.flag(dim));
  },

  // Where this particular person stands: at the start line, out on the verge.
  // Human.vergeSpot() does the marching; the marshal's part is which point on
  // the track to march from and along which axis.
  //
  // The line's long axis is the one to walk: the painted tile-9 run spans the
  // road and stops at it, so walking along it is walking off the side of the
  // track, while walking across it is driving the lap.
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

    return Human.vergeSpot(world, cx, cy, along);
  },

  // Called once the circuit is baked. Returns quietly on a track whose start
  // line is unpaintable or hemmed in — a missing marshal is scenery that isn't
  // there, and nothing else in the race reads this.
  init(scene, world) {
    this.figure = null;
    this.phase = 0;
    this.raise = 0;

    const spot = this.post(world);
    if (!spot) return;

    this.figure = Human.spawn(scene, spot, MARSHAL_COAT);
    this.flagImg = scene.add
      .image(this.figure.hand.x, this.figure.hand.y, this.flagTexture(scene, 0))
      .setOrigin(0.5, 1); // the pole's foot, in their hands, is what it turns about
    this.figure.container.add(this.flagImg);
  },

  // `waving` is the race telling the marshal the field is on its last lap.
  // The dim is passed in rather than read here so the marshal fades into the
  // night on the same frame's value as the cars do.
  update(scene, deltaMs, waving, dim) {
    if (!this.figure) return;

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

    // Re-pointed and re-sized every frame for the same reason the figure is —
    // see Human.spawn()'s refresh(): a night fade or a render-scale step swaps
    // the texture under the sprite, and setTexture takes the new frame's pixel
    // size with it.
    this.figure.refresh(scene, dim);
    this.flagImg.setTexture(this.flagTexture(scene, dim));
    this.flagImg.setDisplaySize(
      FLAG_W * this.figure.cell * ripple,
      FLAG_H * this.figure.cell,
    );
  },
};
