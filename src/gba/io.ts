// IO register dispatch (0x04000000-0x040003FF). Raw written values are kept in
// bus.io16 (the PPU reads its registers from there); registers with side
// effects are forwarded to their owners.

import type { Bus, IoPort } from './bus';
import type { Cpu } from './cpu';
import type { Dma } from './dma';
import type { Timers } from './timers';
import { REG } from './constants';

export interface IoPpu {
  affineRefWritten(bg: 2 | 3): void;
}

export interface IoApu {
  read16(off: number): number;
  write8(off: number, v: number): void;
  write16(off: number, v: number): void;
  fifoWrite32(channel: 0 | 1, v: number): void;
}

const IE_IDX = REG.IE >>> 1;
const IF_IDX = REG.IF >>> 1;
const IME_IDX = REG.IME >>> 1;

export class Io implements IoPort {
  keys = 0; // 1 = pressed, KEY bit layout

  constructor(
    private bus: Bus,
    private cpu: Cpu,
    private timers: Timers,
    private dma: Dma,
    private ppu: IoPpu,
    private apu: IoApu,
  ) {}

  reset(): void {
    this.bus.io16.fill(0);
    this.bus.io16[REG.DISPCNT >>> 1] = 0x0080;
    this.bus.io16[REG.BG2PA >>> 1] = 0x100;
    this.bus.io16[REG.BG2PD >>> 1] = 0x100;
    this.bus.io16[REG.BG3PA >>> 1] = 0x100;
    this.bus.io16[REG.BG3PD >>> 1] = 0x100;
  }

  updateIrq(): void {
    const io16 = this.bus.io16;
    const pending = (io16[IE_IDX] & io16[IF_IDX] & 0x3fff) !== 0;
    if (pending) this.cpu.halted = false;
    this.cpu.irqLine = pending && (io16[IME_IDX] & 1) !== 0;
  }

  raiseIrq(bits: number): void {
    this.bus.io16[IF_IDX] |= bits;
    this.updateIrq();
  }

  /** Keypad interrupt check (KEYCNT); called when keys change. */
  checkKeypadIrq(): void {
    const cnt = this.bus.io16[REG.KEYCNT >>> 1];
    if (!(cnt & 0x4000)) return;
    const mask = cnt & 0x3ff;
    const hit = cnt & 0x8000 ? (this.keys & mask) === mask : (this.keys & mask) !== 0;
    if (hit) this.raiseIrq(1 << 12);
  }

  read16(off: number): number {
    const io16 = this.bus.io16;
    if (off >= REG.SOUND_START && off < REG.SOUND_END) return this.apu.read16(off - REG.SOUND_START);
    if (off >= 0xb0 && off < 0xe0) {
      const rel = off - 0xb0;
      const ch = (rel / 12) | 0;
      return rel % 12 === 10 ? this.dma.ctrl[ch] : 0;
    }
    if (off >= 0x100 && off < 0x110) {
      const n = (off - 0x100) >>> 2;
      return off & 2 ? this.timers.control[n] : this.timers.read(n);
    }
    switch (off) {
      case REG.KEYINPUT:
        return ~this.keys & 0x3ff;
      // Write-only registers read back as 0.
      case 0x10: case 0x12: case 0x14: case 0x16: case 0x18: case 0x1a: case 0x1c: case 0x1e:
      case 0x20: case 0x22: case 0x24: case 0x26: case 0x28: case 0x2a: case 0x2c: case 0x2e:
      case 0x30: case 0x32: case 0x34: case 0x36: case 0x38: case 0x3a: case 0x3c: case 0x3e:
      case 0x40: case 0x42: case 0x44: case 0x46: case 0x4c: case 0x4e: case 0x54:
        return 0;
      case 0x136: // IR / unused
        return 0;
      default:
        return io16[off >>> 1];
    }
  }

  write16(off: number, v: number): void {
    const io16 = this.bus.io16;
    if (off >= REG.SOUND_START && off < REG.SOUND_END) {
      io16[off >>> 1] = v;
      this.apu.write16(off - REG.SOUND_START, v);
      return;
    }
    if (off >= 0xb0 && off < 0xe0) {
      const rel = off - 0xb0;
      const ch = (rel / 12) | 0;
      io16[off >>> 1] = v;
      switch (rel % 12) {
        case 0: this.dma.sad[ch] = (this.dma.sad[ch] & 0xffff0000) | v; break;
        case 2: this.dma.sad[ch] = ((this.dma.sad[ch] & 0xffff) | (v << 16)) >>> 0; break;
        case 4: this.dma.dad[ch] = (this.dma.dad[ch] & 0xffff0000) | v; break;
        case 6: this.dma.dad[ch] = ((this.dma.dad[ch] & 0xffff) | (v << 16)) >>> 0; break;
        case 8: this.dma.cnt[ch] = v; break;
        case 10: this.dma.writeControl(ch, v); break;
      }
      return;
    }
    if (off >= 0x100 && off < 0x110) {
      const n = (off - 0x100) >>> 2;
      io16[off >>> 1] = v;
      if (off & 2) this.timers.writeControl(n, v);
      else this.timers.writeReload(n, v);
      return;
    }
    switch (off) {
      case REG.DISPSTAT:
        io16[off >>> 1] = (io16[off >>> 1] & 0x7) | (v & 0xfff8);
        return;
      case REG.VCOUNT:
      case REG.KEYINPUT:
        return;
      case 0x28: case 0x2a: case 0x2c: case 0x2e:
        io16[off >>> 1] = v;
        this.ppu.affineRefWritten(2);
        return;
      case 0x38: case 0x3a: case 0x3c: case 0x3e:
        io16[off >>> 1] = v;
        this.ppu.affineRefWritten(3);
        return;
      case REG.IE:
        io16[IE_IDX] = v;
        this.updateIrq();
        return;
      case REG.IF:
        io16[IF_IDX] &= ~v;
        this.updateIrq();
        return;
      case REG.IME:
        io16[IME_IDX] = v & 1;
        this.updateIrq();
        return;
      case REG.KEYCNT:
        io16[off >>> 1] = v;
        this.checkKeypadIrq();
        return;
      case REG.POSTFLG: // 0x300: POSTFLG (low byte), HALTCNT (high byte)
        io16[off >>> 1] = v & 0xff;
        this.cpu.halted = true;
        this.updateIrq();
        return;
      default:
        io16[off >>> 1] = v;
    }
  }

  write8(off: number, v: number): void {
    const io16 = this.bus.io16;
    if (off >= REG.SOUND_START && off < REG.SOUND_END) {
      const idx = off >>> 1;
      io16[idx] = off & 1 ? (io16[idx] & 0xff) | (v << 8) : (io16[idx] & 0xff00) | v;
      this.apu.write8(off - REG.SOUND_START, v);
      return;
    }
    switch (off) {
      case REG.HALTCNT:
        this.cpu.halted = true;
        this.updateIrq();
        return;
      case REG.POSTFLG:
        io16[off >>> 1] = (io16[off >>> 1] & 0xff00) | v;
        return;
      case REG.IF:
      case REG.IF + 1:
        io16[IF_IDX] &= ~(v << ((off & 1) * 8));
        this.updateIrq();
        return;
    }
    // Generic read-modify-write on the raw shadow value.
    const idx = off >>> 1;
    const cur = io16[idx];
    const merged = off & 1 ? (cur & 0xff) | (v << 8) : (cur & 0xff00) | v;
    this.write16(off & ~1, merged);
  }

  write32(off: number, v: number): void {
    if (off === REG.FIFO_A) { this.apu.fifoWrite32(0, v); return; }
    if (off === REG.FIFO_B) { this.apu.fifoWrite32(1, v); return; }
    this.write16(off, v & 0xffff);
    this.write16(off + 2, (v >>> 16) & 0xffff);
  }
}
