// A tiny event bus for two app-wide effects: toasts, and coins flying to the balance.

const listeners = { toast: new Set(), coins: new Set() };

function on(kind, fn) {
  listeners[kind].add(fn);
  return () => listeners[kind].delete(fn);
}

export const onToast = (fn) => on('toast', fn);
export const onCoins = (fn) => on('coins', fn);

export function toast(message, kind = 'info') {
  listeners.toast.forEach((fn) => fn({ message, kind }));
}

// Remember where the user last clicked or tapped: earned coins fly out from there.
const origin = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
window.addEventListener('pointerdown', (e) => { origin.x = e.clientX; origin.y = e.clientY; }, true);
window.addEventListener('keydown', () => {
  const el = document.activeElement;
  if (el && el !== document.body) {
    const r = el.getBoundingClientRect();
    origin.x = r.left + r.width / 2;
    origin.y = r.top + r.height / 2;
  }
}, true);

export function coinsEarned(amount) {
  listeners.coins.forEach((fn) => fn({ amount, from: { ...origin } }));
}
