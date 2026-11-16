const whole = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const twoDp = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const num = (n) => whole.format(Math.round(n || 0));

// ₹1,00,000 for round amounts, ₹25,937.42 when there are paise (or when asked).
export function inr(n, { paise = 'auto' } = {}) {
  const value = Number(n) || 0;
  const showPaise = paise === 'auto' ? Math.abs(value % 1) > 0.004 : paise;
  return `${value < 0 ? '−' : ''}₹${(showPaise ? twoDp : whole).format(Math.abs(value))}`;
}

// Short axis labels: ₹84.3L, ₹8.1K
export function inrShort(n) {
  const v = Math.abs(n);
  if (v >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (v >= 1e5) return `₹${(n / 1e5).toFixed(v >= 1e6 ? 1 : 2)}L`;
  if (v >= 1e4) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${whole.format(n)}`;
}

export const signed = (n, fmt = num) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${fmt(Math.abs(n))}`;

export function pct(n, digits = 1) {
  const shown = Math.abs(n).toFixed(digits);
  const zero = Number(shown) === 0; // never print "−0.0%"
  return `${zero ? '' : n > 0 ? '+' : '−'}${shown}%`;
}

export function duration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  if (!h) return `${m} min`;
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

export const qty = (n) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 4 : 6 }).format(n);

export function niceDate(isoDay, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  const [y, m, d] = isoDay.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', opts);
}

export const niceTime = (isoTs) =>
  new Date(isoTs).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
