// Owns the render scale for the Phaser port — the same job resizeCanvas()
// does for the legacy loop (game.js). CarSprites bakes per livery in device
// pixels (carSprites.js), and its cache is only ever correct for the
// renderDpr it was baked at, so whatever decides how many device pixels a
// world unit gets is also the thing that has to throw that cache away.
//
// Phaser's own canvas is not devicePixelRatio-aware on its own: left alone,
// its backing store is exactly the CSS size, so a retina screen just gets a
// crisp-looking-but-not-actually-crisp canvas. The fix is the same trick
// resizeCanvas() plays on the raw 2D context, translated to Phaser terms —
// oversize the backing store by renderDpr and zoom every camera back down by
// the same factor, so world units (and the coordinates RaceGrid /
// trackProgress read) don't move; only the pixel density under them does.
let renderDpr = 1;

// Ports game.js's own MAX_DPR (game.js:288) — the frame is fill-rate bound,
// so cost is linear in dpr². There is no manual-override slider on this page
// yet (step 5's `B` stub), so Quality.cap is the only thing that ever moves
// this down from here.
const MAX_DPR = 1.5;

function currentMaxDpr() {
  return Quality.auto ? Math.min(MAX_DPR, Quality.cap) : MAX_DPR;
}

// So quality.js's Quality._commit() — which calls the bare `resizeCanvas()`
// name, exactly as it does in the legacy loop — has a scene to re-apply the
// scale to. Whichever scene called RenderScale.apply() last wins; only
// RaceScene ever does, so this is effectively "the current race".
let _activeScene = null;

const RenderScale = {
  apply(scene) {
    _activeScene = scene;
    renderDpr = Math.min(window.devicePixelRatio || 1, currentMaxDpr());
    const w = window.innerWidth;
    const h = window.innerHeight;
    const game = scene.sys.game;

    // The backing store, in device pixels — this is what CarSprites' bake
    // and the camera zoom below have to agree with.
    game.scale.resize(Math.round(w * renderDpr), Math.round(h * renderDpr));
    // scale.resize() only touches canvas.style when its own (unrelated)
    // zoom property is not 1, which it never is here — so the CSS size has
    // to be set by hand or the canvas renders at device-pixel size on screen.
    game.canvas.style.width = `${w}px`;
    game.canvas.style.height = `${h}px`;
    // Zooming the camera back down by renderDpr is what keeps a world unit a
    // world unit: the viewport now has renderDpr times the pixels behind it,
    // but shows exactly the same span of the track it did before.
    scene.cameras.main.setZoom(renderDpr);

    // camera.width/height (phaser/worldCamera.js) are CSS px, same as the
    // legacy loop's own `camera.width/height` — rain.js/night.js read them
    // raw, with no dpr or zoom folded in.
    camera.width = w;
    camera.height = h;
    Night.resize(); // the darkness veil is a viewport-sized layer of its own

    CarSprites.invalidate(); // sprites are baked at the old renderDpr
    if (scene.invalidateCarTextures) scene.invalidateCarTextures();
  },
};

// quality.js's own Quality._commit() calls this by name — the same function
// game.js exposes for exactly that purpose. Phaser has no single global
// canvas to resize, so this just re-runs RenderScale.apply() against
// whichever scene last called it.
function resizeCanvas() {
  if (_activeScene) RenderScale.apply(_activeScene);
}
