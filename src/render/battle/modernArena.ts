// The Modern battle arena: the parts (ground, platforms, scenery: Tasks 6–11) built for an arena kind from the kit's
// materials, in the colours of the GBA's battle background (palette.ts, through ArenaColorLock). Each part builds inside
// try/catch: one that throws empties the arena and the battle draws today's arena instead (spec §11), warned once per
// kind. From Task 6 the ground and the platforms cover every kind.

import * as THREE from 'three';
import type { KitMaterialOptions, KitUniforms } from '../kit/materials';
import { disposeKit, type KitContext } from '../kit/semantics';
import type { Quality } from '../post';
import type { ArenaKind } from './arenaKind';
import { colorsKey, defaultArenaColors, type ArenaColors } from './bgSample';
import { STAGE, type Stage } from './stage';
import { arenaPalette, type ArenaPalette } from './palette';
import { arenaLook, type ArenaLook } from './look';
import { GROUND_PART, groundCells } from './parts/ground';
import { PLATFORM_PART } from './parts/platforms';

/** A build's context (the kit's KitContext: disposeKit frees what it lists): the kind, its colours and their palette, the
 *  ground's cells (groundCells as a texture over the grid from `min`, `size` cells; freed with the build) and the look at
 *  hour 12 (the parts read only its static fields, `clouds` and `caustics`). */
export interface ArenaContext extends KitContext {
  kind: ArenaKind; colors: ArenaColors; stage: Stage;
  palette: ArenaPalette;
  ground: { tex: THREE.DataTexture; min: THREE.Vector2; size: THREE.Vector2 };
  look: ArenaLook;
}

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

/** The arena parts, built in this order: the foundation (Task 6); Tasks 7–11 append the scenery. */
export const ARENA_PARTS: ArenaPart[] = [GROUND_PART, PLATFORM_PART];

/** The colours a battle's arena is built with: the kind's defaults until the first valid sample, then that sample for the
 *  rest of the battle (a new kind starts over). At most two builds per battle; later samples never rebuild. Each change
 *  hands out a fresh object (ModernArena.build's identity fast path: an object, once handed out, never changes). */
export class ArenaColorLock {
  private kind: ArenaKind | null = null;
  private colors: ArenaColors | null = null;
  private sampled = false;

  observe(kind: ArenaKind, sample: ArenaColors | null): ArenaColors {
    if (kind !== this.kind || !this.colors) {
      this.kind = kind;
      this.colors = defaultArenaColors(kind);
      this.sampled = false;
    }
    if (sample && !this.sampled) {
      this.colors = { backdrop: [...sample.backdrop], stripe: [...sample.stripe], top: [...sample.top], platform: [...sample.platform],
        platformDetail: [...sample.platformDetail], rim: [...sample.rim] };
      this.sampled = true;
    }
    return this.colors;
  }

  /** Whether `kind`'s colours are a sample (locked: later samples change nothing, so they need not be taken). */
  locked(kind: ArenaKind): boolean {
    return this.sampled && kind === this.kind;
  }
}

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
  /** The last build call's arguments (its colours by identity). */
  private lastKind: ArenaKind | null = null;
  private lastColors: ArenaColors | null = null;
  private lastQuality: Quality | null = null;
  private ctx: ArenaContext | null = null;
  /** Kinds whose failure was warned about (once per kind). */
  private warned = new Set<ArenaKind>();
  private buildMs = 0;
  /** The last successful build's palette (the view's look reads it). */
  private builtPalette: ArenaPalette | null = null;

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
    // (the very colours object of the last call again: unchanged, without building its key — a caller hands a new
    // object for new colours, never mutates one; any other object is compared by value)
    if (kind === this.lastKind && colors === this.lastColors && quality === this.lastQuality) return !this.failed;
    this.lastKind = kind;
    this.lastColors = colors;
    this.lastQuality = quality;
    const key = `${kind}|${quality}|${colorsKey(colors)}`;
    if (key === this.key) return !this.failed;
    this.key = key;
    this.clear();
    const t0 = performance.now();
    this.failed = false;
    this.builtPalette = null;
    let at = 'foundation';
    try {
      // the palette, the ground's cells and the look, before the parts (they all read them)
      const palette = arenaPalette(kind, colors);
      const cells = groundCells(kind, palette, STAGE);
      const tex = new THREE.DataTexture(cells.data, cells.w, cells.h, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.flipY = false;
      tex.needsUpdate = true;
      const ctx: ArenaContext = { uniforms: this.uniforms, quality, disposables: [tex], kind, colors, stage: STAGE, palette,
        ground: { tex, min: new THREE.Vector2(cells.min[0], cells.min[1]), size: new THREE.Vector2(cells.w, cells.h) },
        look: arenaLook(kind, palette, 12) };
      this.ctx = ctx;
      for (const part of this.parts) {
        if (!appliesTo(part, kind)) continue;
        at = part.name;
        const obj = part.build(ctx);
        if (obj) {
          obj.name = part.name;
          this.group.add(obj);
        }
      }
      this.builtPalette = palette;
    } catch (e) {
      this.clear();
      this.failed = true;
      if (!this.warned.has(kind)) {
        this.warned.add(kind);
        console.warn(`[battle] arena part '${at}' failed for ${kind}: the battle uses today's arena`, e);
      }
    }
    this.buildMs = performance.now() - t0;
    return !this.failed;
  }

  /** The palette of the last build (null: none, or it failed): the battle view's look takes its fog and hemisphere
   *  colours from it. */
  get palette(): ArenaPalette | null {
    return this.builtPalette;
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
    this.builtPalette = null;
    this.key = '';
    this.lastKind = this.lastColors = this.lastQuality = null;
    this.failed = false;
    this.group.removeFromParent();
  }
}
