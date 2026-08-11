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

const CAR_W = 18; // world px
const CAR_H = 32; // world px

// The 100cc baseline, matching DebugConfig.defaults. In the legacy loop this
// is applyCarStats()'s job and every car on the grid gets the same set — the
// port keeps that, one object copied per car, until the debug panel and the
// engine classes come across.
const CAR_STATS = {
  acceleration: 0.2,
  maxSpeed: 10,
  turnSpeed: 0.06,
  driftGrip: 0.1,
  friction: 0.96,
};

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
    this.cars = this.grid.map((slot) => this.spawnCar(slot));
    this.player = this.cars[0];

    this.cameras.main.startFollow(this.player.sprite);

    if (new URLSearchParams(location.search).has("debug")) this.drawGridDebug();

    this.keys = this.input.keyboard.addKeys("UP,DOWN,LEFT,RIGHT");
    this.ready = true;
    this.reportGrid();
  }

  // One car, on its grid slot. The opponents are built the same way as the
  // player and carry the same stats — running them through MatterCar.step is
  // the next step of the port, and nothing here should have to change for it.
  spawnCar(slot) {
    const entity = {
      x: slot.x,
      y: slot.y,
      angle: slot.angle,
      speed: 0,
      velocityX: 0,
      velocityY: 0,
      // Race state, the same shape the legacy entities carry so the lap
      // counter can treat every car as one more entry.
      laps: 0,
      onFinishLine: false,
      passedGate: false,
      finished: false,
      finishPosition: 0,
      raceStart: 0,
      ...CAR_STATS,
    };

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

    // Only the player is driven for now — the opponents come through this same
    // call in the next step, which is also when they start getting drag.
    const me = this.player;
    MatterCar.step(me.body, me.entity, input, delta, this.world);

    for (const c of this.cars) {
      // Parked cars still track their body: a shunt on the grid moves them.
      c.entity.x = c.body.position.x;
      c.entity.y = c.body.position.y;
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
