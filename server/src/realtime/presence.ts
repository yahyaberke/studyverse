import type { ActivityStatus } from '@studyverse/shared';
import { prisma } from '../db';
import { bus, setPresenceHook } from './bus';
import { MemoryPresenceStore, type PresenceStore } from './presenceStore';

export const presence = {
  store: new MemoryPresenceStore() as PresenceStore,

  /** Derived from live sockets + the server-side session state (never from client claims). */
  async activityOf(userId: string): Promise<{ status: ActivityStatus; subject: string | null }> {
    if ((await this.store.socketCount(userId)) === 0) return { status: 'offline', subject: null };
    const s = await prisma.studySession.findUnique({ where: { openLock: userId }, include: { subject: true } });
    const status: ActivityStatus = s?.status === 'ACTIVE' ? 'studying' : s?.status === 'ON_BREAK' ? 'break' : 'idle';
    return { status, subject: s?.subject?.name ?? null };
  },

  /** Broadcast to the room channel the user is currently in. */
  async publish(userId: string, extraRoom?: string | null) {
    const room = await this.store.currentRoom(userId);
    const a = await this.activityOf(userId);
    const targets = new Set([room, extraRoom].filter(Boolean) as string[]);
    for (const r of targets) {
      const inRoom = r === room;
      bus.toRoom(r, 'room:presence', { userId, status: inRoom ? a.status : 'offline', subject: inRoom ? a.subject : null, inRoom });
    }
  },
};

setPresenceHook((userId) => void presence.publish(userId).catch((e) => console.error('presence publish failed', e)));
