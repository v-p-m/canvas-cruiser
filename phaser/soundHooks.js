// Wires Sound.unlock()/toggleMute() the way game.js's own window keydown and
// canvas mousedown listeners do (game.js:730-744, 922-924) — one set of
// listeners for the whole page rather than one per scene, because MenuScene,
// RaceScene and RecordsScene all want the same behaviour and Phaser scenes
// come and go under them.
//
// Browsers only allow an AudioContext to start from a user gesture, so
// unlock() fires on every keydown and every mousedown; it is safe to call
// repeatedly (sound.js's own unlock() no-ops once the context exists). M mutes
// from every screen but one, matching the legacy loop's `!isKeyBindings` guard
// (game.js:743): a rebind screen waiting for a key has to be allowed to hear
// M without acting on it. `KeyBindings.listening` is that state and is page
// state, not a scene's, which is what lets one page-wide listener test it —
// M is blacklisted, so the press is rejected as a binding, and muting the game
// on the way past would be a second thing happening that nobody asked for.
Sound.load();

window.addEventListener("keydown", (e) => {
  Sound.unlock();
  if (!KeyBindings.listening && e.key.toLowerCase() === "m") Sound.toggleMute();
});
window.addEventListener("mousedown", () => Sound.unlock());
