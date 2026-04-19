// debugConfig.js

const DebugConfig = {
  visible: false,

  defaults: {
    // Player
    playerAcceleration: 0.2,
    playerMaxSpeed: 10,
    playerTurnSpeed: 0.06,
    playerDriftGrip: 0.1,

    // AI
    aiMaxSpeedMin: 7.5,
    aiMaxSpeedMax: 9.0,
    aiTurnSpeed: 0.08,
    aiGrip: 0.15,
    aiLineOffsetRange: 40,
    aiRepulsionRadius: 120,
    aiRepulsionForce: 0.3,

    // Collision
    collisionHalfW: 1.0, // multiplier of car.width
    collisionHalfH: 1.0, // multiplier of car.height
    collisionNudge: 0.4,
    collisionHardImpact: 3.0,

    // Race
    countdownInterval: 1000,
    countdownGoTime: 400,

    // Spawn
    spawnPlayerX: 550,
    spawnPlayerY: 200,
    spawnAI1X: 400,
    spawnAI1Y: 200,
    spawnAI2X: 475,
    spawnAI2Y: 275,
    spawnAI3X: 400,
    spawnAI3Y: 275,
    spawnAI4X: 550,
    spawnAI4Y: 350,
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
    { key: "aiMaxSpeedMin", label: "Speed min", min: 2, max: 15, step: 0.5 },
    { key: "aiMaxSpeedMax", label: "Speed max", min: 2, max: 15, step: 0.5 },
    {
      key: "aiTurnSpeed",
      label: "Turn speed",
      min: 0.01,
      max: 0.2,
      step: 0.005,
    },
    { key: "aiGrip", label: "Grip", min: 0.01, max: 1.0, step: 0.01 },
    {
      key: "aiLineOffsetRange",
      label: "Line offset",
      min: 0,
      max: 100,
      step: 1,
    },
    {
      key: "aiRepulsionRadius",
      label: "Repulsion radius",
      min: 0,
      max: 300,
      step: 5,
    },
    {
      key: "aiRepulsionForce",
      label: "Repulsion force",
      min: 0,
      max: 2.0,
      step: 0.05,
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
    { group: "Spawn positions" },
    { key: "spawnPlayerX", label: "Player X", min: 0, max: 2048, step: 5 },
    { key: "spawnPlayerY", label: "Player Y", min: 0, max: 2048, step: 5 },
    { key: "spawnAI1X", label: "AI 1 X", min: 0, max: 2048, step: 5 },
    { key: "spawnAI1Y", label: "AI 1 Y", min: 0, max: 2048, step: 5 },
    { key: "spawnAI2X", label: "AI 2 X", min: 0, max: 2048, step: 5 },
    { key: "spawnAI2Y", label: "AI 2 Y", min: 0, max: 2048, step: 5 },
    { key: "spawnAI3X", label: "AI 3 X", min: 0, max: 2048, step: 5 },
    { key: "spawnAI3Y", label: "AI 3 Y", min: 0, max: 2048, step: 5 },
    { key: "spawnAI4X", label: "AI 4 X", min: 0, max: 2048, step: 5 },
    { key: "spawnAI4Y", label: "AI 4 Y", min: 0, max: 2048, step: 5 },
  ],

  values: {},

  load() {
    const saved = localStorage.getItem("debugConfig");
    this.values = saved
      ? { ...this.defaults, ...JSON.parse(saved) }
      : { ...this.defaults };
  },

  save() {
    localStorage.setItem("debugConfig", JSON.stringify(this.values));
  },

  reset() {
    this.values = { ...this.defaults };
    localStorage.removeItem("debugConfig");
    this.apply();
    this.buildPanel();
  },

  // Push values into the live game objects
  apply() {
    const v = this.values;

    // Player
    car.acceleration = v.playerAcceleration;
    car.maxSpeed = v.playerMaxSpeed;
    car.turnSpeed = v.playerTurnSpeed;
    car.driftGrip = v.playerDriftGrip;

    // AI
    opponents.forEach((ai) => {
      ai.basMaxSpeed =
        v.aiMaxSpeedMin + Math.random() * (v.aiMaxSpeedMax - v.aiMaxSpeedMin);
      ai.randomiseLapSpeed(); // re-apply variation from new base
      ai.turnSpeed = v.aiTurnSpeed;
      ai.grip = v.aiGrip;
      ai.lineOffset = (Math.random() - 0.5) * v.aiLineOffsetRange;
    });

    // StartLights
    StartLights.interval = v.countdownInterval;
    StartLights.goDisplayTime = v.countdownGoTime;

    // Spawn positions
    SPAWN_POSITIONS[0].x = v.spawnPlayerX;
    SPAWN_POSITIONS[0].y = v.spawnPlayerY;
    SPAWN_POSITIONS[1].x = v.spawnAI1X;
    SPAWN_POSITIONS[1].y = v.spawnAI1Y;
    SPAWN_POSITIONS[2].x = v.spawnAI2X;
    SPAWN_POSITIONS[2].y = v.spawnAI2Y;
    SPAWN_POSITIONS[3].x = v.spawnAI3X;
    SPAWN_POSITIONS[3].y = v.spawnAI3Y;
    SPAWN_POSITIONS[4].x = v.spawnAI4X;
    SPAWN_POSITIONS[4].y = v.spawnAI4Y;
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
    this.load();
    this.buildPanel();
    this.apply();
  },
};
