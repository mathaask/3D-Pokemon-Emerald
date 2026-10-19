// GBA memory map. Every CPU/DMA access goes through read*/write* here.
// 32-bit and 16-bit accessors expect aligned addresses (the CPU applies the
// ARM rotation rules for misaligned loads itself).

export interface IoPort {
  read16(off: number): number;
  write16(off: number, v: number): void;
  write8(off: number, v: number): void;
  write32(off: number, v: number): void;
}

export interface BackupPort {
  read8(addr: number): number;
  write8(addr: number, v: number): void;
}

/** Cartridge GPIO (RTC) mapped at 0x080000C4..0x080000C9. */
export interface GpioPort {
  readable: boolean;
  read16(off: number): number;
  write16(off: number, v: number): void;
}

export class Bus {
  readonly bios = new Uint8Array(0x4000);
  readonly ewram = new Uint8Array(0x40000);
  readonly iwram = new Uint8Array(0x8000);
  readonly io = new Uint8Array(0x400);
  readonly pram = new Uint8Array(0x400);
  readonly vram = new Uint8Array(0x18000);
  readonly oam = new Uint8Array(0x400);
  readonly rom: Uint8Array;
  readonly romSize: number;

  readonly bios32 = new Int32Array(this.bios.buffer);
  readonly bios16 = new Uint16Array(this.bios.buffer);
  readonly ewram16 = new Uint16Array(this.ewram.buffer);
  readonly ewram32 = new Int32Array(this.ewram.buffer);
  readonly iwram16 = new Uint16Array(this.iwram.buffer);
  readonly iwram32 = new Int32Array(this.iwram.buffer);
  readonly io16 = new Uint16Array(this.io.buffer);
  readonly pram16 = new Uint16Array(this.pram.buffer);
  readonly pram32 = new Int32Array(this.pram.buffer);
  readonly vram16 = new Uint16Array(this.vram.buffer);
  readonly vram32 = new Int32Array(this.vram.buffer);
  readonly oam16 = new Uint16Array(this.oam.buffer);
  readonly oam32 = new Int32Array(this.oam.buffer);
  readonly rom16: Uint16Array;
  readonly rom32: Int32Array;

  ioPort!: IoPort;
  backup!: BackupPort;
  gpio: GpioPort | null = null;

  /** Called after any write to VRAM/PRAM/OAM so renderers can track dirtiness cheaply. */
  vramDirty = true;
  pramDirty = true;
  oamDirty = true;

  constructor(romData: Uint8Array) {
    const size = (romData.length + 3) & ~3;
    this.rom = new Uint8Array(size);
    this.rom.set(romData);
    this.romSize = romData.length;
    this.rom16 = new Uint16Array(this.rom.buffer);
    this.rom32 = new Int32Array(this.rom.buffer);
  }

  static vramOffset(a: number): number {
    const o = a & 0x1ffff;
    return o >= 0x18000 ? o - 0x8000 : o;
  }

  private romOpenBus16(a: number): number {
    return (a >>> 1) & 0xffff;
  }

  read8(a: number): number {
    switch (a >>> 24) {
      case 0x00:
        return a < 0x4000 ? this.bios[a] : 0;
      case 0x02:
        return this.ewram[a & 0x3ffff];
      case 0x03:
        return this.iwram[a & 0x7fff];
      case 0x04: {
        const off = a & 0xffffff;
        if (off >= 0x400) return 0;
        const v = this.ioPort.read16(off & ~1);
        return off & 1 ? v >>> 8 : v & 0xff;
      }
      case 0x05:
        return this.pram[a & 0x3ff];
      case 0x06:
        return this.vram[Bus.vramOffset(a)];
      case 0x07:
        return this.oam[a & 0x3ff];
      case 0x08: case 0x09: case 0x0a: case 0x0b: case 0x0c: case 0x0d: {
        const off = a & 0x1ffffff;
        if (this.gpio !== null && this.gpio.readable && off >= 0xc4 && off < 0xca) {
          const v = this.gpio.read16(off & ~1);
          return off & 1 ? v >>> 8 : v & 0xff;
        }
        if (off < this.romSize) return this.rom[off];
        const v = this.romOpenBus16(a);
        return a & 1 ? v >>> 8 : v & 0xff;
      }
      case 0x0e: case 0x0f:
        return this.backup.read8(a & 0xffff);
      default:
        return 0;
    }
  }

  read16(a: number): number {
    switch (a >>> 24) {
      case 0x00:
        return a < 0x4000 ? this.bios16[(a & 0x3fff) >>> 1] : 0;
      case 0x02:
        return this.ewram16[(a & 0x3ffff) >>> 1];
      case 0x03:
        return this.iwram16[(a & 0x7fff) >>> 1];
      case 0x04: {
        const off = a & 0xfffffe;
        return off < 0x400 ? this.ioPort.read16(off) : 0;
      }
      case 0x05:
        return this.pram16[(a & 0x3ff) >>> 1];
      case 0x06:
        return this.vram16[Bus.vramOffset(a) >>> 1];
      case 0x07:
        return this.oam16[(a & 0x3ff) >>> 1];
      case 0x08: case 0x09: case 0x0a: case 0x0b: case 0x0c: case 0x0d: {
        const off = a & 0x1fffffe;
        if (this.gpio !== null && this.gpio.readable && off >= 0xc4 && off < 0xca) return this.gpio.read16(off);
        if (off < this.romSize) return this.rom16[off >>> 1];
        return this.romOpenBus16(a);
      }
      case 0x0e: case 0x0f:
        return this.backup.read8(a & 0xffff) * 0x0101;
      default:
        return 0;
    }
  }

  read32(a: number): number {
    switch (a >>> 24) {
      case 0x00:
        return a < 0x4000 ? this.bios32[(a & 0x3fff) >>> 2] : 0;
      case 0x02:
        return this.ewram32[(a & 0x3ffff) >>> 2];
      case 0x03:
        return this.iwram32[(a & 0x7fff) >>> 2];
      case 0x04: {
        const off = a & 0xfffffc;
        if (off >= 0x400) return 0;
        return (this.ioPort.read16(off) | (this.ioPort.read16(off + 2) << 16)) | 0;
      }
      case 0x05:
        return this.pram32[(a & 0x3ff) >>> 2];
      case 0x06:
        return this.vram32[Bus.vramOffset(a) >>> 2];
      case 0x07:
        return this.oam32[(a & 0x3ff) >>> 2];
      case 0x08: case 0x09: case 0x0a: case 0x0b: case 0x0c: case 0x0d: {
        const off = a & 0x1fffffc;
        if (this.gpio !== null && this.gpio.readable && off >= 0xc4 && off < 0xca) {
          return (this.gpio.read16(off) | (this.gpio.read16(off + 2) << 16)) | 0;
        }
        if (off < this.romSize) return this.rom32[off >>> 2];
        return (this.romOpenBus16(a) | (this.romOpenBus16(a + 2) << 16)) | 0;
      }
      case 0x0e: case 0x0f:
        return Math.imul(this.backup.read8(a & 0xffff), 0x01010101);
      default:
        return 0;
    }
  }

  write8(a: number, v: number): void {
    v &= 0xff;
    switch (a >>> 24) {
      case 0x02:
        this.ewram[a & 0x3ffff] = v;
        return;
      case 0x03:
        this.iwram[a & 0x7fff] = v;
        return;
      case 0x04: {
        const off = a & 0xffffff;
        if (off < 0x400) this.ioPort.write8(off, v);
        return;
      }
      case 0x05:
        // 8-bit writes to palette RAM store the byte in both halves.
        this.pram16[(a & 0x3fe) >>> 1] = v * 0x0101;
        this.pramDirty = true;
        return;
      case 0x06: {
        const o = Bus.vramOffset(a);
        const bitmap = (this.io16[0] & 7) >= 3;
        if (o < (bitmap ? 0x14000 : 0x10000)) {
          this.vram16[o >>> 1] = v * 0x0101;
          this.vramDirty = true;
        }
        return;
      }
      case 0x07:
        return; // 8-bit OAM writes are ignored by hardware
      case 0x0e: case 0x0f:
        this.backup.write8(a & 0xffff, v);
        return;
      default:
        return;
    }
  }

  write16(a: number, v: number): void {
    v &= 0xffff;
    switch (a >>> 24) {
      case 0x02:
        this.ewram16[(a & 0x3ffff) >>> 1] = v;
        return;
      case 0x03:
        this.iwram16[(a & 0x7fff) >>> 1] = v;
        return;
      case 0x04: {
        const off = a & 0xfffffe;
        if (off < 0x400) this.ioPort.write16(off, v);
        return;
      }
      case 0x05:
        this.pram16[(a & 0x3ff) >>> 1] = v;
        this.pramDirty = true;
        return;
      case 0x06:
        this.vram16[Bus.vramOffset(a) >>> 1] = v;
        this.vramDirty = true;
        return;
      case 0x07:
        this.oam16[(a & 0x3ff) >>> 1] = v;
        this.oamDirty = true;
        return;
      case 0x08: case 0x09: case 0x0a: case 0x0b: case 0x0c: case 0x0d: {
        const off = a & 0x1fffffe;
        if (this.gpio !== null && off >= 0xc4 && off < 0xca) this.gpio.write16(off, v);
        return;
      }
      case 0x0e: case 0x0f:
        this.backup.write8(a & 0xffff, (v >>> ((a & 1) * 8)) & 0xff);
        return;
      default:
        return;
    }
  }

  write32(a: number, v: number): void {
    switch (a >>> 24) {
      case 0x02:
        this.ewram32[(a & 0x3ffff) >>> 2] = v;
        return;
      case 0x03:
        this.iwram32[(a & 0x7fff) >>> 2] = v;
        return;
      case 0x04: {
        const off = a & 0xfffffc;
        if (off < 0x400) this.ioPort.write32(off, v);
        return;
      }
      case 0x05:
        this.pram32[(a & 0x3ff) >>> 2] = v;
        this.pramDirty = true;
        return;
      case 0x06:
        this.vram32[Bus.vramOffset(a) >>> 2] = v;
        this.vramDirty = true;
        return;
      case 0x07:
        this.oam32[(a & 0x3ff) >>> 2] = v;
        this.oamDirty = true;
        return;
      case 0x08: case 0x09: case 0x0a: case 0x0b: case 0x0c: case 0x0d: {
        const off = a & 0x1fffffc;
        if (this.gpio !== null && off >= 0xc4 && off < 0xca) {
          this.gpio.write16(off, v & 0xffff);
          this.gpio.write16(off + 2, (v >>> 16) & 0xffff);
        }
        return;
      }
      case 0x0e: case 0x0f:
        this.backup.write8(a & 0xffff, (v >>> ((a & 3) * 8)) & 0xff);
        return;
      default:
        return;
    }
  }
}
