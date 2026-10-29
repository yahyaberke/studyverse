import { randomUUID } from 'node:crypto';
import { prisma } from '../db';
import { bus } from './bus';
import { presence } from './presence';

export type RoomEventType = 'join' | 'leave' | 'study_start' | 'break' | 'resume' | 'finish' | 'subject_change';

/**
 * Ephemeral room activity notifications. Generated only by the server from validated state
 * changes (clients cannot emit them), sent only to sockets currently in the room channel,
 * never to the actor, and never replayed on reconnect. Each event carries a unique id so
 * clients can drop duplicates. Failures are swallowed: notifications must never break
 * the study timer or room flow.
 */
export async function emitRoomEvent(roomId: string, actorId: string, type: RoomEventType, extra: { subject?: string | null } = {}) {
  try {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { displayName: true } });
    if (!actor) return;
    bus.toRoomExcept(roomId, actorId, 'room:event', {
      id: randomUUID(),
      type,
      roomId,
      actorId,
      actorName: actor.displayName,
      subject: extra.subject ?? null,
      at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('room event failed', e instanceof Error ? e.message : e);
  }
}

/** Session state events go to the room the user is currently present in (if any). */
export async function emitSessionEvent(userId: string, type: RoomEventType, subject?: string | null) {
  try {
    const roomId = await presence.store.currentRoom(userId);
    if (roomId) await emitRoomEvent(roomId, userId, type, { subject });
  } catch (e) {
    console.error('session event failed', e instanceof Error ? e.message : e);
  }
}

/**
 * Join/leave debouncing: a refresh or brief network drop (leave then re-join within the
 * grace window) produces no "left"/"joined" pair at all.
 */
const LEAVE_GRACE_MS = 8_000;
const pendingLeave = new Map<string, NodeJS.Timeout>();

export function userEnteredRoom(userId: string, roomId: string, wasPresent: boolean) {
  const key = `${userId}:${roomId}`;
  const pending = pendingLeave.get(key);
  if (pending) {
    clearTimeout(pending);
    pendingLeave.delete(key);
    return;
  }
  if (!wasPresent) void emitRoomEvent(roomId, userId, 'join');
}

export function userExitedRoom(userId: string, roomId: string) {
  const key = `${userId}:${roomId}`;
  if (pendingLeave.has(key)) return;
  pendingLeave.set(
    key,
    setTimeout(async () => {
      pendingLeave.delete(key);
      try {
        if (!(await presence.store.roomUsers(roomId)).includes(userId)) await emitRoomEvent(roomId, userId, 'leave');
      } catch {
        /* ignore */
      }
    }, LEAVE_GRACE_MS),
  );
}
