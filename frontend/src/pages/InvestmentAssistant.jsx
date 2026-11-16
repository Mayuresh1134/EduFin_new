import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import { api } from '../api.js';
import { inr } from '../format.js';
import { NumberBox, PageState, Segmented } from '../components/ui.jsx';
import { Donut } from '../components/Donut.jsx';

const RISKS = [
  { value: 'low', label: 'Low', name: 'low risk' },
  { value: 'moderate', label: 'Moderate', name: 'moderate risk' },
  { value: 'high', label: 'High', name: 'high risk' },
];
const COLORS = { stocks: 'var(--s1)', mutual_funds: 'var(--s2)', gold: 'var(--s3)', crypto: 'var(--s4)' };

export default function InvestmentAssistant() {
  const [amount, setAmount] = useState(10000);
  const [risk, setRisk] = useState('moderate');
  const [target, setTarget] = useState(10);
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  // Ask the server for a new mix shortly after the inputs stop changing.
  useEffect(() => {
    if (!(amount >= 100) || target === null) return undefined;
    let current = true;
    const t = setTimeout(() => {
      api('/invest/suggest', { method: 'POST', body: { amount, risk, target } })
        .then((p) => { if (current) { setPlan(p); setError(null); } })
        .catch((e) => { if (current) setError(e.message); });
    }, 220);
    return () => { current = false; clearTimeout(t); };
  }, [amount, risk, target, attempt]);

  if (!plan) return <PageState error={error} onRetry={() => setAttempt((n) => n + 1)} />;

  const riskLabel = RISKS.find((r) => r.value === plan.risk).name;
  return (
    <>
      <div className="page-head"><h1>Investment Suggestions</h1></div>
      <div className="cols even">
        <div className="glass panel form-rows">
          <div className="form-row">
            <label htmlFor="ia-amount">Investment Amount</label>
            <NumberBox id="ia-amount" label="Investment amount" value={amount} onChange={setAmount} min={100} max={1000000000} step={1000} prefix="₹" />
          </div>
          <div className="form-row">
            <span id="ia-risk">Risk level</span>
            <Segmented name="risk" label="Risk level" options={RISKS} value={risk} onChange={setRisk} className="fill" />
          </div>
          <div className="form-row">
            <label htmlFor="ia-target">Return Percentage</label>
            <NumberBox id="ia-target" label="Return percentage" value={target} onChange={setTarget} min={0} max={100} step={0.5} suffix="% a year" />
          </div>
          {amount !== null && amount < 100 && <p className="form-error">Enter at least ₹100.</p>}
          {error && <p className="form-error" role="alert">{error}</p>}

          <div className="assume">
            <h2 className="small">What this assumes</h2>
            <ul>
              {plan.allocation.map((a) => (
                <li key={a.key}><i style={{ background: COLORS[a.key] }} />{a.label}<span className="tnum">{a.assumed_return}% a year</span></li>
              ))}
            </ul>
            <p className="hint"><Info size={14} /> Round long-run figures chosen for teaching. Real returns vary and can be negative. This is not financial advice.</p>
          </div>
        </div>

        <div className="glass panel">
          <h2>Suggested Portfolio</h2>
          <p className="big tnum">{inr(plan.amount)}</p>
          <Donut
            segments={plan.allocation.map((a) => ({ key: a.key, label: a.label, value: a.amount, color: COLORS[a.key] }))}
            format={inr} centerLabel="Expected" centerValue={`${plan.expected_return.toFixed(1)}%`}
          />
          <div className="facts">
            <div><span>Expected return</span><strong className="tnum">{plan.expected_return.toFixed(1)}% a year</strong></div>
            <div><span>Could grow to, in 5 years</span><strong className="tnum">{inr(plan.value_in_5_years, { paise: false })}</strong></div>
          </div>
          {!plan.reachable && (
            <p className="note">
              At {riskLabel}, these mixes expect between {plan.range.min}% and {plan.range.max}% a year, so {plan.target}% is out of reach.
              This is the closest mix. {plan.target > plan.range.max ? 'Raise the risk level to aim higher.' : 'Lower the risk level for a gentler mix.'}
            </p>
          )}
        </div>
      </div>
    </>
  );
}
