// Persistent player progress, backed by localStorage under a single namespaced
// key. All persistence lives here so the rest of the game stays stateless about
// storage (Separation of Concerns). Safe if localStorage is unavailable.

const KEY = 'stackz.save.v1';

const DEFAULTS = {
  bestScores: {}, // { [levelIndex]: fewestShots }
  highestLevel: 0, // furthest level index reached (progress resumes here)
  airstrikes: 1, // current airstrike bank (scarce, global)
  wins: 0, // total level completions (drives airstrike replenishment)
  muted: false,
  mode: 'normal', // 'normal' (authored par) | 'learning' (par auto-tunes from attempts, skip enabled)
  parStats: {}, // { [levelIndex]: { sum, n } } running shots-to-clear stats for Learning mode
};

export class Store {
  constructor() {
    this.data = { ...DEFAULTS, ...this._read() };
  }

  _read() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  }

  _write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable (private mode) — run without persistence */
    }
  }

  // --- best scores ---
  bestScore(levelIndex) {
    return this.data.bestScores[levelIndex] ?? null;
  }

  // Record a completion; returns true if it's a new personal best.
  recordScore(levelIndex, shots) {
    const prev = this.bestScore(levelIndex);
    const isBest = prev == null || shots < prev;
    if (isBest) {
      this.data.bestScores[levelIndex] = shots;
      this._write();
    }
    return isBest;
  }

  // --- progress ---
  get highestLevel() {
    return this.data.highestLevel;
  }

  // Remember the furthest level the player has reached (never regresses).
  recordHighestLevel(levelIndex) {
    if (levelIndex > this.data.highestLevel) {
      this.data.highestLevel = levelIndex;
      this._write();
    }
  }

  // --- airstrike bank ---
  get airstrikes() {
    return this.data.airstrikes;
  }

  spendAirstrike() {
    if (this.data.airstrikes <= 0) return false;
    this.data.airstrikes -= 1;
    this._write();
    return true;
  }

  // Count a win and replenish +1 airstrike every `per` completions.
  registerWin(per = 5) {
    this.data.wins += 1;
    if (this.data.wins % per === 0) this.data.airstrikes += 1;
    this._write();
  }

  // --- mode ---
  get mode() {
    return this.data.mode;
  }

  set mode(v) {
    this.data.mode = v === 'learning' ? 'learning' : 'normal';
    this._write();
  }

  // --- learned par (Learning mode) ---
  // Record one shots-to-clear sample (a clear, or a failure charged as budget+inc).
  recordParSample(levelIndex, shots) {
    const s = (this.data.parStats ||= {});
    const e = (s[levelIndex] ||= { sum: 0, n: 0 });
    e.sum += shots;
    e.n += 1;
    this._write();
  }

  // Effective par = running average of samples, SEEDED with the authored par as a
  // prior so a single fluke result can't strand the ball budget. With no samples
  // it's just the authored par; it converges to the player's own average.
  learnedPar(levelIndex, authoredPar) {
    const e = this.data.parStats?.[levelIndex] || { sum: 0, n: 0 };
    return Math.max(1, Math.round((authoredPar + e.sum) / (1 + e.n)));
  }

  // --- mute ---
  get muted() {
    return this.data.muted;
  }

  set muted(v) {
    this.data.muted = !!v;
    this._write();
  }
}
