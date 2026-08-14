# 0.14.0 — the Phaser 4 port

Working notes for a multi-session port. Delete this file when the port lands.

## Where it stands

Committed on branch `0.14.0` (`0544629`):

- `vendor/phaser.min.js` — Phaser 4.2.1, UMD, plain `<script>` tag, `?v=BUILD`
  stamped like everything else. **No build step, no package.json** — that rule
  survives the port by explicit decision.
- `phaser.html` — the port target. Runs **beside** the legacy loop;
  `index.html` is untouched and still plays.
- `phaser/matterCar.js` — the car as a Matter body.
- `phaser/raceScene.js` — one scene: track texture, the field on the grid.
- `phaser/raceGrid.js` — the spawn grid, the start line and the lap gate.
- `phaser/carStats.js` — `applyCarStats()`, ported. One set of numbers for the
  whole grid.
- `phaser/raceLaps.js` — the lap counter and the standings, one call for all
  six cars.

Verified headlessly: the track renders, Matter carries the car, off-road drag
pins full throttle to 2.3 against a ceiling of 10, and a rear-ended car gets
shoved.

**Step 1 is done**: `phaser/raceGrid.js` holds the spawn grid, the start line
and the lap gate, ported out of `applyTrackSpawns` / `trackProgress` /
`updateLapGate` with the geometry unchanged. `findRoad()` is gone; the scene
builds all six cars from the track file's `spawn` block, pole first. No shipped
grid moved, so `spawnVersion` stayed at 5. `?debug=1` on `phaser.html` draws the
ring, the gate band and the tile-9 cells — the Phaser half of what `B` does.
Verified headlessly: all six on their authored coordinates at 90° facing the
line, all on tarmac, lap fraction descending 0.979 → 0.930 down the grid; and
driving the player forward wraps progress 0.998 → 0.000 immediately before it
touches tile 9, which is the ~30px waypoint-0 contract holding.

## The two rules this port is built on

**The car is a port, not a rewrite.** The throttle, steering, cornering-scrub
and drift-grip lines in `phaser/matterCar.js` are copied out of
`stepCarControls`/`stepCarMotion` verbatim. Matter took over *integration and
contact only*. This is what makes the swap testable: **a lap time that moves is
a bug, not a tuning question.** Resist "while I'm in here" improvements to the
handling model until the port is trusted and measured.

**No walls.** No static bodies at the road edge. Running wide costs grip
through `OFFROAD_DRAG` sampled from the shared road field, exactly as it always
has. Barriers are a gameplay change and don't belong in a physics port.

## Facts worth not re-deriving

- Phaser 4's **full** `dist/phaser.min.js` bundles Matter. Don't judge by
  grepping token counts — minification means `MatterPhysics` appears twice in
  1.4 MB and it looks absent; grep for internals (`PolyDecomp`, `TileBody`,
  `constraintIterations`). There is **no matter-only dist build**.
- `CanvasRenderer` survives in v4, and `AUTO:0 CANVAS:1 WEBGL:2 HEADLESS:3` are
  all present — the headless harness still works.
- `traceRoadContours()` (track.js:211) already does marching squares at the 0.5
  iso-level and returns **2 clean, consistently-wound loops** for the super
  circuit. Matter edge geometry needs *converting*, not inventing.
- `trackProgress()` (game.js:1297) reads only `worldTrack.data.waypoints` and
  `entity.x`/`entity.y`. It is renderer-agnostic — laps and standings port
  nearly for free.

## Next steps, in order

Each step should end with a headless check before starting the next.

### 1. Starting grid and spawn contract — DONE, see above
The one thing left owing: the debug panel's spawn sliders. In the legacy loop
`DebugConfig.apply()` overwrites the grid's x/y after `applyTrackSpawns()` has
filled it, and `spawnVersion` (debugConfig.js:47) — keyed by track — is what
stops a saved copy overriding a shipped grid that has moved. The port has no
panel, so the track file is the only source until step 5 brings one back.

### 2. Opponents through the same machinery — DONE
`ai.js` came across **unmodified**. The opponents *are* `AICar`s: `spawnCar()`
builds slot 0 as a plain object and every other slot as an `AICar`, then runs
both through the same `Object.assign` of entity fields, the same
`applyCarStats()` and the same `MatterCar.step()`. `phaser.html` gained
`debugConfig.js` (for its `defaults` literal only — `init()` wants globals
game.js owns), `engineClass.js`, `ai.js` and `phaser/carStats.js`.

Three things worth not re-deriving:

- `ai.js` reads the track off the **`worldTrack` global** (`clearRing` /
  `ringFor`) to push its line clear of the kerbs. `raceScene.create()` sets it.
  Without it the driver runs an uncleared ring and spends most of a lap on the
  grass.
- The placeholder car was 18x32. The real one is **34x56** — `CAR_SPRITE_W/H`
  and `car.width/height` agree on that — and it starts mattering here, because
  `AVOID_RADIUS`/`AVOID_STRENGTH` are tuned against a car that size and six
  bodies are now touching. `CAR_W`/`CAR_H` were corrected.
- The panel is step 5, so `carStats.js` seeds `DebugConfig.values` from
  `DebugConfig.defaults`. Skip that and ai.js falls through its `??` fallbacks
  to a skill floor of 0.9 against the shipped 0.85.

What makes an opponent slower is `rollDriver()` — skill, line offset, aim
wander — and nothing else. Every car's `mods` is null and all six carry
identical `acceleration/maxSpeed/turnSpeed/driftGrip/friction`.

Verified headlessly, 32s of virtual time on Super Circuit: all five opponents
complete 3 laps, **10.2–10.8s** each, with 3.9–11.5% of the lap carrying any
off-road drag at all and a mean drag of 0.004–0.019 — the same neighbourhood
`ai.js`'s own clearance readings quote for the legacy loop. And a scripted
600-frame stint (throttle, both locks, brakes, coast, off-road) fed to a player
entity and to an `AICar` through `MatterCar.step` is **bit-identical in
x/y/angle/speed on every frame**.

One number to carry into step 7: 10.2–10.8s is quicker than the recorded
ghost-pacer reference of 11.4–11.7s for Super 100cc dry. That may be the
five-car figure rather than the ghost, or it may be the port. Do not tune
anything until it has been measured against the legacy loop like for like.

**Harness gotcha, and it invalidates results silently:** Matter integrates with
the frame delta, and headless delivers a jittery one, so an auto-stepped world
is not repeatable *against itself* — a player-vs-player control run diverged
5.3px. Take the wheel off it (`matter.world.setAutoUpdate(false)`, then
`Matter.Engine.update(world.engine, 1000/60)` by hand) before comparing two
runs. Note `world.update(time, delta)` is **not** the engine step — with
autoUpdate off it silently leaves every body where it was, and the resulting
"identical" is two cars that never moved.

### 3. Laps and standings — DONE
`phaser/raceLaps.js`: `updateLapCounter` / `raceScore` / `raceStandings` /
`finishRace`, ported. `RaceLaps.update()` runs the gate, the tile-9 crossing and
the flag for one car, and the scene runs all six through it in one loop — the
player is not a special case anywhere in the file. `RaceLaps.initEntity()` owns
the race fields (`laps`/`onFinishLine`/`passedGate`/`finished`/`finishPosition`/
`finishTime`/`raceStart`/`lapStart`/`lastLapTime`/`bestLapTime`), so `spawnCar`
can no longer fill in a different set for an AICar than for the player.

Three things worth not re-deriving:

- The legacy counter's `isPlayer` branch is the HUD lap number, the records and
  the per-lap weather — steps 5, 6 and 8. The port has no branch at all: every
  car keeps its own lap times and race clock on itself, and whatever draws the
  HUD later reads the player's entity like any other car's. Do not reintroduce
  an `isPlayer` argument to get one number onto the screen.
- The clock is a parameter (`update(world, entity, now)`) and the scene passes
  Phaser's loop `time`, not `performance.now()` — a hand-stepped headless run
  then counts laps on the same clock it integrates on.
- No menu until step 5, so the page is a 5-lap race and `?laps=N` is the mode
  picker (`?laps=0` runs free, as "Free Drive" does).

Verified headlessly, and the harness is two checks rather than one, because a
race alone cannot tell a working gate from a lucky one:
- A bare entity walked round the ring — no car, no Matter — counts 3 laps from
  4 crossings, takes the flag on the 4th, and reports the walk's exact times
  (40s laps, 120s race). Walked back and forth over the line 20 times
  afterwards it stays on the lap it had: the gate refuses all 20.
- A full 3-lap race, all six cars driven (the player by a bot on the same
  `AICar.drive`): laps 10.1–10.8s — step 2's numbers, so counting laps did not
  move the pace — every car finishing on lap 4, `finishPosition` 1–6 in crossing
  order, and the standings agreeing with the on-track order at every sample.
  The order frozen at the player's flag put the three cars still circulating in
  the order they went on to finish in.

### 4. Cars that look like cars — DONE
`phaser/renderScale.js` is the new file: it owns the render scale the way
`resizeCanvas()` does for the legacy loop, because nothing did before this and
`CarSprites` needs a `renderDpr` and an invalidation hook to bake against.
Phaser's own canvas is not devicePixelRatio-aware — there is no working
`resolution`-style config in this vendored build (the only game-wide knob that
name suggests is a text-object style property, not the renderer) — so
`RenderScale.apply()` oversizes the backing store by `renderDpr` and zooms
every camera back down by the same factor, exactly mirroring the
`ctx.setTransform(dpr,...)` trick the raw canvas plays. `raceScene.js` calls it
once from `create()` (before any car is spawned) and again on every window
resize; both times it calls `CarSprites.invalidate()` and a scene-local
`invalidateCarTextures()`, because the Phaser `TextureManager` caches canvases
under their own keys and doesn't know to throw them out just because
`CarSprites`'s own cache did.

Each car is a `Container` holding a body `Image` plus two wheel `Image`s, a
direct port of `CarSprites.draw()`'s `ctx.translate`/`ctx.rotate` nesting onto
Phaser's scene graph. `updateSteerVisual()` — carSprites.js's own function,
unmodified — runs once a frame per car, same as the legacy loop, so the front
wheels steer off the yaw the physics actually produced. The livery/dim texture
key (`car:<color>@<dim>`) is re-resolved every frame the same way
`CarSprites.draw()` re-reads `Night.liveryDim()` every frame in the legacy
loop — cheap when the key hasn't changed, and it means night (step 6) will
fold in for free.

Verified headlessly: all six cars render with real sprites (not rectangles),
correct per-car liveries, and steering wheels, at `devicePixelRatio` 1 and
again forced to 2 — the backing store doubles (`2560x1426` against `1280x713`
CSS), `cameraZoom` reads back `2`, and the car art is crisp at both, with no
console errors either mode.

**Harness gotcha, cost most of a session:** restoring the real `rAF` too close
to the screenshot (500ms of real wall-clock time before an 8000ms
`--virtual-time-budget` capture) reproducibly rendered only one car out of six
— every entity, texture and scene-graph field was correct on inspection, only
the compositor output was short. Headless compositing needs several genuine
`rAF`-driven ticks to paint every sprite, not just the last one drawn; giving
it 3000ms instead of 500ms fixed it outright. A screenshot that's missing
objects the object model swears are there is a compositing-timing question
before it's a rendering-logic one.

### 5. screens.js
The big one — menu, HUD, minimap, records, results, credits, and the
hit-testing that makes them clickable.

**Decided: a 2D overlay canvas, not Phaser UI scenes.** screens.js is ~1000
lines of exact `ctx` drawing — `roundRect` fills, a clipped-and-faded scroll
region for the credits roll, gradient fades, `measureText`-driven hit boxes —
that already matches the shipped game pixel for pixel, and Phaser's
GameObject API (`Text`/`Graphics`/`Container`) has no equivalent for most of
it. Re-deriving all of that as Phaser objects is a rewrite with every chance
of moving a pixel, for a screen that never touches Matter or a camera. So:
`phaser/uiCanvas.js` is a second `<canvas>`, absolutely positioned over
Phaser's own, resized/dpr-scaled the way `resizeCanvas()` scales the legacy
one. `screens.js`'s draw functions and its `hitTest`/`mousePos`/hit-area-array
model port across nearly verbatim onto it — only the globals they read
(`camera.width`, `ctx`, `canvas.style.cursor`, game state) change. Trade-off:
no idiomatic Phaser input/scene-lifecycle and no running UI through Phaser's
renderer/post-fx pipeline — nothing here needs either.

**Menu — done.** `phaser/menuData.js` (a small, deliberately duplicated
`PHASER_TRACKS`/`PHASER_MODES` — see its header for why not shared with
game.js), `phaser/menuScreen.js` (the ported `drawStartMenu` /
`drawSelectorRow` / `drawStartButton` / `handleMenuClick`), and
`phaser/menuScene.js` (a `Phaser.Scene` owning the picker state and the
hand-off to `RaceScene`). `RaceScene.create(data)` now takes
`data.trackFile` instead of a hardcoded path, falling back to Super Circuit
for a bare `scene.start("race")` with no menu in front of it. TRACK/CLASS/
MODE all work, by mouse and by keyboard, and START hands off to a real race
on the chosen circuit.

Three things worth not re-deriving:

- **Synthetic keydown+keyup dispatched back-to-back, in the same tick, does
  not register with Phaser's keyboard plugin — `JustDown` never fires.** A
  real keypress has nonzero duration; a harness that fires `keydown` and
  `keyup` in the same callback gives the plugin a zero-duration event that
  its internal `_justDown` latch doesn't catch. Separate them by ~100ms+.
  Phaser reads `event.keyCode` (not `.code`), and this Chromium's
  `KeyboardEvent` constructor does honour a `keyCode` passed in the init
  dict — but only if it's actually there; `{key, code}` alone dispatches
  cleanly and is silently ignored.
- **A canvas's CSS box does not follow `position:absolute; inset:0` the way
  a `<div>`'s would.** `<canvas>` is a replaced element; with `width`/`height`
  left as `auto`, an absolutely-positioned replaced element sizes itself from
  its intrinsic dimensions (its `width`/`height` *attributes*) and only uses
  `inset` to place that box, not to stretch it. `uiCanvas.js` sets the backing
  store to `devicePixelRatio` for crisp text, so without an explicit
  `canvas.style.width`/`height` in CSS pixels, the overlay only happened to
  fill the viewport at dpr 1 — at 2x it would render at backing-store size,
  visibly oversized and out of register with Phaser's own canvas. Caught by
  testing `--force-device-scale-factor=2`, per the existing habit from step 4.
- The menu still names K (key bindings), Q (records), I (credits), M (mute),
  B (debug) for visual parity with the legacy row, since dropping them would
  make the layout jump again as each lands. None of those systems exist on
  this page yet, so clicking or pressing one logs
  `"not yet ported, see PORTING.md step 5"` and does nothing else — a stub,
  not a dead end. Sound.js isn't loaded on this page (step 6), so the mute
  label always reads "Sound: ON". `B` only flips a label for now; there's no
  debug overlay on the Phaser page to toggle yet.

The menu also gets a live backdrop: `MenuScene` bakes the selected circuit
with the same `Track` class RaceScene uses (no spawn grid, no cars, no Matter
world — a static cover-fit image) so cycling TRACK previews the circuit
you're choosing, the way the legacy menu sits over its own paused race.
Switching circuits re-bakes with the same "last press wins" guard
`applySelectedTrack()` uses in game.js — a fetch-and-bake can be asked to
change again before it finishes.

Verified headlessly: menu screenshots clean at dpr 1 and 2 (matched pixel-for
-pixel against an equivalent legacy-loop screenshot for the emoji-glyph and
kerb-dash details that turned out not to be bugs), no console errors; a
mouse-driven run (click TRACK▶, click CLASS▶, click START) landed on Snake
Valley at 250cc with the race scene's own grid report confirming the right
track loaded; a keyboard-driven run (`UP UP` to row 0, `RIGHT` to cycle the
track, `DOWN DOWN DOWN` to START, `ENTER`) moved the cursor 2→1→0, cycled
super→valley, moved 0→3, and landed on `raceActive: true` — both input paths
work end to end.

**HUD and minimap — done.** `phaser/hudScreen.js`: the ported `drawUI`/
`drawMinimap`/`LapBanner`, called from `RaceScene.update()` every frame a race
is live. Read its header before touching it — the legacy HUD leans on
`updateLapCounter`'s `isPlayer` branch for `laps`/`lastLapTime`/etc., and
`RaceLaps.update()` deliberately has no such branch (step 3), so this file
reads `scene.player.entity` directly instead. That makes it the *one* place
on this page allowed to treat the player as special, which is fine — a HUD
showing one car's numbers is what a HUD is, and nothing about the race
machinery bends to make it possible.

The lap banner needed its own trigger, for the same reason: nothing calls
`LapBanner.show()` on a lap completing anymore, because nothing owns an
`isPlayer` branch to call it from. `RaceScene.update()` now watches
`player.entity.lastLapTime` itself and fires the banner the frame it changes
(guarded against the arming crossing, which leaves `lastLapTime` `null`) —
see `this.playerLastLapSeen` there. Everything else in `hudScreen.js` is a
straight read of fields `RaceGrid`/`RaceLaps` already maintain: lap fraction
for the lap counter, `RaceLaps.standings()` (computed once a frame and shared
with the scene's own debug report, not duplicated) for the position readout,
`cameras.main.scrollX/Y`/`.width`/`.height` in place of `camera.x/y/width/
height` for the minimap viewport box.

The roll-out hold between the flag and the results screen (`finishHoldTimer`)
is not carried over — it exists to delay a results screen that, at the time
the HUD was built, didn't exist yet. Now that it does (below), `TOTAL`/the
results screen simply appear the instant `entity.finished` flips true, and
the player switches to `rollOut: true` (the same coast-to-a-stop `MatterCar`
already had ported) that same frame rather than idling on dead input.

Verified headlessly: a forged lap completion (`entity.laps`/`lastLapTime` set
directly, the same fields `RaceLaps.update()` would have written, so what's
under test is `RaceScene.update()`'s own detection of the change rather than
lap-counting itself, which step 3 already verified) made the banner go
active, then inactive again after `LAP_MS` — confirmed against `HudBanner`'s
own state, not just a screenshot. Full-race screenshots show `LAP 3 / 5`,
`P1/6` in gold, `LAST:`/`TIME:` both live and correctly positioned, the
lap-complete banner centred and legible, and the minimap with all six dots,
the ringed player marker, and the viewport rectangle tracking the camera —
matching the legacy HUD's layout call for call. No console errors in any run.

**Records, results and credits — done.** This resolved step 8's open question
sooner than planned, by decision rather than default — see the next
paragraph. `phaser/records.js` (the store), `phaser/recordsScreen.js` +
`phaser/recordsScene.js` (the `Q` screen), `phaser/resultsScreen.js` (the
post-flag overlay, drawn by `RaceScene` itself rather than a separate scene —
see its header for why), `phaser/credits.js` + `phaser/creditsScreen.js` (the
`I` modal, still data-driven off `credits.json` with the same built-in
fallback). `RaceScene` now saves every completed player lap and, on a scored
finish, the total — `Records.saveLapTime()`/`saveTotalTime()` both return
whether it's a new best, which is what feeds `HudBanner`'s gold treatment and
the results screen's "New Best Total!" line. Free Drive laps are saved too,
unconditionally, matching `saveLapTime()`'s own unconditional call in the
legacy loop's `isPlayer` branch.

**Step 8 is therefore decided: reset, not namespaced.** Lap times from the two
physics models aren't comparable, and asked directly, the call was to clear
`highScores`/`bestTotalTimes` rather than carry pre-port times forward under a
second set of keys — there are no released players yet to preserve them for.
`RECORDS_PHYSICS_VERSION` in `records.js` gates it: the *first* `Records.load()`
call on a page that hasn't seen this version wipes both keys once and stamps a
marker, every call after that is a no-op. Bump the version string if the
physics changes meaningfully again. Track/class ids are still colon-free and
`upgradeKey()`'s compatibility path is still there (mechanically correct, just
moot immediately after a reset, since there's nothing pre-colon left to
upgrade) — the constraint was about not breaking the mechanism, not about
never clearing data.

Two bugs the new navigation surfaced, neither about records specifically:
- **Restarting or re-entering a scene Phaser is reusing (`scene.restart()`,
  or `scene.start()` back to one that's run before) re-runs an `async
  create()` from the top — but any `window`/global-manager listener it
  registered on its first life (a `window.resize` handler, `this.scale.on`)
  is still attached, and a *second* one now stacks on top of it.** Both
  `RaceScene` and `MenuScene` register their listener into a named handler
  and remove it in `this.events.once("shutdown", ...)`, the scene-local event
  that *does* fire reliably on every exit. The overlay canvas's own click
  handlers get the same treatment.
- **The same reused-instance restart leaves `this.ready` stale-`true` from
  the scene's previous life for the whole `await` gap inside the new
  `create()`**, and Phaser keeps calling `update()` during that gap — against
  a `this.world` that exists but has no `.data` yet. Both scenes now set
  `this.ready = false` as the first line of `create()`, before any `await`.
  Caught by a THROW in a full menu→race→race-again→menu headless run, not by
  either screen in isolation — worth re-running the whole loop, not just the
  new step, after a change like this.

Verified headlessly, one full loop: menu → Q (records, empty) → ESC → I
(credits, real `credits.json` data, not the fallback) → ESC → START → a
forged lap (saved, `HudBanner` gold) → a forged finish (`isNewBestTotal:
true`, saved to `bestTotalTimes`) → click "R — race again" (fresh race,
laps reset to 0, no stale texture-key warning) → forge a second, better
finish (`isNewBestTotal: true` again) → click "ESC — Main menu" → Q again —
`Records.highScores` correctly showed both forged lap times sorted
(`[11.9, 12.5]`) and both totals sorted (`[50, 58.3]`) → `C` (clear, `confirm()`
stubbed in the harness) → everything empty again. Screenshots of records
(seeded data), credits (real data) and results ("YOU WIN", classification
table, gold "New Best Total!") all match the legacy layout. No console errors
in any run.

**Step 5 is done.**

### 6. rain / night / sound / quality — DONE
All four legacy files load on `phaser.html` **completely unmodified** — same
"port, don't rewrite" rule as `ai.js`. What changed is four small new files
that give them the globals they read and the call sites that drive them.

- `phaser/worldCamera.js` — `camera`/`viewZoom`/`viewWidth()`/`viewHeight()`/
  `ctx`, standing in for game.js's own. `viewZoom` is pinned at 1 — there's no
  free camera on this page — so `camera.x/y` (world scroll) and `camera.width/
  height` (CSS px) are all `rain.js`/`night.js` need, and `RaceScene.update()`
  keeps `camera.x/y` in step with `cameras.main.scrollX/Y` every frame.
  `ctx = UI.ctx`: both files draw *over* the whole scene, which is exactly what
  the overlay canvas already sits on top of.
- `phaser/raceConditions.js` — the ported `scheduleWeather`/`scheduleNight`/
  `applyWeatherForLap` (game.js:1155-1200), keyed off the same "free"/"race5"/
  "race10" id PHASER_MODES already carries rather than a `gameMode` global
  RaceLaps deliberately doesn't have. It also declares `hasStarted`/`isMenu`/
  `gameMode`/`weatherWetFromLap`/`weatherWetToLap` as the same bare globals
  game.js itself uses — `Rain.drawHUD()`'s pre-race forecast line reads all
  five directly, unmodified, and `weatherWetFromLap`/`weatherWetToLap` **are**
  `RaceConditions`'s own state (not copies kept in sync), so scheduling and the
  HUD read the identical value with no per-frame sync code.
- `phaser/renderScale.js` grew `MAX_DPR`/`currentMaxDpr()` (ports game.js's own
  cap) and a global `resizeCanvas()` that re-runs `RenderScale.apply()` against
  whichever scene last called it — the exact function name `quality.js`'s own
  `Quality._commit()` calls, unmodified, to push a resolution change. `apply()`
  also keeps `camera.width/height` current and calls `Night.resize()`, the same
  job `resizeCanvas()` does in game.js.
- `RaceScene` — `Night.buildLights()` after `worldTrack` is set; puddles
  **before** the cars, night's veil/lamps and rain's tint/drops **after**, in
  the same order game.js's own gameLoop draws them; `Quality.sample()`/
  `Rain.update()`/`Night.update()` every frame; P/N as manual toggles, same
  guard as game.js (never in a menu, always in a race); a lap-number watch that
  calls `applyWeatherForLap()` the same two places game.js's `isPlayer` branch
  of `updateLapCounter` does (the gate arming, and every completed lap);
  `Sound.update()` fed the player's own state every frame, and a
  `matter.world.on("collisionstart", …)` listener that calls `Sound.impact()`
  for car-to-car pairs only (`pair.collision.depth`, the closest analog to
  `resolveCollision()`'s own push-based force now that Matter resolves contacts
  itself — see matterCar.js's header).
- `phaser/soundHooks.js` — `Sound.load()` once, plus a page-wide `keydown`/
  `mousedown` → `Sound.unlock()` and `M` → `Sound.toggleMute()`, matching
  game.js's own window/canvas listeners. One set for the whole page rather than
  one per scene, since MenuScene, RaceScene and RecordsScene all want the same
  behaviour. The menu's own `M` row (`menuScreen.js`, stubbed since step 5) now
  calls `Sound.toggleMute()` on click instead of logging "not yet ported".
  `menuScene.js` also calls `Sound.update(0, 1, false, 0, false)` once on
  entry, so leaving a race silences whatever engine/tire note it left playing.

**Puddles are the one thing that doesn't go through `Rain.drawPuddles()`.**
That function manually undoes the camera transform to draw in screen space,
which is right for a single canvas but wrong here: the UI overlay canvas sits
on top of *everything* Phaser draws, so anything painted there lands over the
cars, not under them, the way the legacy loop draws puddles before its own car
sprites. `RaceScene.drawPuddles()` instead draws `Rain.puddles` as a Phaser
Graphics object at depth 1 (track is 0, cars are 2) — Phaser's own camera
scroll/zoom applies for free, no manual transform needed, and the depth keeps
a car legitimately driving over a puddle in front of it.

**Two real bugs, not design questions, turned up under headless testing —
both would have shipped invisibly because nothing exercised these paths before
this step:**
- `Rain.drawHUD()` throws (`hasStarted is not defined`) the instant rain or
  night are on, because it reads three legacy globals (`hasStarted`/`isMenu`/
  `gameMode`) this page never had. Worse than a visual bug: the throw happens
  inside `RaceScene.update()`, which Phaser calls from inside its own render
  step — an uncaught exception there kills the scene's `requestAnimationFrame`
  chain outright, not just that frame. Headless caught it in 12 ticks; a
  virtual-time-budget screenshot alone would have shown a plausible-looking
  frame and missed it, because the *next* frame simply never happens and the
  screenshot is of the last one that worked. Fixed by the `raceConditions.js`
  globals above.
- **The UI overlay canvas was never cleared.** Every other screen on it
  (menu, records, results, credits) covers the full canvas with an opaque-ish
  fill every frame, which incidentally erases the previous one — the race HUD
  never did, because it was never meant to (it only owns its own widgets, and
  the game underneath has to show through). That was fine while the only
  things drawn there were small, self-covering widgets; the moment rain's
  screen tint and night's veil joined them — full-viewport, semi-transparent,
  drawn *every frame* — the frame would have compounded into black within
  about a second, never fully clearing. `RaceScene.update()` now clears the
  overlay once a frame before drawing on it, ahead of the tint/veil/drops.

**Verified headlessly**, on `phaser.html?debug=1`-equivalent forced state
(`RaceLaps.target` zeroed before `scene.start("race", …)`, since it defaults to
5 and would otherwise roll real weather/night before a harness gets a say):
- A day run (rain/night both explicitly off) and a rain+night run (both forced
  on) each ran 311 update ticks with an empty `errors` array and sane
  in-race numbers (grid, laps, standings) — the rain+night run additionally
  reporting `puddles: 40` (the shipped quota) and `lights: 21` (this circuit's
  floodlight count from `buildLights()`).
- `RaceConditions` checked directly against a seeded `Math.random`: `race5`'s
  50/50 wet roll and 30% night roll both land exactly on the documented
  thresholds; `race10`'s wet window matches `1+floor(rand·6)` /
  `4+floor(rand·3)` at both ends of the roll; `applyWeatherForLap` toggles rain
  on exactly at `wetFromLap` and off exactly at `wetToLap`, holding wet
  in between.
- Screenshots at both dpr 1: a clean day frame (HUD, minimap, kerbs, no menu
  bleed-through — an earlier harness bug called `SceneManager.start()`
  directly instead of the scene's own `this.scene.start()`, which doesn't stop
  the caller and left the menu drawing over the HUD every frame; fixed in the
  harness, not the game) and a rain+night frame showing puddles, drops, the
  floodlight pools cutting through the veil with correctly-tinted grass
  underneath, headlight/taillight glow, and both HUD labels ("NIGHT RACE",
  "WET TRACK").
- `Sound`: a synthetic keydown unlocks a real (suspended, as headless always
  leaves it) `AudioContext`; `Sound.update()`/`Sound.impact()` run without
  throwing; `M` flips `Sound.muted` and persists it to `localStorage`.
- `Quality`/`RenderScale`: forcing `Quality.cap` down and calling
  `Quality._commit()` directly (the exact path a slow-frame verdict takes)
  correctly drops `renderDpr` through the global `resizeCanvas()` and back up
  again on release, with `camera.width` unchanged (CSS px, not device px) and
  no exception — confirming `Night.resize()` survives a mid-race resolution
  change. A dispatched `resize` event round-trips through `RenderScale.apply()`
  + `Quality.viewportChanged()` the same way.

**Frame cost, measured, not assumed** — the whole point of the risk flagged at
the top of this step. `--virtual-time-budget` fakes `performance.now()` (see
the headless-timing-harness memory), so this used real wall-clock time around
the whole headless process instead: `Quality.auto = false` pinned to a fixed
`renderDpr` (1, since the SwiftShader probe caps it there regardless), an
identical boot-and-spawn sequence, then 360 trapped-`requestAnimationFrame`
ticks either left alone or with rain/night forced to full intensity before the
tick loop starts — same machine, same page, only the forced state differs, 3
runs each (1280×800, `--disable-gpu`, software raster):

| configuration | wall time (360 ticks) | delta vs day |
|---|---|---|
| day (dry, no night) | 9.22s | — |
| rain only | 9.59s | +0.37s → **+1.03 ms/tick** |
| night only | 10.80s | +1.58s → **+4.39 ms/tick** |
| rain + night | 11.03s | +1.81s → **+5.03 ms/tick** |

Run-to-run spread was under 0.1s per config (9.15-9.26s day, 10.78-10.82s
night) — the deltas are well clear of noise. Night dominates, rain is cheap
(matches [[canvas-cruiser-perf-baseline]]'s finding that drops/puddles/tint
together are under 1ms on the legacy loop), and rain+night together is close
to additive rather than compounding (5.03ms vs. 5.42ms summed separately) —
there's no sign of the interaction cost that made the legacy loop's first,
two-pass night build measure 3x the whole day frame. That build was
`lighter`-composited light on top of a *separate* `destination-out` veil, two
full-viewport passes; `night.js`'s actual code — reused verbatim here, not
reimplemented — was already rebuilt as the one half-resolution layer
[[night-one-layer]] describes, and this measurement is that same design
surviving a renderer swap, not a new optimisation.

### 7. Re-tune the AI, then measure — gap accepted, tuning deferred
First measurement (2026-08-14): a legacy-vs-Phaser A/B, same seed, one
deterministic AI car (`skill=1, wander=0, lineOffset=0`, `drive()`'s `player`
argument nulled to kill catchup — see [[ai-wet-margin]]'s harness), Super
Circuit, 100cc, dry, hand-stepped Matter (`scene.matter.world.autoUpdate =
false` — **a plain boolean field on this Phaser 4 build, not the
`setAutoUpdate()` method** [[matter-headless-determinism]] names; that memory
needs correcting) plus `Matter.Engine.update()` on `postupdate`. Legacy:
**10.06–10.16s**, mean 10.10s (matches the neighbourhood of every prior
reference — the harness is trustworthy). Phaser, same everything: **9.79–
9.84s**, mean 9.81s. **The port changed the physics — do not tune AI
constants against this gap, it isn't a driver problem.**

One real bug found and fixed: `MatterCar.step()` sampled off-road drag at a
single centre point (`world.offRoad(body.position.x, body.position.y)`)
instead of porting `wheelOffRoad()`'s 4-corner average (game.js:1659) — a car
clipping the grass with one wheel while its centre stayed on tarmac paid
nothing. Fixed by porting `wheelOffRoad()` verbatim into matterCar.js.
**This did not close the gap** (still 9.82–9.87s after the fix, off-road
frames still 0% against legacy's 1.6%) — worth keeping, but it wasn't the
(main) explanation.

Second hypothesis, checked and ruled out: the legacy harness's
`opponents.length = 1` leaves the other five `AICar` objects with no physical
presence at all — nothing in `opponents` means nothing collides against them.
The Phaser equivalent only stopped *driving* the other five; their Matter
bodies were still live, parked on the grid the test car passes every lap.
Removed with `scene.matter.world.remove(body)` for true parity — no change to
the measured gap.

**Leading unconfirmed hypothesis: a one-frame position-read lag.** Legacy's
`stepCarMotion` blends velocity and moves `entity.x/y` synchronously, in the
same call, so the *next* frame's `ai.js` reads a position that already
includes that motion. `MatterCar.step()` sets velocity via `Body.setVelocity`
(position not yet moved) and writes `entity.x = body.position.x` from
*before* this frame's motion; the advanced position only lands in
`body.position` once the hand-stepped `Engine.update()` runs in `postupdate`,
*after* `scene.update()` (and thus `ai.js`'s decision for this frame) has
already run. `ai.js` is therefore always steering off a position one
integration step older than what the legacy loop gives it. Not proven —
confirming it means reordering `RaceScene.update()` so Matter steps before
`ai.js` reads position, which is more invasive than a formula fix and hasn't
been attempted yet.

**Decided (2026-08-14): accept ~9.8s as the Phaser baseline, on purpose,
without chasing the frame-lag hypothesis.** The gap is real and now measured
three ways (raw, off-road-fix, parked-body-fix) without closing, so it's
being treated as this port's physics baseline rather than a bug to keep
hunting. Actually re-tuning the AI constants against that baseline is
deferred to a later session — do not bump `aiVersion` or touch `ai.js`'s
constants until that session happens. The frame-lag hypothesis is still on
the table if a future session wants to chase it instead, but it's no longer
blocking anything.

### 8. Records migration — DONE, decided in step 5
Confirmed: reset, not namespaced. This was already implemented ahead of
schedule while step 5 built `phaser/records.js` — see "Records, results and
credits — done" above for the reasoning and the headless verification.
`RECORDS_PHYSICS_VERSION` in `records.js` wipes `highScores`/`bestTotalTimes`
once per player on this page's first load and never again. Track and class
ids stayed colon-free and `upgradeKey()`'s legacy paths are untouched.

## Harness gotchas

- Headless Chrome services only three or four real `requestAnimationFrame`
  callbacks and then stops — **Phaser's loop dies with it**. Trap `rAF` onto
  `setTimeout` and hand back to the real one shortly before the capture. Full
  recipe in the headless-testing skill.
- "Shortly before" needs to mean **seconds**, not milliseconds. Restoring the
  real `rAF` 500ms before an 8-second `--virtual-time-budget` capture
  reproducibly rendered only one car out of six — every entity, texture and
  scene-graph field checked out fine on inspection, the compositor output was
  just short. Headless compositing wants several genuine `rAF` ticks to paint
  everything, not the one that happens to land last. Give it 3000ms+. A
  screenshot missing objects the object model swears are there is a
  compositing-timing bug in the harness before it's a rendering bug in the
  page.
- Page `console.log` never reaches stderr here. Report through the DOM and
  `--dump-dom`.
- `phaser.html` appends its `<script>`s from an inline loop, so **none of them
  have run when an injected inline script parses** — a harness that touches
  `RaceScene` at the top level throws a ReferenceError, takes the rAF trap and
  every reporter down with it, and leaves an empty page with no console to say
  so. Patch on `window.load`: phaser.html's own listener is registered first, so
  the game exists and `create()` has not finished.
- The scene reads its input off `this.keys`, so a harness can drive the player
  by replacing that object with `{UP:{isDown},…}` — no synthetic key events, and
  an `AICar` mirrored onto the player entity makes a six-car race run itself.
- Stale `python3 -m http.server` processes from old sessions squat on
  8123/8124/8137. A silent bind failure just serves the *old* directory, so you
  get 404s on a file you can see on disk. Check `ss -ltnp` before trusting a
  port.
- Set `Quality.auto = false` in anything measuring frame cost.

## Session prompts

One per step, to paste at the start of a fresh session. Each is written to be
self-contained — a cold session has CLAUDE.md and the skills, but not the
conversation this plan came out of.

**Step 1 — starting grid**
```
Continue the 0.14.0 Phaser port on branch 0.14.0. Read PORTING.md, then do step 1:
the starting grid and spawn contract. raceScene.js currently fakes it with
findRoad() — a tarmac scan facing north. Read the track-authoring skill before
touching anything, then port the real grid, start line and lap gate for
super-circuit. Bump DebugConfig.spawnVersion if a shipped grid changes. Verify
headlessly that cars spawn on the grid in the right order and facing the right
way, and show me a screenshot.
```

**Step 2 — opponents on the same machinery**
```
Continue the 0.14.0 Phaser port on branch 0.14.0. Read PORTING.md, then do step 2:
run the AI opponents through MatterCar.step, the same call the player uses, way to 
make ai slower than player is still needed, with
stats from applyCarStats and per-car differences only in entity.mods. ai.js
should need no physics changes — drive() already returns the input shape
MatterCar.step takes. The rule in CLAUDE.md is load-bearing: a stat, force or
penalty on one and not the other is how the opponents stopped being real
competitors. Verify headlessly that opponents drive a lap without leaving the
road, and that nothing about their handling differs from the player's.
```

**Step 3 — laps and standings**
```
Continue the 0.14.0 Phaser port on branch 0.14.0. Read PORTING.md, then do step 3:
port trackProgress and updateLapCounter into the Phaser scene. They only read
worldTrack.data.waypoints and entity x/y, so this should be cheap — but the
player and every opponent must go through the same call, and entities need
laps / onFinishLine / passedGate / finished / finishPosition / raceStart. Check
the track-authoring skill for the gate contract. Verify headlessly that a full
race counts laps correctly and the finishing order matches the on-track order.
```

**Step 4 — real car sprites**
```
Continue the 0.14.0 Phaser port on branch 0.14.0. Read PORTING.md, then do step 4:
replace the placeholder rectangles in raceScene.js with CarSprites. It bakes per
livery in device pixels, so whatever now owns the render scale must call
CarSprites.invalidate() when that moves, and the cache key must still include
Night.liveryDim(). Verify headlessly with a screenshot at dpr 1 and again with
--force-device-scale-factor=2.
```

**Step 5 — screens.js**
```
Continue the 0.14.0 Phaser port on branch 0.14.0. Read PORTING.md, then start step
5: porting screens.js. This is the biggest step — menu, HUD, minimap, records,
results, credits, and the hit-testing that makes them clickable. Before writing
code, recommend whether these become Phaser UI scenes or stay a 2D overlay
canvas, and tell me the trade-off. Keep the credits roll data-driven from
credits.json with its built-in fallback. Do the menu first and verify it
headlessly before moving on.
```

**Step 6 — rain, night, sound, quality**
```
Continue the 0.14.0 Phaser port on branch 0.14.0. Read PORTING.md, then do step 6:
re-integrate rain.js, night.js, sound.js and quality.js with the Phaser render
path. Keep the rain/engine-class rule — expose scalars, never assign to
car.driftGrip or car.maxSpeed. night.js is the risky one: the dark and the light
must stay ONE half-resolution layer blitted once, because additive-plus-veil
measured 3x the whole day frame. Measure the night frame cost against the day
frame and report the numbers — do not assume it is fine.
```

**Step 7 — re-tune the AI**
```
Continue the 0.14.0 Phaser port on branch 0.14.0. Read PORTING.md, then finish step
7: re-tune the AI against the Phaser physics baseline. The physics gap itself is
already measured and DECIDED — accept ~9.8s (Super Circuit, 100cc, dry, one
deterministic AI car) as the Phaser baseline, do not re-open the frame-lag
hypothesis unless I ask for it. Use the balance A/B harness approach from my
memory — seed Math.random or the comparison is noise. Tune ai.js's constants
against the ~9.8s baseline (not the legacy 10.10s reference) and bump
DebugConfig.aiVersion once the tuning changes meaning.
```

**Step 8 — records migration** — DONE, decided during step 5 (reset, not
namespaced). See `phaser/records.js`'s `RECORDS_PHYSICS_VERSION`. No prompt
needed.

## Housekeeping

- `BUILD` is `0.14.0-dev`. Set it to `0.14.0` at release — it is the version,
  the window title and the cache buster. Anything newly fetched or linked needs
  the same `?v=` stamp.
- Update CLAUDE.md's file table as files move; it still describes the legacy
  architecture.
- `vendor/phaser.min.js` adds ~1.4 MB to first load on GitHub Pages
  (`max-age=600`, headers not configurable). Accepted cost of vendoring.
