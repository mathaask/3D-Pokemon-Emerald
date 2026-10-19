// Side-effect-free typed reads of emulated memory (EWRAM / IWRAM / ROM / VRAM…).
// Unlike Bus.read*, these never touch IO registers or flash state.

import type { Bus } from '../gba/bus';

export class Mem {
  constructor(readonly bus: Bus) {}

  private region(a: number): { arr: Uint8Array; off: number } | null {
    const bus = this.bus;
    switch (a >>> 24) {
      case 0x02: return { arr: bus.ewram, off: a & 0x3ffff };
      case 0x03: return { arr: bus.iwram, off: a & 0x7fff };
      case 0x05: return { arr: bus.pram, off: a & 0x3ff };
      case 0x06: { const o = a & 0x1ffff; return { arr: bus.vram, off: o >= 0x18000 ? o - 0x8000 : o }; }
      case 0x07: return { arr: bus.oam, off: a & 0x3ff };
      case 0x08: case 0x09: return { arr: bus.rom, off: a & 0x1ffffff };
      default: return null;
    }
  }

  u8(a: number): number {
    const r = this.region(a >>> 0);
    return r && r.off < r.arr.length ? r.arr[r.off] : 0;
  }

  u16(a: number): number {
    const r = this.region(a >>> 0);
    if (!r || r.off + 1 >= r.arr.length) return 0;
    return r.arr[r.off] | (r.arr[r.off + 1] << 8);
  }

  u32(a: number): number {
    const r = this.region(a >>> 0);
    if (!r || r.off + 3 >= r.arr.length) return 0;
    const b = r.arr;
    const o = r.off;
    return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  }

  s8(a: number): number { return (this.u8(a) << 24) >> 24; }
  s16(a: number): number { return (this.u16(a) << 16) >> 16; }
  s32(a: number): number { return this.u32(a) | 0; }

  /** Copies `len` bytes starting at `a` (single region). */
  bytes(a: number, len: number): Uint8Array {
    const r = this.region(a >>> 0);
    if (!r) return new Uint8Array(len);
    return r.arr.slice(r.off, r.off + len);
  }

  isPtr(v: number): boolean {
    const region = v >>> 24;
    return region === 2 || region === 3 || region === 8 || region === 9;
  }
}
