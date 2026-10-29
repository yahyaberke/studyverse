import { DateTime } from 'luxon';
import { XP_RULES } from '@studyverse/shared';
import { prisma } from '../db';
import { secondsByLocalDay } from '../lib/time';

/** All statistics are derived from server-timestamped FOCUS segments, split at local midnight. */
export async function statsSummary(userId: string, tz: string) {
  const now = new Date();
  const [segs, completed, settings] = await Promise.all([
    prisma.sessionSegment.findMany({ where: { userId, kind: 'FOCUS' }, select: { startedAt: true, endedAt: true, subjectId: true } }),
    prisma.studySession.aggregate({ where: { userId, status: 'COMPLETED' }, _count: true, _sum: { focusSeconds: true }, _max: { focusSeconds: true } }),
    prisma.userSettings.findUnique({ where: { userId } }),
  ]);
  const days = secondsByLocalDay(segs.map((s) => ({ start: s.startedAt, end: s.endedAt ?? now })), tz);
  const local = DateTime.fromJSDate(now, { zone: tz });
  const sumFrom = (from: DateTime) => {
    let t = 0;
    for (const [k, v] of days) if (k >= from.toISODate()!) t += v;
    return t;
  };
  const weekly = Array.from({ length: 7 }, (_, i) => {
    const d = local.minus({ days: 6 - i });
    return { date: d.toISODate()!, label: d.setLocale('tr').toFormat('ccc'), seconds: days.get(d.toISODate()!) ?? 0 };
  });
  let streak = 0;
  let cursor = local;
  if ((days.get(cursor.toISODate()!) ?? 0) < XP_RULES.streakMinMinutes * 60) cursor = cursor.minus({ days: 1 });
  while ((days.get(cursor.toISODate()!) ?? 0) >= XP_RULES.streakMinMinutes * 60) {
    streak++;
    cursor = cursor.minus({ days: 1 });
  }
  const subjects = await prisma.subject.findMany({ where: { userId } });
  const bySubject = new Map<string | null, number>();
  for (const g of segs) {
    const ms = Math.max(0, (g.endedAt ?? now).getTime() - g.startedAt.getTime());
    bySubject.set(g.subjectId, (bySubject.get(g.subjectId) ?? 0) + ms);
  }
  for (const [k, ms] of bySubject) bySubject.set(k, Math.floor(ms / 1000));
  const lifetime = [...days.values()].reduce((a, b) => a + b, 0);
  const count = completed._count;
  return {
    todaySeconds: days.get(local.toISODate()!) ?? 0,
    weekSeconds: sumFrom(local.startOf('week')),
    monthSeconds: sumFrom(local.startOf('month')),
    totalSeconds: lifetime,
    sessionCount: count,
    averageSeconds: count ? Math.round((completed._sum.focusSeconds ?? 0) / count) : 0,
    longestSessionSeconds: completed._max.focusSeconds ?? 0,
    bestDaySeconds: Math.max(0, ...days.values()),
    streak,
    weekly,
    dailyGoalMinutes: settings?.dailyGoalMinutes ?? 120,
    // per segment, so a mid-session subject change attributes each part to the right subject
    subjects: [...bySubject.entries()]
      .map(([id, seconds]) => ({ name: subjects.find((s) => s.id === id)?.name ?? 'Konusuz', seconds }))
      .sort((a, b) => b.seconds - a.seconds),
  };
}

/** Focus seconds attributed to a room since `from` (open segments counted up to now). */
export async function roomFocus(roomId: string, from: Date) {
  const rows = await prisma.$queryRaw<{ userId: string; secs: number }[]>`
    SELECT "userId", COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE("endedAt", now()) - GREATEST("startedAt", ${from})))), 0)::float AS secs
    FROM "SessionSegment"
    WHERE "roomId" = ${roomId} AND kind = 'FOCUS' AND COALESCE("endedAt", now()) > ${from}
    GROUP BY "userId"`;
  return rows.map((r) => ({ userId: r.userId, seconds: Math.floor(r.secs) }));
}

/** Weekly (UTC Monday start) leaderboard from FOCUS segments. */
export async function weeklyLeaderboard() {
  const from = DateTime.utc().startOf('week').toJSDate();
  return prisma.$queryRaw<{ id: string; username: string; displayName: string; level: number; secs: number }[]>`
    SELECT u.id, u.username, u."displayName", u.level,
      SUM(EXTRACT(EPOCH FROM (COALESCE(s."endedAt", now()) - GREATEST(s."startedAt", ${from}))))::float AS secs
    FROM "SessionSegment" s JOIN "User" u ON u.id = s."userId"
    LEFT JOIN "UserSettings" us ON us."userId" = u.id
    WHERE s.kind = 'FOCUS' AND COALESCE(s."endedAt", now()) > ${from} AND COALESCE(us."showOnLeaderboard", true)
    GROUP BY u.id ORDER BY secs DESC LIMIT 50`;
}
