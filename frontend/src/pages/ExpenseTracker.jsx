import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Lock } from 'lucide-react';
import { api, localDate } from '../api.js';
import { useAction, useLoad } from '../hooks.js';
import { inr, num } from '../format.js';
import { Coin, CountUp, Modal, NumberBox, PageState } from '../components/ui.jsx';
import { Donut } from '../components/Donut.jsx';
import { Category, Item } from '../components/Planner.jsx';

const COLORS = { food: 'var(--s1)', travel: 'var(--s2)', misc: 'var(--s3)', luxury: 'var(--s4)' };

function ExpenseForm({ onAdd }) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState(null);
  const submit = (e, paid) => {
    e.preventDefault();
    if (title.trim() && amount > 0) onAdd(title.trim(), amount, paid);
  };
  return (
    <form className="cat-form" onSubmit={(e) => submit(e, false)}>
      <div className="form-pair">
        <input className="input" autoFocus required maxLength={80} placeholder="What is it for?" aria-label="Expense name" value={title} onChange={(e) => setTitle(e.target.value)} />
        <NumberBox label="Amount" value={amount} onChange={setAmount} min={0} max={10000000} step={50} prefix="₹" />
      </div>
      <div className="row">
        <span className="hint">Tick an expense once you've paid it.</span>
        <span className="btn-pair">
          <button type="button" className="btn soft sm" disabled={!amount} onClick={(e) => submit(e, true)}>Add as paid</button>
          <button className="btn primary sm" disabled={!amount}>Add planned</button>
        </span>
      </div>
    </form>
  );
}

export default function ExpenseTracker() {
  const date = useMemo(() => localDate(), []);
  const { data, setData, error, reload } = useLoad(() => api(`/expenses?date=${date}`), [date]);
  const [run, busy] = useAction();
  const [adding, setAdding] = useState(null);
  const [goalDraft, setGoalDraft] = useState(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (data) setGoalDraft(data.goal ?? data.suggested_goal ?? null);
  }, [data?.goal, data?.suggested_goal]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <PageState error={error} onRetry={reload} />;

  const locked = data.closed;
  const saveGoal = (e) => {
    e.preventDefault();
    if (goalDraft > 0) run(() => api('/expenses/goal', { method: 'PUT', body: { date, goal: goalDraft } }), setData);
  };
  const add = (category, title, amount, paid) =>
    run(() => api('/expenses/items', { method: 'POST', body: { date, category, title, amount, paid } }), (d) => { setData(d); setAdding(null); });
  const tick = (item, paid) => run(() => api(`/expenses/items/${item.id}`, { method: 'PATCH', body: { paid } }), setData);
  const remove = (item) => run(() => api(`/expenses/items/${item.id}`, { method: 'DELETE' }), setData);
  const close = () => run(() => api('/expenses/close', { method: 'POST', body: { date } }), (d) => { setData(d); setConfirming(false); });

  const over = data.goal && data.spent > data.goal;
  const segments = [
    ...data.categories.map((c) => ({ key: c.key, label: c.label, value: data.by_category[c.key], color: COLORS[c.key] })),
    { key: 'left', label: 'Total Money Remaining', value: data.remaining || 0, color: 'var(--track-strong)', quiet: true },
  ];
  const goalChanged = goalDraft !== data.goal;

  return (
    <div className="cols">
      <div className="glass panel stack-lg">
        <form className="goal" onSubmit={saveGoal}>
          <h2 id="goal-label">Today's Goal</h2>
          <NumberBox label="Today's goal in rupees" value={goalDraft} onChange={setGoalDraft} min={1} max={10000000} step={100} prefix="₹" />
          {!locked && (goalChanged || !data.goal) && (
            <button className="btn primary sm" disabled={!goalDraft || busy}>{data.goal ? 'Update goal' : 'Set goal'}</button>
          )}
          {locked && <span className="chip"><Lock size={13} /> Day closed</span>}
        </form>
        {!data.goal && !locked && (
          <p className="hint lead">
            The goal is the most you plan to spend today. Finish the day at or under it to earn 100 to 500 coins.
            {data.suggested_goal ? ` Last time you chose ${inr(data.suggested_goal)}.` : ''}
          </p>
        )}

        <section>
          <h2 className="small">Expenses</h2>
          <div className="cats">
            {data.categories.map((c) => {
              const items = data.items.filter((i) => i.category === c.key);
              return (
                <Category key={c.key} label={c.label} meta={data.by_category[c.key] ? inr(data.by_category[c.key]) : null}
                  adding={adding === c.key} onToggle={() => setAdding(adding === c.key ? null : c.key)} locked={locked}
                  form={<ExpenseForm onAdd={(title, amount, paid) => add(c.key, title, amount, paid)} />}>
                  {items.map((i) => (
                    <Item key={i.id} title={i.title} meta={inr(i.amount)} checked={i.paid} locked={locked}
                      checkLabel={`${i.title}: paid`} onCheck={(paid) => tick(i, paid)} onDelete={() => remove(i)} />
                  ))}
                </Category>
              );
            })}
          </div>
        </section>
      </div>

      <div className="side stack-lg">
        <div className="glass panel">
          <Donut segments={segments} format={inr} centerLabel="Spent today" centerValue={inr(data.spent)} emptyText="Set a goal or tick a paid expense" />
          {data.goal > 0 && (
            <>
              <div className="meter" role="img" aria-label={`${inr(data.spent)} spent of ${inr(data.goal)}`}>
                <motion.i className={over ? 'bad' : ''} initial={false} animate={{ width: `${Math.min(100, (data.spent / data.goal) * 100)}%` }} transition={{ type: 'spring', stiffness: 120, damping: 20 }} />
              </div>
              <p className="hint meter-note tnum">
                {over ? `${inr(data.over_by)} over your ${inr(data.goal)} goal` : `${inr(data.remaining)} left of ${inr(data.goal)}`}
                {data.planned > data.spent ? `, with ${inr(data.planned - data.spent)} still planned` : ''}
              </p>
            </>
          )}
        </div>

        <motion.div layout className={`glass panel earned ${locked && data.bonus ? 'won' : ''}`}>
          {locked ? (
            data.bonus > 0 ? (
              <>
                <p className="earned-title">Congratulations!! You Have Achieved your goal.</p>
                <p className="earned-sub">Earnings Today:</p>
                <p className="earned-coins"><Coin size={34} /><CountUp value={data.bonus} /></p>
              </>
            ) : (
              <>
                <p className="earned-title">Today went {inr(data.over_by)} over your goal</p>
                <p className="hint">No coins this time. Tomorrow is a new goal.</p>
              </>
            )
          ) : data.goal ? (
            <>
              <p className="earned-title">{over ? "You're over today's goal" : "You're on track"}</p>
              <p className="earned-coins dim"><Coin size={34} /><span className="tnum">{num(data.bonus)}</span></p>
              <p className="hint">
                {over ? 'Closing the day now earns nothing. Untick anything you have not actually paid.' : 'What you collect if the day ends like this.'}
              </p>
              <button type="button" className="btn primary block" onClick={() => setConfirming(true)}>Close the day</button>
            </>
          ) : (
            <>
              <p className="earned-title">Set today's goal to start</p>
              <p className="hint">Then add what you plan to spend and tick each one as you pay.</p>
            </>
          )}
        </motion.div>
      </div>

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Close the day?">
        <div className="stack">
          <p className="muted">
            You've paid {inr(data.spent)} against a goal of {inr(data.goal || 0)}.
            {data.bonus > 0 ? ` Closing now collects ${num(data.bonus)} coins.` : ' Closing now earns no coins.'}
          </p>
          <p className="hint">Today's expenses can't be changed after this.</p>
          <div className="btn-pair end">
            <button type="button" className="btn soft" onClick={() => setConfirming(false)}>Keep it open</button>
            <button type="button" className="btn primary" data-autofocus onClick={close} disabled={busy}>
              {data.bonus > 0 ? `Close and collect ${num(data.bonus)} coins` : 'Close the day'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
