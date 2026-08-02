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
| [game.js](game.js) | Game state, input, physics, collisions, lap counting, race order, the single `gameLoop`. Everything not owned by a file below lives here. |
| [screens.js](screens.js) | Every pixel of canvas UI: start menu, HUD, minimap, records, results — plus the hit-testing that makes them clickable. |
| [rain.js](rain.js) | Weather: drop pool, puddles, screen tint. Exposes `gripScale()`/`frictionBonus()`; it must never assign to `car.driftGrip` etc. directly or it overwrites the tuning sliders. |
| [sound.js](sound.js) | WebAudio, synthesised — engine, tire squeal, impacts. No audio files. `Sound.unlock()` must be called from a user gesture or nothing plays. |
| [quality.js](quality.js) | Render-scale governor. Probes WebGL for a software rasteriser before the first frame, then watches the frame interval and moves the dpr cap down a ladder. Owns `Quality.cap`; `resizeCanvas()` in `game.js` is what reads it. |
| [track.js](track.js) | `Track` class. Loads `track.json` (tile grid), rasterises + blurs it into a "road field"; both the baked artwork and the physics sample that one field, so visuals and collision can't disagree. |
| [ai.js](ai.js) | Opponent waypoint following, corner braking, mutual repulsion. Laps and race position are *not* here — `updateLapCounter` in `game.js` drives the player and every opponent through the same code. |
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
symlinks.

**Headless Chrome only services three or four real `requestAnimationFrame`
callbacks and then stops**, so the game loop dies a few frames in and the
countdown never finishes — you get a menu screenshot no matter how large the
budget is. Virtual time *does* keep driving `setTimeout`, so pump the loop off
timers instead, then hand back to the real `rAF` shortly before the capture, or
the compositor never produces a frame and the screenshot comes out blank:

```bash
S=/tmp/cc-harness; mkdir -p $S
ln -sfn /home/demac/dev/github/v-p-m/canvas-cruiser/* $S/
python3 - <<'PY'
html = open('/home/demac/dev/github/v-p-m/canvas-cruiser/index.html').read()
inject = '''
<script>
const realRaf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) => setTimeout(() => {
  try { cb(performance.now()); } catch (e) { console.log("THROW", e.message, e.stack); }
}, 16);
setTimeout(() => { window.requestAnimationFrame = realRaf; }, 11500);  // budget - 500

const k=(t,key)=>setTimeout(()=>window.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true})),t);
k(200,"ArrowDown"); k(400,"Enter");           // pick 5 Lap Race, start
setTimeout(()=>{ keys["ArrowUp"]=true; }, 4200);   // hold the throttle
</script></body>'''
open('/tmp/cc-harness/drive.html','w').write(html.replace('</body>', inject))
PY
python3 -m http.server 8124 -d $S &
chromium-browser --headless --no-sandbox --disable-gpu --window-size=1280,800 \
  --virtual-time-budget=12000 --screenshot=/tmp/drive.png http://localhost:8124/drive.html
```

Setting `keys[...]` directly is more reliable than synthesising `keydown` for
held inputs. Wrapping the loop in `try/catch` as above is worth keeping: an
exception inside `gameLoop` kills the loop silently, and headless does not
surface it through `window.onerror`.

Add keys to taste: `B` debug HUD, then (DEBUG only) `C` tuning sliders, `T`
track editor, `E` waypoint editor; `Q` records, `M` mute, `R` reset, `Escape`
back to menu. A lap takes ~13s of virtual time, so budget accordingly.

Everything is drawn in **CSS pixels**: `resizeCanvas()` scales the context by
`devicePixelRatio` and `camera.width`/`camera.height` are the viewport. Never
read `canvas.width`/`canvas.height` for layout — that is the backing store, and
it is `dpr` times larger. Test HiDPI with `--force-device-scale-factor=2`.

**Set `Quality.auto = false` in any harness that measures frame cost.** Headless
with `--disable-gpu` reports SwiftShader, so `quality.js` starts the page at dpr
1 and will keep moving the render scale mid-run — an A/B where one side silently
changed resolution is worse than no measurement. Turning it off pins whatever
`MAX_DPR` and the `C` panel say. `Quality.status()` reports what it decided and
why; the `B` overlay shows the same line, in red when the raster is software.

## Conventions

- Comments explain *why* a technique was chosen (see the header block in
  `track.js`), not what the line does. Match that density — most code carries none.
- Tunable constants go at the top of their file in `SCREAMING_CASE`, with the
  unit in a trailing comment (`// cells`, `// world px`).
- Bump `GAME_VERSION` at the top of `game.js` for user-visible releases; it
  feeds the window title and the menu.
- Keys added to game logic that must not be remappable belong in
  `BLACKLISTED_KEYS` in `keyBindings.js`.
- The player and the AI are meant to be interchangeable to the race code: both
  carry `laps` / `onFinishLine` / `finished` / `finishPosition` / `raceStart`,
  and both go through `updateLapCounter` and `wheelOffRoad`. Adding a rule for
  one and not the other is how the opponents stopped being real competitors in
  the first place.
