// Engine classes — how fast the whole field goes.
//
// The sizes are the real karting ladder: 60cc is the Cadet/Mini entry class,
// 100cc was the senior class (Formula A / ICA) until 2007, and 250cc is the
// Superkart. 100cc is the car the game shipped with, so its scales are exactly
// 1 and every record set before classes existed is still a 100cc record.
//
// Only speed and acceleration scale. `turnSpeed` and `driftGrip` deliberately
// do not: a 250cc car steers and grips like the 100cc one, so the extra pace
// has to be carried through the same corners on the same rubber. That is the
// entire difficulty curve — scaling grip alongside it would hand the speed
// straight back and every class would drive the same.
//
// It applies to the whole grid, because the whole grid is one car: the
// opponents' corner speeds fall out of the same `turnSpeed`, so a 250cc field
// arrives at every corner faster on the same lock and has to brake for it,
// exactly as the player does.
//
// Like Rain, this module never assigns to `car.maxSpeed` itself. It hands out
// multipliers and the one place that owns those numbers — applyCarStats() in
// game.js — applies them, so the tuning sliders keep meaning "the 100cc
// baseline" instead of being overwritten.
//
// The HUD reads speed × 10 as KM/H, so each class's speedo tops out at its own
// number: 80, 100, 135.
const ENGINE_CLASSES = [
  { id: "60cc", label: "60cc", sub: "Cadet", speed: 0.8, accel: 0.85 },
  { id: "100cc", label: "100cc", sub: "Formula", speed: 1.0, accel: 1.0 },
  { id: "250cc", label: "250cc", sub: "Superkart", speed: 1.35, accel: 1.25 },
];

// The class every pre-0.12 time was set in — loadRecords() files the old
// tables under it, and it is what the menu opens on.
const DEFAULT_CLASS_ID = "100cc";

const EngineClass = {
  selected: ENGINE_CLASSES.findIndex((c) => c.id === DEFAULT_CLASS_ID),

  current() {
    return ENGINE_CLASSES[Math.min(this.selected, ENGINE_CLASSES.length - 1)];
  },

  speedScale() {
    return this.current().speed;
  },

  accelScale() {
    return this.current().accel;
  },

  // "60cc · Cadet" — what the menu row and the records header show.
  label() {
    const c = this.current();
    return `${c.label} · ${c.sub}`;
  },

  load() {
    try {
      const saved = localStorage.getItem("engineClass");
      const i = ENGINE_CLASSES.findIndex((c) => c.id === saved);
      if (i >= 0) this.selected = i;
    } catch {
      /* private-mode localStorage — the default class is fine */
    }
  },

  cycle(dir) {
    this.selected =
      (this.selected + dir + ENGINE_CLASSES.length) % ENGINE_CLASSES.length;
    this.persist();
  },

  // The same choice made by id rather than by direction, for a caller that
  // knows which class it wants: a championship locks one in for every one of
  // its rounds (phaser/series.js) and has to put it back on the way into each
  // one. Unknown ids leave the current class alone rather than defaulting, so
  // a stale saved id can't silently re-class the car.
  //
  // `persist` is what separates the player choosing a class from something
  // else imposing one. A series carries its own class and re-applies it on
  // every entry, so it has no need to write it to storage — and if it did, a
  // championship run in 60cc would leave the menu on 60cc afterwards, having
  // quietly overwritten the class the player actually races in.
  select(id, persist = true) {
    const i = ENGINE_CLASSES.findIndex((c) => c.id === id);
    if (i < 0) return false;
    this.selected = i;
    if (persist) this.persist();
    return true;
  },

  persist() {
    try {
      localStorage.setItem("engineClass", this.current().id);
    } catch {
      /* private mode — the choice just won't outlive the tab */
    }
  },
};
