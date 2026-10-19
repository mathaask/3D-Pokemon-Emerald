// Bakes the images of live game sprites (gSprites) into 64x64 slots of an atlas by
// decoding OBJ VRAM on the GPU. Billboards and HUD quads then sample from it.

import * as THREE from 'three';
import { GLSL_GBA, type GbaTextures } from './gbaTextures';
import type { SpriteSnap } from '../game/state';

export const SLOT = 64;
export const SLOT_COLS = 16;
export const SLOT_ROWS = 8;
export const MAX_SLOTS = SLOT_COLS * SLOT_ROWS; // 128

const VERT = /* glsl */ `
  in vec3 position;     // unit quad 0..1
  in vec4 aSlotSize;    // slot x, slot y, width, height
  in vec4 aTile;        // tileNum, palette, flags(bpp8|hflip<<1|vflip<<2|map2d<<3), 0
  out vec2 vLocal;
  flat out vec4 vTile;
  flat out vec2 vSize;
  uniform vec2 uAtlas;
  void main() {
    vec2 px = aSlotSize.xy * ${SLOT}.0 + position.xy * aSlotSize.zw;
    vLocal = position.xy * aSlotSize.zw;
    vTile = aTile;
    vSize = aSlotSize.zw;
    gl_Position = vec4(px / uAtlas * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  precision highp int;
  precision highp usampler2D;
  ${GLSL_GBA}
  in vec2 vLocal;
  flat in vec4 vTile;
  flat in vec2 vSize;
  out vec4 fragColor;

  vec3 srgbToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  void main() {
    int w = int(vSize.x), h = int(vSize.y);
    int x = int(vLocal.x);
    // Slot rows are stored bottom-up; sprite row 0 is the top.
    int y = h - 1 - int(vLocal.y);
    int flags = int(vTile.z);
    bool bpp8 = (flags & 1) != 0;
    if ((flags & 2) != 0) x = w - 1 - x;
    if ((flags & 4) != 0) y = h - 1 - y;
    bool map2d = (flags & 8) != 0;
    int tileNum = int(vTile.x);
    int tx = x >> 3, ty = y >> 3;
    int tile;
    if (map2d) tile = tileNum + ty * 32 + tx * (bpp8 ? 2 : 1);
    else tile = tileNum + (ty * (w >> 3) + tx) * (bpp8 ? 2 : 1);
    int addr = 0x10000 + (tile & 1023) * 32;
    int ci = bpp8 ? pixel8(addr, x & 7, y & 7) : pixel4(addr, x & 7, y & 7);
    if (ci == 0) { fragColor = vec4(0.0); return; }
    int index = bpp8 ? 256 + ci : 256 + int(vTile.y) * 16 + ci;
    fragColor = vec4(srgbToLinear(paletteColor(index).rgb), 1.0);
  }
`;

export interface SlotInfo {
  slot: number;
  /** UV rect (u0, v0 top, u1, v1 bottom) of the sprite image. */
  u0: number; v0: number; u1: number; v1: number;
}

export class SpriteAtlas {
  readonly target: THREE.WebGLRenderTarget;
  private geometry: THREE.InstancedBufferGeometry;
  private slotSize: THREE.InstancedBufferAttribute;
  private tile: THREE.InstancedBufferAttribute;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private mesh: THREE.Mesh;
  /** Slot assignment for the sprites baked in the last update, keyed by gSprites index. */
  readonly slots = new Map<number, SlotInfo>();

  constructor(gbaTex: GbaTextures) {
    this.target = new THREE.WebGLRenderTarget(SLOT * SLOT_COLS, SLOT * SLOT_ROWS, {
      colorSpace: THREE.SRGBColorSpace,
      generateMipmaps: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
    });
    const quad = new THREE.BufferGeometry();
    quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.slotSize = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SLOTS * 4), 4);
    this.tile = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SLOTS * 4), 4);
    this.slotSize.setUsage(THREE.DynamicDrawUsage);
    this.tile.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aSlotSize', this.slotSize);
    this.geometry.setAttribute('aTile', this.tile);
    const material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tVram: { value: gbaTex.vram },
        tPalette: { value: gbaTex.palette },
        uAtlas: { value: new THREE.Vector2(SLOT * SLOT_COLS, SLOT * SLOT_ROWS) },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  /** Bakes the given sprites; `map2d` reflects DISPCNT bit 6 == 0. */
  update(renderer: THREE.WebGLRenderer, sprites: readonly SpriteSnap[], map2d: boolean): void {
    this.slots.clear();
    let n = 0;
    const W = SLOT * SLOT_COLS;
    const H = SLOT * SLOT_ROWS;
    for (const s of sprites) {
      if (n >= MAX_SLOTS) break;
      const sx = n % SLOT_COLS;
      const sy = (n / SLOT_COLS) | 0;
      this.slotSize.setXYZW(n, sx, sy, s.width, s.height);
      const flags = (s.bpp8 ? 1 : 0) | (s.hflip ? 2 : 0) | (s.vflip ? 4 : 0) | (map2d ? 8 : 0);
      this.tile.setXYZW(n, s.tileNum, s.palette, flags, 0);
      const u0 = (sx * SLOT) / W;
      const v1 = (sy * SLOT) / H;
      this.slots.set(s.index, {
        slot: n,
        u0, v0: (sy * SLOT + s.height) / H,
        u1: (sx * SLOT + s.width) / W, v1,
      });
      n++;
    }
    this.geometry.instanceCount = n;
    this.slotSize.needsUpdate = true;
    this.tile.needsUpdate = true;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    if (n > 0) renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
  }
}
