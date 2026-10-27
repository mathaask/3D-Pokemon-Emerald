// Interior part colours (Phase 4 Task 5): main / second / accent / dark of a part's metatiles, a back wall's shell
// colours, a floor's tint.
import { describe, it, expect } from 'vitest';
import { partColors, wallColors, floorLook } from '../src/render/kit/interior/colors';
import { roomLayout } from '../src/render/kit/interior/room';
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

describe('part colours', () => {
  it('takes main, second, accent and dark colours', () => {
    const c = partColors(info, [0x230]);
    expect(c).toEqual({ main: bgr555ToSrgb(BROWN), second: bgr555ToSrgb(TAN), accent: bgr555ToSrgb(RED), dark: bgr555ToSrgb(OUTLINE) });
  });
  it('falls back when a part has no accent or no outline', () => {
    const c = partColors(plainInfo, [0x231]);            // one colour only
    expect(c.second).toEqual(c.main); expect(c.accent).toEqual(c.main); expect(c.dark).toEqual(scale(c.main, 0.5));
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
