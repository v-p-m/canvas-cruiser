// A stand-in for four of game.js's own globals, so rain.js and night.js —
// both written for the legacy single-canvas loop — run on this page
// completely unmodified. Between them those two files only ever read:
//
//   camera        x/y = world scroll (world px), width/height = CSS-pixel
//                 viewport
//   viewZoom      how many CSS px one world px covers
//   viewWidth()/viewHeight()   camera.width/height divided by viewZoom
//   ctx           the 2D context they draw into
//
// There is no free camera on this page the way the legacy waypoint editor has
// one — nothing here ever zooms — so viewZoom stays 1 and world px and CSS px
// are the same thing, exactly as they are in a live race in the legacy loop.
// RaceScene.update() keeps camera.x/y in step with the Phaser camera's scroll
// every frame; RenderScale.apply() keeps width/height in step on resize.
//
// ctx is UI.ctx. Everything rain.js/night.js draw through it — puddles,
// drops, the screen tint, the night veil, the pylons and tail lights — is
// meant to sit over the whole scene, which is exactly what the UI overlay
// canvas already is: layered on top of Phaser's own. The one exception is
// puddles, which the legacy loop draws *under* the cars — the overlay canvas
// can't do that (it's on top of everything Phaser draws, always), so
// raceScene.js draws those itself as a Phaser Graphics object at a depth
// below the cars instead of going through Rain.drawPuddles().
const camera = { x: 0, y: 0, width: 0, height: 0 };
const viewZoom = 1;
function viewWidth() {
  return camera.width / viewZoom;
}
function viewHeight() {
  return camera.height / viewZoom;
}
let ctx = null; // set once by RaceScene.create(), after UI.init()
