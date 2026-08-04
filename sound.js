// ─────────────────────────────────────────────────────────────────────
// Sound
//
// Everything here is synthesised at runtime — no audio files, nothing to
// load, nothing to keep in sync with the repo. Four voices:
//
//   engine  two detuned oscillators through a lowpass, pitched off a fake
//           gearbox so accelerating sweeps and drops instead of sliding up
//           one long ramp
//   tires   looping white noise through a bandpass, opened by how far the
//           car's velocity has diverged from where it is pointing
//   impact  a filtered noise burst, one-shot, scaled by collision force
//   beep    a plain tone with a hard envelope, for the start lights
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

const Sound = {
  ctx: null,
  muted: false,
  master: null,
  engine: null,
  tires: null,
  noiseBuffer: null,
  impactCount: 0, // voices built, read by the B overlay
  _lastImpact: -1,

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
