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
const GARAGE_PARTS = ["engine", "gearbox", "tires"];
const GARAGE_MAX_TIER = 3;

// Points to reach each tier from the one below it — a step cost, not a
// cumulative balance, so tier 2 costs 6 on top of whatever tier 1 already
// cost (19 total to max one part). Index is the tier being bought; index 0
// is stock and unreachable through nextCost().
const GARAGE_TIER_COST = [null, 3, 6, 10];

// Flat multiplier granted at each tier, applied to the part's own mods
// field. One part, one field, since 0.20.0: Engine is top speed and Gearbox is
// acceleration, which the Engine tier used to buy together — a single part
// that moved two of the car's four numbers was half the shop, and neither half
// could be bought on its own.
//
// Nothing sold here touches the *numerator* of the slip equilibrium
// matterCar.js documents (sin(slip) = turnSpeed / driftGrip, and 1.0 is where
// a held lock stops having a steady state, stock 0.8 since 0.20.0). That is
// what dropping the Steering part bought: Engine and Gearbox sit outside the
// ratio entirely and Tires is the denominator, so every tier on the shelf now
// moves the car *away* from the cliff. MAX_SLIP_RATIO in carStats.js still
// guards the stack, but the garage no longer contributes to it — a broken rear
// wing does.
const GARAGE_TIER_MULT = [1, 1.04, 1.08, 1.12];

// The other side of the shelf: what the field takes back of what the player
// buys. Nine tiers against a grid frozen at AI_TOP_SPEED made the garage a
// one-way ratchet — the longer the game was played, the less of a race it
// was, and every system built on close racing (the contact model, the wings,
// the championship tie-breaks) is only interesting while the field is still
// there to hit.
//
// The answer is not to match the player. A rival that gains exactly what was
// just fitted makes the purchase invisible, which is the mistake the
// slipstream made; what the player feels is what the change is for. So the
// field develops *behind* the player: the best-funded rival takes this
// fraction of the player's own gain, and the remainder is what the points
// actually bought.
const FIELD_CHASE = 0.75;

// ...and how that development is spread down the grid, front row to
// backmarker. Deterministic by grid rank rather than rolled per car: skill is
// already re-rolled every race (rollDriver() in ai.js), and a second random
// axis on top of it would make "was that a quick rival or a developed one"
// unanswerable from the debug panel and unrepeatable in a seeded harness run.
// The mean of these is what the field as a whole develops at; the first entry
// is what the player is actually racing.
const FIELD_DEV_SPREAD = [1, 0.875, 0.75, 0.625, 0.5];

// Finish position -> points. Only the top 3 pay, and the table doesn't scale
// with field size — see awardForFinish().
const GARAGE_AWARD = { 1: 3, 2: 2, 3: 1 };

// What the championship itself pays, on top of the per-round table above
// (phaser/series.js). Twice a race win for the title, and it is deliberately
// the larger number: the bonus has to be worth more than the round it was won
// in or the series is just a run of races with a scoreboard. Same shape, same
// top-3-only rule. Not re-scaled when the calendar went to four rounds — a
// clean sweep now pays 12 from the rounds against this 6, but "twice a race
// win" is the rule the number encodes, and it does not depend on how many
// rounds there are.
const GARAGE_SERIES_AWARD = { 1: 6, 2: 4, 3: 2 };

const Garage = {
  _points: 0,
  _tiers: { engine: 0, gearbox: 0, tires: 0 },

  load() {
    this._points = 0;
    try {
      const p = JSON.parse(localStorage.getItem("garagePoints"));
      if (Number.isFinite(p) && p >= 0) this._points = Math.floor(p);
      else if (p !== null) localStorage.removeItem("garagePoints");
    } catch {
      localStorage.removeItem("garagePoints");
    }

    this._tiers = { engine: 0, gearbox: 0, tires: 0 };
    try {
      const t = JSON.parse(localStorage.getItem("garageTiers"));
      if (t && typeof t === "object" && !Array.isArray(t)) {
        for (const part of GARAGE_PARTS) {
          const v = t[part];
          if (Number.isInteger(v) && v >= 0 && v <= GARAGE_MAX_TIER) this._tiers[part] = v;
        }
        if ("steering" in t) this.migrate(t);
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
    return this.awardFrom(GARAGE_AWARD, position, fieldSize);
  },

  // The championship's own payout, banked once when the last round goes in
  // the book. Same rules as a race finish, a bigger table.
  awardForSeries(position, fieldSize) {
    return this.awardFrom(GARAGE_SERIES_AWARD, position, fieldSize);
  },

  awardFrom(table, position, fieldSize) {
    if (!Number.isInteger(position) || position < 1) return 0;
    if (Number.isInteger(fieldSize) && position > fieldSize) return 0;
    const gained = table[position] || 0;
    if (gained > 0) {
      this._points += gained;
      this.save();
    }
    return gained;
  },

  // A pre-0.20.0 save, brought forward. The marker is the saved `steering`
  // key itself — save() always writes every part it knows about, so a key that
  // no longer exists can only have come from a build that had it. The old
  // Engine tier is mirrored onto Gearbox rather than refunded or halved: it
  // bought both fields, so mirroring is the reading under which the player's
  // car is still exactly the car they parked. Steering has no successor, so
  // what it cost comes back as points instead.
  migrate(saved) {
    this._tiers.gearbox = this._tiers.engine;
    const tier = saved.steering;
    if (Number.isInteger(tier))
      for (let i = 1; i <= Math.min(tier, GARAGE_MAX_TIER); i++)
        this._points += GARAGE_TIER_COST[i];
    this.save();
  },

  // {speed, accel, turn, grip} for spawnCar to hand the player's entity.
  // Engine is top speed, Gearbox is acceleration, Tires is grip. `turn` is
  // always 1 and is still sent: applyCarStats() reads all four unguarded, and
  // a partial object is a NaN stat rather than a stock one.
  mods() {
    return {
      speed: GARAGE_TIER_MULT[this.tier("engine")],
      accel: GARAGE_TIER_MULT[this.tier("gearbox")],
      turn: 1,
      grip: GARAGE_TIER_MULT[this.tier("tires")],
    };
  },

  // How far the player has taken their own car: 0 stock, 1 everything maxed.
  // Counted in tiers rather than read off the multipliers, so it stays true
  // if the ladder above is re-tuned and does not quietly re-balance the field
  // with it.
  development() {
    let bought = 0;
    for (const part of GARAGE_PARTS) bought += this.tier(part);
    return bought / (GARAGE_PARTS.length * GARAGE_MAX_TIER);
  },

  // The machinery multiplier for one opponent — `rank` 0 is the front of the
  // grid — for spawnCar to fold into that car's mods.
  //
  // It moves speed, accel and grip alike rather than mirroring which parts
  // the player bought: the field is developing its own cars, not shopping
  // from the player's list, and a rival that answers a set of tires with a
  // set of tires reads as the game cheating rather than as a season going on
  // around you.
  //
  // `turn` is deliberately not among them. turnSpeed is what ai.js's corner
  // model (R x turnSpeed) and the slip cap in carStats.js are both written
  // against, so raising it would have the whole field carrying more speed
  // into every corner and lifting for none of them — a driving change nobody
  // bought, on top of the machinery one they did.
  //
  // Exactly 1 while the player is stock, so a fresh save races the field it
  // always raced and nothing here moves until the first part is fitted.
  fieldDevelopment(rank) {
    const spread =
      FIELD_DEV_SPREAD[
        Math.min(Math.max(rank, 0), FIELD_DEV_SPREAD.length - 1)
      ];
    const gain = GARAGE_TIER_MULT[GARAGE_MAX_TIER] - 1;
    return 1 + gain * this.development() * FIELD_CHASE * spread;
  },
};
