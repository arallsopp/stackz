// All DOM / on-screen UI lives here: the HUD readouts, the start/win overlays,
// the airstrike + mute buttons, and the muzzle flash. The game drives it through
// a small method surface and receives button events via injected handlers, so
// game logic stays free of DOM details (Separation of Concerns).
export class Hud {
  // handlers: { onStart, onReplay, onNext, onAirstrike, onToggleMute }
  constructor(handlers = {}) {
    const el = (id) => document.getElementById(id);
    this.el = {
      app: el('app'),
      hud: el('hud'),
      level: el('hud-level'),
      balls: el('hud-balls'),
      ballsPill: el('hud-balls-pill'),
      par: el('hud-par'),
      airstrikeBtn: el('airstrike-btn'),
      airstrikeCount: el('airstrike-count'),
      muteBtn: el('mute-btn'),
      skipBtn: el('skip-btn'),
      modeBtn: el('mode-btn'),
      modeValue: el('mode-value'),
      loading: el('loading'),
      startScreen: el('start-screen'),
      winScreen: el('win-screen'),
      winShots: el('win-shots'),
      winPar: el('win-par'),
      winBest: el('win-best'),
      stars: el('stars'),
      loseScreen: el('lose-screen'),
      loseBest: el('lose-best'),
      recordLine: el('record-line'),
      recordLevel: el('record-level'),
    };
    this._flashEl = null;

    el('start-btn').addEventListener('click', () => handlers.onStart?.());
    el('replay-btn').addEventListener('click', () => handlers.onReplay?.());
    el('next-btn').addEventListener('click', () => handlers.onNext?.());
    el('lose-retry-btn').addEventListener('click', () => handlers.onReplay?.());
    this.el.airstrikeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onAirstrike?.();
    });
    this.el.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onToggleMute?.();
    });
    this.el.skipBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onSkip?.();
    });
    this.el.modeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onToggleMode?.();
    });
    this._mode = 'normal';
  }

  // Reflect the current game mode: label the toggle and show SKIP only in Learning.
  setMode(mode) {
    this._mode = mode;
    this.el.modeValue.textContent = mode === 'learning' ? 'LEARNING' : 'NORMAL';
    this.el.modeBtn.classList.toggle('is-learning', mode === 'learning');
    this.el.skipBtn.classList.toggle('hidden', mode !== 'learning');
  }

  hideLoading() {
    this.el.loading.classList.add('hidden');
  }

  // Reveal the in-game HUD + buttons (called when play starts).
  enterGame() {
    this.el.startScreen.classList.add('hidden');
    this.el.hud.classList.remove('hidden');
    this.el.airstrikeBtn.classList.remove('hidden');
    this.el.muteBtn.classList.remove('hidden');
    this.el.skipBtn.classList.toggle('hidden', this._mode !== 'learning'); // SKIP is a Learning-mode aid
  }

  setLevel(n) {
    this.el.level.textContent = n;
  }

  // The furthest level reached, shown as a record on the start screen. `n` is the
  // 1-based level number; hidden until the player has actually cleared past L1.
  setRecordLevel(n) {
    this.el.recordLevel.textContent = n;
    this.el.recordLine.classList.toggle('hidden', n <= 1);
  }

  setPar(n) {
    this.el.par.textContent = n;
  }

  // Balls remaining for this level (counts down toward zero).
  setBalls(n) {
    this.el.balls.textContent = n;
    this.el.ballsPill.classList.toggle('low', n <= 1);
  }

  setAirstrikes(count) {
    this.el.airstrikeCount.textContent = count;
    this.el.airstrikeBtn.disabled = count <= 0;
  }

  setMuted(muted) {
    this.el.muteBtn.textContent = muted ? '🔇' : '🔊';
    this.el.muteBtn.classList.toggle('is-muted', muted);
    this.el.muteBtn.setAttribute('aria-pressed', String(muted));
  }

  // Radial muzzle flash at a screen point.
  flash(x, y) {
    if (!this._flashEl) {
      this._flashEl = document.createElement('div');
      this._flashEl.className = 'flash';
      this.el.app.appendChild(this._flashEl);
    }
    const f = this._flashEl;
    f.style.setProperty('--fx', `${x}px`);
    f.style.setProperty('--fy', `${y}px`);
    f.classList.remove('go');
    void f.offsetWidth; // restart the animation
    f.classList.add('go');
  }

  hideWin() {
    this.el.winScreen.classList.add('hidden');
  }

  // stats: { shots, par, stars, bestText, airstrikeUsed }
  showWin({ shots, par, stars, bestText, airstrikeUsed }, delay = 700) {
    // An airstrike voids the score for the level (no shots count, no stars).
    this.el.winShots.textContent = airstrikeUsed ? '—' : shots;
    this.el.winPar.textContent = par;
    this.el.winBest.textContent = bestText;
    this.el.stars.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('on', !airstrikeUsed && i < stars));
    setTimeout(() => this.el.winScreen.classList.remove('hidden'), delay);
  }

  hideLose() {
    this.el.loseScreen.classList.add('hidden');
  }

  // stats: { bestText }
  showLose({ bestText = '' } = {}, delay = 600) {
    this.el.loseBest.textContent = bestText;
    setTimeout(() => this.el.loseScreen.classList.remove('hidden'), delay);
  }
}
