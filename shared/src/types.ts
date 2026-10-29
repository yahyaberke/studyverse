export type ActivityStatus = 'studying' | 'break' | 'idle' | 'offline';

export type SessionStatus = 'ACTIVE' | 'ON_BREAK' | 'PAUSED' | 'COMPLETED';

export interface PresenceInfo {
  userId: string;
  status: ActivityStatus;
  /** Only present when the viewer is allowed to see it */
  roomId?: string | null;
  roomName?: string | null;
  subject?: string | null;
  since?: string | null;
}

export const ROOM_CATEGORIES = [
  'Genel',
  'Matematik',
  'Fen Bilimleri',
  'Yazılım',
  'Dil Öğrenme',
  'Tıp',
  'Hukuk',
  'Sınav Hazırlık',
  'Sanat & Tasarım',
  'Edebiyat',
] as const;

export const CHAT_MAX_LENGTH = 500;

export const CHEER_MESSAGES = [
  'Harika gidiyorsun! 💪',
  'Odaklan, başarabilirsin! 🎯',
  'Bir mola hak ettin ☕',
  'Birlikte daha güçlüyüz 📚',
  'Son düzlük, devam! 🚀',
] as const;
