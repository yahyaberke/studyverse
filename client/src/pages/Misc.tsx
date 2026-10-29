import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDuration } from '@studyverse/shared';
import { ErrorText, api, useMe } from '../lib';

export function Leaderboard() {
  const [tab, setTab] = useState<'weekly' | 'allTime'>('weekly');
  const { data, error } = useQuery({ queryKey: ['leaderboard'], queryFn: () => api('/leaderboard') });
  const ach = useQuery({ queryKey: ['achievements'], queryFn: () => api('/achievements') });
  const rows: any[] = data?.[tab] ?? [];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card p-5">
        <h1 className="font-pixel text-2xl">Sıralama</h1>
        <div className="my-3 flex gap-2" role="tablist">
          <button role="tab" aria-selected={tab === 'weekly'} className={tab === 'weekly' ? 'btn-primary py-1' : 'btn-ghost py-1'} onClick={() => setTab('weekly')}>Bu hafta</button>
          <button role="tab" aria-selected={tab === 'allTime'} className={tab === 'allTime' ? 'btn-primary py-1' : 'btn-ghost py-1'} onClick={() => setTab('allTime')}>Tüm zamanlar (XP)</button>
        </div>
        <ErrorText error={error} />
        <ol className="space-y-1">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-3 rounded-lg bg-bg px-3 py-2">
              <span className="w-6 font-pixel text-lg">{i + 1}</span>
              <span className="flex-1 font-bold">{r.displayName} <span className="text-xs font-normal text-muted">@{r.username} · Sv {r.level}</span></span>
              <span>{tab === 'weekly' ? formatDuration(r.seconds) : `${r.xp} XP`}</span>
            </li>
          ))}
          {rows.length === 0 && <p className="text-muted">Henüz veri yok.</p>}
        </ol>
      </section>
      <section className="card p-5">
        <h2 className="font-pixel text-2xl">Başarımlar</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {(ach.data?.items ?? []).map((a: any) => (
            <li key={a.key} className={`rounded-xl border border-line p-3 ${a.unlockedAt ? 'bg-sun/15' : 'opacity-60'}`}>
              <p className="font-bold">{a.icon} {a.name}</p>
              <p className="text-xs text-muted">{a.description}</p>
              <p className="text-xs">+{a.xpReward} XP {a.unlockedAt ? '· ✓ Açıldı' : ''}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function SettingsPage() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState(false);
  const s = me?.settings ?? {};
  const update = async (patch: Record<string, unknown>) => {
    setError(null);
    setOk(false);
    // optimistic: toggles reflect the click immediately, rolled back if the save fails
    const prev = qc.getQueryData<any>(['me']);
    if (prev) qc.setQueryData(['me'], { ...prev, settings: { ...prev.settings, ...patch } });
    try {
      const { user } = await api('/me/settings', { method: 'PATCH', body: patch });
      qc.setQueryData(['me'], user);
      setOk(true);
    } catch (e) {
      qc.setQueryData(['me'], prev);
      setError(e);
    }
  };
  const num = (k: string, label: string, min: number, max: number) => (
    <div>
      <label className="label" htmlFor={k}>{label}</label>
      <input id={k} type="number" className="input" min={min} max={max} defaultValue={s[k]} onBlur={(e) => Number(e.target.value) !== s[k] && update({ [k]: Number(e.target.value) })} />
    </div>
  );
  const sel = (k: string, label: string, opts: [string, string][]) => (
    <div>
      <label className="label" htmlFor={k}>{label}</label>
      <select id={k} className="input" value={s[k]} onChange={(e) => update({ [k]: e.target.value })}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </div>
  );
  const chk = (k: string, label: string) => (
    <label className="flex items-center gap-2"><input type="checkbox" checked={!!s[k]} onChange={(e) => update({ [k]: e.target.checked })} /> {label}</label>
  );
  const vis: [string, string][] = [['PUBLIC', 'Herkes'], ['FRIENDS', 'Arkadaşlar'], ['PRIVATE', 'Sadece ben']];
  if (!me) return null;
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="font-pixel text-3xl">Ayarlar</h1>
      <ErrorText error={error} />
      {ok && <p className="text-sm text-leaf" role="status">Kaydedildi ✓</p>}
      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="font-bold sm:col-span-2">Hedefler & Pomodoro</h2>
        {num('dailyGoalMinutes', 'Günlük hedef (dk)', 10, 960)}
        {num('weeklyGoalMinutes', 'Haftalık hedef (dk)', 30, 6000)}
        {num('pomodoroFocusMin', 'Odak süresi (dk)', 5, 180)}
        {num('pomodoroBreakMin', 'Mola süresi (dk)', 1, 60)}
        <div className="flex flex-col gap-2 sm:col-span-2">
          {chk('pomodoroAutoAdvance', 'Faz bitince otomatik geçiş')}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!s.notificationsEnabled} onChange={async (e) => {
              if (e.target.checked && 'Notification' in window && (await Notification.requestPermission()) !== 'granted') return setError(new Error('Bildirim izni verilmedi.'));
              update({ notificationsEnabled: e.target.checked });
            }} /> Tarayıcı bildirimleri
          </label>
        </div>
      </section>
      <section className="card p-5">
        <h2 className="mb-1 font-bold">Bildirim sesleri</h2>
        <p className="mb-3 text-xs text-muted">Tercihler hesabına kaydedilir. Tarayıcılar sesi ancak sayfaya ilk tıklamandan sonra çalmaya izin verir.</p>
        <div className="flex flex-col gap-2">
          {chk('soundEnabled', 'Tüm bildirim sesleri (genel anahtar)')}
          <fieldset disabled={!s.soundEnabled} className={`ml-6 flex flex-col gap-2 ${s.soundEnabled ? '' : 'opacity-50'}`}>
            {chk('soundJoinLeave', 'Odaya giriş / çıkış')}
            {chk('soundStudy', 'Çalışmaya başlama, dönüş ve bitirme')}
            {chk('soundBreak', 'Mola')}
            {chk('soundMention', 'Sohbette etiketlenme')}
            {chk('soundSubject', 'Çalışma konusu değişikliği')}
          </fieldset>
        </div>
      </section>
      <section className="card grid gap-4 p-5 sm:grid-cols-2">
        <h2 className="font-bold sm:col-span-2">Gizlilik & Görünüm</h2>
        {sel('profileVisibility', 'Profil görünürlüğü', vis)}
        {sel('statsVisibility', 'İstatistik görünürlüğü', vis)}
        {sel('theme', 'Tema', [['system', 'Sistem'], ['light', 'Açık'], ['dark', 'Koyu']])}
        <div className="flex flex-col gap-2 sm:col-span-2">{chk('showOnLeaderboard', 'Sıralamada görün')}</div>
      </section>
      <section className="card p-5">
        <h2 className="mb-2 font-bold">Güvenlik</h2>
        <button className="btn-ghost" onClick={async () => { await api('/auth/logout-all', { method: 'POST' }); location.href = '/'; }}>Tüm cihazlardan çıkış yap</button>
      </section>
    </div>
  );
}
