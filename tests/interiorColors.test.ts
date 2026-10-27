// Interior part colours (Phase 4 Task 5): main / second / accent / dark of a part's metatiles, a back wall's shell
// colours, a floor's tint.
import { describe, it, expect } from 'vitest';
import { colorInfo, partColors, wallColors, floorLook } from '../src/render/kit/interior/colors';
import { roomLayout } from '../src/render/kit/interior/room';
import { furnitureFamilyWith, type FurnitureOut, type FurniturePiece } from '../src/render/kit/interior/furniture';
import { floorCells, floorTint } from '../src/render/kit/interior/geom/floorPatterns';
import { Claims } from '../src/render/overworld/claims';
import { NO_EVENTS } from '../src/render/kit/events';
import type { TileInfo } from '../src/render/overworld/tileInfo';
import { bgr555ToSrgb, mix, scale, soften } from '../src/render/kit/palette';
import { fakeInfo } from './helpers/fakeMap';
import { fakeInterior } from './helpers/fakeInterior';

const c555 = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);
const RED = c555(31, 4, 4), BROWN = c555(18, 10, 4), TAN = c555(28, 24, 16), OUTLINE = c555(2, 2, 3);

/** Metatile 0x230: rows 0–2 red (48 px), rows 3–11 brown but column 0 (135 px), rows 12–15 tan but column 0 (60 px),
 *  column 0 of rows 3–15 outline (13 px). */
function paint(px: Uint16Array, m: number) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      px[m * 256 + y * 16 + x] = y < 3 ? RED : x === 0 ? OUTLINE : y < 12 ? BROWN : TAN;
    }
  }
}
const info = fakeInfo();
paint(info.both, 0x230); paint(info.bottom, 0x230);
const plainInfo = fakeInfo();
plainInfo.both.fill(BROWN, 0x231 * 256, 0x232 * 256);
plainInfo.bottom.fill(BROWN, 0x231 * 256, 0x232 * 256);

// FW-A's root cause: live VRAM holds a tile animation's current frame (the Building TV every 8 frames), so a room built on
// another frame took other colours. The kit samples colorInfo(a): the tilesets' static tiles (opts.colorInfo, the live
// renderer's romTileVram analysis), else the analysed tiles.
describe('the colour source', () => {
  const ROOM = ['        ', ' WWWFWW ', ' WWWFWW ', ' ...... ', ' ...... ', '        '];
  /** A fridge (0x20a) red, the walls (0x201) tan, the boards (0x205) brown; the rest as `base`. */
  const painted = (base: TileInfo): TileInfo => {
    const t: TileInfo = { ...base, both: base.both.slice(), bottom: base.bottom.slice() };
    for (const [m, c] of [[0x20a, RED], [0x201, TAN], [0x205, BROWN]]) { t.both.fill(c, m * 256, m * 256 + 256); t.bottom.fill(c, m * 256, m * 256 + 256); }
    return t;
  };
  const sample = (useStatic: boolean) => {
    const { a, ids } = fakeInterior(ROOM);
    const live = painted(a.info);
    live.both.fill(OUTLINE, 0x20a * 256, 0x20a * 256 + 128);       // the live frame: half the fridge another colour
    const statics = painted(a.info);
    (a as { info: TileInfo }).info = live;
    if (useStatic) a.opts.colorInfo = statics;
    const L = roomLayout(a, ids, []);
    const stub = (p: FurniturePiece, o: FurnitureOut) => o.low.quad([0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1], [0, 1, 0], p.colors.main);
    const pieces = furnitureFamilyWith({ fridge: stub }).extract({ a, events: NO_EVENTS, quality: 'medium' }, new Claims(a.N));
    const floor = floorCells(a, ids, L, new Claims(a.N));
    return { a, statics, live, fridge: pieces[0].colors, wall: wallColors(a, L, ids).wall, floor: floor[0].tint };
  };
  it('samples the static tiles when the analysis carries them', () => {
    const s = sample(true);
    expect(colorInfo(s.a)).toBe(s.statics);
    expect(s.fridge).toEqual(partColors(s.statics, [0x20a, 0x20a]));
    expect(s.fridge).not.toEqual(partColors(s.live, [0x20a, 0x20a]));
    expect(s.wall).toEqual(soften(bgr555ToSrgb(TAN)));
    expect(s.floor).toEqual(floorTint(s.statics, 0x205));
  });
  it('samples the analysed tiles otherwise (a static preview: they are the ROM\'s)', () => {
    const s = sample(false);
    expect(colorInfo(s.a)).toBe(s.live);
    expect(s.fridge).toEqual(partColors(s.live, [0x20a, 0x20a]));
  });
});

describe('part colours', () => {
  it('takes main, second, accent and dark colours', () => {
    const c = partColors(info, [0x230]);
    expect(c).toEqual({ main: bgr555ToSrgb(BROWN), second: bgr555ToSrgb(TAN), accent: bgr555ToSrgb(RED), dark: bgr555ToSrgb(OUTLINE) });
  });
  it('falls back when a part has no accent or no outline', () => {
    const c = partColors(plainInfo, [0x231]);            // one colour only
    expect(c.second).toEqual(c.main); expect(c.accent).toEqual(c.main); expect(c.dark).toEqual(scale(c.main, 0.5));
  });
  it('takes an accent of 6 px or more, never a 5 px speck', () => {
    const BLUE = c555(0, 0, 31);
    const speck = (n: number) => {
      const t = fakeInfo();
      t.both.fill(BROWN, 0x240 * 256, 0x241 * 256);
      t.both.fill(BLUE, 0x240 * 256, 0x240 * 256 + n);
      return partColors(t, [0x240]);
    };
    expect(speck(5).accent).toEqual(bgr555ToSrgb(BROWN));   // (second = main: blue is no lit colour)
    expect(speck(6).accent).toEqual(bgr555ToSrgb(BLUE));
  });
  it('breaks frequency ties by the lower BGR555 value and takes second among lit colours only', () => {
    const tie = fakeInfo();
    tie.both.fill(TAN, 0x241 * 256, 0x242 * 256);
    tie.both.fill(RED, 0x241 * 256, 0x241 * 256 + 128);
    const c = partColors(tie, [0x241]);
    expect(c.main).toEqual(bgr555ToSrgb(RED));              // RED (0x109f) < TAN (0x431c), 128 px each
    expect(c.second).toEqual(bgr555ToSrgb(TAN));
    const dim = fakeInfo();
    dim.both.fill(BROWN, 0x242 * 256, 0x243 * 256);
    dim.both.fill(c555(5, 5, 5), 0x242 * 256, 0x242 * 256 + 150);   // the most frequent, but unlit
    const d = partColors(dim, [0x242]);
    expect(d.main).toEqual(bgr555ToSrgb(BROWN));
    expect(d.second).toEqual(d.main);
    expect(d.dark).toEqual(bgr555ToSrgb(c555(5, 5, 5)));
  });
  it('reads the bottom layer when asked', () => {
    const two = fakeInfo();
    two.both.fill(RED, 0x232 * 256, 0x233 * 256);
    two.bottom.fill(TAN, 0x232 * 256, 0x233 * 256);
    expect(partColors(two, [0x232], 'bottom').main).toEqual(bgr555ToSrgb(TAN));
    expect(partColors(two, [0x232]).main).toEqual(bgr555ToSrgb(RED));
    expect(floorLook(two, 0x232).tint).toEqual(soften(bgr555ToSrgb(TAN)));
  });
  it('gives a back wall its paint, wainscot and trims', () => {
    // the band's top row is wallpaper (W, tan), its lowest row wainscot (w, brown); a window in the top row is no paint
    const { a, ids } = fakeInterior(['       ', ' WWOWW ', ' wwwww ', ' ..... ', '       '],
      { w: { mt: 0x210, blocked: true, id: 'wall' } });
    a.info.both.fill(TAN, 0x201 * 256, 0x202 * 256);
    a.info.both.fill(RED, 0x202 * 256, 0x203 * 256);
    a.info.both.fill(BROWN, 0x210 * 256, 0x211 * 256);
    const L = roomLayout(a, ids, []);
    const s = wallColors(a, L, ids);
    const tan = bgr555ToSrgb(TAN), brown = bgr555ToSrgb(BROWN);
    expect(s.wall).toEqual(soften(tan));
    expect(s.wainscot).toEqual(soften(brown));
    expect(s.base).toEqual(soften(scale(brown, 0.6)));
    expect(s.panel).toEqual(soften(scale(brown, 1.05)));
    expect(s.trim).toEqual(soften(mix(tan, [1, 1, 1], 0.5)));
  });
});
