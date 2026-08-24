// A four-race championship across the circuits, in the shape of
// phaser/garage.js and phaser/records.js: localStorage, parsed defensively,
// bad or missing JSON discarding the series rather than throwing.
//
// What it is *for* is the tie: a circuit picker, an engine class and a garage
// full of upgrades are three separate choices made on one menu screen, and a
// single race spends none of them against each other. A series spends all
// three at once — the class is locked for the whole championship, the calendar
// takes the field to four different circuits, and the garage points each
// round pays out are spendable between rounds, so the car that starts round 4
// is the one the first three rounds earned.
//
// It stores results, not a running tally: `standings()` is derived from the
// per-round rows every time it is asked for. One source of truth means a
// reloaded series and a live one cannot disagree, and it is what makes the
// tie-breaks (wins, then best finish) expressible at all.
//
// Championship points are awarded to *every* car, not just the player — the
// point of a title fight is that someone else can win it. The field's
// identities survive from round to round on the driver name RaceLaps.classify
// puts in each row ("YOU", "CPU 1"…), which phaser/raceScene.js builds by grid
// index, and the liveries are code (GRID_LIVERIES), so CPU 3 is the same
// orange car on every circuit.
const SERIES_ROUNDS = 4;
const SERIES_LAPS = 5; // laps per round — four 5-lap races is one sitting

// Points by finishing position, index 0 being the win. Six-car grids and six
// scoring places: last still pays, because a round nobody can score in is a
// round with nothing at stake. The gap is widest at the front (10-8-6) so a
// win is worth chasing on the last lap rather than settling for the position.
//
// A `dnf` row still scores its position. In this game that flag does not mean
// a retirement — RaceLaps.classify marks every car still circulating when the
// player took the flag, which is the normal fate of the slower half of the
// field — so scoring it as a non-finish would zero cars that simply finished
// behind.
const SERIES_POINTS = [10, 8, 6, 4, 2, 1];

// The saved shape. Bump it when the stored fields change meaning and a
// half-run championship from the old build is discarded on load rather than
// half-read — the same job spawnVersion/aiVersion do in editor/debugConfig.js.
// Bumped to 2 when the calendar went from three rounds to four: adopt() would
// have thrown a saved three-round series out on the length check anyway, but
// the version is what says *why*, and it is the only thing that still works if
// a later change keeps the length.
const SERIES_VERSION = 2;

const Series = {
  active: false,
  round: 0, // 0-based index of the round about to be run
  classId: DEFAULT_CLASS_ID,
  calendar: [], // track ids, in the order they are raced
  results: [], // one row per completed round: [{name, color, isPlayer, position, points}]
  bonus: 0, // garage points the title itself paid, once the last round is in

  load() {
    this.reset();
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem("series"));
    } catch {
      localStorage.removeItem("series");
      return;
    }
    if (!saved || typeof saved !== "object") return;
    if (saved.v !== SERIES_VERSION || !this.adopt(saved)) {
      localStorage.removeItem("series");
      this.reset();
    }
  },

  // Everything read back is validated, not trusted: a calendar naming a
  // circuit this build no longer ships, or a round index past the end of it,
  // discards the series rather than starting a race against a missing track.
  adopt(saved) {
    if (!Array.isArray(saved.calendar) || saved.calendar.length !== SERIES_ROUNDS) return false;
    if (!saved.calendar.every((id) => PHASER_TRACKS.some((t) => t.id === id))) return false;
    if (!Array.isArray(saved.results) || saved.results.length > SERIES_ROUNDS) return false;
    if (!Number.isInteger(saved.round) || saved.round < 0 || saved.round > SERIES_ROUNDS) return false;
    if (saved.round !== saved.results.length) return false;

    const rounds = [];
    for (const row of saved.results) {
      if (!Array.isArray(row) || row.length === 0) return false;
      rounds.push(
        row.map((e) => ({
          name: String(e.name),
          color: String(e.color),
          isPlayer: !!e.isPlayer,
          position: Number(e.position) || 0,
          points: Number(e.points) || 0,
        })),
      );
    }

    this.calendar = saved.calendar.slice();
    this.results = rounds;
    this.round = saved.round;
    this.classId = ENGINE_CLASSES.some((c) => c.id === saved.classId)
      ? saved.classId
      : DEFAULT_CLASS_ID;
    this.bonus = Number(saved.bonus) || 0;
    this.active = true;
    return true;
  },

  save() {
    try {
      if (!this.active) localStorage.removeItem("series");
      else
        localStorage.setItem(
          "series",
          JSON.stringify({
            v: SERIES_VERSION,
            round: this.round,
            classId: this.classId,
            calendar: this.calendar,
            results: this.results,
            bonus: this.bonus,
          }),
        );
    } catch {
      /* private mode — the championship still runs, it just won't outlive the tab */
    }
  },

  reset() {
    this.active = false;
    this.round = 0;
    this.classId = DEFAULT_CLASS_ID;
    this.calendar = [];
    this.results = [];
    this.bonus = 0;
  },

  clear() {
    this.reset();
    this.save();
  },

  // The calendar opens on whichever circuit the menu had selected and then
  // visits the next ones in TRACKS order, wrapping. Deliberately not a random
  // draw: the player picks where the championship starts, the whole calendar
  // is on the menu before START is pressed, and the same four rounds can be
  // run again after a bad one.
  //
  // With five circuits and four rounds the wrap never repeats one, so every
  // championship is four different tracks whichever it opens on.
  begin(startTrackIndex, classId) {
    this.reset();
    const n = PHASER_TRACKS.length;
    for (let i = 0; i < SERIES_ROUNDS; i++) {
      this.calendar.push(PHASER_TRACKS[(startTrackIndex + i) % n].id);
    }
    this.classId = ENGINE_CLASSES.some((c) => c.id === classId) ? classId : DEFAULT_CLASS_ID;
    this.active = true;
    this.save();
  },

  complete() {
    return this.active && this.results.length >= SERIES_ROUNDS;
  },

  // The track of the round about to be run — null once the last one is in.
  currentTrack() {
    if (!this.active || this.round >= this.calendar.length) return null;
    return PHASER_TRACKS.find((t) => t.id === this.calendar[this.round]) || null;
  },

  trackAt(round) {
    return PHASER_TRACKS.find((t) => t.id === this.calendar[round]) || null;
  },

  // The class is part of the championship, not of the menu — a title won by
  // dropping to 60cc for the hard circuit is not the same title. Called on the
  // way into every round.
  applyClass() {
    // Not persisted: the series is its own record of what class it runs in,
    // and the class the player picks for their own races is theirs to keep.
    return EngineClass.select(this.classId, false);
  },

  pointsFor(position) {
    if (!Number.isInteger(position) || position < 1) return 0;
    return SERIES_POINTS[position - 1] || 0;
  },

  // `finishOrder` is RaceLaps.classify()'s table; `round` is which round the
  // race that produced it was, captured when that race started.
  //
  // That second argument is the whole idempotence guard, and it has to be the
  // caller's: recording advances `this.round`, so "have I already been called"
  // is not answerable from the state here — a second call would simply look
  // like the next round arriving early. A race that knows it was round 1
  // cannot file itself again once round 1 is in the book.
  recordRound(finishOrder, round) {
    if (!this.active || this.round >= SERIES_ROUNDS) return null;
    if (this.results.length !== this.round) return null; // state torn — file nothing
    if (Number.isInteger(round) && round !== this.round) return null;

    const row = finishOrder.map((e) => ({
      name: e.name,
      color: e.color,
      isPlayer: !!e.isPlayer,
      position: e.position,
      points: this.pointsFor(e.position),
    }));
    this.results.push(row);
    this.round += 1;

    // The title's own payout, on top of the per-round garage points
    // phaser/raceScene.js already awards for a top-3 finish. It is what makes
    // the last round worth driving when the round's own podium is out of
    // reach: four rounds of points spent in the garage and then a champion's
    // bonus is a bigger car than four unrelated wins.
    if (this.complete()) {
      const table = this.standings();
      const me = table.find((r) => r.isPlayer);
      this.bonus = me ? Garage.awardForSeries(me.position, table.length) : 0;
    }
    this.save();
    return row;
  },

  // The championship as it stands, most points first. Ties break on wins,
  // then on best single finish, then on the earlier round's result — the same
  // countback a real championship uses, and it matters here: four rounds of
  // six cars puts two drivers on the same total more often than not.
  standings() {
    const byName = new Map();
    this.results.forEach((round, roundIndex) => {
      for (const e of round) {
        let row = byName.get(e.name);
        if (!row) {
          row = {
            name: e.name,
            color: e.color,
            isPlayer: e.isPlayer,
            points: 0,
            wins: 0,
            best: Infinity,
            rounds: new Array(this.results.length).fill(null),
            gained: 0, // points from the most recent round, for the "+N" column
          };
          byName.set(e.name, row);
        }
        row.points += e.points;
        if (e.position === 1) row.wins += 1;
        row.best = Math.min(row.best, e.position);
        row.rounds[roundIndex] = e.position;
        if (roundIndex === this.results.length - 1) row.gained = e.points;
      }
    });

    const table = [...byName.values()];
    table.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (a.best !== b.best) return a.best - b.best;
      return this.countback(a, b);
    });
    table.forEach((row, i) => (row.position = i + 1));
    return table;
  },

  // Still level on points, wins and best finish: whoever was ahead in the
  // earliest round they differ in.
  countback(a, b) {
    for (let i = 0; i < a.rounds.length; i++) {
      const pa = a.rounds[i] ?? Infinity;
      const pb = b.rounds[i] ?? Infinity;
      if (pa !== pb) return pa - pb;
    }
    return 0;
  },

  // "ROUND 2 OF 4", for whatever is drawing it. Reads the round about to be
  // run, so it is the same string on the menu, in the HUD and on the standings
  // screen between rounds.
  roundLabel(round = this.round) {
    return `ROUND ${Math.min(round + 1, SERIES_ROUNDS)} OF ${SERIES_ROUNDS}`;
  },
};
