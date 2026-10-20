// Inflation-field self-test (harness --selftest, emu.selfTest(), preview.selfTest()): the live field on
// the GPU against inflateMath's CPU reference of the *current* atlas (a stale or mis-slotted field
// fails), a bleed fixture (fully opaque neighbouring slots: no read may cross a sprite rectangle), and
// the GPU time of one field update.

import * as THREE from 'three';
import { SLOT, type SpriteAtlas } from '../spriteAtlas';
import { SpriteField } from './spriteField';
import { heights, inflateMax, type InflateParams } from './inflateMath';
import { timeGpuFrames } from '../gpuTiming';

export interface FieldSelfTest {
  /** Used atlas slots compared. */
  slots: number;
  /** Max |GPU − CPU| (sprite px) over the used slots of the live atlas. */
  maxErr: number;
  /** The same on the bleed fixture. */
  fixtureMaxErr: number;
  /** Median GPU ms of one field update over the live atlas (timer queries). */
  gpuMs: number;
}

/** Updates timed for gpuMs (median). */
const TIMED_UPDATES = 60;

/** Reads a target's RGBA pixels (W×H, atlas row order); throws on a GL error (an unreadable format). */
function readPixels<T extends Uint8Array | Uint16Array>(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, out: T): T {
  const gl = renderer.getContext();
  for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++) { /* clear earlier errors */ }
  renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, out);
  const err = gl.getError();
  if (err !== gl.NO_ERROR) throw new Error(`self-test: reading a ${target.width}×${target.height} target failed (GL error 0x${err.toString(16)})`);
  return out;
}

/** A field's heights (R channel, half floats) as floats, W×H. */
function readField(renderer: THREE.WebGLRenderer, field: SpriteField): Float32Array {
  const { width: W, height: H } = field.target;
  const raw = readPixels(renderer, field.target, new Uint16Array(W * H * 4));
  const out = new Float32Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = THREE.DataUtils.fromHalfFloat(raw[i * 4]);
  return out;
}

/**
 * Max |GPU − CPU| over the first `count` slots: per slot cell (SLOT×SLOT), heights() of the sprite's
 * alpha inside its rectangle and 0 around it (the final target is cleared every update). NaN if the GPU
 * wrote a non-finite value.
 */
function compareSlots(rgba: Uint8Array, field: Float32Array, W: number, H: number,
  rects: THREE.InstancedBufferAttribute, count: number, params: InflateParams): number {
  let maxErr = 0;
  for (let s = 0; s < count; s++) {
    const ox = rects.getX(s) * SLOT, oy = rects.getY(s) * SLOT, w = rects.getZ(s), h = rects.getW(s);
    const alpha = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) alpha[y * w + x] = rgba[((oy + y) * W + ox + x) * 4 + 3] >= 128 ? 1 : 0;
    const hs = heights(alpha, w, h, params);
    const cw = Math.min(Math.max(SLOT, w), W - ox), ch = Math.min(Math.max(SLOT, h), H - oy);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const want = x < w && y < h ? hs[y * w + x] : 0;
        const err = Math.abs(field[(oy + y) * W + ox + x] - want);
        if (!(err <= maxErr)) maxErr = err; // (NaN sticks)
      }
    }
  }
  return maxErr;
}

/**
 * Bleed fixture: in a fully opaque atlas-sized texture, two fully opaque 64×64 slots side by side and a
 * 16×32 sprite in the next slot. Every texel around each sprite rectangle is opaque, so a pass reading
 * across one (into the neighbour slot or the rest of the slot cell) changes the edges' distance from 0.5;
 * the CPU reference treats outside the rectangle as transparent. Uses its own field (the live one is untouched).
 */
function fixtureMaxErr(renderer: THREE.WebGLRenderer, like: SpriteField): number {
  const { width: W, height: H } = like.target;
  const rgba = new Uint8Array(W * H * 4).fill(255);
  const tex = new THREE.DataTexture(rgba, W, H);
  tex.needsUpdate = true;
  const rects = new THREE.InstancedBufferAttribute(new Float32Array([1, 1, 64, 64, 2, 1, 64, 64, 3, 1, 16, 32]), 4);
  const field = new SpriteField(W, H, like.params);
  try {
    field.update(renderer, tex, rects, 3);
    return compareSlots(rgba, readField(renderer, field), W, H, rects, 3, like.params);
  } finally {
    field.dispose();
    tex.dispose();
  }
}

/**
 * Checks the field as the last frame left it against the CPU reference of the atlas as the last frame
 * left it (call between frames, after the field was updated), then the fixture, then times updates.
 */
export async function fieldSelfTest(renderer: THREE.WebGLRenderer, atlas: SpriteAtlas, field: SpriteField): Promise<FieldSelfTest> {
  const { width: W, height: H } = atlas.target;
  if (field.target.width !== W || field.target.height !== H) throw new Error('self-test: the field and the atlas differ in size');
  const count = atlas.slotCount;
  const rgba = readPixels(renderer, atlas.target, new Uint8Array(W * H * 4));
  const maxErr = compareSlots(rgba, readField(renderer, field), W, H, atlas.slotRects, count, field.params);
  const fixture = fixtureMaxErr(renderer, field);
  // (re-running the update over the unchanged atlas leaves the same field)
  const t = await timeGpuFrames(renderer.getContext() as WebGL2RenderingContext, TIMED_UPDATES,
    () => field.update(renderer, atlas.target.texture, atlas.slotRects, count));
  return { slots: count, maxErr, fixtureMaxErr: fixture, gpuMs: t.gpuMs };
}

/**
 * The field's used slot rows as a PNG data URL (2×, sprites upright): grey = height / inflateMax();
 * texels transparent in the atlas get a blue tint, so the silhouettes show.
 */
export function fieldDump(renderer: THREE.WebGLRenderer, atlas: SpriteAtlas, field: SpriteField): string {
  const { width: W, height: H } = field.target;
  const rows = Math.min(H, Math.max(1, Math.ceil(atlas.slotCount / (W / SLOT))) * SLOT);
  const heightsGpu = readField(renderer, field);
  const rgba = readPixels(renderer, atlas.target, new Uint8Array(W * H * 4));
  const max = inflateMax(field.params);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = rows;
  const img = new ImageData(W, rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < W; x++) {
      const src = (rows - 1 - y) * W + x; // (atlas rows are bottom-up)
      const g = Math.round(255 * Math.min(1, Math.max(0, heightsGpu[src] / max)));
      const o = (y * W + x) * 4;
      img.data[o] = g;
      img.data[o + 1] = g;
      img.data[o + 2] = rgba[src * 4 + 3] >= 128 ? g : Math.min(255, g + 60);
      img.data[o + 3] = 255;
    }
  }
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  const big = document.createElement('canvas');
  big.width = W * 2;
  big.height = rows * 2;
  const ctx = big.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, W * 2, rows * 2);
  return big.toDataURL('image/png');
}
