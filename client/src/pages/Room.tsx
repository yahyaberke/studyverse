import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ROOM_THEMES, CHEER_MESSAGES, CHAT_MAX_LENGTH, formatDuration } from '@studyverse/shared';
import { Avatar, ErrorText, StatusDot, api, poseFor, useMe, useSocket } from '../lib';
import { StudyTimer } from './Dashboard';

const DESK_EMOJI: Record<string, string> = { plant: '🪴', mug: '☕', books: '📚', lamp: '💡', cactus: '🌵', cat: '🐈', globe: '🌍', trophy: '🏆' };

export function RoomPage() {
  const { id = '' } = useParams();
  const { data: me } = useMe();
  const { socket, connected } = useSocket();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [focusMode, setFocusMode] = useState(false);
  const [kicked, setKicked] = useState(false);
  const room = useQuery({ queryKey: ['room', id], queryFn: () => api(`/rooms/${id}`), retry: false });
  const isMember = !!room.data?.membership;
  const members = useQuery({ queryKey: ['members', id], queryFn: () => api(`/rooms/${id}/members`), enabled: isMember, refetchInterval: 30_000 });

  // join the live channel; re-join after every reconnect
  useEffect(() => {
    if (!socket || !isMember) return;
    const join = () => socket.emit('room:join', { roomId: id }, () => qc.invalidateQueries({ queryKey: ['members', id] }));
    if (socket.connected) join();
    socket.on('connect', join);
    const refresh = () => qc.invalidateQueries({ queryKey: ['members', id] });
    const onKick = (p: { roomId: string }) => p.roomId === id && setKicked(true);
    const onUpdated = () => qc.invalidateQueries({ queryKey: ['room', id] });
    socket.on('room:presence', refresh);
    socket.on('room:members-changed', refresh);
    socket.on('room:kicked', onKick);
    socket.on('room:updated', onUpdated);
    return () => {
      socket.emit('room:leave');
      socket.off('connect', join);
      socket.off('room:presence', refresh);
      socket.off('room:members-changed', refresh);
      socket.off('room:kicked', onKick);
      socket.off('room:updated', onUpdated);
    };
  }, [socket, id, isMember, qc]);

  if (kicked) return <div className="card mx-auto max-w-md p-6 text-center"><p className="font-bold">Oda sahibi seni odadan çıkardı.</p><Link to="/rooms" className="btn-ghost mt-3">Odalara dön</Link></div>;
  if (room.error) return <div className="card mx-auto max-w-md p-6"><ErrorText error={room.error} /><Link to="/rooms" className="btn-ghost mt-3">Odalara dön</Link></div>;
  if (!room.data) return <p className="text-muted">Oda yükleniyor…</p>;
  const r = room.data.room;
  if (!isMember) return <JoinGate room={r} onJoined={() => qc.invalidateQueries({ queryKey: ['room', id] })} />;

  const theme = ROOM_THEMES.find((t) => t.id === r.theme) ?? ROOM_THEMES[0];
  const list: any[] = members.data?.items ?? [];
  const present = list.filter((m) => m.inRoom);
  const isOwner = room.data.membership.role === 'OWNER';
  const groupSecs = members.data?.groupFocusSeconds ?? 0;
  const leave = async () => {
    await api(`/rooms/${id}/leave`, { method: 'POST' });
    nav('/rooms');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="font-pixel text-3xl">{r.name}</h1>
          <p className="text-sm text-muted">{r.description} {r.category && `· ${r.category}`} · {present.length} kişi odada · {r.memberCount}/{r.maxParticipants} üye</p>
        </div>
        {!connected && <span className="rounded bg-sun/30 px-2 py-1 text-xs font-bold" role="status">Bağlantı koptu, yeniden bağlanıyor…</span>}
        <button className="btn-ghost" onClick={() => setFocusMode(!focusMode)} aria-pressed={focusMode}>{focusMode ? 'Odak modundan çık' : '🎯 Odak modu'}</button>
        <button className="btn-ghost" onClick={leave}>Odadan ayrıl</button>
      </div>

      {/* the shared space: every participant sits at a desk; pose reflects real server-side activity */}
      <section className="relative overflow-hidden rounded-xl2 border border-line" style={{ background: theme.wall }} aria-label="Sanal oda">
        <div className="absolute left-6 top-4 h-20 w-32 rounded-md border-4 border-[#7a5236]" style={{ background: theme.window }} aria-hidden>
          <div className="absolute inset-y-0 left-1/2 w-1 bg-[#7a5236]" /><div className="absolute inset-x-0 top-1/2 h-1 bg-[#7a5236]" />
        </div>
        <div className="absolute right-6 top-4 flex h-24 w-24 flex-col justify-around rounded border-4 border-[#7a5236] bg-[#a8744f] px-1" aria-hidden>
          {[0, 1, 2].map((i) => <div key={i} className="flex h-4 gap-0.5">{['#d97a4a', '#4f9d84', '#e2b04a', '#7fb2e5', '#e48a9c'].map((c) => <span key={c} className="w-3" style={{ background: c }} />)}</div>)}
        </div>
        <div className="relative flex min-h-[260px] flex-wrap items-end justify-center gap-6 px-4 pb-4 pt-28" style={{ background: `linear-gradient(transparent 62%, ${theme.floor} 62%)` }}>
          {present.length === 0 && <p className="self-center text-muted">Odada şu an kimse yok.</p>}
          {present.map((m) => (
            <figure key={m.userId} className="flex flex-col items-center">
              <span className="mb-1 rounded-full bg-card/90 px-2 text-[11px] font-bold shadow">{m.displayName}{m.subject && m.status === 'studying' ? ` · ${m.subject}` : ''}</span>
              <div className="relative">
                <Avatar config={m.avatar} pose={poseFor(m.status)} size={84} label={`${m.displayName}: ${m.status}`} />
                {m.status === 'break' && <span className="absolute -right-3 top-8 text-lg" aria-hidden>☕</span>}
                {m.status === 'idle' && <span className="absolute -right-2 top-0 text-sm text-muted" aria-hidden>z</span>}
              </div>
              <div className="relative -mt-6 h-8 w-24 rounded-t-md border-b-4 border-[#5c3b26] bg-[#8a5a3c] shadow" aria-hidden>
                <span className="absolute -top-4 right-1 text-base">{DESK_EMOJI[m.avatar?.deskItem] ?? '🪴'}</span>
              </div>
              <figcaption className="mt-1"><StatusDot status={m.status} /></figcaption>
            </figure>
          ))}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <StudyTimer roomId={id} />
        {!focusMode && (
          <>
            <section className="card p-5">
              <h2 className="font-pixel text-xl">Oda hedefi</h2>
              <p className="text-sm text-muted">{r.goalText ?? 'Hedef belirlenmemiş.'}</p>
              <p className="mt-2 text-sm">Grup toplamı: <b>{formatDuration(groupSecs)}</b>{r.goalMinutes ? ` / ${formatDuration(r.goalMinutes * 60)}` : ''}</p>
              {r.goalMinutes && (
                <div className="mt-1 h-3 overflow-hidden rounded-full bg-line"><div className="h-full bg-leaf" style={{ width: `${Math.min(100, (groupSecs / (r.goalMinutes * 60)) * 100)}%` }} /></div>
              )}
              <h3 className="mb-1 mt-4 font-bold">Üyeler</h3>
              <ul className="space-y-1.5">
                {list.map((m) => (
                  <li key={m.userId} className="flex items-center gap-2 text-sm">
                    <Avatar config={m.avatar} pose={poseFor(m.status)} size={28} />
                    <span className="flex-1 truncate">{m.displayName} {m.role === 'OWNER' && '👑'}</span>
                    <span className="text-xs text-muted" title="Bu odada bireysel odak süresi">{formatDuration(m.focusSeconds, { short: true })}</span>
                    <StatusDot status={m.status} />
                    {isOwner && m.userId !== me?.id && (
                      <span className="flex gap-1">
                        <button className="text-xs text-muted underline" onClick={() => api(`/rooms/${id}/transfer`, { method: 'POST', body: { userId: m.userId } }).then(() => qc.invalidateQueries({ queryKey: ['room', id] }))}>Sahiplik ver</button>
                        <button className="text-xs text-red-500 underline" onClick={() => api(`/rooms/${id}/kick`, { method: 'POST', body: { userId: m.userId } })}>Çıkar</button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {isOwner && <InviteBox roomId={id} />}
            </section>
            <Chat roomId={id} />
          </>
        )}
      </div>
    </div>
  );
}

function InviteBox({ roomId }: { roomId: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const create = async () => {
    const { code } = await api(`/rooms/${roomId}/invites`, { method: 'POST', body: {} });
    setLink(`${location.origin}/invite/${code}`);
  };
  return (
    <div className="mt-4 rounded-xl bg-bg p-3 text-sm">
      {link ? (
        <div className="flex gap-2">
          <input className="input text-xs" readOnly value={link} aria-label="Davet bağlantısı" onFocus={(e) => e.target.select()} />
          <button className="btn-ghost text-xs" onClick={() => navigator.clipboard.writeText(link).then(() => setCopied(true))}>{copied ? 'Kopyalandı' : 'Kopyala'}</button>
        </div>
      ) : (
        <button className="btn-ghost w-full text-sm" onClick={create}>🔗 Davet bağlantısı oluştur (7 gün)</button>
      )}
    </div>
  );
}

function Chat({ roomId }: { roomId: string }) {
  const { socket } = useSocket();
  const { data: me } = useMe();
  const [msgs, setMsgs] = useState<any[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState<Set<string>>(() => new Set(JSON.parse(localStorage.getItem('sv_muted') ?? '[]')));
  const box = useRef<HTMLDivElement>(null);
  const [params] = useSearchParams();
  const target = params.get('msg');
  const mentionRe = me ? new RegExp(`(^|[^a-z0-9_])@${me.username}(?![a-z0-9_])`, 'i') : null;
  useEffect(() => {
    api(`/rooms/${roomId}/messages`).then((r) => setMsgs(r.items)).catch(() => setError('Mesajlar yüklenemedi.'));
  }, [roomId]);
  useEffect(() => {
    if (!socket) return;
    const on = (m: any) => setMsgs((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev.slice(-199), m]));
    socket.on('chat:message', on);
    return () => void socket.off('chat:message', on);
  }, [socket]);
  // block body: Element.scrollTo returns a Promise in newer Chromium, which must not leak out as an effect cleanup
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [msgs]);
  // deep link from a mention notification: bring that message into view
  useEffect(() => {
    if (!target || !box.current) return;
    const el = box.current.querySelector<HTMLElement>(`#msg-${CSS.escape(target)}`);
    if (el) box.current.scrollTop = el.offsetTop - box.current.offsetTop - 40;
  }, [msgs, target]);
  const send = (body: string, kind: 'TEXT' | 'CHEER' = 'TEXT') => {
    setError(null);
    if (!body.trim()) return;
    socket?.emit('chat:send', { roomId, body, kind }, (r: any) => (r?.ok ? setText('') : setError(r?.error?.message ?? 'Gönderilemedi.')));
  };
  const toggleMute = (uid: string) => {
    const n = new Set(muted);
    if (n.has(uid)) n.delete(uid);
    else n.add(uid);
    setMuted(n);
    try { localStorage.setItem('sv_muted', JSON.stringify([...n])); } catch { /* storage unavailable */ }
  };
  return (
    <section className="card flex h-[420px] flex-col p-4">
      <h2 className="font-pixel text-xl">Sohbet</h2>
      <div ref={box} className="my-2 flex-1 space-y-1.5 overflow-y-auto pr-1 text-sm" aria-live="polite">
        {msgs.filter((m) => !muted.has(m.userId)).map((m) => (
          <div
            key={m.id}
            id={`msg-${m.id}`}
            className={`${m.kind === 'CHEER' ? 'rounded-lg bg-sun/20 px-2 py-1' : ''} ${m.id === target ? 'rounded-lg ring-2 ring-brand' : ''} ${m.userId !== me?.id && mentionRe?.test(m.body) ? 'rounded-lg bg-brand/10 px-2 py-1' : ''}`}
          >
            <b>{m.displayName}</b> <span className="text-[10px] text-muted">{new Date(m.createdAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
            {m.userId !== me?.id && <button className="ml-1 text-[10px] text-muted underline" onClick={() => toggleMute(m.userId)}>sustur</button>}
            {/* rendered as text: React escapes user content */}
            <p className="break-words">{m.body}</p>
          </div>
        ))}
        {msgs.length === 0 && <p className="text-muted">Henüz mesaj yok. Selam ver! 👋</p>}
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {CHEER_MESSAGES.slice(0, 3).map((c) => <button key={c} className="rounded-full bg-bg px-2 py-0.5 text-xs hover:bg-sun/30" onClick={() => send(c, 'CHEER')}>{c}</button>)}
      </div>
      {error && <p className="mb-1 text-xs text-red-500" role="alert">{error}</p>}
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); send(text); }} className="flex gap-2">
        <input className="input" value={text} maxLength={CHAT_MAX_LENGTH} onChange={(e) => setText(e.target.value)} placeholder="Mesaj yaz…" aria-label="Mesaj" />
        <button className="btn-primary">Gönder</button>
      </form>
    </section>
  );
}

function JoinGate({ room, onJoined }: { room: any; onJoined: () => void }) {
  const [pw, setPw] = useState('');
  const [error, setError] = useState<unknown>(null);
  const join = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api(`/rooms/${room.id}/join`, { method: 'POST', body: { password: pw || null } });
      onJoined();
    } catch (err) {
      setError(err);
    }
  };
  return (
    <form onSubmit={join} className="card mx-auto max-w-md space-y-3 p-6">
      <h1 className="font-pixel text-2xl">{room.name}</h1>
      <p className="text-sm text-muted">{room.description}</p>
      <p className="text-sm">{room.memberCount}/{room.maxParticipants} üye</p>
      {room.hasPassword && <input className="input" type="password" placeholder="Oda şifresi" aria-label="Oda şifresi" value={pw} onChange={(e) => setPw(e.target.value)} />}
      <ErrorText error={error} />
      <button className="btn-primary w-full">Odaya katıl</button>
    </form>
  );
}
