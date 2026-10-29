import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatClock, formatDuration } from '@studyverse/shared';
import { Avatar, ErrorText, api, poseFor, useLiveSeconds, useMe, useSession, type Session } from '../lib';
import { playSound } from '../notify';

/** Study controls. All state changes go to the server; the display is derived from server timestamps. */
export function StudyTimer({ roomId }: { roomId?: string }) {
  const { data: session } = useSession();
  const { data: me } = useMe();
  const live = useLiveSeconds(session);
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [pomodoro, setPomodoro] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [summary, setSummary] = useState<{ focus: number; xp: number; unlocked: string[] } | null>(null);
  const busy = useRef(false);
  const s = me?.settings ?? {};
  const focusLen = (s.pomodoroFocusMin ?? 25) * 60;
  const breakLen = (s.pomodoroBreakMin ?? 5) * 60;

  const act = async (path: string, body?: unknown) => {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      const r = await api<{ session: Session | null; xpAwarded?: number; unlocked?: string[] }>(path, { method: 'POST', body });
      if (path.endsWith('finish')) {
        setSummary({ focus: r.session?.focusSeconds ?? 0, xp: r.xpAwarded ?? 0, unlocked: r.unlocked ?? [] });
        qc.setQueryData(['session'], null);
        qc.invalidateQueries({ queryKey: ['me'] });
      } else qc.setQueryData(['session'], r.session);
      qc.invalidateQueries({ queryKey: ['stats'] });
    } catch (e) {
      setError(e);
      qc.invalidateQueries({ queryKey: ['session'] });
    } finally {
      busy.current = false;
    }
  };

  // Pomodoro phase hint; auto-advance only when the user enabled it in settings
  const phaseLen = session?.current?.kind === 'BREAK' ? breakLen : focusLen;
  const remaining = Math.max(0, phaseLen - live.segment);
  const phaseDone = !!session?.current && remaining === 0;
  const notified = useRef<string | null>(null);
  useEffect(() => {
    if (!phaseDone || !session?.current || notified.current === session.current.startedAt) return;
    notified.current = session.current.startedAt;
    playSound('timer', s);
    if (s.notificationsEnabled && 'Notification' in window && Notification.permission === 'granted')
      new Notification(session.current.kind === 'FOCUS' ? 'Mola zamanı ☕' : 'Odaklanma zamanı 📚');
    if (s.pomodoroAutoAdvance) act(session.current.kind === 'FOCUS' ? '/sessions/current/break' : '/sessions/current/endBreak');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phaseDone, session?.current?.startedAt]);

  const status = session?.status;
  return (
    <div className="card p-5" aria-live="polite">
      <div className="flex items-center justify-between">
        <h2 className="font-pixel text-xl">Çalışma Sayacı</h2>
        {status && (
          <span className={`rounded-full px-3 py-0.5 text-xs font-bold ${status === 'ACTIVE' ? 'bg-leaf/20 text-leaf' : status === 'ON_BREAK' ? 'bg-sun/30' : 'bg-line'}`}>
            {status === 'ACTIVE' ? 'Odaklanıyor' : status === 'ON_BREAK' ? 'Molada' : 'Duraklatıldı'}
          </span>
        )}
      </div>
      {!session ? (
        <div className="mt-4 space-y-3">
          <label className="label" htmlFor="subject">Konu / görev</label>
          <input id="subject" className="input" placeholder="ör. Matematik – türev" value={subject} maxLength={40} onChange={(e) => setSubject(e.target.value)} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={pomodoro} onChange={(e) => setPomodoro(e.target.checked)} /> Pomodoro ({s.pomodoroFocusMin ?? 25}/{s.pomodoroBreakMin ?? 5} dk)
          </label>
          <button className="btn-primary w-full text-lg" onClick={() => act('/sessions/start', { subject: subject || null, roomId: roomId ?? null, pomodoro, requestId: crypto.randomUUID() })}>
            ▶ Çalışmaya başla
          </button>
          {summary && (
            <div className="rounded-xl bg-leaf/10 p-3 text-sm" role="status">
              <b>Oturum tamamlandı!</b> {formatDuration(summary.focus)} odaklandın, +{summary.xp} XP.
              {summary.unlocked.length > 0 && <> Yeni başarım: {summary.unlocked.join(', ')} 🏆</>}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 text-center">
          <SubjectEditor current={session.subject} />
          <p className="font-pixel text-5xl tabular-nums" aria-label="Odak süresi">{formatClock(live.focus, true)}</p>
          <p className="text-sm text-muted">Mola: {formatDuration(live.brk)} · Pomodoro blok: {session.pomodoroBlocks}</p>
          {session.current && (
            <p className={`mt-2 text-sm font-bold ${phaseDone ? 'text-brand' : ''}`}>
              {phaseDone ? (session.current.kind === 'FOCUS' ? 'Mola zamanı geldi ☕' : 'Mola bitti, odaklan 📚') : `${session.current.kind === 'FOCUS' ? 'Odak' : 'Mola'} bitimine ${formatClock(remaining)}`}
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {status === 'ACTIVE' && <button className="btn-ghost" onClick={() => act('/sessions/current/pause')}>⏸ Duraklat</button>}
            {status === 'ACTIVE' && <button className="btn-ghost" onClick={() => act('/sessions/current/break')}>☕ Mola</button>}
            {status === 'PAUSED' && <button className="btn-primary" onClick={() => act('/sessions/current/resume')}>▶ Devam</button>}
            {status === 'ON_BREAK' && <button className="btn-primary" onClick={() => act('/sessions/current/endBreak')}>📚 Molayı bitir</button>}
            <button className="btn-ghost" onClick={() => act('/sessions/current/finish', {})}>✓ Bitir</button>
          </div>
        </div>
      )}
      <div className="mt-3"><ErrorText error={error} /></div>
    </div>
  );
}

/** Inline subject edit for the running session; timing is untouched (server splits the segment). */
function SubjectEditor({ current }: { current: string | null }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(current ?? '');
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const { data: subjects } = useQuery({
    queryKey: ['subjects'],
    queryFn: () => api<{ items: { id: string; name: string }[] }>('/subjects'),
    enabled: editing,
  });
  const open = () => {
    setValue(current ?? '');
    setError(null);
    setEditing(true);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) return setError(new Error('Konu boş olamaz.'));
    if (v.length > 40) return setError(new Error('Konu en fazla 40 karakter olabilir.'));
    if (v === current) return setEditing(false);
    setSaving(true);
    try {
      const r = await api<{ session: Session }>('/sessions/current/subject', { method: 'POST', body: { subject: v } });
      qc.setQueryData(['session'], r.session);
      qc.invalidateQueries({ queryKey: ['subjects'] });
      setEditing(false);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  };
  if (!editing)
    return (
      <p className="flex items-center justify-center gap-1 text-sm text-muted">
        <span>{current ?? 'Konusuz oturum'}</span>
        <button className="rounded px-1 hover:bg-bg hover:text-ink" onClick={open} aria-label="Çalışma konusunu düzenle" title="Konuyu düzenle">✏️</button>
      </p>
    );
  return (
    <form onSubmit={save} className="mx-auto mb-1 max-w-xs space-y-2 text-left">
      <label className="label" htmlFor="edit-subject">Çalışma konusu</label>
      <input id="edit-subject" className="input" list="subject-options" value={value} maxLength={40} autoFocus onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} />
      <datalist id="subject-options">
        {subjects?.items.map((s) => <option key={s.id} value={s.name} />)}
      </datalist>
      <ErrorText error={error} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-ghost py-1 text-sm" onClick={() => setEditing(false)}>İptal</button>
        <button className="btn-primary py-1 text-sm" disabled={saving}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</button>
      </div>
    </form>
  );
}

export function useStats() {
  return useQuery({ queryKey: ['stats'], queryFn: () => api('/stats'), refetchInterval: 60_000 });
}

function WeeklyChart({ data }: { data: { date: string; label: string; seconds: number }[] }) {
  const max = Math.max(3600, ...data.map((d) => d.seconds));
  return (
    <div className="flex h-36 items-end gap-2" role="img" aria-label="Son 7 günün çalışma süreleri">
      {data.map((d) => (
        <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[10px] text-muted">{formatDuration(d.seconds, { short: true })}</span>
          <div className="w-full rounded-t-md bg-brand/80" style={{ height: `${Math.max(2, (d.seconds / max) * 100)}px` }} title={`${d.date}: ${formatDuration(d.seconds)}`} />
          <span className="text-xs font-bold">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Dashboard() {
  const { data: me } = useMe();
  const { data: session } = useSession();
  const { data: stats, error } = useStats();
  const { data: rooms } = useQuery({ queryKey: ['rooms', 'mine'], queryFn: () => api('/rooms/mine') });
  const { data: history } = useQuery({ queryKey: ['history'], queryFn: () => api('/sessions'), enabled: !!stats });
  if (!me) return null;
  const goal = (stats?.dailyGoalMinutes ?? 120) * 60;
  const todayRatio = Math.min(1, (stats?.todaySeconds ?? 0) / goal);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <section className="card flex items-center gap-4 p-5 lg:col-span-3">
        <Avatar config={me.avatar} pose={poseFor(session?.status)} size={96} />
        <div className="flex-1">
          <h1 className="font-pixel text-2xl">Merhaba, {me.displayName}!</h1>
          <p className="text-muted">Seviye {me.level} · {me.xp} XP · 🔥 {stats?.streak ?? 0} günlük seri</p>
          <div className="mt-2 h-2 max-w-sm overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={Math.round(me.progress.ratio * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Seviye ilerlemesi">
            <div className="h-full bg-sun" style={{ width: `${me.progress.ratio * 100}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">Sonraki seviye: {me.progress.needed - me.progress.current} XP</p>
        </div>
      </section>
      <div className="lg:col-span-1"><StudyTimer /></div>
      <section className="card p-5 lg:col-span-2">
        <h2 className="font-pixel text-xl">İstatistikler</h2>
        <ErrorText error={error} />
        {stats && (
          <>
            <div className="my-3">
              <p className="text-sm font-bold">Bugün: {formatDuration(stats.todaySeconds)} / {formatDuration(goal)}</p>
              <div className="mt-1 h-3 overflow-hidden rounded-full bg-line"><div className="h-full bg-leaf" style={{ width: `${todayRatio * 100}%` }} /></div>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Bu hafta', formatDuration(stats.weekSeconds)],
                ['Bu ay', formatDuration(stats.monthSeconds)],
                ['Toplam', formatDuration(stats.totalSeconds)],
                ['Ort. oturum', formatDuration(stats.averageSeconds)],
                ['Oturum sayısı', stats.sessionCount],
                ['En uzun oturum', formatDuration(stats.longestSessionSeconds)],
                ['En iyi gün', formatDuration(stats.bestDaySeconds)],
                ['Seri', `${stats.streak} gün`],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-xl bg-bg p-3">
                  <p className="text-xs text-muted">{k}</p>
                  <p className="font-bold">{v}</p>
                </div>
              ))}
            </div>
            <WeeklyChart data={stats.weekly} />
            {stats.subjects.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm">
                {stats.subjects.slice(0, 5).map((s: any) => (
                  <li key={s.name} className="flex justify-between"><span>{s.name}</span><b>{formatDuration(s.seconds)}</b></li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      <section className="card p-5 lg:col-span-1">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-pixel text-xl">Odalarım</h2>
          <Link to="/rooms/new" className="text-sm font-bold text-brand">+ Yeni</Link>
        </div>
        {rooms?.items?.length ? (
          <ul className="space-y-2">
            {rooms.items.slice(0, 6).map((r: any) => (
              <li key={r.id}>
                <Link to={`/rooms/${r.id}`} className="flex justify-between rounded-xl bg-bg px-3 py-2 hover:ring-2 hover:ring-brand/30">
                  <span className="font-bold">{r.name}</span><span className="text-sm text-muted">{r.onlineCount} çevrimiçi</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Henüz bir odan yok. <Link to="/rooms" className="font-bold text-brand">Odalara göz at</Link></p>
        )}
      </section>
      <section className="card p-5 lg:col-span-2">
        <h2 className="mb-2 font-pixel text-xl">Son oturumlar</h2>
        {history?.items?.length ? (
          <table className="w-full text-sm">
            <thead className="text-left text-muted"><tr><th className="py-1">Tarih</th><th>Konu</th><th>Süre</th><th>Durum</th></tr></thead>
            <tbody>
              {history.items.slice(0, 8).map((h: any) => (
                <tr key={h.id} className="border-t border-line">
                  <td className="py-1.5">{new Date(h.startedAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{h.subject ?? '—'}</td>
                  <td>{formatDuration(h.focusSeconds)}</td>
                  <td>{h.endReason === 'USER' ? 'Tamamlandı' : 'Otomatik bitirildi'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">İlk oturumunu başlat, burada görünecek.</p>
        )}
      </section>
    </div>
  );
}
