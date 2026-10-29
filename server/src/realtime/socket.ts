import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { parse as parseCookie } from 'cookie';
import { Redis } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import { config } from '../config';
import { prisma } from '../db';
import { ACCESS_COOKIE, isFamilyActive, verifyAccessToken } from '../auth/tokens';
import { HttpError } from '../lib/errors';
import { bindIo } from './bus';
import { presence } from './presence';
import { RedisPresenceStore } from './presenceStore';
import * as sessions from '../services/sessions';
import { postMessage } from '../routes/api';
import { userEnteredRoom, userExitedRoom } from './roomEvents';

const OFFLINE_GRACE_MS = 8_000;

export function createSocketServer(http: HttpServer) {
  const io = new Server(http, {
    cors: { origin: config.clientOrigins, credentials: true },
    pingInterval: 20_000,
    pingTimeout: 20_000,
  });

  if (config.REDIS_URL) {
    const pub = new Redis(config.REDIS_URL);
    const sub = pub.duplicate();
    io.adapter(createAdapter(pub, sub));
    presence.store = new RedisPresenceStore(pub);
    console.log('🔴 Socket.IO Redis adapter + shared presence enabled');
  }
  bindIo(io);

  io.use(async (socket, next) => {
    const cookies = parseCookie(socket.handshake.headers.cookie ?? '');
    const token = (socket.handshake.auth?.token as string | undefined) ?? cookies[ACCESS_COOKIE];
    const claims = token ? verifyAccessToken(token) : null;
    if (!claims) return next(new Error('TOKEN_EXPIRED'));
    if (!(await isFamilyActive(claims.sid, claims.sub))) return next(new Error('SESSION_REVOKED'));
    socket.data.userId = claims.sub;
    socket.data.sid = claims.sid;
    next();
  });

  io.on('connection', async (socket) => {
    const userId: string = socket.data.userId;
    socket.join([`user:${userId}`, `sid:${socket.data.sid}`]);
    await presence.store.addSocket(userId, socket.id);
    let currentRoom: string | null = null;

    const ack = (cb: unknown, data: unknown) => typeof cb === 'function' && cb(data);
    const fail = (cb: unknown, e: unknown) =>
      ack(cb, { ok: false, error: e instanceof HttpError ? { code: e.code, message: e.message } : { code: 'ERROR', message: 'Bir hata oluştu.' } });

    socket.on('room:join', async (payload: { roomId?: unknown }, cb) => {
      try {
        const roomId = String(payload?.roomId ?? '');
        const m = await prisma.roomMember.findUnique({ where: { roomId_userId: { roomId, userId } } });
        if (!m) throw new HttpError(403, 'NOT_MEMBER', 'Bu odanın üyesi değilsin.');
        const prev = currentRoom;
        if (prev && prev !== roomId) socket.leave(`room:${prev}`);
        const wasPresent = (await presence.store.roomUsers(roomId)).includes(userId);
        socket.join(`room:${roomId}`);
        currentRoom = roomId;
        await presence.store.setSocketRoom(userId, socket.id, roomId);
        if (prev && prev !== roomId && !(await presence.store.roomUsers(prev)).includes(userId)) userExitedRoom(userId, prev);
        userEnteredRoom(userId, roomId, wasPresent);
        await prisma.roomMember.update({ where: { id: m.id }, data: { lastVisitedAt: new Date() } });
        await sessions.setSessionRoom(userId, roomId);
        await presence.publish(userId, prev);
        ack(cb, { ok: true });
      } catch (e) {
        fail(cb, e);
      }
    });

    socket.on('room:leave', async (_p, cb) => {
      const prev = currentRoom;
      if (prev) {
        socket.leave(`room:${prev}`);
        currentRoom = null;
        await presence.store.setSocketRoom(userId, socket.id, null);
        if (!(await presence.store.roomUsers(prev)).includes(userId)) userExitedRoom(userId, prev);
        if (!(await presence.store.currentRoom(userId))) await sessions.setSessionRoom(userId, null);
        await presence.publish(userId, prev);
      }
      ack(cb, { ok: true });
    });

    socket.on('chat:send', async (p: { roomId?: unknown; body?: unknown; kind?: unknown }, cb) => {
      try {
        const msg = await postMessage(userId, String(p?.roomId ?? ''), p?.body, p?.kind === 'CHEER' ? 'CHEER' : 'TEXT');
        ack(cb, { ok: true, message: msg });
      } catch (e) {
        fail(cb, e);
      }
    });

    socket.on('heartbeat', async () => {
      await presence.store.touch(userId, socket.id);
      await sessions.heartbeat(userId);
    });

    socket.on('disconnect', async () => {
      await presence.store.removeSocket(userId, socket.id);
      if (currentRoom) {
        if (!(await presence.store.roomUsers(currentRoom)).includes(userId)) userExitedRoom(userId, currentRoom);
        await presence.publish(userId, currentRoom);
      }
      // grace period: a refresh or brief network drop should not flash "offline"
      setTimeout(async () => {
        if ((await presence.store.socketCount(userId)) === 0) {
          await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }).catch(() => {});
        }
      }, OFFLINE_GRACE_MS);
    });

    await presence.publish(userId);
  });

  return io;
}
