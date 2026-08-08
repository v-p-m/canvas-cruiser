---
name: track-authoring
description: Add or edit a Canvas Cruiser circuit — the tile map, the AI waypoint ring, the starting grid, the start line and the lap gate. Use whenever touching anything under tracks/, registering a circuit in TRACKS, moving waypoints or spawns, or debugging laps and race order that disagree with the layout.
---

# Adding a track

One file per circuit in [tracks/](../../../tracks/), carrying its tile `map`, its
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
- **The ring is where the lap is, not where the AI drives.** `ai.js` resamples
  it at 20px, rounds the vertices and then pushes any point that has grass
  within 54px of it back toward the middle, sampling the same road field the
  physics collide against. So a ring does not have to be cut tight to the apexes
  to be quick — the shipped ones were, for a driver that swung wide of
  everything it aimed at, and the driver that replaced it read that as an
  instruction to drive on the kerb. Author the ring for the lap; the line looks
  after itself.
- **The ring must not fold back near itself.** Progress is "nearest segment",
  so where two parts of the lap pass within a car's width — a crossover, a very
  tight hairpin — a car can latch onto the wrong one, which misplaces it in the
  standings as well as at the gate.

`B` then the debug overlay draws all of this: the ring, the gate band, and each
car's projection onto it with its lap percentage. It is the fastest way to see
that a new track's gate landed somewhere sane.
