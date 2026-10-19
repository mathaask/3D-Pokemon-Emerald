// High-level emulation of the GBA BIOS. The real BIOS ROM is not required:
// a tiny ARM stub provides the IRQ vector, and SWIs are implemented in TS.

import type { Bus } from './bus';
import type { Cpu } from './cpu';
import type { Io } from './io';
import { REG } from './constants';

// ARM code placed at the exception vectors.
const STUB: [number, number][] = [
  [0x00, 0xea00001e], // reset: b 0x80 (never used: we boot straight into the cartridge)
  [0x08, 0xe1b0f00e], // swi: movs pc, lr (SWIs are intercepted before reaching here)
  [0x18, 0xe92d500f], // irq: stmfd sp!, {r0-r3, r12, lr}
  [0x1c, 0xe3a00301], //      mov r0, #0x04000000
  [0x20, 0xe28fe000], //      add lr, pc, #0
  [0x24, 0xe510f004], //      ldr pc, [r0, #-4]   (user handler at 0x03007FFC)
  [0x28, 0xe8bd500f], //      ldmfd sp!, {r0-r3, r12, lr}
  [0x2c, 0xe25ef004], //      subs pc, lr, #4
  [0x80, 0xeafffffe], // b . (idle loop)
];

const BIOS_IF = 0x03007ff8;

export class Bios {
  /** True while an IntrWait is in progress (the SWI is being re-executed). */
  private waiting = false;
  logUnknown: (n: number) => void = () => {};

  constructor(private bus: Bus, private cpu: Cpu, private io: Io) {
    for (const [addr, word] of STUB) {
      bus.bios32[addr >>> 2] = word;
    }
    cpu.swiHandler = (n) => this.swi(n);
  }

  swi(n: number): void {
    const r = this.cpu.r;
    switch (n) {
      case 0x00: this.softReset(); break;
      case 0x01: this.registerRamReset(r[0]); break;
      case 0x02: this.cpu.halted = true; this.io.updateIrq(); break;
      case 0x03: this.cpu.halted = true; this.io.updateIrq(); break;
      case 0x04: this.intrWait(r[0] !== 0, r[1]); break;
      case 0x05: this.intrWait(true, 1); break;
      case 0x06: this.div(r[0], r[1]); break;
      case 0x07: this.div(r[1], r[0]); break;
      case 0x08: r[0] = Math.floor(Math.sqrt(r[0] >>> 0)); break;
      case 0x09: r[0] = this.arcTan(r[0]); break;
      case 0x0a: r[0] = this.arcTan2(r[0], r[1]); break;
      case 0x0b: this.cpuSet(r[0], r[1], r[2]); break;
      case 0x0c: this.cpuFastSet(r[0], r[1], r[2]); break;
      case 0x0d: r[0] = 0xbaae187f | 0; break;
      case 0x0e: this.bgAffineSet(r[0], r[1], r[2]); break;
      case 0x0f: this.objAffineSet(r[0], r[1], r[2], r[3]); break;
      case 0x10: this.bitUnPack(r[0], r[1], r[2]); break;
      case 0x11: this.writeOut(r[1], this.lz77(r[0]), false); break;
      case 0x12: this.writeOut(r[1], this.lz77(r[0]), true); break;
      case 0x13: this.writeOut(r[1], this.huffman(r[0]), true); break;
      case 0x14: this.writeOut(r[1], this.rl(r[0]), false); break;
      case 0x15: this.writeOut(r[1], this.rl(r[0]), true); break;
      case 0x16: this.diffUnFilter(r[0], r[1], 1, false); break;
      case 0x17: this.diffUnFilter(r[0], r[1], 1, true); break;
      case 0x18: this.diffUnFilter(r[0], r[1], 2, true); break;
      case 0x19: this.soundBias(r[0]); break;
      case 0x1f: r[0] = this.midiKey2Freq(r[0], r[1] & 0xff, r[2] & 0xff); break;
      default: this.logUnknown(n); break;
    }
  }

  // ---------------------------------------------------------------- system

  private softReset(): void {
    const bus = this.bus;
    const flag = bus.read8(0x03007ffa);
    for (let a = 0x7e00; a < 0x8000; a++) bus.iwram[a] = 0;
    this.cpu.skipBios(flag ? 0x02000000 : 0x08000000);
  }

  private registerRamReset(flags: number): void {
    const bus = this.bus;
    if (flags & 0x01) bus.ewram.fill(0);
    if (flags & 0x02) bus.iwram.fill(0, 0, 0x7e00);
    if (flags & 0x04) { bus.pram.fill(0); bus.pramDirty = true; }
    if (flags & 0x08) { bus.vram.fill(0); bus.vramDirty = true; }
    if (flags & 0x10) { bus.oam.fill(0); bus.oamDirty = true; }
    if (flags & 0x40) {
      for (let off = 0x60; off < 0xa8; off += 2) this.io.write16(off, 0);
    }
    if (flags & 0x80) {
      for (let off = 0; off < 0x60; off += 2) if (off !== REG.VCOUNT && off !== REG.DISPSTAT) this.io.write16(off, 0);
      this.io.write16(REG.DISPCNT, 0x80);
      this.io.write16(REG.BG2PA, 0x100); this.io.write16(REG.BG2PD, 0x100);
      this.io.write16(REG.BG3PA, 0x100); this.io.write16(REG.BG3PD, 0x100);
    }
  }

  /**
   * IntrWait: halts until one of `flags` is set in the BIOS interrupt-check word
   * (0x03007FF8, written by the game's IRQ handler). Implemented by halting and
   * re-executing the SWI instruction after each interrupt.
   */
  private intrWait(discard: boolean, flags: number): void {
    const bus = this.bus;
    this.io.write16(REG.IME, 1);
    if (!this.waiting && discard) {
      bus.write16(BIOS_IF, bus.read16(BIOS_IF) & ~flags);
    }
    const cur = bus.read16(BIOS_IF);
    if (cur & flags) {
      bus.write16(BIOS_IF, cur & ~flags);
      this.waiting = false;
      return;
    }
    this.waiting = true;
    this.cpu.halted = true;
    this.cpu.branch(this.cpu.currentPC()); // run this SWI again after the IRQ returns
    this.io.updateIrq();
  }

  // ---------------------------------------------------------------- math

  private div(num: number, den: number): void {
    const r = this.cpu.r;
    if (den === 0) {
      // Real BIOS loops forever on 0 divisors in some cases; return sane values instead.
      r[0] = num < 0 ? -1 : 1;
      r[1] = num;
      r[3] = 1;
      return;
    }
    if (num === -0x80000000 && den === -1) {
      r[0] = -0x80000000; r[1] = 0; r[3] = 0x80000000 | 0;
      return;
    }
    const q = (num / den) | 0;
    r[0] = q;
    r[1] = (num - Math.imul(q, den)) | 0;
    r[3] = Math.abs(q) | 0;
  }

  private arcTan(x: number): number {
    // BIOS polynomial approximation (input/output in 1.14 fixed point).
    const a = -((Math.imul(x, x)) >> 14);
    let b = ((0xa9 * a) >> 14) + 0x390;
    b = ((b * a) >> 14) + 0x91c;
    b = ((b * a) >> 14) + 0xfb6;
    b = ((b * a) >> 14) + 0x16aa;
    b = ((b * a) >> 14) + 0x2081;
    b = ((b * a) >> 14) + 0x3651;
    b = ((b * a) >> 14) + 0xa2f9;
    return (Math.imul(x, b) >> 16) | 0;
  }

  private arcTan2(x: number, y: number): number {
    x = (x << 16) >> 16;
    y = (y << 16) >> 16;
    if (x === 0 && y === 0) return 0;
    let ang = Math.atan2(y, x);
    if (ang < 0) ang += Math.PI * 2;
    return Math.round((ang / (Math.PI * 2)) * 0x10000) & 0xffff;
  }

  // ---------------------------------------------------------------- memory copy

  private cpuSet(src: number, dst: number, cnt: number): void {
    const bus = this.bus;
    const count = cnt & 0x1fffff;
    const fill = (cnt & (1 << 24)) !== 0;
    if (cnt & (1 << 26)) {
      src &= ~3; dst &= ~3;
      if (fill) {
        const v = bus.read32(src);
        for (let k = 0; k < count; k++) bus.write32(dst + k * 4, v);
      } else {
        for (let k = 0; k < count; k++) bus.write32(dst + k * 4, bus.read32(src + k * 4));
      }
    } else {
      src &= ~1; dst &= ~1;
      if (fill) {
        const v = bus.read16(src);
        for (let k = 0; k < count; k++) bus.write16(dst + k * 2, v);
      } else {
        for (let k = 0; k < count; k++) bus.write16(dst + k * 2, bus.read16(src + k * 2));
      }
    }
    this.cpu.cycles += count * 2;
  }

  private cpuFastSet(src: number, dst: number, cnt: number): void {
    const bus = this.bus;
    const count = ((cnt & 0x1fffff) + 7) & ~7;
    src &= ~3; dst &= ~3;
    if (cnt & (1 << 24)) {
      const v = bus.read32(src);
      for (let k = 0; k < count; k++) bus.write32(dst + k * 4, v);
    } else {
      for (let k = 0; k < count; k++) bus.write32(dst + k * 4, bus.read32(src + k * 4));
    }
    this.cpu.cycles += count;
  }

  // ---------------------------------------------------------------- affine helpers

  private sinLut(angle: number): number {
    return Math.round(Math.sin((angle / 256) * Math.PI * 2) * 0x4000);
  }

  private bgAffineSet(src: number, dst: number, count: number): void {
    const bus = this.bus;
    for (let k = 0; k < count; k++) {
      const ox = bus.read32(src);
      const oy = bus.read32(src + 4);
      const cx = (bus.read16(src + 8) << 16) >> 16;
      const cy = (bus.read16(src + 10) << 16) >> 16;
      const sx = (bus.read16(src + 12) << 16) >> 16;
      const sy = (bus.read16(src + 14) << 16) >> 16;
      const theta = (bus.read16(src + 16) >>> 8) & 0xff;
      src += 20;
      const sin = this.sinLut(theta);
      const cos = this.sinLut((theta + 64) & 0xff);
      const pa = (Math.imul(sx, cos) >> 14);
      const pb = -(Math.imul(sx, sin) >> 14);
      const pc = (Math.imul(sy, sin) >> 14);
      const pd = (Math.imul(sy, cos) >> 14);
      bus.write16(dst, pa);
      bus.write16(dst + 2, pb);
      bus.write16(dst + 4, pc);
      bus.write16(dst + 6, pd);
      bus.write32(dst + 8, ox - pa * cx - pb * cy);
      bus.write32(dst + 12, oy - pc * cx - pd * cy);
      dst += 16;
    }
  }

  private objAffineSet(src: number, dst: number, count: number, stride: number): void {
    const bus = this.bus;
    for (let k = 0; k < count; k++) {
      const sx = (bus.read16(src) << 16) >> 16;
      const sy = (bus.read16(src + 2) << 16) >> 16;
      const theta = (bus.read16(src + 4) >>> 8) & 0xff;
      src += 8;
      const sin = this.sinLut(theta);
      const cos = this.sinLut((theta + 64) & 0xff);
      bus.write16(dst, Math.imul(sx, cos) >> 14);
      bus.write16(dst + stride, -(Math.imul(sx, sin) >> 14));
      bus.write16(dst + stride * 2, Math.imul(sy, sin) >> 14);
      bus.write16(dst + stride * 3, Math.imul(sy, cos) >> 14);
      dst += stride * 4;
    }
  }

  // ---------------------------------------------------------------- decompression

  /** Writes decompressed bytes to memory; VRAM targets must use 16-bit writes. */
  private writeOut(dst: number, data: Uint8Array, halfwords: boolean): void {
    const bus = this.bus;
    if (halfwords) {
      for (let k = 0; k + 1 < data.length; k += 2) bus.write16(dst + k, data[k] | (data[k + 1] << 8));
      if (data.length & 1) bus.write16(dst + data.length - 1, data[data.length - 1]);
    } else {
      for (let k = 0; k < data.length; k++) bus.write8(dst + k, data[k]);
    }
    this.cpu.cycles += data.length;
  }

  lz77(src: number): Uint8Array {
    const bus = this.bus;
    const header = bus.read32(src & ~3);
    const size = header >>> 8;
    const out = new Uint8Array(size);
    let s = (src & ~3) + 4;
    let d = 0;
    while (d < size) {
      const flags = bus.read8(s++);
      for (let bit = 7; bit >= 0 && d < size; bit--) {
        if (flags & (1 << bit)) {
          const b1 = bus.read8(s++);
          const b2 = bus.read8(s++);
          const len = (b1 >>> 4) + 3;
          const disp = (((b1 & 0xf) << 8) | b2) + 1;
          for (let k = 0; k < len && d < size; k++, d++) out[d] = out[d - disp];
        } else {
          out[d++] = bus.read8(s++);
        }
      }
    }
    return out;
  }

  private rl(src: number): Uint8Array {
    const bus = this.bus;
    const header = bus.read32(src & ~3);
    const size = header >>> 8;
    const out = new Uint8Array(size);
    let s = (src & ~3) + 4;
    let d = 0;
    while (d < size) {
      const flag = bus.read8(s++);
      if (flag & 0x80) {
        const len = (flag & 0x7f) + 3;
        const v = bus.read8(s++);
        for (let k = 0; k < len && d < size; k++) out[d++] = v;
      } else {
        const len = (flag & 0x7f) + 1;
        for (let k = 0; k < len && d < size; k++) out[d++] = bus.read8(s++);
      }
    }
    return out;
  }

  private huffman(src: number): Uint8Array {
    const bus = this.bus;
    src &= ~3;
    const header = bus.read32(src);
    const bits = header & 0xf;
    const size = header >>> 8;
    const out = new Uint8Array(size);
    const treeSize = (bus.read8(src + 4) + 1) * 2;
    const treeBase = src + 5;
    let s = src + 4 + treeSize;
    let d = 0;
    let acc = 0;
    let accBits = 0;
    let nodeAddr = treeBase;
    let node = bus.read8(nodeAddr);
    while (d < size) {
      const word = bus.read32(s);
      s += 4;
      for (let bit = 31; bit >= 0 && d < size; bit--) {
        const dir = (word >>> bit) & 1;
        const offset = node & 0x3f;
        const next = (nodeAddr & ~1) + offset * 2 + 2 + dir;
        const isLeaf = dir ? (node & 0x40) !== 0 : (node & 0x80) !== 0;
        if (isLeaf) {
          acc |= bus.read8(next) << accBits;
          accBits += bits;
          if (accBits >= 8) {
            out[d++] = acc & 0xff;
            acc >>>= 8;
            accBits -= 8;
          }
          nodeAddr = treeBase;
          node = bus.read8(nodeAddr);
        } else {
          nodeAddr = next;
          node = bus.read8(nodeAddr);
        }
      }
    }
    return out;
  }

  private bitUnPack(src: number, dst: number, info: number): void {
    const bus = this.bus;
    const len = bus.read16(info);
    const srcBits = bus.read8(info + 2);
    const dstBits = bus.read8(info + 3);
    const offsetWord = bus.read32(info + 4);
    const offset = offsetWord & 0x7fffffff;
    const zeroFlag = (offsetWord >>> 31) !== 0;
    let outWord = 0;
    let outBits = 0;
    for (let k = 0; k < len; k++) {
      const byte = bus.read8(src + k);
      for (let b = 0; b < 8; b += srcBits) {
        let v = (byte >>> b) & ((1 << srcBits) - 1);
        if (v !== 0 || zeroFlag) v += offset;
        outWord |= (v & ((1 << dstBits) - 1)) << outBits;
        outBits += dstBits;
        if (outBits >= 32) {
          bus.write32(dst, outWord);
          dst += 4;
          outWord = 0;
          outBits = 0;
        }
      }
    }
  }

  private diffUnFilter(src: number, dst: number, unit: 1 | 2, halfwords: boolean): void {
    const bus = this.bus;
    const header = bus.read32(src & ~3);
    const size = header >>> 8;
    const out = new Uint8Array(size);
    let s = (src & ~3) + 4;
    let prev = 0;
    for (let d = 0; d < size; d += unit) {
      const v = unit === 1 ? bus.read8(s) : bus.read16(s);
      s += unit;
      prev = (prev + v) & (unit === 1 ? 0xff : 0xffff);
      out[d] = prev & 0xff;
      if (unit === 2 && d + 1 < size) out[d + 1] = prev >>> 8;
    }
    this.writeOut(dst, out, halfwords);
  }

  // ---------------------------------------------------------------- sound helpers

  private soundBias(level: number): void {
    const cur = this.io.read16(0x88);
    this.io.write16(0x88, (cur & ~0x3ff) | (level ? 0x200 : 0));
  }

  private midiKey2Freq(wave: number, key: number, fine: number): number {
    const freq = this.bus.read32(wave + 4) >>> 0;
    return Math.floor(freq / Math.pow(2, (180 - key - fine / 256) / 12)) | 0;
  }

  serialize(): Uint8Array {
    return new Uint8Array([this.waiting ? 1 : 0]);
  }

  deserialize(d: Uint8Array): void {
    this.waiting = d[0] === 1;
  }
}
