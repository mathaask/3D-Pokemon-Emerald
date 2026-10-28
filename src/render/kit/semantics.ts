// The semantic layer: runs model families over the map analysis. Each family claims grid cells
// (so the legacy emitter skips them) and builds meshes. A family that throws is rolled back,
// and its cells render with the legacy pixel geometry.

import * as THREE from 'three';
import { MB } from '../../game/behaviors';
import type { MapAnalysis } from '../overworld/analyze';
import { Claims } from '../overworld/claims';
import type { GridEvents } from './events';
import { releaseKitMaterial, type KitUniforms } from './materials';
import type { Quality } from '../post';

export interface SemanticContext {
  a: MapAnalysis;
  events: GridEvents;
  quality: Quality;
  /** The map being built ("group.num"): a family that fails is warned about once per map, not on
   *  every rebuild of it (spec §11). Unset: every time. */
  mapKey?: string;
}

export interface KitContext {
  uniforms: KitUniforms;
  quality: Quality;
  /** Extra resources (textures) freed with the world. */
  disposables: { dispose(): void }[];
  /** Failures already warned about, as "mapKey|family" (kept by the world for the session). */
  warned?: Set<string>;
}

/** Cells a family drew whose metatile the game may change at run time, and how it follows such a change in place
 *  (Phase 4b, D3: the incremental world update, World.patch). */
export interface LiveCells {
  /** The family's. */
  readonly name: string;
  /** Analysis cells (MapAnalysis.idx). */
  readonly cells: ReadonlySet<number>;
  /** Cell i may become grid value `raw` (metatile bits 0–9, collision 10–11, elevation 12–15) without a rebuild. */
  accepts(i: number, raw: number): boolean;
  /** Applies it: state data only (a texel, an attribute value); never a new geometry, material or texture object. */
  apply(i: number, raw: number): void;
}

export interface Family<P> {
  readonly name: string;
  /** Pure: inspects the analysis, claims cells, returns placements. */
  extract(ctx: SemanticContext, claims: Claims): P;
  /** Builds the meshes for the placements (null = nothing to draw). */
  build(p: P, ctx: SemanticContext, kit: KitContext): THREE.Object3D | null;
  /** The cells it drew that follow a runtime metatile change in place (null / absent: none — a change of one of its
   *  cells rebuilds the world). Asked once per build, after its extract and build succeeded; `built` is what build
   *  returned. Its cells must be cells it claimed CLAIM_SURFACE | CLAIM_OBJECT | CLAIM_TOP (the legacy art draws nothing
   *  of them that could go stale). */
  live?(p: P, built: THREE.Object3D | null, ctx: SemanticContext): LiveCells | null;
}

export interface FamilyReport { name: string; ok: boolean; error?: string }

/**
 * A secret-base spot: the cave hole, shrub or tree (closed, or opened by Secret Power) where the
 * player opens a secret base — a gameplay cue, recognised by its metatile behaviour (every secret-
 * base bg event stands on one). No family may model or claim it: it keeps its legacy art, and model
 * runs (cliff faces, tree runs, prop columns, footprints) break around it.
 */
export function isSecretBaseSpot(a: MapAnalysis, i: number): boolean {
  return a.beh[i] >= MB.SECRET_BASE_SPOT_RED_CAVE && a.beh[i] <= MB.SECRET_BASE_SPOT_TREE_RIGHT_OPEN;
}

export interface Extracted {
  claims: Claims;
  payloads: Map<string, unknown>;
  /** Claim bits each family added (for rollback when its build fails). */
  added: Map<string, Uint8Array>;
  report: FamilyReport[];
}

/** Warns that a family failed, once per map when the map is known (`warned` keeps the record). */
export function warnFailure(ctx: SemanticContext, warned: Set<string> | undefined, name: string, what: string): void {
  if (ctx.mapKey !== undefined && warned) {
    const key = `${ctx.mapKey}|${name}`;
    if (warned.has(key)) return;
    warned.add(key);
  }
  console.warn(`[kit] ${name} failed${ctx.mapKey !== undefined ? ` on map ${ctx.mapKey}` : ''} (${what})`);
}

export function extractAll(ctx: SemanticContext, families: readonly Family<unknown>[], warned?: Set<string>): Extracted {
  const claims = new Claims(ctx.a.N);
  const ex: Extracted = { claims, payloads: new Map(), added: new Map(), report: [] };
  for (const f of families) {
    const snap = claims.snapshot();
    try {
      ex.payloads.set(f.name, f.extract(ctx, claims));
      const added = new Uint8Array(claims.bits.length);
      for (let i = 0; i < added.length; i++) added[i] = claims.bits[i] & ~snap.bits[i];
      ex.added.set(f.name, added);
      ex.report.push({ name: f.name, ok: true });
    } catch (e) {
      claims.restore(snap);
      ex.report.push({ name: f.name, ok: false, error: String(e) });
      warnFailure(ctx, warned, f.name, `extract: ${String(e)}`);
    }
  }
  return ex;
}

export function buildAll(ex: Extracted, ctx: SemanticContext, families: readonly Family<unknown>[], kit: KitContext): THREE.Group {
  return buildLive(ex, ctx, families, kit).group;
}

/** buildAll, and the live cells of every family whose extract and build succeeded. A family whose `live` throws keeps
 *  its meshes and claims but has no live cells (a change there rebuilds the world), warned as its other failures are. */
function buildLive(ex: Extracted, ctx: SemanticContext, families: readonly Family<unknown>[], kit: KitContext): { group: THREE.Group; live: LiveCells[] } {
  const group = new THREE.Group();
  group.name = 'kit';
  const live: LiveCells[] = [];
  for (const f of families) {
    if (!ex.payloads.has(f.name)) continue;
    let obj: THREE.Object3D | null;
    try {
      obj = f.build(ex.payloads.get(f.name), ctx, kit);
      if (obj) {
        obj.name = f.name;
        group.add(obj);
      }
    } catch (e) {
      const added = ex.added.get(f.name)!;
      for (let i = 0; i < added.length; i++) ex.claims.bits[i] &= ~added[i];
      const r = ex.report.find((x) => x.name === f.name)!;
      r.ok = false;
      r.error = String(e);
      warnFailure(ctx, kit.warned, f.name, `build: ${String(e)}`);
      continue;
    }
    if (!f.live) continue;
    try {
      const l = f.live(ex.payloads.get(f.name), obj, ctx);
      if (l && l.cells.size) live.push(l);
    } catch (e) {
      warnFailure(ctx, kit.warned, f.name, `live: ${String(e)}`);
    }
  }
  return { group, live };
}

/** What runKit made: the kit's meshes, the claims after every build (a failed family's rolled back), the per-family
 *  outcome and the live cells (Family.live) of every family whose extract and build succeeded. */
export interface KitRun {
  group: THREE.Group;
  claims: Claims;
  report: FamilyReport[];
  live: LiveCells[];
}

export function runKit(ctx: SemanticContext, families: readonly Family<unknown>[], kit: KitContext): KitRun {
  const ex = extractAll(ctx, families, kit.warned);
  const { group, live } = buildLive(ex, ctx, families, kit);
  return { group, claims: ex.claims, report: ex.report, live };
}

/**
 * Frees everything under `root` (except geometries flagged `userData.shared`) and detaches it. Kit
 * materials go back to the session pool instead (releaseKitMaterial): the next build takes them,
 * so their shader programs are not destroyed and compiled again on its first frame.
 */
export function disposeKit(root: THREE.Object3D, kit: KitContext): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) releaseKitMaterial(mat);
    if (m.customDepthMaterial) releaseKitMaterial(m.customDepthMaterial);
    // Frees the instance buffers / VAOs (the renderer only releases them on the object's 'dispose').
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
  for (const d of kit.disposables) d.dispose();
  kit.disposables.length = 0;
  root.removeFromParent();
}
