import { describe, it, expect } from 'vitest';
import { decodeSpriteIndices, pickColors, pickTones } from '../src/render/actors/spriteColors';
import { bgr555ToSrgb } from '../src/render/kit/palette';
import { SpriteColorCache } from '../src/render/actors/spriteColors';
import { blankSprite } from '../src/render/previewActors';
import type { SpriteSnap } from '../src/game/state';

const bgr = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);
/** A 4bpp tile at `tile` whose pixel (x, y) has index f(x, y). */
function putTile(vram: Uint8Array, tile: number, f: (x: number, y: number) => number) {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x += 2)
    vram[0x10000 + tile * 32 + y * 4 + (x >> 1)] = (f(x, y) & 15) | ((f(x + 1, y) & 15) << 4);
}
const sprite = { tileNum: 2, width: 16, height: 8, bpp8: false, hflip: false, vflip: false };

describe('decodeSpriteIndices', () => {
  const vram = new Uint8Array(0x18000);
  putTile(vram, 2, (x, y) => (x + y) & 7);
  putTile(vram, 3, () => 9);
  it('reads 1D-mapped 4bpp tiles row-major', () => {
    const px = decodeSpriteIndices(vram, sprite, false);
    expect(px[3 * 16 + 2]).toBe(5);
    expect(px[0 * 16 + 9]).toBe(9);     // second tile
  });
  it('mirrors when hflipped', () => {
    expect(decodeSpriteIndices(vram, { ...sprite, hflip: true }, false)[0]).toBe(9);
  });
});

describe('pickColors', () => {
  const pal = new Uint16Array(16);
  pal[1] = bgr(31, 2, 2); pal[2] = bgr(30, 30, 30); pal[3] = bgr(2, 2, 3); pal[4] = bgr(4, 20, 6);
  it('finds the body colour, the accent and the greens', () => {
    const c = pickColors(new Uint8Array([0, 1, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4]), pal);
    expect(c.main).toEqual(bgr555ToSrgb(pal[2]));   // most frequent, outline (3) excluded
    expect(c.accent).toEqual(bgr555ToSrgb(pal[1])); // saturated, not green
    expect(c.green).toEqual(bgr555ToSrgb(pal[4]));
  });
  it('returns nulls for a transparent image', () => {
    expect(pickColors(new Uint8Array(8), pal)).toEqual({ main: null, accent: null, green: null });
  });
});

// ---- edge cases beyond the brief ----

/** An 8bpp tile (64 bytes, tile numbers in 32-byte units like OAM) whose pixel (x, y) has index f(x, y). */
function putTile8(vram: Uint8Array, tile: number, f: (x: number, y: number) => number) {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) vram[0x10000 + tile * 32 + y * 8 + x] = f(x, y) & 255;
}

describe('decodeSpriteIndices edge cases (mirrors spriteAtlas.ts)', () => {
  it('flips rows when vflipped, and both axes when both flags are set', () => {
    const vram = new Uint8Array(0x18000);
    putTile(vram, 2, (x, y) => y);
    putTile(vram, 3, (x, y) => 8 + (y & 7));
    const v = decodeSpriteIndices(vram, { ...sprite, vflip: true }, false);
    expect(v[0]).toBe(7);                 // top row shows the tile's bottom row
    expect(v[7 * 16 + 0]).toBe(0);
    expect(v[0 * 16 + 8]).toBe(15);
    const hv = decodeSpriteIndices(vram, { ...sprite, hflip: true, vflip: true }, false);
    expect(hv[0]).toBe(15);               // top-left shows the second tile's bottom-right
    expect(hv[7 * 16 + 15]).toBe(0);
  });
  it('reads the high nibble for odd x', () => {
    const vram = new Uint8Array(0x18000);
    vram[0x10000 + 2 * 32] = 0x5a;        // x = 0 → 0xa, x = 1 → 0x5
    const px = decodeSpriteIndices(vram, sprite, false);
    expect([px[0], px[1]]).toEqual([0xa, 0x5]);
  });
  it('steps two tile numbers per 8bpp tile in 1D mapping', () => {
    const vram = new Uint8Array(0x18000);
    putTile8(vram, 4, (x, y) => 100 + x + y);
    putTile8(vram, 6, () => 200);         // second tile: tileNum + 1 * 2
    putTile8(vram, 8, () => 210);         // 16×16: tile (0, 1) = tileNum + (1 * 2 + 0) * 2
    putTile8(vram, 10, () => 220);
    const s = { tileNum: 4, width: 16, height: 16, bpp8: true, hflip: false, vflip: false };
    const px = decodeSpriteIndices(vram, s, false);
    expect(px[3 * 16 + 2]).toBe(105);
    expect(px[0 * 16 + 8]).toBe(200);
    expect(px[8 * 16 + 0]).toBe(210);
    expect(px[15 * 16 + 15]).toBe(220);
  });
  it('steps 32 tiles per tile row in 2D mapping (4bpp and 8bpp)', () => {
    const vram = new Uint8Array(0x18000);
    putTile(vram, 2, () => 1); putTile(vram, 3, () => 2); putTile(vram, 34, () => 3); putTile(vram, 35, () => 4);
    const s4 = { tileNum: 2, width: 16, height: 16, bpp8: false, hflip: false, vflip: false };
    const p4 = decodeSpriteIndices(vram, s4, true);
    expect([p4[0], p4[8], p4[8 * 16], p4[8 * 16 + 8]]).toEqual([1, 2, 3, 4]);
    // the same sprite 1D-mapped reads tiles 2, 3, 4, 5
    expect(decodeSpriteIndices(vram, s4, false)[8 * 16]).toBe(0);
    const v8 = new Uint8Array(0x18000);
    putTile8(v8, 4, () => 11); putTile8(v8, 6, () => 12); putTile8(v8, 36, () => 13); putTile8(v8, 38, () => 14);
    const p8 = decodeSpriteIndices(v8, { ...s4, tileNum: 4, bpp8: true }, true);
    expect([p8[0], p8[8], p8[8 * 16], p8[8 * 16 + 8]]).toEqual([11, 12, 13, 14]);
  });
  it('wraps tile numbers at 1024 like the shader', () => {
    const vram = new Uint8Array(0x18000);
    putTile(vram, 1023, () => 6);
    putTile(vram, 0, () => 7);
    const px = decodeSpriteIndices(vram, { ...sprite, tileNum: 1023 }, false);
    expect([px[0], px[8]]).toEqual([6, 7]);
  });
});

describe('pickColors edge cases', () => {
  it('counts a colour shared by several indices as one colour', () => {
    const pal = new Uint16Array(16);
    pal[1] = bgr(28, 28, 28); pal[2] = bgr(20, 20, 31); pal[3] = bgr(20, 20, 31);
    // 3 px of index 1 vs 2 + 2 px of the same blue under indices 2 and 3
    const c = pickColors(new Uint8Array([1, 1, 1, 2, 2, 3, 3]), pal);
    expect(c.main).toEqual(bgr555ToSrgb(pal[2]));
  });
  it('reads indices past 15 from a 256-colour palette (8bpp)', () => {
    const pal = new Uint16Array(256);
    pal[200] = bgr(31, 24, 0);
    expect(pickColors(new Uint8Array([0, 200, 200]), pal).main).toEqual(bgr555ToSrgb(pal[200]));
  });
  it('has no main colour when every opaque pixel is an outline', () => {
    const pal = new Uint16Array(16);
    pal[1] = bgr(2, 2, 2); pal[2] = bgr(6, 2, 1);
    expect(pickColors(new Uint8Array([1, 1, 2]), pal).main).toBeNull();
  });
  it('scores the accent by pixel count × saturation, never a green or a dull colour', () => {
    const pal = new Uint16Array(16);
    pal[1] = bgr(31, 0, 0);    // saturation 1, 1 px  → 1
    pal[2] = bgr(10, 10, 31);  // saturation ≈ 0.68, 3 px → ≈ 2.03
    pal[3] = bgr(0, 31, 0);    // green: never the accent
    pal[4] = bgr(20, 16, 14);  // saturation ≈ 0.19: too dull
    const c = pickColors(new Uint8Array([1, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4]), pal);
    expect(c.accent).toEqual(bgr555ToSrgb(pal[2]));
    const onlyGreen = pickColors(new Uint8Array([3, 3, 4]), pal);
    expect(onlyGreen.accent).toBeNull();
  });
  it('averages the greens by pixel count and ignores unsaturated or off-hue colours', () => {
    const pal = new Uint16Array(16);
    pal[1] = bgr(0, 31, 0);    // hue 120°
    pal[2] = bgr(0, 16, 0);    // hue 120°, darker
    pal[3] = bgr(16, 18, 16);  // greenish grey: saturation < 0.2
    pal[4] = bgr(31, 31, 0);   // yellow, hue 60°
    const c = pickColors(new Uint8Array([1, 2, 2, 2, 3, 3, 4, 4]), pal);
    expect(c.green![0]).toBeCloseTo(0);
    expect(c.green![1]).toBeCloseTo((31 + 3 * 16) / 4 / 31);
    expect(c.green![2]).toBeCloseTo(0);
    expect(pickColors(new Uint8Array([3, 4]), pal).green).toBeNull();
  });
});

describe('pickTones', () => {
  // an 8×8 image: a bright edge ring (index 5: the outline position, excluded however bright), inside it 6×6 pixels:
  // 6 darkish (4), 20 mid (2), 9 light (3) and one near-black outline colour (1, luma < 0.2, excluded)
  const pal = new Uint16Array(16);
  pal[1] = bgr(2, 2, 2); pal[2] = bgr(15, 14, 8); pal[3] = bgr(22, 20, 12); pal[4] = bgr(9, 9, 4); pal[5] = bgr(31, 31, 31);
  const px = new Uint8Array(64);
  let k = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    if (x === 0 || y === 0 || x === 7 || y === 7) { px[y * 8 + x] = 5; continue; }
    px[y * 8 + x] = k < 6 ? 4 : k < 26 ? 2 : k < 35 ? 3 : 1;
    k++;
  }
  it('takes the median as the body, the upper quartile as the highlight, the darkest frequent colour as the crevice', () => {
    const t = pickTones(px, 8, 8, pal);
    expect(t.body).toEqual(bgr555ToSrgb(pal[2]));
    expect(t.highlight).toEqual(bgr555ToSrgb(pal[3]));   // the top 9 of 35 pixels: all index 3
    expect(t.crevice).toEqual(bgr555ToSrgb(pal[4]));     // 6 of 35 ≥ 10 %
  });
  it('leaves out the silhouette edge and dark outline colours, and a colour too rare to be the crevice', () => {
    const rare = px.slice();
    for (let i = 0, n = 0; i < 64 && n < 3; i++) if (rare[i] === 4) { rare[i] = 2; n++; } // 3 of 35 < 10 %
    expect(pickTones(rare, 8, 8, pal).crevice).toEqual(bgr555ToSrgb(pal[2]));
    expect(pickTones(px.map((v) => (v === 5 ? 5 : 0)), 8, 8, pal)).toEqual({ body: null, highlight: null, crevice: null, dark: null }); // the ring alone: all edge
  });
  it('takes the most frequent colour darker than the body as the dark tone, outline and edge included, near-black left out', () => {
    expect(pickTones(px, 8, 8, pal).dark).toEqual(bgr555ToSrgb(pal[4]));   // 6 px; index 1 (luma 0.065) has 1
    const band = pal.slice(); band[5] = bgr(3, 9, 0);                       // the edge ring a dark green band (28 px)
    expect(pickTones(px, 8, 8, band).dark).toEqual(bgr555ToSrgb(band[5]));
    const black = pal.slice(); black[5] = bgr(0, 0, 0);                      // a black outline is never the dark tone
    expect(pickTones(px, 8, 8, black).dark).toEqual(bgr555ToSrgb(pal[4]));
  });
  it('averages the upper quartile when it spans colours', () => {
    const t = pickTones(px.map((v) => (v === 3 ? 2 : v)).map((v, i) => (i === 54 ? 3 : v)), 8, 8, pal);
    // 35 pixels, top 9: one light (3) and eight mid (2)
    const l = bgr555ToSrgb(pal[3]), m = bgr555ToSrgb(pal[2]);
    t.highlight!.forEach((c, i) => expect(c).toBeCloseTo((l[i] + 8 * m[i]) / 9, 6));
  });
});

describe('SpriteColorCache', () => {
  const RED = bgr(31, 4, 4), BLUE = bgr(8, 8, 31);
  function setup() {
    const vram = new Uint8Array(0x18000);
    putTile(vram, 0, () => 1); putTile(vram, 1, () => 1);
    const palette = new Uint16Array(512);
    palette[256 + 0 * 16 + 1] = BLUE;
    palette[256 + 3 * 16 + 1] = RED;
    return { vram, palette };
  }
  const s = (p: Partial<SpriteSnap> = {}) => blankSprite({ width: 16, height: 8, tileNum: 0, palette: 3, images: 0x8500000, ...p });

  it("samples the OAM palette slot the sprite actually uses", () => {
    const src = setup();
    const cache = new SpriteColorCache();
    expect(cache.get(s(), src).main).toEqual(bgr555ToSrgb(RED));
    expect(cache.get(s({ palette: 0 }), src).main).toEqual(bgr555ToSrgb(BLUE));
  });
  it('caches per (images, animNum, palette slot contents)', () => {
    const src = setup();
    const cache = new SpriteColorCache();
    const first = cache.get(s(), src);
    expect(cache.get(s({ hflip: true, tileNum: 0 }), src)).toBe(first);
    src.palette[256 + 5 * 16 + 1] = BLUE;           // another slot: no effect
    expect(cache.get(s(), src)).toBe(first);
    src.palette[256 + 3 * 16 + 1] = BLUE;           // the sprite's slot changed (a berry, a fade step)
    const recoloured = cache.get(s(), src);
    expect(recoloured).not.toBe(first);
    expect(recoloured.main).toEqual(bgr555ToSrgb(BLUE));
    src.palette[256 + 3 * 16 + 1] = RED;
    expect(cache.get(s(), src)).toBe(first);       // back to the first key
    expect(cache.get(s({ animNum: 2 }), src)).not.toBe(first);
    expect(cache.get(s({ images: 0x8500010 }), src)).not.toBe(first);
  });
  it('reads 8bpp sprites from the 256-colour OBJ palette and keys on all of it', () => {
    const src = setup();
    putTile8(src.vram, 8, () => 0x90); putTile8(src.vram, 10, () => 0x90);
    src.palette[256 + 0x90] = RED;
    const cache = new SpriteColorCache();
    const s8 = s({ tileNum: 8, bpp8: true, palette: 0 });
    const first = cache.get(s8, src);
    expect(first.main).toEqual(bgr555ToSrgb(RED));
    src.palette[256 + 0x90] = BLUE;
    expect(cache.get(s8, src).main).toEqual(bgr555ToSrgb(BLUE));
  });
  it('honours 2D tile mapping when the source says so', () => {
    const src = setup();
    const vram = new Uint8Array(0x18000);
    putTile(vram, 32, () => 1);                     // 2D: row 1 of tiles starts 32 tiles on
    const sTall = s({ width: 8, height: 16, tileNum: 0 });
    expect(new SpriteColorCache().get(sTall, { ...src, vram, map2d: true }).main).toEqual(bgr555ToSrgb(RED));
    expect(new SpriteColorCache().get(sTall, { ...src, vram }).main).toBeNull();
  });
  it('does not cache a transparent image (its tiles may not be loaded yet)', () => {
    const src = setup();
    src.vram.fill(0);
    const cache = new SpriteColorCache();
    expect(cache.get(s(), src)).toEqual({ main: null, accent: null, green: null });
    expect(cache.size).toBe(0);
    putTile(src.vram, 0, () => 1); putTile(src.vram, 1, () => 1);
    expect(cache.get(s(), src).main).toEqual(bgr555ToSrgb(RED));
  });
  it('can sample without storing (a spawn frame: the tiles may still be another object\'s)', () => {
    const src = setup();
    src.palette[256 + 3 * 16 + 2] = BLUE;
    const cache = new SpriteColorCache();
    // frame 1: the VBlank copy has not run yet, the slot's tiles are another object's (index 1 = RED)
    expect(cache.get(s(), src, { store: false }).main).toEqual(bgr555ToSrgb(RED));
    expect(cache.size).toBe(0);
    // frame 2: the object's own tiles arrived (index 2 = BLUE); same key, decoded afresh and now stored
    putTile(src.vram, 0, () => 2); putTile(src.vram, 1, () => 2);
    const own = cache.get(s(), src);
    expect(own.main).toEqual(bgr555ToSrgb(BLUE));
    expect(cache.size).toBe(1);
    // a stored entry is still returned by a non-storing lookup (an identical object spawning later)
    expect(cache.get(s(), src, { store: false })).toBe(own);
  });
  it('keeps at most 256 entries, evicting the least recently used', () => {
    const src = setup();
    const cache = new SpriteColorCache();
    const first = cache.get(s({ images: 0 }), src);
    const second = cache.get(s({ images: 1 }), src);
    for (let i = 2; i < 256; i++) cache.get(s({ images: i }), src);
    expect(cache.size).toBe(256);
    expect(cache.get(s({ images: 0 }), src)).toBe(first);  // touched: now the most recent
    cache.get(s({ images: 256 }), src);                    // evicts images 1
    expect(cache.size).toBe(256);
    expect(cache.get(s({ images: 0 }), src)).toBe(first);
    expect(cache.get(s({ images: 1 }), src)).not.toBe(second);
    expect(cache.size).toBe(256);
  });
});
