// keyBindings.js

const BLACKLISTED_KEYS = [
  "Escape",
  "Enter",
  " ",
  "q",
  "Q",
  "b",
  "B",
  "r",
  "R",
  "c",
  "C",
  "e",
  "E",
  "z",
  "Z",
  "f2",
  "F2",
];

const KeyBindings = {
  defaults: {
    accelerate: "ArrowUp",
    brake: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
  },

  bindings: {},
  listening: null, // which action is waiting for a key

  load() {
    const saved = localStorage.getItem("keyBindings");
    this.bindings = saved
      ? { ...this.defaults, ...JSON.parse(saved) }
      : { ...this.defaults };
  },

  save() {
    localStorage.setItem("keyBindings", JSON.stringify(this.bindings));
  },

  reset() {
    this.bindings = { ...this.defaults };
    localStorage.removeItem("keyBindings");
  },

  // Returns true if the given e.key matches the action
  is(action, key) {
    return this.bindings[action] === key;
  },

  // Start listening for a new key for this action
  startListening(action) {
    this.listening = action;
  },

  // Call from keydown — returns true if it consumed the event
  handleRebind(key) {
    if (!this.listening) return false;

    // Reject blacklisted keys
    if (BLACKLISTED_KEYS.includes(key)) {
      this.lastRejected = `"${key}" is reserved`;
      return true;
    }

    const conflict = Object.entries(this.bindings).find(
      ([action, k]) => k === key && action !== this.listening,
    );
    if (conflict) {
      this.lastRejected = `"${key}" already bound to ${conflict[0]}`;
      return true;
    }

    this.bindings[this.listening] = key;
    this.lastRejected = null;
    this.listening = null;
    this.save();
    return true;
  },

  labelFor(action) {
    const key = this.bindings[action];
    // Pretty print arrow keys
    const labels = {
      ArrowUp: "↑",
      ArrowDown: "↓",
      ArrowLeft: "←",
      ArrowRight: "→",
    };
    return labels[key] || key;
  },

  draw(ctx, canvas) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const cx = canvas.width / 2;

    ctx.textAlign = "center";
    ctx.fillStyle = "#FFD700";
    ctx.font = "bold 40px 'Courier New'";
    ctx.fillText("🎮 KEY BINDINGS 🎮", cx, 130);

    const actions = [
      { action: "accelerate", label: "Accelerate" },
      { action: "brake", label: "Brake / Reverse" },
      { action: "left", label: "Steer Left" },
      { action: "right", label: "Steer Right" },
    ];

    const startY = 220;
    const rowH = 70;
    const boxW = 400;
    const boxH = 48;
    const boxX = cx - boxW / 2;

    actions.forEach((item, i) => {
      const y = startY + i * rowH;
      const isListening = this.listening === item.action;
      const isConflict = false;

      // Row background
      ctx.fillStyle = isListening
        ? "rgba(255, 215, 0, 0.15)"
        : "rgba(255, 255, 255, 0.05)";
      ctx.beginPath();
      ctx.roundRect(boxX, y, boxW, boxH, 8);
      ctx.fill();

      // Border
      ctx.strokeStyle = isListening ? "#FFD700" : "rgba(255,255,255,0.15)";
      ctx.lineWidth = isListening ? 2 : 1;
      ctx.stroke();

      // Action label
      ctx.textAlign = "left";
      ctx.fillStyle = isListening ? "#FFD700" : "#CCC";
      ctx.font = "18px 'Courier New'";
      ctx.fillText(item.label, boxX + 16, y + boxH / 2 + 6);

      // Key label
      ctx.textAlign = "right";
      ctx.fillStyle = isListening ? "#FFD700" : "white";
      ctx.font = isListening ? "bold 18px 'Courier New'" : "18px 'Courier New'";
      ctx.fillText(
        isListening ? "press a key..." : this.labelFor(item.action),
        boxX + boxW - 16,
        y + boxH / 2 + 6,
      );
    });

    // Instructions
    const bottomY = startY + actions.length * rowH + 40;
    ctx.textAlign = "center";
    ctx.font = "16px 'Courier New'";
    ctx.fillStyle = "#888";
    ctx.fillText("CLICK or ENTER on a row to rebind", cx, bottomY);
    ctx.fillText("R — Reset to defaults", cx, bottomY + 30);
    ctx.fillText("ESC — Back to menu", cx, bottomY + 60);

    // Store row positions for click detection
    this._rows = actions.map((item, i) => ({
      action: item.action,
      y: startY + i * rowH,
      h: boxH,
      x: boxX,
      w: boxW,
    }));

    if (this.lastRejected) {
      ctx.font = "15px 'Courier New'";
      ctx.fillStyle = "#FF4444";
      ctx.fillText(`⚠ ${this.lastRejected}`, cx, bottomY + 90);
    }
  },

  handleClick(screenX, screenY) {
    if (!this._rows) return;
    for (const row of this._rows) {
      if (
        screenX >= row.x &&
        screenX <= row.x + row.w &&
        screenY >= row.y &&
        screenY <= row.y + row.h
      ) {
        this.startListening(row.action);
        return;
      }
    }
  },
};
