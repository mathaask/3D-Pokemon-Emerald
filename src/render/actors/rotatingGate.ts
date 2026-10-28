// The rotating gates of the Fortree Gym and Trick House 6 (Modern, Phase 4b Task 13): wooden turnstiles in place of the
// GBA's gate sprites. A gate is a CreateSprite sprite (rotating_gate.c RotatingGate_CreateGate), not an object event, so
// the actor layer recognises it by its callback (isRotatingGate) before it classifies sprites, and draws it here.
//
// What the GBA shows, and how the model follows it:
// - The sprite's centre is the gate's pivot: a cell CORNER (GetMapCoordsFromSpritePos puts the sprite at x * 16, not
//   x * 16 + 8 as an object event), the north-west corner of the gate's cell. The arms run along the cell edges from it.
// - The image in OBJ VRAM is the gate unrotated (orientation 0): a hub at the image centre and up to four arms, one or
//   two cells (16 / 32 px) long, towards N/E/S/W (32×32 for L1/T1, 64×64 otherwise). gateArms reads them from it.
// - The OAM is affine: the hardware turns the image by the sprite's matrix, which the game's affine anims set — one of
//   the four orientations at rest, a quarter turn over 16 frames (8 when the player runs or cycles) when pushed.
//   SpriteSnap.rotation = atan2(pc, pa) is that angle, anticlockwise on screen (BIOS ObjAffineSet: pa = cos, pc = sin,
//   the matrix maps screen to texture; rotating_gate.c's 90° clockwise orientation is −64 / 256 of a turn). The model
//   turns by gateYaw(rotation) every frame, so it stands and turns exactly as the sprite is drawn.
// The model stands on the floor at the pivot (the lowest ground of the four cells around it). Its geometry is coloured
// from the sprite's own palette (gateColors) and drawn with the object models' material (the program the Phase 2
// models already compiled: no new program); a batch per (arms, colours, quality), instanced.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SpriteSnap } from '../../game/state';
import { isRotatingGate } from '../../game/spriteKinds';
import { luma, toLinear, type RGB } from '../kit/palette';
import { put, markRange } from '../instanceUpload';
import type { Quality } from '../post';
import type { SpriteSample } from './spriteColors';

export { isRotatingGate };

/** Arm lengths (cells, 0–2) towards N/E/S/W at rotation 0 (the unrotated image). */
export interface GateArms { n: number; e: number; s: number; w: number }

/** An image's opaque pixels (x right, y down; the pivot at its centre). */
export interface GateImage { w: number; h: number; opaque(x: number, y: number): boolean }

/** GBA pixels per cell. */
const CELL_PX = 16;
/** The longest arm (rotating_gate.c GATE_ARM_MAX_LENGTH). */
const ARM_MAX = 2;

/**
 * The arm lengths of a gate image: from the centre (the pivot, between the two middle rows / columns) along each axis,
 * the run of opaque pixels on either middle row / column (the arm is 4 px wide across them), rounded to cells (an arm
 * reaches 15 px per cell from the pivot; the hub alone 3 px: 0). Clamped to 0–2.
 */
export function gateArms(image: GateImage): GateArms {
  const cx = image.w >> 1, cy = image.h >> 1;
  // the run out of the pivot along x (dir ±1: from column cx / cx − 1) or along y (from row cy / cy − 1)
  const run = (alongX: boolean, dir: 1 | -1) => {
    const size = alongX ? image.w : image.h, c = alongX ? cx : cy;
    let n = 0;
    for (let t = dir > 0 ? c : c - 1; t >= 0 && t < size; t += dir) {
      const hit = alongX ? image.opaque(t, cy - 1) || image.opaque(t, cy) : image.opaque(cx - 1, t) || image.opaque(cx, t);
      if (!hit) break;
      n++;
    }
    return Math.min(ARM_MAX, Math.round(n / CELL_PX));
  };
  return { n: run(false, -1), e: run(true, 1), s: run(false, 1), w: run(true, -1) };
}

/**
 * The model's yaw (rad, about +Y) for a sprite rotation: the same angle. SpriteSnap.rotation turns the image anticlockwise
 * on screen (x right, y down), and a positive yaw turns the model anticlockwise seen from above (north = −Z up the
 * screen, east = +X): the model's north arm (−Z) goes where the image's top arm is drawn.
 */
export function gateYaw(rotation: number): number {
  return rotation;
}

/** Fallback wood (sRGB) for a gate whose sprite gave no colours. */
const WOOD = { main: [0.52, 0.45, 0.28] as RGB, dark: [0.25, 0.22, 0.12] as RGB };
/** Floors (sRGB luma) of the two woods, hue kept: the posts' dark tone is the sprite's near-black olive outline. */
const MIN_LUMA = { main: 0.4, dark: 0.18 };

function lumaAtLeast(c: RGB, min: number): RGB {
  const l = luma(c);
  if (l <= 0 || l >= min) return c;
  const k = min / l;
  return c.map((v) => Math.min(1, v * k)) as RGB;
}

/** The gate's two woods (sRGB) from its sprite: main = its highlight tone (the arms' light stripe and bolt: the rails),
 *  dark = its body tone (the dark olive of the beams: the hub and the posts), each lifted to MIN_LUMA. */
export function gateColors(sample: SpriteSample): { main: RGB; dark: RGB } {
  let c = colorMemo.get(sample);
  if (!c) {
    const main = sample.tones.highlight ?? sample.colors.main ?? WOOD.main;
    const dark = sample.tones.body ?? sample.colors.main ?? WOOD.dark;
    colorMemo.set(sample, c = { main: lumaAtLeast(main, MIN_LUMA.main), dark: lumaAtLeast(dark, MIN_LUMA.dark) });
  }
  return c;
}
/** gateColors per sample (SpriteColorCache hands out one sample object per sprite image and palette). */
const colorMemo = new WeakMap<SpriteSample, { main: RGB; dark: RGB }>();

/** The turnstile's measures (world units; a cell is 1). Height ≤ 0.9 (D6: it hides nothing the 16-px-tall sprite
 *  bands do not). */
export const GATE = {
  height: 0.9,
  hubR: 0.12,
  /** The rails' two bars: centre heights, height, width. */
  bars: [0.4, 0.75] as const, barH: 0.09, barW: 0.08,
  /** Posts at the arm tips (and half way along a long arm): side, height. */
  post: 0.1, postH: 0.84,
} as const;

/** Hub sides by quality. */
const HUB_SIDES: Record<Quality, number> = { low: 8, medium: 12, high: 16 };

const _p = new THREE.Vector3(), _n = new THREE.Vector3();

/** Adds `g` (taken over) with its colour (linear) shaded by the face's normal: tops lighter, undersides dark. */
function painted(g: THREE.BufferGeometry, c: RGB): THREE.BufferGeometry {
  const p = g.index ? g.toNonIndexed() : g;
  if (p !== g) g.dispose();
  for (const k of Object.keys(p.attributes)) if (k !== 'position' && k !== 'normal') p.deleteAttribute(k);
  p.clearGroups();
  const pos = p.getAttribute('position'), nor = p.getAttribute('normal');
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    _p.fromBufferAttribute(pos, i);
    _n.fromBufferAttribute(nor, i);
    // (lit tops, a little dimmer sides, dark undersides; posts a touch darker near the ground)
    const k = (_n.y > 0.5 ? 1.15 : _n.y < -0.5 ? 0.55 : 0.9) * (0.8 + 0.2 * Math.min(1, _p.y / 0.3));
    col[i * 4] = c[0] * k; col[i * 4 + 1] = c[1] * k; col[i * 4 + 2] = c[2] * k;
    col[i * 4 + 3] = 1; // TINT.fixed (models.ts): the vertex colour as it is
  }
  p.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return p;
}

const DIRS: Record<keyof GateArms, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

/**
 * A wooden turnstile standing on y = 0 with its pivot at the origin (north −Z, east +X): a round hub post (HUB_SIDES by
 * quality) and, per arm, a rail of two bars from the hub to a post at the arm's tip (its outer face at the arm's length),
 * a long arm with a post half way. Hub and posts in the dark wood, bars in the main wood (sRGB in, linear vertex
 * colours out, colour alpha 1: TINT.fixed). Position, normal and RGBA colour, non-indexed, as the object models'.
 */
export function gateGeometry(arms: GateArms, colors: { main: RGB; dark: RGB }, q: Quality): THREE.BufferGeometry {
  const main = toLinear(colors.main), dark = toLinear(colors.dark);
  const parts: THREE.BufferGeometry[] = [];
  const hub = new THREE.CylinderGeometry(GATE.hubR, GATE.hubR, GATE.height, HUB_SIDES[q]);
  hub.translate(0, GATE.height / 2, 0);
  parts.push(painted(hub, dark));
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, c: RGB) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(painted(g, c));
  };
  for (const k of ['n', 'e', 's', 'w'] as const) {
    const len = arms[k];
    if (len <= 0) continue;
    const [dx, dz] = DIRS[k];
    const along = (d: number) => [dx * d, dz * d] as const;
    // the bars, from inside the hub to the tip post's centre
    const r0 = GATE.hubR * 0.5, r1 = len - GATE.post / 2, mid = (r0 + r1) / 2, span = r1 - r0;
    for (const y of GATE.bars) {
      const [x, z] = along(mid);
      box(x, y, z, dx ? span : GATE.barW, GATE.barH, dz ? span : GATE.barW, main);
    }
    const posts = len > 1 ? [1, r1] : [r1];
    posts.forEach((d, i) => {
      const [x, z] = along(d);
      const side = i === posts.length - 1 ? GATE.post : GATE.post * 0.8;
      box(x, GATE.postH / 2, z, side, GATE.postH, side, dark);
    });
  }
  const g = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

/** Where a gate sprite's model stands: its pivot (the sprite's centre, a cell corner, grid units: x = worldX / 16,
 *  y = (worldY − height − c2cY) / 16) on the lowest ground of the four cells around it, un-projected. */
export function gatePlacement(s: SpriteSnap, heightAt: (x: number, y: number) => number,
  out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const px = s.worldX / CELL_PX, py = (s.worldY - s.height - s.c2cY) / CELL_PX;
  const h = Math.min(heightAt(px - 0.5, py - 0.5), heightAt(px + 0.5, py - 0.5), heightAt(px - 0.5, py + 0.5), heightAt(px + 0.5, py + 0.5));
  out.x = px;
  out.y = h;
  out.z = py + h;
  return out;
}

/** One gate drawn this frame. */
export interface GateInstance {
  arms: GateArms;
  colors: { main: RGB; dark: RGB };
  x: number; y: number; z: number;
  yaw: number;
}

/** rotating_gate.c ROTATING_GATE_PUZZLE_MAX: the most gates a map has (and so the most of one shape). */
export const MAX_GATES = 12;
/** Batches kept with no gate in them before the least recently used is released. */
const MAX_IDLE_BATCHES = 8;

interface Batch { mesh: THREE.InstancedMesh; n: number; used: number; dirty: boolean; frame: number }

/**
 * The gate models: an instanced mesh per (arms, colours, quality) — a gym has a few shapes in one palette — made the
 * first time one is seen, with the given material (the object models': no new program) and shadow-depth material.
 * Rebuilt every frame from the list (a model never outlives its sprite).
 */
export class GateModels {
  readonly group = new THREE.Group();
  private batches = new Map<string, Batch>();
  private frame = 0;
  private drawn = 0;
  quality: Quality = 'medium';

  constructor(private readonly material: THREE.Material, private readonly depth: THREE.Material | undefined) {
    this.group.name = 'rotatingGates';
  }

  /** Gates drawn (last set). */
  get count(): number {
    return this.drawn;
  }

  /** The batch meshes (tests, the precompile). */
  get meshes(): THREE.InstancedMesh[] {
    return [...this.batches.values()].map((b) => b.mesh);
  }

  private batch(g: GateInstance): Batch {
    const c = (v: RGB) => v.map((x) => Math.round(x * 255)).join(',');
    const key = `${g.arms.n}${g.arms.e}${g.arms.s}${g.arms.w}:${c(g.colors.main)}:${c(g.colors.dark)}:${this.quality}`;
    let b = this.batches.get(key);
    if (!b) {
      const mesh = new THREE.InstancedMesh(gateGeometry(g.arms, g.colors, this.quality), this.material, MAX_GATES);
      if (this.depth) mesh.customDepthMaterial = this.depth;
      mesh.name = `rotatingGate:${key}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      this.batches.set(key, b = { mesh, n: 0, used: 0, dirty: false, frame: this.frame });
    }
    return b;
  }

  /** Places this frame's gates (each batch ≤ MAX_GATES); releases batches idle past MAX_IDLE_BATCHES. */
  set(list: readonly GateInstance[]): void {
    this.frame++;
    for (const b of this.batches.values()) b.n = 0;
    this.drawn = 0;
    for (const g of list) {
      const b = this.batch(g);
      if (b.n >= MAX_GATES) continue;
      const c = Math.cos(g.yaw), s = Math.sin(g.yaw);
      const e = b.mesh.instanceMatrix.array as Float32Array, o = b.n * 16;
      // (column-major rotation about +Y and the translation; the other elements keep the identity)
      if (put(e, o, c) | put(e, o + 2, -s) | put(e, o + 8, s) | put(e, o + 10, c) | put(e, o + 12, g.x) | put(e, o + 13, g.y)
        | put(e, o + 14, g.z)) b.dirty = true;
      if (++b.n > b.used) { b.used = b.n; b.dirty = true; }
      b.frame = this.frame;
      this.drawn++;
    }
    for (const b of this.batches.values()) {
      b.mesh.count = b.n;
      b.mesh.visible = b.n > 0;
      if (b.dirty) markRange(b.mesh.instanceMatrix, b.used);
      b.dirty = false;
    }
    const idle = [...this.batches].filter(([, b]) => b.n === 0).sort((a, b) => a[1].frame - b[1].frame);
    for (const [key, b] of idle.slice(0, Math.max(0, idle.length - MAX_IDLE_BATCHES))) {
      this.group.remove(b.mesh);
      b.mesh.geometry.dispose();
      b.mesh.dispose();
      this.batches.delete(key);
    }
  }
}
