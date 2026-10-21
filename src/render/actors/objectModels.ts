// Object models (Modern): one InstancedMesh per kind (Poké Ball, boulder, cracked rock, Cut tree, truck) drawn
// where the objects' sprites stand, rebuilt every frame from the list ActorLayer hands over (a model never
// outlives its sprite). Each kind is tinted from the sprite of its first instance (uTintA / uTintB, linear) by
// the geometry's tint codes (models.ts); the Cut tree keeps the kit trees' convention (crown × the material
// colour, trunk = uTrunk). Materials are kit materials made once and never released (not part of a world
// build). Instance matrices upload only when they change.

import * as THREE from 'three';
import { applyKitMaterial, kitMaterial, type KitUniforms } from '../kit/materials';
import { luma, lush, soften, toLinear, type RGB } from '../kit/palette';
import { TRUNK_FRAG, TRUNK_HEAD } from '../kit/trees';
import { put, markRange } from '../instanceUpload';
import type { ObjectModelKind } from './objectMap';
import type { SpriteColors } from './spriteColors';
import { MASK_GLSL } from './inflatedActors';
import { boulderGeo, crackedRockGeo, cutTreeGeo, pokeBallGeo, truckGeo } from './models';

/** Instances per kind: gObjectEvents has 16 slots. */
export const MAX_PER_KIND = 16;

export interface ModelInstance {
  kind: ObjectModelKind;
  stage: number;
  /** World position of the model's foot (base centre). */
  x: number; y: number; z: number;
  colors: SpriteColors;
  /** Turn about the vertical (rad) of the kinds that vary by object (rocks, trees); stable per object. */
  yaw?: number;
}

type TintPair = [RGB, RGB];

interface KindSpec {
  geometry: () => THREE.BufferGeometry;
  roughness: number;
  /** Tints A and B (sRGB) from the sprite's colours, with the defaults where a colour is missing. */
  tints: (c: SpriteColors) => TintPair;
  /** How far the instance's yaw turns it (rad either way): rocks and trees vary by object; the ball keeps its
   *  button, the truck its cab and the cracked rock its cracks on the side the sprite shows them (0: never). */
  spin: number;
  /** The kit trees' material convention (crown × material colour = tint A, trunk = uTrunk). */
  tree?: boolean;
}

/** Fallback tints (sRGB). */
const DEFAULT = {
  ball: [0.86, 0.16, 0.16] as RGB, boulder: [0.55, 0.5, 0.45] as RGB, rock: [0.6, 0.55, 0.5] as RGB,
  leaves: [0.3, 0.6, 0.3] as RGB, truck: [0.92, 0.92, 0.9] as RGB, truckTrim: [0.2, 0.35, 0.8] as RGB,
};
/** Bark of the Cut tree (sRGB). */
const TRUNK: RGB = [0.42, 0.3, 0.2];
/**
 * Least sRGB luma of the rock and leaf tints. These sprites' colour statistics land on their darkest shade: the
 * rocks' most frequent colour is their dark (56, 56, 24) (luma 0.21, just over pickColors' outline cut), half the
 * Cut tree's pixels are its dark green outline (16, 56, 0), which its green mean takes in. Taken as they are, the
 * models are far darker than the sprites they replace (actor luminance 0.55× Retro on fiery_boulders, a Cut tree
 * black-green beside the kit's trees). Lifted to these lumas, hue kept: about the sprites' mid shades
 * ((120, 112, 64); (64, 120, 0) to (112, 184, 0)).
 */
export const MIN_LUMA = { rock: 0.36, leaves: 0.4 };
/** Most sRGB luma of a rock's tint: its lit tops (models.ts rockShade, up to 1.75×) stay under the bloom with a
 *  pale palette. */
const ROCK_MAX_LUMA = 0.6;

/** `c` scaled to a luma within [min, max] (hue kept). */
function lumaWithin(c: RGB, min: number, max = 1): RGB {
  const l = luma(c);
  if (l <= 0 || (l >= min && l <= max)) return c;
  const k = (l < min ? min : max) / l;
  return c.map((v) => Math.min(1, v * k)) as RGB;
}

const rockTint = (c: SpriteColors, fallback: RGB): RGB => (c.main ? lumaWithin(soften(c.main), MIN_LUMA.rock, ROCK_MAX_LUMA) : fallback);

const SPECS: Partial<Record<ObjectModelKind, KindSpec>> = {
  pokeball: { geometry: pokeBallGeo, roughness: 0.35, spin: 0, tints: (c) => { const a = c.accent ?? DEFAULT.ball; return [a, a]; } },
  boulder: { geometry: () => boulderGeo(87), roughness: 0.8, spin: Math.PI, tints: (c) => { const a = rockTint(c, DEFAULT.boulder); return [a, a]; } },
  crackedRock: { geometry: () => crackedRockGeo(86), roughness: 0.8, spin: 0.5, tints: (c) => { const a = rockTint(c, DEFAULT.rock); return [a, a]; } },
  cutTree: { geometry: () => cutTreeGeo(92), roughness: 0.85, spin: Math.PI, tree: true,
    tints: (c) => { const a = c.green ? lumaWithin(lush(c.green), MIN_LUMA.leaves) : DEFAULT.leaves; return [a, a]; } },
  truck: { geometry: truckGeo, roughness: 0.6, spin: 0, tints: (c) => [c.main ?? DEFAULT.truck, c.accent ?? DEFAULT.truckTrim] },
};

const NO_COLORS: SpriteColors = { main: null, accent: null, green: null };

// Tint codes (models.ts): colour alpha 1 = the vertex colour as it is, 0.5 = × tint A, 0 = × tint B.
const TINT_HEAD = /* glsl */ `
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform float uMask;
`;
const TINT_FRAG = /* glsl */ `
#ifdef USE_COLOR_ALPHA
diffuseColor.rgb *= vColor.a > 0.75 ? vec3(1.0) : (vColor.a > 0.25 ? uTintA : uTintB);
diffuseColor.a = 1.0;
#endif
`;
// (the Cut tree: the trees' hooks, plus the harness mask)
const TREE_HEAD = TRUNK_HEAD + 'uniform float uMask;\n';
/** Gentle sway of the Cut tree (the bushy trees' at its size). */
const TREE_WIND = { amp: 0.03, height: 1.15 };

interface Kind {
  spec: KindSpec;
  mesh: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;
  tintA: THREE.Color;
  tintB: THREE.Color;
  /** The colours the tints were last derived from (SpriteColorCache hands out one object per key). */
  colors: SpriteColors | null;
  /** This frame's instances; the most ever set (the uploaded part of instanceMatrix); matrices changed. */
  n: number;
  used: number;
  dirty: boolean;
}

/**
 * Compiles every material under `root` for the scene's lights and a render target (as PostFX draws the scene:
 * no tone mapping, linear output), and renders the scene once into a 1×1 target: its shadow pass compiles the
 * shadow-depth programs compileAsync skips (custom depth materials, three's instanced depth variant). The
 * caller makes what must compile visible first and may hide it again as soon as this returns (the render
 * has run); the promise resolves when the programs are ready.
 */
export function precompileScene(renderer: THREE.WebGLRenderer, root: THREE.Object3D, scene: THREE.Scene, camera: THREE.Camera): Promise<unknown> {
  const target = new THREE.WebGLRenderTarget(1, 1);
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  try {
    const ready = renderer.compileAsync(root, camera, scene);
    renderer.render(scene, camera);
    return ready;
  } finally {
    renderer.setRenderTarget(prev);
    target.dispose();
  }
}

export class ObjectModels {
  readonly group = new THREE.Group();
  private kinds = new Map<ObjectModelKind, Kind>();
  private mask = { value: 0 };
  /**
   * The shadow-depth material of the models without a kit depth twin (the Cut tree sways: it has one). Three's own
   * is shared by every caster and only re-picks its program when the instancing flag flips, so instanced models
   * drawn among the world's non-instanced casters made it compile new variants for those (a world mesh with a
   * map) the first time a model appeared after a live Retro→Modern switch. Back faces, as three draws them.
   */
  private depth = new THREE.MeshDepthMaterial({ side: THREE.BackSide });

  constructor(kit: KitUniforms) {
    this.group.name = 'objectModels';
    for (const [name, spec] of Object.entries(SPECS) as [ObjectModelKind, KindSpec][]) {
      const tintA = new THREE.Color(), tintB = new THREE.Color();
      const km = spec.tree
        ? kitMaterial(kit, {
          vertexColors: true, roughness: spec.roughness, wind: TREE_WIND.amp, windHeight: TREE_WIND.height, fade: true,
          uniforms: { uTrunk: { value: new THREE.Color(...toLinear(TRUNK)) } }, fragHead: TREE_HEAD, fragColor: TRUNK_FRAG, hookKey: 'cutTree',
        })
        : kitMaterial(kit, {
          vertexColors: true, roughness: spec.roughness, uniforms: { uTintA: { value: tintA }, uTintB: { value: tintB } },
          fragHead: TINT_HEAD, fragColor: TINT_FRAG, hookKey: 'objectModel',
        });
      // the harness's actor mask (flat magenta), after everything else
      const material = km.material, base = material.onBeforeCompile;
      material.onBeforeCompile = (s, r) => {
        base.call(material, s, r);
        s.uniforms.uMask = this.mask;
        if (!s.fragmentShader.includes('#include <dithering_fragment>')) throw new Error('objectModels: <dithering_fragment> not found');
        s.fragmentShader = s.fragmentShader.replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + MASK_GLSL);
      };
      const mesh = new THREE.InstancedMesh(spec.geometry(), material, MAX_PER_KIND);
      applyKitMaterial(mesh, km);
      if (!km.depth) mesh.customDepthMaterial = this.depth;
      mesh.name = name;
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.tints = { a: tintA, b: tintB };
      this.group.add(mesh);
      const k: Kind = { spec, mesh, material, tintA, tintB, colors: null, n: 0, used: 0, dirty: false };
      this.tint(k, NO_COLORS);
      this.kinds.set(name, k);
    }
  }

  /** Whether a kind has meshes (berry plants: Task 9). */
  supports(kind: ObjectModelKind): boolean {
    return this.kinds.has(kind);
  }

  /** Instances drawn (last set). */
  get count(): number {
    let n = 0;
    for (const k of this.kinds.values()) n += k.n;
    return n;
  }

  /** Resets every mesh's count, then places the instances (≤ MAX_PER_KIND each); a kind's tints follow its
   *  first instance's colours (the defaults where a colour is missing). */
  set(list: readonly ModelInstance[]): void {
    for (const k of this.kinds.values()) k.n = 0;
    for (const inst of list) {
      const k = this.kinds.get(inst.kind);
      if (!k || k.n >= MAX_PER_KIND) continue;
      if (k.n === 0) this.tint(k, inst.colors);
      // (yaw in 0..2π → −spin..spin)
      this.place(k, k.n++, inst.x, inst.y, inst.z, ((inst.yaw ?? Math.PI) / Math.PI - 1) * k.spec.spin);
    }
    for (const k of this.kinds.values()) {
      k.mesh.count = k.n;
      k.mesh.visible = k.n > 0;
      if (k.dirty) {
        markRange(k.mesh.instanceMatrix, k.used);
        k.dirty = false;
      }
    }
  }

  /** Draws the models flat magenta (the harness's visible-actor mask) or normally. */
  setMask(on: boolean): void {
    this.mask.value = on ? 1 : 0;
  }

  /**
   * Compiles the models' programs, their shadow-depth ones included (precompileScene), every mesh shown with one
   * instance meanwhile (restored before this returns). `root` (default: the models) is what compileAsync walks;
   * whatever else the caller made visible compiles in the same scene render.
   */
  precompile(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, root: THREE.Object3D = this.group): Promise<void> {
    const saved = [...this.kinds.values()].map((k) => [k.mesh.visible, k.mesh.count] as const);
    const groupVisible = this.group.visible;
    this.group.visible = true;
    for (const k of this.kinds.values()) {
      k.mesh.visible = true;
      k.mesh.count = 1;
    }
    try {
      return precompileScene(renderer, root, scene, camera).then(() => undefined);
    } finally {
      [...this.kinds.values()].forEach((k, i) => { [k.mesh.visible, k.mesh.count] = saved[i]; });
      this.group.visible = groupVisible;
    }
  }

  /** Instance i of kind k at (x, y, z), turned by `yaw` about the vertical; flags a changed matrix. */
  private place(k: Kind, i: number, x: number, y: number, z: number, yaw: number): void {
    const e = k.mesh.instanceMatrix.array as Float32Array, o = i * 16;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // (column-major; the other elements keep the identity the mesh was made with)
    const d = put(e, o, c) | put(e, o + 2, -s) | put(e, o + 8, s) | put(e, o + 10, c)
      | put(e, o + 12, x) | put(e, o + 13, y) | put(e, o + 14, z);
    if (d) k.dirty = true;
    if (i + 1 > k.used) { k.used = i + 1; k.dirty = true; }
  }

  private tint(k: Kind, colors: SpriteColors): void {
    if (colors === k.colors) return;
    k.colors = colors;
    const [a, b] = k.spec.tints(colors);
    k.tintA.setRGB(...toLinear(a));
    k.tintB.setRGB(...toLinear(b));
    if (k.spec.tree) k.material.color.copy(k.tintA);
  }
}
