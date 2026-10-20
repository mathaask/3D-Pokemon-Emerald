// The semantic layer: runs model families over the map analysis. Each family claims grid cells
// (so the legacy emitter skips them) and builds meshes. A family that throws is rolled back,
// and its cells render with the legacy pixel geometry.

import * as THREE from 'three';
import { MB } from '../../game/behaviors';
import type { MapAnalysis } from '../overworld/analyze';
import { Claims } from '../overworld/claims';
import type { GridEvents } from './events';
import type { KitUniforms } from './materials';
import type { Quality } from '../post';

export interface SemanticContext {
  a: MapAnalysis;
  events: GridEvents;
  quality: Quality;
}

export interface KitContext {
  uniforms: KitUniforms;
  quality: Quality;
  /** Extra resources (textures) freed with the world. */
  disposables: { dispose(): void }[];
}

export interface Family<P> {
  readonly name: string;
  /** Pure: inspects the analysis, claims cells, returns placements. */
  extract(ctx: SemanticContext, claims: Claims): P;
  /** Builds the meshes for the placements (null = nothing to draw). */
  build(p: P, ctx: SemanticContext, kit: KitContext): THREE.Object3D | null;
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

export function extractAll(ctx: SemanticContext, families: readonly Family<unknown>[]): Extracted {
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
      console.warn(`[kit] ${f.name} failed (extract): ${String(e)}`);
    }
  }
  return ex;
}

export function buildAll(ex: Extracted, ctx: SemanticContext, families: readonly Family<unknown>[], kit: KitContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'kit';
  for (const f of families) {
    if (!ex.payloads.has(f.name)) continue;
    try {
      const obj = f.build(ex.payloads.get(f.name), ctx, kit);
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
      console.warn(`[kit] ${f.name} failed (build): ${String(e)}`);
    }
  }
  return group;
}

export function runKit(ctx: SemanticContext, families: readonly Family<unknown>[], kit: KitContext) {
  const ex = extractAll(ctx, families);
  const group = buildAll(ex, ctx, families, kit);
  return { group, claims: ex.claims, report: ex.report };
}

/** Frees everything under `root` (except geometries flagged `userData.shared`) and detaches it. */
export function disposeKit(root: THREE.Object3D, kit: KitContext): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) mat.dispose();
    m.customDepthMaterial?.dispose();
    // Frees the instance buffers / VAOs (the renderer only releases them on the object's 'dispose').
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
  });
  for (const d of kit.disposables) d.dispose();
  kit.disposables.length = 0;
  root.removeFromParent();
}
