import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Apple, ArrowDownRight, ArrowUpRight, Bitcoin, Droplets, History, Info, Maximize2, Minimize2 } from 'lucide-react';
import { api } from '../api.js';
import { useAction, useLast, useLoad } from '../hooks.js';
import { toast } from '../fx.js';
import { inr, inrShort, niceTime, pct, qty } from '../format.js';
import { CountUp, Modal, NumberBox, PageState, Reveal, Segmented } from '../components/ui.jsx';

const RANGES = ['1D', '5D', '1M', '1Y', 'ALL'].map((r) => ({ value: r, label: r }));

function GoldBars() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 5h7l1.5 5h-10z" /><path d="M3.5 13h7l1.5 5H2z" /><path d="M13.5 13h7l1.5 5H12z" />
    </svg>
  );
}

const ICONS = {
  BTC: <Bitcoin size={24} />, NIFTYMF: <b>MF</b>, CRUDE: <Droplets size={22} />,
  GOLD: <GoldBars />, FD: <b>FD</b>, AAPL: <Apple size={22} />,
};

function tick(range) {
  return (t) => {
    const d = new Date(t);
    if (range === '1D') return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (range === '1Y' || range === 'ALL') return d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };
}

function PriceTip({ active, payload }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="chart-tip">
      <strong className="tnum">{inr(d.p, { paise: true })}</strong>
      <span>{new Date(d.t).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
    </div>
  );
}

function Delta({ value, suffix = '' }) {
  const up = value >= 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return <span className={`delta ${up ? 'good' : 'bad'}`}><Icon size={16} />{pct(value, 2)}{suffix}</span>;
}

function OrderModal({ side: openSide, asset, cash, holding, onClose, onDone }) {
  const side = useLast(openSide);
  const [run, busy] = useAction();
  const [amount, setAmount] = useState(null); // rupees when buying, units when selling
  const [sellAll, setSellAll] = useState(false);

  useEffect(() => { setAmount(null); setSellAll(false); }, [openSide, asset?.code]);
  if (!asset) return null;

  const buying = side === 'buy';
  const held = holding?.qty || 0;
  const limit = buying ? cash : held;
  const fractions = [0.25, 0.5, 1];
  const preview = amount > 0 ? (buying ? amount / asset.price : amount * asset.price) : 0;
  const tooMuch = amount > limit + 1e-9;

  const choose = (f) => {
    setSellAll(!buying && f === 1);
    setAmount(buying ? Math.floor(cash * f) : Number((held * f).toFixed(6)));
  };
  const submit = (e) => {
    e.preventDefault();
    const body = { asset: asset.code, side };
    if (buying) body.amount = amount;
    else if (sellAll) body.all = true;
    else body.qty = amount;
    run(() => api('/trade', { method: 'POST', body }), (result) => {
      const t = result.trade;
      toast(`${buying ? 'Bought' : 'Sold'} ${qty(t.qty)} ${t.unit} of ${t.name} for ${inr(t.amount, { paise: true })}`);
      onDone(result);
    });
  };

  return (
    <Modal open={Boolean(openSide)} onClose={onClose} title={`${buying ? 'Buy' : 'Sell'} ${asset.name}`}>
      <form className="stack" onSubmit={submit}>
        <p className="muted tnum">
          Price now {inr(asset.price, { paise: true })} per {asset.unit}.{' '}
          {buying ? `You have ${inr(cash, { paise: true })} in trading cash.` : `You hold ${qty(held)} ${asset.unit}.`}
        </p>
        <NumberBox label={buying ? 'Amount in rupees' : `Quantity in ${asset.unit}`} value={amount}
          onChange={(v) => { setAmount(v); setSellAll(false); }}
          min={0} max={1e12} step={buying ? 500 : held >= 10 ? 1 : 0.01} prefix={buying ? '₹' : undefined} suffix={buying ? undefined : asset.unit} />
        <div className="chips">
          {fractions.map((f) => (
            <button key={f} type="button" className="chip" onClick={() => choose(f)} disabled={!limit}>
              {f === 1 ? (buying ? 'All my cash' : 'Everything') : `${f * 100}%`}
            </button>
          ))}
        </div>
        <p className={tooMuch ? 'form-error' : 'hint'}>
          {tooMuch
            ? (buying ? "That's more than your trading cash." : "That's more than you hold.")
            : amount > 0
              ? (buying ? `About ${qty(preview)} ${asset.unit}. ` : `About ${inr(preview, { paise: true })}. `) + 'The trade fills at the price at the moment you confirm.'
              : 'Prices here are simulated. No real money moves.'}
        </p>
        <button className={`btn block ${buying ? 'primary' : 'sell'}`} disabled={busy || !(amount > 0) || tooMuch}>
          {buying ? 'Buy now' : 'Sell now'}
        </button>
      </form>
    </Modal>
  );
}

function TradeHistory({ open, onClose }) {
  const { data } = useLoad(() => (open ? api('/trades') : Promise.resolve(null)), [open]);
  return (
    <Modal open={open} onClose={onClose} title="Your trades" wide>
      {!data ? <p className="muted">Loading…</p> : data.trades.length === 0 ? (
        <p className="muted">No trades yet. Your buys and sells will be listed here.</p>
      ) : (
        <ul className="rows scroll">
          {data.trades.map((t) => (
            <li key={t.id}>
              <span className={`badge ${t.side === 'buy' ? 'buy' : 'sellb'}`}>{t.side === 'buy' ? 'Bought' : 'Sold'}</span>
              <div className="rows-main">
                <strong>{t.name}</strong>
                <span className="tnum">{qty(t.qty)} {t.unit} at {inr(t.price, { paise: true })}</span>
              </div>
              <div className="rows-end">
                <strong className="tnum">{inr(t.amount, { paise: true })}</strong>
                <span className="tnum">
                  {t.realised !== null && t.realised !== undefined ? `${t.realised >= 0 ? 'Gain' : 'Loss'} ${inr(Math.abs(t.realised), { paise: true })}, ` : ''}{niceTime(t.ts)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export default function Trading() {
  const [code, setCode] = useState('BTC');
  const [range, setRange] = useState('1D');
  const [side, setSide] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [full, setFull] = useState(false);

  const market = useLoad(() => api('/market'), []);
  const portfolio = useLoad(() => api('/portfolio'), []);
  const history = useLoad(() => api(`/market/${code}/history?range=${range}`), [code, range]);

  // Prices move, so refresh quietly while the tab is in view.
  useEffect(() => {
    const t = setInterval(() => {
      if (!document.hidden) { market.reload(); portfolio.reload(); history.reload(); }
    }, 20000);
    return () => clearInterval(t);
  }, [market.reload, portfolio.reload, history.reload]);

  useEffect(() => {
    if (!full) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setFull(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [full]);

  const fresh = history.data?.code === code && history.data?.range === range;
  const points = history.data?.points;
  const move = useMemo(() => (points?.length ? (points[points.length - 1].p / points[0].p - 1) * 100 : 0), [points]);

  if (!market.data || !portfolio.data || !points) {
    return <PageState error={market.error || portfolio.error || history.error} onRetry={() => { market.reload(); portfolio.reload(); history.reload(); }} />;
  }

  const p = portfolio.data;
  const asset = market.data.assets.find((a) => a.code === code);
  const holding = p.holdings.find((h) => h.code === code);
  const worth = p.value + p.cash;
  const lineColor = move >= 0 ? 'var(--good)' : 'var(--bad)';
  const rangeLabel = { '1D': 'today', '5D': 'in 5 days', '1M': 'this month', '1Y': 'this year', ALL: 'since 2024' }[range];
  const afterTrade = (result) => { portfolio.setData(result.portfolio); setSide(null); };

  return (
    <>
      <div className="trade-top">
        <div className="glass asset-bar" role="radiogroup" aria-label="Asset">
          {market.data.assets.map((a) => (
            <button key={a.code} type="button" role="radio" aria-checked={a.code === code} title={a.name}
              className={`asset ${a.code === code ? 'on' : ''}`} onClick={() => setCode(a.code)}>
              {ICONS[a.code]}
              <span className="sr-only">{a.name}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn soft" onClick={() => setShowHistory(true)}><History size={18} /> History</button>
      </div>

      <div className="cols trade">
        <div className="glass panel stack-lg">
          <h1>Your Investments</h1>
          <div className="duo">
            <div>
              <span className="duo-label">Total Investment</span>
              <strong className="tnum"><CountUp value={p.invested} format={(v) => inr(v, { paise: false })} /></strong>
            </div>
            <div>
              <span className="duo-label">Profit/Loss</span>
              <strong className={`tnum ${p.pl >= 0 ? 'good-text' : 'bad-text'}`}>
                <CountUp value={p.pl} format={(v) => inr(v, { paise: false })} />
              </strong>
              {p.invested > 0 && <Delta value={p.pl_pct} />}
            </div>
          </div>

          <div>
            <div className="meter split" role="img" aria-label={`${inr(p.value)} in the market, ${inr(p.cash)} in cash`}>
              <i style={{ width: `${worth ? (p.value / worth) * 100 : 0}%` }} />
            </div>
            <div className="row meter-legend tnum">
              <span><i className="dot in" />In the market {inr(p.value, { paise: false })}</span>
              <span><i className="dot cash" />Cash {inr(p.cash, { paise: false })}</span>
            </div>
            {p.growth_30d_pct !== null && (
              <p className="hint">The growth rate of what you hold over the previous month: <b className="tnum">{pct(p.growth_30d_pct)}</b></p>
            )}
          </div>

          <section>
            <h2 className="small">Portfolio</h2>
            {p.holdings.length === 0 ? (
              <p className="hint lead">Nothing here yet. Pick an asset above and buy your first slice with your {inr(p.cash, { paise: false })} of practice cash.</p>
            ) : (
              <ul className="rows">
                {p.holdings.map((h) => (
                  <li key={h.code}>
                    <button type="button" className={`holding ${h.code === code ? 'on' : ''}`} onClick={() => setCode(h.code)}>
                      <span className="asset mini">{ICONS[h.code]}</span>
                      <span className="rows-main"><strong>{h.name}</strong><span className="tnum">{qty(h.qty)} {h.unit}</span></span>
                      <span className="rows-end"><strong className="tnum">{inr(h.value, { paise: false })}</strong><Delta value={h.pl_pct} /></span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className={`chart-col ${full ? 'full' : ''}`}>
          <div className="glass panel chart-card">
            <div className="chart-head">
              <div>
                <span className="muted">{asset.name}, {asset.kind.toLowerCase()}, per {asset.unit}</span>
                <p className="big"><CountUp value={asset.price} format={(v) => inr(v, { paise: true })} /></p>
                <Delta value={move} suffix={` ${rangeLabel}`} />
              </div>
              <span className="chip sim" title="Prices are generated by the app for practice. They are not real market prices."><Info size={13} /> Simulated prices</span>
            </div>

            <div className="chart-tools">
              <Segmented name="range" label="Time range" options={RANGES} value={range} onChange={setRange} className="compact" />
              <button type="button" className="icon-btn" onClick={() => setFull((f) => !f)} aria-label={full ? 'Exit full screen' : 'Full screen chart'}>
                {full ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
            </div>

            <div className={`chart ${fresh ? '' : 'stale'}`} role="img" aria-label={`${asset.name} price, ${pct(move, 2)} ${rangeLabel}`}>
              <Reveal id={`${history.data.code}-${history.data.range}`}>
              <ResponsiveContainer width="100%" height={full ? Math.max(260, window.innerHeight - 400) : 250}>
                <AreaChart data={points} syncId="price" margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pricefill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" style={{ stopColor: lineColor, stopOpacity: 0.3 }} />
                      <stop offset="100%" style={{ stopColor: lineColor, stopOpacity: 0 }} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="t" tickFormatter={tick(range)} minTickGap={56} tick={{ fill: 'var(--text-3)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <YAxis orientation="right" width={66} domain={['auto', 'auto']} tickFormatter={inrShort} tick={{ fill: 'var(--text-3)', fontSize: 12 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<PriceTip />} cursor={{ stroke: lineColor, strokeDasharray: '4 4' }} />
                  <Area type="monotone" dataKey="p" stroke={lineColor} strokeWidth={2} fill="url(#pricefill)" dot={false}
                    activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
              </Reveal>
              {asset.code !== 'FD' && (
                <ResponsiveContainer width="100%" height={48}>
                  <BarChart data={points} syncId="price" margin={{ top: 0, right: 66, left: 0, bottom: 0 }}>
                    <XAxis dataKey="t" hide />
                    <Tooltip content={() => null} cursor={{ fill: 'var(--track)' }} />
                    <Bar dataKey="v" fill="var(--track-strong)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              )}
              {asset.code !== 'FD' && <p className="hint vol">Trading activity</p>}
            </div>
          </div>

          <div className="trade-actions">
            <button type="button" className="btn primary big-btn" onClick={() => setSide('buy')}>Buy now</button>
            <button type="button" className="btn soft big-btn" onClick={() => setSide('sell')} disabled={!holding}
              title={holding ? undefined : `You don't hold any ${asset.name} yet`}>Sell now</button>
          </div>
        </div>
      </div>

      <OrderModal side={side} asset={asset} cash={p.cash} holding={holding} onClose={() => setSide(null)} onDone={afterTrade} />
      <TradeHistory open={showHistory} onClose={() => setShowHistory(false)} />
    </>
  );
}
