import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { AuthProvider, useAuth } from './auth.jsx';
import { CoinFly, PageState, Toaster } from './components/ui.jsx';
import Shell, { Backdrop } from './components/Shell.jsx';
import { Login, Signup } from './pages/Auth.jsx';
import TimeTracker from './pages/TimeTracker.jsx';
import SavingsAssistant from './pages/SavingsAssistant.jsx';
import ExpenseTracker from './pages/ExpenseTracker.jsx';
import InvestmentAssistant from './pages/InvestmentAssistant.jsx';
import Rewards from './pages/Rewards.jsx';
import Balance from './pages/Balance.jsx';
import Profile from './pages/Profile.jsx';

// The two chart-heavy screens load on demand so the first page opens faster.
const Trading = lazy(() => import('./pages/Trading.jsx'));
const GrowthCalculator = lazy(() => import('./pages/GrowthCalculator.jsx'));

function GuestOnly() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  return user ? <Navigate to="/earn/time" replace /> : <Outlet />;
}

// The highlight on every glass surface follows the pointer.
function usePointerGlare() {
  useEffect(() => {
    const move = (e) => {
      const el = e.target.closest?.('.glass');
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    document.addEventListener('pointermove', move, { passive: true });
    return () => document.removeEventListener('pointermove', move);
  }, []);
}

export default function App() {
  usePointerGlare();
  return (
    <MotionConfig reducedMotion="user">
      <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AuthProvider>
          <Backdrop />
          <Suspense fallback={<div className="page"><PageState /></div>}>
            <Routes>
              <Route element={<GuestOnly />}>
                <Route path="/login" element={<Login />} />
                <Route path="/signup" element={<Signup />} />
              </Route>
              <Route element={<Shell />}>
                <Route path="/earn/time" element={<TimeTracker />} />
                <Route path="/earn/savings" element={<SavingsAssistant />} />
                <Route path="/earn/expenses" element={<ExpenseTracker />} />
                <Route path="/grow/assistant" element={<InvestmentAssistant />} />
                <Route path="/grow/trading" element={<Trading />} />
                <Route path="/grow/calculator" element={<GrowthCalculator />} />
                <Route path="/rewards" element={<Rewards />} />
                <Route path="/balance" element={<Balance />} />
                <Route path="/profile" element={<Profile />} />
              </Route>
              <Route path="*" element={<Navigate to="/earn/time" replace />} />
            </Routes>
          </Suspense>
          <Toaster />
          <CoinFly />
        </AuthProvider>
      </BrowserRouter>
    </MotionConfig>
  );
}
