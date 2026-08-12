// Wires Sound.unlock()/toggleMute() the way game.js's own window keydown and
// canvas mousedown listeners do (game.js:730-744, 922-924) — one set of
// listeners for the whole page rather than one per scene, because MenuScene,
// RaceScene and RecordsScene all want the same behaviour and Phaser scenes
// come and go under them.
//
// Browsers only allow an AudioContext to start from a user gesture, so
// unlock() fires on every keydown and every mousedown; it is safe to call
// repeatedly (sound.js's own unlock() no-ops once the context exists). M
// mutes from every screen, matching the legacy loop's guard for every screen
// except key rebinding — which doesn't exist on this page yet.
Sound.load();

window.addEventListener("keydown", (e) => {
  Sound.unlock();
  if (e.key.toLowerCase() === "m") Sound.toggleMute();
});
window.addEventListener("mousedown", () => Sound.unlock());
