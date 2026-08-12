// The credits modal, ported off screens.js's drawCredits/handleCreditsClick/
// wrapNames/scrollCredits (screens.js:422-644). A modal over the menu, not a
// screen of its own — MenuScene keeps drawing the menu underneath (dimmed by
// its own backdrop already) and layers this on top, exactly as
// `isCredits`/`isMenu` coexist in the legacy loop.
const CREDITS_PANEL_W = 480;
const CREDITS_ROLE_H = 22;
const CREDITS_NAME_H = 28;
const CREDITS_SECTION_GAP = 20;
const CREDITS_MARGIN = 30;
const CREDITS_HEAD_H = 96;
const CREDITS_FOOT_H = 96;
const CREDITS_LEAD = 20;

const CreditsScreen = {
  hitAreas: [],
  panel: null, // { x, y, w, h } of the modal frame, for click-away dismissal
  scroll: 0, // px the name list is scrolled down by

  reset() {
    this.scroll = 0;
  },

  scrollBy(dy) {
    this.scroll += dy;
  },

  // Breaks a section's names into lines that fit maxW, keeping each name
  // whole — wrapping mid-name would read as two people.
  wrapNames(names, maxW) {
    const ctx = UI.ctx;
    const lines = [];
    let line = "";
    names.forEach((name, i) => {
      const piece = i < names.length - 1 ? `${name},` : name;
      const merged = line ? `${line} ${piece}` : piece;
      if (line && ctx.measureText(merged).width > maxW) {
        lines.push(line);
        line = piece;
      } else {
        line = merged;
      }
    });
    if (line) lines.push(line);
    return lines;
  },

  draw() {
    const ctx = UI.ctx;
    this.hitAreas = [];

    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(0, 0, UI.width, UI.height);

    const w = Math.min(CREDITS_PANEL_W, UI.width - 2 * CREDITS_MARGIN);
    const cx = UI.width / 2;

    const textW = w - 48;
    ctx.font = "bold 20px 'Courier New'";
    const lines = [];
    Credits.sections.forEach((section, i) => {
      if (i > 0) lines.push({ kind: "gap", h: CREDITS_SECTION_GAP });
      lines.push({ kind: "role", text: section.role.toUpperCase(), h: CREDITS_ROLE_H });
      this.wrapNames(section.names, textW).forEach((text) =>
        lines.push({ kind: "name", text, h: CREDITS_NAME_H }),
      );
    });

    const contentH = lines.reduce((sum, l) => sum + l.h, CREDITS_LEAD);
    const fullH = CREDITS_HEAD_H + contentH + CREDITS_FOOT_H;
    const h = Math.min(fullH, UI.height - 2 * CREDITS_MARGIN);
    const x = (UI.width - w) / 2;
    const y = (UI.height - h) / 2;
    this.panel = { x, y, w, h };

    const bodyTop = y + CREDITS_HEAD_H - CREDITS_LEAD;
    const bodyBottom = y + h - CREDITS_FOOT_H;
    const viewH = Math.max(0, bodyBottom - bodyTop);

    const maxScroll = Math.max(0, contentH - viewH);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = 30;
    ctx.fillStyle = "rgba(14, 14, 20, 0.97)";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 14);
    ctx.fill();
    ctx.restore();

    ctx.strokeStyle = "#FFD700";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 14);
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#FFD700";
    ctx.font = "bold 30px 'Courier New'";
    ctx.fillText("CREDITS", cx, y + 52);

    ctx.strokeStyle = "rgba(255,215,0,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 40, y + 74);
    ctx.lineTo(x + w - 40, y + 74);
    ctx.stroke();

    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, bodyTop, w - 2, viewH);
    ctx.clip();

    let ty = bodyTop + CREDITS_LEAD - this.scroll;
    lines.forEach((line) => {
      if (line.kind === "role") {
        ctx.fillStyle = "#777";
        ctx.font = "14px 'Courier New'";
        ctx.fillText(line.text, cx, ty);
      } else if (line.kind === "name") {
        ctx.fillStyle = "#FFF";
        ctx.font = "bold 20px 'Courier New'";
        ctx.fillText(line.text, cx, ty + 18);
      }
      ty += line.h;
    });
    ctx.restore();

    const fade = (top) => {
      const gy = top ? bodyTop : bodyBottom;
      const g = ctx.createLinearGradient(0, gy, 0, gy + (top ? 22 : -22));
      g.addColorStop(0, "rgba(14, 14, 20, 0.97)");
      g.addColorStop(1, "rgba(14, 14, 20, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(x + 1, top ? gy : gy - 22, w - 2, 22);
    };
    if (this.scroll > 0) fade(true);
    if (this.scroll < maxScroll) fade(false);

    if (maxScroll > 0) {
      const trackH = viewH - 8;
      const thumbH = Math.max(24, trackH * (viewH / contentH));
      const thumbY = bodyTop + 4 + (trackH - thumbH) * (this.scroll / maxScroll);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(x + w - 12, bodyTop + 4, 4, trackH);
      ctx.fillStyle = "rgba(255,215,0,0.45)";
      ctx.fillRect(x + w - 12, thumbY, 4, thumbH);
    }

    const footTop = y + h - CREDITS_FOOT_H;
    ctx.fillStyle = "#666";
    ctx.font = "14px 'Courier New'";
    ctx.fillText(Credits.footer, cx, footTop + 26);
    ctx.fillText("v" + window.BUILD, cx, footTop + 46);

    const closeSize = 26;
    const closeX = x + w - closeSize - 14;
    const closeY = y + 14;
    const closeHot = isHovered(closeX, closeY, closeSize, closeSize);
    this.hitAreas.push({ x: closeX, y: closeY, w: closeSize, h: closeSize, action: "close" });

    if (closeHot) {
      ctx.fillStyle = "rgba(255,215,0,0.15)";
      ctx.beginPath();
      ctx.roundRect(closeX, closeY, closeSize, closeSize, 6);
      ctx.fill();
    }
    ctx.fillStyle = closeHot ? "#FFD700" : "#888";
    ctx.font = "bold 20px 'Courier New'";
    ctx.textBaseline = "middle";
    ctx.fillText("×", closeX + closeSize / 2, closeY + closeSize / 2 + 1);
    ctx.textBaseline = "alphabetic";

    const label = "ESC — Close";
    ctx.font = "18px 'Courier New'";
    const bw = ctx.measureText(label).width + 32;
    const bh = 30;
    const bx = cx - bw / 2;
    const by = y + h - 48;
    const bHot = isHovered(bx, by, bw, bh);
    this.hitAreas.push({ x: bx, y: by, w: bw, h: bh, action: "close" });

    if (bHot) {
      ctx.fillStyle = "rgba(255,215,0,0.12)";
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 6);
      ctx.fill();
    }
    ctx.fillStyle = bHot ? "#FFD700" : "#AAA";
    ctx.fillText(label, cx, by + 21);

    UI.canvas.style.cursor = this.hitAreas.some((a) => isHovered(a.x, a.y, a.w, a.h))
      ? "pointer"
      : "default";
  },

  // `onClose` is called both for a hit on the × / footer button and for a
  // click that lands off the panel — a click landing on the panel itself is
  // swallowed, or dragging a selection across the names would close it.
  handleClick(onClose, x, y) {
    const hit = hitTest(this.hitAreas, x, y);
    if (hit) {
      if (hit.action === "close") onClose();
      return;
    }
    const p = this.panel;
    const onPanel = p && x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h;
    if (!onPanel) onClose();
  },
};
