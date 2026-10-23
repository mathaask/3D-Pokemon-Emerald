// The battle's sprites in 3D: each frame's sprites routed (HUD / card / inflated / decal / skip) and placed by the
// battle stage's reference projection. Task 4: today's upright cards for every visible non-HUD sprite, in both styles
// (the Modern routing — inflated battlers, the flat enemy shadow, OBJ-window masks skipped — is Task 5's).

import * as THREE from 'three';
import type { SpriteSnap } from '../../game/state';
import { SYM } from '../../game/symbols';
import { Billboards, type BillboardSpec } from '../overworld/billboards';
import type { WorldStyle } from '../overworld/world';
import type { ActorAtlas, SlotUv, SpriteFilter } from '../actors/actorLayer';
import type { ProgramInfo } from '../actors/inflatedActors';
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

/** Task 4: invisible → skip; HUD template → hud; every other sprite → card, in both styles (today's: OBJ-window clones
 *  and the enemy shadow included). Task 5 adds the Modern routing: Retro or !inflation → card; Modern: objMode 2 (OBJ
 *  window) → skip, battler → inflated, enemy shadow → decal, else card. */
export function battleRoute(s: SpriteSnap, style: WorldStyle, inflation: boolean): BattleRoute {
  if (s.invisible) return 'skip';
  if (isBattleHudSprite(s)) return 'hud';
  // (the style and the inflation switch route nothing yet: Task 5)
  void style;
  void inflation;
  return 'card';
}

const blankSpec = (): BillboardSpec =>
  ({ footX: 0, footY: 0, footZ: 0, width: 0, height: 0, lift: 0, flat: false, slot: { u0: 0, v0: 0, u1: 0, v1: 0 } });

/** Where effect sprites' depth is interpolated from the player's platform (screen x) to the enemy's. */
const EFFECT_X_PLAYER = 72, EFFECT_X_ENEMY = 176;
const _centre = new THREE.Vector3();

/** Today's card (BattleView.buildBillboards' maths, moved verbatim): visible rectangle (double-size offset, 512/256
 *  wrap), depth = player/enemy depth for battlers (cx < 120), else interpolated across xP 72 .. xE 176; height stretched
 *  by 1 / cos(REF_PITCH). */
export function battleCardSpec(s: SpriteSnap, slot: SlotUv, stage: Stage, out: BillboardSpec = blankSpec()): BillboardSpec {
  const xP = EFFECT_X_PLAYER, xE = EFFECT_X_ENEMY;
  const pxSize = 1 / PX;
  // Visible rectangle on the GBA screen (double-size sprites are offset by half).
  let x = s.screenX, y = s.screenY;
  if (s.doubleSize) { x += s.width / 2; y += s.height / 2; }
  x = ((x % 512) + 512) % 512; if (x >= 256) x -= 512;
  y = ((y % 256) + 256) % 256; if (y >= 192) y -= 256;
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

/** Inputs of the inflated battlers (Task 5): the battle's inflation field, the rim colour (the battle KitUniforms' uSky)
 *  and their instance-data path (instanceUniformsFit). Cards use none of them. */
export interface BattleActorsOptions { field?: { texture: THREE.Texture }; rim?: { value: THREE.Color }; instanceUniforms?: boolean }

export class BattleActors {
  /** Cards (+ inflated actors, Task 5). */
  readonly group = new THREE.Group();
  /** Modern battlers inflated (Task 5; the --ab-feature battlers switch). */
  inflation = true;
  private billboards: Billboards;
  // Reused every frame: the pool only grows; `cards` is this frame's list (sprite order).
  private specPool: BillboardSpec[] = [];
  private cards: BillboardSpec[] = [];

  constructor(private readonly atlas: ActorAtlas, private readonly opts: BattleActorsOptions = {}) {
    this.billboards = new Billboards(atlas);
    this.billboards.mesh.name = 'battleCards';
    this.group.name = 'battleActors';
    this.group.add(this.billboards.mesh);
  }

  /** This frame's sprites, in sprite order (no allocation once warm); HUD sprites appended to `hud`. */
  update(sprites: readonly SpriteSnap[], style: WorldStyle, cameraRight: THREE.Vector3, eye: THREE.Vector3,
    charLight: THREE.Color, hud: SpriteSnap[]): void {
    const cards = this.cards;
    cards.length = 0;
    for (const s of sprites) {
      const route = battleRoute(s, style, this.inflation);
      if (route === 'skip') continue;
      if (route === 'hud') { hud.push(s); continue; }
      const slot = this.atlas.slots.get(s.index);
      if (!slot) continue;
      const spec = this.specPool[cards.length] ??= blankSpec();
      cards.push(battleCardSpec(s, slot, STAGE, spec));
    }
    // (the eye places the inflated battlers: Task 5)
    void eye;
    this.billboards.set(cards, cameraRight, charLight);
  }

  /** Instances drawn per kind (last update). */
  counts(): { cards: number; inflated: number; decals: number } {
    return { cards: this.billboards.count, inflated: 0, decals: 0 };
  }

  /** Sprite edges of the inflated battlers (Task 5): cards are unaffected. */
  setSpriteFilter(f: SpriteFilter): void {
    void f;
  }

  /** Draws every battle actor flat magenta (the harness's visible-actor mask) or normally. */
  setMask(on: boolean): void {
    this.billboards.setMask(on);
  }

  /** Shows every actor mesh for the precompile frame (the inflated battlers, Task 5: the cards are always shown);
   *  returns what restores them. */
  showAll(): () => void {
    return () => {};
  }

  /** Task 4: a stub returning false (no inflated mesh yet; finishPrecompile already calls it). Task 5: when the battle
   *  variant's uniform-array programs failed (instanceUniformsFailed(programs, 'battle')), rebuilds the inflated mesh on
   *  instance attributes and returns true. */
  checkInstanceUniforms(programs: readonly ProgramInfo[]): boolean {
    void programs;
    void this.opts;
    return false;
  }
}
