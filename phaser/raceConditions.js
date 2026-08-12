// Per-race weather and night, ported off game.js's RACE CONDITIONS block
// (scheduleNight / scheduleWeather / applyWeatherForLap, game.js:1155-1200).
// Same rule as rain.js/night.js themselves: this only ever calls
// Rain.toggle() / Night.toggle() — it never reaches into driftGrip or
// maxSpeed itself.
//
// The legacy functions read a module-level `gameMode` global. RaceLaps
// deliberately carries no such global-shaped state (see phaser/raceLaps.js's
// header on why the port avoids an isPlayer-shaped special case), so modeId
// is passed into every RaceConditions method instead — the same
// "free"/"race5"/"race10" id PHASER_MODES already carries, and RaceScene
// already derives it from RaceLaps.target for the total-time record save.
//
// weatherWetFromLap/weatherWetToLap below are declared as the same bare
// globals game.js itself uses (game.js:29) rather than object properties,
// because Rain.drawHUD() (rain.js:215-246) reads those two names — plus
// hasStarted/isMenu/gameMode — straight off the page, unmodified, to draw its
// pre-race forecast line. RaceScene.update() keeps hasStarted/gameMode in
// step every frame; isMenu is always false here — there is no menu state
// inside a race scene to be in.
let hasStarted = false;
let isMenu = false;
let gameMode = "free";
let weatherWetFromLap = null;
let weatherWetToLap = null;

const RaceConditions = {
  // Rolled per race and independent of the weather, so all four combinations
  // come up — including rain at night. Unlike the rain it does not move
  // mid-race: a circuit that got dark on lap 4 would read as a bug.
  NIGHT_CHANCE: 0.3,

  scheduleNight(modeId) {
    Night.clear();
    if (modeId !== "race5" && modeId !== "race10") return; // free drive: N toggles it by hand
    if (Math.random() < this.NIGHT_CHANCE) Night.toggle();
  },

  scheduleWeather(modeId) {
    weatherWetFromLap = null;
    weatherWetToLap = null;

    if (modeId === "race5") {
      // 50/50 — either the whole race is wet, or completely dry
      if (Math.random() < 0.5) {
        weatherWetFromLap = 1;
        weatherWetToLap = null; // stays wet all race
      }
    } else if (modeId === "race10") {
      // Rain covers ~5 laps starting at a random lap between 1 and 6
      const start = 1 + Math.floor(Math.random() * 6); // 1-6
      const duration = 4 + Math.floor(Math.random() * 3); // 4-6 laps
      weatherWetFromLap = start;
      weatherWetToLap = start + duration; // rain stops when this lap begins
    }
    // free drive: no schedule — the player uses P to toggle
  },

  applyWeatherForLap(modeId, lap) {
    if (modeId !== "race5" && modeId !== "race10") return;
    const shouldBeWet =
      weatherWetFromLap !== null &&
      lap >= weatherWetFromLap &&
      (weatherWetToLap === null || lap < weatherWetToLap);
    const currentlyWet = Rain.targetIntensity > 0;
    if (shouldBeWet && !currentlyWet) Rain.toggle();
    if (!shouldBeWet && currentlyWet) Rain.toggle();
  },
};
