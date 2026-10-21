// Overworld actors: decides per world sprite (gSprites) how the 3D view draws it and owns what draws
// them: camera-facing cards (billboards) with their blob shadows, the inflated actors with their
// contact shadows, and the object models. Retro draws every sprite as a card; Modern inflates characters
// (given the inflation field) and draws mapped objects (item balls, boulders, rocks, Cut trees, the truck)
// as procedural models coloured from their own sprite's pixels. Every list is rebuilt from the frame's
// sprites, so nothing outlives a sprite (despawns, warps, map crossings).

import * as THREE from 'three';
import type { GameState, ObjectEventSnap, SpriteSnap } from '../../game/state';
import { SpriteKind, type SpriteClassifier } from '../../game/spriteKinds';
import type { WorldStyle } from '../overworld/world';
import { Billboards, BlobShadows, type BillboardSpec } from '../overworld/billboards';
import type { KitUniforms } from '../kit/materials';
import { hashCell } from '../kit/geom';
import { InflatedActors, CONTACT } from './inflatedActors';
import { SLOT, SLOT_COLS, SLOT_ROWS } from '../spriteAtlas';
import { inflateMax } from './inflateMath';
import { modelImageHeight, objectModelFor, type ObjectModelKind, type ObjectModelRef } from './objectMap';
import { SpriteColorCache, type SpritePixelSource, type SpriteSample } from './spriteColors';
import { ObjectModels, precompileScene, type ModelInstance } from './objectModels';

export type ActorRoute = 'card' | 'inflated' | 'model' | 'skip';
/** Sprite edges of the Modern actors: HD smooth (xBR) or Pixel (the nearest texels). Retro ignores it. */
export type SpriteFilter = 'smooth' | 'pixel';

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

/** The sprite atlas: slot rectangles and its render target (size in texels; default the SpriteAtlas's). */
export interface ActorAtlas { slots: ReadonlyMap<number, SlotUv>; target: { texture: THREE.Texture; width?: number; height?: number } }

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

/** Inputs of the inflated actors (field) and object models (kit) (not used by the cards). */
export interface ActorLayerOptions { field?: { texture: THREE.Texture }; kit?: KitUniforms }

type Foot = { x: number; y: number; z: number };

const NO_SAMPLE: SpriteSample = { colors: { main: null, accent: null, green: null }, tones: { body: null, highlight: null, crevice: null, dark: null } };

/** What an object slot showed the last time the layer saw it, and since which synced frame (GameState.frame). */
interface Seen { graphicsId: number; localId: number; map: number; images: number; animNum: number; since: number; frame: number }

/** A model's turn about the vertical: stable per object (its map and local id), whatever cell it is pushed to. */
const yawOf = (o: ObjectEventSnap) => (hashCell(o.localId, o.mapNum, o.mapGroup) / 4294967296) * Math.PI * 2;
/** Whether a model is drawn as its mirror image (the kinds that vary so): stable per object, as its yaw. */
const flipOf = (o: ObjectEventSnap) => (hashCell(o.localId, o.mapNum, o.mapGroup + 0x9e37) & 1) === 1;

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
export function uprightFoot<T extends Foot = Foot>(s: SpriteSnap, heightAt: (x: number, y: number) => number,
  out: T = { x: 0, y: 0, z: 0 } as T): T {
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
  /** Billboards + blob shadows, inflated actors + contact shadows, object models. */
  readonly group = new THREE.Group();
  private billboards: Billboards;
  private blobs: BlobShadows;
  /** Modern's characters (null without an inflation field: they stay cards). */
  private inflated: InflatedActors | null = null;
  /** Modern's Phase 2 actors: inflated characters and object models (false: every sprite is a card, as in
   *  Retro — the pre-Task-5 path, the harness's `--ab` baseline). */
  inflation = true;
  private contact: BlobShadows | null = null;
  /** Modern's object models (null without kit uniforms: mapped objects stay sprites). */
  private models: ObjectModels | null = null;
  /** Where the models' colours are sampled (null: their default tints). */
  private pixels: SpritePixelSource | null = null;
  private colorCache = new SpriteColorCache();
  /** This frame's objects by sprite index (spriteId). */
  private bySprite = new Map<number, ObjectEventSnap>();
  /** Per object slot (ObjectEventSnap.index): what it showed and since when (spawn frames, see sampleOf). */
  private seen = new Map<number, Seen>();
  /** The truck's sprite at its 48×48 image size (colour sampling; reused). */
  private truckImage: SpriteSnap | null = null;
  // Reused every frame: the pools only grow; `cards` / `actors` / `models` / `feet` are this frame's lists.
  private specPool: BillboardSpec[] = [];
  private cards: BillboardSpec[] = [];
  private actors: BillboardSpec[] = [];
  private modelPool: ModelInstance[] = [];
  private modelList: ModelInstance[] = [];
  private footPool: Foot[] = [];
  private feet: Foot[] = [];

  constructor(private readonly atlas: ActorAtlas, opts: ActorLayerOptions = {}) {
    this.billboards = new Billboards(atlas);
    this.blobs = new BlobShadows(this.billboards);
    this.group.add(this.billboards.mesh, this.blobs.mesh);
    if (opts.field) {
      // the rim takes the sky's colour (the kit's, updated by the view's lighting)
      const rim = opts.kit?.uSky ?? { value: new THREE.Color(0.75, 0.88, 1.0) };
      const size = new THREE.Vector2(atlas.target.width ?? SLOT * SLOT_COLS, atlas.target.height ?? SLOT * SLOT_ROWS);
      this.inflated = new InflatedActors(atlas.target.texture, opts.field.texture, rim, size);
      this.contact = new BlobShadows(this.inflated);
      this.contact.setStrength(CONTACT.strength);
      this.contact.setScale(CONTACT.scale);
      this.contact.mesh.name = 'contactShadows';
      this.group.add(this.inflated.mesh, this.contact.mesh);
    }
    if (opts.kit) {
      this.models = new ObjectModels(opts.kit);
      this.models.group.visible = false;
      this.group.add(this.models.group);
    }
  }

  /** Where the object models sample their sprites' colours: OBJ VRAM and the palette the sprite atlas draws
   *  with (null: the models' default tints). */
  setPixelSource(src: SpritePixelSource | null): void {
    this.pixels = src;
  }

  /**
   * Compiles the Phase 2 actor programs before they are first drawn (also in a Retro session, where they are
   * hidden): the object models' and the inflated actors' (with their contact shadows), main and shadow-depth
   * ones — a frame of `scene` compiles the latter (ObjectModels.precompile; `frame`: the owner's PostFX frame,
   * which also compiles GTAO's override materials at High quality). Resolves when they are ready.
   */
  precompile(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, frame?: () => void): Promise<void> {
    const shown = [this.inflated?.mesh, this.contact?.mesh].filter((m): m is THREE.Mesh => m !== undefined);
    const was = shown.map((m) => m.visible);
    for (const m of shown) m.visible = true;
    try {
      return this.models
        ? this.models.precompile(renderer, scene, camera, this.group, frame)
        : precompileScene(renderer, this.group, scene, camera, frame).then(() => undefined);
    } finally {
      shown.forEach((m, i) => { m.visible = was[i]; });
    }
  }

  /** Sprite edges of the inflated actors (Modern): HD smooth (xBR, the default) or Pixel. Cards are unaffected. */
  setSpriteFilter(f: SpriteFilter): void {
    this.inflated?.setSmoothing(f === 'smooth');
  }

  /** Draws every actor (cards, inflated actors, models) flat magenta: the harness's visible-actor mask. */
  setMask(on: boolean): void {
    this.billboards.setMask(on);
    this.inflated?.setMask(on);
    this.models?.setMask(on);
  }

  /** Instances drawn by each renderer the layer owns (last update). */
  counts(): { cards: number; inflated: number; models: number } {
    return { cards: this.billboards.count, inflated: this.inflated?.count ?? 0, models: this.models?.count ?? 0 };
  }

  /** Rebuilds every list from scratch; returns the grass-bending feet, reusing one array: every non-flat sprite
   *  drawn — uprights (cards, inflated actors, models) and grass overlays, in sprite order. */
  update(state: GameState, f: ActorFrame): readonly { x: number; y: number; z: number }[] {
    const sprites = state.sprites;
    const phase2 = f.style === 'modern' && this.inflation;
    const inflate = this.inflated !== null && phase2;
    const models = phase2 ? this.models : null;
    const frame = state.frame ?? 0;
    if (models) {
      this.bySprite.clear();
      for (const o of state.objects ?? []) this.bySprite.set(o.spriteId, o);
    }
    let n = 0, c = 0, a = 0, m = 0, k = 0;
    for (let i = 0; i < sprites.length; i++) {
      const s = sprites[i];
      if (!s.coordOffset || s.invisible) continue;
      const kind = f.classifier ? f.classifier.kind(s) : SpriteKind.Upright;
      const o = models && kind === SpriteKind.Upright ? this.bySprite.get(s.index) : undefined;
      const ref = o ? this.modelOf(o, s, models!) : null;
      const route = routeSprite(kind, f.style, ref !== null);
      if (route === 'skip') continue;
      if (route === 'model') {
        // drawn by its model (not its sprite), which bends the grass where it stands
        const inst = this.placeModel(this.modelPool[k] ??= blankInstance(), s, o!, ref!, f.heightAt, frame);
        this.modelList[k++] = inst;
        const foot = this.footPool[m] ??= { x: 0, y: 0, z: 0 };
        foot.x = inst.x; foot.y = inst.y; foot.z = inst.z;
        this.feet[m++] = foot;
        continue;
      }
      const cx = cellX(s) + 0.5, cy = cellY(s) + 0.5;
      if (hidesGrassOverlay(kind, f.style, f.hasGrassBlades(cx, cy))) continue;
      const slot = this.atlas.slots.get(s.index);
      if (!slot) continue;
      const spec = placeCard(this.specPool[n++] ??= blankSpec(), s, kind, slot, f.heightAt(cx, cy), GRASS_OFFSET);
      if (route === 'inflated' && inflate) this.actors[a++] = spec;
      else this.cards[c++] = spec;
      if (spec.flat) continue;
      // (the grass bends around where the sprite stands, before an overlay moves nearer the eye)
      const foot = this.footPool[m] ??= { x: 0, y: 0, z: 0 };
      foot.x = spec.footX; foot.y = spec.footY; foot.z = spec.footZ;
      this.feet[m++] = foot;
      // in front of the inflated legs it covers
      if (inflate && kind === SpriteKind.Grass) towardEye(spec, f.cameraPosition, f.cameraRight, INFLATED_GRASS_EXTRA);
    }
    this.cards.length = c;
    this.actors.length = a;
    this.modelList.length = k;
    this.feet.length = m;
    this.billboards.set(this.cards, f.cameraRight, f.charLight);
    if (this.inflated && this.contact) {
      // Retro: no inflated mesh, no contact shadows (empty and hidden)
      this.inflated.set(this.actors, f.cameraRight, f.cameraPosition);
      this.inflated.setLightFloor(f.charLight);
      this.inflated.mesh.visible = this.contact.mesh.visible = inflate;
    }
    if (this.models) {
      // Retro (or Phase 2 off): no models (empty and hidden)
      this.models.set(this.modelList);
      this.models.group.visible = models !== null;
      this.models.setLightFloor(f.charLight);
      // objects gone since the last synced frame are new again when they reappear (all of them after a Retro or
      // Phase-2-off period: no identity is kept across it)
      if (models) {
        for (const [slot, t] of this.seen) if (t.frame < frame) this.seen.delete(slot);
      } else this.seen.clear();
    }
    return this.feet;
  }

  /** The model drawing object `o` (its sprite `s`), or null: drawn as its sprite (an invisible object, a VAR or
   *  unmapped graphics id, a Cut tree / rock breaking, a kind without meshes yet). */
  private modelOf(o: ObjectEventSnap, s: SpriteSnap, models: ObjectModels): ObjectModelRef | null {
    if (o.invisible) return null;
    const ref = objectModelFor(o.graphicsId, s.animNum);
    return ref && models.supports(ref.kind) ? ref : null;
  }

  /**
   * A model where the object's card stood: x = worldX / 16; z from the bottom of the image the model stands for
   * (the sprite's centre, worldY − height − c2cY, plus half the image's height, in px: for the truck's 48×48
   * subsprite image, not its 32×32 base OAM's), half a cell up, on the ground of that cell (un-projected).
   */
  private placeModel(out: ModelInstance, s: SpriteSnap, o: ObjectEventSnap, ref: ObjectModelRef,
    heightAt: (x: number, y: number) => number, frame: number): ModelInstance {
    const row = (s.worldY - s.height - s.c2cY + modelImageHeight(ref.kind, s.height) / 2) / 16 - 0.5;
    const h = heightAt(cellX(s) + 0.5, Math.floor(row) + 0.5);
    out.kind = ref.kind;
    out.stage = ref.stage;
    out.x = s.worldX / 16;
    out.y = h;
    out.z = row + h;
    out.yaw = yawOf(o);
    out.flip = flipOf(o);
    out.mirror = s.hflip;
    const sample = this.sampleOf(s, ref.kind, o, frame);
    out.colors = sample.colors;
    out.tones = sample.tones;
    return out;
  }

  /**
   * The colours and tones of a model's sprite (SpriteColorCache; the truck at its 48×48 image size: the cache key ignores
   * the size, so every lookup of it decodes the same image). Never stored on the first synced frame of an object,
   * or of a new image set / anim on it: the VBlank tile copy can lag a frame, so OBJ VRAM may still hold another
   * object's pixels then (they are used for that frame only).
   */
  private sampleOf(s: SpriteSnap, kind: ObjectModelKind, o: ObjectEventSnap, frame: number): SpriteSample {
    if (!this.pixels) return NO_SAMPLE;
    const map = (o.mapGroup << 8) | o.mapNum;
    let t = this.seen.get(o.index);
    if (!t || t.graphicsId !== o.graphicsId || t.localId !== o.localId || t.map !== map || t.images !== s.images || t.animNum !== s.animNum) {
      t = { graphicsId: o.graphicsId, localId: o.localId, map, images: s.images, animNum: s.animNum, since: frame, frame };
      this.seen.set(o.index, t);
    }
    t.frame = frame;
    let snap = s;
    if (kind === 'truck') {
      snap = this.truckImage = Object.assign(this.truckImage ?? { ...s }, s);
      snap.width = 48;
      snap.height = modelImageHeight('truck', s.height);
    }
    return this.colorCache.sample(snap, this.pixels, { store: frame > t.since });
  }
}

const blankInstance = (): ModelInstance => ({ kind: 'pokeball', stage: 0, x: 0, y: 0, z: 0, colors: NO_SAMPLE.colors });
