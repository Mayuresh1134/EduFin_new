import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { toast } from '../fx.js';
import { Check, Coin, Field, Modal, PasswordInput, TextInput } from '../components/ui.jsx';

const rise = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.16, 1, 0.3, 1] } },
};

function AuthCard({ title, children }) {
  return (
    <div className="auth">
      <motion.div
        className="glass auth-card"
        initial="hidden" animate="show"
        variants={{ hidden: { opacity: 0, scale: 0.96, y: 20 }, show: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1], staggerChildren: 0.06, delayChildren: 0.1 } } }}
      >
        <motion.div variants={rise} className="auth-brand">
          <Coin size={34} />
          <span className="wordmark">EduFin</span>
        </motion.div>
        <motion.h1 variants={rise}>{title}</motion.h1>
        {children}
      </motion.div>
    </div>
  );
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
    return undefined;
  });
}

function GoogleButton({ label }) {
  const { startSession } = useAuth();
  const [clientId, setClientId] = useState(null);

  useEffect(() => {
    api('/config').then((c) => setClientId(c.google_client_id)).catch(() => {});
  }, []);

  const click = async () => {
    if (!clientId) {
      toast("Google sign-in isn't set up on this server yet. Add GOOGLE_CLIENT_ID to backend/.env to turn it on.", 'error');
      return;
    }
    try {
      await loadScript('https://accounts.google.com/gsi/client');
      window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'openid email profile',
        callback: async (reply) => {
          if (!reply.access_token) return;
          try {
            startSession(await api('/auth/google', { method: 'POST', body: { access_token: reply.access_token } }), true);
          } catch (e) {
            toast(e.message, 'error');
          }
        },
      }).requestAccessToken();
    } catch {
      toast("Couldn't load Google sign-in. Check your connection.", 'error');
    }
  };

  return (
    <button type="button" className="btn google block" onClick={click}>
      <span className="g-mark" aria-hidden="true">G</span>
      {label}
    </button>
  );
}

function ForgotPassword({ open, onClose, startEmail }) {
  const [step, setStep] = useState('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setStep('email'); setEmail(startEmail || ''); setCode(''); setPassword(''); setError('');
    }
  }, [open, startEmail]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (step === 'email') {
        await api('/auth/forgot', { method: 'POST', body: { email } });
        setStep('code');
      } else {
        await api('/auth/reset', { method: 'POST', body: { email, code, password } });
        toast('Password changed. Log in with your new password.');
        onClose();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Reset your password">
      <form className="stack" onSubmit={submit}>
        {step === 'email' ? (
          <>
            <p className="muted">Enter the email you signed up with and we'll send a 6-digit code.</p>
            <Field label="Email">{(id) => <TextInput id={id} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@gmail.com" />}</Field>
          </>
        ) : (
          <>
            <p className="muted">
              If <strong>{email}</strong> has an account, a code is on its way. It works for 15 minutes.
            </p>
            <p className="hint">No email service is connected yet, so the code is printed in the backend terminal.</p>
            <Field label="6-digit code">{(id) => <TextInput id={id} required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />}</Field>
            <Field label="New password" hint="At least 8 characters">{(id) => <PasswordInput id={id} required minLength={8} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter a new password" />}</Field>
          </>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy}>{step === 'email' ? 'Send code' : 'Change password'}</button>
      </form>
    </Modal>
  );
}

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await login(email, password, remember);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Login">
      <motion.form variants={rise} className="stack" onSubmit={submit}>
        <Field label="Email">{(id) => <TextInput id={id} type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="example@gmail.com" />}</Field>
        <Field label="Password">{(id) => <PasswordInput id={id} required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" />}</Field>
        <div className="row">
          <label className="remember"><Check checked={remember} onChange={setRemember} label="Remember me" /> Remember me</label>
          <button type="button" className="link warn" onClick={() => setForgot(true)}>Forgot password?</button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Logging in…' : 'Login'}</button>
      </motion.form>
      <motion.div variants={rise} className="or"><span>Or with</span></motion.div>
      <motion.div variants={rise}><GoogleButton label="Login with Google" /></motion.div>
      <motion.p variants={rise} className="switch">Don't have an account? <Link to="/signup">Sign up</Link></motion.p>
      <ForgotPassword open={forgot} onClose={() => setForgot(false)} startEmail={email} />
    </AuthCard>
  );
}

export function Signup() {
  const { signup } = useAuth();
  const [form, setForm] = useState({ username: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await signup(form);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <AuthCard title="Create an account">
      <motion.form variants={rise} className="stack" onSubmit={submit}>
        <Field label="Username">{(id) => <TextInput id={id} required minLength={2} maxLength={40} autoComplete="name" value={form.username} onChange={set('username')} placeholder="Enter your username" />}</Field>
        <Field label="Email">{(id) => <TextInput id={id} type="email" required autoComplete="email" value={form.email} onChange={set('email')} placeholder="Enter your email" />}</Field>
        <Field label="Phone number (optional)">{(id) => <TextInput id={id} type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} placeholder="Enter your phone number" />}</Field>
        <Field label="Password" hint="At least 8 characters">{(id) => <PasswordInput id={id} required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} placeholder="Enter your password" />}</Field>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Creating your account…' : 'Sign up'}</button>
      </motion.form>
      <motion.div variants={rise} className="or"><span>Or with</span></motion.div>
      <motion.div variants={rise}><GoogleButton label="Sign up with Google" /></motion.div>
      <motion.p variants={rise} className="switch">Already have an account? <Link to="/login">Login</Link></motion.p>
    </AuthCard>
  );
}
