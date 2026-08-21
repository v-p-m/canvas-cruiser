// Persistent part-upgrade progression for the player's car — the model half
// of the garage, in the shape of phaser/records.js: localStorage keys,
// parsed defensively (bad or missing JSON resets to zero, never throws). No
// track/class keying, unlike Records — this is one progression, not one per
// circuit, so points earned on any track spend anywhere.
//
// Feeds `entity.mods` through the door carStats.js already documents as "the
// only sanctioned way for one car to differ", and phaser/damage.js already
// reads that non-destructively: Damage.reset() snapshots `mods` into
// `fitted` at spawn, and Damage.refit() rebuilds `mods` off `fitted` on every
// wing change — so a tier bought here survives a wing breaking mid-race the
// same way engine-class scaling always has. Nothing on the damage/physics
// chain changes for this to work; see phaser/raceScene.js's spawnCar.
const GARAGE_PARTS = ["engine", "tires", "steering"];
const GARAGE_MAX_TIER = 3;

// Points to reach each tier from the one below it — a step cost, not a
// cumulative balance, so tier 2 costs 6 on top of whatever tier 1 already
// cost (19 total to max one part). Index is the tier being bought; index 0
// is stock and unreachable through nextCost().
const GARAGE_TIER_COST = [null, 3, 6, 10];

// Flat multiplier granted at each tier, applied to the part's own mods
// field(s). Checked against the slip equilibrium matterCar.js documents
// (sin(slip) = turnSpeed / driftGrip, and 1.0 is where a held lock stops
// having a steady state): stock sits at 0.6. Engine never touches either side
// of that ratio. Tires (grip, the denominator) and Steering (turn, the
// numerator) move opposite sides of it, but by the same table at matching
// tiers, so a player who tiers them evenly never moves the ratio at all —
// only tiering Steering ahead of Tires pushes it, and the worst case, tier 3
// Steering against stock Tires, only reaches 0.672. Comfortably clear.
const GARAGE_TIER_MULT = [1, 1.04, 1.08, 1.12];

// Finish position -> points. Only the top 3 pay, and the table doesn't scale
// with field size — see awardForFinish().
const GARAGE_AWARD = { 1: 3, 2: 2, 3: 1 };

const Garage = {
  _points: 0,
  _tiers: { engine: 0, tires: 0, steering: 0 },

  load() {
    this._points = 0;
    try {
      const p = JSON.parse(localStorage.getItem("garagePoints"));
      if (Number.isFinite(p) && p >= 0) this._points = Math.floor(p);
      else if (p !== null) localStorage.removeItem("garagePoints");
    } catch {
      localStorage.removeItem("garagePoints");
    }

    this._tiers = { engine: 0, tires: 0, steering: 0 };
    try {
      const t = JSON.parse(localStorage.getItem("garageTiers"));
      if (t && typeof t === "object" && !Array.isArray(t)) {
        for (const part of GARAGE_PARTS) {
          const v = t[part];
          if (Number.isInteger(v) && v >= 0 && v <= GARAGE_MAX_TIER) this._tiers[part] = v;
        }
      } else if (t !== null) {
        localStorage.removeItem("garageTiers");
      }
    } catch {
      localStorage.removeItem("garageTiers");
    }
  },

  save() {
    try {
      localStorage.setItem("garagePoints", JSON.stringify(this._points));
      localStorage.setItem("garageTiers", JSON.stringify(this._tiers));
    } catch {
      /* private mode — the run still counts, it just won't outlive the tab */
    }
  },

  points() {
    return this._points;
  },

  tier(part) {
    return this._tiers[part] || 0;
  },

  // Cost of the *next* tier for `part`, or null once it's maxed.
  nextCost(part) {
    const next = this.tier(part) + 1;
    return next > GARAGE_MAX_TIER ? null : GARAGE_TIER_COST[next];
  },

  canAfford(part) {
    const cost = this.nextCost(part);
    return cost !== null && this._points >= cost;
  },

  // No-ops if unaffordable or already maxed — callers don't need to guard
  // the call themselves, same as Records' save calls.
  buy(part) {
    const cost = this.nextCost(part);
    if (cost === null || this._points < cost) return false;
    this._points -= cost;
    this._tiers[part] += 1;
    this.save();
    return true;
  },

  // `position` is 1-based; 0 is what RaceLaps.initEntity defaults every car
  // to and what a DNF never overwrites, so it falls out of GARAGE_AWARD's
  // lookup with no special case. `fieldSize`, when given, guards a position
  // that couldn't have happened rather than scaling the award — a top-3 pays
  // the same table whatever the grid size.
  awardForFinish(position, fieldSize) {
    if (!Number.isInteger(position) || position < 1) return 0;
    if (Number.isInteger(fieldSize) && position > fieldSize) return 0;
    const gained = GARAGE_AWARD[position] || 0;
    if (gained > 0) {
      this._points += gained;
      this.save();
    }
    return gained;
  },

  // {speed, accel, turn, grip} for spawnCar to hand the player's entity.
  // Engine drives speed and accel together (one multiplier, both fields);
  // Tires is grip; Steering is turn.
  mods() {
    const engine = GARAGE_TIER_MULT[this.tier("engine")];
    return {
      speed: engine,
      accel: engine,
      turn: GARAGE_TIER_MULT[this.tier("steering")],
      grip: GARAGE_TIER_MULT[this.tier("tires")],
    };
  },
};
