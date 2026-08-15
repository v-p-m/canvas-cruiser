// Skid marks — the rubber a sliding tire leaves on dry tarmac, and the water
// it squeegees off wet tarmac.
//
// The legacy loop bakes marks into an offscreen 2D canvas in world space
// (game.js's `skidCanvas`) and blits the visible rect of it under the cars.
// The same idea in Phaser's terms is a RenderTexture the size of the track,
// shown by one game object at a depth below the cars: the layer stays in world
// coordinates, Phaser's camera scrolls it for free, and the marks accumulate on
// the GPU instead of being re-blitted every frame.
//
// It is not a straight port, because three things about the legacy marks are
// wrong on the road rather than wrong in the code:
//
//  * A mark is the *path* a tire took over the last frame, not a stamp where it
//    happened to be when the frame ended. The legacy layer paints a fixed 10px
//    rect per frame per side, but a car at 100cc covers 8-10 world px in that
//    frame and a 250cc one half as much again — so the marks came out as a
//    dashed line whose gaps grew with speed. The faster the slide, the less of
//    it you could see, which is backwards. A quad from last frame's tire
//    position to this one's is continuous at any speed.
//  * Slip is a ramp above a floor, not a switch. One threshold means a corner
//    either scours the tarmac at full darkness or leaves nothing, and the car
//    spends most of its life either side of the line. A tire past the threshold
//    now marks at SKID_MIN_LOAD and darkens from there as the slide builds — a
//    ramp starting at zero was worse than the switch, because ordinary
//    cornering sits just over the line and every mark came out at 2% alpha.
//  * Four tires, not two, and only where the tires actually are — the legacy
//    pair sat at the body's half-width, which is the sidepod, not the contact
//    patch. Braking marks the fronts hardest (weight goes forward), power marks
//    the rears, and a slide marks all four.
//
// Dry and wet are different marks, not the same mark faded:
//
//  * Dry, a locked or scrubbing tire abrades rubber onto the road and it stays
//    there — black, and it accumulates all race.
//  * Wet, rubber will not bond to a film of water. What a tire leaves instead
//    is the film pushed aside: a *lighter* streak of cleared road that the rain
//    fills back in within a few seconds. So the mark colour lerps to a pale
//    water-clear with the rain, and the whole layer — the race's dry rubber
//    included — washes off at a rate set by the rain's own intensity. Driving
//    the mark's look off `Rain.intensity` rather than a wet flag means the
//    handover both ways happens over the same lerp the sky does.
//
// Grass takes neither: a tire off the road throws dirt, it does not lay a black
// line on a green field. The wheel is sampled against the same road field the
// physics reads (`world.offRoad`), so what marks and what does not agrees with
// what the player can see.

const SKID_MAX_EDGE = 4096; // px — cap on the layer's own resolution, not its extent
const SKID_SLIP_START = 1.8; // world px/frame of lateral slide before a mark shows
const SKID_SLIP_FULL = 4.5; // ...and where it is as dark as the tire can make it
const SKID_MIN_LOAD = 0.4; // a tire at the threshold already marks — see wheelLoad()
const SKID_REF_GRIP = 0.1; // the grip the two above were measured at — entity.driftGrip
const SKID_MARK_W = 5; // world px — the contact patch, narrower than the tire
const SKID_MIN_SPEED = 0.5; // world px/frame — below this a car is parked, not sliding
const SKID_MAX_SEGMENT = 40; // world px — a longer step is a respawn, not a slide
const LOCKUP_FROM = 0.35; // fraction of maxSpeed: braking above this locks the fronts
const LOCKUP_RAMP = 0.3; // ...and it is fully locked this much faster again
const SPIN_BELOW = 0.25; // fraction of maxSpeed under which the throttle spins the rears
const SPIN_WEIGHT = 0.7; // wheelspin is a smudge, not a stripe — it happens at 2px/frame
const DRY_ALPHA = 0.2; // per frame, at a full slide
const WET_ALPHA = 0.3; // a cleared line is bright, but the rain fills it back in (WASH_RATE)
const DRY_RUBBER = 0x141414;
const WET_STREAK = 0xd8ecf7;
const WASH_INTERVAL = 160; // ms between wash passes — a full-layer fill, so not every frame
const WASH_RATE = 0.05; // alpha erased per pass at full rain: a mark is gone in ~5s

// The four contact patches, in the sprite's own pixel grid (CAR_PIXELS in
// carSprites.js, 34x56 with the nose up) measured off the tire blocks rather
// than guessed: the fronts are rows 6-17, the rears rows 38-51, both pairs in
// columns 0-6 and 27-33. Positive `ly` is toward the tail, which is the same
// convention `wheelOffRoad()` and the spray in raceScene.js rotate with.
const SKID_WHEELS = [
  { lx: -13, ly: -16, rear: false },
  { lx: 13, ly: -16, rear: false },
  { lx: -13.5, ly: 16.5, rear: true },
  { lx: 13.5, ly: 16.5, rear: true },
];

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// Channel-wise, and by hand: Phaser's own colour interpolation builds two
// Color objects and returns a third, and this runs up to four times a car a
// frame.
function lerpColor(a, b, t) {
  const r = ((a >> 16) & 255) + (((b >> 16) & 255) - ((a >> 16) & 255)) * t;
  const g = ((a >> 8) & 255) + (((b >> 8) & 255) - ((a >> 8) & 255)) * t;
  const bl = (a & 255) + ((b & 255) - (a & 255)) * t;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

const SkidMarks = {
  layer: null,
  world: null,
  scale: 1,

  // One RenderTexture the size of the track, one Graphics that collects a
  // frame's worth of quads, one that does the washing. Depth 0.5 puts the
  // marks on the road (the bake is 0) but under the puddles (1), the spray
  // (1.5) and the cars (2) — water lies on top of rubber, and a mark is not
  // thrown up off the road the way spray is.
  init(scene, world) {
    this.world = world;
    const w = world.data.map[0].length * world.data.tileSize;
    const h = world.data.map.length * world.data.tileSize;
    this.scale = Math.min(1, SKID_MAX_EDGE / Math.max(w, h));
    this.texW = Math.round(w * this.scale);
    this.texH = Math.round(h * this.scale);

    this.layer = scene.add
      .renderTexture(0, 0, this.texW, this.texH)
      .setOrigin(0, 0)
      .setDisplaySize(w, h)
      .setDepth(0.5);

    this.batch = scene.make.graphics({ add: false });
    this.washGfx = scene.make.graphics({ add: false });
    this.washTimer = 0;
    // Last frame's tire positions, per car. Keyed by the entity, so an
    // opponent's trail is its own and a restart's fresh entities simply have
    // no history rather than joining up with the last race's.
    this.trails = new Map();
    this.pending = 0;
  },

  // One car, one frame. `input` is the same four booleans the keyboard and
  // AICar.drive() both produce, so the player and the opponents mark the road
  // through identical code — the CLAUDE.md rule that they are one car.
  trail(entity, input) {
    if (!this.layer) return;

    const cos = Math.cos(entity.angle);
    const sin = Math.sin(entity.angle);
    const s = entity.width / CAR_SPRITE_W; // sprite px -> world px, if the car is ever resized

    let prev = this.trails.get(entity);
    if (!prev) {
      prev = SKID_WHEELS.map(() => ({ x: 0, y: 0, seen: false }));
      this.trails.set(entity, prev);
    }

    const [front, rear] = this.wheelLoad(entity, input);

    for (let i = 0; i < SKID_WHEELS.length; i++) {
      const wheel = SKID_WHEELS[i];
      const lx = wheel.lx * s;
      const ly = wheel.ly * s;
      const x = entity.x + lx * cos - ly * sin;
      const y = entity.y + lx * sin + ly * cos;

      const was = prev[i];
      const load = wheel.rear ? rear : front;
      // The history is kept whether or not this wheel is marking: a segment is
      // always from where the tire was one frame ago, so a slide that starts
      // now starts here and not at the last place the car happened to slide.
      if (was.seen && load > 0) this.segment(was.x, was.y, x, y, load);
      was.x = x;
      was.y = y;
      was.seen = true;
    }
  },

  // How hard each end of the car is marking, 0-1: [front, rear].
  //
  // Sliding scrubs all four, the fronts slightly less because the rears are the
  // ones being asked for traction at the same time. Braking is the one that
  // locks — there is no ABS in this car, and the load transfer forward is why
  // the fronts are the pair that lock first. Power spins the rears, and only
  // while there is not enough road speed to absorb it.
  //
  // Neither of the last two is in the physics: the model has one `speed`
  // scalar, so there is nothing to be locked or spinning. They are drawn
  // because they are what the player is doing — standing on the brakes into a
  // hairpin, or lighting them up out of one — and the marks are the only place
  // the game can say so.
  wheelLoad(entity, input) {
    const slip = Math.abs(
      entity.velocityX * Math.cos(entity.angle) +
        entity.velocityY * Math.sin(entity.angle),
    );
    // Slip scales as 1/grip, so the same manoeuvre in a grippier car slides
    // proportionally less — the thresholds move with `driftGrip` for exactly
    // the reason game.js's skidThreshold() does. Rain deliberately stays out of
    // it: it lowers grip to make the car slide, and dividing that back out
    // would erase the point.
    const ref = SKID_REF_GRIP / entity.driftGrip;
    // Past the threshold the tire is scrubbing, and a scrubbing tire leaves a
    // mark you can see — the ramp above SKID_MIN_LOAD says how hard, it does not
    // start from nothing. A ramp off zero measured almost invisible in an actual
    // race: ordinary cornering sits just over the threshold, which put every
    // mark at 2% alpha, and only a full drift ever showed.
    const over = clamp01(
      (slip - SKID_SLIP_START * ref) /
        ((SKID_SLIP_FULL - SKID_SLIP_START) * ref),
    );
    const slide = over > 0 ? SKID_MIN_LOAD + (1 - SKID_MIN_LOAD) * over : 0;

    const speedFrac = Math.abs(entity.speed) / entity.maxSpeed;
    const lock =
      input && input.brake && entity.speed > 0
        ? clamp01((speedFrac - LOCKUP_FROM) / LOCKUP_RAMP)
        : 0;
    const spin =
      input && input.accel && entity.speed >= 0
        ? clamp01((SPIN_BELOW - speedFrac) / SPIN_BELOW) * SPIN_WEIGHT
        : 0;

    // Parked is judged on the velocity Matter actually gave the body, not on
    // `speed` — `speed` is the throttle's own scalar, and a car shoved sideways
    // by a rival has none of it and is still being dragged across the tarmac.
    const moving = Math.hypot(entity.velocityX, entity.velocityY);
    if (moving < SKID_MIN_SPEED && spin === 0) return [0, 0];

    return [
      Math.max(slide * 0.85, lock),
      Math.max(slide, lock * 0.7, spin),
    ];
  },

  // One tire's path over one frame, as a quad along it. Wet and dry are the
  // same geometry and a different pigment — see the header.
  segment(x0, y0, x1, y1, load) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len > SKID_MAX_SEGMENT) return; // a respawn, not a slide
    if (this.world.offRoad((x0 + x1) / 2, (y0 + y1) / 2) > 0.5) return; // dirt, not rubber

    const wet = Rain.intensity;
    const alpha = (DRY_ALPHA + (WET_ALPHA - DRY_ALPHA) * wet) * load;

    const s = this.scale;
    const g = this.batch;
    g.fillStyle(lerpColor(DRY_RUBBER, WET_STREAK, wet), alpha);

    if (len < 0.5) {
      // Sitting still and spinning them up: there is no path to stroke, so the
      // mark is the patch itself. Without this a standing start marks nothing
      // until the car has already gone.
      g.fillCircle(x1 * s, y1 * s, (SKID_MARK_W / 2) * s);
    } else {
      g.save();
      g.translateCanvas(((x0 + x1) / 2) * s, ((y0 + y1) / 2) * s);
      g.rotateCanvas(Math.atan2(dy, dx));
      g.fillRect((-len / 2) * s, (-SKID_MARK_W / 2) * s, len * s, SKID_MARK_W * s);
      g.restore();
    }
    this.pending++;
  },

  // Once a frame, after every car has laid its trail: the batch goes onto the
  // layer in one draw, and the rain washes at its own slower cadence.
  //
  // A Phaser 4 DynamicTexture is a **command buffer**, not a canvas: draw() and
  // erase() only queue, `render()` is what executes, and the queued DRAW holds a
  // *reference* to the Graphics rather than a copy of it. Two rules fall out of
  // that, and breaking either one is silent — no error, just a layer that stays
  // empty forever:
  //
  //   * render() has to be called, here, every frame that queued anything. The
  //     game object's default renderMode ("render") blits the texture and never
  //     executes its buffer, so without this nothing is ever drawn into it.
  //   * the batch Graphics can only be cleared *after* render(), or the commands
  //     execute against an emptied object.
  //
  // What the texture already holds is not part of that buffer, so the marks
  // accumulate across frames — which is the whole point of the layer.
  //
  // The wash is a full-layer erase, a fill the size of the track and an order of
  // magnitude more pixels than the marks themselves, which is why it runs on a
  // timer rather than per frame. Erasing at partial alpha multiplies what is
  // there by (1 - alpha), so old marks fade smoothly instead of snapping, and a
  // tire still sliding outruns the wash for as long as it keeps sliding.
  draw(deltaMs) {
    if (!this.layer) return;

    let queued = false;
    if (this.pending) {
      this.layer.draw(this.batch);
      queued = true;
    }

    if (Rain.intensity <= 0) {
      this.washTimer = 0;
    } else {
      this.washTimer += deltaMs;
      if (this.washTimer >= WASH_INTERVAL) {
        const passes = Math.min(4, Math.floor(this.washTimer / WASH_INTERVAL));
        this.washTimer -= passes * WASH_INTERVAL;

        const g = this.washGfx;
        g.clear();
        g.fillStyle(
          0xffffff,
          1 - Math.pow(1 - WASH_RATE * Rain.intensity, passes),
        );
        g.fillRect(0, 0, this.texW, this.texH);
        this.layer.erase(g);
        queued = true;
      }
    }

    if (!queued) return;
    this.layer.render();
    this.batch.clear();
    this.pending = 0;
  },
};
