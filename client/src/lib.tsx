import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { composeAvatar, AVATAR_W, AVATAR_H, type AvatarConfig, type AvatarPose } from '@studyverse/shared';

export const APP_NAME = import.meta.env.VITE_APP_NAME || 'StudyVerse';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;
async function refresh() {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', headers: { 'X-Requested-With': 'studyverse' } })
    .then((r) => r.ok)
    .finally(() => setTimeout(() => (refreshing = null), 0));
  return refreshing;
}

/** fetch wrapper: JSON, CSRF header, transparent access-token refresh on 401. */
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'studyverse' },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Sunucuya ulaşılamıyor. Bağlantını kontrol et.');
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/login') && !path.startsWith('/auth/refresh')) {
    if (await refresh()) return api<T>(path, opts, false);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Bir hata oluştu.');
  return data as T;
}

// ───────── auth context ─────────
export interface Me {
  id: string;
  username: string;
  displayName: string;
  xp: number;
  level: number;
  avatar: (AvatarConfig & { userId: string }) | null;
  settings: Record<string, any>;
  cosmetics: string[];
  progress: { level: number; current: number; needed: number; ratio: number };
}

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: () => api<{ user: Me }>('/auth/me').then((r) => r.user).catch((e) => (e.status === 401 ? null : Promise.reject(e))),
    staleTime: 30_000,
  });
}

// ───────── socket ─────────
const SocketCtx = createContext<{ socket: Socket | null; connected: boolean }>({ socket: null, connected: false });

export function SocketProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const s = io({ withCredentials: true, reconnectionDelayMax: 5000 });
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('connect_error', async (err) => {
      setConnected(false);
      if (err.message === 'TOKEN_EXPIRED' && (await refresh())) s.connect();
    });
    s.on('session:update', () => {
      qc.invalidateQueries({ queryKey: ['session'] });
      qc.invalidateQueries({ queryKey: ['stats'] });
    });
    const hb = setInterval(() => s.connected && s.emit('heartbeat'), 25_000);
    setSocket(s);
    return () => {
      clearInterval(hb);
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
    };
  }, [userId, qc]);
  const value = useMemo(() => ({ socket, connected }), [socket, connected]);
  return <SocketCtx.Provider value={value}>{children}</SocketCtx.Provider>;
}
export const useSocket = () => useContext(SocketCtx);

// ───────── study session ─────────
export interface Session {
  id: string;
  status: 'ACTIVE' | 'ON_BREAK' | 'PAUSED' | 'COMPLETED';
  subject: string | null;
  focusSeconds: number;
  breakSeconds: number;
  /** unrounded totals at serverNow */
  focusMs?: number;
  breakMs?: number;
  current: { kind: 'FOCUS' | 'BREAK'; startedAt: string } | null;
  serverNow: string;
  pomodoroBlocks: number;
}

export function useSession() {
  return useQuery({ queryKey: ['session'], queryFn: () => api<{ session: Session | null }>('/sessions/current').then((r) => r.session) });
}

/**
 * Live elapsed time computed from server values: the client only extrapolates the open segment
 * using the server clock offset, so changing the device clock does not change totals.
 *
 * serverNow - receiveTime underestimates the true clock offset by the response latency, so the
 * largest sample is the best estimate. Keeping it stable stops the timer from jumping back when a
 * slower response arrives (e.g. after a subject change). A big jump (device clock changed) resets it.
 */
let clockOffset: number | null = null;
function observeServerTime(serverNow: string) {
  const sample = new Date(serverNow).getTime() - Date.now();
  if (clockOffset === null || sample > clockOffset || clockOffset - sample > 5000) clockOffset = sample;
  return clockOffset;
}

export function useLiveSeconds(s: Session | null | undefined) {
  const [, tick] = useState(0);
  const [offset, setOffset] = useState(() => clockOffset ?? 0);
  useEffect(() => {
    if (s) setOffset(observeServerTime(s.serverNow));
  }, [s]);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  if (!s) return { focus: 0, brk: 0, segment: 0 };
  const now = Date.now() + offset;
  const serverNow = new Date(s.serverNow).getTime();
  const extra = s.current ? Math.max(0, (now - serverNow) / 1000) : 0;
  const segment = s.current ? Math.max(0, (now - new Date(s.current.startedAt).getTime()) / 1000) : 0;
  const focusBase = s.focusMs !== undefined ? s.focusMs / 1000 : s.focusSeconds;
  const breakBase = s.breakMs !== undefined ? s.breakMs / 1000 : s.breakSeconds;
  return {
    focus: focusBase + (s.current?.kind === 'FOCUS' ? extra : 0),
    brk: breakBase + (s.current?.kind === 'BREAK' ? extra : 0),
    segment,
  };
}

export const poseFor = (status?: string | null): AvatarPose =>
  status === 'studying' || status === 'ACTIVE' ? 'studying' : status === 'break' || status === 'ON_BREAK' ? 'break' : status === 'offline' ? 'offline' : 'idle';

// ───────── avatar ─────────
export function Avatar({ config, pose = 'idle', size = 96, label }: { config?: Partial<AvatarConfig> | null; pose?: AvatarPose; size?: number; label?: string }) {
  const pixels = useMemo(() => composeAvatar(config ?? {}, pose), [config, pose]);
  return (
    <svg
      role="img"
      aria-label={label ?? 'Karakter'}
      viewBox={`0 0 ${AVATAR_W} ${AVATAR_H}`}
      width={(size * AVATAR_W) / AVATAR_H}
      height={size}
      className={`pixel anim-${pose === 'offline' ? 'none' : pose}`}
      style={{ filter: pose === 'offline' ? 'grayscale(0.8) opacity(0.6)' : undefined }}
      shapeRendering="crispEdges"
    >
      {pixels.map((p) => (
        <rect key={`${p.x}-${p.y}`} x={p.x} y={p.y} width={1.02} height={1.02} fill={p.c} />
      ))}
    </svg>
  );
}

export function StatusDot({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    studying: ['bg-leaf', 'Çalışıyor'],
    break: ['bg-sun', 'Molada'],
    idle: ['bg-sky-400', 'Boşta'],
    offline: ['bg-gray-400', 'Çevrimdışı'],
  };
  const [cls, label] = map[status] ?? map.offline;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <span className={`h-2 w-2 rounded-full ${cls}`} aria-hidden /> {label}
    </span>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-300">
      {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
