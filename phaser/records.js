// Lap and total-time records — ported off game.js's loadRecords/selectRecords/
// saveLapTime/saveTotalTime/clearHighScores (game.js:1042-1153), restructured
// as an object instead of module-level globals so RaceScene can call it
// without reaching into game.js.
//
// Same localStorage keys as the legacy loop ("highScores", "bestTotalTimes"),
// same "track:class" key shape, same defensive parsing (bad JSON is dropped,
// never trusted) and the same upgradeKey() compatibility path for pre-class
// saves — CLAUDE.md requires track/class ids stay colon-free and that path
// keep working, and nothing here changes either.
//
// What's new: RECORDS_PHYSICS_VERSION. Lap times from the legacy loop's
// physics and Matter's are not comparable — a 250cc lap that took 11.4s under
// one is not the same manoeuvre at 11.4s under the other — so on this page's
// first run, both stores are cleared once rather than silently mixing two
// physics models' times into one leaderboard. Deliberately not namespaced
// keys living alongside the old ones: this project has no released players
// yet to preserve pre-port times for, so a clean reset is simpler than a
// second copy of the records code to read them. Bump the version string if
// the physics changes meaningfully again later.
// "matter-2": 0.15.0's slip-graded cornering scrub. Unlike the impact model,
// which is dormant on a clean lap, this one moves every lap — a solo reference
// car came down 3.6% on Super Circuit — so times either side of it are again
// not the same manoeuvre.
const RECORDS_PHYSICS_VERSION = "matter-2";

const Records = {
  all: {}, // "track:class" -> [lap times]
  allTotals: {}, // "track:class" -> { mode: [total times] }
  highScores: [],
  bestTotalTimes: {},

  key(trackId, classId) {
    return `${trackId}:${classId}`;
  },

  // Every key written before engine classes existed was a bare track id, and
  // every time behind it was set in what is now 100cc.
  upgradeKey(key) {
    return key.includes(":") ? key : `${key}:${DEFAULT_CLASS_ID}`;
  },

  resetOnce() {
    try {
      if (localStorage.getItem("recordsPhysicsVersion") === RECORDS_PHYSICS_VERSION)
        return;
      localStorage.removeItem("highScores");
      localStorage.removeItem("bestTotalTimes");
      localStorage.removeItem("bestLap"); // pre-multi-track leftover, same as clearHighScores()
      localStorage.setItem("recordsPhysicsVersion", RECORDS_PHYSICS_VERSION);
    } catch {
      /* private-mode localStorage — nothing to reset or mark */
    }
  },

  // Both tables were flat when there was one circuit: highScores an array of
  // laps, bestTotalTimes a map of mode -> totals. Either shape read off disk
  // is taken as the first track's.
  load() {
    this.resetOnce();
    this.all = {};
    this.allTotals = {};

    try {
      const parsed = JSON.parse(localStorage.getItem("highScores"));
      if (Array.isArray(parsed)) this.all[this.upgradeKey(PHASER_TRACKS[0].id)] = parsed;
      else if (parsed && typeof parsed === "object") {
        for (const id of Object.keys(parsed))
          if (Array.isArray(parsed[id])) this.all[this.upgradeKey(id)] = parsed[id];
      } else if (parsed !== null) localStorage.removeItem("highScores");
    } catch {
      localStorage.removeItem("highScores");
    }

    try {
      const parsed = JSON.parse(localStorage.getItem("bestTotalTimes"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const flat = Object.values(parsed).some(Array.isArray);
        const byTrack = flat ? { [PHASER_TRACKS[0].id]: parsed } : parsed;
        for (const id of Object.keys(byTrack)) {
          const modes = byTrack[id];
          if (!modes || typeof modes !== "object") continue;
          const key = this.upgradeKey(id);
          this.allTotals[key] = {};
          for (const mode of Object.keys(modes))
            if (Array.isArray(modes[mode])) this.allTotals[key][mode] = modes[mode];
        }
      } else if (parsed !== null) {
        localStorage.removeItem("bestTotalTimes");
      }
    } catch {
      localStorage.removeItem("bestTotalTimes");
    }
  },

  // Points highScores/bestTotalTimes at the given track+class's slice —
  // creating an empty one if this is its first visit, same as selectRecords().
  select(trackId, classId) {
    const key = this.key(trackId, classId);
    this.highScores = this.all[key] || (this.all[key] = []);
    this.bestTotalTimes = this.allTotals[key] || (this.allTotals[key] = {});
  },

  // Returns whether this lap is a new record for its track+class, the same
  // condition LapBanner's gold treatment keys off in the legacy loop.
  saveLapTime(trackId, classId, time) {
    this.select(trackId, classId);
    const previousBest = this.highScores[0] || null;

    this.highScores.push(time);
    this.highScores.sort((a, b) => a - b);
    this.highScores = this.highScores.slice(0, 5);
    this.all[this.key(trackId, classId)] = this.highScores;
    try {
      localStorage.setItem("highScores", JSON.stringify(this.all));
    } catch {
      /* private mode — the run still counts, it just won't outlive the tab */
    }

    return this.highScores[0] === time && time !== previousBest;
  },

  // Returns whether this finish is a new best total for its track+class+mode.
  saveTotalTime(trackId, classId, mode, time) {
    this.select(trackId, classId);
    const list = this.bestTotalTimes[mode] || [];
    const previousBest = list[0];
    const isBest = previousBest === undefined || time < previousBest;

    list.push(time);
    list.sort((a, b) => a - b);
    this.bestTotalTimes[mode] = list.slice(0, 3);
    try {
      localStorage.setItem("bestTotalTimes", JSON.stringify(this.allTotals));
    } catch {
      /* private mode */
    }

    return isBest;
  },

  clear() {
    this.all = {};
    this.allTotals = {};
    this.highScores = [];
    this.bestTotalTimes = {};
    try {
      localStorage.removeItem("highScores");
      localStorage.removeItem("bestLap");
      localStorage.removeItem("bestTotalTimes");
    } catch {
      /* private mode — nothing was persisted to begin with */
    }
  },
};
