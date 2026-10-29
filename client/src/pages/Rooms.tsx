import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ROOM_CATEGORIES } from '@studyverse/shared';
import { ErrorText, api } from '../lib';

export function RoomCard({ r, onJoin }: { r: any; onJoin?: () => void }) {
  return (
    <article className="card flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-bold">{r.name}</h3>
        <span className="whitespace-nowrap text-xs text-muted">{r.hasPassword ? '🔒 ' : ''}{r.memberCount}/{r.maxParticipants}</span>
      </div>
      {r.category && <span className="mt-1 w-fit rounded bg-bg px-2 text-xs">{r.category}</span>}
      <p className="mt-2 line-clamp-2 flex-1 text-sm text-muted">{r.description || 'Açıklama yok.'}</p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-xs"><span className="mr-1 inline-block h-2 w-2 rounded-full bg-leaf" />{r.onlineCount} çevrimiçi</span>
        {onJoin && <button className="btn-primary py-1 text-sm" onClick={onJoin}>Katıl</button>}
      </div>
    </article>
  );
}

export function RoomsPage() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [joining, setJoining] = useState<any>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const nav = useNavigate();
  const { data, isLoading, error: loadErr } = useQuery({
    queryKey: ['rooms', q, category],
    queryFn: () => api(`/rooms?${new URLSearchParams({ ...(q ? { q } : {}), ...(category ? { category } : {}) })}`),
  });

  const join = async (r: any, pw?: string) => {
    setError(null);
    try {
      await api(`/rooms/${r.id}/join`, { method: 'POST', body: { password: pw || null } });
      nav(`/rooms/${r.id}`);
    } catch (e: any) {
      if (e.code === 'PASSWORD_REQUIRED') setJoining(r);
      else setError(e);
    }
  };
  const joinCode = async (e: FormEvent) => {
    e.preventDefault();
    const c = code.trim().split('/').pop()!;
    if (c) nav(`/invite/${c}`);
  };

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-pixel text-3xl">Çalışma Odaları</h1>
          <p className="text-muted">Herkese açık bir odaya katıl ya da kendi odanı kur.</p>
        </div>
        <Link to="/rooms/new" className="btn-primary">+ Oda oluştur</Link>
      </div>
      <div className="card mb-5 flex flex-wrap gap-3 p-3">
        <input className="input max-w-xs" placeholder="Oda ara…" aria-label="Oda ara" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input max-w-[200px]" aria-label="Kategori" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Tüm kategoriler</option>
          {ROOM_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </select>
        <form onSubmit={joinCode} className="ml-auto flex gap-2">
          <input className="input" placeholder="Davet kodu / bağlantısı" aria-label="Davet kodu" value={code} onChange={(e) => setCode(e.target.value)} />
          <button className="btn-ghost">Git</button>
        </form>
      </div>
      <ErrorText error={error || loadErr} />
      {isLoading ? (
        <p className="text-muted">Yükleniyor…</p>
      ) : data?.items?.length ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((r: any) => <RoomCard key={r.id} r={r} onJoin={() => join(r)} />)}
        </div>
      ) : (
        <div className="card p-10 text-center text-muted">Henüz oda yok. İlk odayı sen kur! 🏠</div>
      )}
      {joining && (
        <div className="fixed inset-0 z-30 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal aria-labelledby="pw-title">
          <form className="card w-full max-w-sm space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); join(joining, password); }}>
            <h2 id="pw-title" className="font-bold">“{joining.name}” şifreli</h2>
            <input className="input" type="password" autoFocus placeholder="Oda şifresi" aria-label="Oda şifresi" value={password} onChange={(e) => setPassword(e.target.value)} />
            <ErrorText error={error} />
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-ghost" onClick={() => { setJoining(null); setError(null); }}>Vazgeç</button>
              <button className="btn-primary">Katıl</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function CreateRoom() {
  const nav = useNavigate();
  const [f, setF] = useState({ name: '', description: '', visibility: 'PUBLIC', password: '', maxParticipants: 12, category: 'Genel', goalText: '', goalHours: '' });
  const [error, setError] = useState<unknown>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (f.name.trim().length < 3) return setError(new Error('Oda adı en az 3 karakter.'));
    try {
      const { room } = await api('/rooms', {
        method: 'POST',
        body: {
          name: f.name, description: f.description, visibility: f.visibility, password: f.password || null, maxParticipants: Number(f.maxParticipants),
          category: f.category, goalText: f.goalText || null, goalMinutes: f.goalHours ? Math.round(Number(f.goalHours) * 60) : null,
        },
      });
      nav(`/rooms/${room.id}`);
    } catch (err) {
      setError(err);
    }
  };
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={submit} className="card mx-auto max-w-xl space-y-4 p-6">
      <h1 className="font-pixel text-2xl">Yeni oda</h1>
      <div><label className="label" htmlFor="rn">Oda adı</label><input id="rn" className="input" value={f.name} onChange={set('name')} maxLength={50} required /></div>
      <div><label className="label" htmlFor="rd">Açıklama</label><textarea id="rd" className="input" rows={2} value={f.description} onChange={set('description')} maxLength={300} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="label" htmlFor="rv">Görünürlük</label>
          <select id="rv" className="input" value={f.visibility} onChange={set('visibility')}><option value="PUBLIC">Herkese açık</option><option value="PRIVATE">Özel (davetle)</option></select></div>
        <div><label className="label" htmlFor="rp">Şifre (isteğe bağlı)</label><input id="rp" type="password" className="input" value={f.password} onChange={set('password')} minLength={4} /></div>
        <div><label className="label" htmlFor="rm">Maks. katılımcı</label><input id="rm" type="number" min={2} max={50} className="input" value={f.maxParticipants} onChange={set('maxParticipants')} /></div>
        <div><label className="label" htmlFor="rc">Kategori</label>
          <select id="rc" className="input" value={f.category} onChange={set('category')}>{ROOM_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></div>
        <div><label className="label" htmlFor="rg">Oda hedefi</label><input id="rg" className="input" placeholder="ör. Finallere hazırlık" value={f.goalText} onChange={set('goalText')} maxLength={120} /></div>
        <div><label className="label" htmlFor="rh">Hedef süre (saat)</label><input id="rh" type="number" min={1} className="input" value={f.goalHours} onChange={set('goalHours')} /></div>
      </div>
      <ErrorText error={error} />
      <button className="btn-primary w-full">Odayı oluştur</button>
    </form>
  );
}

export function InvitePage() {
  const { code = '' } = useParams();
  const nav = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const { data, error: loadErr } = useQuery({ queryKey: ['invite', code], queryFn: () => api(`/invites/${code}`), retry: false });
  const join = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const { roomId } = await api('/rooms/join-by-code', { method: 'POST', body: { inviteCode: code, password: password || null } });
      nav(`/rooms/${roomId}`);
    } catch (err) {
      setError(err);
    }
  };
  if (loadErr) return <div className="card mx-auto max-w-md p-6"><ErrorText error={loadErr} /><Link to="/rooms" className="btn-ghost mt-3">Odalara dön</Link></div>;
  if (!data) return <p className="text-muted">Yükleniyor…</p>;
  return (
    <form onSubmit={join} className="card mx-auto max-w-md space-y-3 p-6">
      <p className="text-sm text-muted">Bir odaya davet edildin</p>
      <h1 className="font-pixel text-2xl">{data.room.name}</h1>
      <p className="text-sm">{data.room.description}</p>
      {data.room.hasPassword && <input className="input" type="password" placeholder="Oda şifresi" aria-label="Oda şifresi" value={password} onChange={(e) => setPassword(e.target.value)} />}
      <ErrorText error={error} />
      <button className="btn-primary w-full">Odaya katıl</button>
    </form>
  );
}
