import { Redis } from 'ioredis';

/**
 * Tracks live sockets per user and which room channel each socket is in.
 * A user is online while at least one non-stale socket exists, so closing one tab
 * (or one device) does not mark the user offline.
 */
export interface PresenceStore {
  addSocket(userId: string, socketId: string): Promise<void>;
  removeSocket(userId: string, socketId: string): Promise<void>;
  setSocketRoom(userId: string, socketId: string, roomId: string | null): Promise<void>;
  touch(userId: string, socketId: string): Promise<void>;
  socketCount(userId: string): Promise<number>;
  onlineUsers(userIds: string[]): Promise<Set<string>>;
  /** Most recently joined room among the user's sockets */
  currentRoom(userId: string): Promise<string | null>;
  roomUsers(roomId: string): Promise<string[]>;
  roomCounts(roomIds: string[]): Promise<Map<string, number>>;
}

/** Socket entries older than this without a touch are considered dead (crashed instance). */
export const SOCKET_STALE_MS = 90_000;

interface SocketEntry {
  roomId: string | null;
  joinedRoomAt: number;
  seenAt: number;
}

export class MemoryPresenceStore implements PresenceStore {
  private users = new Map<string, Map<string, SocketEntry>>();

  private live(userId: string) {
    const m = this.users.get(userId);
    if (!m) return [];
    const now = Date.now();
    for (const [sid, e] of m) if (now - e.seenAt > SOCKET_STALE_MS) m.delete(sid);
    if (m.size === 0) this.users.delete(userId);
    return [...m.values()];
  }

  async addSocket(userId: string, socketId: string) {
    const m = this.users.get(userId) ?? new Map();
    m.set(socketId, { roomId: null, joinedRoomAt: 0, seenAt: Date.now() });
    this.users.set(userId, m);
  }
  async removeSocket(userId: string, socketId: string) {
    const m = this.users.get(userId);
    m?.delete(socketId);
    if (m && m.size === 0) this.users.delete(userId);
  }
  async setSocketRoom(userId: string, socketId: string, roomId: string | null) {
    const e = this.users.get(userId)?.get(socketId);
    if (e) {
      e.roomId = roomId;
      e.joinedRoomAt = Date.now();
      e.seenAt = Date.now();
    }
  }
  async touch(userId: string, socketId: string) {
    const e = this.users.get(userId)?.get(socketId);
    if (e) e.seenAt = Date.now();
  }
  async socketCount(userId: string) {
    return this.live(userId).length;
  }
  async onlineUsers(userIds: string[]) {
    return new Set(userIds.filter((id) => this.live(id).length > 0));
  }
  async currentRoom(userId: string) {
    const withRoom = this.live(userId).filter((e) => e.roomId);
    withRoom.sort((a, b) => b.joinedRoomAt - a.joinedRoomAt);
    return withRoom[0]?.roomId ?? null;
  }
  async roomUsers(roomId: string) {
    const out: string[] = [];
    for (const userId of [...this.users.keys()]) if (this.live(userId).some((e) => e.roomId === roomId)) out.push(userId);
    return out;
  }
  async roomCounts(roomIds: string[]) {
    const counts = new Map<string, number>(roomIds.map((r) => [r, 0]));
    for (const userId of [...this.users.keys()]) {
      const rooms = new Set(this.live(userId).map((e) => e.roomId));
      for (const r of rooms) if (r && counts.has(r)) counts.set(r, counts.get(r)! + 1);
    }
    return counts;
  }
}

/**
 * Redis-backed store shared by all instances.
 *  pres:u:<userId>  hash socketId -> JSON SocketEntry
 *  pres:r:<roomId>  hash userId:socketId -> seenAt
 */
export class RedisPresenceStore implements PresenceStore {
  constructor(private redis: Redis) {}

  private async entries(userId: string) {
    const raw = await this.redis.hgetall(`pres:u:${userId}`);
    const now = Date.now();
    const out: [string, SocketEntry][] = [];
    const dead: string[] = [];
    for (const [sid, json] of Object.entries(raw)) {
      const e = JSON.parse(json) as SocketEntry;
      if (now - e.seenAt > SOCKET_STALE_MS) dead.push(sid);
      else out.push([sid, e]);
    }
    if (dead.length) await this.redis.hdel(`pres:u:${userId}`, ...dead);
    return out;
  }

  async addSocket(userId: string, socketId: string) {
    const e: SocketEntry = { roomId: null, joinedRoomAt: 0, seenAt: Date.now() };
    await this.redis.multi().hset(`pres:u:${userId}`, socketId, JSON.stringify(e)).expire(`pres:u:${userId}`, 3600).exec();
  }
  async removeSocket(userId: string, socketId: string) {
    const raw = await this.redis.hget(`pres:u:${userId}`, socketId);
    const m = this.redis.multi().hdel(`pres:u:${userId}`, socketId);
    if (raw) {
      const e = JSON.parse(raw) as SocketEntry;
      if (e.roomId) m.hdel(`pres:r:${e.roomId}`, `${userId}:${socketId}`);
    }
    await m.exec();
  }
  async setSocketRoom(userId: string, socketId: string, roomId: string | null) {
    const raw = await this.redis.hget(`pres:u:${userId}`, socketId);
    if (!raw) return;
    const prev = JSON.parse(raw) as SocketEntry;
    const e: SocketEntry = { roomId, joinedRoomAt: Date.now(), seenAt: Date.now() };
    const m = this.redis.multi().hset(`pres:u:${userId}`, socketId, JSON.stringify(e));
    if (prev.roomId) m.hdel(`pres:r:${prev.roomId}`, `${userId}:${socketId}`);
    if (roomId) m.hset(`pres:r:${roomId}`, `${userId}:${socketId}`, String(Date.now())).expire(`pres:r:${roomId}`, 3600);
    await m.exec();
  }
  async touch(userId: string, socketId: string) {
    const raw = await this.redis.hget(`pres:u:${userId}`, socketId);
    if (!raw) return;
    const e = JSON.parse(raw) as SocketEntry;
    e.seenAt = Date.now();
    const m = this.redis.multi().hset(`pres:u:${userId}`, socketId, JSON.stringify(e)).expire(`pres:u:${userId}`, 3600);
    if (e.roomId) m.hset(`pres:r:${e.roomId}`, `${userId}:${socketId}`, String(e.seenAt)).expire(`pres:r:${e.roomId}`, 3600);
    await m.exec();
  }
  async socketCount(userId: string) {
    return (await this.entries(userId)).length;
  }
  async onlineUsers(userIds: string[]) {
    const out = new Set<string>();
    await Promise.all(userIds.map(async (id) => ((await this.socketCount(id)) > 0 ? out.add(id) : null)));
    return out;
  }
  async currentRoom(userId: string) {
    const withRoom = (await this.entries(userId)).map(([, e]) => e).filter((e) => e.roomId);
    withRoom.sort((a, b) => b.joinedRoomAt - a.joinedRoomAt);
    return withRoom[0]?.roomId ?? null;
  }
  async roomUsers(roomId: string) {
    const raw = await this.redis.hgetall(`pres:r:${roomId}`);
    const now = Date.now();
    const users = new Set<string>();
    const dead: string[] = [];
    for (const [field, ts] of Object.entries(raw)) {
      if (now - Number(ts) > SOCKET_STALE_MS) dead.push(field);
      else users.add(field.split(':')[0]);
    }
    if (dead.length) await this.redis.hdel(`pres:r:${roomId}`, ...dead);
    return [...users];
  }
  async roomCounts(roomIds: string[]) {
    const out = new Map<string, number>();
    await Promise.all(roomIds.map(async (r) => out.set(r, (await this.roomUsers(r)).length)));
    return out;
  }
}
