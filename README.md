# Canvas Cruiser v0.10.0
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
| M | Mute / unmute |
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
- A real race: opponents are lap-counted and ranked against you, your position
  shows in the HUD, and finishing brings up the full classification. Cars still
  circulating when you take the flag are placed where they stood
- Car vs car collision resolution
- Synthesised sound — a geared engine note, tire squeal that tracks how far the
  car is sliding, and impact thuds. No audio files; it is all WebAudio
- Minimap with live car positions and the current viewport
- Grip is sampled under all four wheels, so dropping two onto the dirt costs
  about half of what a full excursion does
- Renders at the display's real pixel density
- Lap timing with a top-5 leaderboard and best total times (persisted to localStorage)
- Retro arcade countdown lights on race start
- Built-in track and waypoint editors, plus live physics/AI tuning sliders
  (debug mode: `B`, then `T`, `E` or `C`)

## Tech Stack
- HTML5 Canvas API
- Vanilla JavaScript (no frameworks, no build step, no dependencies)
- CSS3
