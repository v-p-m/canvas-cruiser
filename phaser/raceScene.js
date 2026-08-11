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

    // The real grid: pole first, the field staggered behind it, all of it
    // facing the start line. Index 0 is the player, exactly as SPAWN_POSITIONS
    // is ordered in game.js.
    this.grid = RaceGrid.build(this.world);
    this.cars = this.grid.map((slot, i) => this.spawnCar(slot, i));
    this.player = this.cars[0];

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
      // Race state, the same shape the legacy entities carry so the lap
      // counter can treat every car as one more entry.
      laps: 0,
      onFinishLine: false,
      passedGate: false,
      finished: false,
      finishPosition: 0,
      raceStart: 0,
    });

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
    const sprite = this.add.rectangle(
      slot.x,
      slot.y,
      CAR_W,
      CAR_H,
      parseInt(slot.color.slice(1), 16),
    );
    sprite.setRotation(slot.angle);
    sprite.setDepth(2);

    return { entity, body, sprite };
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

    const wps = this.world.data.waypoints;
    for (const c of this.aiCars) {
      const driving = c.entity.drive(wps, me.entity, this.opponents, delta);
      MatterCar.step(c.body, c.entity, driving, delta, this.world);
    }

    for (const c of this.cars) {
      c.sprite.setPosition(c.body.position.x, c.body.position.y);
      c.sprite.setRotation(c.entity.angle);
      RaceGrid.updateGate(this.world, c.entity);
    }

    const p = this.player.entity;
    this.report.speed = p.speed.toFixed(2);
    this.report.pos = `${Math.round(p.x)},${Math.round(p.y)}`;
    this.report.offRoad = this.world.offRoad(p.x, p.y).toFixed(2);
    this.report.progress = RaceGrid.progress(this.world, p).toFixed(3);
    this.report.onStartLine = RaceGrid.onStartLine(this.world, p);
    this.report.passedGate = p.passedGate;
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
