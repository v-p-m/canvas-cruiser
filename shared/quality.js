// ─────────────────────────────────────────────────────────────────────
// Quality
//
// Every frame repaints the whole viewport twice over — baked track, then
// skid layer — so what the game costs is very nearly the backing store's
// pixel count. Whether a machine can afford those pixels comes down to one
// thing the page cannot ask about directly: is canvas 2D rasterised on the
// GPU or on the CPU? A hardened Firefox build with WebGL switched off falls
// back to software raster and runs this same code at a third of the frame
// rate, on hardware that is otherwise fine.
//
// So this does the two things a "GPU check" can honestly be:
//
//   probe()   one cheap look at WebGL before the first frame, to pick a
//             starting resolution instead of janking through the first
//             second and then recovering
//   sample()  the frame interval, which is the only measurement that
//             includes raster and compositing — both happen after the last
//             line of gameLoop, where no timer inside it can see them
//
// The probe is a guess and is allowed to be wrong: WebGL being blocked does
// not strictly prove canvas is unaccelerated. If the frames come in on time
// anyway the cap is handed back once, and the measurement decides. Downward
// steps are final, so a wrong guess costs one brief hitch rather than an
// oscillation between two resolutions forever.
// ─────────────────────────────────────────────────────────────────────

const DPR_LADDER = [2, 1.5, 1.25, 1, 0.75]; // descending; under 1 the CSS upscales
const QUALITY_WINDOW = 60; // frames per verdict
const QUALITY_BUDGET_MS = 22; // median frame interval that counts as too slow (~45fps)
const QUALITY_STRIKES = 3; // consecutive slow windows before stepping down
const QUALITY_SETTLE = 6; // consecutive good windows before handing pixels back
const QUALITY_SPIKE_MS = 100; // longer gaps are tab switches, not slow frames
const SOFTWARE_START_DPR = 1; // where the probe puts a machine with no GPU raster

// Renderer strings that mean "there is a GPU driver, but it is running on
// the CPU". llvmpipe is Mesa's software rasteriser, SwiftShader is Chrome's.
const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|software|basic render/i;

const Quality = {
  cap: Infinity, // auto limit on devicePixelRatio; Infinity = no opinion
  auto: true, // cleared for the session once Max dpr is set by hand
  renderer: "", // what the probe saw, for the B overlay
  software: false,
  median: 0,

  _times: [],
  _slow: 0,
  _good: 0,
  _trial: true, // one upgrade attempt, to undo a pessimistic probe
  _skip: QUALITY_WINDOW, // ignore the frames around load and around a resize

  // Called before the first resizeCanvas(), so the game opens at a
  // resolution the machine can hold rather than correcting into it.
  probe() {
    let gl = null;
    try {
      const probeCanvas = document.createElement("canvas");
      gl =
        probeCanvas.getContext("webgl") ||
        probeCanvas.getContext("experimental-webgl");
    } catch {
      // Some privacy builds throw here rather than returning null
    }

    if (!gl) {
      this.renderer = "WebGL unavailable";
      this.software = true;
    } else {
      // Without the extension the string is a generic vendor placeholder,
      // which tells us nothing either way — so assume hardware and let the
      // frame times argue otherwise.
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      this.renderer = info
        ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
        : "masked";
      this.software = SOFTWARE_RENDERERS.test(this.renderer);

      // The probe context is never drawn to; drop it rather than spend one
      // of the browser's handful of live WebGL contexts on it.
      const lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
    }

    if (this.software) this.cap = SOFTWARE_START_DPR;
  },

  // Called once per frame with the raw interval since the last one.
  sample(dt) {
    if (!this.auto) return;
    if (this._skip > 0) {
      this._skip--;
      return;
    }
    if (!(dt > 0) || dt > QUALITY_SPIKE_MS) return;

    this._times.push(dt);
    if (this._times.length < QUALITY_WINDOW) return;

    // Median, not mean: one 80ms garbage collection inside the window would
    // drag a mean over budget on a machine that is otherwise holding 60.
    const sorted = this._times.slice().sort((a, b) => a - b);
    this.median = sorted[sorted.length >> 1];
    this._times.length = 0;

    if (this.median > QUALITY_BUDGET_MS) {
      this._good = 0;
      if (++this._slow >= QUALITY_STRIKES && this._stepDown()) this._slow = 0;
      return;
    }

    this._slow = 0;
    if (this._trial && this.cap !== Infinity && ++this._good >= QUALITY_SETTLE) {
      this._release();
    }
  },

  // The viewport changed size under us — throw away the samples taken at the
  // old one rather than averaging two different workloads together.
  viewportChanged() {
    this._times.length = 0;
    this._slow = 0;
    this._good = 0;
    this._skip = QUALITY_WINDOW;
  },

  _stepDown() {
    // Step relative to what is actually on screen, not to `cap` — the cap
    // may be well above the display's own devicePixelRatio.
    const next = DPR_LADDER.find((v) => v < renderDpr - 0.001);
    if (next === undefined) return false; // already at the floor
    this.cap = next;
    this._trial = false; // measurement has spoken; never climb back
    this._commit(`frames over ${QUALITY_BUDGET_MS}ms`);
    return true;
  },

  _release() {
    this._trial = false;
    this.cap = Infinity;
    this._commit("frame times had room");
  },

  _commit(why) {
    console.info(
      `Quality: render scale -> ${this.cap === Infinity ? "display native" : this.cap + "x"} (${why})`,
    );
    resizeCanvas();
    this.viewportChanged(); // don't judge the new backing store on the old one's frames
  },

  // One line for the B overlay.
  status() {
    const gpu = this.software ? "SOFTWARE" : "hw";
    const cap = !this.auto ? "manual" : this.cap === Infinity ? "free" : this.cap;
    return `gpu:${gpu} cap:${cap} med:${this.median.toFixed(1)}ms`;
  },
};

Quality.probe();
