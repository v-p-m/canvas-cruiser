// debugConfig.js — the editor page's tuning panel.
//
// This file is loaded by editor.html only. The game runs on Matter now, and
// half these sliders would be lying about what they control there; what still
// earns its keep is the spawn block, which is how a starting grid's numbers are
// found before they go into a track file. The rest tunes the legacy loop the
// editor's pace car runs on, which is worth having while a line is being cut.
//
// It defines none of the shipped numbers any more. Every default below is
// seeded in seedDefaults() from the file that owns it — carStats.js and ai.js —
// because a second copy of a number here was always the copy that won.

const DebugConfig = {
  visible: false,

  // The speed numbers here are the 100cc baseline. What the cars actually get
  // is these times the selected engine class's multiplier — applyCarStats() is
  // where the two meet, so dragging a slider tunes every class at once.
  //
  // There are no AI speed, turn or grip sliders: the opponents drive the
  // player's car, so the player block is theirs too and a second set could only
  // ever be a way to make them a different vehicle again. The `ai*` keys tune
  // the driver.
  defaults: {
    // Player and AI — filled in from CAR_STATS and ai.js by seedDefaults()

    // Collision
    collisionHalfW: 1.0, // multiplier of car.width
    collisionHalfH: 1.0, // multiplier of car.height
    collisionNudge: 0.4,
    collisionHardImpact: 3.0,

    // Race
    countdownInterval: 1000,
    countdownGoTime: 400,

    // Render — maxDpr is seeded from game.js's MAX_DPR in seedDefaults(),
    // since this file is parsed before that constant exists.

    // Spawn — filled in from SPAWN_POSITIONS by seedDefaults()
  },

  // Bumped whenever the shipped starting grids change, so a saved copy of an
  // old one can't quietly override them on the next load. The track id rides
  // along with it: grids are per circuit now, and Super Circuit's coordinates
  // put the field in a field on Snake Valley.
  spawnVersion: 5,

  spawnKey() {
    return `${this.spawnVersion}:${currentTrack().id}`;
  },

  // True once init() has seeded `values` — before that there is nothing for a
  // track change to move over.
  ready: false,

  // Same idea for the opponent tuning: anyone who has ever opened the panel
  // has an `ai*` block in localStorage, and it would otherwise pin them to
  // whatever the balance was on the day they opened it.
  aiVersion: 6,

  // Every shipped number the panel can move, read back from the file that owns
  // it. None of them can go in the `defaults` literal above: SPAWN_POSITIONS
  // and MAX_DPR live in game.js, which is parsed last, and the rest belong to
  // carStats.js and ai.js on principle — the panel overrides values, it does
  // not define them.
  //
  // SPAWN_POSITIONS — itself filled from the loaded track's `spawn` block — is
  // the one source of truth for the starting grid; the sliders only nudge it at
  // runtime. Keeping a second copy of the numbers here let the two drift apart,
  // and this copy was the one that won.
  seedDefaults() {
    this.defaults.playerAcceleration = CAR_STATS.acceleration;
    this.defaults.playerMaxSpeed = CAR_STATS.maxSpeed;
    this.defaults.playerTurnSpeed = CAR_STATS.turnSpeed;
    this.defaults.playerDriftGrip = CAR_STATS.driftGrip;

    this.defaults.aiSkillMin = SKILL_MIN;
    this.defaults.aiSkillMax = SKILL_MAX;
    this.defaults.aiCornerMargin = CORNER_MARGIN;
    this.defaults.aiLineOffsetRange = LINE_OFFSET_RANGE;
    this.defaults.aiAvoidRadius = AVOID_RADIUS;
    this.defaults.aiAvoidStrength = AVOID_STRENGTH;

    SPAWN_POSITIONS.forEach((pos, i) => {
      const name = i === 0 ? "Player" : `AI${i}`;
      this.defaults[`spawn${name}X`] = pos.x;
      this.defaults[`spawn${name}Y`] = pos.y;
    });
    this.defaults.maxDpr = MAX_DPR;
  },

  // Called when a different circuit finishes loading. The sliders are still
  // pointing at the old track's grid, and the next apply() would drop the field
  // back onto it, so both the defaults and the live values move over. Grid
  // tuning is therefore per session and per track — the sliders are for finding
  // the numbers that then go into the track file.
  adoptSpawns() {
    this.seedDefaults();
    if (!this.ready) return; // pre-init: load() is about to seed values anyway
    SPAWN_POSITIONS.forEach((pos, i) => {
      const name = i === 0 ? "Player" : `AI${i}`;
      this.values[`spawn${name}X`] = pos.x;
      this.values[`spawn${name}Y`] = pos.y;
    });
    this.buildPanel();
    this.save();
  },

  schema: [
    { group: "Player" },
    {
      key: "playerAcceleration",
      label: "Acceleration",
      min: 0.05,
      max: 1.0,
      step: 0.01,
    },
    { key: "playerMaxSpeed", label: "Max speed", min: 2, max: 20, step: 0.5 },
    {
      key: "playerTurnSpeed",
      label: "Turn speed",
      min: 0.01,
      max: 0.2,
      step: 0.005,
    },
    {
      key: "playerDriftGrip",
      label: "Drift grip",
      min: 0.01,
      max: 1.0,
      step: 0.01,
    },

    { group: "AI" },
    { key: "aiSkillMin", label: "Skill min", min: 0.5, max: 1.2, step: 0.01 },
    { key: "aiSkillMax", label: "Skill max", min: 0.5, max: 1.2, step: 0.01 },
    {
      key: "aiCornerMargin",
      label: "Corner margin",
      min: 0.3,
      max: 1.2,
      step: 0.01,
    },
    {
      key: "aiLineOffsetRange",
      label: "Line offset",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "aiAvoidRadius",
      label: "Avoid radius",
      min: 0,
      max: 300,
      step: 5,
    },
    {
      key: "aiAvoidStrength",
      label: "Avoid strength",
      min: 0,
      max: 200,
      step: 5,
    },

    { group: "Collision" },
    {
      key: "collisionHalfW",
      label: "Box width",
      min: 0.1,
      max: 2.0,
      step: 0.05,
    },
    {
      key: "collisionHalfH",
      label: "Box height",
      min: 0.1,
      max: 2.0,
      step: 0.05,
    },
    {
      key: "collisionNudge",
      label: "Nudge force",
      min: 0,
      max: 2.0,
      step: 0.05,
    },
    {
      key: "collisionHardImpact",
      label: "Hard impact",
      min: 0.5,
      max: 10,
      step: 0.25,
    },

    { group: "Race" },
    {
      key: "countdownInterval",
      label: "Countdown (ms)",
      min: 200,
      max: 3000,
      step: 100,
    },
    {
      key: "countdownGoTime",
      label: "GO time (ms)",
      min: 100,
      max: 2000,
      step: 50,
    },
    { group: "Render" },
    { key: "maxDpr", label: "Max dpr", min: 1, max: 3, step: 0.25 },
    { group: "Spawn positions" },
    { key: "spawnPlayerX", label: "Player X", min: 0, max: 2560, step: 5 },
    { key: "spawnPlayerY", label: "Player Y", min: 0, max: 2560, step: 5 },
    { key: "spawnAI1X", label: "AI 1 X", min: 0, max: 2560, step: 5 },
    { key: "spawnAI1Y", label: "AI 1 Y", min: 0, max: 2560, step: 5 },
    { key: "spawnAI2X", label: "AI 2 X", min: 0, max: 2560, step: 5 },
    { key: "spawnAI2Y", label: "AI 2 Y", min: 0, max: 2560, step: 5 },
    { key: "spawnAI3X", label: "AI 3 X", min: 0, max: 2560, step: 5 },
    { key: "spawnAI3Y", label: "AI 3 Y", min: 0, max: 2560, step: 5 },
    { key: "spawnAI4X", label: "AI 4 X", min: 0, max: 2560, step: 5 },
    { key: "spawnAI4Y", label: "AI 4 Y", min: 0, max: 2560, step: 5 },
    { key: "spawnAI5X", label: "AI 5 X", min: 0, max: 2560, step: 5 },
    { key: "spawnAI5Y", label: "AI 5 Y", min: 0, max: 2560, step: 5 },
  ],

  values: {},

  load() {
    this.seedDefaults();
    const saved = localStorage.getItem("debugConfig");
    this.values = { ...this.defaults };
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      // Grid coordinates saved against an older layout — or against the other
      // circuit — would put cars back on the grass, so drop them and keep the
      // rest of the tuning.
      const savedVersion = localStorage.getItem("debugConfigSpawnVersion");
      if (savedVersion !== this.spawnKey()) {
        for (const key of Object.keys(parsed))
          if (key.startsWith("spawn")) delete parsed[key];
      }
      const savedAiVersion = +localStorage.getItem("debugConfigAiVersion");
      if (savedAiVersion !== this.aiVersion) {
        for (const key of Object.keys(parsed))
          if (key.startsWith("ai")) delete parsed[key];
      }
      Object.assign(this.values, parsed);
    } catch {
      localStorage.removeItem("debugConfig");
    }
  },

  save() {
    localStorage.setItem("debugConfig", JSON.stringify(this.values));
    localStorage.setItem("debugConfigSpawnVersion", this.spawnKey());
    localStorage.setItem("debugConfigAiVersion", this.aiVersion);
  },

  reset() {
    this.values = { ...this.defaults };
    Quality.auto = true; // resetting the sliders gives the governor the wheel back
    localStorage.removeItem("debugConfig");
    localStorage.removeItem("debugConfigSpawnVersion");
    localStorage.removeItem("debugConfigAiVersion");
    this.apply();
    this.buildPanel();
  },

  // Push values into the live game objects
  apply() {
    const v = this.values;

    // The four "Player" sliders are the whole grid's car — applyCarStats is
    // what multiplies the engine class into them, for the opponents as well,
    // so the field stays as close in a 60cc race as in a 250cc one. Turn
    // speed and grip are not scaled by class — see engineClass.js.
    applyCarStats(car);
    opponents.forEach((ai) => {
      applyCarStats(ai);
      ai.rollDriver();
    });

    // StartLights
    StartLights.interval = v.countdownInterval;
    StartLights.goDisplayTime = v.countdownGoTime;

    // Spawn positions
    SPAWN_POSITIONS.forEach((pos, i) => {
      const name = i === 0 ? "Player" : `AI${i}`;
      pos.x = v[`spawn${name}X`];
      pos.y = v[`spawn${name}Y`];
    });

    // Render — resizeCanvas reads the cap back out of values, and reallocates
    // the backing store, so only call it when the number actually moved.
    if (v.maxDpr !== this._appliedMaxDpr) {
      // A hand-set cap takes the wheel off Quality for the session: the
      // governor quietly overriding the slider a second after you drag it
      // reads as the slider being broken. The first apply() of the session
      // is the saved value being restored, not a decision, so it doesn't count.
      if (this._appliedMaxDpr !== undefined) Quality.auto = false;
      this._appliedMaxDpr = v.maxDpr;
      resizeCanvas();
    }
  },

  toggle() {
    this.visible = !this.visible;
    const panel = document.getElementById("debug-config-panel");
    if (panel) panel.style.display = this.visible ? "block" : "none";
  },

  buildPanel() {
    let panel = document.getElementById("debug-config-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "debug-config-panel";
      document.body.appendChild(panel);
    }

    Object.assign(panel.style, {
      position: "fixed",
      top: "70px",
      right: "0",
      width: "370px",
      maxHeight: "calc(100vh - 80px)",
      overflowY: "auto",
      background: "rgba(0,0,0,0.88)",
      color: "#FFD700",
      fontFamily: "monospace",
      fontSize: "13px",
      padding: "12px",
      display: this.visible ? "block" : "none",
      zIndex: "9999",
      borderLeft: "2px solid #FFD700",
      boxSizing: "border-box",
    });

    panel.innerHTML = "";

    // Title
    const title = document.createElement("div");
    title.textContent = "CONFIG";
    Object.assign(title.style, {
      fontSize: "15px",
      fontWeight: "bold",
      marginBottom: "10px",
      borderBottom: "1px solid #FFD700",
      paddingBottom: "6px",
    });
    panel.appendChild(title);

    // Rows
    this.schema.forEach((item) => {
      if (item.group) {
        const header = document.createElement("div");
        header.textContent = item.group.toUpperCase();
        Object.assign(header.style, {
          marginTop: "12px",
          marginBottom: "4px",
          color: "#aaa",
          fontSize: "11px",
          letterSpacing: "0.08em",
        });
        panel.appendChild(header);
        return;
      }

      const row = document.createElement("div");
      Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        gap: "6px",
        marginBottom: "6px",
      });

      const label = document.createElement("span");
      label.textContent = item.label;
      Object.assign(label.style, { flex: "0 0 110px", color: "#ccc" });

      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = item.min;
      slider.max = item.max;
      slider.step = item.step;
      slider.value = this.values[item.key];
      Object.assign(slider.style, { flex: "1" });

      const input = document.createElement("input");
      input.type = "number";
      input.min = item.min;
      input.max = item.max;
      input.step = item.step;
      input.value = this.values[item.key];
      Object.assign(input.style, {
        width: "58px",
        background: "#111",
        color: "#FFD700",
        border: "1px solid #444",
        padding: "2px 4px",
        fontFamily: "monospace",
        fontSize: "12px",
      });

      const sync = (val) => {
        const clamped = Math.min(
          item.max,
          Math.max(item.min, parseFloat(val) || item.min),
        );
        this.values[item.key] = clamped;
        slider.value = clamped;
        input.value = clamped;
        this.save();
        this.apply();
      };

      slider.addEventListener("input", () => sync(slider.value));
      input.addEventListener("change", () => sync(input.value));

      row.appendChild(label);
      row.appendChild(slider);
      row.appendChild(input);
      panel.appendChild(row);
    });

    // Reset button
    const resetBtn = document.createElement("button");
    resetBtn.textContent = "Reset to defaults";
    Object.assign(resetBtn.style, {
      marginTop: "14px",
      width: "100%",
      padding: "6px",
      background: "#222",
      color: "#FF4444",
      border: "1px solid #FF4444",
      fontFamily: "monospace",
      fontSize: "13px",
      cursor: "pointer",
    });
    resetBtn.addEventListener("click", () => this.reset());
    panel.appendChild(resetBtn);
  },

  init() {
    this.ready = true;
    this.load();
    this.buildPanel();
    this.apply();
  },
};
