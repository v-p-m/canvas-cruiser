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

### 3. Laps and standings
`trackProgress`, the gate and the tile-9 test came across with step 1 —
`RaceGrid.progress/updateGate/onStartLine`, and step 2's harness counts laps by
watching `progress` wrap, which is not the same thing and is not shipped. What
is left is `updateLapCounter` and the standings. Cheap (see above), but the player and every opponent must go
through the *same* call, as they do now. Carry `laps`/`onFinishLine`/`passedGate`/`finished`/`finishPosition`/
`raceStart` on the entities.

### 4. Cars that look like cars
Swap the placeholder rectangles for `CarSprites`. It bakes to a canvas per
livery in **device pixels**, so whatever replaces `resizeCanvas()`'s role must
still call `CarSprites.invalidate()` when the render scale moves, and the cache
key still has to include `Night.liveryDim()`.

### 5. screens.js
The big one — menu, HUD, minimap, records, results, credits, and the
hit-testing that makes them clickable. Decide up front whether these become
Phaser scenes or stay a 2D overlay canvas; a UI scene per screen is the
idiomatic answer and keeps the input handling Phaser's problem. The credits
roll is data (`credits.json`, with a built-in fallback) — keep it that way.

### 6. rain / night / sound / quality
- `rain.js` and `engineClass.js` keep their rule: expose scalars, never assign
  to `car.driftGrip` / `car.maxSpeed`. `MatterCar.step` already calls
  `Rain.gripScale()` and `Rain.frictionBonus()` correctly.
- `night.js` is the risky one. The dark and the light are **one** half-res
  layer blitted once — an additive pass plus a veil measured 3x the whole day
  frame. Re-implementing it over Phaser's renderer must preserve that, and must
  be re-measured, not assumed.
- `quality.js` owns `Quality.cap`; whatever replaces `resizeCanvas()` reads it.
- `sound.js` still needs `Sound.unlock()` from a user gesture.

### 7. Re-tune the AI, then measure
Only once the above is stable. Re-measure reference lap times against the
recorded ones and re-tune. Bump `DebugConfig.aiVersion` (debugConfig.js:60) or
anyone who has opened the panel keeps the old balance.

### 8. Records migration — open decision
`highScores` and `bestTotalTimes` are keyed `trackId:classId`. Lap times are
**not comparable** across a physics change. Either namespace the keys (so
pre-0.14 records survive but are shown separately) or reset them. Not yet
decided — needs a call before release. Whatever happens, track and class ids
must stay colon-free, and `upgradeKey()`'s existing legacy paths must keep
working.

## Harness gotchas

- Headless Chrome services only three or four real `requestAnimationFrame`
  callbacks and then stops — **Phaser's loop dies with it**. Trap `rAF` onto
  `setTimeout` and hand back to the real one shortly before the capture. Full
  recipe in the headless-testing skill.
- Page `console.log` never reaches stderr here. Report through the DOM and
  `--dump-dom`.
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
Continue the 0.14.0 Phaser port on branch 0.14.0. Read PORTING.md, then do step 7:
re-measure and re-tune the AI against the new physics. Use the balance A/B
harness approach from my memory — seed Math.random or the comparison is noise.
Compare measured lap times against the recorded reference times before re-tuning
anything, and tell me whether the port changed the physics before you change any
constants. Bump DebugConfig.aiVersion if the tuning changes meaning.
```

**Step 8 — records migration**
```
Continue the 0.14.0 Phaser port on branch 0.14.0. Read PORTING.md, then do step 8:
the records migration. highScores and bestTotalTimes are keyed trackId:classId
and lap times are not comparable across the physics change. Lay out the options
— namespace the keys so pre-0.14 records survive but display separately, versus
reset — with the consequences of each, and recommend one. Don't implement until
I choose. Track and class ids must stay colon-free and upgradeKey()'s existing
legacy paths must keep working.
```

## Housekeeping

- `BUILD` is `0.14.0-dev`. Set it to `0.14.0` at release — it is the version,
  the window title and the cache buster. Anything newly fetched or linked needs
  the same `?v=` stamp.
- Update CLAUDE.md's file table as files move; it still describes the legacy
  architecture.
- `vendor/phaser.min.js` adds ~1.4 MB to first load on GitHub Pages
  (`max-age=600`, headers not configurable). Accepted cost of vendoring.
