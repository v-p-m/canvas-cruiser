// The start menu, as a Phaser scene. Owns the picker state (screens.js's
// menuRow/selectedTrack/selectedMode/trackLoading, all module-level globals
// in the legacy loop — game.js:31-90) and drives MenuScreen against the UI
// overlay canvas. START stops this one and starts RaceScene with the chosen
// track+class, exactly the handoff startSelectedMode() makes in game.js; Q
// and I hand off to RecordsScene and the credits modal respectively.
//
// The track behind the dim overlay is a real bake of the selected circuit —
// same Track class, same tracks/*.json — but static: no spawn grid, no cars,
// no Matter world. It exists so cycling TRACK shows the circuit you're
// choosing, the way the legacy menu sits over its own (paused) race; wiring
// an actual idle grid in behind the menu is more machinery than a backdrop
// needs.
class MenuScene extends Phaser.Scene {
  constructor() {
    super({ key: "menu" });
  }

  async create() {
    // Phaser reuses this same Scene instance every time something starts
    // "menu" again — RecordsScene's back button, ResultsScreen's "main
    // menu" — and create() below awaits a track bake and a credits.json
    // fetch, so without this, `ready` sits stale-true from the instance's
    // previous life for the whole gap and update() runs against a `this.keys`
    // that hasn't been (re)built yet. Same hazard, same fix, as RaceScene.
    this.ready = false;

    EngineClass.load(); // the class survives a reload; the menu should open on it

    // Silences the engine/tire voices a race in progress may have left
    // playing — RaceScene calls Sound.update() every frame it's live, this
    // scene never does, so without one call here to schedule the fade
    // (setTargetAtTime keeps approaching 0 on its own after) "ESC — Main
    // menu" from the results screen would leave the last lap's engine note
    // holding forever.
    Sound.update(0, 1, false, 0, false);

    this.state = {
      row: 2, // opens on MODE, same as game.js's menuRow default
      selectedTrack: this.loadSavedTrack(),
      selectedMode: 1, // "5 Lap Race"
      trackLoading: false,
      credits: false, // a modal over this screen, not a screen of its own
      keybinds: false, // ditto — the legacy loop's isKeyBindings, an overlay
    };
    this.loadedTrack = -1;

    UI.init(); // one overlay canvas for the page's whole life
    UI.setInteractive(true);

    this.bg = this.add.image(0, 0, "__DEFAULT").setDepth(0).setAlpha(0.9);
    this.preview = new Track(null);
    await this.applySelectedTrack();
    await loadCredits(); // never throws; keeps the built-in fallback on failure
    CreditsScreen.reset();

    this.keys = this.input.keyboard.addKeys("UP,DOWN,LEFT,RIGHT,ENTER,Q,I,K,ESC");
    PlayerInput.init(); // so the rebind screen's own keys can't stick down

    // The rebind screen has to see the raw `e.key` of whatever was pressed —
    // that string *is* the binding — which Phaser's KeyCodes enum can't give
    // us, so this one screen listens to the DOM directly. It runs on keydown,
    // ahead of update(), and swallows the press by clearing the Phaser key
    // states it would otherwise reach; see keydownHandler.
    this.keydownHandler = (e) => this.handleRebindKey(e);
    window.addEventListener("keydown", this.keydownHandler);

    this.clickHandler = (x, y) => this.handleClick(x, y);
    UI.onClick(this.clickHandler);
    this.wheelHandler = (e) => {
      if (this.state.credits) {
        CreditsScreen.scrollBy(e.deltaY);
        e.preventDefault();
      }
    };
    UI.canvas.addEventListener("wheel", this.wheelHandler, { passive: false });

    // this.scale is the game's global ScaleManager, not scene-local — a
    // listener attached to it outlives this scene unless removed by hand, and
    // MenuScene is re-created every time RecordsScene/ResultsScreen hand back
    // to "menu", so without the shutdown cleanup below each return trip would
    // stack another one.
    this.resizeHandler = () => this.fitBackground();
    this.scale.on("resize", this.resizeHandler);
    this.events.once("shutdown", () => {
      this.scale.off("resize", this.resizeHandler);
      window.removeEventListener("keydown", this.keydownHandler);
      UI.canvas.removeEventListener("wheel", this.wheelHandler);
      UI.clickHandlers = UI.clickHandlers.filter((h) => h !== this.clickHandler);
    });

    this.report = { menu: true };
    this.ready = true;
  }

  loadSavedTrack() {
    try {
      const saved = localStorage.getItem("track");
      const i = PHASER_TRACKS.findIndex((t) => t.id === saved);
      return i >= 0 ? i : 0;
    } catch {
      return 0; // private-mode localStorage — the default track is fine
    }
  }

  menuActions() {
    return {
      cycleTrack: (dir) => this.cycleTrack(dir),
      cycleClass: (dir) => this.cycleClass(dir),
      start: () => this.startRace(),
      openRecords: () => this.openRecords(),
      openCredits: () => this.openCredits(),
      openKeyBindings: () => this.openKeyBindings(),
    };
  }

  cycleTrack(dir) {
    if (PHASER_TRACKS.length < 2) return;
    this.state.selectedTrack =
      (this.state.selectedTrack + dir + PHASER_TRACKS.length) % PHASER_TRACKS.length;
    try {
      localStorage.setItem("track", PHASER_TRACKS[this.state.selectedTrack].id);
    } catch {
      /* private mode — the choice just won't outlive the tab */
    }
    this.applySelectedTrack();
  }

  cycleClass(dir) {
    if (ENGINE_CLASSES.length < 2) return;
    EngineClass.cycle(dir);
  }

  // Ported from applySelectedTrack() in game.js: a fetch-and-bake can be
  // asked to change again before it finishes, so this keeps loading until
  // what's baked matches what's selected rather than racing two loads into
  // one Track object. Last press wins.
  async applySelectedTrack() {
    if (this.state.trackLoading) return;
    this.state.trackLoading = true;
    try {
      while (this.loadedTrack !== this.state.selectedTrack) {
        const want = this.state.selectedTrack;
        await this.preview.load(PHASER_TRACKS[want].file);
        this.loadedTrack = want;
        this.applyPreviewBake();
      }
    } catch (err) {
      console.error("Failed to load track:", err);
      this.state.selectedTrack = this.loadedTrack < 0 ? 0 : this.loadedTrack;
    } finally {
      this.state.trackLoading = false;
    }
  }

  applyPreviewBake() {
    if (this.textures.exists("menuBake")) this.textures.remove("menuBake");
    this.textures.addCanvas("menuBake", this.preview.bakedCanvas);
    this.bg.setTexture("menuBake");
    this.fitBackground();
  }

  // Cover-fit: scaled to fill the viewport without distorting the track's
  // aspect ratio, centered. Purely decorative, so exactness doesn't matter —
  // legibility of the dimmed backdrop does.
  fitBackground() {
    const tex = this.textures.get("menuBake");
    if (!tex || tex.key === "__MISSING") return;
    const src = tex.getSourceImage();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const scale = Math.max(w / src.width, h / src.height);
    this.bg.setPosition(w / 2, h / 2);
    this.bg.setDisplaySize(src.width * scale, src.height * scale);
  }

  startRace() {
    if (this.state.trackLoading || this.state.credits) return; // baking, or credits has input
    RaceLaps.target = PHASER_MODES[this.state.selectedMode].laps;
    this.scene.start("race", {
      trackFile: PHASER_TRACKS[this.state.selectedTrack].file,
      trackId: PHASER_TRACKS[this.state.selectedTrack].id,
    });
  }

  openRecords() {
    if (this.state.credits) return;
    this.scene.start("records", { trackId: PHASER_TRACKS[this.state.selectedTrack].id });
  }

  openCredits() {
    this.state.credits = true;
    CreditsScreen.reset();
  }

  closeCredits() {
    this.state.credits = false;
  }

  openKeyBindings() {
    if (this.state.credits) return;
    this.state.keybinds = true;
    KeyBindings.listening = null;
    KeyBindings.lastRejected = null;
    // The K that opened this is still "just down" as far as Phaser is
    // concerned, and nothing reads its keys while the screen is up — so
    // without a reset here and on the way out, every press made *inside* the
    // screen would fire its menu meaning in the first frame after closing.
    this.input.keyboard.resetKeys();
  }

  closeKeyBindings() {
    this.state.keybinds = false;
    KeyBindings.listening = null;
    this.input.keyboard.resetKeys();
  }

  // The DOM-level half of the rebind screen — ported from game.js:818-838. It
  // only ever runs while the screen is open; handleRebind() is what consumes a
  // press as the new binding, and everything below it is the screen's own
  // fixed keys.
  handleRebindKey(e) {
    if (!this.ready || !this.state.keybinds) return;

    if (KeyBindings.handleRebind(e.key)) return; // consumed as a binding
    const key = e.key.toLowerCase();
    if (key === "escape") this.closeKeyBindings();
    else if (key === "r") KeyBindings.reset();
    else if (key === "enter") {
      // ENTER walks the rows, so the screen is usable without a mouse
      const actions = ["accelerate", "brake", "left", "right"];
      const cur = actions.indexOf(KeyBindings.listening);
      KeyBindings.startListening(actions[(cur + 1) % actions.length]);
    }
  }

  // Whichever overlay is on top owns clicks — everything under it (the
  // click-away dismissal included) goes through that screen, not the menu rows.
  handleClick(x, y) {
    if (this.state.keybinds) {
      if (KeyBindings.handleClick(x, y) === "back") this.closeKeyBindings();
    } else if (this.state.credits) {
      CreditsScreen.handleClick(() => this.closeCredits(), x, y);
    } else {
      MenuScreen.handleClick(this.state, this.menuActions(), x, y);
    }
  }

  update() {
    if (!this.ready) return;

    if (this.state.keybinds) {
      // Keys here are the window listener's (handleRebindKey) — a rebind takes
      // whatever `e.key` arrives, which is not something addKeys can express.
    } else if (this.state.credits) {
      if (Phaser.Input.Keyboard.JustDown(this.keys.ESC)) this.closeCredits();
      if (Phaser.Input.Keyboard.JustDown(this.keys.DOWN)) CreditsScreen.scrollBy(40);
      if (Phaser.Input.Keyboard.JustDown(this.keys.UP)) CreditsScreen.scrollBy(-40);
    } else {
      if (Phaser.Input.Keyboard.JustDown(this.keys.UP)) MenuScreen.moveCursor(this.state, -1);
      if (Phaser.Input.Keyboard.JustDown(this.keys.DOWN)) MenuScreen.moveCursor(this.state, 1);
      if (Phaser.Input.Keyboard.JustDown(this.keys.LEFT))
        MenuScreen.changeRow(this.state, -1, this.menuActions());
      if (Phaser.Input.Keyboard.JustDown(this.keys.RIGHT))
        MenuScreen.changeRow(this.state, 1, this.menuActions());
      if (Phaser.Input.Keyboard.JustDown(this.keys.ENTER)) this.startRace();
      if (Phaser.Input.Keyboard.JustDown(this.keys.Q)) this.openRecords();
      if (Phaser.Input.Keyboard.JustDown(this.keys.I)) this.openCredits();
      if (Phaser.Input.Keyboard.JustDown(this.keys.K)) this.openKeyBindings();
    }

    MenuScreen.draw(this.state);
    if (this.state.credits) CreditsScreen.draw();
    // Over the menu it was opened from, drawn last so its hover cursor wins.
    // It takes the viewport in CSS pixels; in the legacy loop that's `camera`,
    // but worldCamera.js's stand-in is only kept current inside a race, so
    // this hands it UI's own size.
    if (this.state.keybinds) {
      KeyBindings.draw(UI.ctx, { width: UI.width, height: UI.height }, mousePos);
    }

    this.report.row = this.state.row;
    this.report.track = PHASER_TRACKS[this.state.selectedTrack].id;
    this.report.class = EngineClass.current().id;
    this.report.mode = PHASER_MODES[this.state.selectedMode].id;
    this.report.trackLoading = this.state.trackLoading;
    this.report.credits = this.state.credits;
    this.report.keybinds = this.state.keybinds;
    this.report.bindings = { ...KeyBindings.bindings };
    this.report.listening = KeyBindings.listening;
    this.report.hitAreas = MenuScreen.hitAreas.length;
  }
}
