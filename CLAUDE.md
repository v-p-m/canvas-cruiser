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
| [game.js](game.js) | Game state, input, physics, collisions, lap counting, race order, the single `gameLoop`. Everything not owned by a file below lives here. Laps and standings both run on `trackProgress()` — see the **track-authoring** skill. |
| [screens.js](screens.js) | Every pixel of canvas UI: start menu, HUD, minimap, records, results, the credits popup — plus the hit-testing that makes them clickable. The credits roll is data, not code: it is fetched from `credits.json` (built-in fallback if that 404s or is malformed), wrapped to the panel width and scrolled if it outgrows the window. |
| [rain.js](rain.js) | Weather: drop pool, puddles, screen tint. Exposes `gripScale()`/`frictionBonus()`; it must never assign to `car.driftGrip` etc. directly or it overwrites the tuning sliders. |
| [engineClass.js](engineClass.js) | The 60/100/250cc picker. Same rule as `rain.js`: it exposes `speedScale()`/`accelScale()` and never writes to `car.maxSpeed` — `applyCarStats()` in `game.js` is the one place that multiplies. Only speed and acceleration scale; steering and grip deliberately do not, which is where the difficulty comes from. 100cc is 1.0, so it is the car every pre-0.12 record was set in. |
| [sound.js](sound.js) | WebAudio, synthesised — engine, tire squeal, impacts. No audio files. `Sound.unlock()` must be called from a user gesture or nothing plays. |
| [quality.js](quality.js) | Render-scale governor. Probes WebGL for a software rasteriser before the first frame, then watches the frame interval and moves the dpr cap down a ladder. Owns `Quality.cap`; `resizeCanvas()` in `game.js` is what reads it. |
| [track.js](track.js) | `Track` class. Loads a track file (tile grid), rasterises + blurs it into a "road field"; both the baked artwork and the physics sample that one field, so visuals and collision can't disagree. One instance, `worldTrack`, reloaded in place when the circuit changes. |
| [carSprites.js](carSprites.js) | The one open-wheel car, as a pixel grid baked to a canvas per livery — no PNGs. Body colour is substituted at bake time and its shade/highlight derived, so a new rival is just a hex. Bakes in device pixels; `resizeCanvas()` must call `CarSprites.invalidate()` when the render scale moves. |
| [ai.js](ai.js) | The opponent **driver**, and only the driver: `drive()` reads the track and returns the same `{accel, brake, left, right}` the keyboard fills in for the player. It drives a line of its own making — the waypoint ring resampled, rounded and pushed clear of the kerbs against `worldTrack.sampleRoad` — because a dozen markers chased one at a time is a polygon, and that is what made the cornering look sharp. It owns no physics — the opponents run the player's car through `stepCarControls`/`stepCarMotion` in `game.js`, so there is no `ai.grip`/`ai.turnSpeed`/`ai.baseMaxSpeed` to tune and adding one puts them back in a different vehicle. Corner speed is geometric (`R × turnSpeed`), which is why braking is dormant at 100cc and real at 250cc and in the wet. Laps and race position are *not* here — `updateLapCounter` in `game.js` drives the player and every opponent through the same code. |
| [trackEditor.js](trackEditor.js) | Tile map editor. DEBUG on (`B`), then `T`. `P` exports the loaded track back out under its own filename. |
| [waypointEditor.js](waypointEditor.js) | Drag AI waypoints. DEBUG on, then `E`. A click on the line inserts into the ring rather than appending to it, and `Z` walks back an edit stack rather than popping the array. Opened from the menu it drives the free camera in `game.js` (pan/zoom) instead of following the car; its hit testing is in world units so the grab ring survives the zoom. Opened there it also runs a **pace car** — one opponent, driving the markers as they are edited, with the rest of the field parked and hidden. It lives in `game.js` (`paceCarActive()` and friends) and is outside the race: no laps, no collisions, no skid marks. |
| [debugConfig.js](debugConfig.js) | Live tuning sliders (physics, AI, spawn grid) persisted to localStorage. `spawnVersion` must be bumped when a shipped starting grid changes, or a stale saved copy overrides it; the saved copy is keyed by track as well, since the grids are per circuit. `aiVersion` does the same job for the `ai*` keys — bump it whenever the opponent tuning changes meaning, or anyone who has ever opened the panel keeps the old balance. |
| [debugHUD.js](debugHUD.js), [startLights.js](startLights.js), [keyBindings.js](keyBindings.js) | Debug overlay, countdown lights, remappable controls. |

State that survives reloads lives in localStorage: `highScores`,
`bestTotalTimes`, the chosen `track` and `engineClass`, key bindings, debug
config. Parsing is defensive — bad JSON is dropped, not trusted; keep it that
way when adding keys. `highScores` and `bestTotalTimes` are keyed
`trackId:classId` (`"super:100cc"`); `upgradeKey()` in `game.js` reads any key
without a colon as a pre-0.12 track id and files it under 100cc, and that
composes with the flat pre-two-track shapes, which are still read as the first
circuit's. Track and class ids must therefore stay colon-free.

## Running it

The track files are loaded with `fetch()`, so **`file://` does not work** — serve them:

```bash
python3 -m http.server 8123 -d /home/demac/dev/github/v-p-m/canvas-cruiser
# then open http://localhost:8123/
```

## Testing changes headlessly

`chromium-browser --headless` is installed and is the way to verify a visual or
runtime change without asking the user to click around — screenshots, JS error
capture, and a synthetic-input harness that can drive a whole race. The recipe,
including the headless `requestAnimationFrame` trap that silently kills the game
loop, is the **headless-testing** skill.

## Track layout

Adding a circuit, moving waypoints, or changing a starting grid has contracts
that laps and race order depend on — see the **track-authoring** skill.

## Conventions

- Comments explain *why* a technique was chosen (see the header block in
  `track.js`), not what the line does. Match that density — most code carries none.
- Tunable constants go at the top of their file in `SCREAMING_CASE`, with the
  unit in a trailing comment (`// cells`, `// world px`).
- Bump `window.BUILD` at the top of `index.html` for user-visible releases. It
  is both the version — `GAME_VERSION` in `game.js` reads it, and it feeds the
  window title and the menu — and the cache buster: the loader stamps `?v=` on
  every script, on `style.css`, and on the `fetch()`s in `track.js` and
  `screens.js`, so bumping it is what stops returning players running a mix of
  old and new files. Anything new that is fetched or linked needs the same
  stamp. GitHub Pages serves `max-age=600` on everything and its headers are not
  configurable, so `index.html` self-heals within 10 minutes and the query
  string does the rest.
- Keys added to game logic that must not be remappable belong in
  `BLACKLISTED_KEYS` in `keyBindings.js`.
- Everything is drawn in **CSS pixels**: `resizeCanvas()` scales the context by
  `devicePixelRatio` and `camera.width`/`camera.height` are the viewport. Never
  read `canvas.width`/`canvas.height` for layout — that is the backing store,
  and it is `dpr` times larger.
- The player and the AI are interchangeable to the race code — and, since
  0.12.0, to the physics as well. Both carry `laps` / `onFinishLine` /
  `passedGate` / `finished` / `finishPosition` / `raceStart` and go through
  `updateLapCounter`; both get their `acceleration` / `maxSpeed` / `turnSpeed` /
  `driftGrip` / `friction` from `applyCarStats()` and are driven through
  `stepCarControls()` and `stepCarMotion()`. **Adding a stat, a force or a
  penalty to one and not the other is how the opponents stopped being real
  competitors in the first place** — they had twice the grip, a steering
  controller with no rate limit, no cornering scrub, and a speed ceiling off the
  road in place of the drag. Per-car differences belong in `entity.mods`, which
  every car reads and which is where the part upgrades will go.
