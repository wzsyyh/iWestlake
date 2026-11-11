/**
 * Fully synthesised audio (no sample files): weapon, drones, impacts, footsteps, ambience and
 * stingers are built from oscillators and filtered noise, with a generated outdoor reverb.
 */
export class Audio {
  constructor() {
    this.ctx = null; this.volume = 0.8; this.ready = false;
    this.hums = new Map();
  }

  /** Must be called from a user gesture. */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 18; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.16;
    this.master.connect(comp).connect(ctx.destination);
    this.dry = ctx.createGain(); this.dry.connect(this.master);
    // outdoor slap-back: short bright early part, long quiet tail off the ring facade
    const len = Math.floor(ctx.sampleRate * 1.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / ctx.sampleRate;
        const echo = Math.exp(-Math.pow((t - 0.21 - ch * 0.013) * 28, 2)) * 0.9 + Math.exp(-Math.pow((t - 0.43) * 20, 2)) * 0.45;
        d[i] = (Math.random() * 2 - 1) * (Math.exp(-t * 5.5) * 0.5 + echo * 0.5 + Math.exp(-t * 1.9) * 0.08);
      }
    }
    this.reverb = ctx.createConvolver(); this.reverb.buffer = ir;
    this.wet = ctx.createGain(); this.wet.gain.value = 0.55;
    this.wet.connect(this.reverb).connect(this.master);
    // one second of white noise, reused everywhere
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const n = this.noise.getChannelData(0);
    for (let i = 0; i < n.length; i++) n[i] = Math.random() * 2 - 1;
    this.ready = true;
    this._ambience();
  }

  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; }
  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  setListener(pos, fwd) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(pos.x, t); l.positionY.setValueAtTime(pos.y, t); l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t); l.forwardY.setValueAtTime(fwd.y, t); l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else { l.setPosition(pos.x, pos.y, pos.z); l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0); }
  }

  // ---------------------------------------------------------------- building blocks

  _out(pos, gain, wet = 0.3) {
    const ctx = this.ctx, g = ctx.createGain();
    g.gain.value = gain;
    let node = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 4; p.maxDistance = 400; p.rolloffFactor = 1.1;
      p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z;
      g.connect(p); node = p;
    }
    node.connect(this.dry);
    if (wet > 0) { const w = ctx.createGain(); w.gain.value = wet; node.connect(w).connect(this.wet); }
    return g;
  }

  _noise(dest, { t0 = 0, dur = 0.2, type = 'bandpass', f0 = 1000, f1 = null, q = 1, gain = 1, attack = 0.002, curve = 3 }) {
    const ctx = this.ctx, t = ctx.currentTime + t0;
    const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
    src.playbackRate.value = 0.7 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0.0001, t + attack, dur / curve);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.1);
  }

  _tone(dest, { t0 = 0, dur = 0.2, type = 'sine', f0 = 440, f1 = null, gain = 1, attack = 0.002, curve = 3, fm = 0, fmRate = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + t0;
    const o = ctx.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    if (fm) { const m = ctx.createOscillator(), mg = ctx.createGain(); m.frequency.value = fmRate; mg.gain.value = fm; m.connect(mg).connect(o.frequency); m.start(t); m.stop(t + dur + 0.1); }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0.0001, t + attack, dur / curve);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.1);
  }

  // ---------------------------------------------------------------- game sounds

  shot() {
    if (!this.ready) return;
    const o = this._out(null, 0.5, 0.42);
    const p = 0.94 + Math.random() * 0.12;
    this._noise(o, { dur: 0.09, type: 'highpass', f0: 1800, q: 0.5, gain: 0.8, curve: 4 });            // crack
    this._noise(o, { dur: 0.22, type: 'lowpass', f0: 2400, f1: 300, q: 0.7, gain: 0.9 });               // body
    this._tone(o, { dur: 0.16, type: 'sine', f0: 150 * p, f1: 46, gain: 1.0, curve: 3.5 });              // thump
    this._tone(o, { dur: 0.12, type: 'sawtooth', f0: 1900 * p, f1: 240, gain: 0.26, curve: 5 });         // energy zap
    this._tone(o, { dur: 0.3, type: 'triangle', f0: 620 * p, f1: 560 * p, gain: 0.05, curve: 2, fm: 60, fmRate: 37 });   // capacitor ring
  }

  dryFire() { if (this.ready) { const o = this._out(null, 0.3, 0.1); this._noise(o, { dur: 0.03, type: 'bandpass', f0: 3200, q: 3, gain: 0.8 }); this._tone(o, { dur: 0.05, f0: 900, f1: 500, gain: 0.25 }); } }

  reload(stage) {
    if (!this.ready) return;
    const o = this._out(null, 0.42, 0.15);
    if (stage === 'start') { this._noise(o, { dur: 0.18, type: 'bandpass', f0: 900, f1: 1800, q: 1, gain: 0.25, attack: 0.05 }); }
    if (stage === 'out') { this._noise(o, { dur: 0.05, type: 'bandpass', f0: 2600, q: 4, gain: 0.9 }); this._tone(o, { dur: 0.09, f0: 320, f1: 150, gain: 0.5 }); this._tone(o, { dur: 0.35, type: 'sine', f0: 900, f1: 180, gain: 0.08, curve: 2 }); }
    if (stage === 'in') { this._noise(o, { dur: 0.06, type: 'bandpass', f0: 1800, q: 3, gain: 0.9 }); this._tone(o, { dur: 0.1, f0: 210, f1: 120, gain: 0.7 }); }
    if (stage === 'charge') { this._tone(o, { dur: 0.42, type: 'sawtooth', f0: 240, f1: 1500, gain: 0.1, attack: 0.1, curve: 1.6 }); this._tone(o, { t0: 0.32, dur: 0.12, f0: 1760, gain: 0.12 }); this._noise(o, { t0: 0.02, dur: 0.05, type: 'highpass', f0: 3000, gain: 0.5 }); }
  }

  step(surface, strength = 0.7) {
    if (!this.ready) return;
    const o = this._out(null, 0.16 * strength + 0.05, 0.12);
    const v = 0.85 + Math.random() * 0.3;
    if (surface === 'grass') {
      this._noise(o, { dur: 0.13, type: 'bandpass', f0: 2300 * v, q: 0.6, gain: 0.5, attack: 0.012 });
      this._noise(o, { dur: 0.07, type: 'lowpass', f0: 240, gain: 0.7 });
    } else {
      this._noise(o, { dur: 0.045, type: 'bandpass', f0: (surface === 'hall' ? 2600 : 1700) * v, q: 1.6, gain: 0.8 });
      this._tone(o, { dur: 0.07, f0: 120 * v, f1: 62, gain: 0.7 });
      if (surface === 'hall') this._noise(o, { t0: 0.02, dur: 0.16, type: 'bandpass', f0: 1200, q: 0.8, gain: 0.12 });
    }
  }

  land(strength) { if (this.ready) { const o = this._out(null, Math.min(0.5, 0.1 + strength * 0.03), 0.15); this._tone(o, { dur: 0.14, f0: 105, f1: 42, gain: 1 }); this._noise(o, { dur: 0.1, type: 'lowpass', f0: 700, gain: 0.6 }); } }
  jump() { if (this.ready) { const o = this._out(null, 0.1, 0.1); this._noise(o, { dur: 0.09, type: 'bandpass', f0: 800, f1: 1600, q: 0.8, gain: 0.5, attack: 0.02 }); } }

  impact(pos, surface) {
    if (!this.ready) return;
    const o = this._out(pos, 0.5, 0.25);
    if (surface === 'glass') { this._noise(o, { dur: 0.1, type: 'highpass', f0: 3800, gain: 0.8 }); this._tone(o, { dur: 0.22, type: 'triangle', f0: 2900 + Math.random() * 1500, gain: 0.25 }); }
    else if (surface === 'metal') { this._tone(o, { dur: 0.28, type: 'square', f0: 900 + Math.random() * 900, gain: 0.14, fm: 300, fmRate: 113 }); this._noise(o, { dur: 0.05, type: 'bandpass', f0: 4000, q: 2, gain: 0.8 }); }
    else if (surface === 'grass') { this._noise(o, { dur: 0.1, type: 'lowpass', f0: 500, gain: 0.8 }); }
    else { this._noise(o, { dur: 0.07, type: 'bandpass', f0: 2100, q: 0.8, gain: 0.9 }); this._tone(o, { dur: 0.06, f0: 240, f1: 110, gain: 0.5 }); }
  }

  hitmarker(kill) {
    if (!this.ready) return;
    const o = this._out(null, 0.2, 0);
    this._tone(o, { dur: 0.05, type: 'triangle', f0: kill ? 1400 : 2100, gain: 0.8 });
    if (kill) this._tone(o, { t0: 0.06, dur: 0.14, type: 'triangle', f0: 2100, gain: 0.7 });
  }

  droneShot(pos, heavy) {
    if (!this.ready) return;
    const o = this._out(pos, 0.75, 0.35);
    this._tone(o, { dur: 0.2, type: 'sawtooth', f0: heavy ? 720 : 1150, f1: heavy ? 130 : 210, gain: 0.5, curve: 4 });
    this._noise(o, { dur: 0.08, type: 'bandpass', f0: 2600, q: 1, gain: 0.5 });
  }

  whiz(pos) { if (this.ready) { const o = this._out(pos, 0.5, 0.1); this._noise(o, { dur: 0.18, type: 'bandpass', f0: 2600, f1: 700, q: 6, gain: 0.9, attack: 0.03 }); } }

  explosion(pos, size = 1) {
    if (!this.ready) return;
    const o = this._out(pos, 1.3 * Math.min(1.6, size), 0.7);
    this._noise(o, { dur: 0.9 * size, type: 'lowpass', f0: 2600, f1: 90, q: 0.6, gain: 1.0, curve: 2.2 });
    this._tone(o, { dur: 0.6 * size, f0: 95, f1: 28, gain: 1.0, curve: 2.4 });
    this._noise(o, { dur: 0.12, type: 'highpass', f0: 2500, gain: 0.7 });
    this._noise(o, { t0: 0.12, dur: 1.4, type: 'bandpass', f0: 420, q: 0.5, gain: 0.25, attack: 0.1, curve: 1.6 });      // debris rumble
  }

  hurt() { if (this.ready) { const o = this._out(null, 0.42, 0.1); this._tone(o, { dur: 0.16, type: 'sawtooth', f0: 190, f1: 70, gain: 0.5 }); this._noise(o, { dur: 0.1, type: 'bandpass', f0: 900, q: 0.7, gain: 0.7 }); } }

  pickup(kind) {
    if (!this.ready) return;
    const o = this._out(null, 0.22, 0.2);
    const notes = kind === 'health' ? [523, 659, 784] : [659, 880, 1175];
    notes.forEach((f, i) => this._tone(o, { t0: i * 0.07, dur: 0.22, type: 'triangle', f0: f, gain: 0.6 }));
  }

  /** Squelch + two-tone chirp that opens a radio line. */
  radio() { if (this.ready) { const o = this._out(null, 0.16, 0); this._noise(o, { dur: 0.09, type: 'bandpass', f0: 2400, q: 0.7, gain: 0.5 }); this._tone(o, { t0: 0.05, dur: 0.06, type: 'square', f0: 1320, gain: 0.25 }); this._tone(o, { t0: 0.12, dur: 0.07, type: 'square', f0: 1760, gain: 0.25 }); } }

  ui() { if (this.ready) { const o = this._out(null, 0.12, 0); this._tone(o, { dur: 0.04, type: 'triangle', f0: 1500, gain: 0.7 }); } }

  /** Wave start / victory / defeat stingers. */
  stinger(kind) {
    if (!this.ready) return;
    const o = this._out(null, 0.3, 0.6);
    const chord = kind === 'victory' ? [262, 330, 392, 523, 659] : kind === 'defeat' ? [196, 233, 277] : [147, 220, 294];
    chord.forEach((f, i) => {
      const t0 = kind === 'victory' ? i * 0.11 : 0;
      this._tone(o, { t0, dur: kind === 'wave' ? 1.3 : 2.4, type: 'sawtooth', f0: f, f1: kind === 'defeat' ? f * 0.84 : f, gain: 0.11, attack: kind === 'wave' ? 0.25 : 0.05, curve: 1.6 });
      this._tone(o, { t0, dur: 2.0, type: 'sine', f0: f * 2, gain: 0.06, attack: 0.2, curve: 1.5 });
    });
    if (kind === 'wave') this._tone(o, { dur: 1.2, f0: 55, f1: 45, gain: 0.6, attack: 0.2, curve: 1.5 });
  }

  // ---------------------------------------------------------------- continuous sources

  /** Per-drone rotor hum; call every frame with the drone's position and a 0..1 thrust value. */
  hum(id, pos, thrust, size = 1, alive = true) {
    if (!this.ready) return;
    let h = this.hums.get(id);
    if (!alive) { if (h) { h.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08); const hh = h; setTimeout(() => { hh.o1.stop(); hh.o2.stop(); hh.p.disconnect(); }, 400); this.hums.delete(id); } return; }
    const ctx = this.ctx, t = ctx.currentTime;
    if (!h) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'inverse'; p.refDistance = 3.5 * size; p.maxDistance = 300; p.rolloffFactor = 1.3;
      const g = ctx.createGain(); g.gain.value = 0;
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter();
      o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'bandpass'; f.Q.value = 1.2;
      o1.connect(f); o2.connect(f); f.connect(g).connect(p).connect(this.dry);
      o1.start(); o2.start();
      h = { p, g, o1, o2, f, base: (size > 2 ? 62 : size > 1.2 ? 118 : 176) * (0.94 + Math.random() * 0.12) };
      this.hums.set(id, h);
    }
    const f0 = h.base * (1 + thrust * 0.32);
    h.o1.frequency.setTargetAtTime(f0, t, 0.08); h.o2.frequency.setTargetAtTime(f0 * 2.02, t, 0.08);
    h.f.frequency.setTargetAtTime(f0 * 3.2, t, 0.1);
    h.g.gain.setTargetAtTime(0.16 * Math.min(1.8, size), t, 0.15);
    h.p.positionX.setTargetAtTime(pos.x, t, 0.03); h.p.positionY.setTargetAtTime(pos.y, t, 0.03); h.p.positionZ.setTargetAtTime(pos.z, t, 0.03);
  }

  stopAllHums() { for (const id of [...this.hums.keys()]) this.hum(id, null, 0, 1, false); }

  _ambience() {
    const ctx = this.ctx;
    // wind through the trees: two slowly modulated noise bands
    const mk = (f, q, gain, lfoRate) => {
      const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
      const fl = ctx.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = f; fl.Q.value = q;
      const g = ctx.createGain(); g.gain.value = gain;
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = lfoRate; lg.gain.value = gain * 0.6;
      lfo.connect(lg).connect(g.gain); lfo.start();
      src.connect(fl).connect(g).connect(this.master); src.start();
    };
    mk(420, 0.4, 0.035, 0.07); mk(2600, 0.7, 0.012, 0.11); mk(6500, 1.2, 0.006, 0.19);
    // birds: occasional chirp phrases somewhere around the listener
    const bird = () => {
      if (ctx.state === 'running') {
        // a random spot in the trees around the listener
        const l = ctx.listener, a = Math.random() * 6.28, r = 18 + Math.random() * 30;
        const lx = l.positionX ? l.positionX.value : 0, lz = l.positionZ ? l.positionZ.value : 0;
        const o = this._out({ x: lx + Math.cos(a) * r, y: 8, z: lz + Math.sin(a) * r }, 0.5 + Math.random() * 0.4, 0.5);
        const base = 2400 + Math.random() * 2400, n = 2 + (Math.random() * 5 | 0);
        for (let i = 0; i < n; i++) this._tone(o, { t0: i * (0.09 + Math.random() * 0.05), dur: 0.08, type: 'sine', f0: base * (0.9 + Math.random() * 0.3), f1: base * (1.1 + Math.random() * 0.5), gain: 0.6, attack: 0.01 });
      }
      this._birdTimer = setTimeout(bird, 2500 + Math.random() * 7000);
    };
    this._birdTimer = setTimeout(bird, 3000);
  }
}
