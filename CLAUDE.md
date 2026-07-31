# Canvas Cruiser — notes for Claude

Top-down arcade racer. Pure HTML5 Canvas + vanilla JS. **No build step, no
package.json, no dependencies, no test suite.** Editing a `.js` file and
reloading the page is the whole dev loop.

## Layout

Scripts are plain `<script>` tags in [index.html](index.html) — everything is a
global, and **load order matters** (`track.js` → editors → `ai.js` → helpers →
`game.js` last). There are no modules; don't add `import`/`export` without
converting the page to `type="module"`.

| File | Role |
|---|---|
| [game.js](game.js) | Game state, input, physics, collisions, menus, HUD, the single `gameLoop`. Everything not owned by a file below lives here. |
| [track.js](track.js) | `Track` class. Loads `track.json` (tile grid), rasterises + blurs it into a "road field"; both the baked artwork and the physics sample that one field, so visuals and collision can't disagree. |
| [ai.js](ai.js) | Opponent waypoint following, corner braking, mutual repulsion. |
| [trackEditor.js](trackEditor.js) | Tile map editor. DEBUG on (`B`), then `T`. `P` exports `track.json`. |
| [waypointEditor.js](waypointEditor.js) | Drag AI waypoints. DEBUG on, then `E`. |
| [debugConfig.js](debugConfig.js) | Live tuning sliders (physics, AI, spawn grid) persisted to localStorage. `spawnVersion` must be bumped when the built-in grid in `game.js` changes, or a stale saved copy overrides it. |
| [debugHUD.js](debugHUD.js), [startLights.js](startLights.js), [keyBindings.js](keyBindings.js) | Debug overlay, countdown lights, remappable controls. |

State that survives reloads lives in localStorage: `highScores`,
`bestTotalTimes`, key bindings, debug config. Parsing is defensive — bad JSON is
dropped, not trusted; keep it that way when adding keys.

## Running it

`track.json` is loaded with `fetch()`, so **`file://` does not work** — serve it:

```bash
python3 -m http.server 8123 -d /home/demac/dev/github/v-p-m/canvas-cruiser
# then open http://localhost:8123/
```

## Testing changes headlessly

`chromium-browser --headless` is installed and is the way to verify a visual or
runtime change without asking the user to click around. Screenshots are worth
reading — this is a rendering-heavy project and most bugs are visible.

Screenshot the start menu:

```bash
chromium-browser --headless --no-sandbox --disable-gpu \
  --window-size=1280,800 --virtual-time-budget=4000 \
  --screenshot=/tmp/shot.png http://localhost:8123/
```

Catch JS errors (nothing prints for a clean load):

```bash
chromium-browser --headless --no-sandbox --disable-gpu \
  --virtual-time-budget=5000 --enable-logging=stderr --v=0 --dump-dom \
  http://localhost:8123/ 2>&1 >/dev/null | grep -i CONSOLE
```

To see the race itself (not just the menu), you have to drive the game with
synthetic input. `game.js` listens on **`window`**, so events must be dispatched
on `window` (or with `bubbles: true`) — `document.dispatchEvent` is silently
ignored. Don't add a harness file to the repo; build one in the scratchpad from
symlinks:

```bash
S=/tmp/cc-harness; mkdir -p $S
ln -sfn /home/demac/dev/github/v-p-m/canvas-cruiser/* $S/
sed 's|</body>|<script>const k=(t,key)=>setTimeout(()=>window.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true})),t);k(300,"Enter");k(600,"ArrowUp");</script></body>|' \
  /home/demac/dev/github/v-p-m/canvas-cruiser/index.html > $S/drive.html
python3 -m http.server 8124 -d $S &
chromium-browser --headless --no-sandbox --disable-gpu --window-size=1280,800 \
  --virtual-time-budget=9000 --screenshot=/tmp/drive.png http://localhost:8124/drive.html
```

Add keys to taste: `B` debug HUD, then (DEBUG only) `C` tuning sliders, `T`
track editor, `E` waypoint editor; `Q` records, `R` reset, `Escape` back to menu. `--virtual-time-budget` fast-forwards
timers, so a few thousand ms of budget covers the 3-second countdown quickly;
raise it to reach later laps.

## Conventions

- Comments explain *why* a technique was chosen (see the header block in
  `track.js`), not what the line does. Match that density — most code carries none.
- Tunable constants go at the top of their file in `SCREAMING_CASE`, with the
  unit in a trailing comment (`// cells`, `// world px`).
- Bump `GAME_VERSION` at the top of `game.js` for user-visible releases; it
  feeds the window title and the menu.
- Keys added to game logic that must not be remappable belong in
  `BLACKLISTED_KEYS` in `keyBindings.js`.
