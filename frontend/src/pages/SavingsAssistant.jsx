import { useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Lightbulb, Minus } from 'lucide-react';
import { api, localDate } from '../api.js';
import { useLoad } from '../hooks.js';
import { inr, niceDate, num, pct, signed } from '../format.js';
import { Coin, CountUp, Modal, PageState } from '../components/ui.jsx';

function Change({ label, change, unit }) {
  const dir = change.delta > 0 ? 'good' : change.delta < 0 ? 'bad' : 'flat';
  const Icon = dir === 'good' ? ArrowUpRight : dir === 'bad' ? ArrowDownRight : Minus;
  return (
    <div className="change">
      <span className="change-label">{label}: <b className="tnum">{signed(change.delta)}</b></span>
      <span className={`badge ${dir}`}>
        <Icon size={15} />
        {change.pct === null ? (change.delta ? 'New' : 'No change') : `${pct(change.pct, 0)}${unit}`}
      </span>
    </div>
  );
}

function MonthCalendar({ open, onClose, selected, today, onPick }) {
  const [month, setMonth] = useState(selected.slice(0, 7));
  const { data } = useLoad(() => (open ? api(`/savings/calendar?month=${month}`) : Promise.resolve(null)), [month, open]);

  const [y, m] = month.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const days = new Date(y, m, 0).getDate();
  const blanks = (first.getDay() + 6) % 7; // week starts on Monday
  const shift = (by) => setMonth(localDate(new Date(y, m - 1 + by, 1)).slice(0, 7));
  const most = Math.max(1, ...Object.values(data?.days || {}).map((d) => d.coins));

  return (
    <Modal open={open} onClose={onClose} title="Look back at a day">
      <div className="cal">
        <div className="cal-head">
          <button type="button" className="icon-btn" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft size={18} /></button>
          <strong>{first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</strong>
          <button type="button" className="icon-btn" onClick={() => shift(1)} disabled={month >= today.slice(0, 7)} aria-label="Next month"><ChevronRight size={18} /></button>
        </div>
        <div className="cal-grid" role="grid">
          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => <span key={d} className="cal-dow">{d}</span>)}
          {Array.from({ length: blanks }, (_, i) => <span key={`b${i}`} />)}
          {Array.from({ length: days }, (_, i) => {
            const iso = `${month}-${String(i + 1).padStart(2, '0')}`;
            const info = data?.days?.[iso];
            return (
              <button key={iso} type="button" disabled={iso > today}
                className={`cal-day ${iso === selected ? 'on' : ''} ${iso === today ? 'today' : ''}`}
                aria-label={`${niceDate(iso)}${info ? `: ${num(info.coins)} coins, ${inr(info.saved)} saved` : ''}`}
                onClick={() => { onPick(iso); onClose(); }}>
                {i + 1}
                {info?.coins > 0 && <i style={{ opacity: 0.35 + 0.65 * (info.coins / most) }} />}
              </button>
            );
          })}
        </div>
        <p className="hint"><i className="cal-key" /> A gold dot marks a day you earned coins. Brighter means more.</p>
      </div>
    </Modal>
  );
}

export default function SavingsAssistant() {
  const today = useMemo(() => localDate(), []);
  const [date, setDate] = useState(today);
  const [picking, setPicking] = useState(false);
  const { data, error, reload } = useLoad(() => api(`/savings?date=${date}`), [date]);

  if (!data) return <PageState error={error} onRetry={reload} />;
  const isToday = date === today;
  const day = isToday ? 'today' : `on ${niceDate(date, { day: 'numeric', month: 'short' })}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Savings Assistant</h1>
          <p className="muted">{isToday ? 'Today' : niceDate(date)}{!isToday && <button type="button" className="link" onClick={() => setDate(today)}>Back to today</button>}</p>
        </div>
        <button type="button" className="btn soft" onClick={() => setPicking(true)}><CalendarDays size={18} /> Pick a day</button>
      </div>

      <div className="cols">
        <div className="glass panel ledger">
          <div className="ledger-row">
            <span>Your total SM coins earnings {day}</span>
            <span className="pill-stat"><Coin size={22} /><CountUp value={data.coins_today} /></span>
          </div>
          <div className="ledger-row">
            <span>SM coins earned in the whole month</span>
            <span className="pill-stat"><Coin size={22} /><CountUp value={data.coins_month} /></span>
          </div>

          <div className="ledger-block">
            <span>Improvement compared to the last time</span>
            <div className="changes">
              <Change label="Month" change={data.month} unit=" MoM" />
              <Change label="Day" change={data.day} unit=" DoD" />
            </div>
            <p className="hint">Month compares with the same days of last month. Day compares with the day before.</p>
          </div>

          <div className="ledger-row">
            <span>Real money savings {day}</span>
            <span className="pill-stat"><span className="rupee">₹</span><CountUp value={data.saved_today} /></span>
          </div>
          <div className="ledger-row">
            <span>This month's whole savings</span>
            <span className="pill-stat"><span className="rupee">₹</span><CountUp value={data.saved_month} /></span>
          </div>
          <p className="hint">Savings are what you kept under your Expense Tracker goal each day.</p>
        </div>

        <div className="glass panel side">
          <h2>Where can you save more</h2>
          <ul className="tips">
            {data.tips.map((t) => (
              <li key={t.title}>
                <span className="tip-icon"><Lightbulb size={18} /></span>
                <div><strong>{t.title}</strong><p>{t.body}</p></div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <MonthCalendar open={picking} onClose={() => setPicking(false)} selected={date} today={today} onPick={setDate} />
    </>
  );
}
