# Canvas Cruiser v0.7.0
A minimalist top-down racing game built with pure **HTML5 Canvas** and **JavaScript**.

## Controls
| Key | Action |
|-----|--------|
| ↑ / ↓ | Accelerate / Brake & Reverse |
| ← / → | Steer |
| R | Reset race |
| Q | Top 5 best laps |
| C | Clear records (on leaderboard screen) |
| ESC | Back to menu |

## Features
- Tile-based track loaded from `track.json`
- Drift physics with tire scrub and velocity blending
- Skid marks baked to offscreen canvas
- AI opponents with waypoint navigation and corner braking
- Basic car vs car collision resolution
- Lap timing with top 5 leaderboard (persisted to localStorage)
- Retro arcade countdown lights on race start

## Tech Stack
- HTML5 Canvas API
- Vanilla JavaScript (no frameworks)
- CSS3
