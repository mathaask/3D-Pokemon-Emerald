// The battle stage: the reference projection every battle sprite and arena is placed by. GBA screen pixels are
// "un-projected" through an orthographic reference camera that reproduces the 240×160 layout (PX GBA px per world unit,
// pitched REF_PITCH down), so the two platforms land where the GBA draws them; the platform tops are the reference
// ground (y = 0). (Moved verbatim from BattleView: the same operations in the same order, bit-identical.)

import * as THREE from 'three';

/** GBA pixels per world unit in the reference projection. */
export const PX = 32;
export const REF_PITCH = THREE.MathUtils.degToRad(24);

/** Where the GBA draws the two platform centres (singles layout). */
export const PLATFORM_PLAYER_SCREEN = { x: 64, y: 117 }, PLATFORM_ENEMY_SCREEN = { x: 176, y: 64 };

/** Today's arena ground (BattleArena.group.position.y): the platform tops are y = 0. */
export const GROUND_Y = -0.28;
/** The Modern water surface (Task 8). */
export const WATER_Y = -0.06;

/** The battle's sun (BattleView, both styles): its offset from the point the camera looks at — x swings by cos(day phase)
 *  × `swing` about `x` through the day — and its shadow camera's half extent and depth range (orthographic, along the
 *  sun). The arena's scenery reads them (parts/flora.ts: which trees cast). */
export const SUN_OFFSET = { swing: 6, x: -4, y: 14, z: 10 } as const;
export const SUN_SHADOW = { half: 14, near: 1, far: 80 } as const;

/** A platform's half-extents on the ground (world units). */
export interface Footprint { rx: number; rz: number }
/** Today's platforms (BattleArena.setPlatforms: radius 2.1 / 1.9, depth scaled by 0.62). */
export const PLATFORM_FOOTPRINT: { player: Footprint; enemy: Footprint } =
  { player: { rx: 2.1, rz: 2.1 * 0.62 }, enemy: { rx: 1.9, rz: 1.9 * 0.62 } };

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Stage {
  /** The reference camera's basis and origin. */
  readonly right = new THREE.Vector3();
  readonly fwd = new THREE.Vector3();
  readonly up = new THREE.Vector3();
  readonly origin = new THREE.Vector3();
  /** The platform centres on the reference ground, and their midpoint. */
  readonly player = new THREE.Vector3();
  readonly enemy = new THREE.Vector3();
  readonly centre = new THREE.Vector3();
  /** The platforms' depths along the reference camera's forward axis (depthOf). */
  readonly playerDepth: number;
  readonly enemyDepth: number;

  constructor() {
    this.fwd.set(0, -Math.sin(REF_PITCH), -Math.cos(REF_PITCH));
    this.right.set(1, 0, 0);
    this.up.crossVectors(this.right, this.fwd); // right x forward = up
    // Place the reference camera so the player platform lands where the GBA draws it.
    this.origin.set(0, 0, 0);
    const pp = this.groundHit(PLATFORM_PLAYER_SCREEN.x, PLATFORM_PLAYER_SCREEN.y);
    // (BattleView's operations kept as they were, the zero additions included: bit-identical)
    this.origin.sub(pp).add(new THREE.Vector3(0, 0, 0));
    this.origin.y += 0; // keep ground at y = 0
    // recompute with the shifted origin
    this.player.copy(this.groundHit(PLATFORM_PLAYER_SCREEN.x, PLATFORM_PLAYER_SCREEN.y));
    this.enemy.copy(this.groundHit(PLATFORM_ENEMY_SCREEN.x, PLATFORM_ENEMY_SCREEN.y));
    this.playerDepth = this.depthOf(this.player);
    this.enemyDepth = this.depthOf(this.enemy);
    this.centre.copy(this.player).lerp(this.enemy, 0.5);
  }

  /** The reference ray's origin through GBA pixel (sx, sy). */
  rayOrigin(sx: number, sy: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.origin)
      .addScaledVector(this.right, (sx - 120) / PX)
      .addScaledVector(this.up, (80 - sy) / PX)
      .addScaledVector(this.fwd, -40);
  }

  /** Where the ray through GBA pixel (sx, sy) meets the reference ground (y = 0). */
  groundHit(sx: number, sy: number, out = new THREE.Vector3()): THREE.Vector3 {
    const o = this.rayOrigin(sx, sy, out);
    const t = -o.y / this.fwd.y;
    return o.addScaledVector(this.fwd, t);
  }

  /** Point on the ray through GBA pixel (sx, sy) at reference depth `depth`. */
  at(sx: number, sy: number, depth: number, out = new THREE.Vector3()): THREE.Vector3 {
    return this.rayOrigin(sx, sy, out).addScaledVector(this.fwd, depth);
  }

  /** A point's reference depth: along the forward axis, from the ray origin of the screen centre. */
  depthOf(p: THREE.Vector3): number {
    return _d.copy(p).sub(this.rayOrigin(120, 80, _o)).dot(this.fwd);
  }
}

/** The battle's reference projection (one for every battle: the GBA's singles layout). */
export const STAGE = new Stage();
