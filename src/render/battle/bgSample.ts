// The battle background (BG3) as the GBA shows it, and the colours an arena takes from it. Every Emerald battle
// background is a pale striped backdrop with a darker band on top (rows 0–5) and the enemy platform as an ellipse
// centred (176, 64), radii ≈ 62 × 15: a fill colour with a few detail pixels inside a rim ring. Pure logic (no three.js).

import { bgr555ToSrgb, type RGB } from '../kit/palette';
import type { ArenaKind } from './arenaKind';

export const BG_W = 240, BG_H = 160;
export const ENEMY_PLATFORM = { cx: 176, cy: 64, rx: 62, ry: 15 };

/** BG3 as the GBA shows it at scroll 0: BGR555 per pixel, transparent pixels the backdrop colour pal[0]. `vram`: bus VRAM
 *  bytes; `pal`: ≥ 256 BG colours; `bgcnt`: BG3CNT (char base, screen base, screen size 1 = 64×32: tiles x ≥ 32 in the
 *  second 2 KB block). 4bpp only, as every battle background: with BGCNT bit 7 (8bpp) set the picture is the backdrop
 *  colour alone, which sampleArenaColors rejects (null). */
export function decodeBg3(vram: Uint8Array, pal: Uint16Array, bgcnt: number, out = new Uint16Array(BG_W * BG_H)): Uint16Array {
  const charBase = ((bgcnt >>> 2) & 3) * 0x4000;
  const screenBase = ((bgcnt >>> 8) & 31) * 0x800;
  const size = (bgcnt >>> 14) & 3;   // 0: 32×32, 1: 64×32, 2: 32×64, 3: 64×64 tiles, in 32×32 blocks of 2 KB
  const backdrop = pal[0] & 0x7fff;
  if (bgcnt & 0x80) return out.fill(backdrop, 0, BG_W * BG_H);
  for (let ty = 0; ty < BG_H / 8; ty++) {
    for (let tx = 0; tx < BG_W / 8; tx++) {
      const block = (size & 1 && tx >= 32 ? 1 : 0) + (size & 2 && ty >= 32 ? (size & 1 ? 2 : 1) : 0);
      const ea = screenBase + block * 0x800 + ((ty & 31) * 32 + (tx & 31)) * 2;
      const entry = ea + 1 < vram.length ? vram[ea] | (vram[ea + 1] << 8) : 0;
      const tile = charBase + (entry & 0x3ff) * 32;
      const hflip = (entry & 0x400) !== 0, vflip = (entry & 0x800) !== 0;
      const bank = (entry >>> 12) * 16;
      for (let py = 0; py < 8; py++) {
        const row = tile + (vflip ? 7 - py : py) * 4;
        const o = (ty * 8 + py) * BG_W + tx * 8;
        for (let px = 0; px < 8; px++) {
          const sx = hflip ? 7 - px : px;
          // BG tiles never come from OBJ VRAM (0x10000+): transparent there
          const byte = row + (sx >> 1) < 0x10000 ? vram[row + (sx >> 1)] : 0;
          const ci = sx & 1 ? byte >> 4 : byte & 15;
          out[o + px] = ci ? pal[bank + ci] & 0x7fff : backdrop;
        }
      }
    }
  }
  return out;
}

export interface ArenaColors { backdrop: RGB; stripe: RGB; top: RGB; platform: RGB; platformDetail: RGB; rim: RGB }

const ellipse = (x: number, y: number) =>
  ((x - ENEMY_PLATFORM.cx) / ENEMY_PLATFORM.rx) ** 2 + ((y - ENEMY_PLATFORM.cy) / ENEMY_PLATFORM.ry) ** 2;

/** Colours of the pixels `inside` selects, most frequent first. */
function ranked(img: Uint16Array, inside: (x: number, y: number) => boolean): number[] {
  const counts = new Map<number, number>();
  for (let y = 0; y < BG_H; y++) for (let x = 0; x < BG_W; x++) {
    if (!inside(x, y)) continue;
    const c = img[y * BG_W + x];
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([c]) => c);
}

/** Most frequent colours of: rows 0–5 (top), rows 10–44 (backdrop, second = stripe), the enemy ellipse's inner half
 *  (e ≤ 0.5: platform, second = detail) and its ring (0.7 ≤ e ≤ 1: rim; its second colour when the first is the fill).
 *  null when it is no battle background yet: platform and backdrop within 0.03 of each other (one colour, black). */
export function sampleArenaColors(img: Uint16Array): ArenaColors | null {
  const top = ranked(img, (_x, y) => y < 6), back = ranked(img, (_x, y) => y >= 10 && y < 45);
  const plat = ranked(img, (x, y) => ellipse(x, y) <= 0.5);
  const ring = ranked(img, (x, y) => { const e = ellipse(x, y); return e >= 0.7 && e <= 1; });
  const c = bgr555ToSrgb;
  const near = (a: number, b: number) => Math.max(...c(a).map((v, i) => Math.abs(v - c(b)[i]))) < 0.03;
  if (!top.length || !back.length || !plat.length || !ring.length || near(plat[0], back[0])) return null;
  const rim = ring[0] === plat[0] ? (ring[1] ?? ring[0]) : ring[0];
  return { backdrop: c(back[0]), stripe: c(back[1] ?? back[0]), top: c(top[0]), platform: c(plat[0]),
    platformDetail: c(plat[1] ?? plat[0]), rim: c(rim) };
}

/** Hand-picked approximations (sRGB hex: backdrop, top, platform, rim), not ROM data. */
const DEFAULTS: Readonly<Record<ArenaKind, string>> = {
  grass: 'e0f4dc b8e098 78cc80 a8e870',
  longGrass: 'b0e0b4 88c858 50a860 70d080',
  sand: 'f4f0c8 e8e080 d0cc60 e8e890',
  underwater: 'c8dcf8 98a8e8 8088c0 98c0f0',
  water: 'f4f4fc d0dcf0 5890d8 98d0ec',
  pond: 'f4f4fc dce4e4 60a0e0 a0f060',
  cavePond: 'f4f4fc dce4e4 60a0e0 a0f060',
  mountain: 'f4f4fc dce4e4 b8a888 d0d0a8',
  cave: 'c4a878 a88850 c8c060 a08858',
  building: 'f4f4f4 f0f0a0 d8c4a0 e8d8b0',
  plain: 'e4f8d0 a8d8f0 98e098 e0e090',
  gym: 'f4f4f4 d0bc94 ccbc94 dcd4a8',
  leader: 'f4f4f4 d0bc94 ccbc94 dcd4a8',
  frontier: 'f4f4fc dce4e4 bcbc9c d4d4c4',
  magma: 'ccc4d4 888888 dc6c08 98949c',
  aqua: 'cceef4 44a4d4 4484d4 84c4fc',
  sidney: 'c4ece4 44ac9c dcc494 f4dcac',
  phoebe: 'c4ece4 44ac9c c49ccc e4ccec',
  glacia: 'c4ece4 44ac9c 8cacec b4d4fc',
  drake: 'c4ece4 44ac9c f49c5c c4c4c4',
  champion: 'cceef4 44a4d4 44acac 84ecd4',
  groudon: 'ece4b4 d47420 dcd46c b49c6c',
  kyogre: 'ece4b4 ac8c54 5c94dc 94d4ec',
  rayquaza: 'e4f4fc a4d4fc dce4fc 94ccfc',
};

const hexRgb = (h: string): RGB => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;

/** Hand-picked fallbacks per kind (used until the live background is valid, and by the drift guard). */
export function defaultArenaColors(kind: ArenaKind): ArenaColors {
  const [backdrop, top, platform, rim] = DEFAULTS[kind].split(' ').map(hexRgb);
  return { backdrop, stripe: [...backdrop], top, platform, platformDetail: [...platform], rim };
}

/** The six colours, 3 decimals. */
export function colorsKey(c: ArenaColors): string {
  return [c.backdrop, c.stripe, c.top, c.platform, c.platformDetail, c.rim].map((v) => v.map((x) => x.toFixed(3)).join(',')).join(' ');
}
