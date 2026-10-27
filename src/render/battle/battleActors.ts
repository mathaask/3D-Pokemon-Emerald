// The battle's sprites in 3D: each frame's sprites routed (HUD / card / inflated / decal / skip) and placed by the
// battle stage's reference projection. Retro (and Modern with inflation off: the --ab-feature battlers baseline) draws
// today's upright cards for every visible non-HUD sprite. Modern inflates the battlers and trainer pictures (Phase 2's
// InflatedActors, the battle variant, on the battle's own inflation field), lays the floating enemy's shadow sprite flat
// on its platform and skips OBJ-window masks; move effects stay cards in both styles.

import * as THREE from 'three';
import type { SpriteSnap } from '../../game/state';
import { SYM } from '../../game/symbols';
import { Billboards, type BillboardSpec } from '../overworld/billboards';
import type { WorldStyle } from '../overworld/world';
import { skipOverridePasses, type ActorAtlas, type SlotUv, type SpriteFilter } from '../actors/actorLayer';
import { InflatedActors, BATTLE_VARIANT, instanceUniformsFailed, type ProgramInfo } from '../actors/inflatedActors';
import { SLOT, SLOT_COLS, SLOT_ROWS } from '../spriteAtlas';
import { PLATFORM_FOOTPRINT, PX, REF_PITCH, STAGE, type Stage } from './stage';

export type BattleRoute = 'skip' | 'hud' | 'card' | 'inflated' | 'decal';

// Templates of HUD sprites (healthboxes, HP bars, party status balls) — drawn in screen space.
const HUD_TEMPLATE_RANGES: [number, number][] = [
  [0x0832c140, 0x0832c220], // healthbox player/opponent/safari + healthbars
  [0x0832c364, 0x0832c3c4], // status summary bar + balls
];

/** A HUD sprite (healthbox, HP bar, party status balls): the screen-space HUD draws it. */
function isBattleHudSprite(s: SpriteSnap): boolean {
  for (const [a, b] of HUD_TEMPLATE_RANGES) if (s.template >= a && s.template < b) return true;
  return false;
}

/** Today's isActor: a battler or trainer picture (gMultiuseSpriteTemplate, gBattlerSpriteTemplates[4]). */
export function isBattler(s: SpriteSnap): boolean {
  return s.template === SYM.gMultiuseSpriteTemplate || (s.template >= SYM.gBattlerSpriteTemplates && s.template < SYM.gBattlerSpriteTemplates + 0x60);
}

/** The shadow sprite under a floating enemy (gSpriteTemplate_EnemyShadow). */
function isEnemyShadow(s: SpriteSnap): boolean {
  return s.template === SYM.gSpriteTemplate_EnemyShadow;
}

/** OAM objMode 2: an OBJ-window sprite — a window mask the GBA never displays (e.g. a battler clone made by
 *  battle_anim_mons.c); drawn, it would be a duplicate battler. */
const OBJ_MODE_WINDOW = 2;

/**
 * Invisible → skip; HUD template → hud (both styles). Retro, or Modern with inflation off (`inflation` false: also when
 * there is no inflation field) → card, as today (OBJ-window clones and the enemy shadow included). Modern with
 * inflation: an OBJ-window sprite → skip, a battler or trainer picture → inflated — or skip while the overlay shows its
 * flat copy (`copied`: GameState.battlerCopies, a move's monbg: no duplicate battler) —, the enemy shadow → decal (flat
 * on its platform), anything else (move effects) → card.
 */
export function battleRoute(s: SpriteSnap, style: WorldStyle, inflation: boolean, copied = false): BattleRoute {
  if (s.invisible) return 'skip';
  if (isBattleHudSprite(s)) return 'hud';
  if (style === 'retro' || !inflation) return 'card';
  if (s.objMode === OBJ_MODE_WINDOW) return 'skip';
  if (isBattler(s)) return copied ? 'skip' : 'inflated';
  if (isEnemyShadow(s)) return 'decal';
  return 'card';
}

/** BeginNormalPaletteFade's mode (gPaletteFade.mode NORMAL_FADE): `fadePalettes` names the palettes it blends. */
const NORMAL_FADE = 0;
/** gPaletteFade.selectedPalettes' BG palettes (bits 0–15; 16–31 are the OBJ palettes). */
const BG_PALETTES = 0xffff;

/**
 * How strongly the renderer's fade quad dims a battle frame (0..1) for the game's palette fade (GameState's fade
 * fields). Retro: fadeY / 16, as today (the whole 3D frame follows any fade). Modern: a normal fade that blends OBJ
 * palettes only — the intro darkening the wild Pokémon's palette while it slides in (battle_main.c SpriteCB_WildMon) —
 * dims nothing: the battlers sample the hardware palette, which the fade already blended, and the arena (the GBA's
 * background, BG palettes) is untouched, as on the GBA. Any other fade (every palette at a battle's start and end, BG
 * palettes, a fast or hardware fade) dims the whole frame, as today.
 */
export function battleFadeOverlay(fade: { fadeY: number; fadeMode: number; fadePalettes: number }, style: WorldStyle): number {
  if (style === 'modern' && fade.fadeMode === NORMAL_FADE && (fade.fadePalettes & BG_PALETTES) === 0) return 0;
  return fade.fadeY / 16;
}

/** OBJ tiles start at VRAM 0x10000; 32 bytes per 4bpp tile (an 8bpp tile takes two). */
const OBJ_VRAM = 0x10000, TILE_BYTES = 32, VRAM_SIZE = 0x18000;
const fnv = (h: number, v: number) => Math.imul(h ^ v, 16777619) >>> 0;

/**
 * A hash of everything a battler's atlas slot is baked from but its palette — size, tile number, 4/8 bpp, flips, 1D/2D
 * tile mapping (`map2d`), its subsprite pieces, and every byte of every OBJ tile the bake reads (spriteAtlas.ts's
 * addressing): its full colour indices, not only which are transparent. The inflation field reads only alpha (colour index
 * 0), but the battlers' baked xBR decisions (XbrBake) compare colours, and BattleView.updateField re-bakes them only with
 * the field (or on a palette change: battlerPaletteKey) — a frame that keeps a battler's silhouette but changes its
 * colour indices (a blink, a new expression) must change this key. The field and the decisions are recomputed only when
 * a battler's key or slot changes: a battler animates by new tiles (or another tile number), not by its position. No
 * allocation (called per battler per frame).
 */
export function battlerAlphaKey(s: SpriteSnap, vram: Uint8Array, map2d: boolean): number {
  let h = 2166136261;
  h = fnv(h, s.width); h = fnv(h, s.height); h = fnv(h, s.tileNum); h = fnv(h, s.bpp8 ? 1 : 0);
  h = fnv(h, s.hflip ? 1 : 0); h = fnv(h, s.vflip ? 1 : 0); h = fnv(h, map2d ? 1 : 0);
  const step = s.bpp8 ? 2 : 1, pieces = s.pieces;
  if (pieces) {
    for (let i = 0; i < pieces.length; i++) {
      const q = pieces[i];
      h = fnv(h, q.x); h = fnv(h, q.y); h = fnv(h, q.width); h = fnv(h, q.height); h = fnv(h, q.tileOffset);
      h = hashTiles(h, vram, s.tileNum + q.tileOffset, q.width, q.height, map2d, step);
    }
  } else h = hashTiles(h, vram, s.tileNum, s.width, s.height, map2d, step);
  return h;
}

/** `h` hashed on with the bytes of the OBJ tiles of a `w` × `hgt` piece from `tileNum` (`step` tile numbers per tile: 2
 *  at 8 bpp), as spriteAtlas.ts addresses them. */
function hashTiles(h: number, vram: Uint8Array, tileNum: number, w: number, hgt: number, map2d: boolean, step: number): number {
  const bytes = TILE_BYTES * step;
  for (let ty = 0; ty < hgt >> 3; ty++) {
    for (let tx = 0; tx < w >> 3; tx++) {
      const tile = map2d ? tileNum + ty * 32 + tx * step : tileNum + (ty * (w >> 3) + tx) * step;
      const a = OBJ_VRAM + (tile & 1023) * TILE_BYTES;
      for (let k = 0; k < bytes; k += 4) {
        const o = (a + k) % VRAM_SIZE;
        h = fnv(h, vram[o] | (vram[o + 1] << 8) | (vram[o + 2] << 16) | (vram[o + 3] << 24));
      }
    }
  }
  return h;
}

/** OBJ palette RAM starts at colour 256 (palette RAM's second half). */
const OBJ_PALETTE = 256;

/** A hash of the colours a battler's atlas slot is baked with (hardware palette RAM, as the battle's atlas reads it): its
 *  OBJ palette (all 256 OBJ colours at 8 bpp). With battlerAlphaKey, what the battlers' baked xBR decisions depend on
 *  (XbrBake: they compare colours) — a fade or a flash re-bakes them. */
export function battlerPaletteKey(s: SpriteSnap, pram16: Uint16Array): number {
  const from = OBJ_PALETTE + (s.bpp8 ? 0 : (s.palette & 15) * 16), count = s.bpp8 ? 256 : 16;
  let h = fnv(2166136261, s.bpp8 ? 1 : 0);
  for (let i = 0; i < count; i++) h = fnv(h, pram16[from + i]);
  return h;
}

const blankSpec = (): BillboardSpec =>
  ({ footX: 0, footY: 0, footZ: 0, width: 0, height: 0, lift: 0, flat: false, slot: { u0: 0, v0: 0, u1: 0, v1: 0 } });

/** Where effect sprites' depth is interpolated from the player's platform (screen x) to the enemy's. */
const EFFECT_X_PLAYER = 72, EFFECT_X_ENEMY = 176;
const _centre = new THREE.Vector3();
const _rect = { x: 0, y: 0 };

/** The top-left of a sprite's visible rectangle on the GBA screen into `out`: double-size sprites are offset by half,
 *  and the coordinates wrap as the GBA's OAM does (x mod 512 from −256, y mod 256 from −64). */
function screenTopLeft(s: SpriteSnap, out: { x: number; y: number }): { x: number; y: number } {
  let x = s.screenX, y = s.screenY;
  if (s.doubleSize) { x += s.width / 2; y += s.height / 2; }
  x = ((x % 512) + 512) % 512; if (x >= 256) x -= 512;
  y = ((y % 256) + 256) % 256; if (y >= 192) y -= 256;
  out.x = x;
  out.y = y;
  return out;
}

/**
 * The GBA screen row a battler stands on at rest (its picture's lowest row as the game places it). Every standing front
 * picture's lowest row lands on its position's sBattlerCoords y + 31 (gMonFrontPicCoords' y_offset is its blank rows: 325
 * of 325 species on row 71 at the opponent's y 40; a floating one is drawn gEnemyMonElevation rows higher), the doubles'
 * rear opponent (position 3: x 152, y 32) on row 63. Every back picture's lowest row lands on row 111 (y 80 + 31) — the
 * last row above the text box (112): the player's side stands on it in every position (the doubles' lower one, y 88,
 * shows only what the text box leaves of it, as on the GBA).
 */
export const GROUND_ROW = { enemy: 71, enemyRear: 63, player: 111 } as const;
/** Screen x splitting the sides (today's battler split) and, on the opponent's side, the rear position (x 152) from the
 *  front ones (176 in singles, 200 in doubles). */
const SIDE_X = 120, REAR_ENEMY_X = 164;
/** How far out on its platform (a share of its half-extents) a battler's feet may stand. */
export const FEET_MARGIN = 0.8;
/** Bytes of one row of one 4 bpp OBJ tile. */
const TILE_ROW_BYTES = 4;

/**
 * The lowest row of a sprite's rectangle (0 = its top row, as the GBA draws it: vertical flip applied) holding an opaque
 * pixel (colour index ≠ 0) in OBJ VRAM, the tiles addressed as spriteAtlas.ts does (1D / 2D mapping, 4 / 8 bpp); −1 for
 * none, or for a sprite built from subsprite pieces (no battler is). Scans from the bottom row up and stops at the first
 * opaque one; no allocation.
 */
export function lowestOpaqueRow(s: SpriteSnap, vram: Uint8Array, map2d: boolean): number {
  if (s.pieces) return -1;
  const step = s.bpp8 ? 2 : 1, rowBytes = TILE_ROW_BYTES * step, tilesX = s.width >> 3;
  for (let r = s.height - 1; r >= 0; r--) {
    const sr = s.vflip ? s.height - 1 - r : r, ty = sr >> 3;
    for (let tx = 0; tx < tilesX; tx++) {
      const tile = map2d ? s.tileNum + ty * 32 + tx * step : s.tileNum + (ty * tilesX + tx) * step;
      const a = OBJ_VRAM + (tile & 1023) * TILE_BYTES + (sr & 7) * rowBytes;
      for (let k = 0; k < rowBytes; k++) if (vram[(a + k) % VRAM_SIZE] !== 0) return r;
    }
  }
  return -1;
}

/**
 * How far a battler's upright card slides along the reference camera's view ray towards it (world units; negative: away)
 * so that the battler stands on its platform top (y = 0). Today's card stood on the platform's depth plane: the GBA draws
 * its sprites over the 2D platform picture, so in 3D the rows below the platform top hid inside the platform (up to 12
 * rows of a big opponent). The reference camera is orthographic: the slid card projects exactly where the GBA draws the
 * sprite, at its size; only its depth changes, until the centre of its ground row (GROUND_ROW; on the opponent's side the
 * picture's lowest opaque row where that lies lower, `tiles` given: a trainer picture at the doubles' rear position)
 * meets the platform top — half a row sinks in, the feet touch. A floating battler keeps its elevation (its picture ends
 * above its ground row); motion keeps its offsets: the slide is the battler's at rest (x2 / y2 taken off), so a lunge, a
 * jump or a faint moves it from where it stands. The feet stay within FEET_MARGIN of the platform's footprint
 * (PLATFORM_FOOTPRINT): beyond it the slide stops short and a remainder below the platform top is accepted (lifting the
 * card would move it off the GBA's layout); at rest every battler position stands well inside (≤ 0.63 of the
 * half-extents). No allocation.
 */
export function battlerSlide(s: SpriteSnap, stage: Stage, tiles: { vram: Uint8Array; map2d: boolean } | null = null): number {
  const { x, y } = screenTopLeft(s, _rect);
  const cx = x + s.width / 2 - s.x2, top = y - s.y2, cy = top + s.height / 2;
  const enemy = cx >= SIDE_X;
  let row: number = enemy ? (cx < REAR_ENEMY_X ? GROUND_ROW.enemyRear : GROUND_ROW.enemy) : GROUND_ROW.player;
  if (enemy && tiles) {
    const lowest = lowestOpaqueRow(s, tiles.vram, tiles.map2d);
    if (lowest >= 0) row = Math.max(row, top + lowest);
  }
  const centre = stage.at(cx, cy, enemy ? stage.enemyDepth : stage.playerDepth, _centre);
  // the ground row's centre on today's upright card (stretched by 1 / cos(pitch), as battleCardSpec's)
  const feetY = centre.y - (row + 0.5 - cy) / (PX * Math.cos(REF_PITCH));
  // (a slide by d along −fwd raises the card by d · −fwd.y and brings it nearer by d · −fwd.z)
  const rise = -stage.fwd.y, near = -stage.fwd.z;
  const platform = enemy ? stage.enemy : stage.player, f = enemy ? PLATFORM_FOOTPRINT.enemy : PLATFORM_FOOTPRINT.player;
  const ex = (centre.x - platform.x) / (f.rx * FEET_MARGIN);
  if (ex * ex >= 1) return 0;
  const dz = f.rz * FEET_MARGIN * Math.sqrt(1 - ex * ex);
  return THREE.MathUtils.clamp(-feetY / rise, (platform.z - dz - centre.z) / near, (platform.z + dz - centre.z) / near);
}

/** Today's card (BattleView.buildBillboards' maths, moved verbatim): visible rectangle (double-size offset, 512/256
 *  wrap), depth = player/enemy depth for battlers (cx < 120), else interpolated across xP 72 .. xE 176; height stretched
 *  by 1 / cos(REF_PITCH). `slide`: depth taken off along the reference ray (a battler's battlerSlide; 0: today's). The
 *  inflated battlers stand exactly where their cards would. */
export function battleCardSpec(s: SpriteSnap, slot: SlotUv, stage: Stage, out: BillboardSpec = blankSpec(), slide = 0): BillboardSpec {
  const xP = EFFECT_X_PLAYER, xE = EFFECT_X_ENEMY;
  const pxSize = 1 / PX;
  // Visible rectangle on the GBA screen (double-size sprites are offset by half).
  const { x, y } = screenTopLeft(s, _rect);
  const cx = x + s.width / 2;
  const cy = y + s.height / 2;
  let depth: number;
  if (isBattler(s)) {
    depth = cx < 120 ? stage.playerDepth : stage.enemyDepth;
  } else {
    const t = THREE.MathUtils.clamp((cx - xP) / (xE - xP), 0, 1);
    depth = stage.playerDepth + (stage.enemyDepth - stage.playerDepth) * t;
  }
  const w = s.width * s.scaleX;
  const h = s.height * s.scaleY;
  const centre = stage.at(cx, cy, depth - slide, _centre);
  // Upright cards: stretch by 1/cos(pitch) so they cover the same screen height as the
  // sprite does under the tilted reference camera.
  const hw = (h * pxSize) / Math.cos(REF_PITCH);
  out.footX = centre.x;
  out.footY = centre.y - hw / 2;
  out.footZ = centre.z;
  out.width = w * pxSize;
  out.height = hw;
  out.lift = 0;
  out.flat = false;
  out.slot = slot;
  return out;
}

const _top = new THREE.Vector3(), _bottom = new THREE.Vector3(), _mid = new THREE.Vector3();

/**
 * A sprite lying flat on the platform top (y = 0) under its screen rectangle (Modern's enemy shadow): x = the ground
 * hit of the rectangle's centre, z from the ground hit of its top edge (far) to its bottom edge's (near), width = its
 * screen width / PX; scaled about its centre (affine size; at scale 0 a finite, empty rectangle). A flat card covers
 * footZ − height .. footZ with the sprite's top row on the far edge (Billboards), as on the GBA's screen.
 */
export function battleDecalSpec(s: SpriteSnap, slot: SlotUv, stage: Stage, out: BillboardSpec = blankSpec()): BillboardSpec {
  const { x, y } = screenTopLeft(s, _rect);
  const cx = x + s.width / 2, cy = y + s.height / 2;
  const w = s.width * s.scaleX, h = s.height * s.scaleY;
  const top = stage.groundHit(cx, cy - h / 2, _top), bottom = stage.groundHit(cx, cy + h / 2, _bottom);
  out.footX = stage.groundHit(cx, cy, _mid).x;
  out.footY = 0;
  out.footZ = bottom.z;
  out.width = w / PX;
  out.height = bottom.z - top.z;
  out.lift = 0;
  out.flat = true;
  out.slot = slot;
  return out;
}

/** Inputs of the inflated battlers: the battle's inflation field (none: every battler stays a card), the rim colour (the
 *  battle KitUniforms' uSky, kept by reference) and their instance-data path (instanceUniformsFit: a renderer's caller
 *  passes it; default the uniform array). Cards use none of them. */
export interface BattleActorsOptions {
  field?: { texture: THREE.Texture }; rim?: { value: THREE.Color }; instanceUniforms?: boolean;
  /** The battlers' baked xBR decisions (XbrBake: BATTLE_VARIANT samples its HD edges through them). */
  xbr?: { texture: THREE.Texture };
}

export class BattleActors {
  /** Cards and decals (one instanced mesh), the inflated battlers. */
  readonly group = new THREE.Group();
  /** Modern battlers inflated, the enemy shadow flat, OBJ-window masks skipped (false: every sprite a card, as in
   *  Retro — the --ab-feature battlers baseline). */
  inflation = true;
  private billboards: Billboards;
  /** The Modern battlers (null without an inflation field: they stay cards). */
  private inflated: InflatedActors | null = null;
  /** The sprite edges and mask set so far (kept for an inflated mesh rebuilt later: checkInstanceUniforms). */
  private spriteFilter: SpriteFilter = 'smooth';
  private masked = false;
  // Reused every frame: the pool only grows; `cards` (cards and decals) and `actors` are this frame's lists, in sprite
  // order.
  private specPool: BillboardSpec[] = [];
  private cards: BillboardSpec[] = [];
  private actors: BillboardSpec[] = [];
  /** Decals among `cards` (last update). */
  private decals = 0;
  /** The battle actors' exposure (setExposure) and the cards' light it makes. */
  private exposure = 1;
  private cardLight = new THREE.Color();

  constructor(private readonly atlas: ActorAtlas, private readonly opts: BattleActorsOptions = {}) {
    this.billboards = new Billboards(atlas);
    this.billboards.mesh.name = 'battleCards';
    this.group.name = 'battleActors';
    this.group.add(this.billboards.mesh);
    // (GTAO's override pass at High would draw the bare quads at the origin)
    skipOverridePasses(this.billboards.mesh);
    if (opts.field) this.makeInflated(opts.field, opts.instanceUniforms ?? true);
  }

  /** Builds the inflated battlers (`instanceUniforms`: their instance-data path) with the sprite edges and mask set so
   *  far; hidden until a Modern frame draws them. No contact shadows: their sun silhouette lands on the platform. */
  private makeInflated(field: { texture: THREE.Texture }, instanceUniforms: boolean): void {
    const rim = this.opts.rim ?? { value: new THREE.Color(0.75, 0.88, 1.0) };
    const size = new THREE.Vector2(this.atlas.target.width ?? SLOT * SLOT_COLS, this.atlas.target.height ?? SLOT * SLOT_ROWS);
    const inflated = this.inflated = new InflatedActors(this.atlas.target.texture, field.texture, rim, size, instanceUniforms, BATTLE_VARIANT,
      this.opts.xbr?.texture ?? null);
    inflated.setSmoothing(this.spriteFilter === 'smooth');
    inflated.setMask(this.masked);
    inflated.mesh.name = 'battleInflated';
    inflated.mesh.visible = false;
    // They cast their silhouette but receive no shadow: nothing in a battle shadows a battler (their own relief's is
    // pushed away, SHADOW_PUSH; the arena's props stand far off) — 0 px on every battle entry without it (Task 5 fix round
    // 1), and three skips the shadow-map lookups (a uniform: the same program) on these large, magnified fragments
    inflated.mesh.receiveShadow = false;
    (inflated.mesh.material as THREE.MeshStandardMaterial).color.setScalar(this.exposure);
    this.group.add(inflated.mesh);
    skipOverridePasses(inflated.mesh);
  }

  /**
   * The battle actors' exposure (default 1): the inflated battlers' colour (a uniform: their lit colour, rim included, ×
   * k; their light floor stays the scene's charLight's) and the cards' light (× k). The Modern battle keeps its battlers
   * as bright as today's while its arena takes the hour's, a cave's or the sea floor's light (BattleView); 1 elsewhere.
   */
  setExposure(k: number): void {
    if (k === this.exposure) return;
    this.exposure = k;
    if (this.inflated) (this.inflated.mesh.material as THREE.MeshStandardMaterial).color.setScalar(k);
  }

  /** This frame's sprites, in sprite order (no allocation once warm); HUD sprites appended to `hud`. `eye`: the camera's
   *  position (the inflated battlers' relief rises towards it); `charLight`: the cards' light (the inflated battlers'
   *  light floor); `copies`: the battler sprites whose flat copy the overlay shows (GameState.battlerCopies); `tiles`:
   *  OBJ VRAM and its tile mapping (battlerSlide reads the opponents' lowest opaque rows there; null: their ground rows
   *  only). Battlers (cards or inflated, both styles) stand on their platform top (battlerSlide); move effects as today. */
  update(sprites: readonly SpriteSnap[], style: WorldStyle, cameraRight: THREE.Vector3, eye: THREE.Vector3,
    charLight: THREE.Color, hud: SpriteSnap[], copies: readonly number[] = [],
    tiles: { vram: Uint8Array; map2d: boolean } | null = null): void {
    const inflate = this.inflation && this.inflated !== null;
    const cards = this.cards, actors = this.actors;
    cards.length = 0;
    actors.length = 0;
    let n = 0, decals = 0;
    for (const s of sprites) {
      const route = battleRoute(s, style, inflate, copies.length > 0 && copies.includes(s.index));
      if (route === 'skip') continue;
      if (route === 'hud') { hud.push(s); continue; }
      const slot = this.atlas.slots.get(s.index);
      if (!slot) continue;
      const spec = this.specPool[n++] ??= blankSpec();
      if (route === 'decal') {
        cards.push(battleDecalSpec(s, slot, STAGE, spec));
        decals++;
        continue;
      }
      const card = battleCardSpec(s, slot, STAGE, spec, isBattler(s) ? battlerSlide(s, STAGE, tiles) : 0);
      (route === 'inflated' ? actors : cards).push(card);
    }
    this.decals = decals;
    this.billboards.set(cards, cameraRight, this.exposure === 1 ? charLight : this.cardLight.copy(charLight).multiplyScalar(this.exposure));
    if (this.inflated) {
      // Retro (or inflation off): none, hidden
      this.inflated.set(actors, cameraRight, eye);
      this.inflated.setLightFloor(charLight);
      this.inflated.mesh.visible = inflate && style === 'modern';
    }
  }

  /** Instances drawn per kind (last update). */
  counts(): { cards: number; inflated: number; decals: number } {
    return { cards: this.billboards.count - this.decals, inflated: this.inflated?.count ?? 0, decals: this.decals };
  }

  /** Sprite edges of the inflated battlers (Modern): HD smooth (xBR, the default) or Pixel; their cast silhouette
   *  follows. Cards and decals are unaffected. */
  setSpriteFilter(f: SpriteFilter): void {
    this.spriteFilter = f;
    this.inflated?.setSmoothing(f === 'smooth');
  }

  /** Draws every battle actor (cards, decals, inflated battlers) flat magenta (the harness's visible-actor mask) or
   *  normally. */
  setMask(on: boolean): void {
    this.masked = on;
    this.billboards.setMask(on);
    this.inflated?.setMask(on);
  }

  /** Shows the inflated battlers' mesh for the precompile frame (also in a Retro session, where it is hidden: its
   *  programs, main and shadow-depth, compile with the battle's lights before a switch to Modern draws it); returns what
   *  restores it. (The cards are always shown.) */
  showAll(): () => void {
    if (!this.inflated) return () => {};
    const was = this.inflated.mesh.visible;
    this.inflated.mesh.visible = true;
    // (the mesh then — a fallback rebuild meanwhile (checkInstanceUniforms) replaced it: the new one is hidden as the old was)
    return () => {
      if (this.inflated) this.inflated.mesh.visible = was;
    };
  }

  /**
   * After the precompile (`programs`: renderer.info.programs): when the battle variant's uniform-array programs did not
   * link on this device (instanceUniformsFit let them through: a driver counting vectors more coarsely), rebuilds the
   * inflated battlers on the instance-attribute path, warned once — else the Modern battlers would stay invisible. Their
   * programs then compile on first use. Returns whether it rebuilt them.
   */
  checkInstanceUniforms(programs: readonly ProgramInfo[]): boolean {
    const field = this.opts.field;
    const old = this.inflated;
    if (!field || !old?.instanceUniforms || !instanceUniformsFailed(programs, BATTLE_VARIANT.tag)) return false;
    console.warn('[battle] the inflated battlers\' uniform-array programs did not link on this device: falling back to instance attributes');
    const visible = old.mesh.visible;
    this.group.remove(old.mesh);
    old.dispose();
    this.makeInflated(field, false);
    this.inflated!.mesh.visible = visible;
    return true;
  }
}
