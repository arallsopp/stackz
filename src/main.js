import './style.css';
import { Game } from './game.js';

// Try to go fullscreen on first user interaction (mobile-friendly).
function requestFullscreenOnce() {
  const go = () => {
    const el = document.documentElement;
    el.requestFullscreen?.().catch(() => {});
    window.removeEventListener('pointerdown', go);
  };
  window.addEventListener('pointerdown', go, { once: true });
}

async function boot() {
  const game = new Game();
  await game.init();
  // Expose for debugging / automated smoke tests.
  window.__game = game;
  requestFullscreenOnce();
}

boot().catch((err) => {
  console.error('Boot failed:', err);
  const loading = document.getElementById('loading');
  if (loading) loading.innerHTML = `<div class="loader"><p>FAILED TO LOAD<br/>${err.message}</p></div>`;
});
