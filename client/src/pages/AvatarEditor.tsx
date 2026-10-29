import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AVATAR_PRESETS, AVATAR_SLOTS, DEFAULT_AVATAR, cosmeticKey, type AvatarConfig, type AvatarPose, type CatalogItem, type Unlock } from '@studyverse/shared';
import { Avatar, ErrorText, api, useMe } from '../lib';

const SLOT_LABELS: Record<keyof AvatarConfig, string> = {
  base: 'Tür', skinTone: 'Ten rengi', hairStyle: 'Saç', hairColor: 'Saç rengi', outfitStyle: 'Kıyafet', outfitColor: 'Kıyafet rengi', accessory: 'Aksesuar', deskItem: 'Masa eşyası',
};

const lockText = (u: Unlock) => (u.kind === 'level' ? `Seviye ${u.level}` : u.kind === 'achievement' ? 'Başarım' : '');

export function AvatarEditor({ onboarding = false }: { onboarding?: boolean }) {
  const { data: me } = useMe();
  const [cfg, setCfg] = useState<AvatarConfig>(() => {
    const a = me?.avatar;
    return a ? (Object.fromEntries(Object.keys(DEFAULT_AVATAR).map((k) => [k, (a as any)[k]])) as AvatarConfig) : DEFAULT_AVATAR;
  });
  const [pose, setPose] = useState<AvatarPose>('idle');
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const owned = new Set(me?.cosmetics ?? []);
  const isOpen = (slot: string, item: CatalogItem) =>
    item.unlock.kind === 'default' || owned.has(cosmeticKey(slot, item.id)) || (item.unlock.kind === 'level' && (me?.level ?? 1) >= item.unlock.level);

  const save = async () => {
    setError(null);
    try {
      const { user } = await api('/me/avatar', { method: 'PUT', body: cfg });
      qc.setQueryData(['me'], user);
      setSaved(true);
      if (onboarding) nav('/app');
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className={onboarding ? 'mx-auto max-w-5xl' : ''}>
      <h1 className="mb-1 font-pixel text-3xl">{onboarding ? 'Karakterini oluştur' : 'Karakter düzenleyici'}</h1>
      <p className="mb-6 text-muted">Odalarda masanda bu karakter oturacak. Seviye atladıkça yeni parçalar açılır.</p>
      <div className="grid gap-6 md:grid-cols-[300px_1fr]">
        <aside className="card sticky top-20 h-fit p-5 text-center">
          <div className="mx-auto grid h-56 place-items-center rounded-xl bg-bg">
            <Avatar config={cfg} pose={pose} size={200} />
          </div>
          <div className="mt-3 flex justify-center gap-1" role="group" aria-label="Önizleme durumu">
            {(['idle', 'studying', 'break', 'offline'] as const).map((p) => (
              <button key={p} className={`rounded-lg px-2 py-1 text-xs font-bold ${pose === p ? 'bg-brand text-white' : 'bg-bg'}`} onClick={() => setPose(p)} aria-pressed={pose === p}>
                {{ idle: 'Boşta', studying: 'Çalışıyor', break: 'Mola', offline: 'Uyuyor' }[p]}
              </button>
            ))}
          </div>
          <p className="mt-3 font-bold">{me?.displayName}</p>
          <ErrorText error={error} />
          {saved && !onboarding && <p className="text-sm text-leaf" role="status">Kaydedildi ✓</p>}
          <button className="btn-primary mt-3 w-full" onClick={save}>{onboarding ? 'Kaydet ve başla' : 'Kaydet'}</button>
        </aside>
        <div className="space-y-5">
          <section className="card p-4">
            <h2 className="mb-2 font-bold">Hazır karakterler</h2>
            <div className="flex flex-wrap gap-2">
              {AVATAR_PRESETS.map((p) => (
                <button key={p.id} className="rounded-xl border border-line bg-bg p-2 hover:border-brand" onClick={() => setCfg(p.config)} aria-label={p.label}>
                  <Avatar config={p.config} size={56} />
                  <span className="block text-xs">{p.label}</span>
                </button>
              ))}
            </div>
          </section>
          {(Object.keys(AVATAR_SLOTS) as (keyof AvatarConfig)[]).map((slot) => (
            <section key={slot} className="card p-4">
              <h2 className="mb-2 font-bold">{SLOT_LABELS[slot]}</h2>
              <div className="flex flex-wrap gap-2">
                {(AVATAR_SLOTS[slot] as readonly (CatalogItem & { base?: string; primary?: string })[]).map((item) => {
                  const open = isOpen(slot, item);
                  const active = cfg[slot] === item.id;
                  const swatch = item.base ?? item.primary;
                  return (
                    <button
                      key={item.id}
                      disabled={!open}
                      onClick={() => setCfg({ ...cfg, [slot]: item.id })}
                      aria-pressed={active}
                      title={open ? item.label : `${item.label} — kilitli (${lockText(item.unlock)})`}
                      className={`flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm font-semibold ${active ? 'border-brand bg-brand/10' : 'border-line bg-bg'} ${open ? 'hover:border-brand' : 'cursor-not-allowed opacity-50'}`}
                    >
                      {swatch && <span className="h-4 w-4 rounded-full border border-black/10" style={{ background: swatch }} aria-hidden />}
                      {item.label}
                      {!open && <span className="text-xs">🔒 {lockText(item.unlock)}</span>}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
