// Overworld actors: decides per world sprite (gSprites) how the 3D view draws it and owns what draws
// them: camera-facing cards (billboards) with their blob shadows, and the inflated actors with their
// contact shadows. Retro draws every sprite as a card; Modern inflates characters (given the
// inflation field) and routes mapped objects to models, drawn as cards until that renderer exists.
// Every list is rebuilt from the frame's sprites, so nothing outlives a sprite (despawns, warps,
// map crossings).

import * as THREE from 'three';
import type { GameState, SpriteSnap } from '../../game/state';
import { SpriteKind, type SpriteClassifier } from '../../game/spriteKinds';
import type { WorldStyle } from '../overworld/world';
import { Billboards, BlobShadows, type BillboardSpec } from '../overworld/billboards';
import type { KitUniforms } from '../kit/materials';
import { InflatedActors, CONTACT } from './inflatedActors';
import { inflateMax } from './inflateMath';

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
/** Beside inflated actors, a grass overlay also moves this much nearer the eye, along its view ray (on screen
 *  it stays where the card was): the relief rises at most inflateMax() sprite px (1/16 world) that way. */
const INFLATED_GRASS_EXTRA = inflateMax() / 16;
const _eyeRay = new THREE.Vector3();

/** Moves a card's foot `k` world units towards `eye` (default: far away horizontally, ahead of `right`). */
function towardEye(spec: BillboardSpec, eye: THREE.Vector3 | undefined, right: THREE.Vector3, k: number): void {
  if (eye) _eyeRay.set(eye.x - spec.footX, eye.y - spec.footY, eye.z - spec.footZ).normalize();
  else _eyeRay.set(-right.z, 0, right.x);
  spec.footX += _eyeRay.x * k;
  spec.footY += _eyeRay.y * k;
  spec.footZ += _eyeRay.z * k;
}

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
  /** The camera's position (world): inflated actors rise towards it (default: far away horizontally). */
  cameraPosition?: THREE.Vector3;
  /** Light the cards are drawn with (ambient + part of the sun). */
  charLight: THREE.Color;
}

/** Inputs of the inflated actors and object models (not used by the cards). */
export interface ActorLayerOptions { field?: { texture: THREE.Texture }; kit?: KitUniforms }

type Foot = { x: number; y: number; z: number };

// An upright's foot point in grid units: half a cell above the sprite's bottom edge. The grid cell a
// sprite stands on holds that point (for a flat decal: its rectangle's bottom half-cell).
const footRow = (s: SpriteSnap) => s.worldY / 16 - 0.5;
const cellX = (s: SpriteSnap) => Math.floor(s.worldX / 16);
const cellY = (s: SpriteSnap) => Math.floor(footRow(s));
const groundOf = (s: SpriteSnap, heightAt: (x: number, y: number) => number) => heightAt(cellX(s) + 0.5, cellY(s) + 0.5);

/**
 * Where an upright sprite stands in the world (its card's / inflated actor's foot point, the camera's
 * target for the player): x = worldX / 16, on the ground of its cell, z = foot row + height (un-projection).
 * `heightAt(x, y)` takes grid coordinates (the cell centre).
 */
export function uprightFoot(s: SpriteSnap, heightAt: (x: number, y: number) => number, out: Foot = { x: 0, y: 0, z: 0 }): Foot {
  const h = groundOf(s, heightAt);
  out.x = s.worldX / 16;
  out.y = h;
  out.z = footRow(s) + h;
  return out;
}

/** Writes a sprite's card placement into `out`; `h` is the ground height of its cell. */
function placeCard(out: BillboardSpec, s: SpriteSnap, kind: SpriteKind, slot: SlotUv, h: number, grassOffset: number): BillboardSpec {
  const flat = kind === SpriteKind.Flat;
  // Upright cards stand on the cell centre (uprightFoot); flat decals cover their GBA rectangle.
  let fy = flat ? s.worldY / 16 : footRow(s);
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
  return placeCard(blankSpec(), s, kind, slot, groundOf(s, heightAt), grassOffset);
}

export class ActorLayer {
  /** Billboards + blob shadows, inflated actors + contact shadows (models later). */
  readonly group = new THREE.Group();
  private billboards: Billboards;
  private blobs: BlobShadows;
  /** Modern's characters (null without an inflation field: they stay cards). */
  private inflated: InflatedActors | null = null;
  private contact: BlobShadows | null = null;
  // Reused every frame: the pools only grow; `cards` / `actors` / `feet` are this frame's lists.
  private specPool: BillboardSpec[] = [];
  private cards: BillboardSpec[] = [];
  private actors: BillboardSpec[] = [];
  private footPool: Foot[] = [];
  private feet: Foot[] = [];

  constructor(private readonly atlas: ActorAtlas, opts: ActorLayerOptions = {}) {
    this.billboards = new Billboards(atlas);
    this.blobs = new BlobShadows(this.billboards);
    this.group.add(this.billboards.mesh, this.blobs.mesh);
    if (opts.field) {
      // the rim takes the sky's colour (the kit's, updated by the view's lighting)
      const rim = opts.kit?.uSky ?? { value: new THREE.Color(0.75, 0.88, 1.0) };
      this.inflated = new InflatedActors(atlas.target.texture, opts.field.texture, rim);
      this.contact = new BlobShadows(this.inflated);
      this.contact.setStrength(CONTACT.strength);
      this.contact.setScale(CONTACT.scale);
      this.contact.mesh.name = 'contactShadows';
      this.group.add(this.inflated.mesh, this.contact.mesh);
    }
  }

  /** Instances drawn by each renderer the layer owns (last update). */
  counts(): { cards: number; inflated: number; models: number } {
    return { cards: this.billboards.count, inflated: this.inflated?.count ?? 0, models: 0 };
  }

  /** Rebuilds every list from scratch; returns the grass-bending feet, reusing one array: every non-flat sprite
   *  drawn — uprights (cards, inflated actors, models) and grass overlays, in sprite order. */
  update(state: GameState, f: ActorFrame): readonly { x: number; y: number; z: number }[] {
    const sprites = state.sprites;
    const inflate = this.inflated !== null && f.style === 'modern';
    let n = 0, c = 0, a = 0, m = 0;
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      if (!s.coordOffset || s.invisible) continue;
      const kind = f.classifier ? f.classifier.kind(s) : SpriteKind.Upright;
      // No object is mapped to a model yet ('model' is drawn as a card for now).
      const route = routeSprite(kind, f.style, false);
      if (route === 'skip') continue;
      const cx = cellX(s) + 0.5, cy = cellY(s) + 0.5;
      if (hidesGrassOverlay(kind, f.style, f.hasGrassBlades(cx, cy))) continue;
      const slot = this.atlas.slots.get(s.index);
      if (!slot) continue;
      const spec = placeCard(this.specPool[n++] ??= blankSpec(), s, kind, slot, f.heightAt(cx, cy), GRASS_OFFSET);
      // (in front of the inflated legs it covers)
      if (inflate && kind === SpriteKind.Grass) towardEye(spec, f.cameraPosition, f.cameraRight, INFLATED_GRASS_EXTRA);
      if (route === 'inflated' && inflate) this.actors[a++] = spec;
      else this.cards[c++] = spec;
      if (spec.flat) continue;
      const foot = this.footPool[m] ??= { x: 0, y: 0, z: 0 };
      foot.x = spec.footX; foot.y = spec.footY; foot.z = spec.footZ;
      this.feet[m++] = foot;
    }
    this.cards.length = c;
    this.actors.length = a;
    this.feet.length = m;
    this.billboards.set(this.cards, f.cameraRight, f.charLight);
    if (this.inflated && this.contact) {
      // Retro: no inflated mesh, no contact shadows (empty and hidden)
      this.inflated.set(this.actors, f.cameraRight, f.cameraPosition);
      this.inflated.setLightFloor(f.charLight);
      this.inflated.mesh.visible = this.contact.mesh.visible = inflate;
    }
    return this.feet;
  }
}
