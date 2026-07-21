// Procedural sound, synthesised with the Web Audio API — no asset files, so it
// stays offline/PWA-friendly with no extra network or CSP concerns.
//
// iOS notes:
//  - Safari needs `webkitAudioContext` and starts the context *suspended*; it can
//    only be resumed from inside a user gesture, so we create/resume in unlock(),
//    called from the first tap (Start button + canvas pointerdown).
//  - iOS honours the hardware mute switch for Web Audio; that's expected for a
//    casual game. The in-game mute toggle is independent and persisted.

const STORE_KEY = 'stackz-muted';

export class Audio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = (() => {
      try {
        return localStorage.getItem(STORE_KEY) === '1';
      } catch {
        return false;
      }
    })();
    this._lastImpact = 0;
    this.drone = null;
  }

  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);

    // 1s of white noise, reused for percussive/explosion sounds.
    const len = Math.floor(this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noise = buf;
  }

  // Call from a user gesture (first tap). Safe to call repeatedly.
  unlock() {
    this._ensure();
    this.resume();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  isMuted() {
    return this.muted;
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem(STORE_KEY, m ? '1' : '0');
    } catch {}
    if (this.master) {
      const t = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(m ? 0 : 0.9, t, 0.02);
    }
    if (m) this.stopDrone();
  }

  toggle() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // ---- primitives -----------------------------------------------------------

  _blip(freq, { type = 'sine', dur = 0.15, gain = 0.3, glide = null, attack = 0.005 } = {}) {
    const t0 = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (glide) o.frequency.exponentialRampToValueAtTime(Math.max(glide, 1), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  _noiseHit(dur, gain, { type = 'lowpass', freq = 1200, q = 1, sweepTo = null } = {}) {
    const t0 = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(sweepTo, 20), t0 + dur);
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  _ready() {
    if (this.muted) return false;
    this._ensure();
    return !!this.ctx && this.ctx.state === 'running';
  }

  // ---- sfx ------------------------------------------------------------------

  click() {
    if (!this._ready()) return;
    this._blip(660, { type: 'sine', dur: 0.05, gain: 0.12 });
  }

  fire() {
    if (!this._ready()) return;
    this._blip(300, { type: 'triangle', dur: 0.12, gain: 0.22, glide: 780 });
    this._noiseHit(0.08, 0.12, { type: 'highpass', freq: 900 });
  }

  // strength ~ approach speed of the impacting bodies.
  impact(strength) {
    if (!this._ready()) return;
    const now = this.ctx.currentTime;
    if (now - this._lastImpact < 0.028) return; // throttle to a clatter, not a buzz
    this._lastImpact = now;
    const vol = Math.max(0.04, Math.min(1, strength / 26));
    const freq = 90 + Math.random() * 70;
    this._blip(freq, { type: 'triangle', dur: 0.08 + vol * 0.06, gain: vol * 0.5, glide: freq * 0.6 });
    this._noiseHit(0.05, vol * 0.22, { type: 'lowpass', freq: 1600 });
  }

  bombDrop() {
    if (!this._ready()) return;
    this._blip(1500, { type: 'sine', dur: 0.5, gain: 0.1, glide: 280 });
  }

  explosion() {
    if (!this._ready()) return;
    this._noiseHit(0.7, 0.75, { type: 'lowpass', freq: 1600, sweepTo: 70 });
    this._blip(80, { type: 'sine', dur: 0.5, gain: 0.6, glide: 32 });
    this._blip(120, { type: 'square', dur: 0.18, gain: 0.15, glide: 40 });
  }

  win() {
    if (!this._ready()) return;
    const t0 = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const t = t0 + i * 0.11;
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.28, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + 0.34);
    });
  }

  // ---- Hercules engine drone (loops during an airstrike run) ---------------

  startDrone() {
    if (this.muted || this.drone || !this._ready()) return;
    const t0 = this.ctx.currentTime;
    const o1 = this.ctx.createOscillator();
    const o2 = this.ctx.createOscillator();
    o1.type = o2.type = 'sawtooth';
    o1.frequency.value = 78;
    o2.frequency.value = 79; // slight beat between the two
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 360;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.13, t0 + 0.4);

    // Prop chop: an LFO amplitude-modulating the drone.
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 15;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.05;
    lfo.connect(lfoGain).connect(g.gain);

    o1.connect(filter);
    o2.connect(filter);
    filter.connect(g).connect(this.master);
    o1.start(t0);
    o2.start(t0);
    lfo.start(t0);
    this.drone = { o1, o2, lfo, g };
  }

  stopDrone() {
    if (!this.drone || !this.ctx) return;
    const { o1, o2, lfo, g } = this.drone;
    const t = this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0.0001, t, 0.12);
    const stopAt = t + 0.4;
    o1.stop(stopAt);
    o2.stop(stopAt);
    lfo.stop(stopAt);
    this.drone = null;
  }
}
