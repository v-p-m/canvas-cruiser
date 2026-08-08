---
name: headless-testing
description: Verify a Canvas Cruiser change without asking the user to click around — screenshot the menu or a live race, catch JS errors, and drive the game with synthetic input under headless Chromium. Use whenever a visual or runtime change needs checking, or a harness has to measure frame cost.
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

Add keys to taste: `B` debug HUD, then (DEBUG only) `C` tuning sliders, `T`
track editor, `E` waypoint editor; `Q` records, `M` mute, `R` reset, `Escape`
back to menu. A lap takes ~13s of virtual time at 100cc, so budget accordingly
— and the classes move that by their speed scale.

All of the DEBUG keys work **on the start menu as well as in the race**, so
anything about the overlay or the editors can be shot without starting one. An
editor opened there hides the menu until it is closed (`ESC`, its own key, or
`B`); until then the menu's own keys, ENTER included, are dead.

An editor opened from the menu also gets the **free camera** — arrows or a
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
`MAX_DPR` and the `C` panel say. `Quality.status()` reports what it decided and
why; the `B` overlay shows the same line, in red when the raster is software.
