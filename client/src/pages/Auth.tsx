import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AVATAR_PRESETS } from '@studyverse/shared';
import { APP_NAME, Avatar, ErrorText, api } from '../lib';

export function Landing() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <header className="mb-12 flex items-center justify-between">
        <span className="font-pixel text-2xl text-brand">{APP_NAME}</span>
        <Link to="/login" className="btn-ghost">Giriş yap</Link>
      </header>
      <section className="grid items-center gap-10 md:grid-cols-2">
        <div>
          <h1 className="font-pixel text-4xl leading-tight md:text-5xl">Birlikte çalış, birlikte büyü.</h1>
          <p className="mt-4 text-lg text-muted">
            Sıcacık piksel odalarda arkadaşlarınla ders çalış. Karakterin masasında, sayaç sunucuda — her dakikan gerçekten senin.
          </p>
          <div className="mt-6 flex gap-3">
            <Link to="/register" className="btn-primary text-lg">Hemen başla</Link>
            <Link to="/login" className="btn-ghost text-lg">Hesabım var</Link>
          </div>
        </div>
        <div className="card flex flex-wrap justify-center gap-4 p-6" aria-hidden>
          {AVATAR_PRESETS.map((p, i) => (
            <Avatar key={p.id} config={p.config} pose={i % 3 === 0 ? 'studying' : i % 3 === 1 ? 'idle' : 'break'} size={110} />
          ))}
        </div>
      </section>
    </div>
  );
}

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const [form, setForm] = useState({ identifier: '', username: '', email: '', password: '', displayName: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (mode === 'register' && form.password.length < 8) return setError(new Error('Şifre en az 8 karakter olmalı.'));
    setBusy(true);
    try {
      const body =
        mode === 'login'
          ? { identifier: form.identifier, password: form.password }
          : { username: form.username, email: form.email, password: form.password, displayName: form.displayName || undefined };
      const { user } = await api(`/auth/${mode}`, { method: 'POST', body });
      qc.setQueryData(['me'], user);
      const next = params.get('next');
      nav(!user.avatar ? '/onboarding' : next && next.startsWith('/') ? next : '/app');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-4 p-6" noValidate>
        <Link to="/" className="font-pixel text-xl text-brand">{APP_NAME}</Link>
        <h1 className="font-pixel text-2xl">{mode === 'login' ? 'Tekrar hoş geldin' : 'Hesap oluştur'}</h1>
        {mode === 'login' ? (
          <div>
            <label className="label" htmlFor="identifier">Kullanıcı adı veya e-posta</label>
            <input id="identifier" className="input" value={form.identifier} onChange={set('identifier')} autoComplete="username" required />
          </div>
        ) : (
          <>
            <div>
              <label className="label" htmlFor="username">Kullanıcı adı</label>
              <input id="username" className="input" value={form.username} onChange={set('username')} pattern="[a-zA-Z0-9_]{3,20}" autoComplete="username" required />
              <p className="mt-1 text-xs text-muted">3-20 karakter: harf, rakam, _</p>
            </div>
            <div>
              <label className="label" htmlFor="displayName">Görünen ad (isteğe bağlı)</label>
              <input id="displayName" className="input" value={form.displayName} onChange={set('displayName')} maxLength={30} />
            </div>
            <div>
              <label className="label" htmlFor="email">E-posta</label>
              <input id="email" type="email" className="input" value={form.email} onChange={set('email')} autoComplete="email" required />
            </div>
          </>
        )}
        <div>
          <label className="label" htmlFor="password">Şifre</label>
          <input id="password" type="password" className="input" value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
          {mode === 'register' && <p className="mt-1 text-xs text-muted">En az 8 karakter, harf ve rakam içermeli.</p>}
        </div>
        <ErrorText error={error} />
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Bekle…' : mode === 'login' ? 'Giriş yap' : 'Kayıt ol'}</button>
        <p className="text-center text-sm text-muted">
          {mode === 'login' ? <>Hesabın yok mu? <Link className="font-bold text-brand" to="/register">Kayıt ol</Link></> : <>Zaten üye misin? <Link className="font-bold text-brand" to="/login">Giriş yap</Link></>}
        </p>
      </form>
    </div>
  );
}
