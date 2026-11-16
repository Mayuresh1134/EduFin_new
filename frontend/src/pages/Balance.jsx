import { useState } from 'react';
import { ArrowRightLeft, CheckCircle2, Gift, PiggyBank, Undo2 } from 'lucide-react';
import { api, localDate } from '../api.js';
import { useAction, useLoad } from '../hooks.js';
import { toast } from '../fx.js';
import { inr, niceTime, num, signed } from '../format.js';
import { Coin, CountUp, NumberBox, PageState } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

const KINDS = {
  task: { icon: CheckCircle2, label: 'Time Tracker' },
  task_undo: { icon: Undo2, label: 'Time Tracker' },
  budget: { icon: PiggyBank, label: 'Expense Tracker' },
  reward: { icon: Gift, label: 'Reward' },
  convert: { icon: ArrowRightLeft, label: 'Trading cash' },
};

export default function Balance() {
  const { user } = useAuth();
  const { data, error, reload } = useLoad(() => api('/balance'), []);
  const [run, busy] = useAction();
  const [coins, setCoins] = useState(null);

  if (!data) return <PageState error={error} onRetry={reload} />;

  const { level } = user;
  const progress = level.next ? Math.min(100, (user.lifetime_coins / level.next.at) * 100) : 100;
  const convert = (e) => {
    e.preventDefault();
    run(() => api('/balance/convert', { method: 'POST', body: { coins, date: localDate() } }), () => {
      toast(`Moved ${num(coins)} coins to trading cash`);
      setCoins(null);
      reload();
    });
  };

  return (
    <div className="narrow">
      <div className="page-head"><h1>Balance</h1></div>
      <div className="cols even">
        <div className="glass panel hero">
          <span className="muted">SM coins</span>
          <p className="hero-coins"><Coin size={52} /><CountUp value={user.coins} /></p>
          <div className="level">
            <div className="row">
              <span className="badge plan">{level.name}</span>
              <span className="hint tnum">
                {level.next ? `${num(user.lifetime_coins)} of ${num(level.next.at)} lifetime coins to reach ${level.next.name}` : `${num(user.lifetime_coins)} lifetime coins`}
              </span>
            </div>
            <div className="meter thin"><i style={{ width: `${progress}%` }} /></div>
          </div>
        </div>

        <form className="glass panel stack" onSubmit={convert}>
          <span className="muted">Trading cash</span>
          <p className="big tnum"><CountUp value={user.cash} format={(v) => inr(v, { paise: true })} /></p>
          <label htmlFor="convert" className="small-label">Move coins into trading cash</label>
          <NumberBox id="convert" label="Coins to move" value={coins} onChange={setCoins} min={0} max={user.coins} step={100} suffix="coins" />
          <div className="chips">
            {[0.25, 0.5, 1].map((f) => (
              <button key={f} type="button" className="chip" disabled={!user.coins} onClick={() => setCoins(Math.floor(user.coins * f))}>
                {f === 1 ? 'All' : `${f * 100}%`}
              </button>
            ))}
          </div>
          <button className="btn primary block" disabled={busy || !(coins >= 1)}>
            {coins >= 1 ? `Move ${num(coins)} coins for ${inr(coins * data.rate)}` : 'Move to trading cash'}
          </button>
          <p className="hint">1 coin buys ₹{data.rate} of practice money for the Trading screen. It can't be moved back.</p>
        </form>
      </div>

      <section className="glass panel">
        <h2>Coin history</h2>
        {data.ledger.length === 0 ? (
          <p className="hint lead">No coins yet. Finish a task in the Time Tracker or close a day under your goal in the Expense Tracker.</p>
        ) : (
          <ul className="rows">
            {data.ledger.map((row) => {
              const kind = KINDS[row.kind] || KINDS.task;
              return (
                <li key={row.id}>
                  <span className="tip-icon"><kind.icon size={18} /></span>
                  <div className="rows-main"><strong>{row.note}</strong><span>{kind.label}, {niceTime(row.ts)}</span></div>
                  <strong className={`tnum ${row.amount >= 0 ? 'good-text' : ''}`}>{signed(row.amount)}</strong>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
