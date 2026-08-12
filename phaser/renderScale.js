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

const RenderScale = {
  apply(scene) {
    renderDpr = window.devicePixelRatio || 1;
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

    CarSprites.invalidate(); // sprites are baked at the old renderDpr
    if (scene.invalidateCarTextures) scene.invalidateCarTextures();
  },
};
