// GBA PPU — scanline renderer.
//
// Each visible line is rendered in three steps:
//   1. every layer is drawn into its slice of one preallocated per-line buffer
//      (`layers`: OBJ, BG0..BG3), plus an OBJ-window mask;
//   2. the window mask is built and applied (disabled layer pixels -> transparent);
//   3. the layers are composited, colour effects applied, and the result is
//      converted BGR555 -> RGBA8888 into `framebuffer` (and the overlayMask
//      layers into `overlay`).
//
// Layer pixels are stored as sortable 32-bit keys so that the visible pixel is
// simply the smallest key at that x:
//   bits  0..14  BGR555 colour
//   bit   15     semi-transparent OBJ flag (OBJ layer only)
//   bits 16..18  layer id: 0 = OBJ, 1..4 = BG0..BG3, 5 = backdrop
//   bits 19..21  priority 0..3 (backdrop = 4)
// Lower priority number wins; on equal priority OBJ beats BGs and lower BG
// index beats higher. Transparent pixels are 0x7fffffff.
//
// Registers are read raw from bus.io16 every line, so mid-frame (HBlank)
// writes take effect on the next line as on hardware.

import { Bus } from './bus';
import { REG, SCREEN_W, SCREEN_H } from './constants';

const W = SCREEN_W;
const H = SCREEN_H;

// IO register halfword indices.
const R_DISPCNT = REG.DISPCNT >> 1;
const R_BG0CNT = REG.BG0CNT >> 1;
const R_BG0HOFS = REG.BG0HOFS >> 1;
const R_BG2PA = REG.BG2PA >> 1; // BG3 params are +8 halfwords
const R_BG2X = REG.BG2X >> 1; // BG3X is +8 halfwords
const R_WIN0H = REG.WIN0H >> 1;
const R_WIN1H = REG.WIN1H >> 1;
const R_WIN0V = REG.WIN0V >> 1;
const R_WIN1V = REG.WIN1V >> 1;
const R_WININ = REG.WININ >> 1;
const R_WINOUT = REG.WINOUT >> 1;
const R_MOSAIC = REG.MOSAIC >> 1;
const R_BLDCNT = REG.BLDCNT >> 1;
const R_BLDALPHA = REG.BLDALPHA >> 1;
const R_BLDY = REG.BLDY >> 1;

const TRANSPARENT = 0x7fffffff;
const KEY_SEMI = 0x8000;
const PRIO_SHIFT = 19;
const BACKDROP_RANK = (4 << PRIO_SHIFT) | (5 << 16);
const NUM_LAYERS = 5; // OBJ + 4 BGs

// Sprite dimensions indexed by (shape << 2) | size. Shape 3 is prohibited.
const OBJ_W = new Uint8Array([8, 16, 32, 64, 16, 32, 32, 64, 8, 8, 16, 32, 0, 0, 0, 0]);
const OBJ_H = new Uint8Array([8, 16, 32, 64, 8, 8, 16, 32, 16, 32, 32, 64, 0, 0, 0, 0]);

const OBJ_VRAM = 0x10000;

/** BGR555 -> 0xAABBGGRR (little-endian RGBA bytes), 5->8 bit expansion. */
const COLOR_LUT = (() => {
  const lut = new Uint32Array(32768);
  for (let c = 0; c < 32768; c++) {
    const r = c & 31;
    const g = (c >> 5) & 31;
    const b = (c >> 10) & 31;
    lut[c] =
      (0xff000000 |
        (((b << 3) | (b >> 2)) << 16) |
        (((g << 3) | (g >> 2)) << 8) |
        ((r << 3) | (r >> 2))) >>>
      0;
  }
  return lut;
})();

const s16 = (v: number): number => (v << 16) >> 16;

/** Reorders BG0..3/OBJ/backdrop bits (BLDCNT/WININ layout) into layer-id order (OBJ, BG0..3, backdrop). */
const toIdBits = (m: number): number => ((m >> 4) & 1) | ((m & 0xf) << 1) | (m & 0x20);

function blendAlpha(a: number, b: number, eva: number, evb: number): number {
  let r = ((a & 31) * eva + (b & 31) * evb) >> 4;
  let g = (((a >> 5) & 31) * eva + ((b >> 5) & 31) * evb) >> 4;
  let bl = (((a >> 10) & 31) * eva + ((b >> 10) & 31) * evb) >> 4;
  if (r > 31) r = 31;
  if (g > 31) g = 31;
  if (bl > 31) bl = 31;
  return r | (g << 5) | (bl << 10);
}

function brighten(c: number, evy: number): number {
  const r = c & 31;
  const g = (c >> 5) & 31;
  const b = (c >> 10) & 31;
  return (r + (((31 - r) * evy) >> 4)) | ((g + (((31 - g) * evy) >> 4)) << 5) | ((b + (((31 - b) * evy) >> 4)) << 10);
}

function darken(c: number, evy: number): number {
  const r = c & 31;
  const g = (c >> 5) & 31;
  const b = (c >> 10) & 31;
  return (r - ((r * evy) >> 4)) | ((g - ((g * evy) >> 4)) << 5) | ((b - ((b * evy) >> 4)) << 10);
}

/** Is line y inside the vertical span of a window (WINnV)? Wraps when y1 > y2. */
function inWindowV(v: number, y: number): boolean {
  const y1 = v >> 8;
  const y2 = v & 0xff;
  return y1 <= y2 ? y >= y1 && y < y2 : y >= y1 || y < y2;
}

export class Ppu {
  /** Final image, 0xAABBGGRR per pixel. */
  framebuffer = new Uint32Array(W * H);
  /** Only layers selected by overlayMask; alpha 0 where none of them is opaque. */
  overlay = new Uint32Array(W * H);
  /** bit0..3 = BG0..BG3, bit4 = OBJ. 0 disables the overlay pass. */
  overlayMask = 0;

  private readonly io16: Uint16Array;
  private readonly vram: Uint8Array;
  private readonly vram16: Uint16Array;
  private readonly vram32: Int32Array;
  private readonly pram16: Uint16Array;
  private readonly oam16: Uint16Array;

  /** Per-line layer keys: layer id L occupies [L*W, L*W+W). */
  private readonly layers = new Int32Array(NUM_LAYERS * W);
  private readonly objWinLine = new Uint8Array(W); // 1 where an OBJ-window sprite is opaque
  private readonly winLine = new Uint8Array(W); // per-pixel WININ/WINOUT bits (0..3 BG, 4 OBJ, 5 effects)
  private winActive = false;
  private semiObjOnLine = false;
  private enabledLayers = 0; // bit per layer id drawn this line

  // Internal affine reference points for BG2 [0] and BG3 [1] (signed, 8 fractional bits).
  private readonly refX = new Int32Array(2);
  private readonly refY = new Int32Array(2);
  // Register halfwords (X lo/hi, Y lo/hi per BG) as of the last reload, to tell which one was written.
  private readonly refRegs = new Uint16Array(8);

  constructor(bus: Bus) {
    this.io16 = bus.io16;
    this.vram = bus.vram;
    this.vram16 = bus.vram16;
    this.vram32 = bus.vram32;
    this.pram16 = bus.pram16;
    this.oam16 = bus.oam16;
    this.reset();
  }

  /** Clears the output images and internal affine state (overlayMask is host config and kept). */
  reset(): void {
    this.framebuffer.fill(0xff000000);
    this.overlay.fill(0);
    this.layers.fill(TRANSPARENT);
    this.refX.fill(0);
    this.refY.fill(0);
    this.refRegs.fill(0);
  }

  /**
   * IO hook: BGnX/BGnY was written — the internal reference point reloads immediately.
   * Hardware reloads only the written coordinate (X keeps accumulating PB while Y is
   * rewritten, and vice versa; wave effects rely on this). The caller doesn't say
   * which register it wrote, so reload whichever coordinate changed since we last
   * looked. Rewriting an identical value is therefore a no-op, which only differs
   * from hardware when PB/PD for that coordinate is non-zero.
   */
  affineRefWritten(bg: 2 | 3): void {
    const i = bg - 2;
    const io = this.io16;
    const r = R_BG2X + i * 8;
    const s = this.refRegs;
    const o = i * 4;
    if (io[r] !== s[o] || io[r + 1] !== s[o + 1]) {
      s[o] = io[r];
      s[o + 1] = io[r + 1];
      this.refX[i] = ((io[r] | (io[r + 1] << 16)) << 4) >> 4;
    }
    if (io[r + 2] !== s[o + 2] || io[r + 3] !== s[o + 3]) {
      s[o + 2] = io[r + 2];
      s[o + 3] = io[r + 3];
      this.refY[i] = ((io[r + 2] | (io[r + 3] << 16)) << 4) >> 4;
    }
  }

  renderScanline(y: number): void {
    if (y < 0 || y >= H) return;
    // Hardware reloads the internal reference points during VBlank; doing it
    // at the start of line 0 is equivalent.
    if (y === 0) {
      this.reloadRef(0);
      this.reloadRef(1);
    }
    const dispcnt = this.io16[R_DISPCNT];
    const row = y * W;
    if (dispcnt & 0x80) {
      // Forced blank: the LCD shows white.
      this.framebuffer.fill(0xffffffff, row, row + W);
      if (this.overlayMask) this.overlay.fill(0, row, row + W);
    } else {
      this.renderLayers(y, dispcnt);
      this.applyWindows(y, dispcnt);
      this.composite(y);
      if (this.overlayMask) this.compositeOverlay(y);
    }
    // The affine units advance by PB/PD after every line, displayed or not.
    const io = this.io16;
    this.refX[0] += s16(io[R_BG2PA + 1]);
    this.refY[0] += s16(io[R_BG2PA + 3]);
    this.refX[1] += s16(io[R_BG2PA + 9]);
    this.refY[1] += s16(io[R_BG2PA + 11]);
  }

  // ---------------------------------------------------------------------------
  // Layer rendering

  private reloadRef(i: number): void {
    const io = this.io16;
    const r = R_BG2X + i * 8;
    // 28-bit signed values: sign-extend from bit 27.
    this.refX[i] = ((io[r] | (io[r + 1] << 16)) << 4) >> 4;
    this.refY[i] = ((io[r + 2] | (io[r + 3] << 16)) << 4) >> 4;
    const s = this.refRegs;
    const o = i * 4;
    s[o] = io[r];
    s[o + 1] = io[r + 1];
    s[o + 2] = io[r + 2];
    s[o + 3] = io[r + 3];
  }

  private renderLayers(y: number, dispcnt: number): void {
    const mode = dispcnt & 7;
    // Which BGs exist in this mode (bit n = BGn), then which are enabled.
    const bgsInMode = mode === 0 ? 0xf : mode === 1 ? 0x7 : mode === 2 ? 0xc : mode <= 5 ? 0x4 : 0;
    const bgs = (dispcnt >> 8) & bgsInMode;
    for (let bg = 0; bg < 4; bg++) {
      if (bgs & (1 << bg)) {
        if (mode === 0 || (mode === 1 && bg < 2)) this.renderTextBg(bg, y);
        else if (mode <= 2) this.renderAffineBg(bg, y);
        else this.renderBitmapBg(mode, dispcnt, y);
      } else {
        const off = (bg + 1) * W;
        this.layers.fill(TRANSPARENT, off, off + W);
      }
    }
    this.enabledLayers = bgs << 1;

    this.layers.fill(TRANSPARENT, 0, W);
    this.objWinLine.fill(0);
    this.semiObjOnLine = false;
    if (dispcnt & 0x1000) {
      this.renderSprites(y, dispcnt, mode >= 3);
      this.enabledLayers |= 1;
    }
  }

  /** Horizontal mosaic: each pixel repeats the leftmost pixel of its block. */
  private mosaicH(off: number, size: number): void {
    const buf = this.layers;
    let src = 0;
    let n = 0;
    for (let x = 0; x < W; x++) {
      if (n === 0) src = buf[off + x];
      else buf[off + x] = src;
      if (++n === size) n = 0;
    }
  }

  private renderTextBg(bg: number, y: number): void {
    const io = this.io16;
    const vram = this.vram;
    const vram16 = this.vram16;
    const vram32 = this.vram32;
    const pram = this.pram16;
    const out = this.layers;
    const off = (bg + 1) * W;

    const cnt = io[R_BG0CNT + bg];
    const rank = ((cnt & 3) << PRIO_SHIFT) | ((bg + 1) << 16);
    const hofs = io[R_BG0HOFS + bg * 2] & 0x1ff;
    const vofs = io[R_BG0HOFS + bg * 2 + 1] & 0x1ff;
    const charBase = ((cnt >> 2) & 3) * 0x4000;
    const screenBase = ((cnt >> 8) & 0x1f) * 0x800;
    const is8 = (cnt & 0x80) !== 0;
    const size = cnt >> 14;
    const wMask = size & 1 ? 511 : 255;
    const hMask = size & 2 ? 511 : 255;
    const mosaic = (cnt & 0x40) !== 0;
    const mos = io[R_MOSAIC];

    let line = y;
    if (mosaic) line -= y % (((mos >> 4) & 15) + 1);
    const by = (line + vofs) & hMask;
    const tileY = by >> 3;
    const fineY = by & 7;

    // Screen blocks are 32x32 entries (2 KB). 512-wide maps put the right
    // half in the next block; 512-tall maps put the bottom half after the
    // top row of blocks (+1 block for 256-wide, +2 for 512-wide).
    let rowAddr = screenBase + ((tileY & 31) << 6);
    if (tileY & 32) rowAddr += size === 3 ? 0x1000 : 0x800;

    let x = 0;
    let bx = hofs & wMask;
    while (x < W) {
      const tileX = bx >> 3;
      let mapAddr = rowAddr + ((tileX & 31) << 1);
      if (tileX & 32) mapAddr += 0x800;
      const entry = vram16[(mapAddr & 0xffff) >> 1];
      const tile = entry & 0x3ff;
      const hflip = (entry & 0x400) !== 0;
      const ty = entry & 0x800 ? 7 - fineY : fineY;
      const px = bx & 7;
      let n = 8 - px;
      if (n > W - x) n = W - x;
      bx = (bx + n) & wMask;
      const end = x + n;

      if (is8) {
        const base = charBase + tile * 64 + ty * 8;
        if (base >= OBJ_VRAM) {
          // BGs cannot fetch from OBJ VRAM.
          for (; x < end; x++) out[off + x] = TRANSPARENT;
          continue;
        }
        const step = hflip ? -1 : 1;
        for (let p = base + (hflip ? 7 - px : px); x < end; x++, p += step) {
          const ci = vram[p];
          out[off + x] = rank | pram[ci] | (((ci - 1) >> 31) & TRANSPARENT);
        }
      } else {
        const base = charBase + tile * 32 + ty * 4;
        const word = base < OBJ_VRAM ? vram32[base >> 2] : 0;
        if (word === 0) {
          for (; x < end; x++) out[off + x] = TRANSPARENT;
          continue;
        }
        const pal = (entry >> 12) << 4;
        const step = hflip ? -4 : 4;
        for (let sh = (hflip ? 7 - px : px) << 2; x < end; x++, sh += step) {
          const ci = (word >>> sh) & 15;
          // Branchless "ci ? key : TRANSPARENT": (ci - 1) >> 31 is -1 only for ci = 0.
          out[off + x] = rank | pram[pal + ci] | (((ci - 1) >> 31) & TRANSPARENT);
        }
      }
    }

    if (mosaic) {
      const mh = (mos & 15) + 1;
      if (mh > 1) this.mosaicH(off, mh);
    }
  }

  private renderAffineBg(bg: number, y: number): void {
    const io = this.io16;
    const vram = this.vram;
    const pram = this.pram16;
    const out = this.layers;
    const off = (bg + 1) * W;
    const i = bg - 2;
    const p = R_BG2PA + i * 8;
    const pa = s16(io[p]);
    const pb = s16(io[p + 1]);
    const pc = s16(io[p + 2]);
    const pd = s16(io[p + 3]);

    const cnt = io[R_BG0CNT + bg];
    const rank = ((cnt & 3) << PRIO_SHIFT) | ((bg + 1) << 16);
    const charBase = ((cnt >> 2) & 3) * 0x4000;
    const screenBase = ((cnt >> 8) & 0x1f) * 0x800;
    const sizeShift = 7 + (cnt >> 14); // 128, 256, 512, 1024
    const sizeMask = (1 << sizeShift) - 1;
    const tilesPerRowShift = sizeShift - 3;
    const wrap = (cnt & 0x2000) !== 0;
    const mosaic = (cnt & 0x40) !== 0;
    const mos = io[R_MOSAIC];

    let rx = this.refX[i];
    let ry = this.refY[i];
    if (mosaic) {
      // Vertical mosaic: reuse the reference point of the block's first line.
      const m = y % (((mos >> 4) & 15) + 1);
      rx -= m * pb;
      ry -= m * pd;
    }

    for (let x = 0; x < W; x++, rx += pa, ry += pc) {
      let tx = rx >> 8;
      let ty = ry >> 8;
      if (wrap) {
        tx &= sizeMask;
        ty &= sizeMask;
      } else if ((tx | ty) & ~sizeMask) {
        out[off + x] = TRANSPARENT; // outside the map (also catches negatives)
        continue;
      }
      const tile = vram[screenBase + ((ty >> 3) << tilesPerRowShift) + (tx >> 3)];
      const addr = charBase + tile * 64 + ((ty & 7) << 3) + (tx & 7);
      const ci = addr < OBJ_VRAM ? vram[addr] : 0;
      out[off + x] = ci ? rank | pram[ci] : TRANSPARENT;
    }

    if (mosaic) {
      const mh = (mos & 15) + 1;
      if (mh > 1) this.mosaicH(off, mh);
    }
  }

  /** Modes 3/4/5: BG2 is a bitmap, still transformed by the BG2 affine unit (no wrap). */
  private renderBitmapBg(mode: number, dispcnt: number, y: number): void {
    const io = this.io16;
    const out = this.layers;
    const off = 3 * W;
    const pa = s16(io[R_BG2PA]);
    const pb = s16(io[R_BG2PA + 1]);
    const pc = s16(io[R_BG2PA + 2]);
    const pd = s16(io[R_BG2PA + 3]);
    const cnt = io[R_BG0CNT + 2];
    const rank = ((cnt & 3) << PRIO_SHIFT) | (3 << 16);
    const mosaic = (cnt & 0x40) !== 0;
    const mos = io[R_MOSAIC];

    let rx = this.refX[0];
    let ry = this.refY[0];
    if (mosaic) {
      const m = y % (((mos >> 4) & 15) + 1);
      rx -= m * pb;
      ry -= m * pd;
    }

    const frame = dispcnt & 0x10 ? 0xa000 : 0; // modes 4/5 page select
    if (mode === 3) {
      const v16 = this.vram16;
      for (let x = 0; x < W; x++, rx += pa, ry += pc) {
        const tx = rx >> 8;
        const ty = ry >> 8;
        out[off + x] = tx >= 0 && tx < 240 && ty >= 0 && ty < 160 ? rank | v16[ty * 240 + tx] : TRANSPARENT;
      }
    } else if (mode === 4) {
      const vram = this.vram;
      const pram = this.pram16;
      for (let x = 0; x < W; x++, rx += pa, ry += pc) {
        const tx = rx >> 8;
        const ty = ry >> 8;
        let k = TRANSPARENT;
        if (tx >= 0 && tx < 240 && ty >= 0 && ty < 160) {
          const ci = vram[frame + ty * 240 + tx];
          if (ci) k = rank | pram[ci];
        }
        out[off + x] = k;
      }
    } else {
      const v16 = this.vram16;
      const base = frame >> 1;
      for (let x = 0; x < W; x++, rx += pa, ry += pc) {
        const tx = rx >> 8;
        const ty = ry >> 8;
        out[off + x] = tx >= 0 && tx < 160 && ty >= 0 && ty < 128 ? rank | v16[base + ty * 160 + tx] : TRANSPARENT;
      }
    }

    if (mosaic) {
      const mh = (mos & 15) + 1;
      if (mh > 1) this.mosaicH(off, mh);
    }
  }

  /** Colour index of OBJ texel (tx, ty) for a sprite whose tile row starts at `rowTile`. 0 = transparent. */
  private objTexel(rowTile: number, is8: boolean, tx: number, fineY: number): number {
    if (is8) {
      return this.vram[OBJ_VRAM + (((rowTile + ((tx >> 3) << 1)) * 32 + fineY * 8 + (tx & 7)) & 0x7fff)];
    }
    const b = this.vram[OBJ_VRAM + (((rowTile + (tx >> 3)) * 32 + fineY * 4 + ((tx & 7) >> 1)) & 0x7fff)];
    return tx & 1 ? b >> 4 : b & 15;
  }

  private renderSprites(y: number, dispcnt: number, bitmapMode: boolean): void {
    const oam = this.oam16;
    const pram = this.pram16;
    const vram = this.vram;
    const vram32 = this.vram32;
    const out = this.layers; // OBJ layer is id 0 -> offset 0
    const objWin = this.objWinLine;
    const map1D = (dispcnt & 0x40) !== 0;
    const mos = this.io16[R_MOSAIC];
    const mosH = ((mos >> 8) & 15) + 1;
    const mosV = ((mos >> 12) & 15) + 1;

    // OAM order: lower index is drawn first and keeps the pixel on equal
    // priority; a later sprite replaces it only with a strictly lower priority value.
    for (let i = 0; i < 128; i++) {
      const o = i << 2;
      const a0 = oam[o];
      const affine = (a0 & 0x100) !== 0;
      if (!affine && a0 & 0x200) continue; // disabled
      const objMode = (a0 >> 10) & 3;
      if (objMode === 3) continue; // prohibited
      const shape = a0 >> 14;
      if (shape === 3) continue;
      const a1 = oam[o + 1];
      const sz = (shape << 2) | (a1 >> 14);
      const w = OBJ_W[sz];
      const h = OBJ_H[sz];
      const dbl = affine && (a0 & 0x200) !== 0;
      const bw = dbl ? w << 1 : w;
      const bh = dbl ? h << 1 : h;

      // Y is 8-bit and wraps: sprites near y=255 show at the top of the screen.
      let ly = (y - (a0 & 0xff)) & 0xff;
      if (ly >= bh) continue;
      const sx = ((a1 & 0x1ff) << 23) >> 23; // 9-bit signed X
      if (sx >= W || sx + bw <= 0) continue;

      const a2 = oam[o + 2];
      let tile = a2 & 0x3ff;
      if (bitmapMode && tile < 512) continue; // that OBJ VRAM half holds the bitmap

      const mosaic = (a0 & 0x1000) !== 0;
      if (mosaic && mosV > 1) {
        ly -= y % mosV; // screen-aligned mosaic grid
        if (ly < 0) ly = 0;
      }
      const mosX = mosaic && mosH > 1;

      const prio = (a2 >> 10) & 3;
      const rank = (prio << PRIO_SHIFT) | (objMode === 1 ? KEY_SEMI : 0);
      const isWin = objMode === 2;
      if (objMode === 1) this.semiObjOnLine = true;
      const is8 = (a0 & 0x2000) !== 0;
      const palBase = is8 ? 256 : 256 + ((a2 >> 12) << 4);
      // Tile-row stride in 32-byte units.
      let stride: number;
      if (map1D) {
        stride = is8 ? w >> 2 : w >> 3;
      } else {
        stride = 32;
        if (is8) tile &= ~1; // 2D 8bpp ignores the low tile bit
      }

      const x0 = sx < 0 ? 0 : sx;
      const x1 = sx + bw > W ? W : sx + bw;

      if (!affine && !mosX) {
        // Regular sprite: walk the visible span one tile column at a time.
        const flipH = (a1 & 0x1000) !== 0;
        const ty = a1 & 0x2000 ? h - 1 - ly : ly;
        const rowTile = tile + (ty >> 3) * stride;
        const fineY = ty & 7;
        const dir = flipH ? -1 : 1;
        let x = x0;
        let tx = flipH ? w - 1 - (x0 - sx) : x0 - sx;
        while (x < x1) {
          let n = flipH ? (tx & 7) + 1 : 8 - (tx & 7);
          if (n > x1 - x) n = x1 - x;
          const end = x + n;
          if (is8) {
            const base = OBJ_VRAM + (((rowTile + ((tx >> 3) << 1)) * 32 + fineY * 8) & 0x7fff);
            for (; x < end; x++, tx += dir) {
              const ci = vram[base + (tx & 7)];
              if (ci === 0) continue;
              if (isWin) objWin[x] = 1;
              else if (out[x] >> PRIO_SHIFT > prio) out[x] = rank | (pram[palBase + ci] & 0x7fff);
            }
          } else {
            const word = vram32[(OBJ_VRAM + (((rowTile + (tx >> 3)) * 32 + fineY * 4) & 0x7fff)) >> 2];
            if (word === 0) {
              x = end;
              tx += n * dir;
              continue;
            }
            for (; x < end; x++, tx += dir) {
              const ci = (word >>> ((tx & 7) << 2)) & 15;
              if (ci === 0) continue;
              if (isWin) objWin[x] = 1;
              else if (out[x] >> PRIO_SHIFT > prio) out[x] = rank | (pram[palBase + ci] & 0x7fff);
            }
          }
        }
      } else if (!affine) {
        // Regular sprite with horizontal mosaic (screen-aligned blocks).
        const flipH = (a1 & 0x1000) !== 0;
        const ty = a1 & 0x2000 ? h - 1 - ly : ly;
        const rowTile = tile + (ty >> 3) * stride;
        for (let x = x0; x < x1; x++) {
          let lx = x - sx - (x % mosH);
          if (lx < 0) lx = 0;
          const ci = this.objTexel(rowTile, is8, flipH ? w - 1 - lx : lx, ty & 7);
          if (ci === 0) continue;
          if (isWin) objWin[x] = 1;
          else if (out[x] >> PRIO_SHIFT > prio) out[x] = rank | (pram[palBase + ci] & 0x7fff);
        }
      } else {
        // Affine: texel = P * (pixel - bbox centre) + sprite centre. The params
        // live in the 4th halfword of 4 consecutive OAM entries.
        const p = ((a1 >> 9) & 31) << 4;
        const pa = s16(oam[p + 3]);
        const pb = s16(oam[p + 7]);
        const pc = s16(oam[p + 11]);
        const pd = s16(oam[p + 15]);
        const iy = ly - (bh >> 1);
        const hw = w >> 1;
        const hh = h >> 1;
        const halfBW = bw >> 1;
        for (let x = x0; x < x1; x++) {
          let lx = x - sx;
          if (mosX) {
            lx -= x % mosH;
            if (lx < 0) lx = 0;
          }
          const ix = lx - halfBW;
          const tx = ((pa * ix + pb * iy) >> 8) + hw;
          const ty = ((pc * ix + pd * iy) >> 8) + hh;
          if (tx < 0 || tx >= w || ty < 0 || ty >= h) continue;
          const ci = this.objTexel(tile + (ty >> 3) * stride, is8, tx, ty & 7);
          if (ci === 0) continue;
          if (isWin) objWin[x] = 1;
          else if (out[x] >> PRIO_SHIFT > prio) out[x] = rank | (pram[palBase + ci] & 0x7fff);
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Windows

  private fillWinH(h: number, bits: number): void {
    const x1 = h >> 8;
    let x2 = h & 0xff;
    if (x2 > W) x2 = W;
    const win = this.winLine;
    if (x1 <= x2) {
      win.fill(bits, x1, x2);
    } else {
      // x1 > x2 wraps around: [x1, 240) + [0, x2)
      win.fill(bits, 0, x2);
      if (x1 < W) win.fill(bits, x1, W);
    }
  }

  /** Builds the per-pixel window mask and removes window-disabled layer pixels. */
  private applyWindows(y: number, dispcnt: number): void {
    if (!(dispcnt & 0xe000)) {
      this.winActive = false;
      return;
    }
    this.winActive = true;
    const io = this.io16;
    const winin = io[R_WININ];
    const winout = io[R_WINOUT];
    const win = this.winLine;
    win.fill(winout & 0x3f);
    // Priority: WIN0 > WIN1 > OBJ window > outside, so paint in reverse.
    if (dispcnt & 0x8000) {
      const objBits = (winout >> 8) & 0x3f;
      const objWin = this.objWinLine;
      for (let x = 0; x < W; x++) if (objWin[x]) win[x] = objBits;
    }
    if (dispcnt & 0x4000 && inWindowV(io[R_WIN1V], y)) this.fillWinH(io[R_WIN1H], (winin >> 8) & 0x3f);
    if (dispcnt & 0x2000 && inWindowV(io[R_WIN0V], y)) this.fillWinH(io[R_WIN0H], winin & 0x3f);

    const layers = this.layers;
    const enabled = this.enabledLayers;
    for (let id = 0; id < NUM_LAYERS; id++) {
      if (!(enabled & (1 << id))) continue;
      const bit = id === 0 ? 0x10 : 1 << (id - 1);
      const off = id * W;
      for (let x = 0; x < W; x++) if (!(win[x] & bit)) layers[off + x] = TRANSPARENT;
    }
  }

  // ---------------------------------------------------------------------------
  // Compositing

  private composite(y: number): void {
    const io = this.io16;
    const L = this.layers;
    const fb = this.framebuffer;
    const lut = COLOR_LUT;
    const win = this.winLine;
    const winActive = this.winActive;
    const bdKey = BACKDROP_RANK | (this.pram16[0] & 0x7fff);
    const row = y * W;

    const bldcnt = io[R_BLDCNT];
    const effect = (bldcnt >> 6) & 3;
    const t1 = toIdBits(bldcnt & 0x3f);
    const t2 = toIdBits((bldcnt >> 8) & 0x3f);
    const bldalpha = io[R_BLDALPHA];
    let eva = bldalpha & 31;
    let evb = (bldalpha >> 8) & 31;
    let evy = io[R_BLDY] & 31;
    if (eva > 16) eva = 16;
    if (evb > 16) evb = 16;
    if (evy > 16) evy = 16;

    if (effect !== 1 && !this.semiObjOnLine) {
      // Only the top pixel matters (no effect, or brighten/darken).
      for (let x = 0; x < W; x++) {
        let k = bdKey;
        let v = L[x];
        if (v < k) k = v;
        v = L[x + W];
        if (v < k) k = v;
        v = L[x + 2 * W];
        if (v < k) k = v;
        v = L[x + 3 * W];
        if (v < k) k = v;
        v = L[x + 4 * W];
        if (v < k) k = v;
        let c = k & 0x7fff;
        if (effect !== 0 && (t1 >> ((k >> 16) & 7)) & 1 && (!winActive || win[x] & 0x20)) {
          c = effect === 2 ? brighten(c, evy) : darken(c, evy);
        }
        fb[row + x] = lut[c];
      }
      return;
    }

    // Alpha blending needs the top two layers: smallest and second-smallest key.
    for (let x = 0; x < W; x++) {
      let m1 = bdKey;
      let m2 = TRANSPARENT; // layer id 7 = "nothing below the backdrop"
      let v = L[x];
      if (v < m1) {
        m2 = m1;
        m1 = v;
      }
      v = L[x + W];
      if (v < m1) {
        m2 = m1;
        m1 = v;
      } else if (v < m2) m2 = v;
      v = L[x + 2 * W];
      if (v < m1) {
        m2 = m1;
        m1 = v;
      } else if (v < m2) m2 = v;
      v = L[x + 3 * W];
      if (v < m1) {
        m2 = m1;
        m1 = v;
      } else if (v < m2) m2 = v;
      v = L[x + 4 * W];
      if (v < m1) {
        m2 = m1;
        m1 = v;
      } else if (v < m2) m2 = v;
      let c = m1 & 0x7fff;
      if (!winActive || win[x] & 0x20) {
        const topId = (m1 >> 16) & 7;
        const botIs2nd = (t2 >> ((m2 >> 16) & 7)) & 1;
        if (topId === 0 && m1 & KEY_SEMI && botIs2nd) {
          // Semi-transparent OBJs alpha-blend with a 2nd target regardless of the BLDCNT mode.
          c = blendAlpha(c, m2, eva, evb);
        } else if ((t1 >> topId) & 1) {
          if (effect === 1) {
            if (botIs2nd) c = blendAlpha(c, m2, eva, evb);
          } else if (effect === 2) c = brighten(c, evy);
          else if (effect === 3) c = darken(c, evy);
        }
      }
      fb[row + x] = lut[c];
    }
  }

  /** Top-most opaque pixel among the overlayMask layers (same priority/window rules, no effects). */
  private compositeOverlay(y: number): void {
    const L = this.layers;
    const ov = this.overlay;
    const lut = COLOR_LUT;
    const sel = toIdBits(this.overlayMask & 0x1f);
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let k = TRANSPARENT;
      for (let id = 0; id < NUM_LAYERS; id++) {
        if (!(sel & (1 << id))) continue;
        const v = L[id * W + x];
        if (v < k) k = v;
      }
      ov[row + x] = k === TRANSPARENT ? 0 : lut[k & 0x7fff];
    }
  }
}
