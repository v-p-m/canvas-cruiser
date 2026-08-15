// A second <canvas>, layered over Phaser's own, for every pixel of UI: menu,
// HUD, minimap, records, results, credits. See PORTING.md step 5 for the
// trade-off — screens.js is ~1000 lines of exact ctx drawing (roundRect
// fills, a clipped-and-faded scroll region, measureText-driven hit boxes)
// that already matches the shipped game pixel for pixel, and Phaser's
// GameObject API has no equivalent for most of it. Porting screens.js onto a
// plain 2D canvas keeps that code (and the hitTest/mousePos model it already
// uses) nearly verbatim; only the globals it reads change.
//
// Scaled exactly like resizeCanvas() in game.js: CSS pixels for layout
// (UI.width/UI.height), backing store oversized by devicePixelRatio so text
// stays crisp. There is no Quality.cap here yet — quality.js isn't wired into
// the Phaser page until step 6 — so this reads devicePixelRatio raw, same as
// RenderScale.apply() does for Phaser's own canvas today.
const UI = {
  canvas: null,
  ctx: null,
  width: 0,
  height: 0,
  dpr: 1,

  init() {
    if (this.canvas) return this; // one overlay for the page's whole life

    this.canvas = document.createElement("canvas");
    canvas = this.canvas;
    Object.assign(this.canvas.style, {
      position: "absolute",
      inset: "0",
      // Off by default: a screen with no buttons of its own (there are none
      // yet, but the HUD will be one) must not steal clicks Phaser's canvas
      // would otherwise get. Whoever draws an interactive screen this frame
      // turns it on; see setInteractive().
      pointerEvents: "none",
    });
    document.body.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.resize();
    window.addEventListener("resize", () => this.resize());

    this.canvas.addEventListener("mousemove", (e) => {
      mousePos.x = e.clientX;
      mousePos.y = e.clientY;
    });
    this.canvas.addEventListener("click", (e) => {
      for (const h of this.clickHandlers) h(e.clientX, e.clientY);
    });

    return this;
  },

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    // The backing store is now larger than the viewport at any dpr above 1,
    // and a canvas's CSS box defaults to its width/height *attributes* — an
    // absolutely-positioned replaced element ignores inset:0 for sizing, it
    // only uses inset to place its intrinsic size. Without an explicit CSS
    // size the overlay would render at backing-store size instead of filling
    // the viewport, correct only by coincidence at dpr 1.
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  },

  // Whichever screen is on top for the frame calls this before it draws, the
  // same way the legacy loop's isMenu / isLeaderboard / isRaceFinished flags
  // decide what canvas.style.cursor and the click listener are allowed to
  // reach.
  setInteractive(on) {
    this.canvas.style.pointerEvents = on ? "auto" : "none";
  },

  clickHandlers: [],
  onClick(fn) {
    this.clickHandlers.push(fn);
  },
};

// Last known mouse position, read by screens.js's isHovered() — ported
// verbatim from screens.js, which owns this same name.
const mousePos = { x: -1, y: -1 };

// keyBindings.js draws itself and sets `canvas.style.cursor` at the end of it;
// that global is the only thing in the file that belongs to game.js. Aliasing
// the overlay to the name lets the rebind screen run here completely
// unmodified — the same stand-in worldCamera.js provides for rain.js/night.js
// — rather than being ported into a second copy of the same 130 lines of
// drawing. Assigned in init(), since the element doesn't exist before it.
let canvas = null;
