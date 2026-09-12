// ─────────────────────────────────────────────────────────────────────
// Sound
//
// Everything here is synthesised at runtime — no audio files, nothing to
// load, nothing to keep in sync with the repo. The voices:
//
//   engine  two detuned oscillators through a lowpass, pitched off a fake
//           gearbox so accelerating sweeps and drops instead of sliding up
//           one long ramp
//   tires   looping white noise through a bandpass, opened by how far the
//           car's velocity has diverged from where it is pointing
//   impact  a filtered noise burst, one-shot, scaled by collision force
//   crack   a wing letting go — bright, short, its own gate (see below)
//   beep    a plain tone with a hard envelope, for the start lights
//   crowd   the same noise through a wide low-mid bandpass, swelling as the
//           car passes a knot of spectators and falling away down the straight
//   rain    the noise again, high-passed to a hiss, opened by how hard it
//           is raining
//   cheer   a one-shot swell of the crowd's own voice, for the flag
//
// The last three are the trackside: what the race sounds like from outside
// the car. They are driven by ambience(), not update(), because they live
// as long as the *scene* does rather than as long as the car is moving — the
// crowd is there through the countdown and is what cheers over the roll-out,
// which are exactly the two moments update()'s `moving` is false. What
// silences them is arriving on the menu, which calls ambience(0, 0) on its
// way in, the same way it already calls update() with `moving` false to
// shut the engine off.
//
// Browsers refuse to start an AudioContext before a user gesture, so the
// graph is built lazily by unlock() from the first key or click. Every
// entry point no-ops until that happens, which also keeps the headless
// screenshot runs (no audio device) quiet.
// ─────────────────────────────────────────────────────────────────────

const ENGINE_GEARS = 4;
const ENGINE_IDLE_HZ = 48;
const ENGINE_REDLINE_HZ = 165;
const ENGINE_MAX_GAIN = 0.16;
const TIRE_MAX_GAIN = 0.2;
const SLIP_THRESHOLD = 1.4; // world px/frame of lateral slide before squeal
const IMPACT_MIN_GAP = 0.05; // seconds between impact voices
const BEEP_COUNT_HZ = 440; // start lights, one per red light
const BEEP_GO_HZ = 880; // start lights, GO
const BEEP_GAIN = 0.18;
// The trackside. The crowd sits under the engine at full: it is a murmur
// passed at speed, not a stadium, and a knot of six people on a verge is
// what it is the sound of. Its level is a slow swell on top of the nearness
// the caller hands it, so it breathes rather than hisses.
const CROWD_MAX_GAIN = 0.1;
const CROWD_SWELL = 0.25; // fraction of the level the swell moves it by
const CROWD_SWELL_HZ = 0.4; // and how slowly
const RAIN_MAX_GAIN = 0.06;
const CHEER_GAIN = 0.22;
const CHEER_SECONDS = 2.5; // attack to silence
const CHEER_MIN_GAP = 1.0; // seconds — one flag, one cheer


const Sound = {
  ctx: null,
  muted: false,
  master: null,
  engine: null,
  tires: null,
  noiseBuffer: null,
  crowd: null,
  rain: null,
  impactCount: 0, // voices built, read by the B overlay
  _lastImpact: -1,
  _lastCrack: -1, // crack() keeps its own, or impact()'s gate would eat every break
  _lastCheer: -1, // and so does cheer(): the flag falls inside the last lap's traffic

  load() {
    this.muted = localStorage.getItem("soundMuted") === "1";
  },

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem("soundMuted", this.muted ? "1" : "0");
    if (this.master) {
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : 1,
        this.ctx.currentTime,
        0.02,
      );
    }
  },

  // Called from the first user gesture. Safe to call repeatedly.
  unlock() {
    if (this.ctx) {
      // resume() rejects if the gesture didn't count; nothing to do about it
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      return; // no audio device (headless), stay silent
    }
    this._build();
  },

  _build() {
    const ac = this.ctx;

    this.master = ac.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.master.connect(ac.destination);

    // Two seconds of white noise, looped by both the tire and impact voices
    const len = ac.sampleRate * 2;
    this.noiseBuffer = ac.createBuffer(1, len, ac.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // --- Engine ---
    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 700;
    filter.Q.value = 4;

    const gain = ac.createGain();
    gain.gain.value = 0;

    const osc = ac.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = ENGINE_IDLE_HZ;

    // An octave down and slightly out of tune, for the beat that stops the
    // engine reading as a single clean tone
    const sub = ac.createOscillator();
    sub.type = "square";
    sub.frequency.value = ENGINE_IDLE_HZ / 2;
    sub.detune.value = 8;

    const subGain = ac.createGain();
    subGain.gain.value = 0.5;

    osc.connect(filter);
    sub.connect(subGain).connect(filter);
    filter.connect(gain).connect(this.master);
    osc.start();
    sub.start();

    this.engine = { osc, sub, filter, gain };

    // --- Tires ---
    const tireSrc = ac.createBufferSource();
    tireSrc.buffer = this.noiseBuffer;
    tireSrc.loop = true;

    const tireFilter = ac.createBiquadFilter();
    tireFilter.type = "bandpass";
    tireFilter.frequency.value = 1800;
    tireFilter.Q.value = 1.6;

    const tireGain = ac.createGain();
    tireGain.gain.value = 0;

    tireSrc.connect(tireFilter).connect(tireGain).connect(this.master);
    tireSrc.start();

    this.tires = { src: tireSrc, filter: tireFilter, gain: tireGain };

    // --- Crowd ---
    // A wide, low-Q band in the low mids: voices at a distance, with the
    // consonants gone. The tire squeal sits an octave and a half above it,
    // so the two never read as one noise.
    const crowdSrc = ac.createBufferSource();
    crowdSrc.buffer = this.noiseBuffer;
    crowdSrc.loop = true;
    crowdSrc.playbackRate.value = 0.7;

    const crowdFilter = ac.createBiquadFilter();
    crowdFilter.type = "bandpass";
    crowdFilter.frequency.value = 650;
    crowdFilter.Q.value = 0.6;

    const crowdGain = ac.createGain();
    crowdGain.gain.value = 0;

    crowdSrc.connect(crowdFilter).connect(crowdGain).connect(this.master);
    crowdSrc.start();

    this.crowd = { src: crowdSrc, filter: crowdFilter, gain: crowdGain };

    // --- Rain ---
    // The same noise with everything below the hiss taken out. Steady: rain
    // on a roof is the one sound here with no rhythm in it.
    const rainSrc = ac.createBufferSource();
    rainSrc.buffer = this.noiseBuffer;
    rainSrc.loop = true;

    const rainHigh = ac.createBiquadFilter();
    rainHigh.type = "highpass";
    rainHigh.frequency.value = 2500;

    const rainLow = ac.createBiquadFilter();
    rainLow.type = "lowpass";
    rainLow.frequency.value = 6000;

    const rainGain = ac.createGain();
    rainGain.gain.value = 0;

    rainSrc.connect(rainHigh).connect(rainLow).connect(rainGain).connect(this.master);
    rainSrc.start();

    this.rain = { src: rainSrc, gain: rainGain };
  },

  // The trackside, once a frame for as long as a race scene is awake.
  //   crowd  0..1, how near the car is to the spectators (Crowd.nearness)
  //   rain   0..1, how hard it is raining (Rain.intensity)
  // Both to 0 is silence, and is what the menu asks for on the way in.
  ambience(crowd, rain) {
    if (!this.ctx || !this.crowd) return;
    if (this.muted) return;
    const t = this.ctx.currentTime;
    const swell = 1 - CROWD_SWELL * (0.5 + 0.5 * Math.sin(t * CROWD_SWELL_HZ * 2 * Math.PI));
    this.crowd.gain.gain.setTargetAtTime(CROWD_MAX_GAIN * crowd * swell, t, 0.12);
    this.rain.gain.gain.setTargetAtTime(RAIN_MAX_GAIN * rain, t, 0.3);
  },

  // The flag. A one-shot swell of the crowd's own band, brighter and on top
  // of it rather than through it, so it carries whatever the murmur is doing
  // — the car is usually past the last knot by the line. Its own gate: a
  // flag falls inside the last lap's traffic, and impact()'s would eat it.
  cheer() {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const ac = this.ctx;
    const t = ac.currentTime;
    if (t - this._lastCheer < CHEER_MIN_GAP) return;
    this._lastCheer = t;

    const src = ac.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    src.playbackRate.value = 0.8;

    const filter = ac.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(700, t);
    filter.frequency.linearRampToValueAtTime(1100, t + 0.4); // the rise of a shout
    filter.Q.value = 0.8;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(CHEER_GAIN, t + 0.15);
    gain.gain.setValueAtTime(CHEER_GAIN, t + 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + CHEER_SECONDS);

    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + CHEER_SECONDS + 0.05);
  },

  // Called once per frame with the player's state.
  //   speed     signed, world px/frame
  //   maxSpeed  for normalising the gearbox
  //   throttle  true while the accelerate key is held
  //   slip      lateral speed, world px/frame — the drift the car is doing
  //   moving    false in menus and before the lights go out
  update(speed, maxSpeed, throttle, slip, moving) {
    if (!this.ctx || !this.engine) return;

    // Muting used to only pull the master gain to 0, so a silent game still
    // scheduled every parameter and built every impact voice. Skipping the
    // work outright is what mute should have meant, and it makes M a clean
    // way to measure what the audio graph is costing.
    if (this.muted) return;

    const t = this.ctx.currentTime;
    const abs = Math.abs(speed);

    if (!moving) {
      this.engine.gain.gain.setTargetAtTime(0, t, 0.08);
      this.tires.gain.gain.setTargetAtTime(0, t, 0.05);
      return;
    }

    // Fake gearbox — rpm climbs across a gear, then drops on the change
    const span = maxSpeed / ENGINE_GEARS;
    const gear = Math.min(ENGINE_GEARS - 1, Math.floor(abs / span));
    const rpm = Math.min(1, (abs - gear * span) / span);

    const freq = ENGINE_IDLE_HZ + rpm * (ENGINE_REDLINE_HZ - ENGINE_IDLE_HZ);
    // setTargetAtTime rather than a step, so gear changes glide by a few ms
    // instead of clicking
    this.engine.osc.frequency.setTargetAtTime(freq, t, 0.03);
    this.engine.sub.frequency.setTargetAtTime(freq / 2, t, 0.03);
    this.engine.filter.frequency.setTargetAtTime(500 + rpm * 1400, t, 0.05);

    // Idle is audible but quiet; on throttle it opens up
    const load = throttle ? 1 : 0.45;
    const level = ENGINE_MAX_GAIN * load * (0.35 + 0.65 * (abs / maxSpeed));
    this.engine.gain.gain.setTargetAtTime(level, t, 0.05);

    const squeal = Math.max(0, Math.min(1, (slip - SLIP_THRESHOLD) / 3));
    this.tires.gain.gain.setTargetAtTime(squeal * TIRE_MAX_GAIN, t, 0.04);
    if (squeal > 0) {
      this.tires.filter.frequency.setTargetAtTime(1400 + squeal * 1200, t, 0.05);
    }
  },

  // One-shot noise burst. `force` is the collision impulse magnitude.
  //
  // resolveCollision runs for every pair of cars every frame, and cars in a
  // pack stay in contact for as long as the pack lasts — so this is called
  // from a loop that can fire many times per frame, indefinitely. Each call
  // builds three nodes, so without a floor on the gap a scrum allocates
  // hundreds of voices a second, all of them stacking into the same instant
  // and only registering as one louder crunch anyway.
  impact(force) {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const ac = this.ctx;
    const t = ac.currentTime;
    if (t - this._lastImpact < IMPACT_MIN_GAP) return;
    this._lastImpact = t;
    this.impactCount++;

    const amp = Math.min(0.5, 0.06 + force * 0.06);

    const src = ac.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.6 + Math.random() * 0.3;

    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(1600, t);
    filter.frequency.exponentialRampToValueAtTime(180, t + 0.22);

    const gain = ac.createGain();
    gain.gain.setValueAtTime(amp, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);

    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + 0.3);
  },

  // Carbon fibre letting go — one wing, once (phaser/damage.js).
  //
  // Deliberately not impact()'s voice with a bigger `force`. That is a lowpass
  // sweeping *down* to 180 Hz, which is a heavy thud, and a break has to be
  // audible over one of those happening in the same frame: this is the same
  // noise buffer through a highpass instead, short and bright, so the two
  // stack as a crunch followed by a snap rather than one louder thud. It also
  // keeps its own last-fired time, or impact()'s 50 ms gate would swallow it
  // every single time — a break is always accompanied by the hit that caused it.
  crack() {
    if (!this.ctx || !this.noiseBuffer || this.muted) return;
    const ac = this.ctx;
    const t = ac.currentTime;
    if (t - this._lastCrack < IMPACT_MIN_GAP) return;
    this._lastCrack = t;
    this.impactCount++;

    const src = ac.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1.4 + Math.random() * 0.4;

    const filter = ac.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.setValueAtTime(2200, t);
    filter.Q.value = 1.2;

    const gain = ac.createGain();
    gain.gain.setValueAtTime(0.34, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);

    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
    src.stop(t + 0.18);
  },

  // Start-light tone. `go` picks the higher, longer pitch for lights-out.
  //
  // A square through a lowpass rather than a sine: the harmonics are what
  // make it cut through the engine, and the filter keeps them from turning
  // into the shrill beep of a reversing truck.
  beep(go) {
    if (!this.ctx || this.muted) return;
    const ac = this.ctx;
    const t = ac.currentTime;
    const dur = go ? 0.5 : 0.14;

    const osc = ac.createOscillator();
    osc.type = "square";
    osc.frequency.value = go ? BEEP_GO_HZ : BEEP_COUNT_HZ;

    const filter = ac.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = go ? 2600 : 1600;
    filter.Q.value = 0.7;

    const gain = ac.createGain();
    // Ramp in over a couple of ms — starting at full gain clicks
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(BEEP_GAIN, t + 0.005);
    gain.gain.setValueAtTime(BEEP_GAIN, t + dur * 0.6);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(filter).connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  },
};
