import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import { ChevronDown, ChevronUp, CircleAlert, Eye, EyeOff, X } from 'lucide-react';
import { onCoins, onToast } from '../fx.js';
import { num } from '../format.js';

export const spring = { type: 'spring', stiffness: 420, damping: 34, mass: 0.9 };

/* ---------- the coin ---------- */

export function Coin({ size = 20, className = '' }) {
  return (
    <svg className={`coin ${className}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="17" r="14" fill="#e39a06" />
      <circle cx="16" cy="15" r="14" fill="#ffc42e" />
      <circle cx="16" cy="15" r="10" fill="none" stroke="#f0a90f" strokeWidth="1.8" />
      <path d="M16 8.6l1.9 3.9 4.3.6-3.1 3 .8 4.2-3.9-2-3.9 2 .8-4.2-3.1-3 4.3-.6z" fill="#fff4cc" />
      <path d="M7 9.5a11 11 0 0 1 7-5.2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" opacity=".75" />
    </svg>
  );
}

/* ---------- numbers that count up when they change ---------- */

export function CountUp({ value, format = num }) {
  const ref = useRef(null);
  const shown = useRef(value);
  const first = useRef(format(value));
  const reduced = useReducedMotion();

  useEffect(() => {
    const from = shown.current;
    shown.current = value;
    if (from === value || reduced) {
      if (ref.current) ref.current.textContent = format(value);
      return undefined;
    }
    const controls = animate(from, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => { if (ref.current) ref.current.textContent = format(v); },
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced]);

  // The text is written directly to the element, so React is given a constant child.
  return <span ref={ref} className="tnum">{first.current}</span>;
}

/* ---------- form controls ---------- */

export function Field({ label, error, hint, children }) {
  const id = useId();
  return (
    <div className="field">
      {label && <label htmlFor={id}>{label}</label>}
      {children(id)}
      {error ? <p className="field-error"><CircleAlert size={14} />{error}</p> : hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function TextInput({ id, ...props }) {
  return <input id={id} className="input" {...props} />;
}

export function PasswordInput({ id, ...props }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="input-wrap">
      <input id={id} className="input" type={shown ? 'text' : 'password'} {...props} />
      <button type="button" className="input-eye" onClick={() => setShown((s) => !s)} aria-label={shown ? 'Hide password' : 'Show password'}>
        {shown ? <Eye size={18} /> : <EyeOff size={18} />}
      </button>
    </div>
  );
}

const round2 = (n) => Math.round(n * 100) / 100;

// A number you can type or nudge with the arrows (the ▲▼ boxes in the design).
export function NumberBox({ value, onChange, min = 0, max = Infinity, step = 1, prefix, suffix, label, id }) {
  const [text, setText] = useState(value === null || value === undefined ? '' : String(value));
  const focused = useRef(false);
  const asText = (v) => (v === null || v === undefined ? '' : String(v));

  useEffect(() => {
    if (!focused.current) setText(asText(value));
  }, [value]);

  const clamp = (n) => Math.min(max, Math.max(min, n));
  const type = (raw) => {
    setText(raw);
    const n = Number(raw.replace(/,/g, ''));
    onChange(raw.trim() !== '' && Number.isFinite(n) ? clamp(n) : null);
  };
  const bump = (dir) => {
    const n = clamp(round2((Number(value) || 0) + dir * step));
    onChange(n);
    setText(String(n));
  };

  return (
    <div className="numbox">
      {prefix && <span className="numbox-affix">{prefix}</span>}
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        value={text}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setText(asText(value)); }}
        onChange={(e) => type(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); }
          if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); }
        }}
      />
      {suffix && <span className="numbox-affix">{suffix}</span>}
      <span className="arrows">
        <button type="button" tabIndex={-1} aria-label={`Increase ${label}`} onClick={() => bump(1)}><ChevronUp size={15} /></button>
        <button type="button" tabIndex={-1} aria-label={`Decrease ${label}`} onClick={() => bump(-1)}><ChevronDown size={15} /></button>
      </span>
    </div>
  );
}

// A labelled value with arrows only, for "Sleep 8 h" style controls.
export function Stepper({ label, value, display, onChange, min, max, step, disabled }) {
  const set = (dir) => onChange(Math.min(max, Math.max(min, round2(value + dir * step))));
  return (
    <div className={`stepper ${disabled ? 'is-disabled' : ''}`}>
      <span className="arrows">
        <button type="button" disabled={disabled || value >= max} aria-label={`More ${label}`} onClick={() => set(1)}><ChevronUp size={16} /></button>
        <button type="button" disabled={disabled || value <= min} aria-label={`Less ${label}`} onClick={() => set(-1)}><ChevronDown size={16} /></button>
      </span>
      <span className="stepper-label">{label}</span>
      <span className="stepper-value tnum" aria-live="polite">{display}</span>
    </div>
  );
}

export function Check({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`check ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <motion.path
          d="M5.5 12.5l4.2 4.2L18.5 8"
          fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
          initial={false}
          animate={{ pathLength: checked ? 1 : 0, opacity: checked ? 1 : 0 }}
          transition={{ duration: 0.22 }}
        />
      </svg>
    </button>
  );
}

// A row of options with a thumb that slides to the chosen one.
export function Segmented({ options, value, onChange, label, name, className = '' }) {
  return (
    <div className={`seg ${className}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span layoutId={`seg-${name}`} className="seg-thumb" transition={spring} />}
          <span className="seg-text">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- modal ---------- */

export function Modal({ open, onClose, title, children, wide = false }) {
  const titleId = useId();
  const panel = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const t = setTimeout(() => {
      const target = panel.current?.querySelector('[data-autofocus], input, select, textarea') || panel.current;
      target?.focus();
    }, 30);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div className="modal-layer" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}
          onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <motion.div
            ref={panel}
            className={`glass modal ${wide ? 'wide' : ''}`}
            role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
            initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={spring}
          >
            <header className="modal-head">
              <h2 id={titleId}>{title}</h2>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
            </header>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/* ---------- toasts ---------- */

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => onToast((t) => {
    const id = Date.now() + Math.random();
    setItems((list) => [...list.slice(-2), { ...t, id }]);
    setTimeout(() => setItems((list) => list.filter((x) => x.id !== id)), t.kind === 'error' ? 5500 : 3500);
  }), []);
  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div key={t.id} layout className={`toast ${t.kind}`} initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} transition={spring}>
            {t.kind === 'error' && <CircleAlert size={16} />}
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  );
}

/* ---------- coins flying to the balance in the header ---------- */

export function CoinFly() {
  const [bursts, setBursts] = useState([]);
  const reduced = useReducedMotion();

  useEffect(() => onCoins(({ amount, from }) => {
    const target = document.getElementById('coin-target')?.getBoundingClientRect();
    if (!target) return;
    const id = Date.now() + Math.random();
    const count = Math.min(12, Math.max(4, Math.round(amount / 40)));
    const coins = Array.from({ length: count }, (_, i) => ({
      i,
      dx: (Math.random() - 0.5) * 120,
      dy: -40 - Math.random() * 70,
    }));
    setBursts((list) => [...list, { id, amount, from, to: { x: target.left + target.width / 2, y: target.top + target.height / 2 }, coins }]);
    setTimeout(() => {
      setBursts((list) => list.filter((b) => b.id !== id));
      const pill = document.getElementById('coin-pill');
      pill?.classList.remove('bump');
      void pill?.offsetWidth; // restart the animation
      pill?.classList.add('bump');
    }, 1150);
  }), []);

  return createPortal(
    <div className="coinfly" aria-hidden="true">
      {bursts.map((b) => (
        <div key={b.id}>
          {!reduced && b.coins.map((c) => (
            <motion.span
              key={c.i}
              className="coinfly-coin"
              initial={{ x: b.from.x, y: b.from.y, scale: 0.2, opacity: 0 }}
              animate={{
                x: [b.from.x, b.from.x + c.dx, b.to.x],
                y: [b.from.y, b.from.y + c.dy, b.to.y],
                scale: [0.2, 1.15, 0.55],
                opacity: [0, 1, 1],
              }}
              transition={{ duration: 0.95, delay: c.i * 0.045, times: [0, 0.35, 1], ease: ['easeOut', [0.6, 0, 0.9, 0.6]] }}
            >
              <Coin size={24} />
            </motion.span>
          ))}
          <motion.span
            className="coinfly-label"
            initial={{ x: b.from.x, y: b.from.y - 10, opacity: 0 }}
            animate={{ y: b.from.y - 64, opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.1 }}
          >
            +{num(b.amount)}
          </motion.span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* ---------- loading and error states ---------- */

export function PageState({ error, onRetry }) {
  if (error) {
    return (
      <div className="glass panel state">
        <CircleAlert size={22} />
        <p>{error}</p>
        <button type="button" className="btn soft" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      <div className="glass sk" /><div className="glass sk" />
    </div>
  );
}

/* ---------- charts draw themselves in from the left ---------- */

export function Reveal({ id, children }) {
  return (
    <motion.div key={id} initial={{ clipPath: 'inset(0 100% 0 0)' }} animate={{ clipPath: 'inset(0 0% 0 0)' }} transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}>
      {children}
    </motion.div>
  );
}

// Two coins overlapping, for prices in the rewards shop.
export function CoinStack({ size = 30 }) {
  return (
    <span className="coin-stack" style={{ width: size * 1.45, height: size }}>
      <Coin size={size} /><Coin size={size} />
    </span>
  );
}
