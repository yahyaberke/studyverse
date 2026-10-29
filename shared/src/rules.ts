/**
 * Progression rules. The server is the authority; the client only uses these to render progress bars.
 * Changing values here changes both. See docs/REWARDS.md.
 */
export const XP_RULES = {
  /** XP per fully focused minute */
  perFocusMinute: 1,
  /** Sessions shorter than this (focus seconds) earn nothing */
  minEligibleSeconds: 5 * 60,
  /** Bonus for sessions with >= 25 focused minutes */
  deepFocusBonusThresholdSeconds: 25 * 60,
  deepFocusBonus: 10,
  /** Bonus per completed pomodoro focus block */
  pomodoroBlockBonus: 5,
  /** Max XP from study sessions per user per UTC day */
  dailyStudyXpCap: 800,
  /** Min focus minutes in a local day for it to count towards the streak */
  streakMinMinutes: 10,
} as const;

/** Total XP required to reach `level` (level 1 = 0 XP). */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return 50 * level * (level - 1);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function levelProgress(xp: number) {
  const level = levelForXp(xp);
  const base = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, current: xp - base, needed: next - base, ratio: (xp - base) / (next - base) };
}

export interface AchievementDef {
  key: string;
  name: string;
  description: string;
  icon: string;
  xpReward: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { key: 'first_session', name: 'İlk Adım', description: 'İlk çalışma oturumunu tamamla (en az 5 dk).', icon: '🌱', xpReward: 20 },
  { key: 'hours_1', name: 'Isınma Turu', description: 'Toplam 1 saat çalış.', icon: '⏱️', xpReward: 25 },
  { key: 'hours_10', name: 'Kararlı', description: 'Toplam 10 saat çalış.', icon: '📘', xpReward: 75 },
  { key: 'hours_50', name: 'Kütüphane Kurdu', description: 'Toplam 50 saat çalış.', icon: '🐛', xpReward: 200 },
  { key: 'hours_100', name: 'Yüzler Kulübü', description: 'Toplam 100 saat çalış.', icon: '💯', xpReward: 400 },
  { key: 'marathon', name: 'Maraton', description: 'Tek oturumda 2 saat odaklan.', icon: '🏃', xpReward: 60 },
  { key: 'streak_3', name: 'Alev Aldı', description: '3 gün üst üste çalış.', icon: '🔥', xpReward: 30 },
  { key: 'streak_7', name: 'Haftanın Yıldızı', description: '7 gün üst üste çalış.', icon: '⭐', xpReward: 80 },
  { key: 'streak_30', name: 'Demir İrade', description: '30 gün üst üste çalış.', icon: '🛡️', xpReward: 300 },
  { key: 'early_bird', name: 'Erkenci Kuş', description: 'Sabah 07:00’den önce bir oturum başlat ve tamamla.', icon: '🐦', xpReward: 25 },
  { key: 'night_owl', name: 'Gece Kuşu', description: 'Gece 23:00’ten sonra bir oturum başlat ve tamamla.', icon: '🦉', xpReward: 25 },
  { key: 'pomodoro_4', name: 'Domates Hasadı', description: 'Bir günde 4 pomodoro bloğu tamamla.', icon: '🍅', xpReward: 40 },
  { key: 'daily_goal', name: 'Hedef Avcısı', description: 'Günlük hedefine ulaş.', icon: '🎯', xpReward: 30 },
  { key: 'social_3', name: 'Çalışma Arkadaşı', description: '3 arkadaş edin.', icon: '🤝', xpReward: 30 },
  { key: 'room_host', name: 'Ev Sahibi', description: 'Bir çalışma odası oluştur.', icon: '🏠', xpReward: 15 },
];
