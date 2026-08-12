// The Phaser race scene.
//
// This runs on its own page (phaser.html) rather than replacing the canvas in
// index.html. The legacy loop in game.js keeps working untouched for the whole
// port, so the branch always has a playable game to compare against — which is
// the only way to tell a physics regression from a tuning change.
//
// The circuit is not re-authored for Phaser. `Track` bakes exactly as it does
// today and the baked canvas is handed over as a texture, so tracks/*.json,
// the road field and the artwork all stay the single source they already are.
// The starting grid, the start line and the lap gate come out of the same file
// through `RaceGrid` — see phaser/raceGrid.js.

// The car, at the size the game has always drawn it — CAR_SPRITE_W/H in
// carSprites.js and car.width/height in game.js are the same 34x56. Step 1's
// placeholder was smaller than that, which stopped mattering the moment six
// bodies started racing each other for the same piece of road.
const CAR_W = 34; // world px
const CAR_H = 56; // world px

class RaceScene extends Phaser.Scene {
  constructor() {
    super({ key: "race" });
  }

  async create() {
    this.report = {};

    // Track.draw() is the only thing that wants a 2D context and the scene
    // never calls it, so the bake can run without one.
    this.world = new Track(null);
    await this.world.load("tracks/super-circuit.json");

    // ai.js pushes its racing line clear of the kerbs by sampling the road
    // field, and it reads the track off this global (`clearRing`, `ringFor`).
    // The legacy page has the same one; the driver comes across untouched, so
    // the scene is what supplies it.
    window.worldTrack = this.world;

    this.textures.addCanvas("bake", this.world.bakedCanvas);
    this.add.image(0, 0, "bake").setOrigin(0, 0).setDepth(0);

    const w = this.world.bakedCanvas.width;
    const h = this.world.bakedCanvas.height;
    this.matter.world.setBounds(0, 0, w, h);
    this.cameras.main.setBounds(0, 0, w, h);

    // Car sprites registered as Phaser textures this render scale — tracked
    // so RenderScale.apply() can throw them out along with CarSprites' own
    // cache when the scale moves. Must exist before RenderScale.apply(),
    // which is why this comes before the spawns that call carTexture().
    this.carTextureKeys = new Set();
    RenderScale.apply(this);
    window.addEventListener("resize", () => RenderScale.apply(this));

    // The real grid: pole first, the field staggered behind it, all of it
    // facing the start line. Index 0 is the player, exactly as SPAWN_POSITIONS
    // is ordered in game.js.
    this.grid = RaceGrid.build(this.world);
    this.cars = this.grid.map((slot, i) => this.spawnCar(slot, i));
    this.player = this.cars[0];

    // The race, as the standings see it: six identical entries, the player's
    // marked only by a name and a flag. Built once — `RaceLaps.standings()`
    // re-sorts it every frame it is asked for.
    this.entries = this.cars.map((c, i) => ({
      entity: c.entity,
      isPlayer: i === 0,
      name: i === 0 ? "YOU" : `CPU ${i}`,
      color: this.grid[i].color,
    }));

    // No menu until step 5, so the page is a 5-lap race and the query string
    // is the mode picker: ?laps=0 runs free, as "Free Drive" does.
    const laps = new URLSearchParams(location.search).get("laps");
    if (laps !== null) RaceLaps.target = Number(laps) || null;
    RaceLaps.reset(this.entries);
    this.finishOrder = null;

    // The field, as the drivers see each other: AICar.aimPoint steers away
    // from everyone in this list, and the player is deliberately not in it —
    // exactly as game.js passes `opponents`. Built once; it is read every
    // frame by every car.
    this.aiCars = this.cars.slice(1);
    this.opponents = this.aiCars.map((c) => c.entity);

    this.cameras.main.startFollow(this.player.sprite);

    if (new URLSearchParams(location.search).has("debug")) this.drawGridDebug();

    this.keys = this.input.keyboard.addKeys("UP,DOWN,LEFT,RIGHT");
    this.ready = true;
    this.reportGrid();
  }

  // One car, on its grid slot. Index 0 is the player and the rest are AICars,
  // and that is the *only* difference between them: an AICar is a driver
  // wrapped round the same entity fields the player's object carries, so the
  // same applyCarStats fills its stats and the same MatterCar.step moves it.
  // Anything that ends up on one and not the other is the regression CLAUDE.md
  // is about — that is why there is one spawn function and not two.
  spawnCar(slot, index) {
    const entity =
      index === 0 ? {} : new AICar(null, slot.x, slot.y, slot.color);

    Object.assign(entity, {
      x: slot.x,
      y: slot.y,
      // AICar's constructor guesses north because it predates a grid; the
      // track file knows which way the road goes.
      angle: slot.angle,
      speed: 0,
      velocityX: 0,
      velocityY: 0,
      width: CAR_W,
      height: CAR_H,
      // Per-car machinery differences hang here and nowhere else. Empty for
      // every car on the grid: the field is separated by driving, not by
      // parts — see rollDriver() below.
      mods: null,
    });

    // Race state — laps, the gate latch, the finish. One list, filled by the
    // counter that reads it, so the player and an AICar cannot end up carrying
    // different fields.
    RaceLaps.initEntity(entity);

    applyCarStats(entity);

    // What makes an opponent slower than the player: skill, line offset and
    // aim wander, re-rolled per race. All three cost time through cornering
    // scrub and corner entry speed — none of them touches the car.
    if (entity.rollDriver) entity.rollDriver();

    const body = MatterCar.create(
      this,
      slot.x,
      slot.y,
      CAR_W,
      CAR_H,
      slot.angle,
    );

    // The car itself: a body Image plus its two front wheels, grouped in a
    // Container so position/rotation only has to be set once a frame, on the
    // container — a direct port of CarSprites.draw()'s ctx.translate/rotate
    // nesting, just handed to Phaser's scene graph instead of the 2D context.
    const dim = typeof Night === "undefined" ? 0 : Night.liveryDim();
    const sprite = this.add
      .container(slot.x, slot.y)
      .setRotation(slot.angle)
      .setDepth(2);

    const bodyImg = this.add
      .image(0, 0, this.carTexture(slot.color, dim))
      .setDisplaySize(entity.width, entity.height);

    const wheelKey = this.wheelTexture(dim);
    const sx = entity.width / CAR_SPRITE_W;
    const sy = entity.height / CAR_SPRITE_H;
    const wheelImgs = FRONT_WHEELS.map((b) =>
      this.add
        .image(
          (b.x + b.w / 2 - CAR_SPRITE_W / 2) * sx,
          (b.y + b.h / 2 - CAR_SPRITE_H / 2) * sy,
          wheelKey,
        )
        .setDisplaySize(b.w * sx, b.h * sy),
    );

    sprite.add([bodyImg, ...wheelImgs]);

    return { entity, body, sprite, bodyImg, wheelImgs, color: slot.color };
  }

  // CarSprites bakes a plain canvas; Phaser needs that canvas registered as a
  // texture before an Image can show it. Keyed the same way CarSprites caches
  // internally (colour + dim), so a re-bake only touches the keys that
  // actually changed and every other livery's texture is untouched. Tracked
  // in carTextureKeys so RenderScale.apply() knows what to throw out.
  carTexture(color, dim) {
    const key = `car:${color}@${dim}`;
    if (!this.textures.exists(key)) {
      this.textures.addCanvas(key, CarSprites.get(color, dim));
      this.carTextureKeys.add(key);
    }
    return key;
  }

  // One wheel texture serves every car, same as CarSprites.wheel() serves one
  // baked canvas for the legacy loop's ctx.drawImage calls.
  wheelTexture(dim) {
    const key = `wheel@${dim}`;
    if (!this.textures.exists(key)) {
      this.textures.addCanvas(key, CarSprites.wheel(dim));
      this.carTextureKeys.add(key);
    }
    return key;
  }

  // RenderScale calls this right after CarSprites.invalidate(): the baked
  // canvases behind these keys are gone, but the Phaser textures still point
  // at them by the same key string, so they have to go too — otherwise every
  // car keeps showing the old render scale's sprite forever.
  invalidateCarTextures() {
    for (const key of this.carTextureKeys) this.textures.remove(key);
    this.carTextureKeys.clear();
  }

  // The track-authoring skill's debug overlay, in Phaser terms: the waypoint
  // ring, the gate band and the start line. It is the fastest way to see that a
  // grid faces the line and that the gate landed somewhere sane, which is the
  // whole contract this step is porting.
  drawGridDebug() {
    const g = this.add.graphics().setDepth(4);
    const wps = this.world.data.waypoints;

    g.lineStyle(2, 0xffffff, 0.25);
    g.strokePoints(
      wps.map((p) => new Phaser.Math.Vector2(p.x, p.y)),
      true,
    );

    const arc = [];
    for (let k = 0; k <= 40; k++) {
      const f =
        RaceGrid.LAP_GATE_FROM +
        ((RaceGrid.LAP_GATE_TO - RaceGrid.LAP_GATE_FROM) * k) / 40;
      const q = RaceGrid.ringPoint(this.world, f);
      arc.push(new Phaser.Math.Vector2(q.x, q.y));
    }
    g.lineStyle(14, 0x00ff88, 0.55);
    g.strokePoints(arc, false);

    const ts = this.world.data.tileSize;
    this.world.data.map.forEach((row, ty) =>
      row.forEach((tile, tx) => {
        if (tile !== 9) return;
        g.lineStyle(2, 0xffe14a, 0.9);
        g.strokeRect(tx * ts, ty * ts, ts, ts);
      }),
    );

    // Grid slot numbers, so the order in the screenshot is readable rather
    // than inferred from six coloured rectangles.
    this.grid.forEach((slot, i) => {
      this.add
        .text(slot.x, slot.y - 26, i === 0 ? "P1" : `${i + 1}`, {
          fontFamily: "monospace",
          fontSize: "16px",
          color: "#ffffff",
        })
        .setOrigin(0.5)
        .setDepth(5);
    });
  }

  update(time, deltaMs) {
    if (!this.ready) return;

    // game.js counts delta in 60fps frames, and every constant in the handling
    // model is expressed per frame, so the port has to feed it the same unit.
    const delta = Math.min(deltaMs / (1000 / 60), 3);

    const input = {
      accel: this.keys.UP.isDown,
      brake: this.keys.DOWN.isDown,
      left: this.keys.LEFT.isDown,
      right: this.keys.RIGHT.isDown,
      rollOut: false,
    };

    // Six drivers, one car. The only difference between these two calls is
    // where the four booleans came from — the keyboard, or drive() reading the
    // track. Everything downstream of them is the same function, the same
    // stats and the same Matter world.
    const me = this.player;
    MatterCar.step(me.body, me.entity, input, delta, this.world);
    updateSteerVisual(me.entity, delta);

    const wps = this.world.data.waypoints;
    for (const c of this.aiCars) {
      const driving = c.entity.drive(wps, me.entity, this.opponents, delta);
      MatterCar.step(c.body, c.entity, driving, delta, this.world);
      updateSteerVisual(c.entity, delta);
    }

    // Night isn't ported yet (step 6), so this is always 0 for now — reading
    // it fresh every frame, the same way CarSprites.draw() does in the
    // legacy loop, is what makes the dim fold in for free once it is.
    const dim = typeof Night === "undefined" ? 0 : Night.liveryDim();
    const wheelKey = this.wheelTexture(dim);

    // Laps, for six cars, through one call — the gate included, since
    // RaceLaps.update() arms it. `time` is the loop's clock rather than
    // performance.now() so a hand-stepped headless run counts on the same
    // clock it integrates on.
    for (const c of this.cars) {
      c.sprite.setPosition(c.body.position.x, c.body.position.y);
      c.sprite.setRotation(c.entity.angle);
      c.bodyImg.setTexture(this.carTexture(c.color, dim));

      // Front wheels only — the rest of the car doesn't steer, exactly as
      // CarSprites.draw() only rotates the two wheel boxes it lifted out of
      // the body bake.
      const steer = (c.entity.steer || 0) * MAX_STEER_ANGLE;
      for (const w of c.wheelImgs) {
        w.setTexture(wheelKey);
        w.setRotation(steer);
      }

      RaceLaps.update(this.world, c.entity, time);
    }

    // The order is frozen the moment the player takes the flag, not when the
    // last car does — everyone still out there is classified where they stand.
    if (!this.finishOrder && this.player.entity.finished)
      this.finishOrder = RaceLaps.classify(this.world, this.entries);

    const p = this.player.entity;
    this.report.speed = p.speed.toFixed(2);
    this.report.pos = `${Math.round(p.x)},${Math.round(p.y)}`;
    this.report.offRoad = this.world.offRoad(p.x, p.y).toFixed(2);
    this.report.progress = RaceGrid.progress(this.world, p).toFixed(3);
    this.report.onStartLine = RaceGrid.onStartLine(this.world, p);
    this.report.passedGate = p.passedGate;
    this.report.laps = p.laps;
    this.report.standings = RaceLaps.standings(this.world, this.entries).map(
      (e) =>
        `${e.position}. ${e.name} L${e.laps} ${e.score === Infinity ? "FIN" : e.score.toFixed(3)}`,
    );
    if (this.finishOrder) this.report.finishOrder = this.finishOrder;
  }

  // Everything a headless check needs to see that the grid is the track's and
  // not a scan for tarmac: where each car is, which way it points, and whether
  // it is on the road.
  reportGrid() {
    this.report.grid = this.cars.map((c, i) => ({
      slot: i,
      color: this.grid[i].color,
      x: Math.round(c.entity.x),
      y: Math.round(c.entity.y),
      angleDeg: Math.round((c.entity.angle * 180) / Math.PI),
      road: +this.world.sampleRoad(c.entity.x, c.entity.y).toFixed(2),
      progress: +RaceGrid.progress(this.world, c.entity).toFixed(4),
      onStartLine: RaceGrid.onStartLine(this.world, c.entity),
    }));
  }
}
