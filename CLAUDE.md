# Canvas Cruiser — notes for Claude

Top-down arcade racer. Pure HTML5 Canvas + vanilla JS. **No build step, no
package.json, no dependencies, no test suite.** Editing a `.js` file and
reloading the page is the whole dev loop.

## Layout

Scripts are plain `<script>` tags in [index.html](index.html) — everything is a
global, and **load order matters** (`track.js` → editors → `carSprites.js` →
`ai.js` → helpers → `game.js` last). There are no modules; don't add `import`/`export` without
converting the page to `type="module"`.

| File | Role |
|---|---|
| [game.js](game.js) | Game state, input, physics, collisions, lap counting, race order, the single `gameLoop`. Everything not owned by a file below lives here. Laps and standings both run on `trackProgress()` — see [Laying out a track](#laying-out-a-track). |
| [screens.js](screens.js) | Every pixel of canvas UI: start menu, HUD, minimap, records, results, the credits popup — plus the hit-testing that makes them clickable. The credits roll is data, not code: it is fetched from `credits.json` (built-in fallback if that 404s or is malformed), wrapped to the panel width and scrolled if it outgrows the window. |
| [rain.js](rain.js) | Weather: drop pool, puddles, screen tint. Exposes `gripScale()`/`frictionBonus()`; it must never assign to `car.driftGrip` etc. directly or it overwrites the tuning sliders. |
| [sound.js](sound.js) | WebAudio, synthesised — engine, tire squeal, impacts. No audio files. `Sound.unlock()` must be called from a user gesture or nothing plays. |
| [quality.js](quality.js) | Render-scale governor. Probes WebGL for a software rasteriser before the first frame, then watches the frame interval and moves the dpr cap down a ladder. Owns `Quality.cap`; `resizeCanvas()` in `game.js` is what reads it. |
| [track.js](track.js) | `Track` class. Loads a track file (tile grid), rasterises + blurs it into a "road field"; both the baked artwork and the physics sample that one field, so visuals and collision can't disagree. One instance, `worldTrack`, reloaded in place when the circuit changes. |
| [carSprites.js](carSprites.js) | The one open-wheel car, as a pixel grid baked to a canvas per livery — no PNGs. Body colour is substituted at bake time and its shade/highlight derived, so a new rival is just a hex. Bakes in device pixels; `resizeCanvas()` must call `CarSprites.invalidate()` when the render scale moves. |
| [ai.js](ai.js) | Opponent waypoint following, corner braking, mutual repulsion. Laps and race position are *not* here — `updateLapCounter` in `game.js` drives the player and every opponent through the same code. |
| [trackEditor.js](trackEditor.js) | Tile map editor. DEBUG on (`B`), then `T`. `P` exports the loaded track back out under its own filename. |
| [waypointEditor.js](waypointEditor.js) | Drag AI waypoints. DEBUG on, then `E`. |
| [debugConfig.js](debugConfig.js) | Live tuning sliders (physics, AI, spawn grid) persisted to localStorage. `spawnVersion` must be bumped when a shipped starting grid changes, or a stale saved copy overrides it; the saved copy is keyed by track as well, since the grids are per circuit. |
| [debugHUD.js](debugHUD.js), [startLights.js](startLights.js), [keyBindings.js](keyBindings.js) | Debug overlay, countdown lights, remappable controls. |

State that survives reloads lives in localStorage: `highScores`,
`bestTotalTimes`, the chosen `track`, key bindings, debug config. Parsing is
defensive — bad JSON is dropped, not trusted; keep it that way when adding keys.
`highScores` and `bestTotalTimes` are keyed by track id and still accept the
flat pre-two-track shapes, which are read as the first circuit's.

## Running it

The track files are loaded with `fetch()`, so **`file://` does not work** — serve them:

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
k(100,"ArrowRight");                          // second circuit (LEFT/RIGHT)
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

Picking a circuit is a fetch and a bake, so give it a beat before ENTER —
`startSelectedMode()` ignores the key while one is loading.

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

## Adding a track

One file per circuit in [tracks/](tracks/), carrying its tile `map`, its
`waypoints` and its `spawn` grid.

- **Every track is 40×28 tiles** (2560×1792). The camera, the minimap and the
  skid layer all size themselves off the map, so circuits of different extents
  changed how much road you could see at once. A layout that doesn't fill it is
  centred and padded with terrain rather than stretched — Super Circuit was
  authored at 32×25 and sits in a grass margin. Nothing in the code hardcodes
  the size; growing a track means recentring its `map` and shifting every
  waypoint and spawn by the same offset.
- **Register it in `TRACKS` at the top of `game.js`** — id, file, label. The id
  keys the records tables and the debug panel's saved grid, so changing one
  starts that circuit's records over; the file and the label are free.
- **The starting grid is track data.** `SPAWN_POSITIONS` in `game.js` holds only
  the liveries; `applyTrackSpawns()` fills the coordinates from the `spawn`
  block, and a file without one gets the field stacked on waypoint 0. Bump
  `spawnVersion` in `debugConfig.js` when a shipped grid moves.
- **Switching circuits reloads `worldTrack` in place.** `onTrackLoaded()` is the
  list of everything cut to fit the old one — the waypoint ring, the grid, the
  skid layer's size, the records on screen. Anything else derived from map
  dimensions belongs there too.
- The outer ring of tiles is dirt and everything else off the road is grass;
  the ground renderer blurs that into a ragged run-off, so the map edge — the
  hard wall in `clampToWorld` — always reads as the edge of the world.
- Snake Valley was laid out by sampling a closed Catmull-Rom spline and taking
  every tile within 100px of it. That keeps the road ~200px wide, the same as
  Super Circuit's three tiles, whatever angle it runs at; stamping a corridor of
  tiles along the curve instead dilates it by a tile on each side and comes out
  40% wider. Keep any two parts of the lap ≥380px apart, centreline to
  centreline: below that the ~50px blur starts closing the grass between them.

## Laying out a track

A lap is two things agreeing: the tile grid says where the line is, the
waypoint ring says where the lap is. Both live in the track file.

- **Tile `9` is the start line.** `updateLapCounter` counts a crossing as the
  transition onto a `9` cell, nothing else.
- **Waypoint 0 must sit just before the line**, within ~30px. `laps +
  trackProgress()` is the race-order score, and it only rises smoothly if the
  lap counter and the ring wrap at the same place; put waypoint 0 elsewhere and
  the standings flicker every time a car takes the flag.
- **A crossing only counts if the car passed the lap gate first** — the stretch
  of lap between `LAP_GATE_FROM` and `LAP_GATE_TO` in `game.js`, currently 40%
  to 65% of the way round. Without it, reversing back and forth over the line
  scores a lap a second. The gate is a stretch rather than a point so it can't
  be jumped, and it is kept far from the line so the reversing it blocks can't
  re-arm it.
- **`trackProgress()` is in lap distance, not waypoint index**, so the gate
  means the same piece of road at any waypoint count — 11 waypoints and 120
  put it within 50px of each other. Spacing can be as uneven as the layout
  wants (Super Circuit's segments run 248px to 1040px).
- **Below ~8 waypoints the ring stops being the track.** Progress is measured
  along the chords between waypoints, so a sparse ring cuts every corner and
  both the gate and the race order drift off the road with it.
- **The ring must not fold back near itself.** Progress is "nearest segment",
  so where two parts of the lap pass within a car's width — a crossover, a very
  tight hairpin — a car can latch onto the wrong one, which misplaces it in the
  standings as well as at the gate.

`B` then the debug overlay draws all of this: the ring, the gate band, and each
car's projection onto it with its lap percentage. It is the fastest way to see
that a new track's gate landed somewhere sane.

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
  carry `laps` / `onFinishLine` / `passedGate` / `finished` / `finishPosition` /
  `raceStart`, and both go through `updateLapCounter` and `wheelOffRoad`. Adding a rule for
  one and not the other is how the opponents stopped being real competitors in
  the first place.
