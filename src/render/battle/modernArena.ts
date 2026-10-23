// The Modern battle arena: the parts (ground, platforms, scenery: Tasks 6–11) built for an arena kind from the kit's
// materials. Each part builds inside try/catch: one that throws empties the arena and the battle draws today's arena
// instead (spec §11), warned once per kind. Task 4: no parts yet — every kind still draws today's arena.

import * as THREE from 'three';
import type { KitMaterialOptions, KitUniforms } from '../kit/materials';
import { disposeKit, type KitContext } from '../kit/semantics';
import type { Quality } from '../post';
import type { ArenaKind } from './arenaKind';
import { colorsKey, type ArenaColors } from './bgSample';
import { STAGE, type Stage } from './stage';

/** A build's context (the kit's KitContext: disposeKit frees what it lists) — Task 6 adds `palette` and `ground`. */
export interface ArenaContext extends KitContext { kind: ArenaKind; colors: ArenaColors; stage: Stage }

/** One program variant a part can build: a kit material on a mesh type with an attribute set (name → item size), casting
 *  a shadow or not (the battle catalogue makes one tiny mesh of it). */
export interface CatalogueEntry {
  material: KitMaterialOptions; mesh: 'mesh' | 'instanced' | 'instancedColors';
  attrs: Record<string, number>; castShadow: boolean;
}

export interface ArenaPart {
  name: string;
  kinds: readonly ArenaKind[] | 'all';
  /** Every program variant it can build (the battle catalogue precompiles exactly these; `placeholder` makes textures). */
  catalogue(placeholder: () => THREE.Texture): readonly CatalogueEntry[];
  build(ctx: ArenaContext): THREE.Object3D | null;
}

/** The arena parts, built in this order. [] in Task 4; Tasks 6–11 append. */
export const ARENA_PARTS: ArenaPart[] = [];

/** `parts` with the part named `name` replaced by one that throws — or, with no part of that name, such a part added for
 *  every kind (the preview's &arenaFail=<name>: the fallback to today's arena, exercised before any part exists). */
export function withFailingPart(parts: readonly ArenaPart[], name: string): ArenaPart[] {
  const fail = (p: Pick<ArenaPart, 'kinds' | 'catalogue'>): ArenaPart => ({
    name, kinds: p.kinds, catalogue: p.catalogue,
    build: () => { throw new Error(`arena part '${name}' made to fail (&arenaFail)`); },
  });
  return parts.some((p) => p.name === name) ? parts.map((p) => (p.name === name ? fail(p) : p))
    : [...parts, fail({ kinds: 'all', catalogue: () => [] })];
}

const appliesTo = (p: ArenaPart, kind: ArenaKind) => p.kinds === 'all' || p.kinds.includes(kind);

export class ModernArena {
  readonly group = new THREE.Group();
  /** The last build failed (a part threw): the arena is empty and the battle draws today's arena. */
  failed = false;
  private key = '';
  private ctx: ArenaContext | null = null;
  /** Kinds whose failure was warned about (once per kind). */
  private warned = new Set<ArenaKind>();
  private buildMs = 0;

  constructor(private readonly uniforms: KitUniforms, private readonly parts: readonly ArenaPart[] = ARENA_PARTS) {
    this.group.name = 'modernArena';
  }

  /** A part named 'ground' covers the kind: the Modern arena draws it (else the view draws today's arena). */
  covers(kind: ArenaKind): boolean {
    return this.parts.some((p) => p.name === 'ground' && appliesTo(p, kind));
  }

  /** Builds the covering parts for (kind, colours, quality); a no-op when unchanged. A part that throws empties the
   *  arena, sets `failed`, warns once per kind ("[battle] arena part '<name>' failed for <kind>: the battle uses today's
   *  arena") and returns false. */
  build(kind: ArenaKind, colors: ArenaColors, quality: Quality): boolean {
    const key = `${kind}|${quality}|${colorsKey(colors)}`;
    if (key === this.key) return !this.failed;
    this.key = key;
    this.clear();
    const t0 = performance.now();
    const ctx: ArenaContext = { uniforms: this.uniforms, quality, disposables: [], kind, colors, stage: STAGE };
    this.ctx = ctx;
    this.failed = false;
    for (const part of this.parts) {
      if (!appliesTo(part, kind)) continue;
      try {
        const obj = part.build(ctx);
        if (obj) {
          obj.name = part.name;
          this.group.add(obj);
        }
      } catch (e) {
        this.clear();
        this.failed = true;
        if (!this.warned.has(kind)) {
          this.warned.add(kind);
          console.warn(`[battle] arena part '${part.name}' failed for ${kind}: the battle uses today's arena`, e);
        }
        break;
      }
    }
    this.buildMs = performance.now() - t0;
    return !this.failed;
  }

  /** The last build's ms. */
  get lastBuildMs(): number {
    return this.buildMs;
  }

  /** Frees the built parts (kit materials back to the uniforms' pool, the build's textures) and keeps the group. */
  private clear(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const child of [...this.group.children]) disposeKit(child, ctx);
    for (const d of ctx.disposables) d.dispose();
    ctx.disposables.length = 0;
    this.ctx = null;
  }

  /** Frees the build and detaches the arena; the next build starts afresh. */
  dispose(): void {
    this.clear();
    this.key = '';
    this.failed = false;
    this.group.removeFromParent();
  }
}
