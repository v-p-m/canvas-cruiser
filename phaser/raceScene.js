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

  // `data.trackFile` comes from MenuScene's START handoff — the same file
  // path TRACKS/PHASER_TRACKS carry in game.js and phaser/menuData.js. A
  // direct scene.start(this.scene) restart (headless, or a future "race
  // again") has no menu in front of it, so this falls back to Super Circuit
  // rather than throwing on a missing key.
  async create(data) {
    this.report = {};
    // `scene.restart()` ("race again") reuses this same Scene instance rather
    // than a fresh one, and create() awaits a fetch-and-bake below — so
    // without resetting this up front, `ready` is still true from the
    // instance's *previous* life for the whole async gap, and Phaser keeps
    // calling update() into a scene whose `this.world` exists but has no
    // `.data` yet.
    this.ready = false;

    // Idempotent — MenuScene already did this, but a headless check (or a
    // future direct restart) that starts this scene without going through
    // the menu still needs a HUD to draw onto.
    UI.init();
    UI.setInteractive(false); // the HUD has no buttons of its own until the flag
    // rain.js/night.js draw through the bare `ctx` name (see
    // phaser/worldCamera.js) — UI.ctx never changes reference once UI.init()
    // has run once, so this only needs setting, not re-setting, on a restart.
    ctx = UI.ctx;
    this.playerLastLapSeen = null;
    this.playerLapsSeen = 0;
    this.finishOrder = null;
    this.isNewBestTotal = false;

    // Falls back to Super Circuit for a direct scene.start("race")/restart
    // with no menu in front of it — a headless check, mainly.
    this.trackFile = (data && data.trackFile) || "tracks/super-circuit.json";
    this.trackId = (data && data.trackId) || PHASER_TRACKS[0].id;
    Records.load();
    Records.select(this.trackId, EngineClass.current().id);

    // Track.draw() is the only thing that wants a 2D context and the scene
    // never calls it, so the bake can run without one.
    this.world = new Track(null);
    await this.world.load(this.trackFile);

    // ai.js pushes its racing line clear of the kerbs by sampling the road
    // field, and it reads the track off this global (`clearRing`, `ringFor`).
    // The legacy page has the same one; the driver comes across untouched, so
    // the scene is what supplies it.
    window.worldTrack = this.world;
    Night.buildLights(); // the pylons stand on this circuit's verges

    // "Race again"/menu->race->menu->race all reuse this scene's key, and
    // the texture manager is global — a second addCanvas("bake", ...) under
    // a key that's still registered from this scene's previous life logs a
    // warning and keeps the *old* bake, which would be the wrong track the
    // moment "race again" or a return trip picks a different circuit.
    if (this.textures.exists("bake")) this.textures.remove("bake");
    this.textures.addCanvas("bake", this.world.bakedCanvas);
    this.add.image(0, 0, "bake").setOrigin(0, 0).setDepth(0);

    // World-space puddles, before cars — same ordering Rain.drawPuddles()
    // gives them in the legacy loop. They can't go through that function
    // here: the UI overlay canvas sits on top of *everything* Phaser draws,
    // so anything painted there would land over the cars instead of under
    // them. A Phaser Graphics object at a depth below the cars' own (2) gets
    // Phaser's camera scroll/zoom for free instead of the manual transform
    // Rain.drawPuddles() has to do for the legacy single-canvas loop.
    this.puddleGfx = this.add.graphics().setDepth(1);

    // Wet spray, kicked up behind a car at speed — a rooster tail the legacy
    // canvas loop has no equivalent for (Rain.drawDrops()/drawPuddles() are
    // screen- and world-space respectively, but neither is per-car). Below
    // the cars' own depth (2) so it reads as thrown up off the road, not
    // sprayed across the bodywork. One shared emitter, manually triggered
    // per car in updateSpray() rather than auto-emitting, since "behind the
    // car, scaled by its speed" isn't a shape any of the built-in emit zones
    // describe.
    this.sprayEmitter = this.add
      .particles(0, 0, this.sprayTexture(), {
        lifespan: 380,
        speed: { min: 30, max: 80 },
        scale: { start: 1, end: 0 },
        alpha: { start: 0.55, end: 0 },
        tint: 0xbcd9ea,
        gravityY: 70,
        quantity: 0,
        frequency: -1, // manual emitParticleAt() calls only
      })
      .setDepth(1.5);

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
    // A plain `window` listener outlives the scene unless removed by hand —
    // and this scene is now restarted ("race again") or re-started (from the
    // menu) rather than created exactly once per page load, so without the
    // shutdown cleanup below each return trip would stack another one.
    this.resizeHandler = () => {
      RenderScale.apply(this);
      // A resize is a step change in workload, not a slow frame — judging the
      // new backing store on samples taken at the old one is how dragging a
      // window bigger would drop the resolution permanently. Same call the
      // legacy loop's own resize listener makes (game.js:917).
      Quality.viewportChanged();
    };
    window.addEventListener("resize", this.resizeHandler);
    this.collisionHandler = (event) => this.onCollisionStart(event);
    this.matter.world.on("collisionstart", this.collisionHandler);
    this.events.once("shutdown", () => {
      window.removeEventListener("resize", this.resizeHandler);
      this.matter.world.off("collisionstart", this.collisionHandler);
      UI.clickHandlers = UI.clickHandlers.filter((h) => h !== this.resultsClickHandler);
    });

    // The real grid: pole first, the field staggered behind it, all of it
    // facing the start line. Index 0 is the player, exactly as SPAWN_POSITIONS
    // is ordered in game.js.
    this.grid = RaceGrid.build(this.world);
    this.cars = this.grid.map((slot, i) => this.spawnCar(slot, i));
    this.player = this.cars[0];
    // So onCollisionStart() can tell a car-to-car hit (worth a thud) from a
    // car meeting the map-bounds wall setBounds() above put up (not what
    // Sound.impact() was ever tuned against).
    this.carBodies = new Set(this.cars.map((c) => c.body));

    // The race, as the standings see it: six identical entries, the player's
    // marked only by a name and a flag. Built once — `RaceLaps.standings()`
    // re-sorts it every frame it is asked for.
    this.entries = this.cars.map((c, i) => ({
      entity: c.entity,
      isPlayer: i === 0,
      name: i === 0 ? "YOU" : `CPU ${i}`,
      color: this.grid[i].color,
    }));

    // MenuScene sets RaceLaps.target from the MODE row before handing off
    // here. The query string still overrides it — ?laps=0 runs free, as
    // "Free Drive" does — which is what a headless check that skips the menu
    // (a direct scene.start("race")) needs to pick a race length at all.
    const laps = new URLSearchParams(location.search).get("laps");
    if (laps !== null) RaceLaps.target = Number(laps) || null;
    RaceLaps.reset(this.entries);

    // Same "free"/"race5"/"race10" id PHASER_MODES carries, and the one
    // finishRace() already derives from RaceLaps.target for the total-time
    // record save — see game.js:1281's raceLapTarget() for the legacy twin.
    this.modeId =
      RaceLaps.target === 5 ? "race5" : RaceLaps.target === 10 ? "race10" : "free";

    // Clear rain and put the lights back up before rolling the next race's
    // conditions — a restart ("race again") must not carry the last race's
    // weather into this one. Ported from resetRace() (game.js:1202-1214).
    if (Rain.targetIntensity > 0) Rain.toggle();
    Night.clear();
    RaceConditions.scheduleWeather(this.modeId);
    RaceConditions.scheduleNight(this.modeId);

    // The field, as the drivers see each other: AICar.aimPoint steers away
    // from everyone in this list, and the player is deliberately not in it —
    // exactly as game.js passes `opponents`. Built once; it is read every
    // frame by every car.
    this.aiCars = this.cars.slice(1);
    this.opponents = this.aiCars.map((c) => c.entity);

    this.cameras.main.startFollow(this.player.sprite);

    if (new URLSearchParams(location.search).has("debug")) this.drawGridDebug();

    // P/N are the legacy loop's manual weather/night toggles (game.js:888-896)
    // — never active in its menu, but always live in a race, DEBUG or not,
    // since this page has no DEBUG editor mode to reclaim them for.
    this.keys = this.input.keyboard.addKeys("UP,DOWN,LEFT,RIGHT,R,ESC,P,N");

    // Registered up front rather than when the flag falls: UI.onClick only
    // ever sees clicks while UI.setInteractive(true), which finishRace()
    // below is what flips, so this sits idle and harmless until then.
    this.resultsClickHandler = (x, y) =>
      ResultsScreen.handleClick(this.resultsActions(), x, y);
    UI.onClick(this.resultsClickHandler);

    this.ready = true;
    this.reportGrid();
  }

  resultsActions() {
    return {
      again: () => this.scene.restart({ trackFile: this.trackFile, trackId: this.trackId }),
      menu: () => this.scene.start("menu"),
    };
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

  // A soft dot, baked once and reused by every car's spray — same "no PNGs,
  // bake a canvas" rule CarSprites follows, just small enough it doesn't need
  // CarSprites' whole livery-and-render-scale machinery. World-space particle
  // scale does the sizing, so this never needs to be re-baked for dpr.
  sprayTexture() {
    const key = "spray";
    if (this.textures.exists(key)) return key;
    const c = document.createElement("canvas");
    c.width = 6;
    c.height = 6;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(3, 3, 0, 3, 3, 3);
    grad.addColorStop(0, "rgba(255,255,255,0.9)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.arc(3, 3, 3, 0, Math.PI * 2);
    g.fill();
    this.textures.addCanvas(key, c);
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

  // Rain.drawPuddles(), redone against Phaser's own scene graph instead of a
  // manually camera-transformed 2D context — see this.puddleGfx's own comment
  // in create() for why. Redrawn every frame rather than built once: the
  // ripple ring animates (Rain.update() advances p.ripple), and the whole
  // layer fades in/out with Rain.intensity.
  drawPuddles() {
    const g = this.puddleGfx;
    g.clear();
    if (Rain.intensity <= 0) return;
    for (const p of Rain.puddles) {
      g.fillStyle(0x6aaccc, p.alpha * Rain.intensity);
      g.fillEllipse(p.x, p.y, p.rx * 2, p.ry * 2);

      const rScale = 0.5 + 0.5 * Math.abs(Math.sin(p.ripple));
      g.lineStyle(1, 0x96c8e6, 0.5 * Rain.intensity);
      g.strokeEllipse(p.x, p.y, p.rx * 2 * rScale, p.ry * 2 * rScale);
    }
  }

  // One car, one frame — a small cone of droplets thrown out behind each
  // rear tire, heavier the faster it's going and heavier still the instant
  // it's over a puddle (Rain.puddleGripAt() is the same call MatterCar.step()
  // just made for the grip itself, so the burst lines up with the physical
  // kick rather than being its own guess at when that happens).
  //
  // Two points, not one on the centreline: a single point at the centre read
  // as spraying out from under the middle of the car rather than off the
  // tires (confirmed against a real build, not just the sim — the alive
  // particle count was fine, it was *where* that was wrong). Placed with the
  // same rotation matterCar.js's wheelOffRoad() uses for its own corner
  // samples, at the same lateral inset (WHEEL_INSET_X) so it reads as the
  // same tires — but pushed past the rear bumper (half the car's own
  // length), not to the wheel's physics position, which sits inside the
  // sprite: this only has to look right, and a spray still under the
  // bodywork at depth 1.5 (below the car's own depth 2) is invisible.
  updateSpray(entity) {
    if (Rain.intensity <= 0) return;
    const speedFrac = Math.abs(entity.speed) / entity.maxSpeed;
    if (speedFrac < 0.3) return;

    // Phaser's particle angle is degrees from +x, clockwise; the game's own
    // `angle` is a compass bearing, 0 = north (matterCar.js's header) — so
    // "behind the car" is the heading rotated 180°, converted once here.
    const backDeg = (entity.angle * 180) / Math.PI + 90;
    this.sprayEmitter.setEmitterAngle({ min: backDeg - 20, max: backDeg + 20 });

    const hydro = Rain.puddleGripAt(entity) < 1;
    const total = Math.round(
      (hydro ? 3 : 1) * (0.5 + speedFrac) * Rain.intensity,
    );
    if (total <= 0) return;
    const perWheel = Math.max(1, Math.round(total / 2));

    const cos = Math.cos(entity.angle);
    const sin = Math.sin(entity.angle);
    const rear = entity.height * 0.6; // past the bumper (half-length = the edge) — see header
    const lateral = entity.width * WHEEL_INSET_X; // same tire columns wheelOffRoad samples
    for (const side of [-1, 1]) {
      const lx = side * lateral;
      const x = entity.x + lx * cos - rear * sin;
      const y = entity.y + lx * sin + rear * cos;
      this.sprayEmitter.emitParticleAt(x, y, perWheel);
    }
  }

  // Sound.impact() was tuned against resolveCollision()'s own push-based
  // overlap measure (game.js:1862) — Matter resolves contacts itself now (see
  // matterCar.js's header), and pair.collision.depth, the penetration Matter
  // measured at the moment it registered the contact, is the closest analog:
  // both are a "how hard did these overlap" distance in world px. Filtered to
  // car-vs-car — setBounds() above put a wall at the map edge, and grazing
  // that was never what this sound was for.
  onCollisionStart(event) {
    for (const pair of event.pairs) {
      if (!this.carBodies.has(pair.bodyA) || !this.carBodies.has(pair.bodyB))
        continue;
      Sound.impact(pair.collision.depth);
    }
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

    // Past the flag the player is a passenger — same rollOut coast-down the
    // legacy loop's finishHoldTimer window uses, just without the timer:
    // there's no roll-out draw to hold it open for yet (see resultsScreen.js's
    // header), so the results screen appears the instant `finished` does and
    // this only matters to whatever a headless check reads off the entity.
    const finished = this.player.entity.finished;
    const input = {
      accel: !finished && this.keys.UP.isDown,
      brake: !finished && this.keys.DOWN.isDown,
      left: !finished && this.keys.LEFT.isDown,
      right: !finished && this.keys.RIGHT.isDown,
      rollOut: finished,
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

    // Read fresh every frame, the same way CarSprites.draw() does in the
    // legacy loop — that's what makes the livery dim fade in with the rest of
    // night rather than snapping once at spawn.
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
      this.updateSpray(c.entity);
    }

    // The order is frozen the moment the player takes the flag, not when the
    // last car does — everyone still out there is classified where they stand.
    // This is also the one-time transition into the results screen: the
    // instant finishOrder exists is the instant the HUD stops drawing and the
    // overlay starts taking clicks for "race again"/"main menu".
    const p = this.player.entity;
    if (!this.finishOrder && p.finished) {
      this.finishOrder = RaceLaps.classify(this.world, this.entries);
      const modeId = RaceLaps.target === 5 ? "race5" : RaceLaps.target === 10 ? "race10" : null;
      if (modeId)
        this.isNewBestTotal = Records.saveTotalTime(
          this.trackId,
          EngineClass.current().id,
          modeId,
          p.finishTime,
        );
      UI.setInteractive(true);
    }

    // Computed once and shared: the HUD's position readout and the debug
    // report below are the same sort, and six cars is cheap but no reason to
    // pay for it twice a frame.
    const standings = RaceLaps.standings(this.world, this.entries);

    // The banner announces a *lap*, and RaceLaps.update() has no isPlayer
    // branch to hang that off (see phaser/raceLaps.js) — so this is the one
    // place that watches the player's own entity for lastLapTime changing,
    // which is exactly the crossing that just completed a lap. Excludes the
    // arming crossing: laps 0→1 leaves lastLapTime null. Every completed lap
    // is a record attempt regardless of game mode, same as saveLapTime()'s
    // unconditional call in the legacy loop's isPlayer branch — a Free Drive
    // lap counts too.
    if (p.lastLapTime !== null && p.lastLapTime !== this.playerLastLapSeen) {
      this.playerLastLapSeen = p.lastLapTime;
      const isBest = Records.saveLapTime(this.trackId, EngineClass.current().id, p.lastLapTime);
      HudBanner.show(p.lastLapTime, isBest);
    }
    HudBanner.update(deltaMs);

    // Weather is scheduled by lap the same way the legacy loop's isPlayer
    // branch of updateLapCounter drives it (game.js:1580, 1618) — every
    // player lap number the gate arms or completes is a chance for the
    // forecast to change. The crossing that takes the flag also increments
    // `laps` (to target+1), which the legacy branch never reaches because it
    // returns first — mirrored here by not calling past target.
    if (p.laps !== this.playerLapsSeen) {
      this.playerLapsSeen = p.laps;
      if (!(RaceLaps.target && p.laps > RaceLaps.target))
        RaceConditions.applyWeatherForLap(this.modeId, p.laps);
    }

    // camera.x/y (phaser/worldCamera.js) is what rain.js/night.js place
    // world-space things against — kept in step with the real camera every
    // frame, the same way camera.x/y just *is* the legacy loop's scroll.
    camera.x = this.cameras.main.scrollX;
    camera.y = this.cameras.main.scrollY;

    // hasStarted/gameMode (phaser/raceConditions.js) — Rain.drawHUD()'s own
    // pre-race forecast line reads these two bare globals directly, same as
    // it reads weatherWetFromLap/weatherWetToLap, which RaceConditions
    // already writes straight to. isMenu stays false: there is no menu state
    // to be in inside a race scene.
    hasStarted = p.laps > 0;
    gameMode = this.modeId;

    Quality.sample(deltaMs); // raw interval, not the clamped/frame-unit `delta` above
    Rain.update(delta);
    Night.update(delta);
    if (Phaser.Input.Keyboard.JustDown(this.keys.P)) Rain.toggle();
    if (Phaser.Input.Keyboard.JustDown(this.keys.N)) Night.toggle();

    const slip = Math.abs(
      p.velocityX * Math.cos(p.angle) + p.velocityY * Math.sin(p.angle),
    );
    Sound.update(p.speed, p.maxSpeed, input.accel, slip, !this.finishOrder);

    this.drawPuddles(); // Phaser's own scene graph — stays live through the results screen too

    if (this.finishOrder) {
      ResultsScreen.draw(this);
      // R/ESC only mean anything once the results screen is showing — there's
      // no in-race reset or pause on this page yet, so these keys are silent
      // until then rather than double as a shortcut mid-race.
      if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.resultsActions().again();
      if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) this.resultsActions().menu();
    } else {
      // UI.ctx is one persistent canvas, never cleared for us — HudScreen's
      // own draws only ever repaint their own widgets, so without this the
      // rain tint/night veil/drops below (all full-viewport, semi-transparent)
      // would layer onto last frame's instead of replacing it.
      UI.ctx.clearRect(0, 0, UI.width, UI.height);

      // Cars this frame, in draw order — Night lights every one the same way,
      // so this has to agree with the loop above that actually draws them or
      // a car ends up lit with no body (see litCars(), game.js:1786).
      const lit = Night.active ? this.cars.map((c) => c.entity) : [];
      Rain.drawOverlay(); // scene tint — a full-viewport fill
      Night.drawLightLayer(lit); // one half-res layer, blitted once — see night.js's header
      Rain.drawDrops(); // over the tint and the veil, so streaks read as caught in the light
      Rain.drawSplashes(); // where the drops just drawn are landing
      Night.drawLamps(lit); // pylon heads and tail lights, over the veil or it puts them out

      HudScreen.draw(this, standings, time);
      Rain.drawHUD();
      Night.drawHUD();
    }

    this.report.speed = p.speed.toFixed(2);
    this.report.pos = `${Math.round(p.x)},${Math.round(p.y)}`;
    this.report.offRoad = this.world.offRoad(p.x, p.y).toFixed(2);
    this.report.progress = RaceGrid.progress(this.world, p).toFixed(3);
    this.report.onStartLine = RaceGrid.onStartLine(this.world, p);
    this.report.passedGate = p.passedGate;
    this.report.laps = p.laps;
    this.report.rain = +Rain.intensity.toFixed(3);
    this.report.night = +Night.intensity.toFixed(3);
    this.report.puddles = Rain.puddles.length;
    this.report.lights = Night.lights.length;
    this.report.quality = Quality.status();
    this.report.standings = standings.map(
      (e) =>
        `${e.position}. ${e.name} L${e.laps} ${e.score === Infinity ? "FIN" : e.score.toFixed(3)}`,
    );
    if (this.finishOrder) {
      this.report.finishOrder = this.finishOrder;
      this.report.isNewBestTotal = this.isNewBestTotal;
    }
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
