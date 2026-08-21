// The garage screen as a Phaser scene, modeled on phaser/recordsScene.js:
// started from MenuScene, always hands back to "menu" — no pause/resume
// machinery yet, same reason RecordsScene doesn't reopen mid-race either.
class GarageScene extends Phaser.Scene {
  constructor() {
    super({ key: "garage" });
  }

  create() {
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
      back: () => this.scene.start("menu"),
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

    GarageScreen.draw();

    this.report.points = Garage.points();
    this.report.tiers = {
      engine: Garage.tier("engine"),
      tires: Garage.tier("tires"),
      steering: Garage.tier("steering"),
    };
  }
}
