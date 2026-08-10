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
  "m",
  "M",
  "n",
  "N",
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
    this.bindings = { ...this.defaults };
    if (!saved) return;
    try {
      Object.assign(this.bindings, JSON.parse(saved));
    } catch {
      localStorage.removeItem("keyBindings");
    }
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

  // `size` carries the viewport in CSS pixels (the camera) — not the canvas
  // element, whose backing store is devicePixelRatio times larger. `mouse` is
  // the live pointer position, used for hover highlighting. Every clickable
  // region is recorded in this._hitAreas as it is drawn, so the hit boxes
  // always match what is on screen.
  draw(ctx, size, mouse = { x: -1, y: -1 }) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
    ctx.fillRect(0, 0, size.width, size.height);

    const cx = size.width / 2;

    this._hitAreas = [];
    const isHovered = (x, y, w, h) =>
      mouse.x >= x && mouse.x <= x + w && mouse.y >= y && mouse.y <= y + h;

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
      const hovered = isHovered(boxX, y, boxW, boxH);

      this._hitAreas.push({
        kind: "rebind",
        action: item.action,
        x: boxX,
        y,
        w: boxW,
        h: boxH,
      });

      // Row background
      ctx.fillStyle = isListening
        ? "rgba(255, 215, 0, 0.15)"
        : hovered
          ? "rgba(255, 215, 0, 0.08)"
          : "rgba(255, 255, 255, 0.05)";
      ctx.beginPath();
      ctx.roundRect(boxX, y, boxW, boxH, 8);
      ctx.fill();

      // Border
      ctx.strokeStyle = isListening
        ? "#FFD700"
        : hovered
          ? "rgba(255,215,0,0.5)"
          : "rgba(255,255,255,0.15)";
      ctx.lineWidth = isListening ? 2 : 1;
      ctx.stroke();

      // Action label
      ctx.textAlign = "left";
      ctx.fillStyle = isListening || hovered ? "#FFD700" : "#CCC";
      ctx.font = "18px 'Courier New'";
      ctx.fillText(item.label, boxX + 16, y + boxH / 2 + 6);

      // Key label
      ctx.textAlign = "right";
      ctx.fillStyle = isListening || hovered ? "#FFD700" : "white";
      ctx.font = isListening ? "bold 18px 'Courier New'" : "18px 'Courier New'";
      ctx.fillText(
        isListening ? "press a key..." : this.labelFor(item.action),
        boxX + boxW - 16,
        y + boxH / 2 + 6,
      );
    });

    // Instructions — the last two lines are also clickable buttons
    const bottomY = startY + actions.length * rowH + 40;
    ctx.textAlign = "center";
    ctx.font = "16px 'Courier New'";
    ctx.fillStyle = "#888";
    ctx.fillText(
      this.listening
        ? "Press a key, or CLICK the row again to cancel"
        : "CLICK or ENTER on a row to rebind",
      cx,
      bottomY,
    );

    const buttons = [
      { kind: "reset", text: "R — Reset to defaults", y: bottomY + 30 },
      { kind: "back", text: "ESC — Back to menu", y: bottomY + 60 },
    ];

    buttons.forEach((btn) => {
      const textW = ctx.measureText(btn.text).width;
      const w = textW + 32;
      const h = 28;
      const x = cx - w / 2;
      const y = btn.y - 20;
      const hovered = isHovered(x, y, w, h);

      this._hitAreas.push({ kind: btn.kind, x, y, w, h });

      if (hovered) {
        ctx.fillStyle = "rgba(255,215,0,0.12)";
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, 6);
        ctx.fill();
      }
      ctx.fillStyle = hovered ? "#FFD700" : "#888";
      ctx.fillText(btn.text, cx, btn.y);
    });

    if (this.lastRejected) {
      ctx.font = "15px 'Courier New'";
      ctx.fillStyle = "#FF4444";
      ctx.fillText(`⚠ ${this.lastRejected}`, cx, bottomY + 90);
    }

    canvas.style.cursor = this._hitAreas.some((a) =>
      isHovered(a.x, a.y, a.w, a.h),
    )
      ? "pointer"
      : "default";
  },

  // Returns "back" when the caller should leave the screen, otherwise null.
  handleClick(screenX, screenY) {
    const hit = (this._hitAreas || []).find(
      (a) =>
        screenX >= a.x &&
        screenX <= a.x + a.w &&
        screenY >= a.y &&
        screenY <= a.y + a.h,
    );

    // Clicking empty space abandons a pending rebind
    if (!hit) {
      this.listening = null;
      return null;
    }

    switch (hit.kind) {
      case "rebind":
        // Clicking the listening row again cancels instead of re-arming
        this.listening = this.listening === hit.action ? null : hit.action;
        this.lastRejected = null;
        return null;
      case "reset":
        this.reset();
        this.listening = null;
        this.lastRejected = null;
        return null;
      case "back":
        this.listening = null;
        return "back";
    }
    return null;
  },
};
