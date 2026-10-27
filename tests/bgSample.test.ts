import { describe, it, expect } from 'vitest';
import { decodeBg3, sampleArenaColors, colorsKey, defaultArenaColors, BG_W, BG_H, ENEMY_PLATFORM } from '../src/render/battle/bgSample';
import { bgr555ToSrgb } from '../src/render/kit/palette';
import { ARENA_KINDS } from '../src/render/battle/arenaKind';

const bgr = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);
const BACK = bgr(26, 30, 26), LINE = bgr(28, 31, 26), TOP = bgr(22, 28, 18), FILL = bgr(15, 26, 16), RIM = bgr(21, 30, 14), DOT = bgr(17, 28, 16);
/** A synthetic battle background: top band, striped backdrop, the enemy platform (fill with dots, rim ring). */
function picture(): Uint16Array {
  const img = new Uint16Array(BG_W * BG_H);
  for (let y = 0; y < BG_H; y++) for (let x = 0; x < BG_W; x++) {
    const e = ((x - ENEMY_PLATFORM.cx) / ENEMY_PLATFORM.rx) ** 2 + ((y - ENEMY_PLATFORM.cy) / ENEMY_PLATFORM.ry) ** 2;
    img[y * BG_W + x] = y < 6 ? TOP : e <= 0.75 ? ((x * 7 + y * 3) % 23 === 0 ? DOT : FILL) : e <= 1 ? RIM : y % 4 === 0 ? LINE : BACK;
  }
  return img;
}

describe('sampleArenaColors', () => {
  it('finds the backdrop, its stripes, the top band and the platform colours', () => {
    const c = sampleArenaColors(picture())!;
    expect(c.backdrop).toEqual(bgr555ToSrgb(BACK));
    expect(c.stripe).toEqual(bgr555ToSrgb(LINE));
    expect(c.top).toEqual(bgr555ToSrgb(TOP));
    expect(c.platform).toEqual(bgr555ToSrgb(FILL));
    expect(c.platformDetail).toEqual(bgr555ToSrgb(DOT));
    expect(c.rim).toEqual(bgr555ToSrgb(RIM));
  });
  it('rejects a picture that is no battle background yet', () => {
    expect(sampleArenaColors(new Uint16Array(BG_W * BG_H))).toBeNull();            // black: BG3 not loaded
    expect(sampleArenaColors(new Uint16Array(BG_W * BG_H).fill(BACK))).toBeNull();   // one colour
  });
  it('keys colours by value and has a fallback for every kind', () => {
    expect(colorsKey(sampleArenaColors(picture())!)).toBe(colorsKey(sampleArenaColors(picture())!));
    expect(colorsKey(defaultArenaColors('grass'))).not.toBe(colorsKey(defaultArenaColors('sand')));
    for (const k of ARENA_KINDS) expect(defaultArenaColors(k).platform).toHaveLength(3);
  });
});

describe('decodeBg3', () => {
  it('decodes 4bpp tiles through the 64x32 tilemap with flips, palettes and the backdrop colour', () => {
    const vram = new Uint8Array(0x18000), pal = new Uint16Array(256);
    pal[0] = bgr(0, 0, 31); pal[2 * 16 + 1] = bgr(31, 0, 0);
    vram[0x8000 + 3 * 32] = 0x01;                       // tile 3 (char base 2): pixel (0,0) = colour 1
    vram[0xd000] = 3; vram[0xd001] = 0x20;              // entry (0,0): tile 3, palette 2
    vram[0xd002] = 3; vram[0xd003] = 0x24;              // entry (1,0): tile 3, h-flipped
    const img = decodeBg3(vram, pal, 0x5a0b);
    expect(img[0]).toBe(bgr(31, 0, 0));
    expect(img[1]).toBe(bgr(0, 0, 31));                 // transparent → backdrop
    expect(img[15]).toBe(bgr(31, 0, 0));                // flipped: its pixel 7
  });
  it('gives an 8bpp BG3 (never a battle background) the backdrop colour alone, which sampling rejects', () => {
    const vram = new Uint8Array(0x18000), pal = new Uint16Array(256);
    pal[0] = BACK; pal[2 * 16 + 1] = FILL;
    vram[0x8000 + 3 * 32] = 0x01; vram[0xd000] = 3; vram[0xd001] = 0x20;
    const img = decodeBg3(vram, pal, 0x5a0b | 0x80);
    expect(img.every((c) => c === BACK)).toBe(true);
    expect(sampleArenaColors(img)).toBeNull();
  });
});
