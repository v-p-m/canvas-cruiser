// Lift for being mis-pointed. This is a recovery term, not a racing line: a
// car that has been shoved or has run wide is aimed somewhere it can't reach
// at speed, and backing off is how it gets its nose round. It used to be 0.5,
// which throttled every ordinary corner entry as well.
//
// Anticipatory corner braking — lifting for the turn angle at the waypoint
// ahead, before arriving — was tried here and is not worth it on this track.
// Every setting of it traded pace against time on the grass at roughly one for
// one, with no knee: measured over a stint, going from no lift at all to a
// full one moved average speed 9.08 to 8.63 px/frame and off-road frames 0.128
// to 0.091. At the grip below the cars hold the line flat out, so there is
// nothing to anticipate. 0.15 keeps the recovery case for about a 1% cost.
const HEADING_BRAKE = 0.15;

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

    // Steering
    const targetAngle = Math.atan2(targetX - this.x, -(targetY - this.y));
    const angleDiff = Math.atan2(
      Math.sin(targetAngle - this.angle),
      Math.cos(targetAngle - this.angle),
    );
    this.angle += angleDiff * this.turnSpeed * delta;

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

    // Speed — lift only for being mis-pointed, then apply rubber band and
    // multiplier.
    const headingErr = Math.min(Math.abs(angleDiff) / Math.PI, 1);
    const cornerFactor = 1 - headingErr * HEADING_BRAKE;

    const targetSpeed =
      this.maxSpeed * cornerFactor * rubberBand * this.speedMultiplier;
    // Asymmetric: shedding speed is a reaction to something that has already
    // happened — grass under the wheels, a shove dropping the multiplier — so
    // it settles quickly, while the pickup stays gradual enough to look driven.
    const rate = targetSpeed < this.speed ? 0.12 : 0.05;
    this.speed += (targetSpeed - this.speed) * rate * delta;

    // Velocity-based movement. Rain scales grip here rather than being
    // written onto this.grip, so the tuning sliders stay in charge of the
    // dry value.
    const wetGrip = this.grip * Rain.gripScale();
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
