import { z } from 'zod';

/**
 * Modular pixel-avatar system. All art is original and defined as 16x24 pixel maps.
 * Add a new option by appending an entry to the relevant catalog below — the editor,
 * server validation and unlock logic pick it up automatically.
 */

export const AVATAR_W = 16;
export const AVATAR_H = 24;

export type Unlock =
  | { kind: 'default' }
  | { kind: 'level'; level: number }
  | { kind: 'achievement'; key: string };

export interface CatalogItem {
  id: string;
  label: string;
  unlock: Unlock;
}

/** A pixel map positioned at row `top`; '.' is transparent, other chars map through a palette. */
interface PixelLayer {
  top: number;
  rows: string[];
}

const D: Unlock = { kind: 'default' };

export const SKIN_TONES: (CatalogItem & { base: string; shade: string })[] = [
  { id: 'porcelain', label: 'Porselen', base: '#fde3cf', shade: '#efc6ab', unlock: D },
  { id: 'peach', label: 'Şeftali', base: '#f6cba5', shade: '#e0ad84', unlock: D },
  { id: 'honey', label: 'Bal', base: '#dda274', shade: '#c4875a', unlock: D },
  { id: 'caramel', label: 'Karamel', base: '#b97a4f', shade: '#9d633c', unlock: D },
  { id: 'cocoa', label: 'Kakao', base: '#8a5634', shade: '#6f4227', unlock: D },
  { id: 'espresso', label: 'Espresso', base: '#5e3a24', shade: '#4a2c1a', unlock: D },
];

export const HAIR_COLORS: (CatalogItem & { base: string; shade: string })[] = [
  { id: 'black', label: 'Siyah', base: '#2b2530', shade: '#1a161d', unlock: D },
  { id: 'brown', label: 'Kahve', base: '#6b4430', shade: '#523220', unlock: D },
  { id: 'chestnut', label: 'Kestane', base: '#9a5a36', shade: '#7b4426', unlock: D },
  { id: 'blonde', label: 'Sarı', base: '#e9c46a', shade: '#cfa64b', unlock: D },
  { id: 'ginger', label: 'Kızıl', base: '#d9733b', shade: '#b85a28', unlock: D },
  { id: 'silver', label: 'Gümüş', base: '#d9d6e0', shade: '#b4b0bf', unlock: D },
  { id: 'pink', label: 'Pembe', base: '#f29bb8', shade: '#d77c9b', unlock: { kind: 'level', level: 3 } },
  { id: 'mint', label: 'Nane', base: '#8fd6b8', shade: '#6cb898', unlock: { kind: 'level', level: 5 } },
  { id: 'lavender', label: 'Lavanta', base: '#b9a3e3', shade: '#9a84c6', unlock: { kind: 'achievement', key: 'streak_3' } },
  { id: 'galaxy', label: 'Galaksi', base: '#4b5bd6', shade: '#3443b0', unlock: { kind: 'level', level: 10 } },
];

export const OUTFIT_COLORS: (CatalogItem & { primary: string; secondary: string })[] = [
  { id: 'cream', label: 'Krem', primary: '#f3e6cc', secondary: '#c9b48e', unlock: D },
  { id: 'sage', label: 'Adaçayı', primary: '#9cb88f', secondary: '#e9efe0', unlock: D },
  { id: 'sky', label: 'Gök', primary: '#7fb2e5', secondary: '#e6f0fa', unlock: D },
  { id: 'rose', label: 'Gül', primary: '#e48a9c', secondary: '#fbe3e8', unlock: D },
  { id: 'mustard', label: 'Hardal', primary: '#e2b04a', secondary: '#7a4f1c', unlock: D },
  { id: 'charcoal', label: 'Kömür', primary: '#4a4655', secondary: '#c9c5d3', unlock: D },
  { id: 'plum', label: 'Erik', primary: '#8a4f7d', secondary: '#f0d8ea', unlock: { kind: 'level', level: 2 } },
  { id: 'forest', label: 'Orman', primary: '#3f6e4f', secondary: '#e3c98a', unlock: { kind: 'level', level: 6 } },
  { id: 'gold', label: 'Altın', primary: '#f0c419', secondary: '#8a5a00', unlock: { kind: 'achievement', key: 'hours_10' } },
];

export const BASES: (CatalogItem & { ears?: PixelLayer })[] = [
  { id: 'human', label: 'İnsan', unlock: D },
  {
    id: 'cat',
    label: 'Kedi',
    unlock: D,
    ears: { top: 0, rows: ['....H......H....', '...HnH....HnH...'] },
  },
  {
    id: 'bear',
    label: 'Ayıcık',
    unlock: D,
    ears: { top: 1, rows: ['..HH........HH..', '..HH........HH..'] },
  },
  {
    id: 'bunny',
    label: 'Tavşan',
    unlock: { kind: 'level', level: 4 },
    ears: { top: 0, rows: ['....HH....HH....', '....Hn....nH....'] },
  },
];

export const HAIR_STYLES: (CatalogItem & { front: PixelLayer; back?: PixelLayer })[] = [
  {
    id: 'short',
    label: 'Kısa',
    unlock: D,
    front: {
      top: 1,
      rows: [
        '.....HHHHHH.....',
        '...HHHHHHHHHH...',
        '..HHHHHHHHHHHH..',
        '..HHHHHHHHHHHH..',
        '..HHH.HHHH.HHH..',
        '..HH........HH..',
        '..H..........H..',
      ],
    },
  },
  {
    id: 'bob',
    label: 'Küt',
    unlock: D,
    front: {
      top: 1,
      rows: [
        '....HHHHHHHH....',
        '...HHHHHHHHHH...',
        '..HHHHHHHHHHHH..',
        '..HHHHHHHHHHHH..',
        '..HHHHHHHHHHHH..',
        '..HHH......HHH..',
        '..HH........HH..',
        '..HH........HH..',
        '..HH........HH..',
        '..HHH......HHH..',
        '..hh........hh..',
      ],
    },
  },
  {
    id: 'long',
    label: 'Uzun',
    unlock: D,
    front: {
      top: 1,
      rows: [
        '....HHHHHHHH....',
        '...HHHHHHHHHH...',
        '..HHHHHHHHHHHH..',
        '..HHHHHHHHHHHH..',
        '..HHHHH..HHHHH..',
        '..HHH......HHH..',
        '..HH........HH..',
        '..HH........HH..',
        '..HH........HH..',
        '..HH........HH..',
      ],
    },
    back: {
      top: 10,
      rows: [
        '.HHH........HHH.',
        '.HHH........HHH.',
        '.HHHH......HHHH.',
        '.HHH........HHH.',
        '.HH..........HH.',
        '.HH..........HH.',
        '.hh..........hh.',
      ],
    },
  },
  {
    id: 'spiky',
    label: 'Dikenli',
    unlock: D,
    front: {
      top: 0,
      rows: [
        '...H..H..H..H...',
        '...HH.HH.HH.HH..',
        '..HHHHHHHHHHHH..',
        '..HHHHHHHHHHHH..',
        '..HHHHHHHHHHHH..',
        '..HH.HH.HH.HHH..',
        '..H..........H..',
      ],
    },
  },
  {
    id: 'bun',
    label: 'Topuz',
    unlock: D,
    front: {
      top: 0,
      rows: [
        '......HHHH......',
        '.....HhhhhH.....',
        '...HHHHHHHHHH...',
        '..HHHHHHHHHHHH..',
        '..HHHHHHHHHHHH..',
        '..HHH......HHH..',
        '..HH........HH..',
      ],
    },
  },
  {
    id: 'curly',
    label: 'Kıvırcık',
    unlock: D,
    front: {
      top: 0,
      rows: [
        '....H.HH.HH.H...',
        '...HHHHHHHHHHH..',
        '..HHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHHHHHHHHHHHH.',
        '.HHHH.HHHH.HHHH.',
        '.HHH........HHH.',
        '.HH..........HH.',
        '.HH..........HH.',
        '..H..........H..',
      ],
    },
  },
  {
    id: 'ponytail',
    label: 'At Kuyruğu',
    unlock: { kind: 'level', level: 2 },
    front: {
      top: 1,
      rows: [
        '.....HHHHHH.....',
        '...HHHHHHHHHH...',
        '..HHHHHHHHHHHH..',
        '..HHHHHHHHHHHHH.',
        '..HHH......HHHHH',
        '..HH........HHHH',
        '..H..........HHH',
        '..............HH',
        '..............hH',
        '..............h.',
      ],
    },
  },
  {
    id: 'buzz',
    label: 'Asker',
    unlock: D,
    front: { top: 2, rows: ['....hhhhhhhh....', '...hhhhhhhhhh...', '...hhhhhhhhhh...'] },
  },
];

export const OUTFIT_STYLES: (CatalogItem & { layer: PixelLayer })[] = [
  {
    id: 'tee',
    label: 'Tişört',
    unlock: D,
    layer: {
      top: 12,
      rows: [
        '....PPPSSPPP....',
        '...PPPPPPPPPP...',
        '..PPPPPPPPPPPP..',
        '..KPPPPPPPPPPK..',
        '..KPPPPPPPPPPK..',
        '..KPPPPPPPPPPK..',
        '....PPPPPPPP....',
      ],
    },
  },
  {
    id: 'hoodie',
    label: 'Kapüşonlu',
    unlock: D,
    layer: {
      top: 12,
      rows: [
        '...PPPPPPPPPP...',
        '..PPPPSPPSPPPP..',
        '..PPPPSPPSPPPP..',
        '..PPPPPPPPPPPP..',
        '..PPPSSSSSSPPP..',
        '..KPPSSSSSSPPK..',
        '....PPPPPPPP....',
      ],
    },
  },
  {
    id: 'sweater',
    label: 'Çizgili Kazak',
    unlock: D,
    layer: {
      top: 12,
      rows: [
        '....PPPPPPPP....',
        '...SSSSSSSSSS...',
        '..PPPPPPPPPPPP..',
        '..SSSSSSSSSSSS..',
        '..PPPPPPPPPPPP..',
        '..KSSSSSSSSSSK..',
        '....PPPPPPPP....',
      ],
    },
  },
  {
    id: 'overalls',
    label: 'Salopet',
    unlock: { kind: 'level', level: 3 },
    layer: {
      top: 12,
      rows: [
        '....SSSSSSSS....',
        '...SPSSSSSSPS...',
        '..SSPSSSSSSPSS..',
        '..SSPPPPPPPPSS..',
        '..SSPPPYYPPPSS..',
        '..KSPPPPPPPPSK..',
        '....PPPPPPPP....',
      ],
    },
  },
  {
    id: 'jacket',
    label: 'Ceket',
    unlock: D,
    layer: {
      top: 12,
      rows: [
        '....PPSSSSPP....',
        '...PPPSSSSPPP...',
        '..PPPPSSSSPPPP..',
        '..PPPPSSSSPPPP..',
        '..PPPPSSSSPPPP..',
        '..KPPPSSSSPPPK..',
        '....PPPSSPPP....',
      ],
    },
  },
];

export const ACCESSORIES: (CatalogItem & { layer?: PixelLayer; colors?: Record<string, string> })[] = [
  { id: 'none', label: 'Yok', unlock: D },
  {
    id: 'glasses',
    label: 'Gözlük',
    unlock: D,
    colors: { G: '#2d2a35', g: 'rgba(190,225,255,0.35)' },
    layer: {
      top: 6,
      rows: ['....GGG..GGG....', '...GgggGGgggG...', '...Gggg..gggG...', '....GGG..GGG....'],
    },
  },
  {
    id: 'headphones',
    label: 'Kulaklık',
    unlock: D,
    colors: { G: '#3a3646', C: '#e07a5f' },
    layer: {
      top: 1,
      rows: [
        '....GGGGGGGG....',
        '...G........G...',
        '..G..........G..',
        '..G..........G..',
        '..G..........G..',
        '.CC..........CC.',
        '.CC..........CC.',
        '.CC..........CC.',
      ],
    },
  },
  {
    id: 'beanie',
    label: 'Bere',
    unlock: D,
    colors: { C: '#c0504d', c: '#f2e1c9' },
    layer: { top: 0, rows: ['.......CC.......', '.....CCCCCC.....', '...CCCCCCCCCC...', '..CCCCCCCCCCCC..', '..cccccccccccc..'] },
  },
  {
    id: 'cap',
    label: 'Şapka',
    unlock: { kind: 'level', level: 2 },
    colors: { C: '#3d6fb6', c: '#2a5290' },
    layer: { top: 1, rows: ['.....CCCCCC.....', '...CCCCCCCCCC...', '..CCCCCCCCCCCC..', '..cccccccccccccc'] },
  },
  {
    id: 'bow',
    label: 'Fiyonk',
    unlock: D,
    colors: { C: '#ef6f9a', c: '#c94d78' },
    layer: { top: 1, rows: ['..........C.C...', '..........CcC...', '..........C.C...'] },
  },
  {
    id: 'flower',
    label: 'Çiçek',
    unlock: { kind: 'level', level: 3 },
    colors: { C: '#f7f3e8', c: '#f2c14e' },
    layer: { top: 2, rows: ['...........C....', '..........CcC...', '...........C....'] },
  },
  {
    id: 'star',
    label: 'Yıldız Toka',
    unlock: { kind: 'level', level: 5 },
    colors: { C: '#f6d04d', c: '#fff6c2' },
    layer: { top: 3, rows: ['..C.............', '.CcC............', '..C.............'] },
  },
  {
    id: 'scarf',
    label: 'Atkı',
    unlock: { kind: 'achievement', key: 'streak_3' },
    colors: { C: '#5a9e8f', c: '#3f7d70' },
    layer: { top: 11, rows: ['....CCCCCCCC....', '...CCCCCCCCCC...', '.........cc.....', '.........cc.....'] },
  },
  {
    id: 'wizard',
    label: 'Büyücü Şapkası',
    unlock: { kind: 'achievement', key: 'streak_7' },
    colors: { C: '#5b4b9a', c: '#f6d04d' },
    layer: { top: 0, rows: ['.......CC.......', '......CCCC......', '.....CCcCCC.....', '....CCCCCCCC....', '..cccccccccccc..'] },
  },
  {
    id: 'crown',
    label: 'Taç',
    unlock: { kind: 'level', level: 8 },
    colors: { C: '#f2c230', c: '#e0525a' },
    layer: { top: 0, rows: ['...C...CC...C...', '...CC.CCCC.CC...', '...CcCCCCCCcC...', '...CCCCCCCCCC...'] },
  },
];

/** Items placed on the user's desk in rooms. Rendered by the client room scene. */
export const DESK_ITEMS: CatalogItem[] = [
  { id: 'plant', label: 'Saksı Bitkisi', unlock: D },
  { id: 'mug', label: 'Kupa', unlock: D },
  { id: 'books', label: 'Kitap Yığını', unlock: D },
  { id: 'lamp', label: 'Masa Lambası', unlock: { kind: 'level', level: 2 } },
  { id: 'cactus', label: 'Kaktüs', unlock: { kind: 'level', level: 3 } },
  { id: 'cat', label: 'Uyuyan Kedi', unlock: { kind: 'level', level: 6 } },
  { id: 'globe', label: 'Küre', unlock: { kind: 'achievement', key: 'hours_10' } },
  { id: 'trophy', label: 'Kupa Ödülü', unlock: { kind: 'achievement', key: 'streak_7' } },
];

/** Room themes; owners can pick themes they have unlocked. */
export const ROOM_THEMES: (CatalogItem & { wall: string; floor: string; accent: string; window: string })[] = [
  { id: 'cozy', label: 'Sıcak Ahşap', wall: '#f1dcc0', floor: '#b98458', accent: '#d97a4a', window: '#9fd3f2', unlock: D },
  { id: 'mint', label: 'Nane Kafe', wall: '#d9efe4', floor: '#a7896b', accent: '#4f9d84', window: '#b7e4f7', unlock: D },
  { id: 'night', label: 'Gece Çalışması', wall: '#3b3a5c', floor: '#5a4a6b', accent: '#f6c86b', window: '#1d2147', unlock: { kind: 'level', level: 4 } },
  { id: 'sakura', label: 'Sakura', wall: '#fbe4ea', floor: '#c99a85', accent: '#e57b9a', window: '#ffd6e2', unlock: { kind: 'level', level: 8 } },
  { id: 'library', label: 'Eski Kütüphane', wall: '#6e4b3a', floor: '#4a3226', accent: '#e2b04a', window: '#d2e6f0', unlock: { kind: 'achievement', key: 'hours_10' } },
];

export const AVATAR_SLOTS = {
  base: BASES,
  skinTone: SKIN_TONES,
  hairStyle: HAIR_STYLES,
  hairColor: HAIR_COLORS,
  outfitStyle: OUTFIT_STYLES,
  outfitColor: OUTFIT_COLORS,
  accessory: ACCESSORIES,
  deskItem: DESK_ITEMS,
} as const;

export type AvatarSlot = keyof typeof AVATAR_SLOTS;

const ids = <T extends { id: string }>(list: readonly T[]) => list.map((i) => i.id) as [string, ...string[]];

export const avatarConfigSchema = z.object({
  base: z.enum(ids(BASES)),
  skinTone: z.enum(ids(SKIN_TONES)),
  hairStyle: z.enum(ids(HAIR_STYLES)),
  hairColor: z.enum(ids(HAIR_COLORS)),
  outfitStyle: z.enum(ids(OUTFIT_STYLES)),
  outfitColor: z.enum(ids(OUTFIT_COLORS)),
  accessory: z.enum(ids(ACCESSORIES)),
  deskItem: z.enum(ids(DESK_ITEMS)),
});

export type AvatarConfig = z.infer<typeof avatarConfigSchema>;

export const DEFAULT_AVATAR: AvatarConfig = {
  base: 'human',
  skinTone: 'peach',
  hairStyle: 'short',
  hairColor: 'brown',
  outfitStyle: 'hoodie',
  outfitColor: 'sage',
  accessory: 'none',
  deskItem: 'plant',
};

export const AVATAR_PRESETS: { id: string; label: string; config: AvatarConfig }[] = [
  { id: 'scholar', label: 'Kitap Kurdu', config: { base: 'human', skinTone: 'peach', hairStyle: 'bob', hairColor: 'black', outfitStyle: 'sweater', outfitColor: 'rose', accessory: 'glasses', deskItem: 'books' } },
  { id: 'coder', label: 'Kodcu', config: { base: 'human', skinTone: 'caramel', hairStyle: 'spiky', hairColor: 'brown', outfitStyle: 'hoodie', outfitColor: 'charcoal', accessory: 'headphones', deskItem: 'mug' } },
  { id: 'kitty', label: 'Kedicik', config: { base: 'cat', skinTone: 'porcelain', hairStyle: 'long', hairColor: 'ginger', outfitStyle: 'tee', outfitColor: 'cream', accessory: 'bow', deskItem: 'plant' } },
  { id: 'bear', label: 'Ayıcık', config: { base: 'bear', skinTone: 'honey', hairStyle: 'curly', hairColor: 'chestnut', outfitStyle: 'jacket', outfitColor: 'mustard', accessory: 'none', deskItem: 'mug' } },
  { id: 'winter', label: 'Kış Çocuğu', config: { base: 'human', skinTone: 'cocoa', hairStyle: 'bun', hairColor: 'black', outfitStyle: 'sweater', outfitColor: 'sky', accessory: 'beanie', deskItem: 'books' } },
  { id: 'calm', label: 'Sakin', config: { base: 'human', skinTone: 'espresso', hairStyle: 'buzz', hairColor: 'black', outfitStyle: 'tee', outfitColor: 'sage', accessory: 'glasses', deskItem: 'plant' } },
];

export function cosmeticKey(slot: string, id: string) {
  return `${slot}:${id}`;
}

export interface UnlockContext {
  level: number;
  achievements: ReadonlySet<string>;
}

export function isUnlocked(unlock: Unlock, ctx: UnlockContext): boolean {
  if (unlock.kind === 'default') return true;
  if (unlock.kind === 'level') return ctx.level >= unlock.level;
  return ctx.achievements.has(unlock.key);
}

/** All non-default cosmetic keys the context qualifies for (used by the server to grant inventory). */
export function eligibleCosmeticKeys(ctx: UnlockContext): string[] {
  const out: string[] = [];
  const all: [string, readonly CatalogItem[]][] = [...Object.entries(AVATAR_SLOTS), ['roomTheme', ROOM_THEMES]];
  for (const [slot, list] of all) {
    for (const item of list) {
      if (item.unlock.kind !== 'default' && isUnlocked(item.unlock, ctx)) out.push(cosmeticKey(slot, item.id));
    }
  }
  return out;
}

/** Returns the first slot whose chosen item is locked for the given inventory, or null. */
export function findLockedChoice(config: AvatarConfig, owned: ReadonlySet<string>): string | null {
  for (const [slot, list] of Object.entries(AVATAR_SLOTS)) {
    const id = config[slot as AvatarSlot];
    const item = (list as readonly CatalogItem[]).find((i) => i.id === id);
    if (!item) return slot;
    if (item.unlock.kind !== 'default' && !owned.has(cosmeticKey(slot, id))) return slot;
  }
  return null;
}

export type AvatarPose = 'idle' | 'studying' | 'break' | 'offline';

const FACES: Record<AvatarPose, PixelLayer> = {
  idle: { top: 7, rows: ['.....E....E.....', '.....E....E.....', '....B..MM..B....'] },
  studying: { top: 7, rows: ['................', '.....EE..EE.....', '....B...M..B....'] },
  break: { top: 7, rows: ['.....E....E.....', '....E.E..E.E....', '....B..MM..B....', '.......MM.......'] },
  offline: { top: 8, rows: ['....EEE..EEE....', '....B...M..B....'] },
};

const HEAD: PixelLayer = {
  top: 2,
  rows: [
    '....KKKKKKKK....',
    '...KKKKKKKKKK...',
    '...KKKKKKKKKK...',
    '...KKKKKKKKKK...',
    '...KKKKKKKKKK...',
    '...KKKKKKKKKK...',
    '...KKKKKKKKKK...',
    '...KKKKKKKKKK...',
    '....KKKKKKKK....',
    '......kkkk......',
  ],
};

const LEGS: PixelLayer = {
  top: 19,
  rows: ['....LLLLLLLL....', '....LLL..LLL....', '....LLL..LLL....', '....OOO..OOO....'],
};

export interface Pixel {
  x: number;
  y: number;
  c: string;
}

function paint(grid: (string | null)[][], layer: PixelLayer | undefined, palette: Record<string, string>) {
  if (!layer) return;
  layer.rows.forEach((row, dy) => {
    const y = layer.top + dy;
    if (y < 0 || y >= AVATAR_H) return;
    for (let x = 0; x < AVATAR_W && x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const color = palette[ch];
      if (color) grid[y][x] = color;
    }
  });
}

/** Composes an avatar into a flat list of pixels. Unknown ids fall back to defaults. */
export function composeAvatar(config: Partial<AvatarConfig>, pose: AvatarPose = 'idle'): Pixel[] {
  const pick = <T extends { id: string }>(list: readonly T[], id: string | undefined, fallback: string) =>
    list.find((i) => i.id === id) ?? list.find((i) => i.id === fallback)!;
  const skin = pick(SKIN_TONES, config.skinTone, DEFAULT_AVATAR.skinTone);
  const hairColor = pick(HAIR_COLORS, config.hairColor, DEFAULT_AVATAR.hairColor);
  const hair = pick(HAIR_STYLES, config.hairStyle, DEFAULT_AVATAR.hairStyle);
  const outfit = pick(OUTFIT_STYLES, config.outfitStyle, DEFAULT_AVATAR.outfitStyle);
  const outfitColor = pick(OUTFIT_COLORS, config.outfitColor, DEFAULT_AVATAR.outfitColor);
  const base = pick(BASES, config.base, DEFAULT_AVATAR.base);
  const acc = pick(ACCESSORIES, config.accessory, 'none');

  const grid: (string | null)[][] = Array.from({ length: AVATAR_H }, () => Array(AVATAR_W).fill(null));
  const hairPal = { H: hairColor.base, h: hairColor.shade, n: '#f4a7b9' };
  const bodyPal = { P: outfitColor.primary, S: outfitColor.secondary, K: skin.base, Y: '#f2c14e' };

  paint(grid, hair.back, hairPal);
  paint(grid, LEGS, { L: '#3d4463', O: '#6b4a3a' });
  paint(grid, outfit.layer, bodyPal);
  paint(grid, HEAD, { K: skin.base, k: skin.shade });
  paint(grid, base.ears, hairPal);
  paint(grid, FACES[pose], { E: '#2a2230', M: pose === 'break' ? '#b5485d' : '#8c4a50', B: 'rgba(240,120,130,0.45)' });
  paint(grid, hair.front, hairPal);
  paint(grid, acc.layer, acc.colors ?? {});

  const out: Pixel[] = [];
  grid.forEach((row, y) => row.forEach((c, x) => c && out.push({ x, y, c })));
  return out;
}
