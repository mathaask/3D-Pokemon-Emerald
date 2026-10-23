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
import { PX, REF_PITCH, STAGE, type Stage } from './stage';

export type BattleRoute = 'skip' | 'hud' | 'card' | 'inflated' | 'decal';

// Templates of HUD sprites (healthboxes, HP bars, party status balls) — drawn in screen space.
const HUD_TEMPLATE_RANGES: [number, number][] = [
  [0x0832c140, 0x0832c220], // healthbox player/opponent/safari + healthbars
  [0x0832c364, 0x0832c3c4], // status summary bar + balls
];

/** A HUD sprite (healthbox, HP bar, party status balls): the screen-space HUD draws it. */
export function isBattleHudSprite(s: SpriteSnap): boolean {
  for (const [a, b] of HUD_TEMPLATE_RANGES) if (s.template >= a && s.template < b) return true;
  return false;
}

/** Today's isActor: a battler or trainer picture (gMultiuseSpriteTemplate, gBattlerSpriteTemplates[4]). */
export function isBattler(s: SpriteSnap): boolean {
  return s.template === SYM.gMultiuseSpriteTemplate || (s.template >= SYM.gBattlerSpriteTemplates && s.template < SYM.gBattlerSpriteTemplates + 0x60);
}

/** The shadow sprite under a floating enemy (gSpriteTemplate_EnemyShadow). */
export function isEnemyShadow(s: SpriteSnap): boolean {
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

/** Today's card (BattleView.buildBillboards' maths, moved verbatim): visible rectangle (double-size offset, 512/256
 *  wrap), depth = player/enemy depth for battlers (cx < 120), else interpolated across xP 72 .. xE 176; height stretched
 *  by 1 / cos(REF_PITCH). The inflated battlers stand exactly where their cards would. */
export function battleCardSpec(s: SpriteSnap, slot: SlotUv, stage: Stage, out: BillboardSpec = blankSpec()): BillboardSpec {
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
  const centre = stage.at(cx, cy, depth, _centre);
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

/** The decals' own uv rectangles (a flat card draws the uv's top row at its near edge: see battleDecalSpec), one per
 *  spec object — reused, so a warm frame allocates nothing. */
const DECAL_UV = new WeakMap<BillboardSpec, SlotUv>();
const _top = new THREE.Vector3(), _bottom = new THREE.Vector3(), _mid = new THREE.Vector3();

/**
 * A sprite lying flat on the platform top (y = 0) under its screen rectangle (Modern's enemy shadow): x = the ground
 * hit of the rectangle's centre, z from the ground hit of its top edge (far) to its bottom edge's (near), width = its
 * screen width / PX; scaled about its centre (affine size; at scale 0 a finite, empty rectangle). A flat card covers
 * footZ − height .. footZ and draws its uv's top row at footZ (the near edge), so the decal's uv is flipped: the
 * sprite's bottom row lies nearest the camera, as on the GBA's screen.
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
  let uv = DECAL_UV.get(out);
  if (!uv) DECAL_UV.set(out, uv = { u0: 0, v0: 0, u1: 0, v1: 0 });
  uv.u0 = slot.u0; uv.v0 = slot.v1; uv.u1 = slot.u1; uv.v1 = slot.v0;
  out.slot = uv;
  return out;
}

/** Inputs of the inflated battlers: the battle's inflation field (none: every battler stays a card), the rim colour (the
 *  battle KitUniforms' uSky, kept by reference) and their instance-data path (instanceUniformsFit: a renderer's caller
 *  passes it; default the uniform array). Cards use none of them. */
export interface BattleActorsOptions { field?: { texture: THREE.Texture }; rim?: { value: THREE.Color }; instanceUniforms?: boolean }

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
    const inflated = this.inflated = new InflatedActors(this.atlas.target.texture, field.texture, rim, size, instanceUniforms, BATTLE_VARIANT);
    inflated.setSmoothing(this.spriteFilter === 'smooth');
    inflated.setMask(this.masked);
    inflated.mesh.name = 'battleInflated';
    inflated.mesh.visible = false;
    this.group.add(inflated.mesh);
    skipOverridePasses(inflated.mesh);
  }

  /** This frame's sprites, in sprite order (no allocation once warm); HUD sprites appended to `hud`. `eye`: the camera's
   *  position (the inflated battlers' relief rises towards it); `charLight`: the cards' light (the inflated battlers'
   *  light floor); `copies`: the battler sprites whose flat copy the overlay shows (GameState.battlerCopies). */
  update(sprites: readonly SpriteSnap[], style: WorldStyle, cameraRight: THREE.Vector3, eye: THREE.Vector3,
    charLight: THREE.Color, hud: SpriteSnap[], copies: readonly number[] = []): void {
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
      if (route === 'inflated') actors.push(battleCardSpec(s, slot, STAGE, spec));
      else if (route === 'decal') {
        cards.push(battleDecalSpec(s, slot, STAGE, spec));
        decals++;
      } else cards.push(battleCardSpec(s, slot, STAGE, spec));
    }
    this.decals = decals;
    this.billboards.set(cards, cameraRight, charLight);
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
    const mesh = this.inflated?.mesh;
    if (!mesh) return () => {};
    const was = mesh.visible;
    mesh.visible = true;
    return () => { mesh.visible = was; };
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
