import { describe, it, expect } from 'vitest';
import { Bus } from '../src/gba/bus';
import { Ppu } from '../src/gba/ppu';
import { REG } from '../src/gba/constants';

// --- helpers -----------------------------------------------------------------

const DISP_BG0 = 0x100;
const DISP_BG1 = 0x200;
const DISP_BG2 = 0x400;
const DISP_OBJ = 0x1000;
const DISP_WIN0 = 0x2000;
const DISP_OBJWIN = 0x8000;
const DISP_OBJ_1D = 0x40;

function setup(): { bus: Bus; ppu: Ppu } {
  const bus = new Bus(new Uint8Array(1024));
  const ppu = new Ppu(bus);
  // Disable every sprite (an all-zero OAM entry is a visible 8x8 sprite at 0,0).
  for (let i = 0; i < 128; i++) bus.oam16[i * 4] = 0x0200;
  return { bus, ppu };
}

function reg(bus: Bus, off: number, v: number): void {
  bus.io16[off >> 1] = v & 0xffff;
}

/** Writes a 28-bit affine reference point register pair (BGnX/BGnY), value in 8.8 fixed point. */
function reg28(bus: Bus, off: number, v: number): void {
  const u = v & 0x0fffffff;
  bus.io16[off >> 1] = u & 0xffff;
  bus.io16[(off >> 1) + 1] = u >>> 16;
}

/** BGR555 -> expected framebuffer value. */
function rgba(c: number): number {
  const e = (v: number) => (v << 3) | (v >> 2);
  return (0xff000000 | (e((c >> 10) & 31) << 16) | (e((c >> 5) & 31) << 8) | e(c & 31)) >>> 0;
}

const bgr = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);

function frame(ppu: Ppu): void {
  for (let y = 0; y < 160; y++) ppu.renderScanline(y);
}

const px = (ppu: Ppu, x: number, y: number) => ppu.framebuffer[y * 240 + x];
const ov = (ppu: Ppu, x: number, y: number) => ppu.overlay[y * 240 + x];

/** 4bpp tile at byte address `addr`, pixel colour index from f(x, y). */
function tile4(bus: Bus, addr: number, f: (x: number, y: number) => number): void {
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x += 2) bus.vram[addr + y * 4 + (x >> 1)] = (f(x, y) & 15) | ((f(x + 1, y) & 15) << 4);
}

/** 8bpp tile at byte address `addr`. */
function tile8(bus: Bus, addr: number, f: (x: number, y: number) => number): void {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bus.vram[addr + y * 8 + x] = f(x, y) & 255;
}

const pat4 = (x: number, y: number) => ((x + 2 * y) % 15) + 1;
const pat8 = (x: number, y: number) => y * 8 + x + 1;

/** Distinct colour for every palette entry. */
function fillPalette(bus: Bus): void {
  for (let i = 0; i < 512; i++) bus.pram16[i] = (i * 37 + 11) & 0x7fff;
  bus.pram16[0] = bgr(1, 2, 3); // backdrop
}

const BACKDROP = rgba(bgr(1, 2, 3));

/** Text BG map entry write: screen base in 2 KB units, (tx, ty) within a 32x32 block. */
function mapEntry(bus: Bus, screenBase: number, tx: number, ty: number, v: number): void {
  bus.vram16[(screenBase * 0x800 + (ty * 32 + tx) * 2) >> 1] = v;
}

function fillMap(bus: Bus, screenBase: number, v: number): void {
  for (let i = 0; i < 1024; i++) bus.vram16[((screenBase * 0x800) >> 1) + i] = v;
}

function setObj(bus: Bus, i: number, a0: number, a1: number, a2: number): void {
  bus.oam16[i * 4] = a0;
  bus.oam16[i * 4 + 1] = a1;
  bus.oam16[i * 4 + 2] = a2;
}

const objTile4 = (bus: Bus, tile: number, f: (x: number, y: number) => number) => tile4(bus, 0x10000 + tile * 32, f);

// --- tests -------------------------------------------------------------------

describe('PPU basics', () => {
  it('draws the backdrop (palette 0) with 5->8 bit expansion', () => {
    const { bus, ppu } = setup();
    bus.pram16[0] = bgr(31, 0, 31);
    frame(ppu);
    expect(px(ppu, 0, 0)).toBe(0xffff00ff);
    expect(px(ppu, 239, 159)).toBe(0xffff00ff);
    bus.pram16[0] = 0x0010; // r = 16 -> 0x84
    ppu.renderScanline(0);
    expect(px(ppu, 5, 0)).toBe(0xff000084);
  });

  it('forced blank shows a white line', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    reg(bus, REG.DISPCNT, 0x80 | DISP_BG0);
    frame(ppu);
    expect(px(ppu, 0, 0)).toBe(0xffffffff);
    expect(px(ppu, 120, 80)).toBe(0xffffffff);
  });
});

describe('text backgrounds', () => {
  it('renders a 4bpp tile with palette bank', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    tile4(bus, 1 * 32, pat4);
    mapEntry(bus, 8, 0, 0, 1 | (2 << 12));
    reg(bus, REG.BG0CNT, 8 << 8);
    reg(bus, REG.DISPCNT, DISP_BG0);
    frame(ppu);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) expect(px(ppu, x, y)).toBe(rgba(bus.pram16[32 + pat4(x, y)]));
    expect(px(ppu, 8, 0)).toBe(BACKDROP); // tile 0 is all zeros = transparent
  });

  it('renders an 8bpp tile', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    tile8(bus, 1 * 64, pat8);
    mapEntry(bus, 16, 1, 1, 1 | (5 << 12)); // palette bits ignored in 8bpp
    reg(bus, REG.BG0CNT, (16 << 8) | 0x80);
    reg(bus, REG.DISPCNT, DISP_BG0);
    frame(ppu);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) expect(px(ppu, 8 + x, 8 + y)).toBe(rgba(bus.pram16[pat8(x, y)]));
  });

  it('scrolls with wraparound', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    for (let t = 1; t <= 4; t++) tile4(bus, t * 32, () => t);
    mapEntry(bus, 8, 31, 31, 1);
    mapEntry(bus, 8, 0, 31, 2);
    mapEntry(bus, 8, 31, 0, 3);
    mapEntry(bus, 8, 0, 0, 4);
    reg(bus, REG.BG0CNT, 8 << 8);
    reg(bus, REG.BG0HOFS, 252);
    reg(bus, REG.BG0VOFS, 250);
    reg(bus, REG.DISPCNT, DISP_BG0);
    frame(ppu);
    expect(px(ppu, 0, 0)).toBe(rgba(bus.pram16[1])); // bg (252,250)
    expect(px(ppu, 4, 0)).toBe(rgba(bus.pram16[2])); // bg (0,250)
    expect(px(ppu, 0, 6)).toBe(rgba(bus.pram16[3])); // bg (252,0)
    expect(px(ppu, 4, 6)).toBe(rgba(bus.pram16[4])); // bg (0,0)
    expect(px(ppu, 12, 6)).toBe(BACKDROP);
  });

  it('applies horizontal and vertical flip', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    tile4(bus, 32, pat4);
    mapEntry(bus, 8, 0, 0, 1 | 0x400);
    mapEntry(bus, 8, 1, 0, 1 | 0x800);
    mapEntry(bus, 8, 2, 0, 1 | 0xc00);
    reg(bus, REG.BG0CNT, 8 << 8);
    reg(bus, REG.DISPCNT, DISP_BG0);
    frame(ppu);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        expect(px(ppu, x, y)).toBe(rgba(bus.pram16[pat4(7 - x, y)]));
        expect(px(ppu, 8 + x, y)).toBe(rgba(bus.pram16[pat4(x, 7 - y)]));
        expect(px(ppu, 16 + x, y)).toBe(rgba(bus.pram16[pat4(7 - x, 7 - y)]));
      }
  });

  it('addresses screen blocks of 512-wide and 512-tall maps', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    for (let t = 1; t <= 4; t++) tile4(bus, t * 32, () => t);
    // 512x256: tile column 32 lives in the next screen block.
    mapEntry(bus, 8, 0, 0, 1);
    mapEntry(bus, 9, 0, 0, 2);
    reg(bus, REG.BG0CNT, (8 << 8) | (1 << 14));
    reg(bus, REG.DISPCNT, DISP_BG0);
    reg(bus, REG.BG0HOFS, 256);
    frame(ppu);
    expect(px(ppu, 0, 0)).toBe(rgba(bus.pram16[2]));
    expect(px(ppu, 256 - 256 + 0, 0)).toBe(rgba(bus.pram16[2]));
    reg(bus, REG.BG0HOFS, 0);
    frame(ppu);
    expect(px(ppu, 0, 0)).toBe(rgba(bus.pram16[1]));
    // 512x512: row 32 starts two blocks later; (32,32) three blocks later.
    mapEntry(bus, 10, 0, 0, 3);
    mapEntry(bus, 11, 0, 0, 4);
    reg(bus, REG.BG0CNT, (8 << 8) | (3 << 14));
    reg(bus, REG.BG0VOFS, 256);
    frame(ppu);
    expect(px(ppu, 0, 0)).toBe(rgba(bus.pram16[3]));
    reg(bus, REG.BG0HOFS, 256);
    frame(ppu);
    expect(px(ppu, 0, 0)).toBe(rgba(bus.pram16[4]));
    // 256x512: row 32 is in the very next block.
    reg(bus, REG.BG0CNT, (8 << 8) | (2 << 14));
    reg(bus, REG.BG0HOFS, 0);
    frame(ppu);
    expect(px(ppu, 0, 0)).toBe(rgba(bus.pram16[2]));
  });

  it('respects BG priority and index order', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    tile4(bus, 32, () => 1);
    tile4(bus, 64, () => 2);
    fillMap(bus, 8, 1);
    fillMap(bus, 9, 2);
    reg(bus, REG.BG0CNT, (8 << 8) | 1);
    reg(bus, REG.BG1CNT, (9 << 8) | 0);
    reg(bus, REG.DISPCNT, DISP_BG0 | DISP_BG1);
    frame(ppu);
    expect(px(ppu, 10, 10)).toBe(rgba(bus.pram16[2])); // BG1 has priority 0
    reg(bus, REG.BG1CNT, (9 << 8) | 1);
    frame(ppu);
    expect(px(ppu, 10, 10)).toBe(rgba(bus.pram16[1])); // tie -> lower BG index
  });

  it('applies BG mosaic', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    tile4(bus, 32, pat4);
    mapEntry(bus, 8, 0, 0, 1);
    reg(bus, REG.BG0CNT, (8 << 8) | 0x40);
    reg(bus, REG.MOSAIC, 0x33); // 4x4 blocks
    reg(bus, REG.DISPCNT, DISP_BG0);
    frame(ppu);
    expect(px(ppu, 3, 3)).toBe(rgba(bus.pram16[pat4(0, 0)]));
    expect(px(ppu, 5, 6)).toBe(rgba(bus.pram16[pat4(4, 4)]));
  });
});

describe('affine backgrounds', () => {
  function affineSetup(cnt: number) {
    const { bus, ppu } = setup();
    fillPalette(bus);
    tile8(bus, 64, pat8);
    tile8(bus, 128, () => 200);
    tile8(bus, 192, () => 201);
    const map = 8 * 0x800; // 128x128 map: 16 bytes per row
    bus.vram[map + 0] = 1;
    bus.vram[map + 1] = 2;
    bus.vram[map + 15] = 3;
    reg(bus, REG.BG2CNT, (8 << 8) | cnt);
    reg(bus, REG.BG2PA, 0x100);
    reg(bus, REG.BG2PD, 0x100);
    reg(bus, REG.DISPCNT, 1 | DISP_BG2);
    return { bus, ppu };
  }

  it('renders with an identity transform', () => {
    const { bus, ppu } = affineSetup(0);
    frame(ppu);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(px(ppu, x, y)).toBe(rgba(bus.pram16[pat8(x, y)]));
    expect(px(ppu, 8, 0)).toBe(rgba(bus.pram16[200]));
    expect(px(ppu, 130, 0)).toBe(BACKDROP); // outside the 128x128 map
  });

  it('renders scaled', () => {
    const { bus, ppu } = affineSetup(0);
    reg(bus, REG.BG2PA, 0x200);
    reg(bus, REG.BG2PD, 0x200);
    frame(ppu);
    expect(px(ppu, 3, 0)).toBe(rgba(bus.pram16[pat8(6, 0)]));
    expect(px(ppu, 3, 1)).toBe(rgba(bus.pram16[pat8(6, 2)])); // ref Y += PD per line
    expect(px(ppu, 4, 0)).toBe(rgba(bus.pram16[200]));
  });

  it('wraps only when the wrap flag is set', () => {
    let { bus, ppu } = affineSetup(0);
    reg28(bus, REG.BG2X, -8 << 8);
    frame(ppu);
    expect(px(ppu, 0, 0)).toBe(BACKDROP);
    expect(px(ppu, 8, 0)).toBe(rgba(bus.pram16[pat8(0, 0)]));
    expect(px(ppu, 140, 0)).toBe(BACKDROP);

    ({ bus, ppu } = affineSetup(0x2000));
    reg28(bus, REG.BG2X, -8 << 8);
    frame(ppu);
    expect(px(ppu, 0, 0)).toBe(rgba(bus.pram16[201])); // x=-8 wraps to 120 (tile 15)
    expect(px(ppu, 8, 0)).toBe(rgba(bus.pram16[pat8(0, 0)]));
    expect(px(ppu, 136 + 3, 2)).toBe(rgba(bus.pram16[pat8(3, 2)])); // 131 wraps to 3
  });

  it('advances the reference point by PB/PD and reloads on register writes', () => {
    const { bus, ppu } = affineSetup(0x2000);
    reg(bus, REG.BG2PB, 0x100); // shear: line y starts at x = y
    frame(ppu);
    expect(px(ppu, 0, 3)).toBe(rgba(bus.pram16[pat8(3, 3)]));
    // Mid-frame write of BG2X only: X reloads, Y keeps accumulating PD.
    for (let y = 0; y < 5; y++) ppu.renderScanline(y);
    reg28(bus, REG.BG2X, 1 << 8);
    ppu.affineRefWritten(2);
    ppu.renderScanline(5);
    expect(px(ppu, 0, 5)).toBe(rgba(bus.pram16[pat8(1, 5)]));
    ppu.renderScanline(6);
    expect(px(ppu, 0, 6)).toBe(rgba(bus.pram16[pat8(2, 6)]));
    // Then BG2Y only: Y reloads, X keeps accumulating PB.
    reg28(bus, REG.BG2Y, 2 << 8);
    ppu.affineRefWritten(2);
    ppu.renderScanline(7);
    expect(px(ppu, 0, 7)).toBe(rgba(bus.pram16[pat8(3, 2)]));
    // A new frame reloads both from the registers.
    ppu.renderScanline(0);
    expect(px(ppu, 0, 0)).toBe(rgba(bus.pram16[pat8(1, 2)]));
  });
});

describe('bitmap modes', () => {
  it('mode 3 shows direct colour', () => {
    const { bus, ppu } = setup();
    bus.pram16[0] = bgr(1, 2, 3);
    bus.vram16[5 * 240 + 7] = bgr(10, 20, 30);
    reg(bus, REG.BG2PA, 0x100);
    reg(bus, REG.BG2PD, 0x100);
    reg(bus, REG.DISPCNT, 3 | DISP_BG2);
    frame(ppu);
    expect(px(ppu, 7, 5)).toBe(rgba(bgr(10, 20, 30)));
    expect(px(ppu, 8, 5)).toBe(rgba(0)); // opaque black, not backdrop
  });

  it('mode 4 page flip', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    bus.vram[2 * 240 + 3] = 5;
    bus.vram[0xa000 + 2 * 240 + 3] = 6;
    reg(bus, REG.BG2PA, 0x100);
    reg(bus, REG.BG2PD, 0x100);
    reg(bus, REG.DISPCNT, 4 | DISP_BG2);
    frame(ppu);
    expect(px(ppu, 3, 2)).toBe(rgba(bus.pram16[5]));
    expect(px(ppu, 4, 2)).toBe(BACKDROP); // index 0 is transparent
    reg(bus, REG.DISPCNT, 4 | DISP_BG2 | 0x10);
    frame(ppu);
    expect(px(ppu, 3, 2)).toBe(rgba(bus.pram16[6]));
  });

  it('mode 5 is 160x128', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    bus.vram16[(0xa000 >> 1) + 10 * 160 + 20] = bgr(31, 0, 0);
    reg(bus, REG.BG2PA, 0x100);
    reg(bus, REG.BG2PD, 0x100);
    reg(bus, REG.DISPCNT, 5 | DISP_BG2 | 0x10);
    frame(ppu);
    expect(px(ppu, 20, 10)).toBe(rgba(bgr(31, 0, 0)));
    expect(px(ppu, 170, 10)).toBe(BACKDROP);
    expect(px(ppu, 20, 130)).toBe(BACKDROP);
  });
});

describe('sprites', () => {
  it('uses 1D vs 2D tile mapping', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    objTile4(bus, 0, () => 1);
    objTile4(bus, 1, () => 1);
    objTile4(bus, 2, () => 2); // 1D: second tile row of a 16x16 sprite
    objTile4(bus, 32, () => 3); // 2D: second tile row
    setObj(bus, 0, 30, 40 | (1 << 14), 1 << 12);
    reg(bus, REG.DISPCNT, DISP_OBJ | DISP_OBJ_1D);
    frame(ppu);
    expect(px(ppu, 40, 30)).toBe(rgba(bus.pram16[256 + 16 + 1]));
    expect(px(ppu, 40, 38)).toBe(rgba(bus.pram16[256 + 16 + 2]));
    expect(px(ppu, 39, 38)).toBe(BACKDROP);
    expect(px(ppu, 56, 38)).toBe(BACKDROP);
    reg(bus, REG.DISPCNT, DISP_OBJ);
    frame(ppu);
    expect(px(ppu, 40, 38)).toBe(rgba(bus.pram16[256 + 16 + 3]));
  });

  it('renders 8bpp sprites (two 32-byte units per tile)', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    tile8(bus, 0x10000 + 2 * 32, pat8);
    tile8(bus, 0x10000 + 4 * 32, () => 99);
    setObj(bus, 0, 60 | 0x2000 | (1 << 14), 70, 2 | (7 << 12)); // 16x8, 8bpp, palette bits ignored
    reg(bus, REG.DISPCNT, DISP_OBJ | DISP_OBJ_1D);
    frame(ppu);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(px(ppu, 70 + x, 60 + y)).toBe(rgba(bus.pram16[256 + pat8(x, y)]));
    expect(px(ppu, 78, 60)).toBe(rgba(bus.pram16[256 + 99]));
    expect(px(ppu, 86, 60)).toBe(BACKDROP);
  });

  it('flips horizontally and vertically', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    objTile4(bus, 1, pat4);
    setObj(bus, 0, 10, 20 | 0x1000, 1);
    setObj(bus, 1, 10, 40 | 0x2000, 1);
    reg(bus, REG.DISPCNT, DISP_OBJ | DISP_OBJ_1D);
    frame(ppu);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        expect(px(ppu, 20 + x, 10 + y)).toBe(rgba(bus.pram16[256 + pat4(7 - x, y)]));
        expect(px(ppu, 40 + x, 10 + y)).toBe(rgba(bus.pram16[256 + pat4(x, 7 - y)]));
      }
  });

  it('wraps Y at 256 and treats X as 9-bit signed', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    for (let t = 0; t < 4; t++) objTile4(bus, t, () => 1);
    setObj(bus, 0, 250, 100 | (1 << 14), 0); // 16x16 at y=250 -> lines 0..9
    setObj(bus, 1, 50, 508 | (1 << 14), 0); // x = -4 -> columns 0..11
    reg(bus, REG.DISPCNT, DISP_OBJ | DISP_OBJ_1D);
    frame(ppu);
    expect(px(ppu, 100, 0)).toBe(rgba(bus.pram16[257]));
    expect(px(ppu, 100, 9)).toBe(rgba(bus.pram16[257]));
    expect(px(ppu, 100, 10)).toBe(BACKDROP);
    expect(px(ppu, 0, 50)).toBe(rgba(bus.pram16[257]));
    expect(px(ppu, 11, 50)).toBe(rgba(bus.pram16[257]));
    expect(px(ppu, 12, 50)).toBe(BACKDROP);
  });

  it('centres an affine double-size sprite in its bounding box', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    objTile4(bus, 1, () => 1);
    setObj(bus, 0, 20 | 0x100 | 0x200, 50, 1); // affine, double size, param group 0
    bus.oam16[3] = 0x100; // PA
    bus.oam16[7] = 0; // PB
    bus.oam16[11] = 0; // PC
    bus.oam16[15] = 0x100; // PD
    reg(bus, REG.DISPCNT, DISP_OBJ | DISP_OBJ_1D);
    frame(ppu);
    const c = rgba(bus.pram16[257]);
    expect(px(ppu, 54, 24)).toBe(c);
    expect(px(ppu, 61, 31)).toBe(c);
    expect(px(ppu, 53, 24)).toBe(BACKDROP);
    expect(px(ppu, 62, 31)).toBe(BACKDROP);
    expect(px(ppu, 54, 23)).toBe(BACKDROP);
    expect(px(ppu, 54, 32)).toBe(BACKDROP);
    // Scale x2 (P = 0.5) fills the whole 16x16 box.
    bus.oam16[3] = 0x80;
    bus.oam16[15] = 0x80;
    frame(ppu);
    expect(px(ppu, 50, 20)).toBe(c);
    expect(px(ppu, 65, 35)).toBe(c);
    expect(px(ppu, 66, 35)).toBe(BACKDROP);
    expect(px(ppu, 49, 20)).toBe(BACKDROP);
  });

  it('applies OBJ mosaic', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    objTile4(bus, 1, pat4);
    setObj(bus, 0, 8 | 0x1000, 8, 1); // mosaic bit
    reg(bus, REG.MOSAIC, (3 << 8) | (3 << 12)); // OBJ 4x4 blocks
    reg(bus, REG.DISPCNT, DISP_OBJ | DISP_OBJ_1D);
    frame(ppu);
    expect(px(ppu, 9, 9)).toBe(rgba(bus.pram16[256 + pat4(0, 0)]));
    expect(px(ppu, 15, 14)).toBe(rgba(bus.pram16[256 + pat4(4, 4)]));
  });

  it('does not draw tiles < 512 in bitmap modes', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    objTile4(bus, 1, () => 1);
    objTile4(bus, 512, () => 2);
    setObj(bus, 0, 10, 10, 1);
    setObj(bus, 1, 10, 30, 512);
    reg(bus, REG.DISPCNT, 3 | DISP_OBJ | DISP_OBJ_1D);
    frame(ppu);
    expect(px(ppu, 10, 10)).toBe(BACKDROP);
    expect(px(ppu, 30, 10)).toBe(rgba(bus.pram16[258]));
  });

  it('sorts against BGs by priority and against each other by OAM index', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    tile4(bus, 32, () => 1);
    fillMap(bus, 8, 1);
    reg(bus, REG.BG0CNT, (8 << 8) | 1);
    objTile4(bus, 1, () => 2);
    objTile4(bus, 2, () => 3);
    const bg = rgba(bus.pram16[1]);
    const objA = rgba(bus.pram16[256 + 2]);
    const objB = rgba(bus.pram16[256 + 3]);
    reg(bus, REG.DISPCNT, DISP_BG0 | DISP_OBJ | DISP_OBJ_1D);

    setObj(bus, 0, 10, 10, 1 | (2 << 10)); // priority 2 < BG priority 1 -> hidden
    frame(ppu);
    expect(px(ppu, 12, 12)).toBe(bg);
    setObj(bus, 0, 10, 10, 1 | (1 << 10)); // equal priority -> OBJ wins
    frame(ppu);
    expect(px(ppu, 12, 12)).toBe(objA);

    setObj(bus, 1, 10, 14, 2 | (1 << 10)); // same priority, higher index -> behind
    frame(ppu);
    expect(px(ppu, 15, 12)).toBe(objA);
    expect(px(ppu, 19, 12)).toBe(objB);
    setObj(bus, 1, 10, 14, 2 | (0 << 10)); // better priority beats lower index
    frame(ppu);
    expect(px(ppu, 15, 12)).toBe(objB);
  });
});

describe('windows', () => {
  function bgSetup() {
    const { bus, ppu } = setup();
    fillPalette(bus);
    tile4(bus, 32, () => 1);
    fillMap(bus, 8, 1);
    reg(bus, REG.BG0CNT, 8 << 8);
    return { bus, ppu, bg: rgba(bus.pram16[1]) };
  }

  it('WIN0 masks a BG inside its rectangle', () => {
    const { bus, ppu, bg } = bgSetup();
    reg(bus, REG.DISPCNT, DISP_BG0 | DISP_WIN0);
    reg(bus, REG.WIN0H, (10 << 8) | 20);
    reg(bus, REG.WIN0V, (5 << 8) | 15);
    reg(bus, REG.WININ, 0x00);
    reg(bus, REG.WINOUT, 0x01);
    frame(ppu);
    expect(px(ppu, 15, 10)).toBe(BACKDROP);
    expect(px(ppu, 10, 5)).toBe(BACKDROP);
    expect(px(ppu, 9, 10)).toBe(bg);
    expect(px(ppu, 20, 10)).toBe(bg);
    expect(px(ppu, 15, 4)).toBe(bg);
    expect(px(ppu, 15, 15)).toBe(bg);
  });

  it('WIN0 wraps when x1 > x2 or y1 > y2', () => {
    const { bus, ppu, bg } = bgSetup();
    reg(bus, REG.DISPCNT, DISP_BG0 | DISP_WIN0);
    reg(bus, REG.WIN0H, (230 << 8) | 5);
    reg(bus, REG.WIN0V, (150 << 8) | 10);
    reg(bus, REG.WININ, 0x00);
    reg(bus, REG.WINOUT, 0x01);
    frame(ppu);
    expect(px(ppu, 2, 2)).toBe(BACKDROP);
    expect(px(ppu, 235, 155)).toBe(BACKDROP);
    expect(px(ppu, 100, 2)).toBe(bg);
    expect(px(ppu, 2, 80)).toBe(bg);
  });

  it('WIN0 takes priority over WIN1', () => {
    const { bus, ppu, bg } = bgSetup();
    reg(bus, REG.DISPCNT, DISP_BG0 | DISP_WIN0 | 0x4000);
    reg(bus, REG.WIN0H, (0 << 8) | 50);
    reg(bus, REG.WIN0V, (0 << 8) | 160);
    reg(bus, REG.WIN1H, (20 << 8) | 100);
    reg(bus, REG.WIN1V, (0 << 8) | 160);
    reg(bus, REG.WININ, 0x01 | (0x00 << 8)); // WIN0: BG0, WIN1: nothing
    reg(bus, REG.WINOUT, 0x01);
    frame(ppu);
    expect(px(ppu, 30, 10)).toBe(bg); // in both -> WIN0 rules
    expect(px(ppu, 60, 10)).toBe(BACKDROP); // WIN1 only
    expect(px(ppu, 150, 10)).toBe(bg); // outside
  });

  it('OBJ window reveals a layer where the window sprite is opaque', () => {
    const { bus, ppu, bg } = bgSetup();
    objTile4(bus, 1, () => 3);
    setObj(bus, 0, 50 | (2 << 10), 100, 1); // objMode 2 = OBJ window
    reg(bus, REG.DISPCNT, DISP_BG0 | DISP_OBJ | DISP_OBJWIN | DISP_OBJ_1D);
    reg(bus, REG.WINOUT, 0x00 | (0x01 << 8)); // outside: nothing; OBJ window: BG0
    frame(ppu);
    expect(px(ppu, 100, 50)).toBe(bg);
    expect(px(ppu, 107, 57)).toBe(bg);
    expect(px(ppu, 99, 50)).toBe(BACKDROP);
    expect(px(ppu, 108, 50)).toBe(BACKDROP);
  });
});

describe('colour effects', () => {
  const A = bgr(20, 10, 0);
  const B = bgr(4, 30, 16);

  function twoBgs() {
    const { bus, ppu } = setup();
    bus.pram16[0] = bgr(1, 2, 3);
    bus.pram16[1] = A;
    bus.pram16[2] = B;
    tile4(bus, 32, () => 1);
    tile4(bus, 64, () => 2);
    fillMap(bus, 8, 1);
    fillMap(bus, 9, 2);
    reg(bus, REG.BG0CNT, (8 << 8) | 0);
    reg(bus, REG.BG1CNT, (9 << 8) | 1);
    reg(bus, REG.DISPCNT, DISP_BG0 | DISP_BG1);
    return { bus, ppu };
  }

  it('alpha blends 1st target over 2nd target', () => {
    const { bus, ppu } = twoBgs();
    reg(bus, REG.BLDCNT, 0x01 | (1 << 6) | (0x02 << 8));
    reg(bus, REG.BLDALPHA, 12 | (4 << 8));
    frame(ppu);
    expect(px(ppu, 10, 10)).toBe(rgba(bgr(16, 15, 4)));
    // Coefficients clamp to 16 and channels saturate at 31.
    reg(bus, REG.BLDALPHA, 31 | (16 << 8));
    frame(ppu);
    expect(px(ppu, 10, 10)).toBe(rgba(bgr(24, 31, 16)));
    // No blend if the layer below isn't a 2nd target.
    reg(bus, REG.BLDCNT, 0x01 | (1 << 6) | (0x20 << 8));
    frame(ppu);
    expect(px(ppu, 10, 10)).toBe(rgba(A));
  });

  it('brightens and darkens 1st targets', () => {
    const { bus, ppu } = twoBgs();
    reg(bus, REG.BLDCNT, 0x01 | (2 << 6));
    reg(bus, REG.BLDY, 8);
    frame(ppu);
    expect(px(ppu, 10, 10)).toBe(rgba(bgr(25, 20, 15)));
    reg(bus, REG.BLDCNT, 0x01 | (3 << 6));
    reg(bus, REG.BLDY, 4);
    frame(ppu);
    expect(px(ppu, 10, 10)).toBe(rgba(bgr(15, 8, 0)));
    // BG1 is not a 1st target -> unaffected where it's on top.
    reg(bus, REG.DISPCNT, DISP_BG1);
    frame(ppu);
    expect(px(ppu, 10, 10)).toBe(rgba(B));
  });

  it('the window effect bit disables colour effects', () => {
    const { bus, ppu } = twoBgs();
    reg(bus, REG.BLDCNT, 0x01 | (3 << 6));
    reg(bus, REG.BLDY, 16);
    reg(bus, REG.DISPCNT, DISP_BG0 | DISP_BG1 | DISP_WIN0);
    reg(bus, REG.WIN0H, (0 << 8) | 120);
    reg(bus, REG.WIN0V, (0 << 8) | 160);
    reg(bus, REG.WININ, 0x03); // BGs, no effects
    reg(bus, REG.WINOUT, 0x23); // BGs + effects
    frame(ppu);
    expect(px(ppu, 10, 10)).toBe(rgba(A));
    expect(px(ppu, 200, 10)).toBe(rgba(0));
  });

  it('semi-transparent OBJs alpha-blend with a 2nd target regardless of mode', () => {
    const { bus, ppu } = twoBgs();
    bus.pram16[256 + 1] = bgr(31, 0, 0);
    objTile4(bus, 1, () => 1);
    setObj(bus, 0, 10 | (1 << 10), 10, 1); // objMode 1, priority 0
    reg(bus, REG.DISPCNT, DISP_BG0 | DISP_BG1 | DISP_OBJ | DISP_OBJ_1D);
    reg(bus, REG.BLDCNT, 0x01 << 8); // mode 0, 2nd target BG0
    reg(bus, REG.BLDALPHA, 8 | (8 << 8));
    frame(ppu);
    expect(px(ppu, 12, 12)).toBe(rgba(bgr((31 + 20) >> 1, 5, 0)));
    // Not over a 2nd target -> drawn normally.
    reg(bus, REG.BLDCNT, 0x02 << 8);
    frame(ppu);
    expect(px(ppu, 12, 12)).toBe(rgba(bgr(31, 0, 0)));
  });

  it('brightens the backdrop when it is a 1st target', () => {
    const { bus, ppu } = setup();
    bus.pram16[0] = bgr(0, 0, 0);
    reg(bus, REG.BLDCNT, 0x20 | (2 << 6));
    reg(bus, REG.BLDY, 16);
    frame(ppu);
    expect(px(ppu, 0, 0)).toBe(0xffffffff);
  });
});

describe('overlay pass', () => {
  it('renders only BG0 with alpha 0 elsewhere', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    tile4(bus, 32, () => 1);
    tile4(bus, 64, () => 2);
    mapEntry(bus, 8, 0, 0, 1); // BG0: one tile at the top-left
    fillMap(bus, 9, 2); // BG1: everywhere
    reg(bus, REG.BG0CNT, 8 << 8);
    reg(bus, REG.BG1CNT, (9 << 8) | 1);
    reg(bus, REG.DISPCNT, DISP_BG0 | DISP_BG1);
    ppu.overlayMask = 1;
    frame(ppu);
    expect(ov(ppu, 3, 3)).toBe(rgba(bus.pram16[1]));
    expect(ov(ppu, 100, 3)).toBe(0);
    expect(ov(ppu, 100, 100)).toBe(0);
    expect(px(ppu, 100, 3)).toBe(rgba(bus.pram16[2]));
    expect(px(ppu, 3, 3)).toBe(rgba(bus.pram16[1]));
  });

  it('is skipped when overlayMask is 0', () => {
    const { bus, ppu } = setup();
    fillPalette(bus);
    tile4(bus, 32, () => 1);
    fillMap(bus, 8, 1);
    reg(bus, REG.BG0CNT, 8 << 8);
    reg(bus, REG.DISPCNT, DISP_BG0);
    frame(ppu);
    expect(ov(ppu, 3, 3)).toBe(0);
  });
});

describe('performance', () => {
  it('renders a mode-0 frame with 4 BGs and 40 sprites quickly', () => {
    const { bus, ppu } = setup();
    let seed = 12345;
    const rnd = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed >>> 8;
    };
    for (let i = 0; i < 512; i++) bus.pram16[i] = rnd() & 0x7fff;
    for (let i = 0; i < 0x8000; i++) bus.vram[i] = rnd() & 0xff; // BG tiles (char base 0/1)
    for (let i = 0x10000; i < 0x18000; i++) bus.vram[i] = rnd() & 0xff; // OBJ tiles
    for (let bg = 0; bg < 4; bg++) {
      const sb = 28 + bg;
      for (let i = 0; i < 1024; i++) bus.vram16[((sb * 0x800) >> 1) + i] = rnd() & 0xffff & ~0x200; // tiles < 512
      reg(bus, REG.BG0CNT + bg * 2, (sb << 8) | bg);
      reg(bus, REG.BG0HOFS + bg * 4, rnd() & 0x1ff);
      reg(bus, REG.BG0VOFS + bg * 4, rnd() & 0x1ff);
    }
    for (let i = 0; i < 40; i++) {
      setObj(bus, i, rnd() % 160, (rnd() % 240) | (2 << 14), (rnd() & 0x3ff) | ((rnd() & 3) << 10) | ((rnd() & 15) << 12));
    }
    reg(bus, REG.DISPCNT, 0x0f00 | DISP_OBJ | DISP_OBJ_1D);
    reg(bus, REG.BLDCNT, 0x01 | (1 << 6) | (0x3e << 8));
    reg(bus, REG.BLDALPHA, 10 | (6 << 8));

    for (let i = 0; i < 30; i++) frame(ppu); // warm-up
    const frames = 300;
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) frame(ppu);
    const ms = (performance.now() - t0) / frames;
    ppu.overlayMask = 1;
    const t1 = performance.now();
    for (let i = 0; i < frames; i++) frame(ppu);
    const msOverlay = (performance.now() - t1) / frames;
    console.log(`PPU: ${ms.toFixed(3)} ms/frame (4 BGs + 40 32x32 OBJs, alpha blend); with overlay: ${msOverlay.toFixed(3)} ms/frame`);
    expect(ms).toBeLessThan(20); // loose sanity bound; the target is < 2 ms
  });
});
