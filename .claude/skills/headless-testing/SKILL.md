---
name: headless-testing
description: Verify a Canvas Cruiser change without asking the user to click around — screenshot the menu or a live race, catch JS errors, and drive the game with synthetic input under headless Chromium. Use whenever a visual or runtime change needs checking, or a harness has to measure frame cost.
model: sonnet
context: fork
background: false
allowed-tools: Bash, Read, Write, Glob, Grep
---

# Testing changes headlessly

`chromium-browser --headless` is installed and is the way to verify a visual or
runtime change without asking the user to click around. Screenshots are worth
reading — this is a rendering-heavy project and most bugs are visible.

The page loads its track files with `fetch()`, so it must be served over HTTP —
see **Running it** in [CLAUDE.md](../../../CLAUDE.md).

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
synthetic input. `editor/game.js` listens on **`window`**, so events must be dispatched
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
k(200,"ArrowRight"); k(400,"Enter");          // the menu opens on MODE: pick 5 Lap Race, start
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

**Seed the circuit and the class from localStorage, not from arrow keys.** The
menu cursor runs over the picker rows as well as the modes, so which row LEFT /
RIGHT lands on depends on how many presses came before it, and a harness that
counts them breaks the next time a row is added:

```js
localStorage.setItem("track", "valley");
localStorage.setItem("engineClass", "250cc");   // 60cc | 100cc | 250cc
```

Add keys to taste: `Q` records, `I` credits, `K` key bindings, `M` mute, `P`/`N`
rain and night, `R` reset, `Escape` back to menu. A lap takes ~13s of virtual
time at 100cc, so budget accordingly — and the classes move that by their speed
scale.

**The two pages are shot differently.** `index.html` is the game (Phaser), and
its debug view is a URL flag — `?debug=1` — which needs no synthetic input at
all: it draws the ring, the gate and the start line, plus a live panel with the
frame cost and the field's lap times. The editors are not on it.

`editor.html` is the legacy loop and the tools. It opens **straight into the
waypoint editor**, so anything about the editors or the debug HUD can be shot
with no keys at all; `T` switches to the track editor, `C` the tuning sliders,
`B` turns DEBUG back off. While an editor is open it hides the menu, and the
menu's own keys, ENTER included, are dead until it is closed.

The editor page also gets the **free camera** — arrows or a
right-drag pan, the wheel and `+`/`-` zoom, `0` back to 1x. `viewZoom` is a
context scale wrapped around the world pass in `gameLoop`, so world-space
drawing that goes through `- camera.x` follows it without knowing it exists;
anything screen-space (the rain tint, the HUD, the track editor's own palette
and grid) has to stay outside that scale. It is pinned to 1 everywhere else,
including both editors during a race, where you still pan by driving.

A pure-pursuit bot on the player car cannot get round a lap at 250cc, so
anything needing a *completed* player lap has to run at 60cc or 100cc, or drive
the finish through `finishRace()` directly.

Test HiDPI with `--force-device-scale-factor=2`. The CSS-pixel rule that makes
that meaningful is in **Conventions** in [CLAUDE.md](../../../CLAUDE.md).

**Set `Quality.auto = false` in any harness that measures frame cost.** Headless
with `--disable-gpu` reports SwiftShader, so `quality.js` starts the page at dpr
1 and will keep moving the render scale mid-run — an A/B where one side silently
changed resolution is worse than no measurement. Turning it off pins whatever
`MAX_DPR` says (and, on the editor page, the `C` panel). `Quality.status()`
reports what it decided and why; the game's `?debug=1` panel and the editor's
`B` overlay both print that same line — in red, on the editor page, when the
raster is software.

**On `index.html`, hand-pump the loop rather than trapping `rAF`.** One throw
out of `vendor/phaser.min.js` kills Phaser's own loop silently, so stop it and
step it yourself; virtual time keeps driving `setTimeout` after it has given up
on `rAF`.

Two things have to be right or the run is quietly nondeterministic. **The
`Game` is constructed inside `index.html`'s own `load` listener, so its
`TimeStep` does not exist yet when yours runs** — sleeping the loop there is a
no-op, it comes up a few ticks later on the real `rAF`, and its timestamps mix
into yours (the tell is `g.loop.rawDelta` of 0 and a `g.loop.time` in the
hundreds of seconds). Sleep it on the first pump where `g.loop.running` is
true. And **step on `performance.now()`, not a counter you increment**:
`TimeStep.step(t)` takes `delta` from `t - lastTime`, so a `setTimeout(…, 4)`
pumping `t += 16` runs the physics at a quarter speed while the lap clock runs
at full, which reads as "the AI cannot get round".

```js
const g = window.phaserGame;
let asleep = false;
const pump = () => {
  const t = performance.now();          // 16ms of virtual time per callback
  if (!asleep && g.loop.running) {
    asleep = true;
    g.loop.sleep();                     // TimeStep has sleep()/wake()
    g.loop.resetDelta();
  }
  if (asleep) {
    try { g.loop.step(t); } catch (e) { document.title = "THROW " + e.message; }
  }
  if (t < 15000) setTimeout(pump, 16);
};
setTimeout(pump, 16);
```

Done right, `g.loop.delta` reads a flat 16.00 and the frame count matches the
pump count exactly.

**For lap-time A/Bs, measure one car, not the field.** Two things swamp the
signal otherwise: `rollDriver()` re-rolls off a `Math.random()` whose call count
depends on when the track `fetch()` landed, so the field comes up with
different skills between runs even seeded; and car-to-car contact turns a
one-frame start offset into a chaotic ~0.6% spread on the field mean. Pin a
skill-1 driver, `matter.world.remove()` the other bodies, wrap its `drive()` to
pass `null` for the player (which zeroes catch-up and lead-lift), and the same
five laps repeat to ±0.03s — good enough to read a 0.3% change. `CORNER_MARGIN`
and friends sweep without touching `ai.js` in the mirror: `tunedAI()` falls
back to its own constant for every key it does not find, so a one-key
`window.DebugConfig = { values: { aiCornerMargin: 0.58 } }` in `<head>` is a
complete override.

Report the throw through the DOM (`document.title` above, then `--dump-dom`) —
page `console.log` does not reach stderr here. Note also that
`--force-device-scale-factor=2` on the Phaser page is roughly four times the
software-raster work: budget minutes, not seconds, or the screenshot never
lands.

Three more things that only bite on `index.html`:

- **Restoring the real `rAF` wants seconds, not milliseconds.** 500ms before an
  8s capture reproducibly rendered one car out of six with every entity and
  texture checking out on inspection. Give it 3000ms+; a screenshot missing
  objects the object model swears are there is a compositing-timing bug in the
  harness before it is a rendering bug in the page.
- **Phaser's keyboard plugin dispatches off `event.keyCode`**, so a synthetic
  `KeyboardEvent` carrying only `{key}` is received and silently ignored — the
  menu never moves. Send `keyCode`/`which` too. The rebind screen is the
  exception: it listens on the DOM for `e.key`, so it *does* answer a
  `{key}`-only event, which makes a harness look half-broken until you notice
  the two paths differ on purpose. For held driving input, set
  `PlayerInput.down["ArrowUp"] = true` — the same trick as the legacy page's
  `keys[...]`.
- Both pages append their `<script>`s from an inline loop, so **none of them
  have run when an injected inline script parses** — a harness touching
  `RaceScene` at the top level throws a ReferenceError and takes every reporter
  down with it, leaving an empty page and no console to say so. Patch on
  `window.load`: each page's own listener is registered first, so the game
  exists and `create()` has not finished.

Finally: stale `python3 -m http.server` processes from old sessions squat on
8123/8124/8137, and a silent bind failure just keeps serving the *old*
directory — so you get 404s on a file you can see on disk. Check `ss -ltnp`
before trusting a port.
