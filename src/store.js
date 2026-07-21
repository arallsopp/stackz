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

  // --- mute ---
  get muted() {
    return this.data.muted;
  }

  set muted(v) {
    this.data.muted = !!v;
    this._write();
  }
}
