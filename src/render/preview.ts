// Static 3D map viewer: renders any map straight from the ROM through the same
// pipeline as live play (no emulator). Used for tuning the 3D reconstruction.
//   /?map=0.9            Littleroot Town      (&hour=18 for evening, &weather=3 for rain)
//   &x=..&y=..&h=..      look at cell (x, y) standing at height h (default 0)
//   &actors=1            the map's object events (NPCs, items, rocks, berry trees…) from their ROM
//                        templates, through the live sprite atlas and billboards (&removing=1: Cut
//                        trees and rocks on their breaking anim)
//   &focusGfx=G / &focusObj=N   look at the first template with graphics id G / at template N
//   &manual=1            no frame loop: frames advance through preview.frames(n) (1/60 s each)

import * as THREE from 'three';
import { Bus } from '../gba/bus';
import { Mem } from '../game/mem';
import type { GameState } from '../game/state';
import { RomReader } from '../game/rom/reader';
import { loadMap, type ObjectEventTemplate } from '../game/rom/maps';
import { loadTileset } from '../game/rom/tileset';
import { GbaTextures } from './gbaTextures';
import { SpriteAtlas } from './spriteAtlas';
import { OverworldView } from './overworld/overworldView';
import { PostFX, tiltShiftFor, type Quality } from './post';
import type { GridData } from './overworld/world';
import { gridEvents } from './kit/events';
import { buildPreviewActors } from './previewActors';
import { timeGpuFrames, type GpuTiming } from './gpuTiming';
import { SpriteField } from './actors/spriteField';
import { fieldDump, fieldSelfTest, type FieldSelfTest } from './actors/selfTest';

export class PreviewApp {
  readonly webgl: THREE.WebGLRenderer;
  private view: OverworldView;
  private spriteAtlas: SpriteAtlas;
  /** Inflation field of the sprite atlas (Modern, with actors). */
  private spriteField = new SpriteField();
  private post: PostFX;
  private fakeState: GameState;
  /** Object events drawn (&actors=1): the sprite atlas is baked every frame. */
  private actors = false;
  /** Set when &focusObj / &focusGfx names no template (the harness fails such an entry). */
  focusError: string | null = null;
  private target = new THREE.Vector3();
  private keys = new Set<string>();
  private last = performance.now();
  private yaw = 0;
  private pitch = 0;
  private zoom = 0;
  private buildMs = 0;
  /** Rebuilds the world (as crossing a map connection does, with warm code); returns the time in ms. */
  readonly rebuild: () => number;
  readonly name: string;

  constructor(canvas: HTMLCanvasElement, rom: Uint8Array, group: number, num: number, params: URLSearchParams) {
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.shadowMap.enabled = true;
    // (three r186 removed PCFSoftShadowMap: the sun's shadow.radius softens PCF, per quality)
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.webgl.toneMapping = THREE.NeutralToneMapping;
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.info.autoReset = false;

    const reader = new RomReader(rom);
    const map = loadMap(reader, group, num);
    this.name = map.name;
    const primary = loadTileset(reader, map.layout.primaryTileset);
    const secondary = loadTileset(reader, map.layout.secondaryTileset);

    // Scratch "hardware": tiles in BG VRAM (primary at tile 0, secondary at tile 512), palettes 0-12.
    const bus = new Bus(rom);
    bus.vram.set(primary.tiles.subarray(0, 0x4000), 0);
    bus.vram.set(secondary.tiles.subarray(0, 0x4000), 0x4000);
    const palette = new Uint16Array(512);
    palette.set(primary.palettes.subarray(0, 6 * 16), 0);
    palette.set(secondary.palettes.subarray(6 * 16, 13 * 16), 6 * 16);
    palette[0] = 0;
    // object events: their tiles into OBJ VRAM, their palettes into OBJ palettes 0-15
    this.actors = params.get('actors') === '1';
    const actors = this.actors
      ? buildPreviewActors(reader, bus.vram, palette, map.events.objects, { removing: params.get('removing') === '1' })
      : { sprites: [], objects: [] };
    for (const o of actors.objects) {
      o.mapGroup = group;
      o.mapNum = num;
    }
    const tex = new GbaTextures(bus);
    tex.paletteSource = palette;
    tex.update(true);

    const quality = (params.get('quality') as Quality) ?? 'medium';
    this.spriteAtlas = new SpriteAtlas(tex);
    this.view = new OverworldView(tex, this.spriteAtlas, this.webgl.capabilities.getMaxAnisotropy(), this.spriteField);
    this.view.quality = quality;
    this.view.setShadowQuality(quality);
    this.view.setWorldStyle(params.get('style') === 'retro' ? 'retro' : 'modern');
    const mem = new Mem(bus);
    this.view.setStatic(mem, map.layout.primaryTileset, map.layout.secondaryTileset, map.mapType);
    const grid: GridData = {
      width: map.layout.width,
      height: map.layout.height,
      cells: map.layout.grid,
      border: [...map.layout.border],
      borderW: 2,
      borderH: 2,
      borderPhase: 0,
    };
    this.view.renderAtlas(this.webgl);
    this.rebuild = () => {
      const t0 = performance.now();
      this.view.buildWorld(grid, bus, palette.subarray(0, 256), map.layout.primaryTileset, gridEvents(map.events, 0), map.layout.secondaryTileset,
        `${group}.${num}`);
      return performance.now() - t0;
    };
    // (the first build in the page: cold code, an upper bound of a rebuild)
    this.buildMs = this.rebuild();

    const hour = parseFloat(params.get('hour') ?? '11');
    this.fakeState = {
      hours: Math.floor(hour), minutes: Math.round((hour % 1) * 60), weather: parseInt(params.get('weather') ?? '0', 10),
      sprites: actors.sprites, objects: actors.objects, player: null, cameraX: 0, cameraY: 0,
      flashLevel: parseInt(params.get('flash') ?? '0', 10),
    } as unknown as GameState;
    const focus = this.focusTemplate(map.events.objects, params);
    if (focus) {
      // an object's card stands on its cell centre, on the ground there
      const h = this.view.heightAt(focus.x + 0.5, focus.y + 0.5);
      this.target.set(focus.x + 0.5, h, focus.y + 0.5 + h);
    } else {
      const cx = parseFloat(params.get('x') ?? String(map.layout.width / 2));
      const cy = parseFloat(params.get('y') ?? String(map.layout.height / 2));
      const ch = parseFloat(params.get('h') ?? '0');
      this.target.set(cx, ch, cy + ch); // (grid (x, y) at height h is world (x, h, y + h))
    }
    this.view.overrideTarget = this.target;
    if (params.has('focus')) this.view.focusOverride = this.target;
    this.yaw = parseFloat(params.get('yaw') ?? '0');
    this.zoom = parseFloat(params.get('zoom') ?? '0');
    if (params.has('preset')) this.view.presetIndex = parseInt(params.get('preset')!, 10);

    this.post = new PostFX(this.webgl, this.view.scene, this.view.camera, quality);
    const tilt = tiltShiftFor(this.view.worldStyle);
    this.post.setTiltShift(tilt.focus, tilt.band, tilt.strength);
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    let drag = false, lx = 0, ly = 0;
    canvas.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('pointerup', () => { drag = false; });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw += (e.clientX - lx) * 0.005;
      this.pitch += (e.clientY - ly) * 0.004;
      lx = e.clientX; ly = e.clientY;
    });
    canvas.addEventListener('wheel', (e) => { this.zoom += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    window.addEventListener('resize', () => this.resize());
    canvas.addEventListener('webglcontextrestored', () => this.view.atlas.invalidate());
    this.resize();
    if (params.get('manual') === '1') return; // (frames advance through frames(n) only)
    const tick = () => {
      this.frame();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** The template named by &focusObj=N (index) or &focusGfx=G (first with graphics id G), if any.
   *  One that names no template sets focusError (the view falls back to x / y or the map centre). */
  private focusTemplate(templates: readonly ObjectEventTemplate[], params: URLSearchParams): ObjectEventTemplate | null {
    const obj = params.get('focusObj');
    const gfx = params.get('focusGfx');
    const t = obj !== null ? templates[Number(obj)]
      : gfx !== null ? templates.find((e) => e.graphicsId === Number(gfx)) : undefined;
    if ((obj !== null || gfx !== null) && !t) {
      this.focusError = `no object template for ${obj !== null ? `focusObj=${obj}` : `focusGfx=${gfx}`} (${templates.length} templates)`;
      console.warn(`[preview] ${this.focusError}`);
    }
    return t ?? null;
  }

  /** Renders n frames at a fixed 1/60 s each (deterministic: the harness's manual mode). */
  frames(n: number): void {
    for (let i = 0; i < n; i++) this.frame(1 / 60);
  }

  /** Times n frames (as frames(1) each) on the GPU: timer queries, medians (as emu.gpuFrames). */
  gpuFrames(n: number): Promise<GpuTiming> {
    return timeGpuFrames(this.webgl.getContext() as WebGL2RenderingContext, n, () => this.frame(1 / 60));
  }

  /** The field is computed in Modern with actors only: the self-test and the dump need it current. */
  private checkFieldLive(): void {
    if (!this.actors || this.view.worldStyle !== 'modern') {
      throw new Error('the inflation field is computed in Modern with &actors=1 only');
    }
  }

  /** Inflation-field self-test (as emu.selfTest): the last frame's field vs the CPU reference of its atlas. */
  selfTest(): Promise<FieldSelfTest> {
    this.checkFieldLive();
    return fieldSelfTest(this.webgl, this.spriteAtlas, this.spriteField);
  }

  /** The used slots of the inflation field as a grey PNG data URL (as emu.fieldDump). */
  fieldDump(): string {
    this.checkFieldLive();
    return fieldDump(this.webgl, this.spriteAtlas, this.spriteField);
  }

  private resize(): void {
    this.webgl.setSize(window.innerWidth, window.innerHeight, false);
    const size = this.webgl.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(size.x, size.y);
    this.view.resize(window.innerWidth / window.innerHeight);
    // the occlusion fade works in pixels of the target the scene is drawn into
    const t = this.post.sceneTargetSize(size);
    this.view.setBufferSize(t.x, t.y);
  }

  /**
   * What crossing a map connection costs: a warm rebuild, then the first frame drawn after it
   * (synchronised with the GPU), where new shader programs and uploads land. Times in ms.
   */
  measureRebuild(): { buildMs: number; firstFrameMs: number } {
    const buildMs = this.rebuild();
    const t0 = performance.now();
    this.frame();
    const gl = this.webgl.getContext();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4)); // (waits for the GPU)
    return { buildMs, firstFrameMs: performance.now() - t0 };
  }

  /** Render statistics of the last frame (all passes), the shader programs and the last world build time. */
  stats(): { calls: number; triangles: number; programs: number; buildMs: number } {
    const info = this.webgl.info;
    return { calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length ?? 0, buildMs: Math.round(this.buildMs) };
  }

  /** One frame; `fixedDt` (seconds) replaces the wall-clock time step. */
  private frame(fixedDt?: number): void {
    this.webgl.info.reset();
    const now = performance.now();
    const dt = fixedDt ?? Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const speed = 12 * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.view.yaw), 0, -Math.cos(this.view.yaw));
    const right = new THREE.Vector3(Math.cos(this.view.yaw), 0, -Math.sin(this.view.yaw));
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.target.addScaledVector(fwd, speed);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.target.addScaledVector(fwd, -speed);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.target.addScaledVector(right, -speed);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.target.addScaledVector(right, speed);
    this.view.renderAtlas(this.webgl);
    // object sprites use 1D tile mapping (DISPCNT bit 6 set in the field)
    if (this.actors) {
      this.spriteAtlas.update(this.webgl, this.fakeState.sprites, false);
      // the inflation field of this same atlas, as live play (Retro draws cards only)
      if (this.view.worldStyle === 'modern') {
        this.spriteField.update(this.webgl, this.spriteAtlas.target.texture, this.spriteAtlas.slotRects, this.spriteAtlas.slotCount);
      }
    }
    this.view.update(this.fakeState, dt, { yaw: this.yaw, pitch: this.pitch, zoom: this.zoom });
    this.yaw = this.pitch = this.zoom = 0;
    this.post.render(dt);
  }
}
