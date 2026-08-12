// The records screen as a Phaser scene. Started from MenuScene with the
// track+class to show; always hands back to "menu" — see RecordsScreen's
// header for why there's no "back to race" path yet.
class RecordsScene extends Phaser.Scene {
  constructor() {
    super({ key: "records" });
  }

  create(data) {
    this.trackId = (data && data.trackId) || PHASER_TRACKS[0].id;
    this.trackLabel =
      (PHASER_TRACKS.find((t) => t.id === this.trackId) || PHASER_TRACKS[0]).label;

    Records.load();
    Records.select(this.trackId, EngineClass.current().id);

    UI.init();
    UI.setInteractive(true);

    this.clickHandler = (x, y) => RecordsScreen.handleClick(this.actions(), x, y);
    UI.onClick(this.clickHandler);
    this.events.once("shutdown", () => {
      UI.clickHandlers = UI.clickHandlers.filter((h) => h !== this.clickHandler);
    });

    this.keys = this.input.keyboard.addKeys({
      esc: Phaser.Input.Keyboard.KeyCodes.ESC,
      q: Phaser.Input.Keyboard.KeyCodes.Q,
      c: Phaser.Input.Keyboard.KeyCodes.C,
    });

    this.report = {};
    this.ready = true;
  }

  actions() {
    return {
      back: () => this.scene.start("menu"),
      clear: () => {
        if (confirm("Clear all records, on every track and in every class?")) {
          Records.clear();
          Records.select(this.trackId, EngineClass.current().id);
        }
      },
    };
  }

  update() {
    if (!this.ready) return;

    if (Phaser.Input.Keyboard.JustDown(this.keys.esc) || Phaser.Input.Keyboard.JustDown(this.keys.q))
      this.actions().back();
    if (Phaser.Input.Keyboard.JustDown(this.keys.c)) this.actions().clear();

    RecordsScreen.draw({
      trackLabel: this.trackLabel,
      classLabel: EngineClass.current().label,
    });

    this.report.track = this.trackId;
    this.report.class = EngineClass.current().id;
    this.report.highScores = Records.highScores.slice();
    this.report.bestTotalTimes = JSON.parse(JSON.stringify(Records.bestTotalTimes));
  }
}
