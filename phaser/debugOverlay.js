// What is left of DEBUG on the game page.
//
// The legacy loop unlocked its tools with a key and kept them behind a menu
// row; those tools are on editor.html now, and what was actually reached for
// during the port was none of them. It was two questions asked over and over —
// what is this frame costing, and what is the field doing — so that is what
// this is, and it is a URL flag rather than a key: `?debug=1`. A flag cannot be
// left on by accident, cannot be persisted into a bad state, and is the one
// form the headless harness can set without synthesising input.
//
// It measures nothing itself. Quality already samples the frame interval every
// frame to drive the render scale, and a second timer next to it would be a
// second answer to the same question — see quality.js's header.

const DEBUG_PANEL_W = 260; // CSS px
const DEBUG_LINE_H = 15; // CSS px
const DEBUG_PANEL_X = 8; // CSS px
// Clears the HUD's own black bar. The panel drew over the lap counter and the
// position readout at the top left, which are the two things most worth
// reading beside it.
const DEBUG_PANEL_Y = 96; // CSS px

const DebugOverlay = {
  active: false,

  init() {
    this.active = new URLSearchParams(location.search).has("debug");
    return this.active;
  },

  // Called with the scene's own already-sorted standings, so the panel agrees
  // with the HUD's position readout rather than sorting the field a third time.
  draw(scene, standings) {
    if (!this.active) return;
    const ctx = UI.ctx;
    const lines = [];

    lines.push(Quality.status()); // gpu, dpr cap and the median frame interval
    lines.push(`render dpr ${renderDpr.toFixed(2)}  cars ${scene.cars.length}`);

    const conditions = [];
    if (Rain.intensity > 0) conditions.push(`rain ${Rain.intensity.toFixed(2)}`);
    if (Night.active) conditions.push(`night ${Night.liveryDim().toFixed(2)}`);
    lines.push(conditions.length ? conditions.join("  ") : "dry, day");

    const p = scene.player.entity;
    lines.push(
      `spd ${p.speed.toFixed(2)}/${p.maxSpeed.toFixed(2)}  ` +
        `road ${scene.world.sampleRoad(p.x, p.y).toFixed(2)}`,
    );

    // Impacts are the one system here whose *absence* looks exactly like a
    // quiet race, so the panel carries the running count and the hardest hit
    // rather than only what is happening this frame.
    lines.push(
      `hits ${Impacts.count} (max ${Impacts.hardest.toFixed(1)})  ` +
        `spin ${p.spin.toFixed(3)}  uns ${p.unsettle.toFixed(2)}`,
    );
    // Wing condition is the slowest-moving state on the car and the only one
    // that never comes back, so the raw numbers go here: the two conditions,
    // and the mods damage.js rewrote when one of them hit zero. The pair is
    // what says the stats went with the artwork rather than only the sprite
    // changing — and, going the other way, that wear short of a break is
    // deliberately *not* moving the stats.
    lines.push(
      `wings F${p.wings.front.toFixed(2)} R${p.wings.rear.toFixed(2)} ` +
        `${Damage.wingKey(p)} (${Damage.breaks} off)  ` +
        `t×${p.mods.turn.toFixed(2)} g×${p.mods.grip.toFixed(2)}`,
    );

    // The field by position, with the number that actually settles an AI
    // change: each car's last lap. `skill` rides along because a slow rival is
    // supposed to be a slower *driver* — if a lap looks wrong, this is the
    // column that says whether the roll or the line is what moved.
    lines.push("");
    standings.forEach((s) => {
      const e = s.entity;
      const lap = e.lastLapTime ? `${e.lastLapTime.toFixed(2)}s` : "—";
      const who = s.isPlayer ? "YOU" : `AI ${e.skill.toFixed(2)}`;
      lines.push(`${s.position}. ${who.padEnd(9)} L${e.laps}  ${lap}`);
    });

    const x = DEBUG_PANEL_X;
    const y = DEBUG_PANEL_Y;
    const h = lines.length * DEBUG_LINE_H + 16;

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(x, y, DEBUG_PANEL_W, h);
    ctx.strokeStyle = "rgba(255,215,0,0.4)";
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, DEBUG_PANEL_W - 1, h - 1);

    ctx.font = "12px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = "#FFD700";
    lines.forEach((line, i) => {
      ctx.fillText(line, x + 8, y + 8 + i * DEBUG_LINE_H);
    });
    ctx.restore();
  },
};
