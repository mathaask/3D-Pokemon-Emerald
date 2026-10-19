// Four DMA channels. Transfers run instantly (their cost is charged to the CPU).

import type { Bus } from './bus';

export const DMA_IMMEDIATE = 0;
export const DMA_VBLANK = 1;
export const DMA_HBLANK = 2;
export const DMA_SPECIAL = 3;

export interface DmaHost {
  raiseIrq(bit: number): void;
  chargeCycles(n: number): void;
  /** Writes to the sound FIFOs bypass the bus for speed/accuracy. */
  fifoWrite32(channel: 0 | 1, v: number): void;
}

const SRC_MASK = [0x07ffffff, 0x0fffffff, 0x0fffffff, 0x0fffffff];
const DST_MASK = [0x07ffffff, 0x07ffffff, 0x07ffffff, 0x0fffffff];

export class Dma {
  // Values as written to the registers.
  readonly sad = new Uint32Array(4);
  readonly dad = new Uint32Array(4);
  readonly cnt = new Uint16Array(4);
  readonly ctrl = new Uint16Array(4);
  // Internal running state latched on enable.
  readonly src = new Uint32Array(4);
  readonly dst = new Uint32Array(4);
  readonly count = new Uint32Array(4);

  constructor(private bus: Bus, private host: DmaHost) {}

  reset(): void {
    this.sad.fill(0); this.dad.fill(0); this.cnt.fill(0); this.ctrl.fill(0);
    this.src.fill(0); this.dst.fill(0); this.count.fill(0);
  }

  private enabled(ch: number): boolean {
    return (this.ctrl[ch] & 0x8000) !== 0;
  }

  timing(ch: number): number {
    return (this.ctrl[ch] >>> 12) & 3;
  }

  private latchCount(ch: number): void {
    const c = this.cnt[ch];
    this.count[ch] = c === 0 ? (ch === 3 ? 0x10000 : 0x4000) : c;
  }

  writeControl(ch: number, v: number): void {
    const was = this.enabled(ch);
    this.ctrl[ch] = v;
    if (!was && this.enabled(ch)) {
      this.src[ch] = this.sad[ch] & SRC_MASK[ch];
      this.dst[ch] = this.dad[ch] & DST_MASK[ch];
      this.latchCount(ch);
      if (this.timing(ch) === DMA_IMMEDIATE) this.transfer(ch);
    }
  }

  /** Runs every enabled channel waiting on the given start timing (VBlank/HBlank). */
  trigger(timing: number): void {
    for (let ch = 0; ch < 4; ch++) {
      if (this.enabled(ch) && this.timing(ch) === timing) this.transfer(ch);
    }
  }

  /** Sound FIFO request from the APU: channels 1/2 in special mode targeting the FIFO. */
  soundRequest(fifoMask: number): void {
    for (let ch = 1; ch <= 2; ch++) {
      if (!this.enabled(ch) || this.timing(ch) !== DMA_SPECIAL) continue;
      const d = this.dad[ch];
      const fifo = d === 0x040000a0 ? 0 : d === 0x040000a4 ? 1 : -1;
      if (fifo < 0 || !(fifoMask & (1 << fifo))) continue;
      // Sound DMA always moves four 32-bit words with a fixed destination.
      let src = this.src[ch];
      const srcCtl = (this.ctrl[ch] >>> 7) & 3;
      for (let k = 0; k < 4; k++) {
        this.host.fifoWrite32(fifo as 0 | 1, this.bus.read32(src & ~3));
        if (srcCtl === 0 || srcCtl === 3) src += 4;
        else if (srcCtl === 1) src -= 4;
      }
      this.src[ch] = src >>> 0;
      this.host.chargeCycles(8);
      if (this.ctrl[ch] & 0x4000) this.host.raiseIrq(1 << (8 + ch));
    }
  }

  private transfer(ch: number): void {
    const ctrl = this.ctrl[ch];
    const word = (ctrl & 0x0400) !== 0;
    const size = word ? 4 : 2;
    const dstCtl = (ctrl >>> 5) & 3;
    const srcCtl = (ctrl >>> 7) & 3;
    const dstStep = dstCtl === 0 || dstCtl === 3 ? size : dstCtl === 1 ? -size : 0;
    const srcStep = srcCtl === 0 || srcCtl === 3 ? size : srcCtl === 1 ? -size : 0;
    let src = this.src[ch];
    let dst = this.dst[ch];
    const n = this.count[ch];
    const bus = this.bus;

    if (word) {
      for (let k = 0; k < n; k++) {
        bus.write32(dst & ~3, bus.read32(src & ~3));
        src += srcStep;
        dst += dstStep;
      }
    } else {
      for (let k = 0; k < n; k++) {
        bus.write16(dst & ~1, bus.read16(src & ~1));
        src += srcStep;
        dst += dstStep;
      }
    }
    this.host.chargeCycles(n * (word ? 2 : 1) + 2);

    this.src[ch] = src >>> 0;
    this.dst[ch] = dst >>> 0;
    if (ctrl & 0x4000) this.host.raiseIrq(1 << (8 + ch));

    const repeat = (ctrl & 0x0200) !== 0 && this.timing(ch) !== DMA_IMMEDIATE;
    if (repeat) {
      this.latchCount(ch);
      if (dstCtl === 3) this.dst[ch] = this.dad[ch] & DST_MASK[ch];
    } else {
      this.ctrl[ch] &= 0x7fff;
    }
  }

  serialize(): Float64Array {
    const out = new Float64Array(4 * 7);
    for (let ch = 0; ch < 4; ch++) {
      out.set([this.sad[ch], this.dad[ch], this.cnt[ch], this.ctrl[ch], this.src[ch], this.dst[ch], this.count[ch]], ch * 7);
    }
    return out;
  }

  deserialize(d: Float64Array): void {
    for (let ch = 0; ch < 4; ch++) {
      this.sad[ch] = d[ch * 7]; this.dad[ch] = d[ch * 7 + 1]; this.cnt[ch] = d[ch * 7 + 2];
      this.ctrl[ch] = d[ch * 7 + 3]; this.src[ch] = d[ch * 7 + 4]; this.dst[ch] = d[ch * 7 + 5];
      this.count[ch] = d[ch * 7 + 6];
    }
  }
}
