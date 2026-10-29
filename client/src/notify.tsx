import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, useMe, useSocket } from './lib';

// ───────── sounds (Web Audio, generated tones: no audio files / licensing) ─────────
export type SoundCategory = 'joinLeave' | 'study' | 'break' | 'mention' | 'subject' | 'timer';

const SETTING_KEY: Record<SoundCategory, string | null> = {
  joinLeave: 'soundJoinLeave',
  study: 'soundStudy',
  break: 'soundBreak',
  mention: 'soundMention',
  subject: 'soundSubject',
  timer: null, // pomodoro phase end: governed by the master switch only
};

// [frequency Hz, start offset s, duration s]
const TONES: Record<SoundCategory, [number, number, number][]> = {
  joinLeave: [[523, 0, 0.12], [659, 0.1, 0.16]],
  study: [[440, 0, 0.12], [587, 0.1, 0.2]],
  break: [[587, 0, 0.14], [440, 0.12, 0.22]],
  mention: [[784, 0, 0.1], [988, 0.09, 0.1], [1175, 0.18, 0.18]],
  subject: [[660, 0, 0.14]],
  timer: [[660, 0, 0.18], [660, 0.25, 0.18]],
};

let ctx: AudioContext | null = null;
let unlocked = false;

/** Browsers block audio until a user gesture; unlock on the first interaction. */
function installUnlock() {
  const unlock = () => {
    try {
      ctx ??= new AudioContext();
      void ctx.resume().then(() => (unlocked = true));
    } catch {
      /* no audio support */
    }
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
}
if (typeof window !== 'undefined') installUnlock();

export function soundAllowed(settings: Record<string, any> | undefined, cat: SoundCategory) {
  if (!settings?.soundEnabled) return false;
  const key = SETTING_KEY[cat];
  return key ? settings[key] !== false : true;
}

/** Plays a soft tone; failures are swallowed so audio can never break the app. */
export function playSound(cat: SoundCategory, settings?: Record<string, any>) {
  if (settings && !soundAllowed(settings, cat)) return;
  try {
    if (!ctx || !unlocked) return;
    const t0 = ctx.currentTime;
    for (const [freq, at, dur] of TONES[cat]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + at);
      gain.gain.linearRampToValueAtTime(0.08, t0 + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + dur + 0.05);
    }
  } catch {
    /* ignore */
  }
}

// ───────── toasts ─────────
interface Toast {
  id: string;
  text: string;
  icon: string;
  emphasis?: boolean;
  onClick?: () => void;
}

const ToastCtx = createContext<{ push: (t: Omit<Toast, 'id'> & { id?: string }) => void }>({ push: () => {} });
export const useToasts = () => useContext(ToastCtx);

interface RoomEvent {
  id: string;
  type: 'join' | 'leave' | 'study_start' | 'break' | 'resume' | 'finish' | 'subject_change';
  roomId: string;
  actorId: string;
  actorName: string;
  subject: string | null;
}

const EVENT_TEXT: Record<RoomEvent['type'], [string, (e: RoomEvent) => string, SoundCategory]> = {
  join: ['👋', (e) => `${e.actorName} odaya katıldı.`, 'joinLeave'],
  leave: ['🚪', (e) => `${e.actorName} odadan ayrıldı.`, 'joinLeave'],
  study_start: ['📚', (e) => `${e.actorName} çalışmaya başladı${e.subject ? ` (${e.subject})` : ''}.`, 'study'],
  break: ['☕', (e) => `${e.actorName} mola veriyor.`, 'break'],
  resume: ['💪', (e) => `${e.actorName} çalışmaya geri döndü.`, 'study'],
  finish: ['✅', (e) => `${e.actorName} çalışma oturumunu tamamladı.`, 'study'],
  subject_change: ['✏️', (e) => `${e.actorName} çalışma konusunu ${e.subject ?? '—'} olarak değiştirdi.`, 'subject'],
};

function browserNotify(settings: Record<string, any> | undefined, text: string) {
  try {
    if (settings?.notificationsEnabled && document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification(text);
  } catch {
    /* ignore */
  }
}

export interface AppNotification {
  id: string;
  type: 'MENTION';
  roomId: string | null;
  messageId: string | null;
  body: string;
  readAt: string | null;
  createdAt: string;
}

export const mentionLink = (n: Pick<AppNotification, 'roomId' | 'messageId'>) => `/rooms/${n.roomId}?msg=${n.messageId}`;

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { socket } = useSocket();
  const { data: me } = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const seen = useRef(new Set<string>());
  const settingsRef = useRef(me?.settings);
  settingsRef.current = me?.settings;

  const push = useCallback((t: Omit<Toast, 'id'> & { id?: string }) => {
    const id = t.id ?? crypto.randomUUID();
    setToasts((prev) => (prev.some((p) => p.id === id) ? prev : [...prev.slice(-3), { ...t, id }]));
    setTimeout(() => setToasts((prev) => prev.filter((p) => p.id !== id)), t.emphasis ? 8000 : 4500);
  }, []);

  useEffect(() => {
    if (!socket || !me) return;
    // dedupe by server-generated id (also guards against duplicate listeners)
    const firstTime = (id: string) => {
      if (seen.current.has(id)) return false;
      seen.current.add(id);
      if (seen.current.size > 500) seen.current = new Set([...seen.current].slice(-250));
      return true;
    };
    const onRoomEvent = (e: RoomEvent) => {
      if (!e?.id || e.actorId === me.id || !firstTime(e.id)) return;
      const [icon, text, cat] = EVENT_TEXT[e.type] ?? [];
      if (!text) return;
      push({ id: e.id, icon, text: text(e) });
      playSound(cat, settingsRef.current);
      browserNotify(settingsRef.current, text(e));
    };
    const onNotification = (n: AppNotification) => {
      if (!n?.id || !firstTime(n.id)) return;
      qc.invalidateQueries({ queryKey: ['notifications'] });
      push({
        id: n.id,
        icon: '🔔',
        text: n.body,
        emphasis: true,
        onClick: () => {
          void api(`/notifications/${n.id}/read`, { method: 'POST' }).then(() => qc.invalidateQueries({ queryKey: ['notifications'] }));
          nav(mentionLink(n));
        },
      });
      playSound('mention', settingsRef.current);
      browserNotify(settingsRef.current, n.body);
    };
    socket.on('room:event', onRoomEvent);
    socket.on('notification:new', onNotification);
    return () => {
      socket.off('room:event', onRoomEvent);
      socket.off('notification:new', onNotification);
    };
  }, [socket, me, push, qc, nav]);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(92vw,340px)] flex-col gap-2" aria-live="polite" role="status">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`card pointer-events-auto flex items-start gap-2 px-3 py-2 text-sm shadow-lg ${t.emphasis ? 'border-brand ring-2 ring-brand/30' : ''}`}
          >
            <span aria-hidden>{t.icon}</span>
            {t.onClick ? (
              <button className="flex-1 text-left font-semibold hover:underline" onClick={t.onClick}>{t.text}</button>
            ) : (
              <span className="flex-1">{t.text}</span>
            )}
            <button className="text-muted hover:text-ink" aria-label="Bildirimi kapat" onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

// ───────── bell + persistent notification list ─────────
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const nav = useNavigate();
  const { socket } = useSocket();
  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api<{ items: AppNotification[]; unread: number }>('/notifications'),
    refetchInterval: 120_000,
  });
  // after a reconnect, refresh the persisted list (missed mentions) without replaying toasts
  useEffect(() => {
    if (!socket) return;
    const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
    socket.on('connect', refresh);
    return () => void socket.off('connect', refresh);
  }, [socket, qc]);
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const unread = data?.unread ?? 0;
  return (
    <div className="relative">
      <button
        className="btn-ghost relative px-2.5 py-1"
        aria-label={`Bildirimler${unread ? `, ${unread} okunmamış` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        🔔
        {unread > 0 && (
          <span className="absolute -right-1.5 -top-1.5 min-w-[1.25rem] rounded-full bg-brand px-1 text-center text-[11px] font-bold leading-5 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute right-0 z-40 mt-2 w-[min(90vw,320px)] p-2 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="font-bold">Bildirimler</span>
            {unread > 0 && (
              <button className="text-xs font-bold text-brand" onClick={() => api('/notifications/read-all', { method: 'POST' }).then(refresh)}>
                Tümünü okundu işaretle
              </button>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto">
            {(data?.items ?? []).map((n) => (
              <li key={n.id}>
                <button
                  className={`w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-bg ${n.readAt ? 'text-muted' : 'font-semibold'}`}
                  onClick={() => {
                    setOpen(false);
                    if (!n.readAt) void api(`/notifications/${n.id}/read`, { method: 'POST' }).then(refresh);
                    if (n.roomId && n.messageId) nav(mentionLink(n));
                  }}
                >
                  {!n.readAt && <span className="mr-1 inline-block h-2 w-2 rounded-full bg-brand" aria-label="okunmamış" />}
                  {n.body}
                  <span className="block text-[11px] font-normal text-muted">{new Date(n.createdAt).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</span>
                </button>
              </li>
            ))}
            {!data?.items?.length && <li className="px-2 py-3 text-sm text-muted">Henüz bildirim yok.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
