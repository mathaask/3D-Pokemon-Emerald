// The 3D overworld: world mesh, sprite billboards, sky, sun/moon lighting, camera rig.

import * as THREE from 'three';
import { MAP_OFFSET, type GameState, type SpriteSnap } from '../../game/state';
import type { Mem } from '../../game/mem';
import type { Bus } from '../../gba/bus';
import { RomReader } from '../../game/rom/reader';
import type { GbaTextures } from '../gbaTextures';
import type { SpriteAtlas } from '../spriteAtlas';
import type { SpriteField } from '../actors/spriteField';
import type { Quality } from '../post';
import { safeLiveGridEvents, NO_EVENTS, type GridEvents } from '../kit/events';
import { MetatileAtlas } from './metatileAtlas';
import { World, type GridData, type WorldStyle } from './world';
import { analyzeMetatiles } from './tileInfo';
import type { SpriteClassifier } from '../../game/spriteKinds';
import { SYM } from '../../game/symbols';
import { Sky } from './sky';
import { Weather } from './weather';
import { createWorldMaterials } from './materials';
import { createKitUniforms, setKitActors, setKitFocus, type KitUniforms } from '../kit/materials';
import { ActorLayer, type ActorFrame } from '../actors/actorLayer';

export { hidesGrassOverlay } from '../actors/actorLayer';

export interface CameraPreset {
  name: string;
  pitch: number; // radians above horizontal
  distance: number;
  fov: number;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { name: 'Classic', pitch: 0.82, distance: 15, fov: 32 },
  { name: 'Close', pitch: 0.62, distance: 10.5, fov: 38 },
  { name: 'Wide', pitch: 0.95, distance: 23, fov: 30 },
  { name: 'Low', pitch: 0.36, distance: 9.5, fov: 45 },
];

/** Half-width of the sun shadow camera (world units): the map covers 2x this. */
const SHADOW_SPAN = 24;
/** Width of the shadows' soft edge on the ground (world units), the same at every quality. */
const SHADOW_SOFTNESS = 0.06;

/**
 * Sun shadow map size and PCF filter radius in texels (three's PCF samples a disc of shadow.radius
 * texels). Modern: by quality (low 1024, medium 2048, high 4096), the radius keeping the soft edge
 * as wide on the ground at every quality. Retro: the pre-Phase-1 shadows at every quality (2048,
 * three's default radius 1), so Retro looks as it did.
 */
export function shadowSettings(q: Quality, style: WorldStyle): { size: number; radius: number } {
  if (style === 'retro') return { size: 2048, radius: 1 };
  const size = q === 'low' ? 1024 : q === 'high' ? 4096 : 2048;
  return { size, radius: (SHADOW_SOFTNESS * size) / (2 * SHADOW_SPAN) };
}

const MAP_TYPE_INDOOR = 8;
const MAP_TYPE_UNDERGROUND = 4;
const MAP_TYPE_SECRET_BASE = 9;
const MAP_TYPE_UNDERWATER = 5;

export class OverworldView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(32, 1.5, 0.1, 500);
  readonly atlas: MetatileAtlas;
  private world: World;
  /** The world sprites: cards, blob shadows (inflated actors, object models). */
  private actors: ActorLayer;
  private sun = new THREE.DirectionalLight(0xffffff, 2.2);
  private hemi = new THREE.HemisphereLight(0xbfe3ff, 0x6b7f4a, 1.1);
  /** Light carried by the player in dark caves (Flash). */
  private lantern = new THREE.PointLight(0xffd9a0, 0, 10, 1.6);
  private sky: Sky;
  readonly weather = new Weather();
  readonly kitUniforms: KitUniforms = createKitUniforms();
  private opaqueMat: THREE.MeshStandardMaterial;
  private cutoutMat: THREE.MeshStandardMaterial;

  private gridKey = '';
  private lastGrid: Uint16Array | null = null;
  private haveWorld = false;
  private style: WorldStyle = 'modern';
  quality: Quality = 'medium';
  private shadowQuality: Quality = 'medium';
  private romReader: RomReader | null = null;
  private eventsCache: { key: string; events: GridEvents } = { key: '', events: NO_EVENTS };
  private eventsWarned = false;

  // camera rig state
  presetIndex = 0;
  yaw = 0;
  pitchOffset = 0;
  zoom = 1;
  private target = new THREE.Vector3();
  private targetValid = false;
  private lastPlayerWorld = new THREE.Vector3();
  private mapType = 0;
  private cave = 0;
  private charBase = 0;
  private time = 0;
  private cameraRight = new THREE.Vector3(1, 0, 0);
  /** When set (map preview), the camera follows this point instead of the player. */
  overrideTarget: THREE.Vector3 | null = null;
  /** When set (map preview `&focus=1`), the occlusion fade centres on this point instead of the player. */
  focusOverride: THREE.Vector3 | null = null;
  private bufferW = 1;
  private bufferH = 1;
  /** Sprite classifier (set once the ROM tables are readable). */
  classifier: SpriteClassifier | null = null;
  /** 0..1 progress of the battle-entry effect (pushes the camera in and twists it). */
  battleZoom = 0;
  private charLight = new THREE.Color(1, 1, 1);
  /** What the actor layer reads each frame (one object, updated in place). */
  private actorFrame: ActorFrame = {
    style: 'modern',
    classifier: null,
    heightAt: (x, y) => this.world.heightAt(x, y),
    hasGrassBlades: (x, y) => this.world.hasGrassBlades(x, y),
    cameraRight: this.cameraRight,
    charLight: this.charLight,
  };

  /** `field`: the sprite atlas's inflation field (Modern), kept up to date by the owner after each atlas bake. */
  constructor(private gbaTex: GbaTextures, spriteAtlas: SpriteAtlas, maxAnisotropy: number, field?: SpriteField) {
    this.atlas = new MetatileAtlas(gbaTex, maxAnisotropy);
    const mats = createWorldMaterials(this.atlas.target.texture, this.kitUniforms);
    this.opaqueMat = mats.opaque;
    this.cutoutMat = mats.cutout;
    this.world = new World(this.atlas, mats, this.kitUniforms);
    this.actors = new ActorLayer(spriteAtlas, { field });
    this.scene.add(this.world.group);
    this.scene.add(this.actors.group);

    this.sun.castShadow = true;
    this.applyShadowSettings();
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.left = -SHADOW_SPAN; sc.right = SHADOW_SPAN; sc.top = SHADOW_SPAN; sc.bottom = -SHADOW_SPAN; sc.near = 1; sc.far = 120;
    this.scene.add(this.sun, this.sun.target, this.hemi, this.lantern);
    this.sky = new Sky();
    this.scene.add(this.sky.mesh);
    this.scene.add(this.weather.group);
    this.scene.fog = new THREE.Fog(0xcfe8ff, 30, 70);
  }

  get presetName(): string {
    return CAMERA_PRESETS[this.presetIndex].name;
  }

  cyclePreset(): void {
    this.presetIndex = (this.presetIndex + 1) % CAMERA_PRESETS.length;
    this.pitchOffset = 0;
    this.zoom = 1;
  }

  get worldStyle(): WorldStyle {
    return this.style;
  }

  /** Sun shadow resolution and softness for a quality (Modern: low 1024, medium 2048, high 4096). */
  setShadowQuality(q: Quality): void {
    this.shadowQuality = q;
    this.applyShadowSettings();
  }

  private applyShadowSettings(): void {
    const { size, radius } = shadowSettings(this.shadowQuality, this.style);
    this.sun.shadow.radius = radius;
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /** Switches Modern/Retro (and their shadows); the world is rebuilt on the next sync. */
  setWorldStyle(s: WorldStyle): void {
    if (s === this.style) return;
    this.style = s;
    this.gridKey = '';
    this.applyShadowSettings();
  }

  /**
   * Warps and signs in backup-grid coordinates: the current map's and those in the strips of the
   * maps connected to it (cached per events table, connections table and layout). Never throws: on
   * a ROM whose tables do not read (an unrecognised one), the current map's or none, warned once.
   */
  private liveEvents(state: GameState): GridEvents {
    const h = state.header;
    const l = state.layout;
    if (!h || !l) return NO_EVENTS;
    const key = `${h.events}.${h.connections}.${h.layout}.${l.width}x${l.height}`;
    if (key !== this.eventsCache.key) {
      this.romReader ??= new RomReader(state.mem.bus.rom);
      const warn = (e: unknown) => {
        if (!this.eventsWarned) console.warn('[kit] map events unreadable (unrecognised ROM?); buildings get fewer cues', e);
        this.eventsWarned = true;
      };
      this.eventsCache = { key, events: safeLiveGridEvents(this.romReader, h.events, h.connections, l, MAP_OFFSET, warn) };
    }
    return this.eventsCache.events;
  }

  /** Builds the GridData for the current backup map. */
  private readGrid(state: GameState): GridData | null {
    if (!state.layout || state.backupWidth <= 0 || state.backupHeight <= 0) return null;
    const m = state.mem;
    const border: number[] = [];
    for (let i = 0; i < 4; i++) border.push(m.u16(state.layout.border + i * 2));
    return {
      width: state.backupWidth,
      height: state.backupHeight,
      cells: state.readBackupGrid(),
      border,
      borderW: 2,
      borderH: 2,
      borderPhase: 1,
    };
  }

  private gridChanged(grid: GridData): boolean {
    const last = this.lastGrid;
    if (!last || last.length !== grid.cells.length) return true;
    const a = new Uint32Array(last.buffer, 0, last.length >> 1);
    const b = new Uint32Array(grid.cells.buffer, 0, grid.cells.length >> 1);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
    return last[last.length - 1] !== grid.cells[grid.cells.length - 1];
  }

  /** Synchronises with the emulated state; call after each emulated frame. */
  sync(state: GameState, renderer: THREE.WebGLRenderer): void {
    if (!state.layout || !state.header) return;
    this.mapType = state.header.mapType;
    this.cave = state.header.cave;
    const m = state.mem;
    const tsChanged = this.atlas.setTilesets(m, state.layout.primaryTileset, state.layout.secondaryTileset);
    const bgcnt = m.bus.io16[0x0c >>> 1]; // BG2CNT
    this.charBase = ((bgcnt >>> 2) & 3) * 0x4000;

    const key = `${state.mapGroup}.${state.mapNum}.${state.header.layout}.${state.backupWidth}x${state.backupHeight}`;
    const grid = this.readGrid(state);
    if (grid && (key !== this.gridKey || tsChanged || this.gridChanged(grid))) {
      const mapChanged = key !== this.gridKey;
      const palOff = (SYM.gPlttBufferUnfaded & 0x3ffff) >>> 1;
      this.buildWorld(grid, m.bus, m.bus.ewram16.subarray(palOff, palOff + 256), state.layout.primaryTileset, this.liveEvents(state),
        state.layout.secondaryTileset, `${state.mapGroup}.${state.mapNum}`);
      this.lastGrid = grid.cells;
      this.gridKey = key;
      this.haveWorld = true;
      if (mapChanged) this.onMapChanged(state);
    }
    this.atlas.render(renderer, this.charBase);
  }

  /** Classifies a grid and rebuilds the world mesh (shared by live play and the map preview);
   *  `mapKey` ("group.num") names the map in the kit's warnings (once per map). */
  buildWorld(grid: GridData, bus: Bus, bgPalette: Uint16Array, primaryTileset: number, events: GridEvents = NO_EVENTS,
    secondaryTileset = 0, mapKey?: string): void {
    const info = analyzeMetatiles(bus, this.atlas.entries, this.atlas.attributes, this.charBase, bgPalette);
    this.world.build(grid, {
      info,
      generalPrimary: primaryTileset === SYM.gTileset_General,
      indoor: this.mapType === MAP_TYPE_INDOOR || this.mapType === MAP_TYPE_SECRET_BASE,
      underground: this.mapType === MAP_TYPE_UNDERGROUND,
      underwater: this.mapType === MAP_TYPE_UNDERWATER,
      secondaryTileset,
    }, { style: this.worldStyle, events, quality: this.quality, mapKey });
    this.haveWorld = true;
  }

  /** Static map preview: set tilesets/map type directly (no emulator state). */
  setStatic(mem: Mem, primary: number, secondary: number, mapType: number): void {
    this.mapType = mapType;
    this.charBase = 0;
    this.atlas.setTilesets(mem, primary, secondary);
  }

  renderAtlas(renderer: THREE.WebGLRenderer): void {
    this.atlas.render(renderer, this.charBase);
  }

  /** Ground height (world Y) under grid point (x, y) of the built world, where sprites stand. */
  heightAt(x: number, y: number): number {
    return this.world.heightAt(x, y);
  }

  private onMapChanged(state: GameState): void {
    // When crossing a map connection the backup-map origin shifts; move the camera
    // target by the same amount so the transition is seamless.
    const p = this.playerWorld(state);
    if (p && this.targetValid) {
      const jump = p.distanceTo(this.lastPlayerWorld);
      if (jump > 3) {
        this.target.add(p.clone().sub(this.lastPlayerWorld));
      }
    }
  }

  private spriteHeight(_state: GameState, _s: SpriteSnap, cellX: number, cellY: number): number {
    return this.world.heightAt(cellX + 0.5, cellY + 0.5);
  }

  private playerWorld(state: GameState): THREE.Vector3 | null {
    const p = state.player;
    if (!p) return null;
    const s = state.sprites.find((sp) => sp.index === p.spriteId);
    if (!s) return null;
    const fx = s.worldX / 16;
    const fy = s.worldY / 16 - 0.5;
    const h = this.spriteHeight(state, s, Math.floor(fx), Math.floor(fy));
    return new THREE.Vector3(fx, h, fy + h);
  }

  private updateLighting(state: GameState): void {
    const indoor = this.mapType === MAP_TYPE_INDOOR || this.mapType === MAP_TYPE_SECRET_BASE;
    const underground = this.mapType === MAP_TYPE_UNDERGROUND;
    const hour = state.hours + state.minutes / 60;
    const tod = indoor || underground ? 12 : hour;
    // Sun direction: rises in the east (+X), sets in the west; always somewhat south so
    // shadows fall "behind" objects like in the original art.
    const dayPhase = ((tod - 6) / 12) * Math.PI; // 0 at 6:00, PI at 18:00
    const elevation = Math.sin(dayPhase);
    const sunUp = Math.max(0.25, elevation);
    const dir = new THREE.Vector3(Math.cos(dayPhase) * 0.8, sunUp * 1.6 + 0.4, 0.9).normalize();
    this.sun.position.copy(this.target).addScaledVector(dir, 40);
    this.sun.target.position.copy(this.target);

    let sunColor = new THREE.Color(1.0, 0.97, 0.9);
    let sunI = 2.4;
    let skyColor = new THREE.Color(0.75, 0.88, 1.0);
    let groundColor = new THREE.Color(0.45, 0.5, 0.35);
    let hemiI = 1.15;
    let fog = new THREE.Color(0.8, 0.9, 1.0);

    if (indoor) {
      sunColor = new THREE.Color(1.0, 0.95, 0.85);
      sunI = 1.5;
      skyColor = new THREE.Color(1.0, 0.97, 0.92);
      groundColor = new THREE.Color(0.55, 0.5, 0.45);
      hemiI = 1.7;
      fog = new THREE.Color(0.02, 0.02, 0.03);
    } else if (underground) {
      sunColor = new THREE.Color(0.9, 0.85, 1.0);
      sunI = 1.1;
      skyColor = new THREE.Color(0.7, 0.72, 0.85);
      groundColor = new THREE.Color(0.35, 0.3, 0.3);
      hemiI = 1.5;
      fog = new THREE.Color(0.05, 0.04, 0.06);
    } else {
      // Blend keyframes over the day.
      const keys: [number, THREE.Color, number, THREE.Color, number, THREE.Color][] = [
        // hour, sunColor, sunI, sky, hemiI, fog
        [0, new THREE.Color(0.55, 0.65, 1.0), 0.55, new THREE.Color(0.25, 0.32, 0.6), 0.75, new THREE.Color(0.05, 0.07, 0.16)],
        [5, new THREE.Color(0.6, 0.65, 1.0), 0.6, new THREE.Color(0.3, 0.35, 0.62), 0.8, new THREE.Color(0.1, 0.12, 0.22)],
        [6.5, new THREE.Color(1.0, 0.7, 0.5), 1.6, new THREE.Color(0.85, 0.75, 0.8), 1.0, new THREE.Color(0.95, 0.75, 0.65)],
        [9, new THREE.Color(1.0, 0.95, 0.88), 2.4, new THREE.Color(0.75, 0.88, 1.0), 1.15, new THREE.Color(0.8, 0.9, 1.0)],
        [16, new THREE.Color(1.0, 0.95, 0.85), 2.3, new THREE.Color(0.75, 0.88, 1.0), 1.15, new THREE.Color(0.82, 0.9, 1.0)],
        [18, new THREE.Color(1.0, 0.52, 0.22), 2.0, new THREE.Color(1.0, 0.62, 0.45), 0.95, new THREE.Color(1.0, 0.55, 0.32)],
        [19.5, new THREE.Color(0.85, 0.45, 0.55), 0.9, new THREE.Color(0.55, 0.4, 0.65), 0.85, new THREE.Color(0.4, 0.25, 0.42)],
        [21, new THREE.Color(0.55, 0.65, 1.0), 0.55, new THREE.Color(0.25, 0.32, 0.6), 0.75, new THREE.Color(0.05, 0.07, 0.16)],
        [24, new THREE.Color(0.55, 0.65, 1.0), 0.55, new THREE.Color(0.25, 0.32, 0.6), 0.75, new THREE.Color(0.05, 0.07, 0.16)],
      ];
      let k = 0;
      while (k < keys.length - 2 && tod >= keys[k + 1][0]) k++;
      const [h0, sc0, si0, sk0, hi0, f0] = keys[k];
      const [h1, sc1, si1, sk1, hi1, f1] = keys[k + 1];
      const t = THREE.MathUtils.clamp((tod - h0) / (h1 - h0), 0, 1);
      sunColor = sc0.clone().lerp(sc1, t);
      sunI = si0 + (si1 - si0) * t;
      skyColor = sk0.clone().lerp(sk1, t);
      hemiI = hi0 + (hi1 - hi0) * t;
      fog = f0.clone().lerp(f1, t);
    }

    // Underwater (Dive): deep blue haze, dim cool light.
    if (this.mapType === MAP_TYPE_UNDERWATER) {
      sunColor = new THREE.Color(0.55, 0.8, 1.0);
      sunI = 1.2;
      skyColor = new THREE.Color(0.3, 0.6, 0.9);
      hemiI = 1.2;
      fog = new THREE.Color(0.05, 0.22, 0.42);
    }
    // Weather darkens and desaturates outdoor light.
    const w = state.weather;
    if (!indoor && (w === 3 || w === 5 || w === 13 || w === 11)) {
      const k = w === 13 ? 0.45 : w === 5 ? 0.55 : w === 11 ? 0.75 : 0.65;
      sunI *= k;
      fog.lerp(new THREE.Color(0.45, 0.5, 0.58), 0.6);
      skyColor.lerp(new THREE.Color(0.55, 0.6, 0.7), 0.5);
    } else if (!indoor && w === 12) {
      sunI *= 1.35;
      sunColor.lerp(new THREE.Color(1.0, 0.85, 0.6), 0.4);
    } else if (!indoor && (w === 6 || w === 9)) {
      fog.lerp(new THREE.Color(0.85, 0.88, 0.9), 0.7);
    } else if (!indoor && w === 8) {
      fog.lerp(new THREE.Color(0.85, 0.7, 0.45), 0.7);
      sunColor.lerp(new THREE.Color(1.0, 0.8, 0.55), 0.4);
    }

    // Window glow: fades in after sunset, out after sunrise (outdoors only).
    const nightK = indoor || underground ? 0 : THREE.MathUtils.clamp(Math.max((tod - 18.3) / 1.5, (6.2 - tod) / 1.2), 0, 1);
    this.kitUniforms.uNight.value = nightK;
    // Lightning flashes brighten everything for a moment.
    const flash = this.weather.flash;
    if (flash > 0) {
      hemiI += flash * 2.5;
      skyColor.lerp(new THREE.Color(0.9, 0.95, 1), flash * 0.6);
    }
    // Dark caves: the GBA draws a lit circle around the player whose radius depends on
    // flashLevel; here the world goes dark and the player carries a warm light.
    const FLASH_RADIUS = [200, 72, 64, 56, 48, 40, 32, 24, 0];
    if (state.flashLevel > 0) {
      const r = (FLASH_RADIUS[Math.min(8, state.flashLevel)] ?? 24) / 16;
      sunI *= 0.05;
      hemiI = 0.06;
      fog.setRGB(0, 0, 0);
      this.lantern.intensity = 40;
      this.lantern.distance = r * 1.9 + 1;
      this.lantern.position.copy(this.target).add(new THREE.Vector3(0, 1.6, 0.4));
    } else {
      this.lantern.intensity = 0;
    }
    this.sun.color.copy(sunColor);
    this.sun.intensity = sunI;
    this.hemi.color.copy(skyColor);
    this.kitUniforms.uSky.value.copy(skyColor).multiplyScalar(hemiI * 0.6);
    this.hemi.groundColor.copy(groundColor);
    this.hemi.intensity = hemiI;
    const fogObj = this.scene.fog as THREE.Fog;
    fogObj.color.copy(fog);
    const underwater = this.mapType === MAP_TYPE_UNDERWATER;
    const fogNear = indoor ? 18 : underwater ? 10 : (w === 6 || w === 9 || w === 8) ? 8 : 26;
    const fogFar = indoor ? 45 : underwater ? 38 : (w === 6 || w === 9 || w === 8) ? 32 : 64;
    fogObj.near = fogNear * this.zoom;
    fogObj.far = fogFar * this.zoom;
    this.sky.setColors(skyColor, fog, indoor || underground, this.time);
    // Characters are lit with a simplified model (no normal): ambient + part of the sun.
    // Characters are lit like a Lambert surface facing the camera: (ambient + part of the sun) / PI.
    const k = 1 / Math.PI;
    if (state.flashLevel > 0) {
      // Characters are drawn near the player's light.
      this.charLight.setRGB(0.85, 0.75, 0.6);
      return;
    }
    this.charLight.setRGB(
      (skyColor.r * hemiI + sunColor.r * sunI * 0.75) * k,
      (skyColor.g * hemiI + sunColor.g * sunI * 0.75) * k,
      (skyColor.b * hemiI + sunColor.b * sunI * 0.75) * k,
    );
  }

  /** Per displayed frame: camera smoothing, billboards, lights. */
  update(state: GameState, dt: number, input: { yaw: number; pitch: number; zoom: number }): void {
    this.time += dt;
    this.kitUniforms.uTime.value = this.time;
    if (!this.haveWorld) return;
    this.yaw += input.yaw;
    this.pitchOffset = THREE.MathUtils.clamp(this.pitchOffset + input.pitch, -0.5, 0.5);
    if (input.zoom) this.zoom = THREE.MathUtils.clamp(this.zoom * Math.pow(1.12, input.zoom), 0.45, 2.5);

    const p = this.overrideTarget ? this.overrideTarget.clone() : this.playerWorld(state);
    if (p) {
      if (!this.targetValid) {
        this.target.copy(p);
        this.targetValid = true;
      } else {
        const k = 1 - Math.exp(-dt * 10);
        this.target.lerp(p, k);
      }
      this.lastPlayerWorld.copy(p);
    } else if (state.cameraX) {
      // No player (cutscene): follow the GBA camera.
      const cx = state.cameraX / 16;
      const cz = state.cameraY / 16;
      this.target.lerp(new THREE.Vector3(cx, this.world.heightAt(cx, cz), cz), 1 - Math.exp(-dt * 6));
    }

    const preset = CAMERA_PRESETS[this.presetIndex];
    const pitch = THREE.MathUtils.clamp(preset.pitch + this.pitchOffset, 0.15, 1.45);
    const bz = this.battleZoom * this.battleZoom;
    const dist = preset.distance * this.zoom * (1 - 0.55 * bz);
    const look = this.target.clone().add(new THREE.Vector3(0, 0.9, 0));
    const yawFx = this.yaw + bz * 1.2;
    const offset = new THREE.Vector3(
      Math.sin(yawFx) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yawFx) * Math.cos(pitch),
    ).multiplyScalar(dist);
    this.camera.position.copy(look).add(offset);
    this.camera.fov = preset.fov;
    this.camera.lookAt(look);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    // Occlusion fade (Modern only): trees/roofs between the camera and the player dither out.
    const focus = this.focusOverride ?? (this.overrideTarget ? null : this.playerWorld(state));
    setKitFocus(this.kitUniforms, this.worldStyle === 'modern' ? focus : null, this.camera, this.bufferW, this.bufferH);
    this.cameraRight.set(Math.cos(yawFx), 0, -Math.sin(yawFx));

    this.updateLighting(state);
    this.actorFrame.style = this.worldStyle;
    this.actorFrame.classifier = this.classifier;
    // The feet of the upright sprites (characters, objects) and grass overlays bend the kit's grass.
    const feet = this.actors.update(state, this.actorFrame);
    setKitActors(this.kitUniforms, feet, this.target);
    this.world.treeCards?.setCameraRight(this.cameraRight);
    const indoorish = this.mapType === MAP_TYPE_INDOOR || this.mapType === MAP_TYPE_SECRET_BASE || this.mapType === MAP_TYPE_UNDERGROUND;
    this.weather.update(state.weather, indoorish, dt, this.target, this.cameraRight);
    this.sky.mesh.position.copy(this.camera.position);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Size in pixels of the render target the scene is drawn into (the occlusion fade works in its pixels). */
  setBufferSize(w: number, h: number): void {
    this.bufferW = w;
    this.bufferH = h;
  }

  render(r: THREE.WebGLRenderer): void {
    r.render(this.scene, this.camera);
  }
}

