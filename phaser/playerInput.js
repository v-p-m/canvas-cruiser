// The player's four controls, read exactly the way game.js reads them
// (game.js:903-910, 1944-1947): a map of raw DOM `e.key` values looked up
// through KeyBindings.bindings.
//
// Phaser's own addKeys() can't do this job. It keys off Phaser's KeyCodes
// enum, while a binding is whatever `e.key` the player happened to press on
// the rebind screen — "w", "ArrowUp", ";", "Shift" — and there is no total
// mapping from one to the other. Hardcoding UP/DOWN/LEFT/RIGHT, which is what
// this replaces, made the rebind screen a lie on this page.
//
// Phaser's keyboard plugin calls preventDefault() on the keys it captures, but
// it doesn't stopPropagation(), so a window listener still sees every press.
const PlayerInput = {
  down: {},

  // Idempotent: every scene that wants controls calls this in create(), and
  // the listeners belong to the page, not to whichever scene got there first.
  init() {
    if (this._wired) return this;
    this._wired = true;
    window.addEventListener("keydown", (e) => (this.down[e.key] = true));
    window.addEventListener("keyup", (e) => (this.down[e.key] = false));
    // A key held while the tab loses focus never delivers its keyup, and the
    // car would drive itself into the scenery until the player came back and
    // tapped it again.
    window.addEventListener("blur", () => this.clear());
    return this;
  },

  isDown(action) {
    return !!this.down[KeyBindings.bindings[action]];
  },

  // Called on entering a race as well as on blur: ESC out of a race with the
  // throttle down and the next one would start with it still held.
  clear() {
    for (const k in this.down) this.down[k] = false;
  },
};
