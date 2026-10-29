import type { Server } from 'socket.io';

/**
 * Thin indirection so domain services can push realtime events without importing the
 * socket server (avoids cycles and keeps services testable without sockets).
 * With the Redis adapter, these emits reach sockets on every instance.
 */
let io: Server | null = null;

type PresenceHook = (userId: string) => void;
let presenceHook: PresenceHook = () => {};

export function bindIo(server: Server) {
  io = server;
}

export function setPresenceHook(fn: PresenceHook) {
  presenceHook = fn;
}

export const bus = {
  toUser(userId: string, event: string, payload: unknown) {
    io?.to(`user:${userId}`).emit(event, payload);
  },
  toUsers(userIds: string[], event: string, payload: unknown) {
    if (!io || userIds.length === 0) return;
    io.to(userIds.map((id) => `user:${id}`)).emit(event, payload);
  },
  toRoom(roomId: string, event: string, payload: unknown) {
    io?.to(`room:${roomId}`).emit(event, payload);
  },
  /** Room channel minus every socket of `userId` (actors don't get notified of their own actions). */
  toRoomExcept(roomId: string, userId: string, event: string, payload: unknown) {
    io?.to(`room:${roomId}`).except(`user:${userId}`).emit(event, payload);
  },
  /** Forcefully remove a user's sockets from a room channel (kick / leave / ban). */
  removeUserFromRoom(userId: string, roomId: string) {
    io?.in(`user:${userId}`).socketsLeave(`room:${roomId}`);
  },
  disconnectLoginSession(sid: string) {
    io?.in(`sid:${sid}`).disconnectSockets(true);
  },
  disconnectUser(userId: string) {
    io?.in(`user:${userId}`).disconnectSockets(true);
  },
  /** Ask the presence layer to recompute + broadcast the user's status. */
  presenceChanged(userId: string) {
    presenceHook(userId);
  },
};
