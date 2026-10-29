import { XP_RULES, levelForXp, ACHIEVEMENTS } from '@studyverse/shared';
import { prisma, isUniqueViolation, Prisma } from '../db';
import { config } from '../config';
import { conflict, notFound, badRequest } from '../lib/errors';
import { bus } from '../realtime/bus';
import { emitSessionEvent, type RoomEventType } from '../realtime/roomEvents';

type Tx = Prisma.TransactionClient;
const OPEN = ['ACTIVE', 'ON_BREAK', 'PAUSED'] as const;

const include = { segments: { orderBy: { startedAt: 'asc' as const } }, subject: { select: { name: true } } };
type FullSession = Prisma.StudySessionGetPayload<{ include: typeof include }>;

function segMs(s: { startedAt: Date; endedAt: Date | null }, now: Date) {
  return Math.max(0, (s.endedAt ?? now).getTime() - s.startedAt.getTime());
}

function segSeconds(s: { startedAt: Date; endedAt: Date | null }, now: Date) {
  return Math.floor(segMs(s, now) / 1000);
}

/** Sums in milliseconds and floors once, so splitting a segment (subject/room change) never loses time. */
function totals(segs: { kind: string; startedAt: Date; endedAt: Date | null }[], now: Date) {
  let focus = 0;
  let brk = 0;
  for (const g of segs) {
    if (g.kind === 'FOCUS') focus += segMs(g, now);
    else brk += segMs(g, now);
  }
  return { focus: Math.floor(focus / 1000), brk: Math.floor(brk / 1000), focusMs: focus, breakMs: brk };
}

export function serializeSession(s: FullSession | null) {
  if (!s) return null;
  const now = new Date();
  const { focus, brk, focusMs, breakMs } = totals(s.segments, now);
  const open = s.segments.find((x) => !x.endedAt) ?? null;
  return {
    id: s.id,
    status: s.status,
    subject: s.subject?.name ?? null,
    roomId: s.roomId,
    note: s.note,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    focusSeconds: s.status === 'COMPLETED' ? s.focusSeconds : focus,
    breakSeconds: s.status === 'COMPLETED' ? s.breakSeconds : brk,
    // unrounded totals at serverNow, so the live display never lags after a segment split
    focusMs: s.status === 'COMPLETED' ? s.focusSeconds * 1000 : focusMs,
    breakMs: s.status === 'COMPLETED' ? s.breakSeconds * 1000 : breakMs,
    current: open ? { kind: open.kind, startedAt: open.startedAt } : null,
    pomodoroBlocks: s.pomodoroBlocks,
    serverNow: now,
  };
}

/** Locks the user's open session row so concurrent tabs serialize their transitions. */
async function lockOpen(tx: Tx, userId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "StudySession" WHERE "openLock" = ${userId} FOR UPDATE`;
  if (!rows.length) return null;
  return tx.studySession.findUnique({ where: { id: rows[0].id }, include });
}

async function closeOpenSegment(tx: Tx, s: FullSession, at: Date) {
  const open = s.segments.find((x) => !x.endedAt);
  if (!open) return null;
  const end = at < open.startedAt ? open.startedAt : at;
  await tx.sessionSegment.update({ where: { id: open.id }, data: { endedAt: end } });
  return { ...open, endedAt: end };
}

export async function getOpenSession(userId: string) {
  return prisma.studySession.findUnique({ where: { openLock: userId }, include });
}

function changed(userId: string, s: FullSession | null, event?: RoomEventType) {
  bus.toUser(userId, 'session:update', serializeSession(s));
  bus.presenceChanged(userId);
  if (event) void emitSessionEvent(userId, event, s?.subject?.name ?? null);
}

export async function startSession(
  userId: string,
  input: { subject?: string | null; roomId?: string | null; note?: string | null; pomodoro?: boolean; requestId?: string },
) {
  if (input.requestId) {
    const prev = await prisma.studySession.findUnique({ where: { userId_clientRequestId: { userId, clientRequestId: input.requestId } }, include });
    if (prev) return prev;
  }
  if (input.roomId) {
    const m = await prisma.roomMember.findUnique({ where: { roomId_userId: { roomId: input.roomId, userId } } });
    if (!m) throw badRequest('Bu odanın üyesi değilsin.');
  }
  let subjectId: string | null = null;
  if (input.subject) {
    const sub = await prisma.subject.upsert({
      where: { userId_name: { userId, name: input.subject } },
      update: {},
      create: { userId, name: input.subject },
    });
    subjectId = sub.id;
  }
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  try {
    const s = await prisma.studySession.create({
      data: {
        userId,
        subjectId,
        roomId: input.roomId ?? null,
        note: input.note ?? null,
        openLock: userId,
        clientRequestId: input.requestId,
        pomodoroEnabled: !!input.pomodoro,
        pomodoroFocusMin: input.pomodoro ? (settings?.pomodoroFocusMin ?? 25) : null,
        pomodoroBreakMin: input.pomodoro ? (settings?.pomodoroBreakMin ?? 5) : null,
        segments: { create: { userId, kind: 'FOCUS', roomId: input.roomId ?? null, subjectId } },
      },
      include,
    });
    changed(userId, s, 'study_start');
    return s;
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('Zaten açık bir çalışma oturumun var.', 'SESSION_ALREADY_OPEN');
    throw e;
  }
}

type Action = 'pause' | 'resume' | 'break' | 'endBreak';

export async function transition(userId: string, action: Action) {
  let didChange = true;
  const s = await prisma.$transaction(async (tx) => {
    const s = await lockOpen(tx, userId);
    if (!s) throw notFound('Açık oturum yok.', 'NO_OPEN_SESSION');
    const now = new Date();
    const open = s.segments.find((x) => !x.endedAt);
    const roomId = open?.roomId ?? s.roomId;
    const openSeg = (kind: 'FOCUS' | 'BREAK') =>
      tx.sessionSegment.create({ data: { sessionId: s.id, userId, kind, roomId, subjectId: s.subjectId, startedAt: now } });

    if (action === 'pause') {
      if (s.status === 'PAUSED') return (didChange = false), s;
      await closeOpenSegment(tx, s, now);
      return tx.studySession.update({ where: { id: s.id }, data: { status: 'PAUSED', stateChangedAt: now }, include });
    }
    if (action === 'resume' || action === 'endBreak') {
      if (s.status === 'ACTIVE') return (didChange = false), s;
      await closeOpenSegment(tx, s, now);
      await openSeg('FOCUS');
      return tx.studySession.update({ where: { id: s.id }, data: { status: 'ACTIVE', stateChangedAt: now, lastHeartbeatAt: now }, include });
    }
    // break
    if (s.status === 'ON_BREAK') return (didChange = false), s;
    const closed = await closeOpenSegment(tx, s, now);
    let blocks = s.pomodoroBlocks;
    if (s.pomodoroEnabled && closed?.kind === 'FOCUS' && s.pomodoroFocusMin && segSeconds(closed, now) >= s.pomodoroFocusMin * 60 * 0.9) blocks++;
    await openSeg('BREAK');
    return tx.studySession.update({
      where: { id: s.id },
      data: { status: 'ON_BREAK', stateChangedAt: now, lastHeartbeatAt: now, pomodoroBlocks: blocks },
      include,
    });
  });
  if (didChange) changed(userId, s, action === 'pause' ? undefined : action === 'break' ? 'break' : 'resume');
  return s;
}

async function finalize(tx: Tx, s: FullSession, at: Date, reason: 'USER' | 'AUTO_STALE') {
  await closeOpenSegment(tx, s, at);
  const segs = await tx.sessionSegment.findMany({ where: { sessionId: s.id } });
  const { focus, brk } = totals(segs, at);
  const done = await tx.studySession.update({
    where: { id: s.id },
    data: { status: 'COMPLETED', openLock: null, endedAt: at, endReason: reason, focusSeconds: focus, breakSeconds: brk },
    include,
  });
  const xp = await awardSessionXp(tx, done);
  return { session: done, xp };
}

/** XP is computed on the server from finalized focus seconds; unique (userId, reason, sourceId) prevents double claims. */
async function awardSessionXp(tx: Tx, s: FullSession) {
  if (s.focusSeconds < XP_RULES.minEligibleSeconds) return 0;
  let amount = Math.floor(s.focusSeconds / 60) * XP_RULES.perFocusMinute;
  if (s.focusSeconds >= XP_RULES.deepFocusBonusThresholdSeconds) amount += XP_RULES.deepFocusBonus;
  amount += s.pomodoroBlocks * XP_RULES.pomodoroBlockBonus;
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const today = await tx.xpTransaction.aggregate({
    where: { userId: s.userId, reason: 'STUDY_SESSION', createdAt: { gte: dayStart } },
    _sum: { amount: true },
  });
  amount = Math.min(amount, XP_RULES.dailyStudyXpCap - (today._sum.amount ?? 0));
  if (amount <= 0) return 0;
  await tx.xpTransaction.create({ data: { userId: s.userId, amount, reason: 'STUDY_SESSION', sourceId: s.id } });
  const u = await tx.user.update({ where: { id: s.userId }, data: { xp: { increment: amount } } });
  await tx.user.update({ where: { id: u.id }, data: { level: levelForXp(u.xp) } });
  return amount;
}

export async function finishSession(userId: string, note?: string | null) {
  const res = await prisma.$transaction(async (tx) => {
    const s = await lockOpen(tx, userId);
    if (!s) throw notFound('Açık oturum yok.', 'NO_OPEN_SESSION');
    if (note !== undefined) await tx.studySession.update({ where: { id: s.id }, data: { note } });
    return finalize(tx, s, new Date(), 'USER');
  });
  const unlocked = await evaluateAchievements(userId, res.session);
  changed(userId, null);
  void emitSessionEvent(userId, 'finish', res.session.subject?.name ?? null);
  return { ...res, unlocked };
}

export async function heartbeat(userId: string) {
  await prisma.studySession.updateMany({ where: { openLock: userId }, data: { lastHeartbeatAt: new Date() } });
}

/**
 * Changes the subject of the caller's own open session without touching its timing.
 * The running segment is split at "now": time before the change stays on the old subject,
 * time after goes to the new one (segments are the timestamped subject history).
 * No XP is involved; XP is only awarded once at finish.
 */
export async function setSessionSubject(userId: string, name: string) {
  const subject = await prisma.subject.upsert({
    where: { userId_name: { userId, name } },
    update: { archivedAt: null },
    create: { userId, name },
  });
  let didChange = false;
  const s = await prisma.$transaction(async (tx) => {
    const s = await lockOpen(tx, userId);
    if (!s) throw notFound('Açık oturum yok.', 'NO_OPEN_SESSION');
    if (s.subjectId === subject.id) return s;
    didChange = true;
    const open = s.segments.find((x) => !x.endedAt);
    if (open) {
      const now = new Date();
      await closeOpenSegment(tx, s, now);
      await tx.sessionSegment.create({ data: { sessionId: s.id, userId, kind: open.kind, roomId: open.roomId, subjectId: subject.id, startedAt: now } });
    }
    return tx.studySession.update({ where: { id: s.id }, data: { subjectId: subject.id }, include });
  });
  if (didChange) changed(userId, s, 'subject_change');
  return s;
}

/** Moves the running segment to another room so room totals stay exact. */
export async function setSessionRoom(userId: string, roomId: string | null) {
  await prisma.$transaction(async (tx) => {
    const s = await lockOpen(tx, userId);
    if (!s) return;
    const open = s.segments.find((x) => !x.endedAt);
    if (!open || open.roomId === roomId) return;
    const now = new Date();
    await closeOpenSegment(tx, s, now);
    await tx.sessionSegment.create({ data: { sessionId: s.id, userId, kind: open.kind, roomId, subjectId: s.subjectId, startedAt: now } });
  });
}

/**
 * Stale policy: a running session with no heartbeat for SESSION_STALE_SECONDS is paused
 * with its segment closed at the last heartbeat (time after it is never counted).
 * A session paused for SESSION_AUTO_FINISH_HOURS is completed automatically.
 */
export async function sweepStaleSessions() {
  const now = Date.now();
  const stale = await prisma.studySession.findMany({
    where: { status: { in: ['ACTIVE', 'ON_BREAK'] }, lastHeartbeatAt: { lt: new Date(now - config.SESSION_STALE_SECONDS * 1000) } },
    select: { userId: true },
  });
  for (const { userId } of stale) {
    const s = await prisma.$transaction(async (tx) => {
      const s = await lockOpen(tx, userId);
      if (!s || s.status === 'PAUSED' || s.lastHeartbeatAt.getTime() >= now - config.SESSION_STALE_SECONDS * 1000) return null;
      await closeOpenSegment(tx, s, s.lastHeartbeatAt);
      return tx.studySession.update({ where: { id: s.id }, data: { status: 'PAUSED', stateChangedAt: new Date() }, include });
    });
    if (s) changed(userId, s);
  }
  const old = await prisma.studySession.findMany({
    where: { status: 'PAUSED', stateChangedAt: { lt: new Date(now - config.SESSION_AUTO_FINISH_HOURS * 3600_000) } },
    select: { userId: true },
  });
  for (const { userId } of old) {
    await prisma.$transaction(async (tx) => {
      const s = await lockOpen(tx, userId);
      if (s && s.status === 'PAUSED') await finalize(tx, s, s.stateChangedAt, 'AUTO_STALE');
    });
    changed(userId, null);
  }
}

async function evaluateAchievements(userId: string, session: FullSession) {
  const [total, have, friends] = await Promise.all([
    prisma.studySession.aggregate({ where: { userId, status: 'COMPLETED' }, _sum: { focusSeconds: true } }),
    prisma.userAchievement.findMany({ where: { userId }, select: { achievementKey: true } }),
    prisma.friendship.count({ where: { OR: [{ userAId: userId }, { userBId: userId }] } }),
  ]);
  const t = total._sum.focusSeconds ?? 0;
  const owned = new Set(have.map((h) => h.achievementKey));
  const hour = session.startedAt.getHours();
  const checks: Record<string, boolean> = {
    first_session: session.focusSeconds >= XP_RULES.minEligibleSeconds,
    hours_1: t >= 3600,
    hours_10: t >= 36000,
    hours_50: t >= 180000,
    hours_100: t >= 360000,
    marathon: session.focusSeconds >= 7200,
    early_bird: session.focusSeconds >= 300 && hour < 7,
    night_owl: session.focusSeconds >= 300 && hour >= 23,
    social_3: friends >= 3,
  };
  const unlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!checks[a.key] || owned.has(a.key)) continue;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.userAchievement.create({ data: { userId, achievementKey: a.key } });
        await tx.xpTransaction.create({ data: { userId, amount: a.xpReward, reason: 'ACHIEVEMENT', sourceId: a.key } });
        const u = await tx.user.update({ where: { id: userId }, data: { xp: { increment: a.xpReward } } });
        await tx.user.update({ where: { id: userId }, data: { level: levelForXp(u.xp) } });
      });
      unlocked.push(a.key);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  return unlocked;
}

export { OPEN };
