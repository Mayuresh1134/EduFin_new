import { useMemo, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { inr, inrShort } from '../format.js';
import { CountUp, NumberBox, Reveal } from '../components/ui.jsx';

const FREQUENCIES = [
  { value: 1, label: 'Annually' },
  { value: 2, label: 'Half-yearly' },
  { value: 4, label: 'Quarterly' },
  { value: 12, label: 'Monthly' },
  { value: 365, label: 'Daily' },
];

// A = P (1 + r/n)^(n t)
const grow = (p, rate, n, years) => p * (1 + rate / 100 / n) ** (n * years);

function Tip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <span>After {d.year} year{d.year === 1 ? '' : 's'}</span>
      <strong className="tnum">{inr(d.total, { paise: true })}</strong>
      <span className="tnum">Interest {inr(d.total - d.principal, { paise: true })}</span>
    </div>
  );
}

export default function GrowthCalculator() {
  const [principal, setPrincipal] = useState(10000);
  const [rate, setRate] = useState(10);
  const [years, setYears] = useState(10);
  const [n, setN] = useState(1);

  const ok = principal > 0 && rate !== null && years > 0;
  const total = ok ? grow(principal, rate, n, years) : 0;
  const series = useMemo(() => {
    if (!ok) return [];
    const whole = Math.floor(years);
    const points = Array.from({ length: whole + 1 }, (_, y) => ({ year: y, total: grow(principal, rate, n, y), principal }));
    if (years > whole) points.push({ year: years, total: grow(principal, rate, n, years), principal });
    return points;
  }, [ok, principal, rate, years, n]);

  return (
    <>
      <div className="page-head"><h1>Calculate your Investment Growth</h1></div>
      <div className="cols even">
        <div className="glass panel form-rows">
          <div className="form-row">
            <label htmlFor="gc-p">Principal Amount</label>
            <NumberBox id="gc-p" label="Principal amount" value={principal} onChange={setPrincipal} min={1} max={1000000000} step={1000} prefix="₹" />
          </div>
          <div className="form-row">
            <label htmlFor="gc-r">Rate of Interest (in %)</label>
            <NumberBox id="gc-r" label="Rate of interest" value={rate} onChange={setRate} min={0} max={100} step={0.5} suffix="%" />
          </div>
          <div className="form-row">
            <label htmlFor="gc-y">Duration of the Investment</label>
            <NumberBox id="gc-y" label="Duration in years" value={years} onChange={setYears} min={1} max={60} step={1} suffix="years" />
          </div>
          <div className="form-row">
            <label htmlFor="gc-n">Compound Frequency</label>
            <select id="gc-n" className="select" value={n} onChange={(e) => setN(Number(e.target.value))}>
              {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>

          <div className="result">
            <span>Final Amount of {ok ? years : 'N'} year{years === 1 ? '' : 's'} of Investment:</span>
            <strong><CountUp value={total} format={(v) => inr(v, { paise: true })} /></strong>
            {ok && (
              <span className="tnum">
                {inr(total - principal, { paise: true })} of that is interest, {(total / principal).toFixed(2)} times what you put in.
              </span>
            )}
          </div>
        </div>

        <div className="glass panel">
          <h2>How it builds up</h2>
          <p className="muted">Interest earns interest, so the line bends upward the longer you wait.</p>
          {ok ? (
            <div className="chart" role="img" aria-label={`Value grows from ${inr(principal)} to ${inr(total)} over ${years} years`}>
              <Reveal id="growth">
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={series} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="growfill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" style={{ stopColor: 'var(--s1)', stopOpacity: 0.4 }} />
                      <stop offset="100%" style={{ stopColor: 'var(--s1)', stopOpacity: 0 }} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="year" type="number" domain={[0, years]} tickCount={Math.min(years + 1, 8)} allowDecimals={false}
                    tick={{ fill: 'var(--text-3)', fontSize: 12 }} axisLine={false} tickLine={false} tickFormatter={(y) => `${y}y`} />
                  <YAxis orientation="right" width={62} tickFormatter={inrShort} tick={{ fill: 'var(--text-3)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<Tip />} cursor={{ stroke: 'var(--s1)', strokeDasharray: '4 4' }} />
                  <ReferenceLine y={principal} stroke="var(--text-3)" strokeDasharray="5 5"
                    label={{ value: 'What you put in', position: 'insideTopRight', fill: 'var(--text-3)', fontSize: 12 }} />
                  <Area type="monotone" dataKey="total" stroke="var(--s1)" strokeWidth={2.5} fill="url(#growfill)" dot={false}
                    activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
              </Reveal>
            </div>
          ) : (
            <p className="hint lead">Fill in the amount, rate and duration to see the curve.</p>
          )}
        </div>
      </div>
    </>
  );
}
