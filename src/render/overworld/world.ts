// Builds the 3D world geometry for the current map from the live metatile grid.
//
// Coordinates: X = east (grid x), Z = south (grid y), Y = up; 1 unit = 1 metatile.
// The GBA's oblique view draws a point at ground row y and height h on screen row
// y - h, so anything raised by h is placed at Z = y + h ("un-projection"). From the
// default 45° camera the result lines up with the original pixel art.

import * as THREE from 'three';
import { Variant, type MetatileAtlas } from './metatileAtlas';
import type { Quality } from '../post';
import type { GridEvents } from '../kit/events';
import type { KitUniforms } from '../kit/materials';
import { runKit, disposeKit, warnFailure, type Family, type KitContext, type FamilyReport } from '../kit/semantics';
import { FAMILIES } from '../kit/index';
import { INTERIOR_FAMILIES } from '../kit/interior/index';
import { interiorScope } from '../kit/interior/scope';
import { runVisible } from '../kit/interior/cutaway';
import type { WallDir } from '../kit/interior/room';
import { analyze, queries, K, type MapAnalysis } from './analyze';
import { emitLegacy } from './legacyQuads';
import { CLAIM_BLADES, CLAIM_SURFACE, type Claims } from './claims';
import type { CellModel, ClassifyOptions } from './classify';
import { TreeCardMaterials, TreeCards, type TreeRow } from './treeCards';

export type WorldStyle = 'modern' | 'retro';

export interface WorldBuildContext {
  style: WorldStyle;
  events: GridEvents;
  quality: Quality;
  /** The map ("group.num"): the kit's failures are warned about once per map (unset: every build); also names the maps
   *  `interiorScope` leaves out (OUT_OF_SCOPE_MAPS) — unset, no map is an in-scope interior (it fails closed). */
  mapKey?: string;
  /** The interior kit on in-scope interiors in Modern (default true; false: today's legacy room and light — the
   *  `--ab-feature interior` baseline). */
  interiorKit?: boolean;
}

export interface GridData {
  width: number;
  height: number;
  /** Raw u16 grid: metatile id (bits 0-9), collision (10-11), elevation (12-15). */
  cells: Uint16Array;
  /** Metatile ids used outside the grid (map border, 2x2 pattern). */
  border: number[];
  borderW: number;
  borderH: number;
  /** Border pattern phase: the game indexes the 2x2 border with (x + phase) & 1 (backup map: 1). */
  borderPhase: number;
}

export interface WorldMaterials {
  opaque: THREE.Material;
  cutout: THREE.Material;
  water: THREE.Material;
  /** The HD twins of opaque and cutout (materials.ts createHdWorldMaterials): the legacy quads of a build where the
   *  interior kit ran (the cells it leaves: smooth-edged pixels). Unset: today's everywhere. */
  hd?: Pick<WorldMaterials, 'opaque' | 'cutout'>;
}

interface QuadBatch {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  glow: number[];
  indices: number[];
}

function newBatch(): QuadBatch {
  return { positions: [], normals: [], uvs: [], colors: [], glow: [], indices: [] };
}

const UV = new Float32Array(4);

/** The material of the ground plane under every world (its colour set per build): its only definition (the program
 *  catalogue, kit/catalogue.ts, precompiles it). */
export function groundMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x5a9a6a, roughness: 1 });
}

/** Average sRGB colour (0..1) of a metatile's composite pixels. */
function averageColor(info: { both: Uint16Array }, m: number): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let p = 0; p < 256; p++) {
    const c = info.both[m * 256 + p];
    if (c & 0x8000) continue;
    r += c & 31; g += (c >> 5) & 31; b += (c >> 10) & 31; n++;
  }
  return n ? [r / n / 31, g / n / 31, b / n / 31] : [0.3, 0.5, 0.3];
}

export class World {
  readonly group = new THREE.Group();
  model: CellModel | null = null;
  private meshes: THREE.Mesh[] = [];
  treeCards: TreeCards | null = null;
  /** The tree cards' materials, for the session (their shader programs outlive rebuilds). */
  private treeCardMats: TreeCardMaterials | null = null;
  /** Extra ring of border cells rendered around the grid. */
  readonly margin = 14;
  private kit: KitContext;
  private kitGroup: THREE.Group | null = null;
  /** Per-family outcome of the last build (empty when the kit did not run). */
  kitReport: FamilyReport[] = [];
  /** The interior families ran on the last build (Modern, an in-scope interior, the interior kit on), even if one of
   *  them failed: its room light follows the clock (D8, OverworldView.updateLighting). */
  interiorKitRan = false;
  /** The family whose extract throws on every build (null: none): the harness's and tests' failure path (?kitFail=). */
  private failFamily: string | null = null;
  /** The last build's kit meshes carrying `userData.wallDir` (the interior walls): updateCutaway shows / hides them. */
  private cutaway: THREE.Object3D[] = [];
  /** Builds so far, and the last one's ms (the renderer's stats: a map crossing builds once). */
  builds = 0;
  lastBuildMs = 0;
  /** Walkable surface heights the kit draws instead of the analysis' (per grid cell, NaN = none;
   *  null: Retro, or the kit did not run). */
  private surfaceY: Float32Array | null = null;
  /** Cells where the kit's 3D grass blades stand (null: Retro, the kit did not run, or no blades). */
  private blades: Uint8Array | null = null;
  private cellOf: ((x: number, y: number) => number) | null = null;

  private base = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), groundMaterial());

  constructor(
    private atlas: MetatileAtlas,
    private materials: WorldMaterials,
    uniforms: KitUniforms,
    private families: readonly Family<unknown>[] = FAMILIES,
    private interiorFamilies: readonly Family<unknown>[] = INTERIOR_FAMILIES,
  ) {
    this.kit = { uniforms, quality: 'medium', disposables: [], warned: new Set() };
    this.base.receiveShadow = true;
    this.group.add(this.base);
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    this.meshes = [];
    if (this.treeCards) {
      this.group.remove(this.treeCards.mesh);
      this.treeCards.dispose();
      this.treeCards = null;
    }
    if (this.kitGroup) { disposeKit(this.kitGroup, this.kit); this.kitGroup = null; }
    this.cutaway = [];
  }

  /** Makes the named family's extract throw on every build from now on (null: none): its claims roll back and its
   *  cells render legacy, warned once per map (spec §11). */
  setFailFamily(name: string | null): void {
    this.failFamily = name;
  }

  /** Per frame: hides the interior walls the camera sees from outside (D5; `camBack`: kitUniforms.uCamBack), and the
   *  pocket sides (`userData.pocketDir`: the stairs alcove's side walls) with the walls whose pocket they are. */
  updateCutaway(camBack: THREE.Vector2): void {
    for (const o of this.cutaway) {
      o.visible = runVisible(o.userData.wallDir as WallDir, (o.userData.pocketDir as WallDir | undefined) ?? null, camBack);
    }
  }

  /** The families with the failing one's extract made to throw (setFailFamily). */
  private withFail(families: readonly Family<unknown>[]): readonly Family<unknown>[] {
    const name = this.failFamily;
    if (name === null || !families.some((f) => f.name === name)) return families;
    return families.map((f) => (f.name !== name ? f : {
      name: f.name, build: f.build.bind(f),
      extract: () => { throw new Error(`${name} made to fail (setFailFamily)`); },
    }));
  }

  build(grid: GridData, opts: Omit<ClassifyOptions, 'margin'>, ctx: WorldBuildContext): void {
    const t0 = performance.now();
    this.buildMeshes(grid, opts, ctx);
    this.builds++;
    this.lastBuildMs = performance.now() - t0;
  }

  private buildMeshes(grid: GridData, opts: Omit<ClassifyOptions, 'margin'>, ctx: WorldBuildContext): void {
    this.dispose();
    let a = analyze(grid, { ...opts, margin: this.margin });
    let claims: Claims | null = null;
    this.kitReport = [];
    this.interiorKitRan = false;
    // the kit: Modern, not underground; outdoors the outdoor families, on an in-scope interior the interior ones
    const modern = ctx.style === 'modern' && !opts.underground;
    const interior = modern && opts.indoor && interiorScope(opts, ctx.mapKey ?? null) && (ctx.interiorKit ?? true);
    const families = !modern ? null : !opts.indoor ? this.families : interior ? this.interiorFamilies : null;
    if (families && families.length) {
      try {
        this.kit.quality = ctx.quality;
        // (rooms are flat: the solver's heights in a few of them are counter rings voting steps)
        if (interior) flattenFloors(a);
        const r = runKit({ a, events: ctx.events, quality: ctx.quality, mapKey: ctx.mapKey }, this.withFail(families), this.kit);
        claims = r.claims;
        this.kitReport = r.report;
        this.kitGroup = r.group;
        this.group.add(r.group);
        this.interiorKitRan = interior;
        r.group.traverse((o) => { if (o.userData.wallDir !== undefined) this.cutaway.push(o); });
      } catch (e) {
        warnFailure({ a, events: ctx.events, quality: ctx.quality, mapKey: ctx.mapKey }, this.kit.warned, 'semantic layer',
          `${String(e)}; this map uses Retro 3D`);
        claims = null;
        this.cutaway = [];
        if (this.kitGroup) { disposeKit(this.kitGroup, this.kit); this.kitGroup = null; }
        // (the map as today: its own heights)
        if (interior) a = analyze(grid, { ...opts, margin: this.margin });
      }
    }
    const model: CellModel = { ...queries(a), ...emitLegacy(a, claims) };
    this.surfaceY = claims ? surfaceHeights(claims) : null;
    this.blades = claims ? bladeCells(claims) : null;
    this.cellOf = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y);
      return a.inside(xi, yi) ? a.idx(xi, yi) : -1;
    };
    this.atlas.setGroundRefs(model.groundRefs);
    this.atlas.setDryNeeded(model.quads.some((q) => q.variant === Variant.Dry));
    this.model = model;
    const opaque = newBatch();
    const cutout = newBatch();
    const water = newBatch();

    for (const q of model.quads) {
      const batch = q.water ? water : q.cutout ? cutout : opaque;
      this.atlas.uv(q.metatile, q.variant, UV);
      // Sub-rectangle of the metatile texture (for faces spanning partial rows).
      const u0 = UV[0] + (UV[2] - UV[0]) * q.tu0;
      const u1 = UV[0] + (UV[2] - UV[0]) * q.tu1;
      const v0 = UV[1] + (UV[3] - UV[1]) * q.tv0;
      const v1 = UV[1] + (UV[3] - UV[1]) * q.tv1;
      const base = batch.positions.length / 3;
      // Corners: a = top-left of texture, b = top-right, c = bottom-right, d = bottom-left.
      batch.positions.push(...q.a, ...q.b, ...q.c, ...q.d);
      for (let k = 0; k < 4; k++) batch.normals.push(q.normal[0], q.normal[1], q.normal[2]);
      batch.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      for (let k = 0; k < 4; k++) batch.colors.push(q.shade, q.shade, q.shade);
      const g = q.glow ? 1 : 0;
      batch.glow.push(g, g, g, g);
      batch.indices.push(base, base + 3, base + 1, base + 1, base + 3, base + 2);
    }

    const rows: TreeRow[] = model.trees.map((t) => {
      this.atlas.uv(t.metatile, t.variant, UV);
      return { px: t.px, py: t.py, pz: t.pz, y0: t.y0, u0: UV[0], v0: UV[1], u1: UV[2], v1: UV[3] };
    });
    if (rows.length) {
      this.treeCardMats ??= new TreeCardMaterials(this.atlas.target.texture);
      this.treeCards = new TreeCards(this.treeCardMats, rows);
      this.group.add(this.treeCards.mesh);
    }

    // Base ground plane: anything the reconstruction leaves uncovered reads as ground, not sky.
    this.base.scale.set(model.maxX - model.minX + 40, 1, model.maxY - model.minY + 40);
    this.base.position.set((model.minX + model.maxX) / 2, -0.6, (model.minY + model.maxY) / 2); // below water (-0.3)
    const baseMat = this.base.material as THREE.MeshStandardMaterial;
    // (an in-scope Modern interior draws its plane after the other opaques: it lies under the room's floor, which then
    // hides it by depth instead of shading over it — 0.2–0.4 ms of the iGPU's frame, Task 13; the picture is the same)
    this.base.renderOrder = this.interiorKitRan ? 1 : 0;
    if (opts.indoor || model.dominantFloor < 0) baseMat.color.setRGB(0.01, 0.01, 0.012);
    else {
      const c = averageColor(opts.info, model.dominantFloor);
      baseMat.color.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
    }

    // (an in-scope Modern interior: the cells the kit leaves in HD pixels; everything else as today)
    const legacy = (this.interiorKitRan && this.materials.hd) || this.materials;
    this.addMesh(opaque, legacy.opaque, true);
    this.addMesh(cutout, legacy.cutout, true);
    this.addMesh(water, this.materials.water, false);
  }

  private addMesh(b: QuadBatch, material: THREE.Material, castShadow: boolean): void {
    if (b.indices.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(b.glow, 1));
    g.setIndex(b.indices);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true;
    mesh.castShadow = castShadow;
    this.group.add(mesh);
    this.meshes.push(mesh);
  }

  /** Ground height (world Y) at grid cell (x, y); used to place sprites. Where the kit draws a
   *  walkable cell's surface at its own height (a walk-in door's threshold), that height. */
  heightAt(x: number, y: number): number {
    if (!this.model) return 0;
    const i = this.surfaceY && this.cellOf ? this.cellOf(x, y) : -1;
    if (i >= 0 && !Number.isNaN(this.surfaceY![i])) return this.surfaceY![i];
    return this.model.heightAt(x, y);
  }

  /** True where the kit's 3D grass blades stand on grid cell (x, y): they hide characters' legs. */
  hasGrassBlades(x: number, y: number): boolean {
    const i = this.blades && this.cellOf ? this.cellOf(x, y) : -1;
    return i >= 0 && this.blades![i] === 1;
  }
}

/** Lays every floor of an in-scope interior at height 0 (its walkable cells' heights, the ground under its blocks):
 *  rooms are flat, floor, furniture and actors at one height. The solver gives a few rooms steps (the Lilycove Department
 *  Store floors 13.17, 13.19, 13.20 and the Safari Zone entrance 23.0: counter rings voting height offsets). */
export function flattenFloors(a: MapAnalysis): void {
  for (let i = 0; i < a.N; i++) {
    if (a.kind[i] !== K.Water && !Number.isNaN(a.height[i])) a.height[i] = 0;
    a.groundH[i] = 0;
  }
}

/** The cells still claimed CLAIM_BLADES after the kit's build (a failed grass family lost them). */
function bladeCells(claims: Claims): Uint8Array | null {
  let out: Uint8Array | null = null;
  for (let i = 0; i < claims.bits.length; i++) {
    if (!claims.has(i, CLAIM_BLADES)) continue;
    out ??= new Uint8Array(claims.bits.length);
    out[i] = 1;
  }
  return out;
}

/** The surface heights still claimed after the kit's build (a family whose build failed lost its
 *  CLAIM_SURFACE cells: the legacy art draws them at the analysis height again). */
function surfaceHeights(claims: Claims): Float32Array | null {
  let out: Float32Array | null = null;
  for (let i = 0; i < claims.surfaceY.length; i++) {
    if (Number.isNaN(claims.surfaceY[i]) || !claims.has(i, CLAIM_SURFACE)) continue;
    out ??= new Float32Array(claims.surfaceY.length).fill(NaN);
    out[i] = claims.surfaceY[i];
  }
  return out;
}
