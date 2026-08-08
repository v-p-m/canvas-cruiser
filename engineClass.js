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
// Like Rain, this module never assigns to `car.maxSpeed` or `ai.baseMaxSpeed`
// itself. It hands out multipliers and the two places that already own those
// numbers — DebugConfig.apply() and resetRace() — apply them, so the tuning
// sliders keep meaning "the 100cc baseline" instead of being overwritten.
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
    try {
      localStorage.setItem("engineClass", this.current().id);
    } catch {
      /* private mode — the choice just won't outlive the tab */
    }
  },
};
