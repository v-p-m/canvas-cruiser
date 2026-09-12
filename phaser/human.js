// A person, on foot, seen from above — the figure itself, with no job.
//
// Split out of marshal.js in 0.21.0: waving a chequered flag is a *role*, and
// the body doing it is not. A mechanic on the pit wall, a photographer on the
// infield or a spectator behind the barrier is the same 16x12 grid of pixels
// standing in a different place holding a different thing, so what a role has
// to supply is a coat colour, a spot, and whatever it is carrying — never a
// second copy of the art.
//
// Art, and why it is here rather than in carSprites.js: same technique, same
// derivation — one body colour, its shade and its highlight computed off it at
// bake time (mixColor/mixHex, borrowed from carSprites.js so a person and a
// car are lit by the same arithmetic) — but nothing on the editor page draws
// one, and shared/ is the set of files both pages load. So the grid lives on
// the page that shows it.
//
// The figure is drawn the way the old top-down shooters draw a person,
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
// twenty-five hand to hand, which is a metre and a half of shoulder — a person
// who could not have got into the car they are waving at.
//
// The grid is sized in even cells on purpose: renderDpr's other stop is 1.5,
// and an odd count bakes to a half pixel that has to be rounded and then
// resampled on the way back down. Anything a role bakes to put in their hands
// wants the same.
const HUMAN_WIDTH = 16; // world px, over the whole 16-cell grid
const HUMAN_STANDOFF = 10; // world px past the road edge, so nobody clips them
const HUMAN_REACH = 220; // world px of sideways march looking for the verge
const HUMAN_VERGE = 0.35; // road-field value below which this is not road
const HUMAN_DEPTH = 3; // over the cars: they are on the road, a person is not

// Where a carried thing sits in the grid: the middle of one of the two hands —
// the far end of the figure, not its centreline, because that is what is
// gripping it. A prop rotates about this point.
const HUMAN_HAND = { x: 14, y: 6 }; // cells

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
// centre — overhead, a head sits *on* the shoulders — and anything carried is
// held in one of the two hands. HUMAN_HAND is that hand, well off the
// centreline, which is what hinges a sweep at the end of an arm instead of the
// middle of a chest.
//
//   O outline   B coat   D its shade (down the flanks and across the tail)
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
// about where the bright colour is rather than what shape the outline is:
//
//  * The shaded tail is solid. It used to keep a run of coat colour down its
//    centre, and a bright lobe walled in by shade on three sides is a paunch —
//    it is the only thing the eye can read it as.
//  * The head is centred on the body's full length, tail included, and it is
//    big enough to hold that centre. A small cap sitting well back leaves four
//    or five rows of unbroken coat in front of it, and that expanse is a gut
//    however neatly it is outlined.
// prettier-ignore
const HUMAN_PIXELS = [
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

// The default coat, and the one colour the shade and the highlight derive
// from. A role that wants its own passes one in; hi-vis orange is what someone
// working trackside wears, so it is the fallback rather than a marshal's
// private constant.
const HUMAN_COAT = "#ef7d1a";

// The cap is the driver's helmet colour, and deliberately: it is the one light
// thing on the figure, so the head reads as a head at this size instead of the
// coat reading as a crate, and someone trackside and a driver end up wearing
// the same white on the same green. It is domed — base, then a brighter crown —
// because a flat disc inside a black ring reads as a hole in the coat.
//
// The near-black is the *outer* silhouette only. Ringing the head in it as well
// was the version that read as a lens set into a bag rather than a head on a
// pair of shoulders: at six cells across, a hard line all the way round a light
// disc is most of the disc. What seats the head instead is the shadow it casts
// on the coat behind it — one row of the coat's own shade, in the direction the
// light in this game already comes from. It is the same near-black the cars'
// darkest pixels use, so nothing on the circuit is blacker than anything else.
const HUMAN_PALETTE = {
  O: "#141414",
  S: "#d9a06a",
  C: "#dcd5c6",
  H: "#f4f0e6",
};

const Human = {
  // Baked in device pixels, like every other sprite in the game, so the draw
  // downstream never resamples the grid. RenderScale.apply() is what throws
  // this away when the scale moves.
  //
  // Public because a role's props go through it too: a flag, a pit board or a
  // camera is the same kind of grid, and baking it any other way would be a
  // second answer to how a pixel lands on a device pixel.
  bake(rows, palette) {
    const scale = renderDpr;
    const w = rows[0].length;
    const h = rows.length;
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
    const g = c.getContext("2d");

    // Runs of one colour go out as one fillRect — same reason carSprites.js
    // does it, and it matters more here: a coat is one run a row, and the
    // chequers of a flag are 2-cell runs.
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

  // Every fixed colour pulled toward the night sky, the way carSprites.js dims
  // a car's whole palette rather than its paint alone: a coat dimmed on its own
  // would leave a near-white cap as the brightest thing on the circuit, which
  // is the same mistake, one figure smaller. Props dim through here as well.
  dimPalette(colors, dim) {
    const out = {};
    for (const k in colors)
      out[k] = dim > 0 ? mixHex(colors[k], NIGHT_LIVERY, dim) : colors[k];
    return out;
  },

  // The coat is dimmed *before* its shade and its highlight are derived from
  // it, so after dark a figure's own shadow stays the coat's colour rather than
  // drifting to grey — exactly the order CarSprites.bakeRegion() derives a
  // livery in, and the reason those three are not simply run through
  // dimPalette() with the rest: mixColor() hands back `rgb(...)`, which
  // mixHex() cannot parse, and dimming a derived colour a second time is a
  // different answer anyway.
  body(dim, coatHex) {
    const base = coatHex || HUMAN_COAT;
    const coat = dim > 0 ? mixHex(base, NIGHT_LIVERY, dim) : base;
    return this.bake(HUMAN_PIXELS, {
      ...this.dimPalette(HUMAN_PALETTE, dim),
      B: coat,
      D: mixColor(coat, -0.55),
      L: mixColor(coat, 0.3),
    });
  },

  // Through the scene's own baked-texture cache, so these are tracked
  // alongside the car sprites and thrown out with them when the render scale
  // moves — a figure baked at the old dpr is the same stale sprite a car baked
  // at it would be. Keyed by coat as well as by dim, for the same reason
  // CarSprites keys its cache by livery.
  texture(scene, dim, coatHex) {
    const coat = coatHex || HUMAN_COAT;
    return scene.bakedTexture(`human:${coat}@${dim}`, () =>
      this.body(dim, coat),
    );
  },

  // Where someone stands: off the road, at the edge of it. Found by marching
  // sideways from a point on the track along `along` until the road field says
  // this is no longer road — the same technique Night.buildLights() uses to
  // stand its floodlights, and for the same reason, which is that a new circuit
  // has to post its own people without anyone editing a track file.
  //
  // Both sides are tried and the nearest verge wins: on a circuit whose road
  // runs to the map edge one side can be a field away. Returns null where the
  // march finds nothing inside the map, which is the caller's cue to put nobody
  // there at all.
  //
  // `sides` is which of the two to try, and it is what a caller who wants a
  // *chosen* verge asks with: nearest-wins is right for a lone post and cannot
  // express "this side, and the other one only if there is nothing here",
  // which is what a crowd alternating along the ring needs (phaser/crowd.js).
  // `nx`/`ny` come back with the spot for the same reason Night._verge() hands
  // them out — they are the direction that was marched, so away from the road.
  vergeSpot(world, cx, cy, along, sides = [1, -1]) {
    const worldW = world.data.map[0].length * world.data.tileSize;
    const worldH = world.data.map.length * world.data.tileSize;

    let best = null;
    for (const side of sides) {
      const dx = along.x * side;
      const dy = along.y * side;
      for (let d = 8; d <= HUMAN_REACH; d += 8) {
        if (world.sampleRoad(cx + dx * d, cy + dy * d) >= HUMAN_VERGE) continue;
        const x = cx + dx * (d + HUMAN_STANDOFF);
        const y = cy + dy * (d + HUMAN_STANDOFF);
        if (x < 16 || y < 16 || x > worldW - 16 || y > worldH - 16) break;
        if (!best || d < best.d)
          best = { d, x, y, nx: dx, ny: dy, angle: Math.atan2(-dx, dy) }; // facing back at the road
        break;
      }
    }
    return best;
  },

  // One person, standing at `spot`, in `coat`. Handed back as a small object
  // rather than mutating the caller: a role holds one of these the way it holds
  // any other sprite, and a scene that wanted a crowd would hold several.
  //
  // `hand` is HUMAN_HAND in the container's own world-px frame, so a role can
  // put a prop in it without knowing the grid.
  spawn(scene, spot, coat) {
    const cell = HUMAN_WIDTH / HUMAN_PIXELS[0].length;
    const container = scene.add
      .container(spot.x, spot.y)
      .setRotation(spot.angle)
      .setDepth(HUMAN_DEPTH);
    const image = scene.add.image(0, 0, this.texture(scene, 0, coat));
    container.add(image);

    return {
      container,
      image,
      cell,
      coat,
      hand: {
        x: (HUMAN_HAND.x - HUMAN_PIXELS[0].length / 2) * cell,
        y: (HUMAN_HAND.y - HUMAN_PIXELS.length / 2) * cell,
      },

      // Re-pointed and re-sized every frame for the same reason the cars' own
      // sprites are: a night fade or a render-scale step swaps the texture
      // under them, and setTexture takes the new frame's pixel size with it.
      // Handing back a world-px size each frame is what keeps a figure the same
      // size through both.
      refresh(sc, dim) {
        this.image.setTexture(Human.texture(sc, dim, this.coat));
        this.image.setDisplaySize(
          HUMAN_PIXELS[0].length * this.cell,
          HUMAN_PIXELS.length * this.cell,
        );
      },
    };
  },
};
