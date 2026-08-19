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

// What the opponents give away in a straight line. `mods` is a multiplier, not
// a subtraction, so this is a fraction of top speed rather than a number of
// world px — a fixed subtraction would take the same amount off a 60cc car
// that has three quarters of the 100cc ceiling to give away. It touches
// nothing but the straights: corner speed is R × turnSpeed, so the opponents
// still carry the same speed through the corners they always did, and what
// separates the field is still the driver (rollDriver() in ai.js).
const AI_TOP_SPEED = 0.98; // fraction of the player's top speed

// The flag does not cut straight to the results: the car brakes itself to a
// stop and the last lap's time gets its moment on the HUD first. Same 3s the
// legacy loop holds (FINISH_HOLD_MS, game.js).
const FINISH_HOLD_MS = 3000; // ms between taking the flag and the results

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
    this.pendingFinishOrder = null; // classified at the flag, shown after the hold
    this.finishHoldTimer = 0; // ms left of the roll-out
    this.isNewBestTotal = false;
    // Armed lazily on the first update() — see there for why begin() can't
    // just be called here.
    this.startLightsArmed = false;

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

    // Rubber on the road, under the puddles — see phaser/skidMarks.js. Built
    // here rather than lazily, because it is sized from the circuit that has
    // just been baked and a "race again" onto a different one must not inherit
    // the last track's layer.
    SkidMarks.init(this, this.world);

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
    // No cameras.main.setBounds(): the legacy loop's own camera
    // (game.js:2024-2025, `camera.x = car.x - camera.width / 2`) never clamps
    // to the map rectangle, so the car stays dead-centre right up to the
    // track's own edges. A Phaser bounds box the size of the baked canvas
    // clamps scrollX/Y at the map's edge instead — on any corner within half
    // a viewport of that rectangle (most of them, on a track that fills its
    // canvas) the camera stops tracking and the car drifts off-centre. Only
    // the physics wall above needs the map's real extent.

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
    // Captured now, not re-read as `this.matter.world` inside the shutdown
    // callback below: Phaser's own Matter plugin registers its teardown
    // earlier (at scene boot, before create() runs) than this handler does,
    // so by the time this one fires on the way out, `this.matter.world` has
    // already gone null and `.off` on it throws — killing the scene-switch
    // this exit was trying to make (any of ESC, "race again" or "main menu"
    // out of the results screen).
    const matterWorld = this.matter.world;
    matterWorld.on("collisionstart", this.collisionHandler);
    this.events.once("shutdown", () => {
      window.removeEventListener("resize", this.resizeHandler);
      matterWorld.off("collisionstart", this.collisionHandler);
      UI.clickHandlers = UI.clickHandlers.filter((h) => h !== this.resultsClickHandler);
    });

    // The real grid: pole first, the field staggered behind it, all of it
    // facing the start line. Index 0 is the player, exactly as SPAWN_POSITIONS
    // is ordered in game.js.
    this.grid = RaceGrid.build(this.world);
    this.cars = this.grid.map((slot, i) => this.spawnCar(slot, i));
    this.player = this.cars[0];
    // So onCollisionStart() can tell a car-to-car hit from a car meeting the
    // map-bounds wall setBounds() above put up, and get from the body Matter
    // reports back to the entity Impacts has to charge for the hit.
    this.carByBody = new Map(this.cars.map((c) => [c.body, c]));
    Impacts.init(this);
    Damage.init(this); // the debris emitter, and the break counter reset for a restart

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

    // `?debug=1`: the grid/gate/ring geometry once, here, and the live panel
    // every frame from update(). See phaser/debugOverlay.js for why it is a URL
    // flag and not a key.
    if (DebugOverlay.init()) this.drawGridDebug();

    // P/N are the legacy loop's manual weather/night toggles (game.js:888-896)
    // — never active in its menu, but always live in a race, DEBUG or not,
    // since this page has no DEBUG editor mode to reclaim them for.
    // The driving controls are not in here: they're remappable, so they go
    // through PlayerInput/KeyBindings rather than Phaser's KeyCodes enum (see
    // phaser/playerInput.js). What's left are the fixed, unbindable keys —
    // BLACKLISTED_KEYS in keyBindings.js is what keeps them unbindable.
    this.keys = this.input.keyboard.addKeys("R,ESC,P,N");
    PlayerInput.init().clear(); // a key still held from the menu isn't a throttle input

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
      // The collision aftermath, on every car for the same reason every other
      // field here is: MatterCar.step and Impacts must not be able to find a
      // different shape on the player than on an opponent.
      spin: 0, // rad/frame of yaw left over from a hit
      unsettle: 0, // 0..1 of the post-hit grip loss still to bleed off
      width: CAR_W,
      height: CAR_H,
      // Per-car machinery differences hang here and nowhere else. The field is
      // still separated by driving first — see rollDriver() below — but the
      // opponents now also run a lower top speed than the player's car. All
      // four keys are set because applyCarStats() reads every one of them
      // unguarded; a partial object is four NaN stats, not three defaults.
      //
      // The player gets a real object rather than the `null` that used to mean
      // "stock", because damage is fitted here too (phaser/damage.js) and a
      // null would make the player's car the one car in the race whose wings
      // could not break — the regression CLAUDE.md is about, arriving from the
      // other direction.
      mods: { speed: index === 0 ? 1 : AI_TOP_SPEED, accel: 1, turn: 1, grip: 1 },
    });

    // Wings on, and a snapshot of the car as built for them to come off. Before
    // applyCarStats() only because there is nothing broken yet to change what
    // it computes — but after `mods`, which is what it takes the snapshot of.
    Damage.reset(entity);

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
      .image(0, 0, this.carTexture(slot.color, dim, Damage.wingKey(entity)))
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
  // internally (colour + dim + wing state), so a re-bake only touches the keys
  // that actually changed and every other livery's texture is untouched.
  // Tracked in carTextureKeys so RenderScale.apply() knows what to throw out.
  carTexture(color, dim, broken = "") {
    const key = `car:${color}@${dim}@${broken}`;
    if (!this.textures.exists(key)) {
      this.textures.addCanvas(key, CarSprites.get(color, dim, broken));
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

  // What a hit costs — speed, yaw, grip — and what it looks and sounds like,
  // all in phaser/impacts.js. This scene only owns the body→car map it needs
  // to charge the right two entities.
  onCollisionStart(event) {
    Impacts.handle(this, event, this.carByBody);
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

    // Sampled first, before anything below this line points a car's Image at
    // a texture: this is the one call in this function that can, mid-frame,
    // synchronously destroy and re-add every car texture (Quality._stepDown()
    // -> _commit() -> resizeCanvas() -> RenderScale.apply() ->
    // CarSprites.invalidate()/invalidateCarTextures()). Sampling this late
    // used to sit *after* the per-car loop below, so on the frame quality
    // stepped down, that loop had already set bodyImg/wheelImgs to Frame
    // objects invalidateCarTextures() then destroyed — Phaser's Texture
    // destroy() nulls out frame.source but leaves the GameObject's cached
    // `.frame` pointing at it, and the render that follows before the *next*
    // update() call read `frame.source.resolution` on that null and crashed
    // ("r.source is null"). Sampling first means a step-down's re-add of
    // fresh textures happens before the per-car loop runs this same frame,
    // so nothing renders against a destroyed frame.
    Quality.sample(deltaMs); // raw interval, not the clamped/frame-unit `delta` below

    // game.js counts delta in 60fps frames, and every constant in the handling
    // model is expressed per frame, so the port has to feed it the same unit.
    const delta = Math.min(deltaMs / (1000 / 60), 3);

    // Armed on the first tick rather than in create(): begin() stamps
    // `_lastTick` with performance.now(), but everything else in this scene
    // (RaceLaps included) runs on Phaser's own loop `time`, a different clock
    // — see PORTING.md's laps note. Rebasing the tick onto `time` right after
    // begin() is what keeps the lead-in timing out correctly both live and
    // under a hand-stepped headless clock.
    if (!this.startLightsArmed) {
      this.startLightsArmed = true;
      StartLights.begin();
      StartLights._lastTick = time;
    }
    // No menu/pause overlay exists in this scene to fold into `held` — ESC
    // exits the scene outright rather than freezing in place (see below).
    StartLights.update(time, false);
    // Same isRacing gate the legacy loop holds the whole race sim behind
    // while the lights are still counting down (game.js:1928, 1936) — without
    // it every car is free to leave the grid before the lights go off.
    const blocking = StartLights.isBlocking();

    // Past the flag the player is a passenger — the keys do nothing and the
    // car brakes itself down through the finish hold below. The opponents are
    // deliberately left racing: they are still on their own lap, and the
    // table was already taken.
    const finished = this.player.entity.finished;
    const input = {
      accel: !blocking && !finished && PlayerInput.isDown("accelerate"),
      brake: !blocking && !finished && PlayerInput.isDown("brake"),
      left: !blocking && !finished && PlayerInput.isDown("left"),
      right: !blocking && !finished && PlayerInput.isDown("right"),
      rollOut: finished,
    };

    // Six drivers, one car. The only difference between these two calls is
    // where the four booleans came from — the keyboard, or drive() reading the
    // track. Everything downstream of them is the same function, the same
    // stats and the same Matter world.
    const me = this.player;
    if (!blocking) {
      MatterCar.step(me.body, me.entity, input, delta, this.world);
      updateSteerVisual(me.entity, delta);
      // Marks are laid here, not in the sprite loop below, because this is
      // where each car's four booleans exist: braking and wheelspin are things
      // the driver is *doing*, and the opponents' inputs are gone by the time
      // the frame gets to drawing them (see wheelLoad()).
      SkidMarks.trail(me.entity, input);

      const wps = this.world.data.waypoints;
      for (const c of this.aiCars) {
        const driving = c.entity.drive(wps, me.entity, this.opponents, delta);
        MatterCar.step(c.body, c.entity, driving, delta, this.world);
        updateSteerVisual(c.entity, delta);
        SkidMarks.trail(c.entity, driving);
      }
    }
    // Outside the `blocking` gate, and before the results branch: this is one
    // draw of the frame's quads, but it is also the rain's wash pass, and the
    // marks have to keep fading whether or not anything is still driving over
    // them.
    SkidMarks.draw(deltaMs);

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
      // Wing state joins the livery and the night dim in the texture key, so a
      // car that has just lost a wing shows it on the same frame the stats
      // changed — one lookup, and the bake only happens the first time any car
      // reaches that state.
      c.bodyImg.setTexture(
        this.carTexture(c.color, dim, Damage.wingKey(c.entity)),
      );
      Damage.update(c.entity, deltaMs);

      // Front wheels only — the rest of the car doesn't steer, exactly as
      // CarSprites.draw() only rotates the two wheel boxes it lifted out of
      // the body bake.
      const steer = (c.entity.steer || 0) * MAX_STEER_ANGLE;
      for (const w of c.wheelImgs) {
        w.setTexture(wheelKey);
        w.setRotation(steer);
      }

      if (!blocking) {
        RaceLaps.update(this.world, c.entity, time);
        this.updateSpray(c.entity);
      }
    }

    // The order is frozen the moment the player takes the flag, not when the
    // last car does — everyone still out there is classified where they stand,
    // and nothing in the table can drift while the roll-out plays out. An
    // opponent gaining a place after the player is done would read as the
    // results reordering themselves.
    const p = this.player.entity;
    if (!this.finishOrder && !this.pendingFinishOrder && p.finished) {
      this.pendingFinishOrder = RaceLaps.classify(this.world, this.entries);
      this.finishHoldTimer = FINISH_HOLD_MS;
      const modeId = RaceLaps.target === 5 ? "race5" : RaceLaps.target === 10 ? "race10" : null;
      if (modeId)
        this.isNewBestTotal = Records.saveTotalTime(
          this.trackId,
          EngineClass.current().id,
          modeId,
          p.finishTime,
        );
    }

    // The transition into the results screen, once the hold runs out: the
    // instant finishOrder exists is the instant the HUD stops drawing and the
    // overlay starts taking clicks for "race again"/"main menu" — so the
    // clicks are armed here, not at the flag, or the invisible buttons would
    // be live over the coast-down.
    if (this.pendingFinishOrder) {
      this.finishHoldTimer -= deltaMs;
      if (this.finishHoldTimer <= 0) {
        this.finishHoldTimer = 0;
        this.finishOrder = this.pendingFinishOrder;
        this.pendingFinishOrder = null;
        UI.setInteractive(true);
      }
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
    // world-space things against: the world coordinate at the top-left of the
    // viewport. That is `worldView`, *not* `scrollX/Y` — Phaser zooms about
    // the camera's midpoint, so with RenderScale's setZoom(renderDpr) the two
    // differ by (cam.width/2)(1 - 1/zoom), a third of a screen on a retina
    // display, and every floodlight and headlight beam lands that far off.
    //
    // preRender() first, because a follow camera only resolves its scroll to
    // this frame's sprite positions when Phaser renders — after update(), which
    // is where the overlay is drawn. Read cold, worldView is still last frame's,
    // so everything on the overlay trails the car by one frame of camera travel
    // (~5 world px at speed): the tail lights slid off the back under throttle
    // and off the front in reverse. startFollow() here takes no lerp, so the
    // scroll is a snap to the target and Phaser's own call at render lands on
    // the same numbers — this one is idempotent, not a second step.
    this.cameras.main.preRender();
    camera.x = this.cameras.main.worldView.x;
    camera.y = this.cameras.main.worldView.y;

    // hasStarted/gameMode (phaser/raceConditions.js) — Rain.drawHUD()'s own
    // pre-race forecast line reads these two bare globals directly, same as
    // it reads weatherWetFromLap/weatherWetToLap, which RaceConditions
    // already writes straight to. isMenu stays false: there is no menu state
    // to be in inside a race scene.
    hasStarted = p.laps > 0;
    gameMode = this.modeId;

    Rain.update(delta);
    Night.update(delta);
    if (Phaser.Input.Keyboard.JustDown(this.keys.P)) Rain.toggle();
    if (Phaser.Input.Keyboard.JustDown(this.keys.N)) Night.toggle();

    const slip = Math.abs(
      p.velocityX * Math.cos(p.angle) + p.velocityY * Math.sin(p.angle),
    );
    Sound.update(p.speed, p.maxSpeed, input.accel, slip, !blocking && !this.finishOrder);

    this.drawPuddles(); // Phaser's own scene graph — stays live through the results screen too

    if (this.finishOrder) {
      ResultsScreen.draw(this);
      // R only means anything once the results screen is showing — there's no
      // in-race reset on this page yet, so it's silent until then rather than
      // double as a shortcut mid-race. ESC exits from either state (below).
      if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.resultsActions().again();
      if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) this.resultsActions().menu();
    } else {
      // Mid-race ESC — no pause/resume machinery yet (see resultsScreen.js's
      // header), so this is a straight exit rather than the legacy loop's
      // freeze-and-resume; same "menu" action the results screen's ESC uses.
      if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) {
        this.resultsActions().menu();
        return;
      }

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
      // Same order the legacy loop draws in (game.js:2138-2150): over the
      // HUD's own black bar, under nothing race-specific.
      StartLights.draw(UI.ctx, UI.width, UI.height);
      Rain.drawHUD();
      Night.drawHUD();
      DebugOverlay.draw(this, standings); // over everything, or the veil dims it
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
    this.report.wingBreaks = Damage.breaks;
    this.report.wings = this.cars.map((c) => Damage.wingKey(c.entity));
    this.report.wingHp = this.cars.map(
      (c) => `${c.entity.wings.front.toFixed(2)}/${c.entity.wings.rear.toFixed(2)}`,
    );
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
