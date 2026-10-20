// Overworld actors: decides per world sprite (gSprites) how the 3D view draws it and owns what draws
// them: camera-facing cards (billboards) and their blob shadows. Retro draws every sprite as a card;
// Modern routes characters to inflated actors and mapped objects to models, which are drawn as cards
// until those renderers exist. Every list is rebuilt from the frame's sprites, so nothing outlives a
// sprite (despawns, warps, map crossings).

import * as THREE from 'three';
import type { GameState, SpriteSnap } from '../../game/state';
import { SpriteKind, type SpriteClassifier } from '../../game/spriteKinds';
import type { WorldStyle } from '../overworld/world';
import { Billboards, BlobShadows, type BillboardSpec } from '../overworld/billboards';
import type { KitUniforms } from '../kit/materials';

export type ActorRoute = 'card' | 'inflated' | 'model' | 'skip';

/** Retro: every visible sprite is a card. Modern: decals/grass are cards, uprights inflate, mapped objects are models. */
export function routeSprite(kind: SpriteKind, style: WorldStyle, mapped: boolean): ActorRoute {
  if (kind === SpriteKind.Hidden) return 'skip';
  if (style === 'retro' || kind !== SpriteKind.Upright) return 'card';
  return mapped ? 'model' : 'inflated';
}

/**
 * Whether the GBA's grass overlay sprite (drawn over the legs of a character in grass) is left out:
 * in Modern where 3D grass blades stand on its cell (kit/grass.ts: they hide the legs and part around
 * them). Elsewhere (short grass, tall grass the grass family did not draw, Retro) it is drawn.
 */
export function hidesGrassOverlay(kind: SpriteKind, style: WorldStyle, bladesOnCell: boolean): boolean {
  return kind === SpriteKind.Grass && style === 'modern' && bladesOnCell;
}

/** How far a grass overlay is drawn in front of the legs it covers (world units). */
const GRASS_OFFSET = 0.06;

export interface SlotUv { u0: number; v0: number; u1: number; v1: number }

export interface ActorAtlas { slots: ReadonlyMap<number, SlotUv>; target: { texture: THREE.Texture } }

/** What the layer reads from the view each frame. */
export interface ActorFrame {
  style: WorldStyle;
  classifier: SpriteClassifier | null;
  /** Ground height (world Y) at grid point (x, y). */
  heightAt(x: number, y: number): number;
  /** Whether the kit's 3D grass blades stand at grid point (x, y). */
  hasGrassBlades(x: number, y: number): boolean;
  cameraRight: THREE.Vector3;
  /** Light the cards are drawn with (ambient + part of the sun). */
  charLight: THREE.Color;
}

/** Inputs of the inflated actors and object models (not used by the cards). */
export interface ActorLayerOptions { field?: { texture: THREE.Texture }; kit?: KitUniforms }

type Foot = { x: number; y: number; z: number };

// The grid cell a sprite stands on: the one holding the point half a cell above its bottom edge (an
// upright's foot point; for a flat decal, its rectangle's bottom half-cell).
const cellX = (s: SpriteSnap) => Math.floor(s.worldX / 16);
const cellY = (s: SpriteSnap) => Math.floor(s.worldY / 16 - 0.5);

/** Writes a sprite's card placement into `out`; `h` is the ground height of its cell. */
function placeCard(out: BillboardSpec, s: SpriteSnap, kind: SpriteKind, slot: SlotUv, h: number, grassOffset: number): BillboardSpec {
  const flat = kind === SpriteKind.Flat;
  // Upright cards stand on the cell centre; flat decals cover their GBA rectangle.
  let fy = flat ? s.worldY / 16 : s.worldY / 16 - 0.5;
  if (kind === SpriteKind.Grass) fy += grassOffset; // in front of the legs it covers
  out.footX = s.worldX / 16;
  out.footY = h;
  out.footZ = fy + h;
  out.width = (s.width * s.scaleX) / 16;
  out.height = (s.height * s.scaleY) / 16;
  out.lift = flat ? 0 : Math.max(0, -s.y2 / 16);
  out.flat = flat;
  out.slot = slot;
  return out;
}

const blankSpec = (): BillboardSpec =>
  ({ footX: 0, footY: 0, footZ: 0, width: 0, height: 0, lift: 0, flat: false, slot: { u0: 0, v0: 0, u1: 0, v1: 0 } });

/** Today's card placement (BillboardSpec) of a sprite: uprights on the cell centre, flats on their rectangle,
 *  grass overlays `grassOffset` in front of the legs. `heightAt(x, y)` takes grid coordinates (cell centre). */
export function cardSpec(s: SpriteSnap, kind: SpriteKind, slot: SlotUv, heightAt: (x: number, y: number) => number,
  grassOffset = GRASS_OFFSET): BillboardSpec {
  return placeCard(blankSpec(), s, kind, slot, heightAt(cellX(s) + 0.5, cellY(s) + 0.5), grassOffset);
}

export class ActorLayer {
  /** Billboards + blob shadows (+ inflated actors, models later). */
  readonly group = new THREE.Group();
  private billboards: Billboards;
  private blobs: BlobShadows;
  // Reused every frame: the pools only grow; `specs` / `feet` are this frame's lists.
  private specPool: BillboardSpec[] = [];
  private specs: BillboardSpec[] = [];
  private footPool: Foot[] = [];
  private feet: Foot[] = [];

  constructor(private atlas: ActorAtlas, private readonly opts: ActorLayerOptions = {}) {
    this.billboards = new Billboards(atlas);
    this.blobs = new BlobShadows(this.billboards);
    this.group.add(this.billboards.mesh, this.blobs.mesh);
  }

  /** Rebuilds every list from scratch; returns the grass-bending feet, reusing one array: every non-flat sprite
   *  drawn — uprights (cards, inflated actors, models) and grass overlays, as today's `specs.filter(b => !b.flat)`. */
  update(state: GameState, f: ActorFrame): readonly { x: number; y: number; z: number }[] {
    const sprites = state.sprites;
    let n = 0, m = 0;
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      if (!s.coordOffset || s.invisible) continue;
      const kind = f.classifier ? f.classifier.kind(s) : SpriteKind.Upright;
      // No object is mapped to a model yet; 'inflated' and 'model' are drawn as cards for now.
      if (routeSprite(kind, f.style, false) === 'skip') continue;
      const cx = cellX(s) + 0.5, cy = cellY(s) + 0.5;
      if (hidesGrassOverlay(kind, f.style, f.hasGrassBlades(cx, cy))) continue;
      const slot = this.atlas.slots.get(s.index);
      if (!slot) continue;
      const spec = placeCard(this.specPool[n] ??= blankSpec(), s, kind, slot, f.heightAt(cx, cy), GRASS_OFFSET);
      this.specs[n++] = spec;
      if (spec.flat) continue;
      const foot = this.footPool[m] ??= { x: 0, y: 0, z: 0 };
      foot.x = spec.footX; foot.y = spec.footY; foot.z = spec.footZ;
      this.feet[m++] = foot;
    }
    this.specs.length = n;
    this.feet.length = m;
    this.billboards.set(this.specs, f.cameraRight, f.charLight);
    return this.feet;
  }
}
