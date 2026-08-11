// Lap counting and the race order.
//
// `updateLapCounter` / `raceScore` / `raceStandings` / `finishRace` out of
// game.js, with the rule they exist to enforce kept intact: the player and
// every opponent go through **one** call. Opponents used to drive the track
// without ever being scored against it, which made a "5 Lap Race" a time trial
// with moving obstacles; one counter for six cars is what stopped that, and
// splitting it again is how it would come back.
//
// The legacy counter carries an `isPlayer` branch — the HUD's lap number, the
// records, the per-lap weather. None of that exists on the Phaser page yet
// (steps 5, 6 and 8), so the port has no branch at all: every car keeps its own
// lap count, lap times and race clock on itself, and whatever draws the HUD
// later reads the player's entity like any other. That is a smaller counter
// than the one it replaces, not a different one.
//
// The clock is a parameter rather than a `performance.now()` call inside, so a
// headless run that hand-steps the world can hand it the same fixed step it
// gives Matter — an auto-stepped comparison is not repeatable against itself.

const RaceLaps = {
  // Laps in a race, or null for free running. game.js takes this from the menu
  // (`raceLapTarget()` — 5, 10 or free); the port has no menu until step 5, so
  // the page is a 5-lap race by default and `?laps=N` (0 for free) overrides,
  // which is also what a headless check needs to finish inside its budget.
  target: 5,

  nextFinishPosition: 1,

  // Everything a car needs to be scored. Spawn-time state, so it is here rather
  // than spelled out again in the scene: a field this list is missing is a car
  // the counter silently skips.
  initEntity(entity) {
    entity.laps = 0;
    entity.onFinishLine = false;
    entity.passedGate = false;
    entity.finished = false;
    entity.finishPosition = 0;
    entity.finishTime = 0;
    entity.raceStart = 0;
    entity.lapStart = 0;
    entity.lastLapTime = null;
    entity.bestLapTime = null;
    return entity;
  },

  // One car, one crossing. `now` is milliseconds on whatever clock the caller
  // is running; times come back out in seconds, as the records have always
  // stored them.
  update(world, entity, now) {
    if (entity.finished) return;

    RaceGrid.updateGate(world, entity);

    if (!RaceGrid.onStartLine(world, entity)) {
      entity.onFinishLine = false;
      return;
    }
    if (entity.onFinishLine) return; // already counted this crossing
    entity.onFinishLine = true;

    // The first crossing arms the race rather than completing a lap, and every
    // car times from its own — which is what the player's total has always
    // meant, so saved records stay comparable.
    if (entity.laps === 0) {
      entity.laps = 1;
      entity.passedGate = false;
      entity.raceStart = now;
      entity.lapStart = now;
      return;
    }

    // Crossing the line the wrong way, or without having been round, is not a
    // lap. The car still took the latch above, so the next honest crossing
    // counts normally.
    if (!entity.passedGate) return;
    entity.passedGate = false;

    entity.laps++;

    // The crossing that takes the flag completed a lap like any other, and it
    // is usually the quickest one — timing it below the finish branch is how
    // a 5-lap race ended up offering only four laps to the records.
    entity.lastLapTime = toSeconds(now - entity.lapStart);
    if (entity.bestLapTime === null || entity.lastLapTime < entity.bestLapTime)
      entity.bestLapTime = entity.lastLapTime;
    entity.lapStart = now;

    if (this.target && entity.laps > this.target) {
      entity.finished = true;
      entity.finishPosition = this.nextFinishPosition++;
      entity.finishTime = toSeconds(now - entity.raceStart);
    }
  },

  // Laps plus the fraction of the current one. Waypoint 0 sits within ~30px of
  // the start line, which is the whole reason this rises smoothly across a
  // crossing instead of stepping backwards.
  score(world, entity) {
    return (entity.laps || 0) + RaceGrid.progress(world, entity);
  },

  // Every car, most advanced first. Cars that have taken the flag are locked to
  // the order they finished in; the rest are sorted live on progress. `entries`
  // are the scene's {entity, name, color, isPlayer} records.
  standings(world, entries) {
    const ranked = entries.map((e) => ({
      ...e,
      laps: e.entity.laps || 0,
      finished: !!e.entity.finished,
      score: e.entity.finished ? Infinity : this.score(world, e.entity),
    }));

    ranked.sort((a, b) => {
      if (a.finished && b.finished)
        return a.entity.finishPosition - b.entity.finishPosition;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.score - a.score;
    });

    ranked.forEach((e, i) => (e.position = i + 1));
    return ranked;
  },

  // `finishRace()`: called once the player takes the flag. Everyone still
  // circulating is classified where they stand rather than being left to
  // finish — waiting out the rest of the field after your own race is over is
  // nobody's idea of fun. The table is built at the instant of crossing so
  // nothing in it can drift afterwards; an opponent gaining a place once the
  // player is done would read as the results reordering themselves.
  classify(world, entries) {
    const target = this.target;
    return this.standings(world, entries).map((e) => ({
      position: e.position,
      name: e.name,
      color: e.color,
      isPlayer: !!e.isPlayer,
      dnf: !e.finished,
      laps: target ? Math.min(e.laps, target) : e.laps,
      time: e.entity.finishTime,
    }));
  },

  reset(entries) {
    this.nextFinishPosition = 1;
    entries.forEach((e) => this.initEntity(e.entity || e));
  },
};

// Times are seconds, rounded to the millisecond — `toMillis()` in game.js,
// under the name it actually deserved.
function toSeconds(ms) {
  return Math.round(ms) / 1000;
}
