// Lift for being mis-pointed. This is a recovery term, not a racing line: a
// car that has been shoved or has run wide is aimed somewhere it can't reach
// at speed, and backing off is how it gets its nose round. It used to be 0.5,
// which throttled every ordinary corner entry as well.
//
// Anticipatory corner braking — lifting for the turn angle at the waypoint
// ahead, before arriving — was tried here and is not worth it *in the dry*.
// Every setting of it traded pace against time on the grass at roughly one for
// one, with no knee: measured over a stint, going from no lift at all to a
// full one moved average speed 9.08 to 8.63 px/frame and off-road frames 0.128
// to 0.091. At the dry grip below the cars hold the line flat out, so there is
// nothing to anticipate. 0.15 keeps the recovery case for about a 1% cost.
const HEADING_BRAKE = 0.15;

// Rain. These five are one setting: the first takes grip away and the rest are
// how a driver copes with having less of it. Tuning one alone puts the field
// either in the grass or a second a lap off, so move them together
// and re-measure — see the table at the bottom of this block.
//
// The opponents carry twice the player's grip so they can hold the line flat
// out, and Rain.gripScale() takes the same *fraction* off everyone, which left
// them on rails in the wet while the player was sliding: rain cost them 3% of
// their pace. WET_GRIP takes the rest off, so the back steps out on a wet
// corner the way the player's does.
//
// The other three keep that from simply putting them in the grass, cheapest
// first:
//
//   WET_STEER is more lock, and it is the one that does the work. Holding a
//   wet line is a steering problem, and turning the wheel costs no lap time,
//   where braking costs it directly. It is what lets the grip come out at all.
//   It is scaled by how far the car is *already* sliding, and that shape is
//   not decoration: a flat wet multiplier on turnSpeed steers as hard through
//   an ordinary corner as through a slide, and the cars visibly snap round.
//   Peak turn rate, degrees a frame, is the number to watch — the dry game
//   runs p99 5.1 and never exceeds 6.1, a flat 0.5 multiplier took that to 7.1
//   and 9.5, and ramping it against slip holds 5.6 and 7.3 for the same line.
//   Turned off entirely the wet peaks sit back at dry (4.96 / 6.41), so any
//   sharpness on screen is this term and nothing else here.
//
//   WET_PICKUP is the throttle out of the slide. Speed sheds at 0.12 a frame
//   and rebuilds at 0.05, so a lift is cheap and the twenty frames of crawling
//   back afterwards is what actually costs the lap — several times a wet lap.
//   Paying that back is worth 0.6s a lap and never touches the ceiling, so
//   their top speed in the rain is still their top speed.
//
//   WET_LIFT is the brake, and it goes last because it is the expensive one. It
//   rides on the tires rather than the aim: how far the sideways scrub is past
//   the point where it lays a mark. Heading error was tried first and is the
//   wrong signal — a car is a degree or two off its marker all the way down a
//   straight, so the lift was on everywhere and cost a second a lap braking for
//   corners that weren't there. Slip is only large once the tires have let go.
//
// Wet stint on Super Circuit at 100cc, lap times across the field and off-road
// frames, run against a pacer lapping in 11.4s so the catch-up has a real
// player to measure against:
//
//   before any of this      10.80–11.09   0.031
//   WET_GRIP on its own     10.98–11.30   0.050   ← the failure mode
//   all of it               11.06–11.39   0.023
//
// The grip cut on its own barely costs a lap time and nearly doubles the time
// spent off the road, which is the whole reason the other three exist. Together
// they give up a quarter-second a lap on what the field used to do in the wet,
// spend less time off the road than they did, and slide visibly more.
//
// 250cc is where this matters most and is worth re-checking after any change:
// the same grip carries 35% more speed, and before this the field spent 10–14%
// of a wet lap properly off the road (`offHard`), against 0–1.5% now.
const WET_GRIP = 0.85; // extra grip multiplier when fully wet
const WET_STEER = 0.25; // extra fraction of turn rate at full slide, when fully wet
const WET_PICKUP = 3.0; // extra fraction of the speed pickup rate when fully wet
const WET_LIFT = 0.8; // lift per skid threshold of slip past the deadzone
const WET_LIFT_DEADZONE = 2.0; // slip, in skid thresholds, that isn't yet a slide

// Catch-up, measured as a gap in waypoints along the track rather than in
// straight-line pixels — two cars either side of a hairpin are close in pixels
// and half a corner apart in the race. It only ever adds speed: an opponent
// level with the player no longer lifts off, which is what made them concede
// every overtake the moment the player drew alongside.
const CATCHUP_GAIN = 0.15; // max fraction added to top speed
const CATCHUP_FULL = 2.5; // waypoints behind at which the gain is maxed

// Index of the waypoint nearest a point. Both cars are measured the same way
// so the systematic offset between "closest marker" and "marker being chased"
// cancels out of the gap.
function nearestWaypoint(x, y, waypoints) {
  let best = 0;
  let bestSq = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i].x - x;
    const dy = waypoints[i].y - y;
    const dSq = dx * dx + dy * dy;
    if (dSq < bestSq) {
      bestSq = dSq;
      best = i;
    }
  }
  return best;
}

class AICar {
  constructor(ctx, x, y, color = "#0077ff") {
    this.ctx = ctx;
    this.x = x;
    this.y = y;
    this.color = color;
    this.width = 34;
    this.height = 56;
    this.angle = Math.PI / 2;
    this.speed = 0;
    this.speedMultiplier = 1.0;
    this.currentWaypoint = 0;
    this.turnSpeed = 0.08;
    this.velocityX = 0;
    this.velocityY = 0;
    this.grip = 0.2;
    this.lineOffset = (Math.random() - 0.5) * 40;
    this.startDelay = Math.random() * 400; // ms
    this.baseMaxSpeed = 8.3 + Math.random() * 1.3; // fixed base
    this.maxSpeed = this.baseMaxSpeed;

    // Race state — counted by updateLapCounter in game.js, which drives
    // both the player and every opponent through the same code
    this.laps = 0;
    this.onFinishLine = false;
    this.passedGate = false;
    this.finished = false;
    this.finishPosition = 0;
    this.finishTime = 0;
    this.raceStart = 0;
  }

  applyRepulsion(others, delta = 1) {
    const REPULSION_RADIUS = DebugConfig.values.aiRepulsionRadius; // 120 - px — start pushing apart at this distance
    const REPULSION_FORCE = DebugConfig.values.aiRepulsionForce; //0.3 - how strongly they push apart

    others.forEach((other) => {
      if (other === this) return;

      const dx = this.x - other.x;
      const dy = this.y - other.y;
      const distSq = dx * dx + dy * dy;

      if (distSq < REPULSION_RADIUS * REPULSION_RADIUS && distSq > 0) {
        const dist = Math.sqrt(distSq);
        const strength = (1 - dist / REPULSION_RADIUS) * REPULSION_FORCE;

        // Push this car away from other
        this.velocityX += (dx / dist) * strength * delta;
        this.velocityY += (dy / dist) * strength * delta;
      }
    });
  }

  update(waypoints, isRacing, playerX, playerY, others, delta = 1) {
    if (!isRacing || !waypoints || waypoints.length === 0) return;

    // Burn down the start delay before moving
    if (this.startDelay > 0) {
      this.startDelay -= (delta / 60) * 1000; // convert delta frames to ms
      return;
    }

    let current = waypoints[this.currentWaypoint];
    let next = waypoints[(this.currentWaypoint + 1) % waypoints.length];

    const dx = current.x - this.x;
    const dy = current.y - this.y;
    const distSq = dx * dx + dy * dy;

    // Advance once, here. There used to be a second check at the bottom of
    // this function testing the *same* distSq against a tighter radius, so
    // any approach inside 80px burned two waypoints in one frame and the
    // car cut the corner that followed.
    if (distSq < 120 * 120) {
      this.currentWaypoint = (this.currentWaypoint + 1) % waypoints.length;

      // Recalculate current and next after advancing
      current = waypoints[this.currentWaypoint];
      next = waypoints[(this.currentWaypoint + 1) % waypoints.length];
    }

    // Perpendicular offset for varied racing line. Aiming anywhere between
    // this marker and the next one was tried, to make the cars turn in early;
    // on a track this narrow it just cuts the apex onto the inside grass and
    // trebled the time they spent off the road.
    const perpX = -(current.y - next.y);
    const perpY = current.x - next.x;
    const perpLen = Math.sqrt(perpX * perpX + perpY * perpY) || 1;

    const targetX = current.x + (perpX / perpLen) * this.lineOffset;
    const targetY = current.y + (perpY / perpLen) * this.lineOffset;

    // Sideways scrub, in units of the slip that lays a skid mark. Both wet
    // responses hang off this one number, and WET_LIFT_DEADZONE is the hinge
    // between them: the extra lock ramps in up to it, and past it — the tires
    // are visibly gone by then — the car also lifts.
    const slipRatio = lateralSlip(this) / skidThreshold(this);

    // Steering
    const targetAngle = Math.atan2(targetX - this.x, -(targetY - this.y));
    const angleDiff = Math.atan2(
      Math.sin(targetAngle - this.angle),
      Math.cos(targetAngle - this.angle),
    );
    this.angle +=
      angleDiff *
      this.turnSpeed *
      (1 +
        Rain.intensity *
          WET_STEER *
          Math.min(1, slipRatio / WET_LIFT_DEADZONE)) *
      delta;

    // Rubber banding — must be declared before use
    let rubberBand = 1.0;
    if (playerX !== undefined && playerY !== undefined) {
      const n = waypoints.length;
      const mine = nearestWaypoint(this.x, this.y, waypoints);
      const theirs = nearestWaypoint(playerX, playerY, waypoints);
      let gap = (((mine - theirs) % n) + n) % n;
      if (gap > n / 2) gap -= n; // signed — negative is behind the player
      if (gap < 0) {
        rubberBand = 1 + Math.min(-gap / CATCHUP_FULL, 1) * CATCHUP_GAIN;
      }
    }

    // How far off the tarmac we are, 0..1 — averaged over the four wheels
    // and smooth across the road edge, the same measure the player's drag
    // uses. Check this FIRST, before decaying the multiplier.
    const offRoad = wheelOffRoad(this);

    // Ceiling on speed: 1.0 on the racing surface, 0.45 fully into the
    // grass, and everything in between out at the edges.
    const ceiling = 1 - 0.55 * offRoad;
    if (this.speedMultiplier > ceiling) {
      this.speedMultiplier = ceiling;
    } else {
      this.speedMultiplier = Math.min(
        ceiling,
        this.speedMultiplier + 0.02 * delta,
      );
    }

    // Speed — lift for being mis-pointed, and in the wet for sliding, then
    // apply rubber band and multiplier.
    const headingErr = Math.min(Math.abs(angleDiff) / Math.PI, 1);
    // Floored at zero: the two terms together can exceed 1, and a car pointing
    // far enough the wrong way — spun, or shoved into a wall — would otherwise
    // be given a negative target speed and reverse out of it.
    const cornerFactor = Math.max(
      0,
      1 -
        headingErr * HEADING_BRAKE -
        Rain.intensity * WET_LIFT * Math.max(0, slipRatio - WET_LIFT_DEADZONE),
    );

    const targetSpeed =
      this.maxSpeed * cornerFactor * rubberBand * this.speedMultiplier;
    // Asymmetric: shedding speed is a reaction to something that has already
    // happened — grass under the wheels, a shove dropping the multiplier — so
    // it settles quickly, while the pickup stays gradual enough to look driven.
    // Wet, that slow pickup is what a lift actually costs — see WET_PICKUP.
    const rate =
      targetSpeed < this.speed
        ? 0.12
        : 0.05 * (1 + Rain.intensity * WET_PICKUP);
    this.speed += (targetSpeed - this.speed) * rate * delta;

    // Velocity-based movement. Rain scales grip here rather than being
    // written onto this.grip, so the tuning sliders stay in charge of the
    // dry value.
    const wetGrip =
      this.grip * Rain.gripScale() * (1 - Rain.intensity * (1 - WET_GRIP));
    const targetVx = Math.sin(this.angle) * this.speed;
    const targetVy = -Math.cos(this.angle) * this.speed;
    // Blend toward stronger grip off-track so velocity catches down to
    // targetSpeed quickly once we're properly in the grass
    const grassGrip = Math.min(wetGrip * 4, 0.5);
    const effectiveGrip = wetGrip + (grassGrip - wetGrip) * offRoad;
    this.velocityX += (targetVx - this.velocityX) * effectiveGrip * delta;
    this.velocityY += (targetVy - this.velocityY) * effectiveGrip * delta;
    this.x += this.velocityX * delta;
    this.y += this.velocityY * delta;

    this.applyRepulsion(others, delta);
  }

  drawCollisionBox(ctx) {
    ctx.save();
    ctx.translate(this.x - camera.x, this.y - camera.y); // screen space
    ctx.rotate(this.angle);

    const hw = this.width / 2;
    const hh = this.height / 2;

    ctx.strokeStyle = "rgba(255, 0, 0, 0.8)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);

    ctx.restore();
  }

  draw() {
    CarSprites.draw(this.ctx, this, this.color);

    if (DEBUG) this.drawCollisionBox(this.ctx);
  }
}
