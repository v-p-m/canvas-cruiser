// ─────────────────────────────────────────────────────────────────────────────
// TrackEditor — tile-based map editor
//
// Activation:  DEBUG must be ON (B key), then press T to toggle
// Controls (in editor):
//   Left-click / drag  — paint selected tile
//   Right-click        — erase (set to grass, tile 0)
//   Mouse wheel        — scroll through tile palette
//   Arrow keys         — pan the camera (player car is frozen)
//   Z                  — undo last stroke
//   P                  — export updated track.json to console + download
//   T / ESC            — close editor
//
// Integration checklist (see bottom of this file for copy-paste snippets):
//   1. Add <script src="trackEditor.js"></script> after track.js in your HTML
//   2. In the keydown listener in game.js, add the T-key handler (snippet A)
//   3. In the gameLoop draw section, add the draw call (snippet B)
//   4. In the mousedown / mousemove / mouseup listeners, add forwarding (snippet C)
// ─────────────────────────────────────────────────────────────────────────────

const TrackEditor = (() => {
  // ── State ──────────────────────────────────────────────────────────────────
  let active = false;

  // Tile palette — (id, label, colour for swatch preview)
  const TILES = [
    { id: 0, label: "Grass", color: "#2d5a27" },
    { id: 1, label: "Wall", color: "#1a1a1a" },
    { id: 2, label: "Road", color: "#3a3a3a" },
    { id: 8, label: "Finish A", color: "#ffffff" },
    { id: 9, label: "Finish B", color: "#000000" },
  ];

  let selectedTileIndex = 2; // default: road

  // Undo stack — each entry is a snapshot of the whole map (simple & reliable)
  const undoStack = [];
  const MAX_UNDO = 40;

  // Paint session — tracks which cells were changed in the current drag so we
  // don't push duplicate undo entries for the same stroke
  let painting = false;
  let paintSession = null; // map snapshot taken at stroke start
  let paintedThisStroke = false;

  // Pan offset (independent of car camera while editor is open)
  let panX = 0;
  let panY = 0;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function mapSnapshot() {
    return worldTrack.data.map.map((row) => [...row]);
  }

  function pushUndo() {
    undoStack.push(mapSnapshot());
    if (undoStack.length > MAX_UNDO) undoStack.shift();
  }

  function screenToTile(sx, sy) {
    const wx = sx + panX;
    const wy = sy + panY;
    const tx = Math.floor(wx / worldTrack.data.tileSize);
    const ty = Math.floor(wy / worldTrack.data.tileSize);
    return { tx, ty };
  }

  function setTile(tx, ty, id) {
    const map = worldTrack.data.map;
    if (ty < 0 || ty >= map.length) return false;
    if (tx < 0 || tx >= map[ty].length) return false;
    if (map[ty][tx] === id) return false;
    map[ty][tx] = id;
    return true;
  }

  function rebakeTrack() {
    worldTrack.bake(); // re-render the baked canvas with new tiles
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  function toggle() {
    if (!DEBUG) return;
    active = !active;
    if (active) {
      // Snap pan to the current camera position
      panX = Math.max(0, Math.round(camera.x));
      panY = Math.max(0, Math.round(camera.y));
      console.log("[TrackEditor] ON — T or ESC to close");
    } else {
      console.log("[TrackEditor] OFF");
    }
  }

  function close() {
    active = false;
  }

  // ── Input handlers — call these from game.js ───────────────────────────────

  function handleKeyDown(e) {
    if (!active) return false;
    const key = e.key.toLowerCase();

    // Close
    if (key === "escape" || key === "t") {
      close();
      return true;
    }

    // Undo
    if (key === "z") {
      if (undoStack.length === 0) return true;
      worldTrack.data.map = undoStack.pop();
      rebakeTrack();
      return true;
    }

    // Export
    if (key === "p") {
      e.preventDefault();
      exportTrack();
      return true;
    }

    // Tile cycle via keyboard (Tab / Shift+Tab)
    if (key === "tab") {
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      selectedTileIndex =
        (selectedTileIndex + dir + TILES.length) % TILES.length;
      return true;
    }

    // Pan with arrow keys
    const PAN_STEP = worldTrack.data.tileSize;
    if (e.key === "ArrowLeft") {
      panX = Math.max(0, panX - PAN_STEP);
      return true;
    }
    if (e.key === "ArrowRight") {
      panX = Math.min(_maxPanX(), panX + PAN_STEP);
      return true;
    }
    if (e.key === "ArrowUp") {
      panY = Math.max(0, panY - PAN_STEP);
      return true;
    }
    if (e.key === "ArrowDown") {
      panY = Math.min(_maxPanY(), panY + PAN_STEP);
      return true;
    }

    return false; // not consumed
  }

  function handleWheel(e) {
    if (!active) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    selectedTileIndex = (selectedTileIndex + dir + TILES.length) % TILES.length;
  }

  function handleMouseDown(sx, sy, button) {
    if (!active) return;
    painting = true;
    paintedThisStroke = false;
    paintSession = mapSnapshot(); // snapshot before any paint in this stroke

    _paintAt(sx, sy, button);
  }

  function handleMouseMove(sx, sy, buttons) {
    if (!active || !painting) return;
    // buttons bitmask: 1 = LMB, 2 = RMB
    const btn = buttons & 2 ? 2 : 0;
    _paintAt(sx, sy, btn);
  }

  function handleMouseUp() {
    if (!active) return;
    if (paintedThisStroke && paintSession) {
      // Push the pre-stroke snapshot as the undo state
      undoStack.push(paintSession);
      if (undoStack.length > MAX_UNDO) undoStack.shift();
    }
    painting = false;
    paintSession = null;
    paintedThisStroke = false;
  }

  // ── Internal paint ─────────────────────────────────────────────────────────

  function _paintAt(sx, sy, button) {
    // Check if click is in the palette UI strip — don't paint if so
    if (_inPaletteUI(sx, sy)) {
      if (button === 0) _handlePaletteClick(sx, sy);
      return;
    }

    const tileId =
      button === 2
        ? 0 // right-click → erase (grass)
        : TILES[selectedTileIndex].id;

    const { tx, ty } = screenToTile(sx, sy);
    const changed = setTile(tx, ty, tileId);
    if (changed) {
      paintedThisStroke = true;
      rebakeTrack();
    }
  }

  // ── Palette UI ─────────────────────────────────────────────────────────────

  const PALETTE_H = 60;
  const SWATCH_W = 80;
  const SWATCH_PAD = 6;

  function _paletteY() {
    return canvas.height - PALETTE_H;
  }

  function _inPaletteUI(sx, sy) {
    return sy >= _paletteY();
  }

  function _handlePaletteClick(sx, sy) {
    const i = Math.floor(sx / (SWATCH_W + SWATCH_PAD));
    if (i >= 0 && i < TILES.length) selectedTileIndex = i;
  }

  function _maxPanX() {
    const worldW = worldTrack.data.map[0].length * worldTrack.data.tileSize;
    return Math.max(0, worldW - canvas.width);
  }

  function _maxPanY() {
    const worldH = worldTrack.data.map.length * worldTrack.data.tileSize;
    return Math.max(0, worldH - canvas.height);
  }

  // ── Draw ───────────────────────────────────────────────────────────────────

  function draw(ctx) {
    if (!active) return;

    // 1. Draw baked track from the editor's own pan offset (overrides camera)
    //    This is handled by the game loop via the `active` flag — see snippet B.

    // 2. Grid overlay
    _drawGrid(ctx);

    // 3. Cursor highlight
    _drawCursor(ctx);

    // 4. Palette bar
    _drawPalette(ctx);

    // 5. Status bar (top)
    _drawStatusBar(ctx);
  }

  function _drawGrid(ctx) {
    const ts = worldTrack.data.tileSize;
    const cols = worldTrack.data.map[0].length;
    const rows = worldTrack.data.map.length;

    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 0.5;

    // Vertical lines
    const startCol = Math.floor(panX / ts);
    const endCol = Math.ceil((panX + canvas.width) / ts);
    for (let c = startCol; c <= Math.min(endCol, cols); c++) {
      const sx = c * ts - panX;
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, canvas.height - PALETTE_H);
      ctx.stroke();
    }

    // Horizontal lines
    const startRow = Math.floor(panY / ts);
    const endRow = Math.ceil((panY + canvas.height) / ts);
    for (let r = startRow; r <= Math.min(endRow, rows); r++) {
      const sy = r * ts - panY;
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(canvas.width, sy);
      ctx.stroke();
    }

    ctx.restore();
  }

  function _drawCursor(ctx) {
    // Get current mouse position (stored in _mouse below)
    if (_mouse.x == null) return;
    if (_inPaletteUI(_mouse.x, _mouse.y)) return;

    const ts = worldTrack.data.tileSize;
    const { tx, ty } = screenToTile(_mouse.x, _mouse.y);
    const sx = tx * ts - panX;
    const sy = ty * ts - panY;

    ctx.save();
    ctx.strokeStyle = "rgba(255, 220, 0, 0.9)";
    ctx.lineWidth = 2;
    ctx.strokeRect(sx + 1, sy + 1, ts - 2, ts - 2);

    // Show tile id inside
    ctx.fillStyle = "rgba(255,220,0,0.85)";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${TILES[selectedTileIndex].id}`, sx + ts / 2, sy + ts / 2);

    ctx.restore();
  }

  function _drawPalette(ctx) {
    const py = _paletteY();

    // Background strip
    ctx.fillStyle = "rgba(0,0,0,0.82)";
    ctx.fillRect(0, py, canvas.width, PALETTE_H);

    TILES.forEach((tile, i) => {
      const x = i * (SWATCH_W + SWATCH_PAD) + SWATCH_PAD;
      const y = py + 8;
      const h = PALETTE_H - 16;
      const selected = i === selectedTileIndex;

      // Selection glow
      if (selected) {
        ctx.fillStyle = "#FFD700";
        ctx.fillRect(x - 2, y - 2, SWATCH_W + 4, h + 4);
      }

      // Swatch
      ctx.fillStyle = tile.color;
      ctx.fillRect(x, y, SWATCH_W, h);

      // Checkerboard for finish tiles
      if (tile.id === 8 || tile.id === 9) {
        const half = SWATCH_W / 2;
        const halfH = h / 2;
        ctx.fillStyle = tile.id === 8 ? "#000000" : "#ffffff";
        ctx.fillRect(x, y, half, halfH);
        ctx.fillRect(x + half, y + halfH, half, halfH);
      }

      // Label
      ctx.fillStyle = selected ? "#000" : "#fff";
      ctx.font = `${selected ? "bold " : ""}10px monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(tile.label, x + SWATCH_W / 2, py + PALETTE_H - 4);
    });

    // Right-side hint
    ctx.fillStyle = "#FFD700";
    ctx.font = "11px monospace";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(
      "RMB: erase  |  Wheel / Tab: cycle  |  Z: undo  |  P: export  |  T/ESC: close",
      canvas.width - 12,
      py + PALETTE_H / 2,
    );
  }

  function _drawStatusBar(ctx) {
    // Top banner
    ctx.fillStyle = "rgba(0,0,0,0.65)";
    ctx.fillRect(0, 0, canvas.width, 36);

    ctx.fillStyle = "#FFD700";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("✏  TRACK EDITOR", 14, 18);

    // Pan coords
    const ts = worldTrack.data.tileSize;
    ctx.fillStyle = "#aaa";
    ctx.font = "12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(
      `pan (${Math.floor(panX / ts)}, ${Math.floor(panY / ts)})  |  undo stack: ${undoStack.length}`,
      canvas.width / 2,
      18,
    );

    // Selected tile
    ctx.textAlign = "right";
    ctx.fillStyle = "#FFD700";
    ctx.fillText(
      `Tile: ${TILES[selectedTileIndex].label} [${TILES[selectedTileIndex].id}]`,
      canvas.width - 14,
      18,
    );
  }

  // ── Export ─────────────────────────────────────────────────────────────────

  function exportTrack() {
    const out = Object.assign({}, worldTrack.data, {
      map: worldTrack.data.map.map((row) => [...row]),
    });
    const json = JSON.stringify(out, null, 2);
    console.log("[TrackEditor] Export:\n", json);

    // Download
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "track.json";
    a.click();
    URL.revokeObjectURL(url);
    console.log("[TrackEditor] track.json downloaded.");
  }

  // ── Mouse position cache (for cursor rendering) ────────────────────────────
  const _mouse = { x: null, y: null };

  function _trackMouse(sx, sy) {
    _mouse.x = sx;
    _mouse.y = sy;
  }

  // ── Draw call for use inside the game loop ─────────────────────────────────
  // The game loop needs to render the track using panX/panY when the editor is
  // active instead of camera.x/camera.y.  The draw() call here handles the
  // overlay; the track itself is already rendered to worldTrack.bakedCanvas and
  // read in the game loop — see integration snippet B below.

  return {
    get active() {
      return active;
    },
    get panX() {
      return panX;
    },
    get panY() {
      return panY;
    },
    toggle,
    close,
    draw,
    handleKeyDown,
    handleWheel,
    handleMouseDown,
    handleMouseMove: (sx, sy, buttons) => {
      _trackMouse(sx, sy);
      handleMouseMove(sx, sy, buttons);
    },
    handleMouseUp,
    // Expose for the game loop so it can use the editor's pan instead of camera
    getViewOffset() {
      return active ? { x: panX, y: panY } : null;
    },
  };
})();
