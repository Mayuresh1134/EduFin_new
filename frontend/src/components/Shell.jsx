import { Suspense } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { Calculator, CandlestickChart, Clock, Compass, Moon, PiggyBank, Receipt, Sun, Ticket, TrendingUp, Wallet } from 'lucide-react';
import { useAuth } from '../auth.jsx';
import { useTheme } from '../hooks.js';
import { num } from '../format.js';
import { Coin, CountUp, PageState, spring } from './ui.jsx';

// The structure from the design: three sections across the top,
// and Earn and Grow each have three tools in the pill on the left.
const SECTIONS = [
  {
    key: 'earn', label: 'Earn', icon: Wallet, to: '/earn/time',
    tabs: [
      { to: '/earn/time', lines: ['Time', 'Tracker'], icon: Clock },
      { to: '/earn/savings', lines: ['Savings', 'Assistant'], icon: PiggyBank },
      { to: '/earn/expenses', lines: ['Expense', 'Tracker'], icon: Receipt },
    ],
  },
  {
    key: 'grow', label: 'Grow', icon: TrendingUp, to: '/grow/assistant',
    tabs: [
      { to: '/grow/assistant', lines: ['Investment', 'Assistant'], icon: Compass },
      { to: '/grow/trading', lines: ['Trading', ''], icon: CandlestickChart },
      { to: '/grow/calculator', lines: ['Growth', 'Calculator'], icon: Calculator },
    ],
  },
  { key: 'rewards', label: 'Reward', icon: Ticket, to: '/rewards' },
];

export function Backdrop() {
  return (
    <div className="backdrop" aria-hidden="true">
      <i className="blob b1" /><i className="blob b2" /><i className="blob b3" /><i className="blob b4" />
    </div>
  );
}

export function Avatar({ user, size = 40 }) {
  const initials = user.username.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
      {user.avatar ? <img src={user.avatar} alt="" /> : initials}
    </span>
  );
}

// Rendered twice: inside the top bar on wide screens, and as a bar along the bottom on phones.
// (It can't simply be moved with CSS: a frosted parent traps position: fixed children.)
function MainNav({ active, place }) {
  return (
    <nav className={`mainnav ${place}`} aria-label="Sections">
      {SECTIONS.map((s) => (
        <NavLink key={s.key} to={s.to} className={`mainnav-link ${active === s.key ? 'on' : ''}`} aria-current={active === s.key ? 'page' : undefined}>
          {active === s.key && <motion.span layoutId={`mainnav-thumb-${place}`} className="mainnav-thumb" transition={spring} />}
          <s.icon size={19} strokeWidth={2.1} />
          <span>{s.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function TopBar({ active }) {
  const { user } = useAuth();
  const [theme, toggleTheme] = useTheme();
  return (
    <header className="topbar glass">
      <Link to="/earn/time" className="wordmark" aria-label="EduFin home">EduFin</Link>

      <MainNav active={active} place="top" />

      <div className="topbar-right">
        <button type="button" className="icon-btn" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}>
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <Link to="/balance" id="coin-pill" className={`coin-pill ${active === 'balance' ? 'on' : ''}`} aria-label={`Balance: ${num(user.coins)} coins`}>
          <span id="coin-target"><Coin size={24} /></span>
          <CountUp value={user.coins} />
        </Link>
        <Link to="/profile" className={`avatar-link ${active === 'profile' ? 'on' : ''}`} aria-label="Profile">
          <Avatar user={user} />
        </Link>
      </div>
    </header>
  );
}

function Rail({ section }) {
  return (
    <nav className="rail glass" aria-label={`${section.label} tools`}>
      {section.tabs.map((t) => (
        <NavLink key={t.to} to={t.to} className="rail-link">
          {({ isActive }) => (
            <>
              {isActive && <motion.span layoutId="rail-thumb" className="rail-thumb" transition={spring} />}
              <t.icon size={20} strokeWidth={1.9} />
              <span className="rail-text">{t.lines[0]}{t.lines[1] && <><br />{t.lines[1]}</>}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export default function Shell() {
  const { user, ready } = useAuth();
  const { pathname } = useLocation();

  if (!ready) return <div className="splash"><Coin size={56} className="spin" /></div>;
  if (!user) return <Navigate to="/login" replace />;

  const active = pathname.split('/')[1];
  const section = SECTIONS.find((s) => s.key === active);

  return (
    <div className="app">
      <TopBar active={active} />
      <MainNav active={active} place="bottom" />
      <div className={`stage ${section?.tabs ? 'has-rail' : ''}`}>
        {section?.tabs && <Rail section={section} />}
        <motion.main
          key={pathname}
          className="page"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        >
          <Suspense fallback={<PageState />}>
            <Outlet />
          </Suspense>
        </motion.main>
      </div>
    </div>
  );
}
