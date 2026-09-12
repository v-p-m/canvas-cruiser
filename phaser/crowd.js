// The spectators — the second *role* over human.js's figure, and the one that
// proves the 0.21.0 split was worth making: a crowd is the coat, the spot and
// the count, and not one pixel of new art.
//
// It is decoration and claims nothing else. No body, no collision, nothing the
// race code can see — a car drives through the grass a crowd is standing on
// exactly as it did before. The only thing here that could ever cost a frame is
// how often the figures are touched, which is what the refresh gate in update()
// is about.
//
// Where they stand is marched off the track's own road field rather than
// authored into tracks/*.json, the same bargain Night.buildLights() and
// Marshal.post() strike: a new circuit stands its own crowd up, and nothing in
// the track format changes.

const GROUP_SPACING = 640; // world px along the ring between one crowd and the next
const GROUP_MIN = 3; // people in the smallest knot
const GROUP_MAX = 6; // people in the largest
// A knot is a jittered *lattice*, not a scatter and not a rank. Scattering both
// axes freely and rejecting the collisions measured two spectators 2 world px
// apart — one figure standing inside another — and costs a retry loop to fix;
// laying them out in one rank instead fixed that and made every crowd a queue.
// Filling two ranks off the fence is what reads as a huddle, and the jitter is
// bounded well under the pitch so no arrangement of it can stack anyone.
const GROUP_PITCH = 20; // world px between neighbours across a rank
const GROUP_ROWS = 2; // ranks deep
const ROW_DEPTH = 15; // world px between one rank and the next, back from the road
const GROUP_JITTER = 7; // world px of nudge, both axes
const GROUP_FACE = 0.3; // rad: everyone watches the road, nobody stands to attention
const CROWD_MAX = 56; // people, whole circuit — a cap, not a target

// How much room the marshal gets. They are posted on the verge at the start
// line, which is exactly the sort of place a crowd wants to stand, and a
// spectator baked over the top of them is the one overlap that reads as a bug
// rather than as a crowd.
const MARSHAL_CLEAR = 90; // world px

// Muted, and deliberately none of them hi-vis: MARSHAL_COAT is what says
// "official", and a spectator wearing it is a marshal standing in a field.
// Six is one bake each per night-dim step, through the same scene texture cache
// the six car liveries go through.
const CROWD_COATS = [
  "#2f5aa8",
  "#a83c3c",
  "#3f7a52",
  "#7a4b8c",
  "#c9a227",
  "#4a4a55",
];

// Deterministic scatter, not Math.random(): a circuit keeps the *same* crowd
// every race, which is what makes it read as part of the place rather than as
// confetti thrown at it each time the scene reloads — and it is what lets two
// headless screenshots of one circuit be compared at all. Same integer-hash
// idiom track.js seeds its tarmac patches with (track.js:393).
function crowdHash(a, b) {
  const n = (a * 73856093) ^ (b * 19349663);
  return ((n >>> 0) % 10000) / 10000;
}

const Crowd = {
  // Called once the circuit is baked, beside Marshal.init(). Returns quietly on
  // a track with no ring or no verge to stand on — an empty crowd is scenery
  // that isn't there, and nothing else in the race reads this.
  init(scene, world) {
    this.figures = [];
    this._dim = -1; // forces the first refresh() below, whatever the night is doing
    this._dpr = 0;

    const wps = (world.data && world.data.waypoints) || [];
    if (wps.length < 2) return;

    const worldW = world.data.map[0].length * world.data.tileSize;
    const worldH = world.data.map.length * world.data.tileSize;
    const spots = [];

    // The ring, marched at a fixed spacing with the distance owed carried
    // across each segment join, so the groups stay evenly spread rather than
    // bunching wherever two waypoints happen to be close together
    // (shared/night.js:98).
    let side = 1; // alternates, so both verges get a crowd
    let carry = 0;
    for (let i = 0; i < wps.length; i++) {
      const a = wps[i];
      const b = wps[(i + 1) % wps.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const nx = -dy / len;
      const ny = dx / len;

      for (let d = carry; d < len; d += GROUP_SPACING) {
        const t = d / len;
        const px = a.x + dx * t;
        const py = a.y + dy * t;
        const s = side;
        side = -side;

        // The asked-for side first, the other only as a fallback — the crowd
        // wants to alternate, where Human.vergeSpot()'s own nearest-verge-wins
        // is what a lone post wants. Night._verge() picks its sides the same way.
        const spot =
          Human.vergeSpot(world, px, py, { x: nx, y: ny }, [s]) ||
          Human.vergeSpot(world, px, py, { x: nx, y: ny }, [-s]);
        if (!spot) continue;
        // Marshal.init() runs first (phaser/raceScene.js), so their post is
        // already standing and can simply be stood clear of.
        const m = Marshal.figure && Marshal.figure.container;
        if (m && Math.hypot(m.x - spot.x, m.y - spot.y) < MARSHAL_CLEAR) continue;
        // A hairpin doubles back on itself, so two stations a long way apart
        // along the ring can want the same patch of grass.
        if (
          spots.some(
            (o) => Math.hypot(o.x - spot.x, o.y - spot.y) < GROUP_SPACING * 0.5,
          )
        )
          continue;

        // spot.nx/ny is the march that found this verge, so it points away from
        // the road whichever side answered; the tangent is the segment itself.
        // A knot then spreads along the fence and back off it, never across it.
        spot.tanX = dx / len;
        spot.tanY = dy / len;
        spots.push(spot);
      }
      carry = (GROUP_SPACING - ((len - carry) % GROUP_SPACING)) % GROUP_SPACING;
    }

    for (let g = 0; g < spots.length; g++) {
      const spot = spots[g];
      const n =
        GROUP_MIN + Math.floor(crowdHash(g, 1) * (GROUP_MAX - GROUP_MIN + 1));
      const coatFrom = Math.floor(crowdHash(g, 7) * CROWD_COATS.length);
      const coatStep = crowdHash(g, 8) < 0.5 ? 1 : CROWD_COATS.length - 1;
      for (let i = 0; i < n; i++) {
        if (this.figures.length >= CROWD_MAX) break;
        const row = i % GROUP_ROWS;
        const col = Math.floor(i / GROUP_ROWS);
        const cols = Math.ceil(n / GROUP_ROWS);
        const along =
          (col - (cols - 1) / 2) * GROUP_PITCH +
          row * (GROUP_PITCH / 2) + // the back rank stands in the front one's gaps
          (crowdHash(g, i * 3 + 2) - 0.5) * GROUP_JITTER;
        // Never negative: back is away from the road, and a negative one would
        // walk someone toward the kerb the verge march just cleared.
        const back = row * ROW_DEPTH + crowdHash(g, i * 3 + 3) * GROUP_JITTER;
        const x = spot.x + spot.tanX * along + spot.nx * back;
        const y = spot.y + spot.tanY * along + spot.ny * back;
        // The verge is only where the *centre* of the knot was measured: a
        // tight infield is road again a few px past it, and the scatter is what
        // would put someone out there.
        if (world.sampleRoad(x, y) >= HUMAN_VERGE) continue;
        if (x < 16 || y < 16 || x > worldW - 16 || y > worldH - 16) continue;

        const angle = spot.angle + (crowdHash(g, i * 3 + 4) - 0.5) * GROUP_FACE;
        // Dealt, not drawn: the knot walks the palette from a hashed start in
        // a hashed direction, so up to CROWD_COATS.length people standing
        // together are all in different coats and the order still changes from
        // group to group. Picking each coat independently put two yellows
        // shoulder to shoulder, which at this size reads as one wide person.
        const coat = CROWD_COATS[(coatFrom + i * coatStep) % CROWD_COATS.length];
        this.figures.push(Human.spawn(scene, { x, y, angle }, coat));
      }
      if (this.figures.length >= CROWD_MAX) break;
    }
  },

  // Where the marshal refreshes every frame — it is one figure, and it is
  // already animating — a crowd is static and refreshes only when something
  // has actually swapped the texture under it. Those are the only two things
  // that can: a night fade re-bakes the palette, and RenderScale.apply()
  // removes the keys outright on its way through invalidateCarTextures().
  //
  // Note that this runs at least once, from the -1 dim init() seeds: spawn()
  // adds the image without a display size, and only refresh() sets one.
  update(scene, dim) {
    if (dim === this._dim && renderDpr === this._dpr) return;
    this._dim = dim;
    this._dpr = renderDpr;
    for (const f of this.figures) f.refresh(scene, dim);
  },
};
