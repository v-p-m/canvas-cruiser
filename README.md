# Canvas Cruiser v0.9.0
A minimalist top-down racing game built with pure **HTML5 Canvas** and **JavaScript**.

Pick a mode in the menu — **Free Drive**, **5 Lap Race** or **10 Lap Race** —
with the mouse or the keyboard.

## Running it
`track.json` is fetched at startup, so opening `index.html` from disk won't
work. Serve the folder instead:

```bash
python3 -m http.server 8123
# then open http://localhost:8123/
```

## Controls
| Key | Action |
|-----|--------|
| ↑ / ↓ | Accelerate / Brake & reverse |
| ← / → | Steer |
| ESC | Pause to the menu; again to resume |
| R | Restart the race |
| Q | Records (best laps and race totals) |
| C | Clear records (on the records screen) |
| P | Toggle rain (Free Drive) |
| K | Remap the driving keys (from the menu) |
| B | Debug overlay |

Steering and throttle keys are remappable and persist across reloads.

## Features
- Tile-based track loaded from `track.json`, rasterised and blurred into a
  smooth road field — the artwork and the collision read the same field, so
  corners are round and what you see is what you drive on
- Drivable dirt run-off outside the kerbs, with a noise-warped edge that never
  lines up with the tile grid
- Drift physics with tire scrub and velocity blending; going off-road scrubs speed
- Dynamic weather — rain cuts grip for player and AI alike, draws puddles and
  screen streaks, and is scheduled per race (a coin-flip for 5 laps, a rain
  window for 10)
- Skid marks baked to an offscreen canvas
- AI opponents with waypoint navigation, corner braking and mutual repulsion
- Car vs car collision resolution
- Lap timing with a top-5 leaderboard and best total times (persisted to localStorage)
- Retro arcade countdown lights on race start
- Built-in track and waypoint editors, plus live physics/AI tuning sliders
  (debug mode: `B`, then `T`, `E` or `C`)

## Tech Stack
- HTML5 Canvas API
- Vanilla JavaScript (no frameworks, no build step, no dependencies)
- CSS3
