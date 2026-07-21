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
      shots: el('hud-shots'),
      par: el('hud-par'),
      airstrikeBtn: el('airstrike-btn'),
      airstrikeCount: el('airstrike-count'),
      muteBtn: el('mute-btn'),
      loading: el('loading'),
      startScreen: el('start-screen'),
      winScreen: el('win-screen'),
      winShots: el('win-shots'),
      winPar: el('win-par'),
      winBest: el('win-best'),
      stars: el('stars'),
    };
    this._flashEl = null;

    el('start-btn').addEventListener('click', () => handlers.onStart?.());
    el('replay-btn').addEventListener('click', () => handlers.onReplay?.());
    el('next-btn').addEventListener('click', () => handlers.onNext?.());
    this.el.airstrikeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onAirstrike?.();
    });
    this.el.muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      handlers.onToggleMute?.();
    });
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
  }

  setLevel(n) {
    this.el.level.textContent = n;
  }

  setPar(n) {
    this.el.par.textContent = n;
  }

  setShots(n) {
    this.el.shots.textContent = n;
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

  // stats: { shots, par, stars, bestText }
  showWin({ shots, par, stars, bestText }, delay = 700) {
    this.el.winShots.textContent = shots;
    this.el.winPar.textContent = par;
    this.el.winBest.textContent = bestText;
    this.el.stars.querySelectorAll('.star').forEach((s, i) => s.classList.toggle('on', i < stars));
    setTimeout(() => this.el.winScreen.classList.remove('hidden'), delay);
  }
}
