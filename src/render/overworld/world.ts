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
import { runKit, disposeKit, warnFailure, type Family, type KitContext, type FamilyReport, type LiveCells } from '../kit/semantics';
import { FAMILIES } from '../kit/index';
import { INTERIOR_FAMILIES } from '../kit/interior/index';
import { DEFAULT_PROFILE, interiorScope, mapProfile, type MapProfile } from '../kit/interior/scope';
import { runVisible } from '../kit/interior/cutaway';
import type { WallDir } from '../kit/interior/room';
import { BEHAVIOR_IDS, interiorIds, type InteriorId } from '../kit/tables/building';
import { MB } from '../../game/behaviors';
import { analyze, cellFeatures, groundRefsOf, queries, K, WATER_BEHAVIORS, type MapAnalysis } from './analyze';
import { emitLegacy, type Quad, type TreeQuad } from './legacyQuads';
import { CLAIM_BLADES, CLAIM_SURFACE, type Claims } from './claims';
import type { CellModel, ClassifyOptions } from './classify';
import { TreeCardMaterials, TreeCards, type TreeRow } from './treeCards';

export type WorldStyle = 'modern' | 'retro';

/** More changed cells than this in one grid change rebuild the world (World.patch refuses 'tooMany'). */
export const PATCH_MAX_CELLS = 256;
/** Retro patches its legacy cells too (user answer 1: true; `'retro'` is the unused switch's refusal, F29). */
export const PATCH_RETRO = true;
/** Why World.patch did not take a grid change (the world then rebuilds as before Phase 4b): no world built ('noWorld'),
 *  more than PATCH_MAX_CELLS cells ('tooMany'), the outdoor kit ran (its families are not live: 'outdoorKit'), Retro
 *  with PATCH_RETRO off ('retro'), a claimed cell no family's LiveCells accepts ('claimedNotLive'), an unclaimed cell of an
 *  interior-kit build whose interior id changed (F13: 'notInert'), a change of the analysis' structure — collision, heights,
 *  ground, buildings, the ground references, the dominant floor, the Dry need — or of the build's context ('structure'), a
 *  legacy quad or tree card that changes more than its art ('quads'), or a caught exception ('error'). */
export type PatchRefusal = 'noWorld' | 'tooMany' | 'outdoorKit' | 'retro' | 'claimedNotLive' | 'notInert' | 'structure'
  | 'quads' | 'error';
export const PATCH_REFUSALS: readonly PatchRefusal[] = ['noWorld', 'tooMany', 'outdoorKit', 'retro', 'claimedNotLive', 'notInert',
  'structure', 'quads', 'error'];
/** World.patch's outcome: patched in `ms`, `live` cells by their families and `legacy` cells by a UV rewrite; or refused. */
export type PatchResult = { ok: true; ms: number; live: number; legacy: number } | { ok: false; reason: PatchRefusal };

/** What a build keeps for World.patch (D3). */
interface PatchState {
  style: WorldStyle;
  quality: Quality;
  mapKey: string | undefined;
  interiorKit: boolean;
  opts: Omit<ClassifyOptions, 'margin'>;
  /** The build-time grid (a copy) with the legacy changes patched since: the grid `a` analyses. Live cells keep their
   *  build-time values here, so the analysis never goes stale (F31). */
  grid: GridData;
  a: MapAnalysis;
  /** prepareInterior ran on `a` (the interior kit ran and did not throw): the patch's re-analysis runs it too (F2). */
  prepared: boolean;
  /** Which families ran: the outdoor ones (a change refuses 'outdoorKit'), the interior ones (unclaimed cells must stay
   *  inert, F13) or none. */
  kit: 'outdoor' | 'interior' | null;
  claims: Claims | null;
  live: LiveCells[];
  quads: Quad[];
  /** Per quad: its batch (0 opaque, 1 cutout, 2 water) and its first vertex in that batch's mesh. */
  quadBatch: Uint8Array;
  quadVertex: Uint32Array;
  trees: TreeQuad[];
  dominantFloor: number;
  dry: boolean;
}

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
  /** Grid changes taken in place so far (World.patch), the last one's ms, and the last patch's outcome. */
  patches = 0;
  lastPatchMs = 0;
  lastPatch: PatchResult | null = null;
  /** What the last build keeps for patch (null: no world, or disposed). */
  private patchState: PatchState | null = null;
  /** The legacy meshes by batch (0 opaque, 1 cutout, 2 water; null: the batch drew nothing). */
  private batchMeshes: (THREE.Mesh | null)[] = [null, null, null];
  /** Maps whose patch threw, warned once each ("mapKey", or '' without one). */
  private patchWarned = new Set<string>();

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
    this.batchMeshes = [null, null, null];
    this.patchState = null;
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
      name: f.name, build: f.build.bind(f), live: f.live?.bind(f),
      extract: () => { throw new Error(`${name} made to fail (setFailFamily)`); },
    }));
  }

  build(grid: GridData, opts: Omit<ClassifyOptions, 'margin'>, ctx: WorldBuildContext): void {
    const t0 = performance.now();
    this.buildMeshes(grid, opts, ctx);
    this.builds++;
    this.lastBuildMs = performance.now() - t0;
  }

  /**
   * Takes a same-map grid change in place (D3), or refuses it (the caller then rebuilds, as before Phase 4b). `grid` is
   * the new grid (the build's size), `changed` its cells that differ from the last grid the world took (grid indices,
   * gridDiff.changedCells), `ctx` the build's context. A changed cell some family registered live (LiveCells) is applied
   * by that family; a claimed cell no family accepts refuses. The other cells are re-checked on the build-time grid with
   * only these non-live changes applied (F31): `analyze` (+ prepareInterior where the build ran it, F2) and `emitLegacy`
   * with the build's claims must give the same structure, ground references, dominant floor, Dry need, quads and tree
   * cards, differing only in their art (metatile, variant, texture sub-rectangle); on an interior-kit build each such
   * cell must also be inert (F13). All or nothing: every cell is checked before any is applied. Then the families apply
   * theirs, the legacy quads' and tree cards' UVs are rewritten in place (never a new geometry, material or texture),
   * and the kept analysis and quad list become the new ones. Never calls analyzeMetatiles, never throws (an exception
   * is the refusal 'error', warned once per map).
   */
  patch(grid: GridData, changed: readonly number[], ctx: WorldBuildContext): PatchResult {
    const t0 = performance.now();
    let r: PatchResult;
    try {
      r = this.patchCells(grid, changed, ctx, t0);
    } catch (e) {
      const key = ctx.mapKey ?? '';
      if (!this.patchWarned.has(key)) {
        this.patchWarned.add(key);
        console.warn(`[world] patch failed${ctx.mapKey !== undefined ? ` on map ${ctx.mapKey}` : ''} (${String(e)}); the world rebuilds`);
      }
      r = { ok: false, reason: 'error' };
    }
    if (r.ok) {
      this.patches++;
      this.lastPatchMs = r.ms;
    }
    this.lastPatch = r;
    return r;
  }

  private patchCells(grid: GridData, changed: readonly number[], ctx: WorldBuildContext, t0: number): PatchResult {
    const refuse = (reason: PatchRefusal): PatchResult => ({ ok: false, reason });
    const s = this.patchState;
    if (!s) return refuse('noWorld');
    if (s.kit === 'outdoor') return refuse('outdoorKit');
    if (s.style === 'retro' && !PATCH_RETRO) return refuse('retro');
    if (changed.length > PATCH_MAX_CELLS) return refuse('tooMany');
    // (a world built for another style, map, quality or kit setting, or a grid of another size: a build's matter)
    if (ctx.style !== s.style || ctx.quality !== s.quality || ctx.mapKey !== s.mapKey || (ctx.interiorKit ?? true) !== s.interiorKit
      || grid.width !== s.grid.width || grid.height !== s.grid.height || grid.cells.length !== s.grid.cells.length) {
      return refuse('structure');
    }
    const a = s.a;
    const W = grid.width;
    // ---- sort the cells: live (a family follows them) or legacy (unclaimed)
    const liveCh: { owner: LiveCells; i: number; raw: number }[] = [];
    const legacyCh: { g: number; i: number; raw: number }[] = [];
    for (const g of changed) {
      if (!(g >= 0 && g < grid.cells.length)) throw new Error(`changed cell ${g} outside the ${W}x${grid.height} grid`);
      const i = a.idx(g % W, (g / W) | 0);
      const raw = grid.cells[g];
      const owner = s.live.find((l) => l.cells.has(i));
      if (owner) {
        if (!owner.accepts(i, raw)) return refuse('claimedNotLive');
        liveCh.push({ owner, i, raw });
      } else if (s.claims && s.claims.bits[i] !== 0) {
        return refuse('claimedNotLive');
      } else {
        legacyCh.push({ g, i, raw });
      }
    }
    // ---- the legacy cells: the build-time grid with only these changes applied, analysed as the build did
    let next: { cells: Uint16Array; a: MapAnalysis; quads: Quad[]; trees: TreeQuad[] } | null = null;
    if (legacyCh.length) {
      const indoorVoid = s.opts.indoor || s.opts.underground;
      // (a cell turned from floor to block or back changes its kind for sure — F3: refused before any analysis)
      for (const c of legacyCh) if (floorBlockFlip(s.grid.cells[c.g], c.raw, s.opts.info, indoorVoid)) return refuse('structure');
      const cells = s.grid.cells.slice();
      for (const c of legacyCh) cells[c.g] = c.raw;
      // every cell keeps what analyze reads of it but its metatile: the analysis but for the art (no analyze call);
      // else analysed afresh, as the build did
      const artOnly = legacyCh.every((c) => {
        const f = cellFeatures(s.grid.cells[c.g], s.opts);
        return f >= 0 && f === cellFeatures(c.raw, s.opts);
      });
      let a2: MapAnalysis;
      if (artOnly) a2 = artAnalysis(a, legacyCh);
      else {
        a2 = analyze({ ...s.grid, cells }, { ...s.opts, margin: this.margin });
        if (s.prepared) prepareInterior(a2, mapProfile(s.mapKey ?? null));
      }
      if (s.kit === 'interior' && s.claims) {
        const ids = interiorIds(a, s.mapKey), ids2 = interiorIds(a2, s.mapKey);
        for (const c of legacyCh) if (!inertCell(a, a2, ids, ids2, c.i)) return refuse('notInert');
      }
      // (the art references stay as built where a family read the analysis: the kit's families are given groundOf)
      if (!sameStructure(a, a2, s.kit !== null)) return refuse('structure');
      const q2 = queries(a2);
      if (q2.dominantFloor !== s.dominantFloor) return refuse('structure');
      const { quads, trees } = emitLegacy(a2, s.claims);
      if (quads.some((q) => q.variant === Variant.Dry) !== s.dry) return refuse('structure');
      if (!sameQuadShapes(s.quads, quads) || !sameTreeShapes(s.trees, trees)) return refuse('quads');
      next = { cells, a: a2, quads, trees };
    }
    // ---- apply: the families' cells, then the legacy art's UVs
    for (const c of liveCh) c.owner.apply(c.i, c.raw);
    if (next) {
      // (a new cutout ground reference: the atlas redraws on its next render, as after a rebuild)
      if (!sameBytes(s.a.groundRefs, next.a.groundRefs)) this.atlas.setGroundRefs(next.a.groundRefs);
      this.rewriteQuadUvs(s, next.quads);
      this.rewriteTreeUvs(s, next.trees);
      s.grid = { ...s.grid, cells: next.cells };
      s.a = next.a;
      s.quads = next.quads;
      s.trees = next.trees;
      const a2 = next.a;
      this.model = { ...queries(a2), quads: next.quads, trees: next.trees };
      this.cellOf = (x, y) => {
        const xi = Math.floor(x), yi = Math.floor(y);
        return a2.inside(xi, yi) ? a2.idx(xi, yi) : -1;
      };
    }
    return { ok: true, ms: performance.now() - t0, live: liveCh.length, legacy: legacyCh.length };
  }

  /** Writes the UVs of the quads whose art changed (as buildMeshes writes them) into their batch's mesh, flagging only the
   *  ranges written. */
  private rewriteQuadUvs(s: PatchState, quads: readonly Quad[]): void {
    const touched: (THREE.BufferAttribute | null)[] = [null, null, null];
    for (let k = 0; k < quads.length; k++) {
      const p = s.quads[k], q = quads[k];
      if (p.metatile === q.metatile && p.variant === q.variant && p.tu0 === q.tu0 && p.tu1 === q.tu1 && p.tv0 === q.tv0
        && p.tv1 === q.tv1) continue;
      const b = s.quadBatch[k];
      const mesh = this.batchMeshes[b];
      if (!mesh) throw new Error(`quad ${k}: batch ${b} has no mesh`);
      const uv = mesh.geometry.getAttribute('uv') as THREE.BufferAttribute;
      const at = s.quadVertex[k] * 2;
      quadUvs(this.atlas, q, uv.array as Float32Array, at);
      uv.addUpdateRange(at, 8);
      touched[b] = uv;
    }
    for (const uv of touched) if (uv) uv.needsUpdate = true;
  }

  /** Writes the atlas rectangles of the tree cards whose art changed into their instance slots. */
  private rewriteTreeUvs(s: PatchState, trees: readonly TreeQuad[]): void {
    let attr: THREE.InstancedBufferAttribute | null = null;
    for (let k = 0; k < trees.length; k++) {
      const p = s.trees[k], t = trees[k];
      if (p.metatile === t.metatile && p.variant === t.variant) continue;
      attr ??= (this.treeCards?.mesh.geometry.getAttribute('aUvRect') as THREE.InstancedBufferAttribute | undefined) ?? null;
      if (!attr) throw new Error('tree cards changed, but the world has none');
      this.atlas.uv(t.metatile, t.variant, UV);
      (attr.array as Float32Array).set(UV, k * 4);
      attr.addUpdateRange(k * 4, 4);
    }
    if (attr) attr.needsUpdate = true;
  }

  private buildMeshes(grid: GridData, opts: Omit<ClassifyOptions, 'margin'>, ctx: WorldBuildContext): void {
    this.dispose();
    let a = analyze(grid, { ...opts, margin: this.margin });
    let claims: Claims | null = null;
    let live: LiveCells[] = [];
    let prepared = false;
    this.kitReport = [];
    this.interiorKitRan = false;
    // the kit: Modern, not underground; outdoors the outdoor families, on an in-scope interior the interior ones
    const modern = ctx.style === 'modern' && !opts.underground;
    const interior = modern && opts.indoor && interiorScope(opts, ctx.mapKey ?? null) && (ctx.interiorKit ?? true);
    const families = !modern ? null : !opts.indoor ? this.families : interior ? this.interiorFamilies : null;
    const kitKind = families && families.length ? (interior ? 'interior' : 'outdoor') : null;
    if (families && families.length) {
      try {
        this.kit.quality = ctx.quality;
        // (rooms are flat: the solver's heights in a few of them are counter rings voting steps)
        if (interior) { prepareInterior(a, mapProfile(ctx.mapKey ?? null)); prepared = true; }
        const r = runKit({ a, events: ctx.events, quality: ctx.quality, mapKey: ctx.mapKey }, this.withFail(families), this.kit);
        claims = r.claims;
        live = r.live;
        this.kitReport = r.report;
        this.kitGroup = r.group;
        this.group.add(r.group);
        this.interiorKitRan = interior;
        r.group.traverse((o) => { if (o.userData.wallDir !== undefined) this.cutaway.push(o); });
      } catch (e) {
        warnFailure({ a, events: ctx.events, quality: ctx.quality, mapKey: ctx.mapKey }, this.kit.warned, 'semantic layer',
          `${String(e)}; this map uses Retro 3D`);
        claims = null;
        live = [];
        this.cutaway = [];
        if (this.kitGroup) { disposeKit(this.kitGroup, this.kit); this.kitGroup = null; }
        // (the map as today: its own heights)
        if (interior) { a = analyze(grid, { ...opts, margin: this.margin }); prepared = false; }
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
    const batches = [newBatch(), newBatch(), newBatch()]; // opaque, cutout, water
    const quadBatch = new Uint8Array(model.quads.length);
    const quadVertex = new Uint32Array(model.quads.length);

    model.quads.forEach((q, k) => {
      const b = quadBatchOf(q);
      const batch = batches[b];
      const base = batch.positions.length / 3;
      quadBatch[k] = b;
      quadVertex[k] = base;
      // Corners: a = top-left of texture, b = top-right, c = bottom-right, d = bottom-left.
      batch.positions.push(...q.a, ...q.b, ...q.c, ...q.d);
      for (let c = 0; c < 4; c++) batch.normals.push(q.normal[0], q.normal[1], q.normal[2]);
      quadUvs(this.atlas, q, batch.uvs, batch.uvs.length);
      for (let c = 0; c < 4; c++) batch.colors.push(q.shade, q.shade, q.shade);
      const g = q.glow ? 1 : 0;
      batch.glow.push(g, g, g, g);
      batch.indices.push(base, base + 3, base + 1, base + 1, base + 3, base + 2);
    });

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
    this.batchMeshes = [
      this.addMesh(batches[0], legacy.opaque, true),
      this.addMesh(batches[1], legacy.cutout, true),
      this.addMesh(batches[2], this.materials.water, false),
    ];

    this.patchState = {
      style: ctx.style, quality: ctx.quality, mapKey: ctx.mapKey, interiorKit: ctx.interiorKit ?? true, opts,
      grid: { ...grid, cells: grid.cells.slice(), border: [...grid.border] }, a, prepared, kit: kitKind, claims, live,
      quads: model.quads, quadBatch, quadVertex, trees: model.trees, dominantFloor: model.dominantFloor,
      dry: model.quads.some((q) => q.variant === Variant.Dry),
    };
  }

  private addMesh(b: QuadBatch, material: THREE.Material, castShadow: boolean): THREE.Mesh | null {
    if (b.indices.length === 0) return null;
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
    return mesh;
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

/** A legacy quad's batch: 0 opaque, 1 cutout, 2 water (World.buildMeshes; the patch rewrites a quad's UVs in its batch). */
function quadBatchOf(q: Quad): number {
  return q.water ? 2 : q.cutout ? 1 : 0;
}

/** Writes quad `q`'s four corner UVs (a, b, c, d: the art's sub-rectangle in the atlas) into `out` from `at`: the one
 *  computation of World.buildMeshes and World.patch (equal floats, so a patched world equals a rebuilt one). */
function quadUvs(atlas: MetatileAtlas, q: Quad, out: Float32Array | number[], at: number): void {
  atlas.uv(q.metatile, q.variant, UV);
  // Sub-rectangle of the metatile texture (for faces spanning partial rows).
  const u0 = UV[0] + (UV[2] - UV[0]) * q.tu0;
  const u1 = UV[0] + (UV[2] - UV[0]) * q.tu1;
  const v0 = UV[1] + (UV[3] - UV[1]) * q.tv0;
  const v1 = UV[1] + (UV[3] - UV[1]) * q.tv1;
  out[at] = u0; out[at + 1] = v0;
  out[at + 2] = u1; out[at + 3] = v0;
  out[at + 4] = u1; out[at + 5] = v1;
  out[at + 6] = u0; out[at + 7] = v1;
}

/** Same bytes (NaN-safe: Float32 arrays compare bit patterns). */
function sameBytes(p: ArrayBufferView, q: ArrayBufferView): boolean {
  if (p === q) return true;
  if (p.byteLength !== q.byteLength) return false;
  const x = new Uint8Array(p.buffer, p.byteOffset, p.byteLength), y = new Uint8Array(q.buffer, q.byteOffset, q.byteLength);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}

/** The analysis' structure (D3): what the legacy geometry and the families' models stand on — kinds (a collision change
 *  always differs: Floor ↔ Block, F3), heights, ground heights, buildings, round trees, water levels, the real 0x3FF
 *  cells; with `refs`, also the art references: the ground metatile under each block (`groundOf`) and the cutout ground
 *  reference of each metatile (`groundRefs`). Raw art (mt, beh, layer) may differ: the quads and the inertness check
 *  judge it. (Without `refs` — a build no family read them in — groundOf only picks the art of the floor under a block
 *  and, outdoors, whether a sparse prop stands as a card: the quad comparison judges both; groundRefs then goes to the
 *  atlas as a rebuild's does. A thin-ice crack next to a wall changes the wall's groundOf.) */
function sameStructure(a: MapAnalysis, b: MapAnalysis, refs: boolean): boolean {
  if (a.N !== b.N || a.buildings.length !== b.buildings.length) return false;
  const arrays: [ArrayBufferView, ArrayBufferView][] = [[a.kind, b.kind], [a.height, b.height], [a.groundH, b.groundH],
    [a.building, b.building], [a.roundTree, b.roundTree], [a.waterLevel, b.waterLevel], [a.real3ff, b.real3ff]];
  if (refs) arrays.push([a.groundOf, b.groundOf], [a.groundRefs, b.groundRefs]);
  for (const [p, q] of arrays) if (!sameBytes(p, q)) return false;
  for (let k = 0; k < a.buildings.length; k++) {
    const p = a.buildings[k], q = b.buildings[k];
    if (p.doorRow !== q.doorRow || p.cells.length !== q.cells.length || p.cells.some((c, j) => c !== q.cells[j])) return false;
  }
  return true;
}

const sameVec = (p: readonly number[], q: readonly number[]) => p[0] === q[0] && p[1] === q[1] && p[2] === q[2];

/** Same legacy quads but for their art (metatile, variant, texture sub-rectangle): count, order, corners, normal, shade,
 *  cutout, water, glow (D3). */
function sameQuadShapes(p: readonly Quad[], q: readonly Quad[]): boolean {
  if (p.length !== q.length) return false;
  for (let k = 0; k < p.length; k++) {
    const x = p[k], y = q[k];
    if (!sameVec(x.a, y.a) || !sameVec(x.b, y.b) || !sameVec(x.c, y.c) || !sameVec(x.d, y.d) || !sameVec(x.normal, y.normal)
      || x.shade !== y.shade || x.cutout !== y.cutout || !!x.water !== !!y.water || !!x.glow !== !!y.glow) return false;
  }
  return true;
}

/** Same tree cards but for their art (metatile, variant): count, order, pivot, row (F30). */
function sameTreeShapes(p: readonly TreeQuad[], q: readonly TreeQuad[]): boolean {
  if (p.length !== q.length) return false;
  for (let k = 0; k < p.length; k++) {
    const x = p[k], y = q[k];
    if (x.px !== y.px || x.py !== y.py || x.pz !== y.pz || x.y0 !== y.y0) return false;
  }
  return true;
}

/** An unclaimed cell of an interior-kit build may change in place only if the families cannot see it change (F13): the
 *  same interior id as the families read it (`interiorIds(a, mapKey)`: state-free, D2; position-listed mechanic cells by
 *  their kind, F4) with the same interaction-behaviour fallback, or no id before and after (null or `legacy`). Reads no
 *  puzzle id (F12). */
function inertCell(a: MapAnalysis, b: MapAnalysis, ids: readonly (InteriorId | null)[], ids2: readonly (InteriorId | null)[],
  i: number): boolean {
  const none = (v: InteriorId | null) => v === null || v === 'legacy';
  const p = ids[i], q = ids2[i];
  if (none(p) && none(q)) return true;
  return p === q && (BEHAVIOR_IDS.get(a.beh[i]) ?? null) === (BEHAVIOR_IDS.get(b.beh[i]) ?? null);
}

/** Whether an in-map cell's grid value going from `p` to `q` turns a floor cell into a block or back in analyze's first
 *  reading (neither void, water nor ledge; neither a 0x3FF block): the final kinds then differ for sure — a floor ends
 *  Floor or Stairs, a block Block, Water, Tree or Building. */
function floorBlockFlip(p: number, q: number, info: ClassifyOptions['info'], voidAllowed: boolean): boolean {
  const first = (raw: number): number => {
    const m = raw & 0x3ff;
    if (m === 0x3ff) return -1;
    const b = info.attributes[m] & 0xff;
    if ((voidAllowed && info.isVoid[m]) || WATER_BEHAVIORS.has(b) || (b >= MB.JUMP_EAST && b <= MB.JUMP_SOUTHWEST)) return -1;
    return (raw >> 10) & 3 ? K.Block : K.Floor;
  };
  const x = first(p), y = first(q);
  return x >= 0 && y >= 0 && x !== y;
}

/** Analysis `a` with the art-only changes `ch` (every cell keeps its cellFeatures): the cells' metatile and behaviour,
 *  the ground art of the blocks that took a changed cell's metatile (groundSrc), the ground references and hasTop
 *  follow; the structure is `a`'s own arrays (analyze would compute them alike: tests/smoke/worldPatch.test.ts). */
export function artAnalysis(a: MapAnalysis, ch: readonly { i: number; raw: number }[]): MapAnalysis {
  const mt = a.mt.slice(), beh = a.beh.slice();
  const changed = new Uint8Array(a.N);
  for (const c of ch) {
    mt[c.i] = c.raw & 0x3ff;
    beh[c.i] = a.info.attributes[mt[c.i]] & 0xff;
    changed[c.i] = 1;
  }
  const groundOf = a.groundOf.slice();
  for (let k = 0; k < a.N; k++) {
    const j = a.groundSrc[k];
    if (j >= 0 && changed[j]) groundOf[k] = mt[j];
  }
  const { layer, info } = a;
  return {
    ...a, mt, beh, groundOf, groundRefs: groundRefsOf(mt, groundOf),
    hasTop: (i: number) => layer[i] !== 1 && info.topCover[mt[i]] > 0,
  };
}

/** The interior kit's preparation of an analysis: the one function World.buildMeshes, the patch's re-analysis and the
 *  smoke helpers use (F2). Today flattenFloors(a); Task 7 adds the tiers of `profile.tiers` maps (D13). It must read
 *  only the analysis' structure and the cells' interior ids (the patch's art-only path keeps its result for cells whose
 *  ids it checked unchanged). */
export function prepareInterior(a: MapAnalysis, profile: MapProfile = DEFAULT_PROFILE): void {
  void profile;
  flattenFloors(a);
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
