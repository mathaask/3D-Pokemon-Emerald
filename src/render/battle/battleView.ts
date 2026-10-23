// 3D battle scene. Battle sprites are placed by "un-projecting" their GBA screen positions
// through an orthographic reference camera that reproduces the 240x160 layout, onto depth
// planes (player side, enemy side, or interpolated for move effects). The arena around them
// is generated and themed from the game's own terrain background colours.

import * as THREE from 'three';
import type { GameState, SpriteSnap } from '../../game/state';
import { SYM } from '../../game/symbols';
import type { SpriteAtlas } from '../spriteAtlas';
import { Billboards, BlobShadows, type BillboardSpec } from '../overworld/billboards';
import { Sky } from '../overworld/sky';
import { bgr555ToRgba } from '../gbaTextures';
import { BattleArena } from './arena';

/** GBA pixels per world unit in the reference projection. */
const PX = 32;
const REF_PITCH = THREE.MathUtils.degToRad(24);

// Where the GBA draws the two platform centres (singles layout).
const PLATFORM_PLAYER_SCREEN = new THREE.Vector2(64, 117);
const PLATFORM_ENEMY_SCREEN = new THREE.Vector2(176, 64);

// Templates of HUD sprites (healthboxes, HP bars, party status balls) — drawn in screen space.
const HUD_TEMPLATE_RANGES: [number, number][] = [
  [0x0832c140, 0x0832c220], // healthbox player/opponent/safari + healthbars
  [0x0832c364, 0x0832c3c4], // status summary bar + balls
];

export function isBattleHudSprite(s: SpriteSnap): boolean {
  for (const [a, b] of HUD_TEMPLATE_RANGES) if (s.template >= a && s.template < b) return true;
  return false;
}

export class BattleView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1.5, 0.1, 400);
  private billboards: Billboards;
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private hemi = new THREE.HemisphereLight(0xcfe8ff, 0x55603a, 1.1);
  private sky = new Sky();
  private arena = new BattleArena();
  // reference camera basis
  private refRight = new THREE.Vector3();
  private refUp = new THREE.Vector3();
  private refFwd = new THREE.Vector3();
  private refOrigin = new THREE.Vector3();
  readonly playerPlatform = new THREE.Vector3();
  readonly enemyPlatform = new THREE.Vector3();
  private playerDepth = 0;
  private enemyDepth = 0;
  private time = 0;
  private envKey = '';
  private env = -1;
  private lastSample = -1;
  private charLight = new THREE.Color(1, 1, 1);
  private cameraRight = new THREE.Vector3(1, 0, 0);
  /** User orbit offsets (from mouse/keys). */
  yaw = 0;
  zoom = 1;
  private intro = 0;
  private focus = 0;
  private focusSide = 1;

  constructor(private spriteAtlas: SpriteAtlas) {
    this.billboards = new Billboards(spriteAtlas);
    this.scene.add(this.billboards.mesh, this.sun, this.sun.target, this.hemi, this.sky.mesh, this.arena.group);
    this.scene.fog = new THREE.Fog(0xcfe8ff, 40, 120);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -14; sc.right = 14; sc.top = 14; sc.bottom = -14; sc.near = 1; sc.far = 80;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.setupReference();
  }

  /** Orthographic reference camera: GBA pixel (sx, sy) -> ray origin + direction. */
  private setupReference(): void {
    this.refFwd.set(0, -Math.sin(REF_PITCH), -Math.cos(REF_PITCH));
    this.refRight.set(1, 0, 0);
    this.refUp.crossVectors(this.refRight, this.refFwd); // right x forward = up
    // Place the reference camera so the player platform lands where the GBA draws it.
    this.refOrigin.set(0, 0, 0);
    const pp = this.groundHit(PLATFORM_PLAYER_SCREEN.x, PLATFORM_PLAYER_SCREEN.y);
    this.refOrigin.sub(pp).add(new THREE.Vector3(0, 0, 0));
    this.refOrigin.y += 0; // keep ground at y = 0
    // recompute with the shifted origin
    this.playerPlatform.copy(this.groundHit(PLATFORM_PLAYER_SCREEN.x, PLATFORM_PLAYER_SCREEN.y));
    this.enemyPlatform.copy(this.groundHit(PLATFORM_ENEMY_SCREEN.x, PLATFORM_ENEMY_SCREEN.y));
    this.playerDepth = this.depthOf(this.playerPlatform);
    this.enemyDepth = this.depthOf(this.enemyPlatform);
    this.arena.setPlatforms(this.playerPlatform, this.enemyPlatform);
  }

  private rayOrigin(sx: number, sy: number): THREE.Vector3 {
    return this.refOrigin.clone()
      .addScaledVector(this.refRight, (sx - 120) / PX)
      .addScaledVector(this.refUp, (80 - sy) / PX)
      .addScaledVector(this.refFwd, -40);
  }

  private groundHit(sx: number, sy: number): THREE.Vector3 {
    const o = this.rayOrigin(sx, sy);
    const t = -o.y / this.refFwd.y;
    return o.addScaledVector(this.refFwd, t);
  }

  private depthOf(p: THREE.Vector3): number {
    return p.clone().sub(this.rayOrigin(120, 80)).dot(this.refFwd);
  }

  /** Point on the ray through GBA pixel (sx, sy) at reference depth d. */
  private at(sx: number, sy: number, d: number): THREE.Vector3 {
    return this.rayOrigin(sx, sy).addScaledVector(this.refFwd, d);
  }

  private sampleTerrain(state: GameState): void {
    // Sample the GBA terrain background (BG3: char base 2, screen base 26) for theme colours.
    const m = state.mem;
    const bus = m.bus;
    // Use the unfaded palette buffer: hardware palette RAM is mid-fade during the intro.
    const palOff = (SYM.gPlttBufferUnfaded & 0x3ffff) >>> 1;
    const pal = bus.ewram16.subarray(palOff, palOff + 256);
    if (state.battleEnvironment !== this.env) {
      this.env = state.battleEnvironment;
      this.arena.setEnvironment(this.env);
      this.intro = 0;
      this.envKey = '';
    }
    // Re-sample now and then: BG3 is loaded a little after the battle starts.
    if (this.time - this.lastSample < 0.5) return;
    this.lastSample = this.time;
    const colorAt = (sx: number, sy: number): THREE.Color => {
      const bgcnt = bus.io16[0x0e >>> 1];
      const charBase = ((bgcnt >>> 2) & 3) * 0x4000;
      const screenBase = ((bgcnt >>> 8) & 31) * 0x800;
      const tx = sx >> 3, ty = sy >> 3;
      const entry = bus.vram16[(screenBase >>> 1) + ty * 32 + tx];
      const tile = entry & 0x3ff;
      const palIdx = entry >>> 12;
      let px = sx & 7, py = sy & 7;
      if (entry & 0x400) px = 7 - px;
      if (entry & 0x800) py = 7 - py;
      const byte = bus.vram[(charBase + tile * 32 + py * 4 + (px >> 1)) & 0xffff];
      const ci = px & 1 ? byte >> 4 : byte & 15;
      const c = bgr555ToRgba(pal[palIdx * 16 + ci]);
      return new THREE.Color().setRGB((c & 255) / 255, ((c >> 8) & 255) / 255, ((c >> 16) & 255) / 255, THREE.SRGBColorSpace);
    };
    const sky = colorAt(120, 6);
    const platform = colorAt(PLATFORM_ENEMY_SCREEN.x, PLATFORM_ENEMY_SCREEN.y);
    const rim = colorAt(PLATFORM_ENEMY_SCREEN.x - 56, PLATFORM_ENEMY_SCREEN.y);
    const lum = (c: THREE.Color) => c.r + c.g + c.b;
    if (lum(platform) < 0.02 && lum(sky) < 0.02) return; // not loaded yet
    const key = [sky, platform, rim].map((c) => c.getHexString()).join(':');
    if (key === this.envKey) return;
    this.envKey = key;
    this.arena.setColors(sky, platform, rim);
  }

  private isActor(s: SpriteSnap): boolean {
    return s.template === SYM.gMultiuseSpriteTemplate || (s.template >= SYM.gBattlerSpriteTemplates && s.template < SYM.gBattlerSpriteTemplates + 0x60);
  }

  private buildBillboards(state: GameState, hudSprites: SpriteSnap[]): BillboardSpec[] {
    const list: BillboardSpec[] = [];
    const xP = 72, xE = 176;
    const pxSize = 1 / PX;
    for (const s of state.sprites) {
      if (s.invisible) continue;
      if (isBattleHudSprite(s)) { hudSprites.push(s); continue; }
      const slot = this.spriteAtlas.slots.get(s.index);
      if (!slot) continue;
      // Visible rectangle on the GBA screen (double-size sprites are offset by half).
      let x = s.screenX, y = s.screenY;
      if (s.doubleSize) { x += s.width / 2; y += s.height / 2; }
      x = ((x % 512) + 512) % 512; if (x >= 256) x -= 512;
      y = ((y % 256) + 256) % 256; if (y >= 192) y -= 256;
      const cx = x + s.width / 2;
      const cy = y + s.height / 2;
      let depth: number;
      if (this.isActor(s)) {
        depth = cx < 120 ? this.playerDepth : this.enemyDepth;
      } else {
        const t = THREE.MathUtils.clamp((cx - xP) / (xE - xP), 0, 1);
        depth = this.playerDepth + (this.enemyDepth - this.playerDepth) * t;
      }
      const w = s.width * s.scaleX;
      const h = s.height * s.scaleY;
      const centre = this.at(cx, cy, depth);
      // Upright cards: stretch by 1/cos(pitch) so they cover the same screen height as the
      // sprite does under the tilted reference camera.
      const hw = (h * pxSize) / Math.cos(REF_PITCH);
      list.push({
        footX: centre.x, footY: centre.y - hw / 2, footZ: centre.z,
        width: w * pxSize,
        height: hw,
        lift: 0,
        flat: false,
        slot,
      });
    }
    return list;
  }

  update(state: GameState, dt: number, input: { yaw: number; pitch: number; zoom: number }, hudSprites: SpriteSnap[]): void {
    this.time += dt;
    this.intro = Math.min(1, this.intro + dt / 2.2);
    this.sampleTerrain(state);
    this.yaw = THREE.MathUtils.clamp(this.yaw + input.yaw, -0.9, 0.9);
    if (input.zoom) this.zoom = THREE.MathUtils.clamp(this.zoom * Math.pow(1.1, input.zoom), 0.6, 1.6);

    // Camera: behind the player's side, framing both platforms like the GBA, with a slow
    // breathing sway and an intro sweep.
    // Look down the reference camera's centre ray; a narrow FOV keeps perspective close to
    // the GBA's flat projection while still giving depth.
    const midDepth = (this.playerDepth + this.enemyDepth) / 2;
    const mid = this.at(120, 82, midDepth);
    // Cinematic focus: while a move animation plays, ease towards the target and push in.
    const targetFocus = state.animActive ? 1 : 0;
    this.focus += (targetFocus - this.focus) * Math.min(1, dt * 2.5);
    if (state.animActive) {
      // Player side = even battler ids; aim at whoever is being hit.
      this.focusSide = (state.target & 1) === 1 ? 1 : -1;
    }
    const focusPoint = this.focusSide > 0 ? this.enemyPlatform : this.playerPlatform;
    mid.lerp(new THREE.Vector3(focusPoint.x, mid.y, focusPoint.z), this.focus * 0.25);
    const ease = 1 - Math.pow(1 - this.intro, 3);
    const sway = Math.sin(this.time * 0.25) * 0.04;
    const yaw = this.yaw + sway + (1 - ease) * 0.5 + this.focus * 0.06 * this.focusSide;
    const fov = 24;
    const dist = ((80 / PX) / Math.tan(THREE.MathUtils.degToRad(fov / 2))) * this.zoom *
      (1 + (1 - ease) * 0.5) * (1 - this.focus * 0.08);
    const pitch = REF_PITCH - 0.13 + (1 - ease) * 0.06;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.camera.position.copy(mid).addScaledVector(dir, dist);
    this.camera.fov = fov;
    this.camera.lookAt(mid);
    this.camera.updateProjectionMatrix();
    this.cameraRight.set(Math.cos(yaw), 0, -Math.sin(yaw));

    // Light: time of day, like the overworld (battles indoors are evenly lit).
    const indoor = state.battleEnvironment === 8 || state.battleEnvironment === 7;
    const hour = state.hours + state.minutes / 60;
    const dayPhase = ((hour - 6) / 12) * Math.PI;
    const night = !indoor && (hour < 5.5 || hour > 19.5);
    this.sun.position.copy(mid).add(new THREE.Vector3(Math.cos(dayPhase) * 6 - 4, 14, 10));
    this.sun.target.position.copy(mid);
    this.sun.intensity = indoor ? 1.6 : night ? 0.6 : 2.4;
    this.sun.color.set(night ? 0x9fb3ff : 0xfff3e0);
    this.hemi.intensity = indoor ? 1.6 : night ? 0.7 : 1.15;
    const k = 1 / Math.PI;
    this.charLight.setRGB(
      (this.hemi.intensity + this.sun.intensity * 0.75) * k,
      (this.hemi.intensity + this.sun.intensity * 0.72) * k,
      (this.hemi.intensity + this.sun.intensity * 0.68) * k,
    );
    this.arena.update(this.time, night);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.arena.horizon);
    this.sky.setColors(this.arena.skyColor, this.arena.horizon, indoor, this.time);
    this.sky.mesh.position.copy(this.camera.position);

    this.billboards.set(this.buildBillboards(state, hudSprites), this.cameraRight, this.charLight);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Draws the battle cards flat magenta (the harness's visible-actor mask) or normally. */
  setActorMask(on: boolean): void {
    this.billboards.setMask(on);
  }
}
