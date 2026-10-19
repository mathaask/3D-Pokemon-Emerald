// Static 3D map viewer: renders any map straight from the ROM through the same
// pipeline as live play (no emulator). Used for tuning the 3D reconstruction.
//   /?map=0.9            Littleroot Town      (&hour=18 for evening, &weather=3 for rain)

import * as THREE from 'three';
import { Bus } from '../gba/bus';
import { Mem } from '../game/mem';
import type { GameState } from '../game/state';
import { RomReader } from '../game/rom/reader';
import { loadMap } from '../game/rom/maps';
import { loadTileset } from '../game/rom/tileset';
import { GbaTextures } from './gbaTextures';
import { SpriteAtlas } from './spriteAtlas';
import { OverworldView } from './overworld/overworldView';
import { PostFX, type Quality } from './post';
import type { GridData } from './overworld/world';
import { gridEvents } from './kit/events';

export class PreviewApp {
  readonly webgl: THREE.WebGLRenderer;
  private view: OverworldView;
  private post: PostFX;
  private fakeState: GameState;
  private target = new THREE.Vector3();
  private keys = new Set<string>();
  private last = performance.now();
  private yaw = 0;
  private pitch = 0;
  private zoom = 0;
  private buildMs = 0;
  readonly name: string;

  constructor(canvas: HTMLCanvasElement, rom: Uint8Array, group: number, num: number, params: URLSearchParams) {
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.shadowMap.enabled = true;
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
    const tex = new GbaTextures(bus);
    tex.paletteSource = palette;
    tex.update(true);

    const quality = (params.get('quality') as Quality) ?? 'medium';
    this.view = new OverworldView(tex, new SpriteAtlas(tex), this.webgl.capabilities.getMaxAnisotropy());
    this.view.quality = quality;
    this.view.worldStyle = params.get('style') === 'retro' ? 'retro' : 'modern';
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
    const t0 = performance.now();
    this.view.buildWorld(grid, bus, palette.subarray(0, 256), map.layout.primaryTileset, gridEvents(map.events, 0), map.layout.secondaryTileset);
    this.buildMs = performance.now() - t0;

    const hour = parseFloat(params.get('hour') ?? '11');
    this.fakeState = {
      hours: Math.floor(hour), minutes: Math.round((hour % 1) * 60), weather: parseInt(params.get('weather') ?? '0', 10),
      sprites: [], objects: [], player: null, cameraX: 0, cameraY: 0, flashLevel: parseInt(params.get('flash') ?? '0', 10),
    } as unknown as GameState;
    const cx = parseFloat(params.get('x') ?? String(map.layout.width / 2));
    const cy = parseFloat(params.get('y') ?? String(map.layout.height / 2));
    this.target.set(cx, 0, cy);
    this.view.overrideTarget = this.target;
    if (params.has('focus')) this.view.focusOverride = this.target;
    this.yaw = parseFloat(params.get('yaw') ?? '0');
    this.zoom = parseFloat(params.get('zoom') ?? '0');
    if (params.has('preset')) this.view.presetIndex = parseInt(params.get('preset')!, 10);

    this.post = new PostFX(this.webgl, this.view.scene, this.view.camera, quality);
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
    this.resize();
    const tick = () => {
      this.frame();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  private resize(): void {
    this.webgl.setSize(window.innerWidth, window.innerHeight, false);
    const size = this.webgl.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(size.x, size.y);
    this.view.resize(window.innerWidth / window.innerHeight);
    // Fade pixels = the composer's scene target (EffectComposer applies the pixel ratio again).
    const rt = this.post.composer.renderTarget1;
    this.view.setBufferSize(rt.width, rt.height);
  }

  /** Render statistics of the last frame (all passes) and the last world build time. */
  stats(): { calls: number; triangles: number; buildMs: number } {
    const r = this.webgl.info.render;
    return { calls: r.calls, triangles: r.triangles, buildMs: Math.round(this.buildMs) };
  }

  private frame(): void {
    this.webgl.info.reset();
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const speed = 12 * dt;
    const fwd = new THREE.Vector3(-Math.sin(this.view.yaw), 0, -Math.cos(this.view.yaw));
    const right = new THREE.Vector3(Math.cos(this.view.yaw), 0, -Math.sin(this.view.yaw));
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) this.target.addScaledVector(fwd, speed);
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) this.target.addScaledVector(fwd, -speed);
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) this.target.addScaledVector(right, -speed);
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) this.target.addScaledVector(right, speed);
    this.view.renderAtlas(this.webgl);
    this.view.update(this.fakeState, dt, { yaw: this.yaw, pitch: this.pitch, zoom: this.zoom });
    this.yaw = this.pitch = this.zoom = 0;
    this.post.render(dt);
  }
}
