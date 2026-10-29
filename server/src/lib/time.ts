import { DateTime } from 'luxon';

export interface Interval {
  start: Date;
  end: Date;
}

/** Seconds of overlap between [aStart,aEnd) and [bStart,bEnd). */
export function overlapSeconds(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const s = Math.max(aStart.getTime(), bStart.getTime());
  const e = Math.min(aEnd.getTime(), bEnd.getTime());
  return e > s ? Math.floor((e - s) / 1000) : 0;
}

export function isValidTimeZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

/** Start of the local day containing `at`, in the given zone, as a JS Date. */
export function startOfLocalDay(at: Date, tz: string): Date {
  return DateTime.fromJSDate(at, { zone: tz }).startOf('day').toJSDate();
}

/** Local day key (YYYY-MM-DD). */
export function localDayKey(at: Date, tz: string): string {
  return DateTime.fromJSDate(at, { zone: tz }).toISODate()!;
}

/**
 * Splits intervals at local-midnight boundaries (DST safe) and sums seconds per local day.
 */
export function secondsByLocalDay(intervals: Interval[], tz: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const { start, end } of intervals) {
    let cursor = DateTime.fromJSDate(start, { zone: tz });
    const stop = DateTime.fromJSDate(end, { zone: tz });
    while (cursor < stop) {
      const nextMidnight = cursor.startOf('day').plus({ days: 1 });
      const chunkEnd = nextMidnight < stop ? nextMidnight : stop;
      const secs = Math.floor(chunkEnd.diff(cursor, 'seconds').seconds);
      const key = cursor.toISODate()!;
      out.set(key, (out.get(key) ?? 0) + secs);
      cursor = chunkEnd;
    }
  }
  return out;
}
