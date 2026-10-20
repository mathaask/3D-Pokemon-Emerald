// Mirrors the GBA's video memory into GPU textures each frame so shaders can
// decode tiles exactly like the hardware (animations, palette fades included).

import * as THREE from 'three';
import type { Bus } from '../gba/bus';

export const VRAM_TEX_W = 1024;
export const VRAM_TEX_H = 96; // 1024 * 96 = 0x18000 bytes

/** BGR555 -> RGBA8 conversion table. */
const COLOR_LUT = (() => {
  const t = new Uint32Array(0x8000);
  for (let c = 0; c < 0x8000; c++) {
    const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
    t[c] = (0xff << 24) | (((b << 3) | (b >> 2)) << 16) | (((g << 3) | (g >> 2)) << 8) | ((r << 3) | (r >> 2));
  }
  return t;
})();

export function bgr555ToRgba(c: number): number {
  return COLOR_LUT[c & 0x7fff];
}

export class GbaTextures {
  readonly vram: THREE.DataTexture;
  /** 512 colours: 0-255 BG palettes, 256-511 OBJ palettes. */
  readonly palette: THREE.DataTexture;
  private paletteData = new Uint32Array(512);

  constructor(private bus: Bus) {
    this.vram = new THREE.DataTexture(bus.vram, VRAM_TEX_W, VRAM_TEX_H, THREE.RedIntegerFormat, THREE.UnsignedByteType);
    this.vram.internalFormat = 'R8UI';
    this.vram.minFilter = THREE.NearestFilter;
    this.vram.magFilter = THREE.NearestFilter;
    this.vram.generateMipmaps = false;
    this.vram.flipY = false;
    this.vram.unpackAlignment = 1;
    this.vram.needsUpdate = true;

    this.palette = new THREE.DataTexture(new Uint8Array(this.paletteData.buffer), 512, 1, THREE.RGBAFormat);
    this.palette.minFilter = THREE.NearestFilter;
    this.palette.magFilter = THREE.NearestFilter;
    this.palette.generateMipmaps = false;
    this.palette.flipY = false;
    this.palette.needsUpdate = true;
  }

  /**
   * Palette source: null = hardware palette RAM (includes fades and weather tints),
   * otherwise a 512-entry BGR555 buffer such as the game's gPlttBufferUnfaded.
   */
  paletteSource: Uint16Array | null = null;
  private lastPalette = new Uint16Array(512);
  /** BG palettes 0-15 as last uploaded (BGR555). */
  readonly bgPalette = this.lastPalette.subarray(0, 256);

  /** The VRAM the vram texture mirrors (uploaded on render after update() saw it dirty). */
  get vramBytes(): Uint8Array {
    return this.bus.vram;
  }

  /** Uploads changed memory. Returns true if anything changed. */
  update(force = false): boolean {
    const bus = this.bus;
    let changed = false;
    if (bus.vramDirty || force) {
      this.vram.needsUpdate = true;
      bus.vramDirty = false;
      changed = true;
    }
    const src = this.paletteSource ?? bus.pram16;
    let palChanged = force || (this.paletteSource === null && bus.pramDirty);
    if (!palChanged) {
      const last = this.lastPalette;
      for (let i = 0; i < 512; i++) {
        if (last[i] !== src[i]) { palChanged = true; break; }
      }
    }
    if (palChanged) {
      for (let i = 0; i < 512; i++) {
        this.lastPalette[i] = src[i];
        this.paletteData[i] = COLOR_LUT[src[i] & 0x7fff];
      }
      this.palette.needsUpdate = true;
      if (this.paletteSource === null) bus.pramDirty = false;
      changed = true;
    }
    return changed;
  }
}

/** GLSL helpers shared by tile/sprite decoding shaders. */
export const GLSL_GBA = /* glsl */ `
  uniform highp usampler2D tVram;
  uniform sampler2D tPalette;

  uint vramByte(int addr) {
    return texelFetch(tVram, ivec2(addr & 1023, addr >> 10), 0).r;
  }

  // Returns the 4bpp colour index of pixel (x, y) in the tile at byte address tileAddr.
  int pixel4(int tileAddr, int x, int y) {
    uint b = vramByte(tileAddr + y * 4 + (x >> 1));
    return int((x & 1) == 1 ? (b >> 4u) : (b & 15u));
  }

  int pixel8(int tileAddr, int x, int y) {
    return int(vramByte(tileAddr + y * 8 + x));
  }

  vec4 paletteColor(int index) {
    return texelFetch(tPalette, ivec2(index, 0), 0);
  }
`;
