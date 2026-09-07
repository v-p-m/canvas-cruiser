# Canvas Cruiser v0.21.0
A minimalist top-down racing game built with pure **HTML5 Canvas** and
**JavaScript** — no build step, no `package.json`, no dependencies to install.

Pick a circuit — **Super Circuit**, **Snake Valley**, **Coastal Sprint**,
**Redrock Sweeper** or **Ironwood Marathon** — an engine class — **60cc**,
**100cc** or **250cc** — and a mode — **Free Drive**, **5 Lap Race**,
**10 Lap Race** or the **4-Race Series** — with the mouse or the keyboard.

## Two pages

| Page | What it is |
|---|---|
| [index.html](index.html) | **The game.** Runs on vendored [Phaser 4](vendor/phaser.min.js) with Matter physics. |
| [editor.html](editor.html) | **The authoring tools** — the track and waypoint editors, plus live physics/AI tuning sliders, that built every circuit in [tracks/](tracks/). |

## Running it
The track files are fetched at startup, so opening either page straight from
disk (`file://`) won't work. Serve the folder instead:

```bash
python3 -m http.server 8123
# then open http://localhost:8123/            — the game
#      or http://localhost:8123/?debug=1     — with the AI ring, lap gate and a debug panel
#      or http://localhost:8123/editor.html  — the track and waypoint editors
```

## Controls
| Key | Action |
|-----|--------|
| ↑ / ↓ | Accelerate / Brake & reverse; on the menu, move between rows |
| ← / → | Steer; on the menu, change the highlighted row |
| ENTER | Start (the menu's START row does the same) |
| ESC | Pause to the menu; again to resume. On the results screen, back to the menu |
| R | Race again (from the results screen) |
| Q | Records (best laps and race totals) |
| C | Clear records (on the records screen) — remappable; the button stays |
| G | Garage (spend race points on part upgrades) |
| X | Abandon the championship in progress (from the menu) |
| P | Toggle rain (Free Drive) |
| N | Toggle night (Free Drive) |
| M | Mute / unmute |
| K | Remap the driving keys (from the menu) |
| I | Credits (from the menu) |

Steering and throttle keys are remappable and persist across reloads, and
since 0.21.0 that includes `B`/`C`/`E`/`T`/`Z`. The track/waypoint editors and
the tuning sliders moved to `editor.html` in 0.14.0, so those five are free
here — the game's only debug surface is the `?debug=1` URL flag above. They
still drive the tools on the editor page, so a control bound to one of them
falls back to its arrow-key default over there (and only there: the binding
itself is kept).

### Editor page (`editor.html`)
Opens straight into the waypoint editor with a free camera (drag the car
around a still track instead of following it).

| Key | Action |
|-----|--------|
| Arrows | Pan the camera |
| +/- or mouse wheel | Zoom; `0` resets to 1x |
| T | Toggle the tile map editor |
| Z | Undo the last waypoint edit |
| P | Export the loaded track back out to its file |
| C | Live physics/AI/spawn tuning sliders |
| B | Toggle the editors off entirely |

A one-opponent **pace car** drives the waypoint ring live as it's edited, so a
line change is visible immediately, with the rest of the field parked and out
of the way.

## Credits
`I` on the menu opens the credits popup. The roll lives in
[credits.json](credits.json) — add testers or supporters there and reload; no
code change is needed. Each section is a heading plus any number of names:

```json
{ "role": "Testing", "names": ["Aino K.", "Bertil", "Cheng Wei"] }
```

Long lists wrap and, if they outgrow the window, scroll on the mouse wheel or
the arrow keys. Sections with no names yet are skipped, and if the file is
missing or malformed the game falls back to a built-in roll.

## Features
- Five circuits — the boxy **Super Circuit**, the flowing **Snake Valley**,
  the sweeping **Coastal Sprint**, the long-straight **Redrock Sweeper** and
  the switchback **Ironwood Marathon** — a 9,000px lap, a fifth longer than
  Snake Valley and better than double Redrock Sweeper — in [tracks/](tracks/),
  each with its own starting grid and its own records table
- Three engine classes — 60cc Cadet, 100cc Formula and 250cc Superkart. The
  whole field scales, so the racing stays close, but steering rate and grip do
  not: the Superkart carries speed through exactly the same corners that a
  Cadet has to brake for
- Tile-based tracks loaded from JSON, rasterised and blurred into a
  smooth road field — the artwork and the collision read the same field, so
  corners are round and what you see is what you drive on
- Matter.js physics under the game, with the handling model ported verbatim
  from the original hand-rolled loop — there are deliberately **no walls**;
  running wide costs grip and time through off-road drag, never a barrier
- A car that slides. Since 0.20.0 the grip the tires hold onto their heading
  with is a third lower, which lets the car take a third more lateral velocity
  through the same corner and gives it a third longer to gather that back up —
  the difference between a car that turns and a car you have to catch. The wet
  slides further again, in step. Every lap and total-time record was cleared
  once on the change: the corners are not the same manoeuvre any more
- Car-to-car contact that actually costs something: a hit shoves speed into
  the car it lands on, scrubs speed off both cars, spins the one hit
  off-centre, and leaves it unsettled with reduced grip for a moment —
  recoverable, not a hard cap
- A hard enough hit breaks a wing, and lesser ones wear it down — permanent for
  the race, unlike the temporary cost above. A broken front wing costs turn, a
  broken rear costs grip; every car breaks on the same hit and pays the same
  for it, and condition is always shown, on the car, the HUD and the debug
  panel
- Drivable dirt run-off outside the kerbs, with a noise-warped edge that never
  lines up with the tile grid
- Dynamic weather — rain cuts grip for player and AI alike, adds hydroplaning
  over puddles, draws splashes and screen streaks, and is scheduled per race
  (a coin-flip for 5 laps, a rain window for 10)
- Night races, rolled independently of the weather, so a race can be dry-day,
  wet-day, dry-night or a night thunderstorm. Floodlights are placed around
  each circuit's verges automatically, and every car runs headlights and tail
  lights
- Skid marks laid down as the tires actually track over a frame, not stamped
  where they end up
- A flag marshal on the verge at the start line, who stands there all race with
  the flag at their side and waves the chequered flag from the moment the
  leader starts the final lap. Their post is found off each circuit's own road
  field, so a new track gets one without being re-authored
- AI opponents that drive the player's own car through the player's own
  physics — a resampled, kerb-cleared line around the waypoint ring, with
  corner braking and catch-up/lift pacing. They turn the wheel rather than
  flicking it from lock to lock: the driver asks for a steering angle, through
  the same rate-limited ramp the keyboard feeds, so a corner is one held input
  instead of a square wave
- Traffic read off that racing line rather than off the bonnet — how far ahead
  a car is *along* the line and how far *across* it — and answered the two ways
  a driver can answer it: a lateral dodge that stays on the road, and a lift
  that measures out the closing distance the same way corner braking measures
  out a corner. Ninety per cent less contact than the field that preceded it
- A real race: opponents are lap-counted and ranked against you, your position
  shows in the HUD, and finishing brings up the full classification. Cars still
  circulating when you take the flag are placed where they stood. The clock on
  that table is one race clock, started with the lights for the whole field, so
  the totals rank the field the same way the positions do — you start at the
  back of the grid, and the time it takes you to come through counts
- ESC mid-race freezes the race rather than throwing it away: the menu comes
  up over it, ESC again drops you back in exactly where you left, and neither
  the race clock nor the lap you were on is charged for the time you were
  away. Records, the garage and the credits are all reachable and hand back to
  it; only starting another race gives it up
- The start line is as wide as the road plus its verges, so clipping the grass
  as you cross — going round the outside of the pack off the start, or running
  wide out of the last corner — costs grip and not the whole lap
- Synthesised sound — a geared engine note, tire squeal that tracks how far the
  car is sliding, and impact thuds. No audio files; it is all WebAudio
- Minimap with live car positions and the current viewport
- Renders at the display's real pixel density, with an automatic quality
  governor that steps the render scale down on slow hardware
- Lap timing with a top-5 leaderboard and best total times, kept per circuit
  and per engine class (persisted to localStorage)
- A **Garage** (`G` from the menu): points earned by finishing a lap race —
  top 3 only — buy up to three tiers each of Engine (top speed), Gearbox
  (acceleration) and Tires (grip) for the player's car, persisted across
  sessions — and **the field develops with you**: buy a part and the grid
  answers with machinery of its own, the front row taking three quarters of
  what you fitted and the backmarker half of that, so what the points buy is a
  real edge rather than a parade. The rivals' development moves speed, accel
  and grip only — never steering, which would have the whole field taking
  corners flat — and while your car is stock the grid is exactly the grid it
  always was
- A **4-Race Series**: a championship over four circuits, picked as a MODE.
  The calendar starts at the circuit you selected and takes in the next three,
  the engine class is locked for all four rounds, and **every car scores** —
  10-8-6-4-2-1 by finishing position, so the title is a fight with the field
  and not a solo time trial. Ties break on wins, then best finish, then a
  countback through the rounds. Between rounds the standings screen shows the
  whole championship (with each round's finishing position) and opens the
  garage, so the points a round pays out can be spent on the car before the
  next one starts; winning the title pays a bonus on top. A series survives
  ESC and a reload — the menu offers to continue it, and `X` abandons it
- Retro arcade countdown lights on race start
- Built-in track and waypoint editors, plus live physics/AI tuning sliders, on
  their own page: `editor.html`. See **Editor page** above
- `?debug=1` on the game itself draws the AI ring, the lap gate and the start
  line, with a live panel for frame cost, render scale, conditions and the
  field's lap times

## Tech Stack
- HTML5 Canvas API
- [Phaser 4](vendor/phaser.min.js) + Matter physics (vendored, game page only)
- Vanilla JavaScript (no frameworks, no build step, no installed dependencies)
- CSS3
