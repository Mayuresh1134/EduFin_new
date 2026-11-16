import { useState } from 'react';
import { motion } from 'motion/react';

/*
  A donut chart with its legend.
  segments: [{ key, label, value, color, quiet }]   quiet = the neutral "what's left" slice
  Hovering or focusing a legend row (or a slice) shows that slice's figures in the middle.
*/
export function Donut({ segments, format, centerLabel, centerValue, emptyText = 'Nothing to show yet', size = 220, thickness = 30 }) {
  const [active, setActive] = useState(null);
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const r = (size - thickness) / 2 - 4;
  const circumference = 2 * Math.PI * r;
  const live = segments.filter((s) => s.value > 0);
  const gap = live.length > 1 ? 3 : 0;

  let offset = 0;
  const arcs = segments.map((s) => {
    const length = total ? (s.value / total) * circumference : 0;
    const arc = { ...s, start: offset, dash: Math.max(length - gap, 0), share: total ? s.value / total : 0 };
    offset += length;
    return arc;
  });
  const focus = arcs.find((a) => a.key === active);
  const summary = arcs.filter((a) => a.value > 0).map((a) => `${a.label} ${Math.round(a.share * 100)}%`).join(', ');

  return (
    <div className="donut">
      <div className="donut-ring" style={{ width: size, height: size }}>
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={total ? summary : emptyText}>
          <circle className="donut-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={thickness} />
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {arcs.map((a) => (
              <motion.circle
                key={a.key}
                cx={size / 2} cy={size / 2} r={r} fill="none"
                style={{ stroke: a.color }}
                strokeLinecap="butt"
                initial={{ strokeDasharray: `0 ${circumference}`, strokeDashoffset: 0 }}
                animate={{
                  strokeDasharray: `${a.dash} ${circumference - a.dash}`,
                  strokeDashoffset: -a.start,
                  strokeWidth: active === a.key ? thickness + 8 : thickness,
                  opacity: active && active !== a.key ? 0.35 : 1,
                }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
                onMouseEnter={() => setActive(a.key)}
                onMouseLeave={() => setActive(null)}
              />
            ))}
          </g>
        </svg>
        <div className="donut-center">
          {total === 0 ? (
            <span className="donut-empty">{emptyText}</span>
          ) : focus ? (
            <>
              <span className="donut-cap">{focus.label}</span>
              <strong className="tnum">{format(focus.value)}</strong>
              <span className="donut-cap tnum">{Math.round(focus.share * 100)}%</span>
            </>
          ) : (
            <>
              <span className="donut-cap">{centerLabel}</span>
              <strong className="tnum">{centerValue}</strong>
            </>
          )}
        </div>
      </div>

      <ul className="legend">
        {arcs.map((a) => (
          <li
            key={a.key}
            tabIndex={0}
            className={active === a.key ? 'on' : ''}
            onMouseEnter={() => setActive(a.key)} onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(a.key)} onBlur={() => setActive(null)}
          >
            <i style={{ background: a.color }} className={a.quiet ? 'quiet' : ''} />
            <span className="legend-name">{a.label}</span>
            <span className="legend-val tnum">{format(a.value)}</span>
            <span className="legend-pct tnum">{total ? `${Math.round(a.share * 100)}%` : '–'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
