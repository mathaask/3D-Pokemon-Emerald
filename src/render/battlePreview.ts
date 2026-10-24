// Static battle preview: any arena kind with any battlers, straight from the ROM, through the live battle path (no
// emulator). The kind's BG3 picture and the battlers' pictures are laid into scratch "hardware" (VRAM, palette RAM, the
// game's unfaded palette buffer, DISPCNT / BG3CNT) exactly as the game lays them out in battle, and a fake game state
// (exactly the fields BattleView reads) drives the live BattleView; referencePng() is the GBA's own picture of the same
// hardware (BG3 + the battler sprites). Every battle program is compiled before the first frame (BattleView.precompile).
//   /?battle=<kind>          an ArenaKind (arenaKind.ts: grass … rayquaza)
//   &player=<species>&enemy=<species>   internal species ids (include/constants/species.h); Torchic vs Zigzagoon
//   &double=1&player2=…&enemy2=…        a double battle: four battlers (positions 0–3)
//   &hour=11 &style=modern|retro &quality=low|medium|high &yaw=<rad> (once, on the first frame)
//   (a value that does not parse falls back to the default: a species not a non-negative integer, an hour outside 0–24,
//   an unknown quality, a yaw not a number; a species past the ROM's picture tables throws readMonPic's RomError)
//   &arenaFail=<part>        that Modern arena part throws: the battle falls back to today's arena (BattleView.arenaFailPart)
//   &spriteFilter=smooth|pixel   the Modern inflated battlers' sprite edges (default HD smooth; cards are unaffected)
//   &actorUniforms=0|1       the inflated battlers' instance data from attributes / the uniform array (default: by device)
//   &manual=1                no frame loop: frames advance through preview.frames(n) (1/60 s each)
// Drag turns the camera (±0.9 rad, as live play's), the wheel zooms.

import * as THREE from 'three';
import { Bus } from '../gba/bus';
import { Mem } from '../game/mem';
import { SYM } from '../game/symbols';
import type { SpriteSnap } from '../game/state';
import { RomReader } from '../game/rom/reader';
import {
  installBattleBackground, readBattleBackground, readMonPic, readEnemyShadow, battlerScreenPos, type MonPic,
} from '../game/rom/battleGraphics';
import { arenaInputsFor, type ArenaKind } from './battle/arenaKind';
import { decodeBg3, BG_W, BG_H } from './battle/bgSample';
import { BattleView, type BattleViewState } from './battle/battleView';
import { GbaTextures, bgr555ToRgba } from './gbaTextures';
import { SpriteAtlas } from './spriteAtlas';
import { PostFX, tiltShiftFor, type Quality } from './post';
import type { WorldStyle } from './overworld/world';
import { blankSprite } from './previewActors';
import { timeGpuFrames, type GpuTiming } from './gpuTiming';
import { instanceUniformsFit } from './actors/inflatedActors';
import { parseSpriteFilter } from './actors/actorLayer';
import { fieldDump, actorSelfTest, type ActorSelfTest } from './actors/selfTest';

export interface PreviewBattler { pic: MonPic; position: number }   // B_POSITION_* 0..3 (even: player side)

const OBJ_VRAM = 0x10000;
const TILE_BYTES = 32;
const OBJ_PALETTE = 256;
/** Tiles per battler picture (64×64, 4bpp) and the shadow's OBJ palette slot (after the four battlers'). */
const BATTLER_TILES = 64;
const SHADOW_PALETTE = 4;
/** GetBattlerSpriteSubpriority: player left and opponent right 30, the others 40 (lower: in front). */
const SUBPRIORITY = [30, 40, 40, 30];
/** OAM priority of the battler sprites (2) and the shadow (sOamData_EnemyShadow: 3). */
const BATTLER_PRIORITY = 2;
const SHADOW_PRIORITY = 3;
/** LoadAndCreateEnemyShadowSprites: the shadow's centre is GetBattlerSpriteCoord(X, Y + 29); subpriority 0xC8. */
const SHADOW_DY = 29;
const SHADOW_SUBPRIORITY = 0xc8;
/** DISPCNT in battle (mode 0, OBJ 1D mapping, BG0–3 and OBJ on, windows), as live battles. */
const DISPCNT_BATTLE = 0xbf40;
/** gBattleTypeFlags BATTLE_TYPE_DOUBLE (include/constants/battle.h). */
const BATTLE_TYPE_DOUBLE = 1 << 0;
/** BG palette 0 colour 0, the backdrop where every layer is transparent (BG3's text-box rows): in battle the text box
 *  palette's colour 0 (LoadCompressedPalette(gBattleTextboxPalette, BG_PLTT_ID(0), …)), black — 0x0000 in every live
 *  battle state (battle1, fuzz, wild_transition). */
const BACKDROP = 0x0000;
const PAL_UNFADED = (SYM.gPlttBufferUnfaded & 0x3ffff) >> 1;
/** A picture with no offsets: battlerScreenPos of it is sBattlerCoords[double][position] − 32. */
const NO_OFFSET: MonPic = { tiles: new Uint8Array(0), palette: new Uint16Array(0), yOffset: 0, elevation: 0 };
const DEFAULT_SPECIES = { player: 280, enemy: 288, player2: 277, enemy2: 286 }; // Torchic, Zigzagoon, Treecko, Poochyena
const DEFAULT_HOUR = 11;

/** The battlers' sprites as the game creates them (gMultiuseSpriteTemplate, 64×64 affine OAM, 4bpp, 1D tiles: battler i
 *  at tile 64·i, OBJ palette slot = its position) and, under a floating enemy at position 1 (elevation > 0), the shadow
 *  sprite (gSpriteTemplate_EnemyShadow, 32×8, top-left (160, 65) in singles, tiles after the battlers, palette slot 4).
 *  (In a double battle the opponent at position 3 gets its own shadow too, as LoadAndCreateEnemyShadowSprites and
 *  SetBattlerShadowSpriteCallback do; both shadows share the one sheet and palette.) */
export function previewBattleSprites(battlers: readonly PreviewBattler[], double: boolean): SpriteSnap[] {
  const sprites: SpriteSnap[] = battlers.map((b, i) => {
    const { x: screenX, y: screenY } = battlerScreenPos(b.pic, b.position, double);
    return blankSprite({
      index: i, template: SYM.gMultiuseSpriteTemplate, width: 64, height: 64, tileNum: BATTLER_TILES * i,
      palette: b.position, affine: true, coordOffset: false, screenX, screenY,
      // (the sprite's position: its centre, as gSprites holds it)
      x: screenX + 32, y: screenY + 32, priority: BATTLER_PRIORITY, subpriority: SUBPRIORITY[b.position & 3],
    });
  });
  battlers.forEach((b, i) => {
    if (!(b.position & 1) || b.pic.elevation <= 0) return;
    const c = battlerScreenPos(NO_OFFSET, b.position, double);
    const x = c.x + 32, y = c.y + 32 + SHADOW_DY;
    const data = new Int16Array(8);
    data[0] = i; // tBattlerId
    sprites.push(blankSprite({
      index: sprites.length, template: SYM.gSpriteTemplate_EnemyShadow, width: 32, height: 8,
      tileNum: BATTLER_TILES * battlers.length, palette: SHADOW_PALETTE, affine: false, coordOffset: false,
      x, y, screenX: x - 16, screenY: y - 4, priority: SHADOW_PRIORITY, subpriority: SHADOW_SUBPRIORITY, data,
    }));
  });
  return sprites;
}

/** A species id of the URL (a non-negative integer), else the default — as &quality / &yaw fall back. (One past the ROM's
 *  picture tables still throws: readMonPic's RomError.) */
function species(params: URLSearchParams, key: keyof typeof DEFAULT_SPECIES): number {
  const v = params.get(key);
  return v !== null && /^\d+$/.test(v) ? Number(v) : DEFAULT_SPECIES[key];
}

/** The hour of the URL (0 ≤ h < 24), else 11 — as &quality / &yaw fall back. */
function hourOf(params: URLSearchParams): number {
  const h = parseFloat(params.get('hour') ?? '');
  return Number.isFinite(h) && h >= 0 && h < 24 ? h : DEFAULT_HOUR;
}

export class BattlePreviewApp {
  readonly webgl: THREE.WebGLRenderer;
  /** The map preview's focus check: there is no focus here (the harness's static path reads it). */
  focusError: string | null = null;
  readonly kind: ArenaKind;
  private bus: Bus;
  private bgcnt: number;
  private tex: GbaTextures;
  private spriteAtlas: SpriteAtlas;
  private battle: BattleView;
  private post: PostFX;
  private state: BattleViewState;
  private hud: SpriteSnap[] = [];
  /** Camera input of the next frame: per-frame deltas, as live play's (BattleView adds yaw, scales zoom by 1.1^zoom). */
  private input = { yaw: 0, pitch: 0, zoom: 0 };
  private last = performance.now();
  /** ROM decode, scratch hardware and battle view construction (ms). */
  private buildMs: number;

  constructor(canvas: HTMLCanvasElement, rom: Uint8Array, kind: ArenaKind, params: URLSearchParams) {
    const t0 = performance.now();
    this.kind = kind;
    // as the live Renderer's
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.webgl.toneMapping = THREE.NeutralToneMapping;
    this.webgl.toneMappingExposure = 1.0;
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.info.autoReset = false;

    const reader = new RomReader(rom);
    const double = params.get('double') === '1';
    const roster = double ? [species(params, 'player'), species(params, 'enemy'), species(params, 'player2'), species(params, 'enemy2')]
      : [species(params, 'player'), species(params, 'enemy')];
    // player side (even positions): back pictures; opponents: front pictures
    const battlers: PreviewBattler[] = roster.map((s, position) => ({ pic: readMonPic(reader, s, position & 1 ? 'front' : 'back'), position }));
    const sprites = previewBattleSprites(battlers, double);

    // Scratch hardware, laid out as the game does in battle: BG3 (tiles, tilemap, BG palettes 2–4, BG3CNT), OBJ tiles in
    // 1D order from 0x10000, battler palettes in OBJ slots 0–3, the shadow's in slot 4. Every palette is also written into
    // the game's unfaded palette buffer (gPlttBufferUnfaded), where BattleView samples the background.
    const bus = this.bus = new Bus(rom);
    const pal = new Uint16Array(512);
    pal[0] = BACKDROP;
    this.bgcnt = installBattleBackground(readBattleBackground(reader, kind), bus.vram, pal);
    bus.io16[0x0e >> 1] = this.bgcnt;
    bus.io16[0] = DISPCNT_BATTLE;
    const shadow = sprites.length > battlers.length ? readEnemyShadow(reader) : null;
    for (const s of sprites) {
      const art = s.template === SYM.gSpriteTemplate_EnemyShadow ? shadow! : battlers[s.index].pic;
      bus.vram.set(art.tiles, OBJ_VRAM + s.tileNum * TILE_BYTES);
      pal.set(art.palette, OBJ_PALETTE + s.palette * 16);
    }
    bus.pram16.set(pal);
    bus.ewram16.set(pal, PAL_UNFADED);

    const inputs = arenaInputsFor(kind);
    const hour = hourOf(params);
    // (exactly what BattleView reads: reading more fails to typecheck here)
    this.state = {
      mem: new Mem(bus), sprites, battleEnvironment: inputs.environment,
      battleType: inputs.battleType | (double ? BATTLE_TYPE_DOUBLE : 0), trainerClass: inputs.trainerClass,
      mapBattleScene: inputs.mapBattleScene, mapType: inputs.mapType,
      hours: Math.floor(hour), minutes: Math.round((hour % 1) * 60), animActive: false, target: 0,
      battlerCopies: [],
    } satisfies BattleViewState;

    // the live battle path: hardware palette RAM (paletteSource null), the sprite atlas (1D tiles), the BattleView (the
    // arenas of both styles) and PostFX on the battle scene
    this.tex = new GbaTextures(bus);
    this.tex.update(true);
    this.spriteAtlas = new SpriteAtlas(this.tex);
    // (the inflated battlers' instance data: as live play's, by device; &actorUniforms=0|1)
    this.battle = new BattleView(this.spriteAtlas,
      { instanceUniforms: instanceUniformsFit(this.webgl.capabilities.maxVertexUniforms, params.get('actorUniforms')) });
    this.battle.setSpriteFilter(parseSpriteFilter(params.get('spriteFilter')) ?? 'smooth');
    const q = params.get('quality');
    const quality: Quality = q === 'low' || q === 'high' ? q : 'medium';
    this.battle.quality = quality;
    // &arenaFail=<name>: that arena part throws (the fallback to today's arena)
    this.battle.arenaFailPart = params.get('arenaFail');
    this.post = new PostFX(this.webgl, this.battle.scene, this.battle.camera, quality);
    this.setStyle(params.get('style') === 'retro' ? 'retro' : 'modern');
    // &yaw: once, on the first frame (BattleView.update takes per-frame deltas)
    const yaw = parseFloat(params.get('yaw') ?? '0');
    this.input.yaw = Number.isFinite(yaw) ? yaw : 0;
    this.buildMs = performance.now() - t0;

    let drag = false, lx = 0;
    canvas.addEventListener('pointerdown', (e) => { drag = true; lx = e.clientX; });
    window.addEventListener('pointerup', () => { drag = false; });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.input.yaw += (e.clientX - lx) * 0.005;
      lx = e.clientX;
    });
    canvas.addEventListener('wheel', (e) => { this.input.zoom += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    // every battle program compiled before the first frame, as live play's boot does (the precompile frame blocks until
    // they are ready: deterministic program counts)
    this.battle.precompileFrame = () => this.post.render(0);
    this.battle.finishPrecompile(this.webgl);
    if (params.get('manual') === '1') return; // (frames advance through frames(n) only)
    const tick = () => {
      this.frame();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  /** The battle's world style: the arena the style draws (BattleView) and the style's tilt-shift, as in live play
   *  (Renderer.setWorldStyle sets both views' styles and the PostFX both scenes share). */
  setStyle(s: WorldStyle): void {
    this.battle.setWorldStyle(s);
    const t = tiltShiftFor(s);
    this.post.setTiltShift(t.focus, t.band, t.strength);
  }

  /** Renders n frames at a fixed 1/60 s each (deterministic: the harness's manual mode). */
  frames(n: number): void {
    for (let i = 0; i < n; i++) this.frame(1 / 60);
  }

  /** Renders one frame without advancing time (the harness's actor-mask shot matches the last frame). */
  renderStill(): void {
    this.frame(0);
  }

  /** Draws the battle actors (cards, decals, inflated battlers) flat magenta (the harness's visible-actor mask) or
   *  normally. */
  setActorMask(on: boolean): void {
    this.battle.setActorMask(on);
  }

  /** Modern's inflated battlers on or off (every sprite a card, as in Retro: the harness's `--ab-feature battlers`
   *  baseline); from the next frame. */
  setInflation(on: boolean): void {
    this.battle.inflation = on;
  }

  /** The battlers' field is computed in Modern with inflation on only: the self-test and the dump need it current. */
  private checkFieldLive(): void {
    if (!this.battle.fieldLive) {
      throw new Error(`the battlers' inflation field is computed in Modern with inflation on only (now: ${this.battle.worldStyle}, inflation ${this.battle.inflation})`);
    }
  }

  /** Actor self-test (as emu.selfTest): the last frame's battle field vs the CPU reference of its atlas, and the xBR
   *  shader vs its CPU reference on a fixture. */
  selfTest(): Promise<ActorSelfTest> {
    this.checkFieldLive();
    return actorSelfTest(this.webgl, this.spriteAtlas, this.battle.field, this.battle.fieldSlots);
  }

  /** The used slots of the battle field as a grey PNG data URL (as emu.fieldDump). */
  fieldDump(): string {
    this.checkFieldLive();
    return fieldDump(this.webgl, this.spriteAtlas, this.battle.field);
  }

  /** Times n frames (as frames(1) each) on the GPU: timer queries, medians (as emu.gpuFrames). */
  gpuFrames(n: number): Promise<GpuTiming> {
    return timeGpuFrames(this.webgl.getContext() as WebGL2RenderingContext, n, () => this.frame(1 / 60));
  }

  /** The Modern arena's warm build time (the arena build gate: median ≤ 60 ms): `runs` rebuilds, each with a fresh colour
   *  key, after one untimed rebuild (BattleView.measureArenaBuild); the arena is built back afterwards. ms per run and
   *  their median. */
  measureArenaBuild(runs = 5): { ms: number[]; median: number } {
    const ms = this.battle.measureArenaBuild(runs).map((v) => Math.round(v * 100) / 100);
    const sorted = [...ms].sort((a, b) => a - b);
    return { ms, median: sorted[Math.floor(sorted.length / 2)] };
  }

  /** Render statistics of the last frame (all passes), the shader programs and the preview's setup time. */
  stats(): { calls: number; triangles: number; programs: number; buildMs: number } {
    const info = this.webgl.info;
    return { calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length ?? 0, buildMs: Math.round(this.buildMs) };
  }

  /** The GBA's own picture: BG3 + the battler sprites at their screen positions (CPU composite), 2× PNG data URL. Sprites
   *  are drawn as the PPU orders OAM (priority, then subpriority, then index: the first one on top; every one above BG3,
   *  priority 3), 4bpp 1D tiles with their OBJ palette, colour 0 transparent. */
  referencePng(): string {
    const bus = this.bus;
    const img = decodeBg3(bus.vram, bus.pram16, this.bgcnt);
    const order = [...this.state.sprites].sort((a, b) => b.priority - a.priority || b.subpriority - a.subpriority || b.index - a.index);
    for (const s of order) {
      if (s.invisible) continue;
      const tilesPerRow = s.width >> 3;
      for (let y = 0; y < s.height; y++) {
        const sy = s.screenY + y;
        if (sy < 0 || sy >= BG_H) continue;
        for (let x = 0; x < s.width; x++) {
          const sx = s.screenX + x;
          if (sx < 0 || sx >= BG_W) continue;
          const tile = (s.tileNum + (y >> 3) * tilesPerRow + (x >> 3)) & 1023;
          const byte = bus.vram[OBJ_VRAM + tile * TILE_BYTES + (y & 7) * 4 + ((x & 7) >> 1)];
          const ci = x & 1 ? byte >> 4 : byte & 15;
          if (ci) img[sy * BG_W + sx] = bus.pram16[OBJ_PALETTE + s.palette * 16 + ci] & 0x7fff;
        }
      }
    }
    const rgba = new Uint32Array(BG_W * BG_H);
    for (let i = 0; i < rgba.length; i++) rgba[i] = bgr555ToRgba(img[i]);
    const frame = document.createElement('canvas');
    frame.width = BG_W;
    frame.height = BG_H;
    frame.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer), BG_W, BG_H), 0, 0);
    const out = document.createElement('canvas');
    out.width = BG_W * 2;
    out.height = BG_H * 2;
    const g = out.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    g.drawImage(frame, 0, 0, out.width, out.height);
    return out.toDataURL();
  }

  private resize(): void {
    this.webgl.setSize(window.innerWidth, window.innerHeight, false);
    const size = this.webgl.getDrawingBufferSize(new THREE.Vector2());
    this.post.setSize(size.x, size.y);
    this.battle.resize(window.innerWidth / window.innerHeight);
  }

  /** One frame, as the live Renderer draws a battle frame (without the HUD): the sprite atlas and the battlers' field,
   *  the battle view, PostFX. `fixedDt` (seconds) replaces the wall-clock time step. */
  private frame(fixedDt?: number): void {
    const r = this.webgl;
    r.info.reset();
    r.setRenderTarget(null);
    r.autoClear = true;
    const now = performance.now();
    const dt = fixedDt ?? Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.tex.update();
    this.spriteAtlas.update(r, this.state.sprites, false);
    this.battle.updateField(r, this.state);
    this.hud.length = 0;
    this.battle.update(this.state, dt, this.input, this.hud);
    this.input.yaw = this.input.pitch = this.input.zoom = 0;
    this.post.render(dt);
  }
}
