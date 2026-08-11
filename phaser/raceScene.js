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

const CAR_W = 18; // world px
const CAR_H = 32; // world px
const OPPONENT_COLORS = ["#e04a4a", "#4ae04a", "#4a7ae0"];

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

    // Drop the car on a bit of road rather than guessing the grid — the grid
    // contract lives in the track-authoring skill and porting it is its own
    // step.
    const spawn = this.findRoad(w, h);

    this.entity = {
      x: spawn.x,
      y: spawn.y,
      angle: 0,
      speed: 0,
      velocityX: 0,
      velocityY: 0,
      acceleration: 0.2,
      maxSpeed: 10,
      turnSpeed: 0.06,
      driftGrip: 0.1,
      friction: 0.96,
    };
    this.body = MatterCar.create(this, spawn.x, spawn.y, CAR_W, CAR_H);

    this.sprite = this.add.rectangle(spawn.x, spawn.y, CAR_W, CAR_H, 0xffe14a);
    this.sprite.setDepth(2);
    this.cameras.main.startFollow(this.sprite);

    // Three parked cars a little way ahead: the cheapest proof that Matter is
    // actually resolving car-to-car contact, which is the thing the old
    // `resolveCollision` did by hand.
    this.parked = OPPONENT_COLORS.map((c, i) => {
      const px = spawn.x + (i - 1) * (CAR_W + 6);
      const py = spawn.y - 120;
      const b = MatterCar.create(this, px, py, CAR_W, CAR_H);
      const r = this.add.rectangle(px, py, CAR_W, CAR_H, parseInt(c.slice(1), 16));
      r.setDepth(2);
      return { body: b, rect: r };
    });

    this.keys = this.input.keyboard.addKeys("UP,DOWN,LEFT,RIGHT");
    this.ready = true;
    this.report.spawn = `${Math.round(spawn.x)},${Math.round(spawn.y)}`;
    this.report.contours = this.world.traceRoadContours().length;
  }

  // Walk the field for a cell that is solidly tarmac. The field is coarse
  // enough that a linear scan is instant and it needs doing once.
  findRoad(w, h) {
    for (let y = h * 0.5; y < h; y += 8)
      for (let x = 0; x < w; x += 8)
        if (this.world.sampleRoad(x, y) > 0.95) return { x, y };
    return { x: w / 2, y: h / 2 };
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

    MatterCar.step(this.body, this.entity, input, delta, this.world);

    this.sprite.setPosition(this.body.position.x, this.body.position.y);
    this.sprite.setRotation(this.entity.angle);
    for (const p of this.parked) {
      p.rect.setPosition(p.body.position.x, p.body.position.y);
      p.rect.setRotation(p.body.angle);
    }

    this.report.speed = this.entity.speed.toFixed(2);
    this.report.pos = `${Math.round(this.entity.x)},${Math.round(this.entity.y)}`;
    this.report.offRoad = this.world.offRoad(this.entity.x, this.entity.y).toFixed(2);
  }
}
