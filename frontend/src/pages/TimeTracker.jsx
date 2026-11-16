import { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { api, localDate } from '../api.js';
import { useAction, useLoad } from '../hooks.js';
import { duration, num } from '../format.js';
import { Coin, CountUp, NumberBox, PageState, Stepper } from '../components/ui.jsx';
import { Donut } from '../components/Donut.jsx';
import { Category, Item } from '../components/Planner.jsx';

const SPENT = [
  { key: 'sleep', label: 'Sleep', color: 'var(--s1)' },
  { key: 'work', label: 'Work/School Hours', short: 'Work/School', color: 'var(--s2)' },
  { key: 'misc', label: 'Miscellaneous', color: 'var(--s3)' },
];

function TaskForm({ rate, maxMinutes, onAdd }) {
  const [title, setTitle] = useState('');
  const [minutes, setMinutes] = useState(Math.min(30, maxMinutes));
  if (maxMinutes < 5) {
    return <p className="cat-form hint">No free time is left today. Lower your time spent above, or remove a task.</p>;
  }
  const presets = [15, 30, 45, 60, 90, 120].filter((m) => m <= maxMinutes);
  const submit = (e) => {
    e.preventDefault();
    if (title.trim() && minutes) onAdd(title.trim(), minutes);
  };
  return (
    <form className="cat-form" onSubmit={submit}>
      <input className="input" autoFocus required maxLength={80} placeholder="What will you do?" aria-label="Task name" value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="chips">
        {presets.map((m) => (
          <button key={m} type="button" className={`chip ${minutes === m ? 'on' : ''}`} onClick={() => setMinutes(m)}>{duration(m)}</button>
        ))}
        <NumberBox label="Minutes" value={minutes} onChange={setMinutes} min={5} max={maxMinutes} step={5} suffix="min" />
      </div>
      <div className="row">
        <span className="hint earns">Earns <Coin size={15} /> <b className="tnum">{num((minutes || 0) * rate)}</b> when you tick it off</span>
        <button className="btn primary sm" disabled={!minutes}>Add task</button>
      </div>
    </form>
  );
}

export default function TimeTracker() {
  const date = useMemo(() => localDate(), []);
  const { data, setData, error, reload } = useLoad(() => api(`/time?date=${date}`), [date]);
  const [run] = useAction();
  const [adding, setAdding] = useState(null);
  const saveTimer = useRef(null);

  if (!data) return <PageState error={error} onRetry={reload} />;

  // Show the new hours at once, and save after the user stops clicking.
  const setHours = (key, value) => {
    const hours = { ...data.hours, [key]: value };
    const free = Math.round((24 - hours.sleep - hours.work - hours.misc) * 60);
    setData({ ...data, hours, free_minutes: free, remaining_minutes: free - data.scheduled_minutes });
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const saved = await run(() => api('/time', { method: 'PUT', body: { date, hours } }), setData);
      if (!saved) reload();
    }, 400);
  };

  const addTask = (category, title, minutes) =>
    run(() => api('/time/tasks', { method: 'POST', body: { date, category, title, minutes } }), (d) => { setData(d); setAdding(null); });
  const tick = (task, done) => run(() => api(`/time/tasks/${task.id}`, { method: 'PATCH', body: { done } }), setData);
  const remove = (task) => run(() => api(`/time/tasks/${task.id}`, { method: 'DELETE' }), setData);

  const headroom = Math.floor(data.remaining_minutes / 30) / 2; // hours that can still be added to "time spent"
  const segments = [
    ...SPENT.map((s) => ({ key: s.key, label: s.short || s.label, value: data.hours[s.key] * 60, color: s.color })),
    { key: 'free', label: 'Free Time', value: data.free_minutes, color: 'var(--s4)' },
  ];

  return (
    <div className="cols">
      <div className="glass panel stack-lg">
        <section>
          <h2>Time Spent</h2>
          <div className="stepper-grid">
            {SPENT.map((s) => (
              <Stepper key={s.key} label={s.label} value={data.hours[s.key]} display={duration(data.hours[s.key] * 60)}
                min={0} max={data.hours[s.key] + headroom} step={0.5} onChange={(v) => setHours(s.key, v)} />
            ))}
          </div>
        </section>

        <section>
          <h2>How do you want to schedule your free time</h2>
          <div className="cats">
            {data.categories.map((c) => {
              const tasks = data.tasks.filter((t) => t.category === c.key);
              const mins = tasks.reduce((sum, t) => sum + t.minutes, 0);
              return (
                <Category key={c.key} label={c.label} meta={mins ? duration(mins) : null}
                  adding={adding === c.key} onToggle={() => setAdding(adding === c.key ? null : c.key)}
                  form={<TaskForm rate={c.rate} maxMinutes={data.remaining_minutes} onAdd={(title, minutes) => addTask(c.key, title, minutes)} />}>
                  {tasks.map((t) => (
                    <Item key={t.id} title={t.title} meta={duration(t.minutes)} checked={t.done}
                      checkLabel={`${t.title}: done`} onCheck={(done) => tick(t, done)}
                      onDelete={() => remove(t)} canDelete={!t.done}
                      trailing={<span className="chip coin-chip tnum"><Coin size={14} />{num(t.coins)}</span>} />
                  ))}
                </Category>
              );
            })}
          </div>
        </section>
      </div>

      <div className="side stack-lg">
        <div className="glass panel">
          <Donut segments={segments} format={duration} centerLabel="Free time" centerValue={duration(data.free_minutes)} />
          <div className="remaining">
            <span>Total Time Remaining</span>
            <strong className="tnum">{duration(data.remaining_minutes)}</strong>
          </div>
          <p className="hint">Free time you haven't scheduled yet.</p>
        </div>

        <motion.div layout className={`glass panel earned ${data.earned ? 'won' : ''}`}>
          {data.earned > 0 ? (
            <>
              <p className="earned-title">Congratulations!! You Have Earned:</p>
              <p className="earned-coins"><Coin size={34} /><CountUp value={data.earned} /></p>
              {data.possible > data.earned && <p className="hint">{num(data.possible - data.earned)} more waiting in today's unticked tasks.</p>}
            </>
          ) : (
            <>
              <p className="earned-title">{data.possible ? 'Tick off a task to collect its coins' : 'Schedule a task to start earning'}</p>
              <p className="earned-coins dim"><Coin size={34} /><span className="tnum">{num(data.possible)}</span></p>
              <p className="hint">{data.possible ? "Coins waiting in today's plan." : 'Work and skill tasks pay 1.5 coins a minute, sports 1, leisure 0.5.'}</p>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}
