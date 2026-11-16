import { useState } from 'react';
import { motion } from 'motion/react';
import { Copy } from 'lucide-react';
import { api, localDate } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useAction, useLast, useLoad } from '../hooks.js';
import { toast } from '../fx.js';
import { niceTime, num } from '../format.js';
import { CoinStack, Modal, PageState } from '../components/ui.jsx';

async function copy(code) {
  try {
    await navigator.clipboard.writeText(code);
    toast('Code copied');
  } catch {
    toast("Couldn't copy. Select the code and copy it by hand.", 'error');
  }
}

export default function Rewards() {
  const { user } = useAuth();
  const { data, error, reload } = useLoad(() => api('/rewards'), []);
  const [run, busy] = useAction();
  const [choice, setChoice] = useState(null);
  const [voucher, setVoucher] = useState(null);
  const shownChoice = useLast(choice);
  const shownVoucher = useLast(voucher);

  if (!data) return <PageState error={error} onRetry={reload} />;

  const redeem = () =>
    run(() => api(`/rewards/${choice.id}/redeem`, { method: 'POST', body: { date: localDate() } }), (result) => {
      setChoice(null);
      setVoucher(result.redemption);
      reload();
    });

  return (
    <div className="narrow">
      <div className="page-head center">
        <div>
          <h1>Offers And Discounts to Cash Out</h1>
          <p className="muted">Spend the coins you've earned. These are sample offers, so the codes are for demonstration only.</p>
        </div>
      </div>

      <div className="offers">
        {data.rewards.map((r, i) => {
          const short = r.cost - user.coins;
          return (
            <motion.article key={r.id} className="glass offer"
              initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.07, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}>
              <div className="offer-main">
                <h2>{r.title}</h2>
                <div className="meter thin" role="img" aria-label={`${num(Math.min(user.coins, r.cost))} of ${num(r.cost)} coins`}>
                  <i style={{ width: `${Math.min(100, (user.coins / r.cost) * 100)}%` }} />
                </div>
                {short > 0
                  ? <p className="hint tnum">{num(short)} more coins to go</p>
                  : <button type="button" className="btn primary sm" onClick={() => setChoice(r)}>Redeem</button>}
              </div>
              <div className="offer-cost">
                <CoinStack size={30} />
                <span className="tnum">{num(r.cost)}</span>
              </div>
            </motion.article>
          );
        })}
      </div>

      {data.redeemed.length > 0 && (
        <section className="glass panel">
          <h2>Your vouchers</h2>
          <ul className="rows">
            {data.redeemed.map((v) => (
              <li key={v.id}>
                <div className="rows-main"><strong>{v.title}</strong><span>{niceTime(v.ts)}</span></div>
                <code className="code">{v.code}</code>
                <button type="button" className="icon-btn" onClick={() => copy(v.code)} aria-label={`Copy code for ${v.title}`}><Copy size={16} /></button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal open={Boolean(choice)} onClose={() => setChoice(null)} title="Redeem this offer?">
        {shownChoice && (
          <div className="stack">
            <p className="muted">{shownChoice.title} costs {num(shownChoice.cost)} coins. You'll have {num(Math.max(user.coins - shownChoice.cost, 0))} left.</p>
            <div className="btn-pair end">
              <button type="button" className="btn soft" onClick={() => setChoice(null)}>Cancel</button>
              <button type="button" className="btn primary" data-autofocus onClick={redeem} disabled={busy || !choice}>Redeem for {num(shownChoice.cost)} coins</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(voucher)} onClose={() => setVoucher(null)} title="Redeemed">
        {shownVoucher && (
          <div className="stack center-text">
            <p className="muted">{shownVoucher.title}</p>
            <motion.code className="code large" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 18 }}>
              {shownVoucher.code}
            </motion.code>
            <p className="hint">A sample code for demonstration. It's saved under "Your vouchers".</p>
            <button type="button" className="btn primary block" data-autofocus onClick={() => copy(shownVoucher.code)}><Copy size={16} /> Copy code</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
