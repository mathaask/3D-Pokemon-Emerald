// Decodes all 1024 metatiles of the current tileset pair from live VRAM into a
// padded, mipmapped atlas (bottom layer / top layer / both layers composited).

import * as THREE from 'three';
import type { Mem } from '../../game/mem';
import { GLSL_GBA, type GbaTextures } from '../gbaTextures';

export const CELL = 24; // 16 px metatile + 4 px padding on each side
export const PAD = 4;
export const COLS = 32;
export const VARIANT_H = CELL * 32; // 768
export const ATLAS_W = CELL * COLS; // 768
export const ATLAS_H = VARIANT_H * 4; // bottom, top, combined, cutout

export const enum Variant { Bottom = 0, Top = 1, Both = 2, Cutout = 3 }

const DEFS_W = 10; // 8 tile entries, attributes, reference ground metatile

const VERT = /* glsl */ `
  in vec3 position;
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
  precision highp float;
  precision highp int;
  precision highp usampler2D;
  ${GLSL_GBA}
  uniform highp usampler2D tDefs;  // 10 x 1024: tile entries, attributes, reference ground
  uniform int uCharBase;           // BG character base (bytes)
  out vec4 fragColor;

  vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  // Colour of one metatile layer at local pixel (lx, ly); alpha 0 if transparent.
  vec4 layerColor(int metatile, int layer, int lx, int ly) {
    int sub = (ly >> 3) * 2 + (lx >> 3);
    uint e = texelFetch(tDefs, ivec2(layer * 4 + sub, metatile), 0).r;
    int tile = int(e & 1023u);
    int tx = lx & 7, ty = ly & 7;
    if ((e & 0x400u) != 0u) tx = 7 - tx;
    if ((e & 0x800u) != 0u) ty = 7 - ty;
    int ci = pixel4(uCharBase + tile * 32, tx, ty);
    if (ci == 0) return vec4(0.0);
    int pal = int(e >> 12u);
    return vec4(paletteColor(pal * 16 + ci).rgb, 1.0);
  }

  // Bottom layer as the game shows it: NORMAL metatiles sit on a filler tile (0x014, palette 3)
  // drawn on BG3; others show the backdrop through transparent pixels.
  vec4 groundColor(int metatile, int lx, int ly) {
    vec4 c = layerColor(metatile, 0, lx, ly);
    if (c.a > 0.0) return c;
    uint attr = texelFetch(tDefs, ivec2(8, metatile), 0).r;
    if ((attr >> 12u) == 0u) {
      int ci = pixel4(uCharBase + 0x14 * 32, lx & 7, ly & 7);
      if (ci != 0) return vec4(paletteColor(3 * 16 + ci).rgb, 1.0);
    }
    return vec4(paletteColor(0).rgb, 1.0);
  }

  vec4 bothColor(int metatile, int lx, int ly) {
    vec4 top = layerColor(metatile, 1, lx, ly);
    return top.a > 0.0 ? top : groundColor(metatile, lx, ly);
  }

  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    int variant = p.y / ${VARIANT_H};
    int py = p.y - variant * ${VARIANT_H};
    int cx = p.x / ${CELL};
    int cy = py / ${CELL};
    int metatile = cy * ${COLS} + cx;
    // Atlas rows are stored top-down so v grows downward in metatile space.
    int lx = clamp(p.x - cx * ${CELL} - ${PAD}, 0, 15);
    int ly = 15 - clamp(py - cy * ${CELL} - ${PAD}, 0, 15);
    vec4 c;
    if (variant == 0) {
      c = groundColor(metatile, lx, ly);
    } else if (variant == 1) {
      c = layerColor(metatile, 1, lx, ly);
    } else if (variant == 2) {
      c = bothColor(metatile, lx, ly);
    } else {
      // Cutout: only real layer pixels (never the BG3 filler/backdrop), minus pixels identical
      // to the reference ground metatile.
      c = layerColor(metatile, 1, lx, ly);
      if (c.a == 0.0) c = layerColor(metatile, 0, lx, ly);
      int ref = int(texelFetch(tDefs, ivec2(9, metatile), 0).r);
      if (ref != metatile) {
        vec4 g = bothColor(ref, lx, ly);
        if (c.a > 0.0 && all(lessThan(abs(g.rgb - c.rgb), vec3(0.002)))) c = vec4(0.0);
      }
    }
    fragColor = vec4(srgbToLinear(c.rgb), c.a);
  }
`;

export class MetatileAtlas {
  readonly target: THREE.WebGLRenderTarget;
  private defsData = new Uint16Array(DEFS_W * 1024);
  private defs: THREE.DataTexture;
  private material: THREE.RawShaderMaterial;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** Metatile attributes (behavior | layerType << 12) for ids 0..1023. */
  readonly attributes = new Uint16Array(1024);
  /** Raw metatile entries (8 per metatile) for CPU-side analysis. */
  readonly entries = new Uint16Array(8 * 1024);
  primary = 0;
  secondary = 0;

  constructor(gbaTex: GbaTextures, maxAnisotropy: number) {
    this.target = new THREE.WebGLRenderTarget(ATLAS_W, ATLAS_H, {
      colorSpace: THREE.SRGBColorSpace,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });
    this.target.texture.anisotropy = maxAnisotropy;
    this.defs = new THREE.DataTexture(this.defsData, DEFS_W, 1024, THREE.RedIntegerFormat, THREE.UnsignedShortType);
    this.defs.internalFormat = 'R16UI';
    this.defs.minFilter = THREE.NearestFilter;
    this.defs.magFilter = THREE.NearestFilter;
    this.defs.generateMipmaps = false;
    this.defs.flipY = false;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tVram: { value: gbaTex.vram },
        tPalette: { value: gbaTex.palette },
        tDefs: { value: this.defs },
        uCharBase: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** Loads metatile definitions + attributes for a tileset pair. Returns true if changed. */
  setTilesets(mem: Mem, primary: number, secondary: number): boolean {
    if (primary === this.primary && secondary === this.secondary) return false;
    this.primary = primary;
    this.secondary = secondary;
    this.defsData.fill(0);
    this.entries.fill(0);
    this.attributes.fill(0);
    const load = (ts: number, base: number) => {
      if (!mem.isPtr(ts)) return;
      const metatiles = mem.u32(ts + 0x0c);
      const attrs = mem.u32(ts + 0x10);
      for (let i = 0; i < 512; i++) {
        for (let k = 0; k < 8; k++) {
          const e = mem.u16(metatiles + (i * 8 + k) * 2);
          this.defsData[(base + i) * DEFS_W + k] = e;
          this.entries[(base + i) * 8 + k] = e;
        }
        const attr = mem.u16(attrs + i * 2);
        this.attributes[base + i] = attr;
        this.defsData[(base + i) * DEFS_W + 8] = attr;
        this.defsData[(base + i) * DEFS_W + 9] = base + i;
      }
    };
    load(primary, 0);
    load(secondary, 512);
    this.defs.needsUpdate = true;
    return true;
  }

  /** Sets the reference ground metatile used by the cutout variant of each metatile. */
  setGroundRefs(refs: Int16Array): void {
    for (let m = 0; m < 1024; m++) this.defsData[m * DEFS_W + 9] = refs[m] >= 0 ? refs[m] : m;
    this.defs.needsUpdate = true;
  }

  render(renderer: THREE.WebGLRenderer, charBase: number): void {
    this.material.uniforms.uCharBase.value = charBase;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
  }

  /**
   * UV rectangle (u0, v0, u1, v1) of a metatile's 16x16 interior.
   * v0 is the metatile's top edge (GBA y = 0).
   */
  uv(metatile: number, variant: Variant, out: Float32Array | number[] = new Float32Array(4)): Float32Array | number[] {
    const cx = metatile & 31;
    const cy = metatile >> 5;
    const x0 = cx * CELL + PAD;
    const yTop = variant * VARIANT_H + cy * CELL + PAD + 16; // ly flipped: top row at higher y
    out[0] = x0 / ATLAS_W;
    out[1] = yTop / ATLAS_H;
    out[2] = (x0 + 16) / ATLAS_W;
    out[3] = (yTop - 16) / ATLAS_H;
    return out;
  }
}
