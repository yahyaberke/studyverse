import { Router } from 'express';
import { z } from 'zod';
import {
  avatarConfigSchema,
  findLockedChoice,
  eligibleCosmeticKeys,
  levelProgress,
  CHAT_MAX_LENGTH,
  CHEER_MESSAGES,
  ACHIEVEMENTS,
} from '@studyverse/shared';
import { prisma, isUniqueViolation } from '../db';
import { config } from '../config';
import { parse } from '../lib/validate';
import { badRequest, conflict, forbidden, notFound, unauthorized, HttpError } from '../lib/errors';
import { hashPassword, verifyPassword, burnPasswordCheck, randomToken, sha256 } from '../lib/crypto';
import { limiter, EventLimiter } from '../lib/rateLimit';
import { isValidTimeZone } from '../lib/time';
import { requireAuth, uid } from '../auth/middleware';
import {
  createLoginSession,
  rotateRefreshToken,
  revokeFamily,
  revokeAllForUser,
  setAuthCookies,
  clearAuthCookies,
  REFRESH_COOKIE,
} from '../auth/tokens';
import { sendMail } from '../mail';
import { bus } from '../realtime/bus';
import { presence } from '../realtime/presence';
import * as sessions from '../services/sessions';
import { statsSummary, roomFocus, weeklyLeaderboard } from '../services/stats';

export const api = Router();

// ───────── helpers ─────────
const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9_]{3,20}$/, 'Kullanıcı adı 3-20 karakter; harf, rakam ve _ içerebilir.');
const password = z
  .string()
  .min(8, 'Şifre en az 8 karakter olmalı.')
  .max(128)
  .regex(/[A-Za-z]/, 'Şifre en az bir harf içermeli.')
  .regex(/[0-9]/, 'Şifre en az bir rakam içermeli.');
const displayName = z.string().trim().min(1).max(30);

async function me(userId: string) {
  const u = await prisma.user.findUnique({ where: { id: userId }, include: { avatar: true, settings: true, cosmetics: true } });
  if (!u) throw unauthorized();
  const { passwordHash: _p, cosmetics, ...rest } = u;
  return { ...rest, progress: levelProgress(u.xp), cosmetics: cosmetics.map((c) => c.itemKey) };
}

async function syncCosmetics(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { achievements: true } });
  const keys = eligibleCosmeticKeys({ level: u.level, achievements: new Set(u.achievements.map((a) => a.achievementKey)) });
  if (keys.length)
    await prisma.userCosmetic.createMany({ data: keys.map((itemKey) => ({ userId, itemKey, source: 'unlock' })), skipDuplicates: true });
}

const avatarSelect = { avatar: true, id: true, username: true, displayName: true, level: true } as const;

// ───────── auth ─────────
const authLimit = limiter({ windowMs: 15 * 60_000, limit: 20 });
const loginFails = new EventLimiter(8, 15 * 60_000);

api.get('/auth/config', (_req, res) => res.json({ mailEnabled: config.mailEnabled }));

api.post('/auth/register', authLimit, async (req, res) => {
  const body = parse(
    z.object({ username, email: z.string().trim().toLowerCase().email('Geçerli bir e-posta girin.').max(200), password, displayName: displayName.optional() }),
    req.body,
  );
  try {
    const user = await prisma.user.create({
      data: {
        username: body.username,
        email: body.email,
        passwordHash: await hashPassword(body.password),
        displayName: body.displayName || body.username,
        settings: { create: {} },
      },
    });
    const { refreshToken, familyId } = await createLoginSession(user.id, req.headers['user-agent']);
    setAuthCookies(res, user.id, familyId, refreshToken);
    res.status(201).json({ user: await me(user.id) });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict('Bu kullanıcı adı veya e-posta zaten kullanımda.', 'TAKEN');
    throw e;
  }
});

api.post('/auth/login', authLimit, async (req, res) => {
  const body = parse(z.object({ identifier: z.string().trim().toLowerCase().min(1).max(200), password: z.string().min(1).max(128) }), req.body);
  if (!loginFails.allow(body.identifier)) throw new HttpError(429, 'RATE_LIMITED', 'Çok fazla hatalı deneme. 15 dakika sonra tekrar deneyin.');
  const user = await prisma.user.findFirst({ where: { OR: [{ email: body.identifier }, { username: body.identifier }] } });
  if (!user) {
    await burnPasswordCheck(body.password);
    throw unauthorized('Kullanıcı adı/e-posta veya şifre hatalı.', 'INVALID_CREDENTIALS');
  }
  if (!(await verifyPassword(user.passwordHash, body.password))) throw unauthorized('Kullanıcı adı/e-posta veya şifre hatalı.', 'INVALID_CREDENTIALS');
  loginFails.reset(body.identifier);
  const { refreshToken, familyId } = await createLoginSession(user.id, req.headers['user-agent']);
  setAuthCookies(res, user.id, familyId, refreshToken);
  res.json({ user: await me(user.id) });
});

api.post('/auth/refresh', limiter({ windowMs: 60_000, limit: 30 }), async (req, res) => {
  const raw = req.cookies?.[REFRESH_COOKIE];
  if (!raw) throw unauthorized('Oturum bulunamadı.', 'NO_REFRESH');
  const r = await rotateRefreshToken(raw, req.headers['user-agent']);
  if (!r.ok) {
    clearAuthCookies(res);
    throw unauthorized('Oturum geçersiz, tekrar giriş yapın.', `REFRESH_${r.reason.toUpperCase()}`);
  }
  setAuthCookies(res, r.userId, r.familyId, r.refreshToken);
  res.json({ ok: true });
});

api.post('/auth/logout', requireAuth, async (req, res) => {
  await revokeFamily(req.user!.sid);
  bus.disconnectLoginSession(req.user!.sid);
  clearAuthCookies(res);
  res.json({ ok: true });
});

api.post('/auth/logout-all', requireAuth, async (req, res) => {
  await revokeAllForUser(uid(req));
  bus.disconnectUser(uid(req));
  clearAuthCookies(res);
  res.json({ ok: true });
});

api.post('/auth/password/forgot', limiter({ windowMs: 60 * 60_000, limit: 5 }), async (req, res) => {
  if (!config.mailEnabled) throw new HttpError(503, 'MAIL_DISABLED', 'Şifre sıfırlama e-postası bu sunucuda yapılandırılmamış.');
  const { email } = parse(z.object({ email: z.string().trim().toLowerCase().email() }), req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (user) {
    const raw = randomToken(32);
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 30 * 60_000) } });
    await sendMail(email, 'Şifre sıfırlama', `Şifreni sıfırlamak için (30 dk geçerli):\n${config.clientOrigins[0]}/reset-password?token=${raw}`);
  }
  res.json({ ok: true }); // same response whether or not the account exists
});

api.post('/auth/password/reset', limiter({ windowMs: 60 * 60_000, limit: 10 }), async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10).max(200), password }), req.body);
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(body.token) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw badRequest('Bağlantı geçersiz veya süresi dolmuş.', 'RESET_INVALID');
  const used = await prisma.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (used.count !== 1) throw badRequest('Bağlantı zaten kullanılmış.', 'RESET_INVALID');
  await prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(body.password) } });
  await revokeAllForUser(row.userId);
  bus.disconnectUser(row.userId);
  res.json({ ok: true });
});

api.get('/auth/me', requireAuth, async (req, res) => res.json({ user: await me(uid(req)) }));

// everything below requires auth
api.use(requireAuth);

// ───────── profile ─────────
api.patch('/me', async (req, res) => {
  const body = parse(z.object({ displayName: displayName.optional(), timezone: z.string().max(64).optional() }), req.body);
  if (body.timezone && !isValidTimeZone(body.timezone)) throw badRequest('Geçersiz saat dilimi.');
  await prisma.user.update({ where: { id: uid(req) }, data: body });
  res.json({ user: await me(uid(req)) });
});

api.put('/me/avatar', async (req, res) => {
  const cfg = parse(avatarConfigSchema, req.body);
  await syncCosmetics(uid(req));
  const owned = new Set((await prisma.userCosmetic.findMany({ where: { userId: uid(req) } })).map((c) => c.itemKey));
  const locked = findLockedChoice(cfg, owned);
  if (locked) throw forbidden('Bu öğe henüz kilitli.', 'COSMETIC_LOCKED');
  await prisma.avatar.upsert({ where: { userId: uid(req) }, update: cfg, create: { userId: uid(req), ...cfg } });
  bus.presenceChanged(uid(req));
  res.json({ user: await me(uid(req)) });
});

const settingsSchema = z
  .object({
    profileVisibility: z.enum(['PUBLIC', 'FRIENDS', 'PRIVATE']),
    presenceVisibility: z.enum(['PUBLIC', 'FRIENDS', 'PRIVATE']),
    statsVisibility: z.enum(['PUBLIC', 'FRIENDS', 'PRIVATE']),
    showRoomToFriends: z.boolean(),
    showOnLeaderboard: z.boolean(),
    dailyGoalMinutes: z.number().int().min(10).max(960),
    weeklyGoalMinutes: z.number().int().min(30).max(6000),
    pomodoroFocusMin: z.number().int().min(5).max(180),
    pomodoroBreakMin: z.number().int().min(1).max(60),
    pomodoroLongBreakMin: z.number().int().min(5).max(90),
    pomodoroLongEvery: z.number().int().min(2).max(10),
    pomodoroAutoAdvance: z.boolean(),
    soundEnabled: z.boolean(),
    soundJoinLeave: z.boolean(),
    soundStudy: z.boolean(),
    soundBreak: z.boolean(),
    soundMention: z.boolean(),
    soundSubject: z.boolean(),
    notificationsEnabled: z.boolean(),
    theme: z.enum(['system', 'light', 'dark']),
  })
  .partial();

api.patch('/me/settings', async (req, res) => {
  const body = parse(settingsSchema, req.body);
  await prisma.userSettings.upsert({ where: { userId: uid(req) }, update: body, create: { userId: uid(req), ...body } });
  res.json({ user: await me(uid(req)) });
});

// ───────── sessions & stats ─────────
api.get('/sessions/current', async (req, res) => res.json({ session: sessions.serializeSession(await sessions.getOpenSession(uid(req))) }));

const studyLimit = limiter({ windowMs: 60_000, limit: 60 });
api.post('/sessions/start', studyLimit, async (req, res) => {
  const body = parse(
    z.object({
      subject: z.string().trim().max(40).nullish(),
      roomId: z.string().max(40).nullish(),
      note: z.string().trim().max(500).nullish(),
      pomodoro: z.boolean().optional(),
      requestId: z.string().max(64).optional(),
    }),
    req.body,
  );
  const s = await sessions.startSession(uid(req), body);
  res.status(201).json({ session: sessions.serializeSession(s) });
});

for (const action of ['pause', 'resume', 'break', 'endBreak'] as const) {
  api.post(`/sessions/current/${action}`, studyLimit, async (req, res) => {
    res.json({ session: sessions.serializeSession(await sessions.transition(uid(req), action)) });
  });
}

api.post('/sessions/current/finish', studyLimit, async (req, res) => {
  const body = parse(z.object({ note: z.string().trim().max(500).nullish() }), req.body ?? {});
  const r = await sessions.finishSession(uid(req), body.note);
  res.json({ session: sessions.serializeSession(r.session), xpAwarded: r.xp, unlocked: r.unlocked });
});

const subjectName = z
  .string()
  .transform((v) => v.replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim())
  .pipe(z.string().min(1, 'Konu boş olamaz.').max(40, 'Konu en fazla 40 karakter olabilir.'));

// only ever touches the caller's own open session
api.post('/sessions/current/subject', studyLimit, async (req, res) => {
  const { subject } = parse(z.object({ subject: subjectName }), req.body);
  res.json({ session: sessions.serializeSession(await sessions.setSessionSubject(uid(req), subject)) });
});

api.get('/subjects', async (req, res) => {
  const items = await prisma.subject.findMany({ where: { userId: uid(req), archivedAt: null }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, name: true } });
  res.json({ items });
});

// ───────── notifications (persistent; mentions) ─────────
api.get('/notifications', async (req, res) => {
  const [items, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: uid(req) }, orderBy: { createdAt: 'desc' }, take: 30 }),
    prisma.notification.count({ where: { userId: uid(req), readAt: null } }),
  ]);
  res.json({ items, unread });
});

api.post('/notifications/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: uid(req), readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

api.post('/notifications/:id/read', async (req, res) => {
  // scoped by userId: cannot mark someone else's notification
  const r = await prisma.notification.updateMany({ where: { id: String(req.params.id), userId: uid(req), readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true, updated: r.count });
});

api.post('/sessions/heartbeat', async (req, res) => {
  await sessions.heartbeat(uid(req));
  res.json({ ok: true });
});

api.get('/sessions', async (req, res) => {
  const { cursor } = parse(z.object({ cursor: z.string().max(40).optional() }), req.query);
  const rows = await prisma.studySession.findMany({
    where: { userId: uid(req), status: 'COMPLETED' },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    take: 21,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { subject: { select: { name: true } } },
  });
  res.json({
    items: rows.slice(0, 20).map((s) => ({
      id: s.id,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      focusSeconds: s.focusSeconds,
      breakSeconds: s.breakSeconds,
      subject: s.subject?.name ?? null,
      note: s.note,
      endReason: s.endReason,
    })),
    nextCursor: rows.length > 20 ? rows[19].id : null,
  });
});

api.get('/stats', async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: uid(req) } });
  res.json(await statsSummary(u.id, u.timezone));
});

api.get('/leaderboard', async (_req, res) => {
  const [weekly, allTime] = await Promise.all([
    weeklyLeaderboard(),
    prisma.user.findMany({
      where: { OR: [{ settings: { showOnLeaderboard: true } }, { settings: null }] },
      orderBy: { xp: 'desc' },
      take: 50,
      select: { id: true, username: true, displayName: true, level: true, xp: true },
    }),
  ]);
  res.json({ weekly: weekly.map((w) => ({ ...w, seconds: Math.floor(w.secs) })), allTime });
});

api.get('/achievements', async (req, res) => {
  const mine = await prisma.userAchievement.findMany({ where: { userId: uid(req) } });
  res.json({ items: ACHIEVEMENTS.map((a) => ({ ...a, unlockedAt: mine.find((m) => m.achievementKey === a.key)?.unlockedAt ?? null })) });
});

// ───────── rooms ─────────
function serializeRoom(r: {
  id: string; name: string; description: string; visibility: string; passwordHash: string | null; maxParticipants: number;
  category: string | null; goalText: string | null; goalMinutes: number | null; theme: string; ownerId: string | null; createdAt: Date;
  _count?: { members: number };
}, online = 0) {
  const { passwordHash, _count, ...rest } = r;
  return { ...rest, hasPassword: !!passwordHash, memberCount: _count?.members ?? 0, onlineCount: online };
}

const roomInput = z.object({
  name: z.string().trim().min(3, 'Oda adı en az 3 karakter.').max(50),
  description: z.string().trim().max(300).default(''),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).default('PUBLIC'),
  password: z.string().min(4, 'Oda şifresi en az 4 karakter.').max(64).nullish(),
  maxParticipants: z.number().int().min(2).max(50).default(12),
  category: z.string().trim().max(40).nullish(),
  goalText: z.string().trim().max(120).nullish(),
  goalMinutes: z.number().int().min(10).max(100000).nullish(),
});

api.get('/rooms', async (req, res) => {
  const q = parse(z.object({ q: z.string().trim().max(50).optional(), category: z.string().max(40).optional(), cursor: z.string().max(40).optional() }), req.query);
  const rows = await prisma.room.findMany({
    where: {
      visibility: 'PUBLIC',
      archivedAt: null,
      ...(q.q ? { name: { contains: q.q, mode: 'insensitive' as const } } : {}),
      ...(q.category ? { category: q.category } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 21,
    ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    include: { _count: { select: { members: true } } },
  });
  const page = rows.slice(0, 20);
  const counts = await presence.store.roomCounts(page.map((r) => r.id));
  res.json({ items: page.map((r) => serializeRoom(r, counts.get(r.id) ?? 0)), nextCursor: rows.length > 20 ? rows[19].id : null });
});

api.get('/rooms/mine', async (req, res) => {
  const ms = await prisma.roomMember.findMany({
    where: { userId: uid(req), room: { archivedAt: null } },
    orderBy: { lastVisitedAt: 'desc' },
    include: { room: { include: { _count: { select: { members: true } } } } },
  });
  const counts = await presence.store.roomCounts(ms.map((m) => m.roomId));
  res.json({ items: ms.map((m) => ({ ...serializeRoom(m.room, counts.get(m.roomId) ?? 0), role: m.role })) });
});

api.post('/rooms', limiter({ windowMs: 60 * 60_000, limit: 20 }), async (req, res) => {
  const body = parse(roomInput, req.body);
  const room = await prisma.room.create({
    data: {
      name: body.name,
      description: body.description,
      visibility: body.visibility,
      passwordHash: body.password ? await hashPassword(body.password) : null,
      maxParticipants: body.maxParticipants,
      category: body.category,
      goalText: body.goalText,
      goalMinutes: body.goalMinutes,
      goalSetAt: new Date(),
      ownerId: uid(req),
      members: { create: { userId: uid(req), role: 'OWNER' } },
    },
    include: { _count: { select: { members: true } } },
  });
  res.status(201).json({ room: serializeRoom(room) });
});

/** Members see everything; others only see public rooms. Private rooms 404 for non-members (no existence leak). */
async function loadRoomFor(userId: string, roomId: string) {
  const room = await prisma.room.findUnique({ where: { id: roomId }, include: { _count: { select: { members: true } } } });
  if (!room || room.archivedAt) throw notFound('Oda bulunamadı.', 'ROOM_NOT_FOUND');
  const member = await prisma.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
  if (!member && room.visibility === 'PRIVATE') throw notFound('Oda bulunamadı.', 'ROOM_NOT_FOUND');
  return { room, member };
}

async function requireMember(userId: string, roomId: string) {
  const { room, member } = await loadRoomFor(userId, roomId);
  if (!member) throw forbidden('Önce odaya katılmalısın.', 'NOT_MEMBER');
  return { room, member };
}

async function requireOwner(userId: string, roomId: string) {
  const r = await requireMember(userId, roomId);
  if (r.member.role !== 'OWNER') throw forbidden('Sadece oda sahibi bu işlemi yapabilir.', 'NOT_OWNER');
  return r;
}

api.get('/rooms/:id', async (req, res) => {
  const { room, member } = await loadRoomFor(uid(req), String(req.params.id));
  const online = (await presence.store.roomUsers(room.id)).length;
  res.json({ room: serializeRoom(room, online), membership: member ? { role: member.role } : null });
});

api.get('/invites/:code', async (req, res) => {
  const link = await prisma.roomInviteLink.findUnique({ where: { code: String(req.params.code) }, include: { room: { include: { _count: { select: { members: true } } } } } });
  if (!link || link.revokedAt || link.room.archivedAt) throw notFound('Davet bağlantısı geçersiz.', 'INVITE_INVALID');
  if (link.expiresAt && link.expiresAt < new Date()) throw new HttpError(410, 'INVITE_EXPIRED', 'Davet bağlantısının süresi dolmuş.');
  res.json({ room: serializeRoom(link.room) });
});

const joinAttempts = new EventLimiter(10, 15 * 60_000);

async function joinRoom(userId: string, roomId: string | null, password?: string | null, inviteCode?: string | null) {
  let link = null;
  if (inviteCode) {
    link = await prisma.roomInviteLink.findUnique({ where: { code: inviteCode } });
    if (!link || link.revokedAt) throw notFound('Davet bağlantısı geçersiz.', 'INVITE_INVALID');
    if (link.expiresAt && link.expiresAt < new Date()) throw new HttpError(410, 'INVITE_EXPIRED', 'Davet bağlantısının süresi dolmuş.');
    if (link.maxUses && link.uses >= link.maxUses) throw new HttpError(410, 'INVITE_EXPIRED', 'Davet bağlantısının kullanım hakkı dolmuş.');
    roomId = link.roomId;
  }
  if (!roomId) throw badRequest('Oda belirtilmedi.');
  if (!joinAttempts.allow(`${userId}:${roomId}`)) throw new HttpError(429, 'RATE_LIMITED', 'Çok fazla deneme. Biraz bekleyin.');
  const rid = roomId;
  return prisma.$transaction(async (tx) => {
    // row lock: serializes concurrent joins so the capacity check cannot be raced
    await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${rid} FOR UPDATE`;
    const room = await tx.room.findUnique({ where: { id: rid } });
    if (!room || room.archivedAt) throw notFound('Oda bulunamadı.', 'ROOM_NOT_FOUND');
    const existing = await tx.roomMember.findUnique({ where: { roomId_userId: { roomId: rid, userId } } });
    if (existing) return room;
    if (await tx.roomBan.findUnique({ where: { roomId_userId: { roomId: rid, userId } } })) throw forbidden('Bu odadan çıkarıldın.', 'BANNED');
    if (room.visibility === 'PRIVATE' && !link) throw notFound('Oda bulunamadı.', 'ROOM_NOT_FOUND');
    if (room.passwordHash) {
      if (!password) throw unauthorized('Bu oda şifreli.', 'PASSWORD_REQUIRED');
      if (!(await verifyPassword(room.passwordHash, password))) throw unauthorized('Oda şifresi hatalı.', 'WRONG_PASSWORD');
    }
    const count = await tx.roomMember.count({ where: { roomId: rid } });
    if (count >= room.maxParticipants) throw conflict('Oda dolu.', 'ROOM_FULL');
    await tx.roomMember.create({ data: { roomId: rid, userId } });
    if (link) await tx.roomInviteLink.update({ where: { id: link.id }, data: { uses: { increment: 1 } } });
    return room;
  });
}

const joinBody = z.object({ password: z.string().max(64).nullish(), inviteCode: z.string().max(64).nullish() });
api.post('/rooms/:id/join', async (req, res) => {
  const body = parse(joinBody, req.body ?? {});
  const room = await joinRoom(uid(req), String(req.params.id), body.password, body.inviteCode);
  bus.toRoom(room.id, 'room:members-changed', {});
  res.json({ roomId: room.id });
});
api.post('/rooms/join-by-code', async (req, res) => {
  const body = parse(joinBody.extend({ inviteCode: z.string().min(1).max(64) }), req.body);
  const room = await joinRoom(uid(req), null, body.password, body.inviteCode);
  bus.toRoom(room.id, 'room:members-changed', {});
  res.json({ roomId: room.id });
});

async function removeMember(roomId: string, userId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${roomId} FOR UPDATE`;
    const m = await tx.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
    if (!m) return;
    await tx.roomMember.delete({ where: { id: m.id } });
    if (m.role === 'OWNER') {
      // ownership passes to the longest-standing member; an empty room is archived
      const next = await tx.roomMember.findFirst({ where: { roomId }, orderBy: { joinedAt: 'asc' } });
      if (next) {
        await tx.roomMember.update({ where: { id: next.id }, data: { role: 'OWNER' } });
        await tx.room.update({ where: { id: roomId }, data: { ownerId: next.userId } });
      } else await tx.room.update({ where: { id: roomId }, data: { ownerId: null, archivedAt: new Date() } });
    }
  });
  bus.removeUserFromRoom(userId, roomId);
  await sessions.setSessionRoom(userId, null);
  bus.toRoom(roomId, 'room:members-changed', {});
}

api.post('/rooms/:id/leave', async (req, res) => {
  await requireMember(uid(req), String(req.params.id));
  await removeMember(String(req.params.id), uid(req));
  res.json({ ok: true });
});

api.patch('/rooms/:id', async (req, res) => {
  const { room } = await requireOwner(uid(req), String(req.params.id));
  const body = parse(roomInput.partial().extend({ theme: z.string().max(20).optional() }), req.body);
  if (body.maxParticipants && body.maxParticipants < (room._count?.members ?? 0)) throw badRequest('Kapasite mevcut üye sayısından az olamaz.');
  const { password: pw, ...rest } = body;
  const updated = await prisma.room.update({
    where: { id: room.id },
    data: {
      ...rest,
      ...(pw !== undefined ? { passwordHash: pw ? await hashPassword(pw) : null } : {}),
      ...(body.goalMinutes !== undefined ? { goalSetAt: new Date() } : {}),
    },
    include: { _count: { select: { members: true } } },
  });
  bus.toRoom(room.id, 'room:updated', serializeRoom(updated));
  res.json({ room: serializeRoom(updated) });
});

api.post('/rooms/:id/kick', async (req, res) => {
  const { room } = await requireOwner(uid(req), String(req.params.id));
  const body = parse(z.object({ userId: z.string().max(40), ban: z.boolean().default(false) }), req.body);
  if (body.userId === uid(req)) throw badRequest('Kendini çıkaramazsın.');
  const target = await prisma.roomMember.findUnique({ where: { roomId_userId: { roomId: room.id, userId: body.userId } } });
  if (!target) throw notFound('Üye bulunamadı.');
  if (body.ban) await prisma.roomBan.upsert({ where: { roomId_userId: { roomId: room.id, userId: body.userId } }, update: {}, create: { roomId: room.id, userId: body.userId } });
  bus.toUser(body.userId, 'room:kicked', { roomId: room.id });
  await removeMember(room.id, body.userId);
  res.json({ ok: true });
});

api.post('/rooms/:id/transfer', async (req, res) => {
  const { room } = await requireOwner(uid(req), String(req.params.id));
  const body = parse(z.object({ userId: z.string().max(40) }), req.body);
  const target = await prisma.roomMember.findUnique({ where: { roomId_userId: { roomId: room.id, userId: body.userId } } });
  if (!target || target.userId === uid(req)) throw badRequest('Geçersiz üye.');
  await prisma.$transaction([
    prisma.roomMember.update({ where: { roomId_userId: { roomId: room.id, userId: uid(req) } }, data: { role: 'MEMBER' } }),
    prisma.roomMember.update({ where: { id: target.id }, data: { role: 'OWNER' } }),
    prisma.room.update({ where: { id: room.id }, data: { ownerId: target.userId } }),
  ]);
  bus.toRoom(room.id, 'room:members-changed', {});
  res.json({ ok: true });
});

api.post('/rooms/:id/invites', async (req, res) => {
  const { room } = await requireOwner(uid(req), String(req.params.id));
  const body = parse(z.object({ expiresInHours: z.number().int().min(1).max(720).default(168), maxUses: z.number().int().min(1).max(500).nullish() }), req.body ?? {});
  const link = await prisma.roomInviteLink.create({
    data: { roomId: room.id, code: randomToken(16), createdById: uid(req), expiresAt: new Date(Date.now() + body.expiresInHours * 3600_000), maxUses: body.maxUses },
  });
  res.status(201).json({ code: link.code, expiresAt: link.expiresAt });
});

api.get('/rooms/:id/members', async (req, res) => {
  const { room } = await requireMember(uid(req), String(req.params.id));
  const members = await prisma.roomMember.findMany({ where: { roomId: room.id }, orderBy: { joinedAt: 'asc' }, include: { user: { select: avatarSelect } } });
  const live = new Set(await presence.store.roomUsers(room.id));
  const statuses = await Promise.all(members.map((m) => presence.activityOf(m.userId)));
  const focus = await roomFocus(room.id, room.goalSetAt ?? room.createdAt);
  res.json({
    items: members.map((m, i) => ({
      userId: m.userId,
      role: m.role,
      username: m.user.username,
      displayName: m.user.displayName,
      level: m.user.level,
      avatar: m.user.avatar,
      inRoom: live.has(m.userId),
      status: live.has(m.userId) ? statuses[i].status : 'offline',
      subject: live.has(m.userId) ? statuses[i].subject : null,
      focusSeconds: focus.find((f) => f.userId === m.userId)?.seconds ?? 0,
    })),
    groupFocusSeconds: focus.reduce((a, f) => a + f.seconds, 0),
  });
});

api.get('/rooms/:id/messages', async (req, res) => {
  const { room } = await requireMember(uid(req), String(req.params.id));
  const rows = await prisma.chatMessage.findMany({
    where: { roomId: room.id, deletedAt: null },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { user: { select: { username: true, displayName: true } } },
  });
  res.json({ items: rows.reverse().map(serializeMessage) });
});

export function serializeMessage(m: { id: string; userId: string; kind: string; body: string; createdAt: Date; user: { username: string; displayName: string } }) {
  return { id: m.id, userId: m.userId, kind: m.kind, body: m.body, createdAt: m.createdAt, username: m.user.username, displayName: m.user.displayName };
}

const chatLimiter = new EventLimiter(6, 10_000);
const lastMessage = new Map<string, { body: string; at: number }>();

/** Shared by REST and socket: membership check, validation, rate limiting, duplicate suppression. */
export async function postMessage(userId: string, roomId: string, rawBody: unknown, kind: 'TEXT' | 'CHEER' = 'TEXT') {
  await requireMember(userId, roomId);
  const body = parse(
    z.string().transform((s) => s.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim()).pipe(z.string().min(1, 'Mesaj boş olamaz.').max(CHAT_MAX_LENGTH, `Mesaj en fazla ${CHAT_MAX_LENGTH} karakter.`)),
    rawBody,
  );
  if (kind === 'CHEER' && !(CHEER_MESSAGES as readonly string[]).includes(body)) throw badRequest('Geçersiz tezahürat.');
  if (!chatLimiter.allow(userId)) throw new HttpError(429, 'RATE_LIMITED', 'Çok hızlı mesaj gönderiyorsun.');
  const prev = lastMessage.get(userId);
  if (prev && prev.body === body && Date.now() - prev.at < 30_000) throw badRequest('Aynı mesajı tekrar gönderemezsin.', 'DUPLICATE');
  lastMessage.set(userId, { body, at: Date.now() });
  const m = await prisma.chatMessage.create({ data: { roomId, userId, body, kind }, include: { user: { select: { username: true, displayName: true } } } });
  const out = serializeMessage(m);
  bus.toRoom(roomId, 'chat:message', out);
  if (kind === 'TEXT') void notifyMentions(userId, roomId, m.id, body, m.user.displayName);
  return out;
}

/**
 * @username mentions: only current members of the room (other than the sender, and not
 * users who blocked the sender) get a persistent notification, pushed to all their sessions.
 */
async function notifyMentions(senderId: string, roomId: string, messageId: string, body: string, senderName: string) {
  try {
    const names = [...new Set([...body.matchAll(/(?:^|[^a-z0-9_])@([a-z0-9_]{3,20})(?![a-z0-9_])/gi)].map((m) => m[1].toLowerCase()))].slice(0, 10);
    if (!names.length) return;
    const targets = await prisma.user.findMany({
      where: {
        username: { in: names },
        id: { not: senderId },
        memberships: { some: { roomId } },
        blocking: { none: { blockedId: senderId } },
      },
      select: { id: true },
    });
    for (const t of targets) {
      try {
        const n = await prisma.notification.create({
          data: { userId: t.id, type: 'MENTION', actorId: senderId, roomId, messageId, body: `${senderName} seni sohbette etiketledi: “${body.slice(0, 80)}”` },
        });
        bus.toUser(t.id, 'notification:new', n);
      } catch (e) {
        if (!isUniqueViolation(e)) throw e;
      }
    }
  } catch (e) {
    console.error('mention notify failed', e instanceof Error ? e.message : e);
  }
}

api.post('/rooms/:id/messages', async (req, res) => {
  const body = parse(z.object({ body: z.string(), kind: z.enum(['TEXT', 'CHEER']).default('TEXT') }), req.body);
  res.status(201).json({ message: await postMessage(uid(req), String(req.params.id), body.body, body.kind) });
});

export { requireMember };
