// The garage screen as a Phaser scene, modeled on phaser/recordsScene.js:
// started from MenuScene or from the championship's between-rounds screen,
// and it hands back to whichever of the two sent it. There is still no
// pause/resume path out of a race — same reason RecordsScene doesn't reopen
// mid-race either — so `from` is a choice between two screens, not a return
// into a running one.
//
// The series case is the point of the door: points won in round 1 are meant
// to be spent before round 2, and dropping the player at the main menu
// halfway through a championship would make that a detour rather than a step.
class GarageScene extends Phaser.Scene {
  constructor() {
    super({ key: "garage" });
  }

  create(data) {
    // Anything other than the series (including a direct scene.start with no
    // data — a headless check) means the menu, so a stale or missing key
    // can't strand the player on a screen with no way back.
    this.from = data && data.from === "series" && Series.active ? "series" : "menu";
    Garage.load();

    UI.init();
    UI.setInteractive(true);

    this.clickHandler = (x, y) => GarageScreen.handleClick(this.actions(), x, y);
    UI.onClick(this.clickHandler);
    this.events.once("shutdown", () => {
      UI.clickHandlers = UI.clickHandlers.filter((h) => h !== this.clickHandler);
    });

    this.keys = this.input.keyboard.addKeys({
      esc: Phaser.Input.Keyboard.KeyCodes.ESC,
      g: Phaser.Input.Keyboard.KeyCodes.G,
      one: Phaser.Input.Keyboard.KeyCodes.ONE,
      two: Phaser.Input.Keyboard.KeyCodes.TWO,
      three: Phaser.Input.Keyboard.KeyCodes.THREE,
    });

    this.report = {};
    this.ready = true;
  }

  actions() {
    return {
      back: () => this.scene.start(this.from),
      buy: (part) => Garage.buy(part),
    };
  }

  update() {
    if (!this.ready) return;

    if (Phaser.Input.Keyboard.JustDown(this.keys.esc) || Phaser.Input.Keyboard.JustDown(this.keys.g))
      this.actions().back();
    // Keyboard equivalents of the buy buttons, same pattern as RecordsScreen's
    // "C" for clear — a click isn't the only way to reach a screen action.
    if (Phaser.Input.Keyboard.JustDown(this.keys.one)) this.actions().buy("engine");
    if (Phaser.Input.Keyboard.JustDown(this.keys.two)) this.actions().buy("tires");
    if (Phaser.Input.Keyboard.JustDown(this.keys.three)) this.actions().buy("steering");

    GarageScreen.draw({
      backLabel:
        this.from === "series"
          ? `ESC / G — Back to the championship`
          : "ESC / G — Back to menu",
    });

    this.report.from = this.from;
    this.report.points = Garage.points();
    this.report.tiers = {
      engine: Garage.tier("engine"),
      tires: Garage.tier("tires"),
      steering: Garage.tier("steering"),
    };
  }
}
