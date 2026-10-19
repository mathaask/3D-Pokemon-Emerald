// Random access over the cartridge image using GBA bus addresses (0x08000000-based).
// Browser-safe: no Node APIs.

export const ROM_BASE = 0x08000000;

/** Error thrown for reads outside the ROM image or malformed compressed data. */
export class RomError extends Error {}

/**
 * Decompresses GBA BIOS LZ77 (type 0x10) data starting at `offset` of `src`.
 * Format: u32 header (0x10 | size << 8), then groups of 8 blocks preceded by a flag
 * byte (MSB first). Flag 0 = literal byte; flag 1 = 2-byte back-reference
 * `LLLL DDDD DDDDDDDD`: length = L + 3, distance = D + 1.
 */
export function lz77Decompress(src: Uint8Array, offset = 0): Uint8Array {
  if (offset + 4 > src.length) throw new RomError(`LZ77 header out of range at ${offset}`);
  const type = src[offset];
  if (type !== 0x10) throw new RomError(`Not LZ77 data (type 0x${type.toString(16)}) at ${offset}`);
  const size = src[offset + 1] | (src[offset + 2] << 8) | (src[offset + 3] << 16);
  const out = new Uint8Array(size);
  let s = offset + 4;
  let d = 0;
  while (d < size) {
    if (s >= src.length) throw new RomError('LZ77 stream truncated');
    const flags = src[s++];
    for (let bit = 0x80; bit !== 0 && d < size; bit >>= 1) {
      if (flags & bit) {
        if (s + 1 >= src.length) throw new RomError('LZ77 stream truncated');
        const b0 = src[s++];
        const b1 = src[s++];
        const len = (b0 >> 4) + 3;
        const disp = (((b0 & 0xf) << 8) | b1) + 1;
        if (disp > d) throw new RomError(`LZ77 back-reference before start (disp ${disp} at ${d})`);
        for (let i = 0; i < len && d < size; i++, d++) out[d] = out[d - disp];
      } else {
        if (s >= src.length) throw new RomError('LZ77 stream truncated');
        out[d++] = src[s++];
      }
    }
  }
  return out;
}

export class RomReader {
  readonly data: Uint8Array;
  readonly size: number;
  private readonly view: DataView;

  constructor(data: Uint8Array) {
    this.data = data;
    this.size = data.length;
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  /** True if `v` is a pointer into this ROM image (0x08000000 .. 0x08000000+size). */
  isRomPtr(v: number): boolean {
    v >>>= 0;
    return v >= ROM_BASE && v < ROM_BASE + this.size;
  }

  /** File offset of a GBA ROM address (accepts the 0x0A/0x0C wait-state mirrors too). */
  offset(addr: number): number {
    addr >>>= 0;
    if (addr < ROM_BASE || addr >= 0x0e000000) throw new RomError(`Not a ROM address: 0x${addr.toString(16)}`);
    const off = addr & 0x01ffffff;
    if (off >= this.size) throw new RomError(`ROM address out of range: 0x${addr.toString(16)}`);
    return off;
  }

  private checked(addr: number, len: number): number {
    const off = this.offset(addr);
    if (off + len > this.size) throw new RomError(`ROM read past end at 0x${(addr >>> 0).toString(16)}`);
    return off;
  }

  u8(addr: number): number {
    return this.data[this.checked(addr, 1)];
  }
  s8(addr: number): number {
    return this.view.getInt8(this.checked(addr, 1));
  }
  u16(addr: number): number {
    return this.view.getUint16(this.checked(addr, 2), true);
  }
  s16(addr: number): number {
    return this.view.getInt16(this.checked(addr, 2), true);
  }
  u32(addr: number): number {
    return this.view.getUint32(this.checked(addr, 4), true);
  }
  s32(addr: number): number {
    return this.view.getInt32(this.checked(addr, 4), true);
  }

  /** A view (no copy) of `len` bytes at `addr`. */
  bytes(addr: number, len: number): Uint8Array {
    const off = this.checked(addr, len);
    return this.data.subarray(off, off + len);
  }

  /** Copies `count` little-endian u16 values starting at `addr`. */
  u16Array(addr: number, count: number): Uint16Array {
    const off = this.checked(addr, count * 2);
    const out = new Uint16Array(count);
    for (let i = 0; i < count; i++) out[i] = this.view.getUint16(off + i * 2, true);
    return out;
  }

  /** Decompressed size announced by an LZ77 header, or -1 if `addr` is not LZ77 data. */
  lz77Size(addr: number): number {
    if (!this.isRomPtr(addr) || this.offset(addr) + 4 > this.size) return -1;
    const h = this.u32(addr);
    return (h & 0xff) === 0x10 ? h >>> 8 : -1;
  }

  /** Decompresses GBA BIOS LZ77 (type 0x10) data at `addr`. */
  lz77(addr: number): Uint8Array {
    return lz77Decompress(this.data, this.offset(addr));
  }
}
