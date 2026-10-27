// Actor self-test (harness --selftest, emu.selfTest(), preview.selfTest()). The inflation field: the live
// field on the GPU against inflateMath's CPU reference of the *current* atlas (a stale or mis-slotted field
// fails), a bleed fixture (fully opaque neighbouring slots: no read may cross a sprite rectangle), and
// the GPU time of one field update. The HD sprite edges: XBR_GLSL against its CPU reference xbrSample on a
// fixture (xbrSelfTest).

import * as THREE from 'three';
import { SLOT, type SpriteAtlas } from '../spriteAtlas';
import { SpriteField } from './spriteField';
import { heights, inflateMax, type InflateParams } from './inflateMath';
import { timeGpuFrames } from '../gpuTiming';
import { XBR_GLSL, XBR_BAKED_GLSL } from './xbr.glsl';
import { XbrBake } from './xbrBake';
import { xbrSample } from '../kit/upscale';

export interface FieldSelfTest {
  /** Used atlas slots compared. */
  slots: number;
  /** Max |GPU − CPU| (sprite px) over the used slots of the live atlas. */
  maxErr: number;
  /** The same on the bleed fixture. */
  fixtureMaxErr: number;
  /** Median GPU ms of one field update over the live atlas (timer queries). */
  gpuMs: number;
  /** The field's highest height (sprite px), inflateMax(field.params): the harness's parity tolerance grows with it
   *  (half-float rounding), max(0.02, 0.003 · inflateMax). */
  inflateMax: number;
}

/** Updates timed for gpuMs (median). */
const TIMED_UPDATES = 60;

/**
 * Reads a target's RGBA pixels (W×H, atlas row order). three's readRenderTargetPixels only logs and leaves
 * the buffer zeroed for a format / type it cannot read, so that is checked first; both that and a GL error
 * on the read throw.
 */
function readPixels<T extends Uint8Array | Uint16Array>(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, out: T): T {
  const { format, type } = target.texture;
  // (a render target's format is never a compressed one)
  if (!renderer.capabilities.textureFormatReadable(format as THREE.PixelFormat) || !renderer.capabilities.textureTypeReadable(type)) {
    throw new Error(`self-test: a ${target.width}×${target.height} target of format ${format} / type ${type} cannot be read back here`);
  }
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
 * alpha inside its rectangle and 0 around it (the final target is cleared every update). `rgba` / `field`
 * are W×H atlas-sized grids (RGBA8 / heights). NaN as soon as any compared texel is NaN (Math.max keeps
 * it, whatever comes before or after); Infinity for an infinite one — both fail a `<= tolerance` check.
 */
export function compareSlots(rgba: Uint8Array, field: Float32Array, W: number, H: number,
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
        maxErr = Math.max(maxErr, Math.abs(field[(oy + y) * W + ox + x] - want)); // (propagates NaN)
      }
    }
  }
  return maxErr;
}

/** Bleed fixture slots (slot x, slot y, width, height): (1,1) and (2,1) are fully opaque 64×64 neighbours
 *  side by side, (1,2) sits directly above (1,1), and a 16×32 sprite takes the corner of slot (3,1). */
const FIXTURE_SLOTS = [1, 1, 64, 64, 2, 1, 64, 64, 1, 2, 64, 64, 3, 1, 16, 32];

/**
 * Bleed fixture: FIXTURE_SLOTS in a fully opaque atlas-sized texture. Every texel around each sprite
 * rectangle is opaque in the atlas and (for the neighbours) non-zero in every pass's target, so a pass
 * reading across one — sideways or up/down, into the neighbour slot or the rest of the slot cell — moves the
 * edges off profile(0.5) / the blur's 0 border; the CPU reference treats outside the rectangle as
 * transparent. Uses its own field (the live one is untouched), freed afterwards with its slot buffer.
 */
function fixtureMaxErr(renderer: THREE.WebGLRenderer, like: SpriteField): number {
  const { width: W, height: H } = like.target;
  const rgba = new Uint8Array(W * H * 4).fill(255);
  const tex = new THREE.DataTexture(rgba, W, H);
  tex.needsUpdate = true;
  const rects = new THREE.InstancedBufferAttribute(new Float32Array(FIXTURE_SLOTS), 4);
  const n = rects.count;
  const field = new SpriteField(W, H, like.params);
  try {
    field.update(renderer, tex, rects, n);
    return compareSlots(rgba, readField(renderer, field), W, H, rects, n, like.params);
  } finally {
    field.dispose(true); // (the fixture's own slot attribute: its GL buffer goes too)
    tex.dispose();
  }
}

/** The atlas slots a field covers: slot rectangles in the atlas's layout (slot x, slot y, width, height) and how many. */
export interface FieldSlots { rects: THREE.InstancedBufferAttribute; count: number }

/**
 * Checks the field as the last frame left it against the CPU reference of the atlas as the last frame
 * left it (call between frames, after the field was updated), then the fixture, then times updates — over `slots`, the
 * slots the field covers (default every used slot of the atlas: the overworld's; the battlers' field covers theirs).
 */
export async function fieldSelfTest(renderer: THREE.WebGLRenderer, atlas: SpriteAtlas, field: SpriteField,
  slots: FieldSlots = { rects: atlas.slotRects, count: atlas.slotCount }): Promise<FieldSelfTest> {
  const { width: W, height: H } = atlas.target;
  if (field.target.width !== W || field.target.height !== H) throw new Error('self-test: the field and the atlas differ in size');
  const { rects, count } = slots;
  const rgba = readPixels(renderer, atlas.target, new Uint8Array(W * H * 4));
  const maxErr = compareSlots(rgba, readField(renderer, field), W, H, rects, count, field.params);
  const fixture = fixtureMaxErr(renderer, field);
  // (re-running the update over the unchanged atlas leaves the same field)
  const t = await timeGpuFrames(renderer.getContext() as WebGL2RenderingContext, TIMED_UPDATES,
    () => field.update(renderer, atlas.target.texture, rects, count));
  return { slots: count, maxErr, fixtureMaxErr: fixture, gpuMs: t.gpuMs, inflateMax: inflateMax(field.params) };
}

export interface XbrSelfTest {
  /** Max |GPU − CPU| (RGBA, 0..1) over the fixture's sample points. */
  maxErr: number;
  /** The same with the decisions baked (XbrBake + xbrSampleBaked: the battlers'), over the points whose texel lies in
   *  the fixture's rectangle (XBR_FIX_RECT: the bake covers only a slot's rectangle, as the battlers' — outside it, in
   *  the opaque neighbour columns, the baked path reads no decisions; the live one sees the rectangle's edge there). */
  bakedMaxErr: number;
  /** Max |live − baked| (RGBA8 bytes) over those points: the baked decisions are the live shader's own (Phase 3 Task 5:
   *  "line by line"), so the battlers' HD edges are byte for byte the live xBR's — the harness gates it at 0. */
  bakedVsLive: number;
}

/** The actors' whole self-test: the field's, and the xBR shader's (`xbr`). */
export interface ActorSelfTest extends FieldSelfTest {
  xbr: XbrSelfTest;
}

/** The xBR fixture's size (texels), the sample grid over it (points per side) and the fixed blend half-width. */
const XBR_FIX = 16;
export const XBR_POINTS = 64;
const XBR_DELTA = 0.1;
/** The fixture's sprite rectangle [x0, y0, x1, y1): columns 14-15 are an opaque neighbour no read may reach. */
export const XBR_FIX_RECT: [number, number, number, number] = [0, 0, 14, XBR_FIX];

/**
 * The xBR fixture (16×16, 0xAABBGGRR, rows in order of y): on transparency, a disc (blue), a 2:1 staircase
 * (red), a 45° staircase (skin, a slightly different skin shade in its lower part: "equal") whose far part
 * is red (an edge between two opaque colours), a dark eye pixel inside the skin, an isolated skin pixel, a
 * diagonal and a horizontal 1-px line (dark); skin columns 14-15 outside the rectangle (a read across it
 * would take the skin there for the sprite's inside: no silhouette). Its colours' distances lie well away
 * from the "equal" threshold (tests/kitXbr.test.ts), so float rounding cannot flip a decision between the
 * GPU and the CPU.
 */
export function xbrFixture(): Uint32Array {
  const T = 0, SKIN = 0xffa8d0ff, SKIN2 = 0xffa8d0f8, BLUE = 0xffc06030, DARK = 0xff282020, RED = 0xff3030e0;
  const img = new Uint32Array(XBR_FIX * XBR_FIX);
  for (let y = 0; y < XBR_FIX; y++) {
    for (let x = 0; x < XBR_FIX; x++) {
      let c = T;
      if ((x + 0.5 - 4) ** 2 + (y + 0.5 - 4) ** 2 < 3.2 ** 2) c = BLUE;
      if (x >= 8 && x - 8 >= 2 * y) c = RED;
      if (x + y >= 17) c = x + y >= 22 ? RED : y >= 12 ? SKIN2 : SKIN;
      if ((x === 11 && y === 9) || (y === 7 && x >= 7 && x <= 12) || (x >= 1 && x <= 6 && y === x + 8)) c = DARK;
      if (x === 9 && y === 3) c = SKIN;
      if (x >= 14) c = SKIN;
      img[y * XBR_FIX + x] = c;
    }
  }
  return img;
}

const XBR_VERT = /* glsl */ `
in vec3 position;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const XBR_FRAG = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D tFix;
uniform vec4 uRect;
out vec4 fragColor;
${XBR_GLSL}
void main() {
  fragColor = xbrSample(tFix, gl_FragCoord.xy * ${(XBR_FIX / XBR_POINTS).toFixed(4)}, uRect, ${XBR_DELTA.toFixed(2)});
}
`;

const XBR_BAKED_FRAG = /* glsl */ `
precision highp float;
precision highp int;
uniform sampler2D tFix;
uniform sampler2D tBake;
uniform vec4 uRect;
out vec4 fragColor;
${XBR_GLSL}
${XBR_BAKED_GLSL}
void main() {
  fragColor = xbrSampleBaked(tFix, tBake, gl_FragCoord.xy * ${(XBR_FIX / XBR_POINTS).toFixed(4)}, uRect, ${XBR_DELTA.toFixed(2)});
}
`;

/**
 * XBR_GLSL against xbrSample: the fixture as an RGBA8 texture, sampled through the shader at a 64×64 grid of
 * points ((i + 0.5) / 4 texels) into an RGBA8 target with delta 0.1, read back and compared with the CPU
 * reference at the same points (NaN-sticky max); then the same through the baked path (XbrBake over the fixture's
 * rectangle, xbrSampleBaked) at the points inside it. Frees everything it made.
 */
export function xbrSelfTest(renderer: THREE.WebGLRenderer): XbrSelfTest {
  const src = xbrFixture();
  const tex = new THREE.DataTexture(new Uint8Array(src.buffer), XBR_FIX, XBR_FIX, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  const target = new THREE.WebGLRenderTarget(XBR_POINTS, XBR_POINTS, {
    depthBuffer: false, generateMipmaps: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
  const bake = new XbrBake(XBR_FIX, XBR_FIX);
  // (the fixture's rectangle as one slot of the atlas layout: slot (0, 0), its width and height)
  const slots = new THREE.InstancedBufferAttribute(new Float32Array([0, 0, XBR_FIX_RECT[2], XBR_FIX_RECT[3]]), 4);
  const quad = new THREE.PlaneGeometry(2, 2);
  const materials: THREE.RawShaderMaterial[] = [];
  const prev = renderer.getRenderTarget();
  // the fixture drawn through a fragment shader into the 64×64 target, read back
  const draw = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>): Uint8Array => {
    const material = new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: XBR_VERT, fragmentShader, uniforms,
      depthTest: false, depthWrite: false });
    materials.push(material);
    const mesh = new THREE.Mesh(quad, material);
    mesh.frustumCulled = false;
    renderer.setRenderTarget(target);
    renderer.render(new THREE.Scene().add(mesh), new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    renderer.setRenderTarget(prev);
    return readPixels(renderer, target, new Uint8Array(XBR_POINTS * XBR_POINTS * 4));
  };
  try {
    const rect = new THREE.Vector4(...XBR_FIX_RECT);
    const gpu = draw(XBR_FRAG, { tFix: { value: tex }, uRect: { value: rect } });
    bake.update(renderer, tex, slots, 1);
    const baked = draw(XBR_BAKED_FRAG, { tFix: { value: tex }, tBake: { value: bake.texture }, uRect: { value: rect } });
    return xbrErrors(src, gpu, baked);
  } finally {
    renderer.setRenderTarget(prev);
    target.dispose();
    for (const m of materials) m.dispose();
    quad.dispose();
    bake.dispose(true);
    tex.dispose();
  }
}

/**
 * The xBR self-test's errors from its two read-backs (`gpu`: the live shader, `baked`: the baked path; RGBA8, the
 * XBR_POINTS² sample grid over the fixture `src`): each against the CPU reference xbrSample at the same points (the baked
 * one inside XBR_FIX_RECT only), and the two against each other there, in bytes (NaN-sticky maxima).
 */
export function xbrErrors(src: Uint32Array, gpu: Uint8Array, baked: Uint8Array): XbrSelfTest {
  let maxErr = 0, bakedMaxErr = 0, bakedVsLive = 0;
  const k = XBR_FIX / XBR_POINTS;
  for (let j = 0; j < XBR_POINTS; j++) {
    for (let i = 0; i < XBR_POINTS; i++) {
      const x = (i + 0.5) * k, y = (j + 0.5) * k;
      const want = xbrSample(src, XBR_FIX, XBR_FIX, x, y, XBR_DELTA, XBR_FIX_RECT);
      const inside = x >= XBR_FIX_RECT[0] && x < XBR_FIX_RECT[2] && y >= XBR_FIX_RECT[1] && y < XBR_FIX_RECT[3];
      for (let c = 0; c < 4; c++) {
        const o = (j * XBR_POINTS + i) * 4 + c;
        maxErr = Math.max(maxErr, Math.abs(gpu[o] / 255 - want[c]));
        if (inside) {
          bakedMaxErr = Math.max(bakedMaxErr, Math.abs(baked[o] / 255 - want[c]));
          bakedVsLive = Math.max(bakedVsLive, Math.abs(baked[o] - gpu[o]));
        }
      }
    }
  }
  return { maxErr, bakedMaxErr, bakedVsLive };
}

/** Both self-tests: the field's (as fieldSelfTest, over `slots`) and the xBR shader's. */
export async function actorSelfTest(renderer: THREE.WebGLRenderer, atlas: SpriteAtlas, field: SpriteField,
  slots?: FieldSlots): Promise<ActorSelfTest> {
  const f = await fieldSelfTest(renderer, atlas, field, slots);
  return { ...f, xbr: xbrSelfTest(renderer) };
}

/**
 * The field over the atlas's used slot rows as a PNG data URL (2×, sprites upright): grey = height / inflateMax();
 * texels transparent in the atlas get a blue tint, so the silhouettes show. The battle's field covers only its battlers'
 * slots (BattleView.fieldSlots): the atlas's other used slots (HUD, move effects) show black there, their silhouettes blue.
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
