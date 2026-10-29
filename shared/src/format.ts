/** "2 saat 35 dakika", "45 dakika", "30 saniye" */
export function formatDuration(totalSeconds: number, opts: { short?: boolean } = {}): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (opts.short) {
    if (h > 0) return m > 0 ? `${h}s ${m}dk` : `${h}s`;
    if (m > 0) return `${m}dk`;
    return s > 0 ? `${s}sn` : '0dk';
  }
  if (h > 0) return m > 0 ? `${h} saat ${m} dakika` : `${h} saat`;
  if (m > 0) return `${m} dakika`;
  return s > 0 ? `${s} saniye` : '0 dakika';
}

/** 01:02:03 or 02:03 */
export function formatClock(totalSeconds: number, alwaysHours = false): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 || alwaysHours ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
