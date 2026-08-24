// The championship standings as a Phaser scene, modeled on
// phaser/garageScene.js: started from the menu (START on the series mode) and
// from the results screen at the end of every round, and it is the only way
// into a series race — every round is launched from here.
//
// That single entry point is what makes the class lock and the lap count
// honest: applyClass() and RaceLaps.target are set on the way out of this
// scene, not scattered across the menu and the results screen. It is also the
// step where the garage belongs — points won in round 1 are meant to be
// spent before round 2, so the garage is a button here and comes back here
// (see GarageScene's `from`) instead of dropping the player at the main menu
// halfway through a title fight.
class SeriesScene extends Phaser.Scene {
  constructor() {
    super({ key: "series" });
  }

  create() {
    // Only read the store when there is nothing in hand. Every mutation saves
    // itself, so the two agree — except where localStorage is unavailable
    // (private mode), and there an unconditional load() would wipe the
    // championship that is currently being raced.
    if (!Series.active) Series.load();
    Garage.load(); // the footer shows the balance, and the garage may have just spent it

    UI.init();
    UI.setInteractive(true);

    this.clickHandler = (x, y) => SeriesScreen.handleClick(this.actions(), x, y);
    UI.onClick(this.clickHandler);
    this.events.once("shutdown", () => {
      UI.clickHandlers = UI.clickHandlers.filter((h) => h !== this.clickHandler);
    });

    this.keys = this.input.keyboard.addKeys({
      enter: Phaser.Input.Keyboard.KeyCodes.ENTER,
      esc: Phaser.Input.Keyboard.KeyCodes.ESC,
      g: Phaser.Input.Keyboard.KeyCodes.G,
    });

    this.report = {};
    this.ready = true;
  }

  actions() {
    return {
      start: () => this.startRound(),
      garage: () => this.scene.start("garage", { from: "series" }),
      menu: () => this.leave(),
    };
  }

  startRound() {
    const track = Series.currentTrack();
    if (!track) return this.leave(); // nothing left to race — the series is over
    Series.applyClass();
    RaceLaps.target = SERIES_LAPS;
    // `series: true` is what tells RaceScene this race scores — see its
    // create(), which deliberately won't infer that from Series.active alone.
    this.scene.start("race", { trackFile: track.file, trackId: track.id, series: true });
  }

  // ESC out of a series that still has rounds left keeps it: the menu will
  // offer to continue, and the rounds already banked are already saved. Once
  // the last round is in the book there is nothing to come back to, so the
  // championship is closed here rather than leaving the menu offering to
  // "continue" a finished one.
  leave() {
    if (Series.complete()) Series.clear();
    this.scene.start("menu");
  }

  update() {
    if (!this.ready) return;

    const done = Series.complete();
    if (Phaser.Input.Keyboard.JustDown(this.keys.enter)) {
      if (done) this.leave();
      else this.startRound();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keys.esc)) this.leave();
    if (!done && Phaser.Input.Keyboard.JustDown(this.keys.g)) this.actions().garage();

    UI.ctx.clearRect(0, 0, UI.width, UI.height);
    SeriesScreen.draw();

    this.report.round = Series.round;
    this.report.complete = done;
    this.report.calendar = Series.calendar.slice();
    this.report.classId = Series.classId;
    this.report.bonus = Series.bonus;
    this.report.standings = Series.standings().map(
      (r) => `${r.position}. ${r.name} ${r.points}pts [${r.rounds.map((p) => p || "-").join(" ")}]`,
    );
    this.report.garagePoints = Garage.points();
  }
}
