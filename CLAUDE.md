# Canvas Cruiser — notes for Claude

Top-down arcade racer. Pure HTML5 Canvas + vanilla JS. **No build step, no
package.json, no dependencies, no test suite.** Editing a `.js` file and
reloading the page is the whole dev loop.

## Two pages

Since 0.14.0 there are two entry points, and which one a file belongs to is the
first thing to establish before editing it:

- **[index.html](index.html) — the game.** Phaser 4 + Matter, vendored. The
  scenes and everything they own live in [phaser/](phaser/). Its only debug
  surface is `?debug=1` ([phaser/debugOverlay.js](phaser/debugOverlay.js)).
- **[editor.html](editor.html) — the authoring tools.** The pre-0.14 canvas
  loop ([editor/](editor/)), booted straight into the waypoint editor by the
  `window.EDITOR_PAGE` flag it sets. It is not a second copy of the game to keep
  in sync: it is the host the editors need — the free camera, `screenToWorld*`,
  the mouse handlers, and the pace car, which is a real `AICar` driven through
  `stepCarControls`/`stepCarMotion`. What it authors is a track file, and that
  format is renderer-independent, so what is cut here is what the game races.
  The one thing to know is that its pace car previews the line under legacy
  physics, which laps a couple of percent quicker than Matter — read it for the
  line, not the clock.

Which page a file belongs to is its **directory**: [phaser/](phaser/) is the
game page's alone, [editor/](editor/) is the editor page's alone, and the repo
root is the set both load — so anything at the root must run with or without
the other page's globals. In particular **`DebugConfig` lives in `editor/`** —
anything at the root that wants a tuned value must fall back to its own
constant (`tunedStat()` in `carStats.js`, `tunedAI()` in `ai.js` are the
pattern), and `typeof DebugConfig !== "undefined"` guards, not truthiness
checks: `??` does not catch the `false` a `&&` chain returns, which is how the
whole grid once ended up with a `maxSpeed` of 0. A root file that reaches for
something in `editor/` without that guard has broken the game page.

## Layout

Scripts are plain `<script>` tags in both pages — everything is a
global, and **load order matters** (on the editor page: `track.js` → editors →
`carStats.js` → `carSprites.js` → `ai.js` → helpers → `editor/game.js` last;
note `ai.js` and `carStats.js` both precede `editor/debugConfig.js`, which
seeds its defaults from them). There are no modules; don't add
`import`/`export` without converting the page to `type="module"`.

### Shared by both pages: the repo root

| File | Role |
|---|---|
| [rain.js](rain.js) | Weather: drop pool, puddles, screen tint. Exposes `gripScale()`/`frictionBonus()`; it must never assign to `car.driftGrip` etc. directly or it overwrites what `applyCarStats()` just set (and, on the editor page, the tuning sliders). |
| [night.js](night.js) | Night races, rolled per race independently of the rain, so all four combinations come up. Purely visual — no grip, no speed, no AI change, deliberately. Floodlights are placed by walking the waypoint polygon and marching sideways off `sampleRoad` until the verge, so a new circuit lights itself; `buildLights()` runs from `onTrackLoaded()`. The dark and the light are **one** half-resolution layer blitted once (`drawLightLayer`), not an additive pass plus a veil — that build measured three times the cost of the whole day frame. |
| [engineClass.js](engineClass.js) | The 60/100/250cc picker. Same rule as `rain.js`: it exposes `speedScale()`/`accelScale()` and never writes to `car.maxSpeed` — `applyCarStats()` in `carStats.js` is the one place that multiplies. Only speed and acceleration scale; steering and grip deliberately do not, which is where the difficulty comes from. 100cc is 1.0, so it is the car every pre-0.12 record was set in. |
| [sound.js](sound.js) | WebAudio, synthesised — engine, tire squeal, impacts. No audio files. `Sound.unlock()` must be called from a user gesture or nothing plays. |
| [quality.js](quality.js) | Render-scale governor. Probes WebGL for a software rasteriser before the first frame, then watches the frame interval and moves the dpr cap down a ladder. Owns `Quality.cap`; `resizeCanvas()` in `game.js` is what reads it. |
| [track.js](track.js) | `Track` class. Loads a track file (tile grid), rasterises + blurs it into a "road field"; both the baked artwork and the physics sample that one field, so visuals and collision can't disagree. One instance, `worldTrack`, reloaded in place when the circuit changes. |
| [carSprites.js](carSprites.js) | The one open-wheel car, as a pixel grid baked to a canvas per livery — no PNGs. Body colour is substituted at bake time and its shade/highlight derived, so a new rival is just a hex. The cache is keyed by colour **and** by `Night.liveryDim()`, which darkens the whole palette after dark — that scalar is quantised precisely because a continuous one would re-bake every car every frame of the fade. Bakes in device pixels; `resizeCanvas()` must call `CarSprites.invalidate()` when the render scale moves. |
| [ai.js](ai.js) | The opponent **driver**, and only the driver: `drive()` reads the track and returns the same `{accel, brake, left, right}` the keyboard fills in for the player. It drives a line of its own making — the waypoint ring resampled, rounded and pushed clear of the kerbs against `worldTrack.sampleRoad` — because a dozen markers chased one at a time is a polygon, and that is what made the cornering look sharp. It owns no physics — the opponents run the player's car through `stepCarControls`/`stepCarMotion` in `game.js`, so there is no `ai.grip`/`ai.turnSpeed`/`ai.baseMaxSpeed` to tune and adding one puts them back in a different vehicle. Corner speed is geometric (`R × turnSpeed`), which is why braking is dormant at 100cc and real at 250cc and in the wet. Laps and race position are *not* here — `updateLapCounter` in `game.js` drives the player and every opponent through the same code. |
| [carStats.js](carStats.js) | The car's numbers, shared by both pages: `CAR_STATS`, `CAR_FRICTION` and `applyCarStats()`. One table, for the player and every opponent — the regression the **Conventions** section below is about. `DebugConfig` is consulted only as an override and may not be loaded at all, so nothing here may assume it exists. |
| [startLights.js](startLights.js), [keyBindings.js](keyBindings.js) | Countdown lights, remappable controls. |

### The editor page: [editor/](editor/)

Nothing here is loaded by `index.html`, so nothing here can be a dependency of
anything at the root. The game's own equivalents are `phaser/*` — this is the
pre-0.14 loop kept because the editors are woven into it, not a second copy of
the game to keep in sync.

| File | Role |
|---|---|
| [game.js](editor/game.js) | Game state, input, physics, collisions, lap counting, race order, the single `gameLoop`, and the editors' host — free camera, `screenToWorld*`, the pace car. Everything not owned by another file lives here. Laps and standings both run on `trackProgress()` — see the **track-authoring** skill. Its `stepCarControls`/`stepCarMotion` are also the parity reference [phaser/matterCar.js](phaser/matterCar.js) was ported from, so a change here without one there splits the two pages' handling. |
| [screens.js](editor/screens.js) | Every pixel of canvas UI — the game's is `phaser/*Screen.js`: start menu, HUD, minimap, records, results, the credits popup, plus the hit-testing that makes them clickable. The credits roll is data, not code: it is fetched from `credits.json` (built-in fallback if that 404s or is malformed), wrapped to the panel width and scrolled if it outgrows the window. |
| [trackEditor.js](editor/trackEditor.js) | Tile map editor. `T` opens it (`B` toggles DEBUG off entirely). `P` exports the loaded track back out under its own filename. |
| [waypointEditor.js](editor/waypointEditor.js) | Drag AI waypoints; the page opens straight into it. A click on the line inserts into the ring rather than appending to it, and `Z` walks back an edit stack rather than popping the array. Opened from the menu it drives the free camera in `game.js` (pan/zoom) instead of following the car; its hit testing is in world units so the grab ring survives the zoom. Opened there it also runs a **pace car** — one opponent, driving the markers as they are edited, with the rest of the field parked and hidden. It lives in `game.js` (`paceCarActive()` and friends) and is outside the race: no laps, no collisions, no skid marks. |
| [debugConfig.js](editor/debugConfig.js) | Live tuning sliders (physics, AI, spawn grid) persisted to localStorage. The game page never loads it, so it defines no shipped number: `seedDefaults()` reads every default back out of `carStats.js`, `ai.js` and `game.js`. `spawnVersion` must be bumped when a shipped starting grid changes, or a stale saved copy overrides it; the saved copy is keyed by track as well, since the grids are per circuit. `aiVersion` does the same job for the `ai*` keys — bump it whenever the opponent tuning changes meaning, or anyone who has ever opened the panel keeps the old balance. |
| [debugHUD.js](editor/debugHUD.js) | The debug overlay. |

### The game page: [phaser/](phaser/)

Everything `index.html` owns. Most of these are ports of a named function out
of `editor/game.js` or `editor/screens.js` and say so in their header block;
where one deliberately diverged from what it replaced, that is the entry below.
The port's own working notes were `PORTING.md`, deleted once 0.14.0 shipped —
`git show 2e5d022:PORTING.md` if a decision needs re-reading.

Two rules the port was built on, and they still hold: **the car is a port, not
a rewrite** (`matterCar.js`'s handling lines are copied verbatim, Matter took
over integration and contact only, so a lap time that moves is a bug rather
than a tuning question), and **no walls**. Matter laps ~2.5–3% quicker than the
legacy loop under identical driver code; that gap was measured three ways
without closing and is the accepted baseline, not a bug to hunt.

| File | Role |
|---|---|
| [raceScene.js](phaser/raceScene.js) | The race. The biggest file here and the host the rest hang off: Matter world, the field, the camera, the update order. `Track` bakes exactly as it always did and the baked canvas is handed over as a texture, so `tracks/*.json` stays the single source for artwork, physics and geometry alike. |
| [matterCar.js](phaser/matterCar.js) | The car as a Matter body — a deliberate *port* of `stepCarControls`/`stepCarMotion`, same lines, same order, same constants, so a lap time that moves is a bug rather than a tuning question. Matter owns integration and car-to-car contact, which the old hand-rolled `resolveCollision` never did properly. **The car is not walled in**: running wide costs grip and time through `OFFROAD_DRAG`, never a barrier — adding walls is a gameplay change, not a physics port. |
| [raceLaps.js](phaser/raceLaps.js) | Lap counting and race order — `updateLapCounter`/`raceScore`/`raceStandings`/`finishRace`, with the rule intact: **one** call for the player and all five opponents. It has no `isPlayer` branch at all; every car keeps its laps, lap times and clock on its own entity. The clock is a parameter, not a `performance.now()` inside, so a hand-stepped headless run can feed it a fixed step. |
| [raceGrid.js](phaser/raceGrid.js) | Starting grid, start line and lap gate — one contract, not three features, ported with the geometry unchanged. The grid is track data; only the liveries are code. A track with no `spawn` block still starts, via the waypoint-0 fallback. See the **track-authoring** skill. |
| [raceConditions.js](phaser/raceConditions.js) | Per-race weather and night rolls. Only ever calls `Rain.toggle()`/`Night.toggle()` — same rule as `rain.js` itself. Takes `modeId` as a parameter rather than reading a `gameMode` global, and declares `weatherWetFromLap`/`weatherWetToLap` as bare globals because `Rain.drawHUD()` reads those names straight off the page. |
| [skidMarks.js](phaser/skidMarks.js) | Rubber on dry tarmac, squeegeed water on wet. A world-space RenderTexture below the cars, so marks accumulate on the GPU instead of being re-blitted. Not a straight port: a mark is the *path* the tire took over the frame, not a stamp where it ended — the legacy fixed-size rect came out as a dashed line whose gaps grew with speed. A Phaser 4 `DynamicTexture` is a **command buffer, not a canvas**: `draw()` only queues, `render()` executes, and a queued draw holds a *reference* to the Graphics — so the order is draw → `render()` → clear, and getting it wrong is an empty layer with no error. |
| [renderScale.js](phaser/renderScale.js) | `resizeCanvas()`'s job for this page. Phaser's canvas is not `devicePixelRatio`-aware alone, so the backing store is oversized by `renderDpr` and every camera zoomed back down by the same factor — world units don't move, only pixel density. Whatever decides that also has to invalidate `CarSprites`, which bakes in device pixels. |
| [worldCamera.js](phaser/worldCamera.js) | A stand-in for four `game.js` globals (`camera`, `viewZoom`, `viewWidth()/viewHeight()`, `ctx`) so `rain.js` and `night.js` run here **completely unmodified**. `viewZoom` is always 1 — there is no free camera on this page. |
| [uiCanvas.js](phaser/uiCanvas.js) | A second `<canvas>` over Phaser's own, carrying every pixel of UI. `screens.js` is ~1000 lines of exact `ctx` drawing that already matches the shipped game pixel for pixel and has no Phaser GameObject equivalent, so it was ported onto a plain 2D context nearly verbatim — only the globals it reads changed. Scaled in CSS pixels like `resizeCanvas()`. |
| [menuScene.js](phaser/menuScene.js), [menuScreen.js](phaser/menuScreen.js), [menuData.js](phaser/menuData.js) | The start menu: scene owns the picker state, screen draws it and hit-tests it, data is the menu's own copy of `TRACKS`/`MODES`. That copy is duplicated from `game.js` on purpose — two circuits and three modes is cheap to keep in sync by eye; promote it to a shared file if it grows. The backdrop is a real bake of the selected circuit with no grid, no cars and no Matter world, drifted along the waypoint ring at **1:1** and rained/darkened by the shipped `rain.js`/`night.js` (rolled per visit, scenery not forecast). The scale is not cosmetic: those two files measure drops and light pools in world px against `viewZoom` 1, so a cover-fit bake would size the weather wrong. |
| [hudScreen.js](phaser/hudScreen.js) | In-race HUD and minimap. The one place on this page allowed to treat the player as special — it reads `scene.player.entity` directly, because a HUD showing one car's numbers is what a HUD is. |
| [resultsScreen.js](phaser/resultsScreen.js) | The results table, drawn by `RaceScene` itself rather than as a scene, because it overlays a race that is still running underneath. Keeps the legacy roll-out hold: the field is classified at the flag, but `scene.finishOrder` only exists after `FINISH_HOLD_MS`. |
| [recordsScene.js](phaser/recordsScene.js), [recordsScreen.js](phaser/recordsScreen.js), [records.js](phaser/records.js) | Lap and total-time records. Same localStorage keys, same `track:class` shape, same defensive parsing and the same `upgradeKey()` path as the legacy loop. **`RECORDS_PHYSICS_VERSION`** clears both stores once on this page's first run — Matter lap times and legacy ones are not the same manoeuvre, and mixing them into one leaderboard is worse than a reset. Only reachable from the menu: "back" always means the menu, since there is no pause/resume yet. |
| [creditsScreen.js](phaser/creditsScreen.js), [credits.js](phaser/credits.js) | The credits modal over the menu, and its data — still fetched from `credits.json` with the built-in fallback, still "bad data is dropped, never trusted". |
| [playerInput.js](phaser/playerInput.js) | The player's four controls, as raw DOM `e.key` looked up through `KeyBindings.bindings`. Phaser's `addKeys()` **cannot** do this job — it keys off Phaser's `KeyCodes` enum while a binding is whatever `e.key` the player pressed, and there is no total mapping between them. Hardcoding the arrows, which this replaced, made the rebind screen a lie on this page. |
| [soundHooks.js](phaser/soundHooks.js) | One page-wide set of listeners for `Sound.unlock()`/`toggleMute()`, rather than one per scene, because scenes come and go under them. |
| [debugOverlay.js](phaser/debugOverlay.js) | All that DEBUG is on this page: `?debug=1` draws the ring, gate and start geometry plus a live panel — frame cost, render scale, conditions, and the field's lap times with each driver's rolled skill. A URL flag, not a key, so it cannot be left on by accident or persisted into a bad state, and the headless harness can set it without synthesising input. It measures nothing itself; `Quality` already samples the frame interval. |

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
# then open http://localhost:8123/            — the game
#      or http://localhost:8123/?debug=1     — with the ring, gate and panel
#      or http://localhost:8123/editor.html  — the track and waypoint editors
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
- Bump `window.BUILD` for user-visible releases — **in both `index.html` and
  `editor.html`**, which each declare their own. It is both the version (it
  feeds the window title and the menu; `GAME_VERSION` in `game.js` reads it on
  the editor page) and the cache buster: each loader stamps `?v=` on every
  script it pulls, on `style.css`, and on the `fetch()`s in `track.js` and
  `screens.js`, so bumping it is what stops returning players running a mix of
  old and new files. Anything new that is fetched or linked needs the same
  stamp. GitHub Pages serves `max-age=600` on everything and its headers are not
  configurable, so the HTML self-heals within 10 minutes and the query string
  does the rest.
- Keys added to game logic that must not be remappable belong in
  `BLACKLISTED_KEYS` in `keyBindings.js` — which is the **union across both
  pages**, since one saved set of bindings is read by both.
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
