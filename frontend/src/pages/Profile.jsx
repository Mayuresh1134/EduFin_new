import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Lock, Mail, Pencil, User } from 'lucide-react';
import { api, tokenStore } from '../api.js';
import { useAuth } from '../auth.jsx';
import { toast } from '../fx.js';
import { useLast } from '../hooks.js';
import { Avatar } from '../components/Shell.jsx';
import { Field, Modal, PasswordInput, TextInput } from '../components/ui.jsx';

// Shrink the chosen picture to a 160px square in the browser, so only a tiny image is stored.
function toAvatar(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 160;
      canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 160, 160);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture')); };
    img.src = url;
  });
}

function EditModal({ kind: openKind, onClose }) {
  const kind = useLast(openKind);
  const { user, setUser } = useAuth();
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  useEffect(() => {
    setError('');
    setForm(kind === 'profile' ? { username: user.username, phone: user.phone } : kind === 'email' ? { email: user.email, current_password: '' } : { current_password: '', new_password: '' });
  }, [openKind]); // eslint-disable-line react-hooks/exhaustive-deps

  const titles = { profile: 'Change Personal Profile', email: 'Change Email Address', password: user.has_password ? 'Change Password' : 'Set a Password' };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      if (kind === 'profile') {
        setUser((await api('/profile', { method: 'PUT', body: form })).user);
        toast('Profile saved');
      } else if (kind === 'email') {
        setUser((await api('/profile/email', { method: 'PUT', body: form })).user);
        toast('Email address changed');
      } else {
        const remember = tokenStore.remembered();
        const result = await api('/profile/password', { method: 'PUT', body: { ...form, remember } });
        tokenStore.set(result.token, remember); // other devices are signed out; this one stays in
        setUser(result.user);
        toast('Password changed');
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const currentPassword = user.has_password && (
    <Field label="Current password">{(id) => <PasswordInput id={id} required autoComplete="current-password" value={form.current_password || ''} onChange={set('current_password')} placeholder="Enter your current password" />}</Field>
  );

  return (
    <Modal open={Boolean(openKind)} onClose={onClose} title={titles[kind] || ''}>
      <form className="stack" onSubmit={submit}>
        {kind === 'profile' && (
          <>
            <Field label="Name">{(id) => <TextInput id={id} required minLength={2} maxLength={40} value={form.username || ''} onChange={set('username')} />}</Field>
            <Field label="Phone number">{(id) => <TextInput id={id} type="tel" value={form.phone || ''} onChange={set('phone')} placeholder="Enter your phone number" />}</Field>
          </>
        )}
        {kind === 'email' && (
          <>
            <Field label="New email address">{(id) => <TextInput id={id} type="email" required value={form.email || ''} onChange={set('email')} />}</Field>
            {currentPassword}
          </>
        )}
        {kind === 'password' && (
          <>
            {currentPassword}
            <Field label="New password" hint="At least 8 characters. Other devices will be signed out.">{(id) => <PasswordInput id={id} required minLength={8} autoComplete="new-password" value={form.new_password || ''} onChange={set('new_password')} placeholder="Enter a new password" />}</Field>
          </>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn primary block" disabled={busy}>Save changes</button>
      </form>
    </Modal>
  );
}

export default function Profile() {
  const { user, setUser, logout } = useAuth();
  const [editing, setEditing] = useState(null);
  const fileInput = useRef(null);

  const saveAvatar = async (avatar) => {
    try {
      setUser((await api('/profile', { method: 'PUT', body: { avatar } })).user);
      toast(avatar ? 'Picture updated' : 'Picture removed');
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const pick = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      await saveAvatar(await toAvatar(file));
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const rows = [
    { kind: 'profile', label: 'Change Personal Profile', icon: User },
    { kind: 'email', label: 'Change Email Address', icon: Mail },
    { kind: 'password', label: user.has_password ? 'Change Password' : 'Set a Password', icon: Lock },
  ];

  return (
    <div className="narrow profile">
      <h1 className="center-text">Your Profile</h1>

      <div className="glass panel who">
        <div className="who-pic">
          <Avatar user={user} size={84} />
          <button type="button" className="who-edit" onClick={() => fileInput.current.click()} aria-label="Change profile picture"><Pencil size={14} /></button>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={pick} />
        </div>
        <div className="who-text">
          <strong>{user.username}</strong>
          <span className="tnum">{user.phone || user.email}</span>
          {user.avatar && <button type="button" className="link" onClick={() => saveAvatar(null)}>Remove picture</button>}
        </div>
        <span className="badge plan" title={user.level.next ? `${user.level.next.name} at ${user.level.next.at.toLocaleString('en-IN')} lifetime coins` : 'Top level'}>{user.level.name}</span>
      </div>

      <h2 className="small">Account</h2>
      <div className="stack">
        {rows.map((r) => (
          <button key={r.kind} type="button" className="glass account-row" onClick={() => setEditing(r.kind)}>
            <span className="tip-icon"><r.icon size={20} /></span>
            <span>{r.label}</span>
            <ChevronRight size={20} />
          </button>
        ))}
      </div>

      <button type="button" className="logout" onClick={logout}>Log out</button>
      <EditModal kind={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
