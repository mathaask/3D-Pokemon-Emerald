// 3D battle scene. Battle sprites are placed by "un-projecting" their GBA screen positions through the battle stage's
// reference projection (stage.ts) onto depth planes (player side, enemy side, or interpolated for move effects:
// battleActors.ts); in Modern the battlers are inflated on the battle's own inflation field (field: BATTLE_INFLATE, D4).
// The arena around them is the Modern arena (modernArena.ts) where it covers the arena kind in the Modern style — built
// in the colours sampled off the GBA's battle background (ArenaColorLock) and lit by the kind's look (look.ts: outdoor
// arenas by the overworld's time of day) under the Modern sky (sky.ts) — else today's arena (arena.ts: the Retro look and
// the fallback), generated and themed from the game's own terrain background colours, under today's light and sky. Every
// program the scene draws compiles at boot (precompile: the battle catalogue, both skies, the actors, the field).

import * as THREE from 'three';
import type { GameState, SpriteSnap } from '../../game/state';
import { SYM } from '../../game/symbols';
import type { SpriteAtlas } from '../spriteAtlas';
import { Sky } from '../overworld/sky';
import type { WorldStyle } from '../overworld/world';
import { shadowSettings } from '../overworld/overworldView';
import type { Quality } from '../post';
import { bgr555ToRgba } from '../gbaTextures';
import { createKitUniforms, type KitUniforms } from '../kit/materials';
import type { ProgramInfo } from '../actors/inflatedActors';
import type { SpriteFilter } from '../actors/actorLayer';
import { SpriteField } from '../actors/spriteField';
import { BATTLE_INFLATE } from '../actors/inflateMath';
import { XbrBake } from '../actors/xbrBake';
import type { RGB } from '../kit/palette';
import { BattleArena } from './arena';
import { arenaKind, ARENA_SETTING, type ArenaInputs, type ArenaKind } from './arenaKind';
import { decodeBg3, sampleArenaColors, BG_W, BG_H, type ArenaColors } from './bgSample';
import { BATTLE_CAMERA, PX, REF_PITCH, PLATFORM_ENEMY_SCREEN, STAGE, SUN_OFFSET, SUN_SHADOW } from './stage';
import { BattleActors, battleRoute, battlerAlphaKey, battlerPaletteKey } from './battleActors';
import { ARENA_PARTS, ArenaColorLock, ModernArena, withFailingPart, type ArenaPart } from './modernArena';
import { battleCatalogue, shadowDepthStandIns, type BattleCatalogue } from './catalogue';
import { arenaLook, type ArenaLook } from './look';
import { arenaPalette } from './palette';
import { BattleSky } from './sky';

export { isBattleHudSprite } from './battleActors';

/** Battler slots the battlers' field covers at most (a double battle has four battlers; trainer pictures join them). */
const FIELD_SLOTS = 16;

/** What the battle view reads of the game state (GameState's fields; the static preview fills exactly these). */
export type BattleViewState = Pick<GameState, 'mem' | 'sprites' | 'battleEnvironment' | 'battleType' | 'trainerClass'
  | 'mapBattleScene' | 'mapType' | 'hours' | 'minutes' | 'animActive' | 'target' | 'battlerCopies'>;

/** The precompile (BattleView.precompile): its catalogue, compileAsync's promise, whether its frame was drawn (or it
 *  failed). */
interface PrecompileState { catalogue: BattleCatalogue | null; compiled: Promise<void>; done: boolean }

/** The terrain background's colours today's arena takes (sampleTerrain) and their key. */
interface SampledColors { sky: THREE.Color; platform: THREE.Color; rim: THREE.Color; key: string }

/** Today's hemisphere colours and fog range (the constructor's): today's arena's light, restored after a Modern frame. */
const HEMI_SKY = new THREE.Color(0xcfe8ff), HEMI_GROUND = new THREE.Color(0x55603a);
const FOG_NEAR = 40, FOG_FAR = 120;
/** How often the background is sampled (s): BG3 is loaded a little after the battle starts. */
const SAMPLE_EVERY = 0.5;

/** Luminance (Rec. 709, linear) of the light today's battle gives its cards (the Retro charLight) for its hemisphere and
 *  sun strengths: by day, at night, in a room (and a cave: today's lights them alike). */
const todayLight = (hemiI: number, sunI: number) =>
  (0.2126 * (hemiI + sunI * 0.75) + 0.7152 * (hemiI + sunI * 0.72) + 0.0722 * (hemiI + sunI * 0.68)) / Math.PI;
const TODAY_LIGHT = { day: todayLight(1.15, 2.4), night: todayLight(0.7, 0.6), room: todayLight(1.6, 1.6) };
/** The Modern battlers' exposure range (BattleView.applyLook). */
const EXPOSURE = { min: 0.5, max: 3 };
const _sunDir = new THREE.Vector3();

export class BattleView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(30, 1.5, 0.1, 400);
  private actors: BattleActors;
  private sun = new THREE.DirectionalLight(0xffffff, 2.4);
  private hemi = new THREE.HemisphereLight(0xcfe8ff, 0x55603a, 1.1);
  /** Today's sky (the Retro battle's and today's arena's), and the Modern sky (BattleSky: the Modern arena's). */
  private sky = new Sky();
  private battleSky = new BattleSky();
  /** Today's arena: the Retro look and the Modern fallback, built (setEnvironment, setColors) only while shown. */
  private arena = new BattleArena();
  private time = 0;
  private env = -1;
  /** The environment today's arena was last built for, and the colours' key it last took. */
  private legacyEnv = -1;
  private legacyKey = '';
  /** The last valid sample of the terrain background since the environment changed (null: none yet). */
  private sampled: SampledColors | null = null;
  private lastSample = -1;
  private charLight = new THREE.Color(1, 1, 1);
  private cameraRight = new THREE.Vector3(1, 0, 0);
  /** User orbit offsets (from mouse/keys). */
  yaw = 0;
  zoom = 1;
  private intro = 0;
  private focus = 0;
  private focusSide = 1;
  /** The battle's own kit uniforms: the Modern arena's materials pool here; uSky (the battlers' rim, the arena water's
   *  sky) and uNight follow the Modern arena's look, today's battle sky colour under today's arena; uTime the view's
   *  clock. */
  readonly uniforms: KitUniforms = createKitUniforms();
  private modern: ModernArena;
  /** The Modern arena's colours (defaults until the background is sampled, then that sample for the battle). */
  private lock = new ArenaColorLock();
  /** When the background was last sampled for the Modern arena (the view's clock), and the decode's buffer. */
  private lastModernSample = -Infinity;
  private bg3 = new Uint16Array(BG_W * BG_H);
  /** Whether this frame draws the Modern arena (its look lights the scene), and the look (reused). */
  private modernShown = false;
  private look: ArenaLook = arenaLook('plain', arenaPalette('plain', null), 12);
  /** The style and quality the sun's shadow was last set for (applyShadows). */
  private shadowStyle: WorldStyle | null = null;
  private shadowQuality: Quality | null = null;
  private style: WorldStyle = 'modern';
  private failPart: string | null = null;
  /** The arena kind's inputs as last seen (updated in place), the kind and whether the Modern arena covers it: recomputed
   *  only when an input changes (no allocation per frame). */
  private kindInputs: ArenaInputs = { environment: -1, battleType: -1, trainerClass: -1, mapBattleScene: -1, mapType: -1 };
  private kind: ArenaKind = 'plain';
  private covered = false;
  /** Arena build quality (the renderer's). */
  quality: Quality = 'medium';
  /** The precompile (started once). */
  private pre: PrecompileState | null = null;
  private compileReady = false;
  /** The precompile's cost (ms): compileAsync issued → its programs ready (parallel), the frame that compiles the rest
   *  (blocking), and when that frame was drawn (performance.now()). */
  readonly precompileStats = { compileMs: 0, frameMs: 0, frameAt: 0 };
  /** Draws one frame as it is presented (the owner's PostFX: its passes, GTAO's override materials at High quality): the
   *  precompile draws it with the catalogue shown. null: the scene alone, into a 1×1 target. */
  precompileFrame: (() => void) | null = null;

  /** The battlers' inflation field (Modern): the sprite atlas's, with the battle's parameters (BATTLE_INFLATE: 64-px
   *  pictures) — its own instance (+8 MB), so neither scene's field is ever the other's (D4). Recomputed by updateField
   *  after each atlas update; read by the self-test. */
  readonly field: SpriteField;
  /** The battler slots the field covers (slot x, slot y, width, height: the atlas's layout) and how many; the battlers'
   *  slots and alpha keys it was last computed from (two arrays, swapped); whether it holds that computation. */
  private fieldRects = new THREE.InstancedBufferAttribute(new Float32Array(FIELD_SLOTS * 4), 4).setUsage(THREE.DynamicDrawUsage);
  private fieldCount = 0;
  private fieldKey: number[] = [];
  private fieldKeyNext: number[] = [];
  private fieldValid = false;
  /** The battlers' baked xBR decisions (their HD edges: XbrBake) and the battlers' palette keys they were baked with. */
  readonly xbr = new XbrBake();
  private xbrKey: number[] = [];
  private xbrKeyNext: number[] = [];
  /** Field computations and reuses, xBR bakes (updateField; the report's numbers). */
  readonly fieldStats = { updates: 0, reused: 0, bakes: 0 };

  /** `instanceUniforms`: the inflated battlers' instance-data path (instanceUniformsFit, as the overworld's: every caller
   *  passes it). */
  constructor(private readonly spriteAtlas: SpriteAtlas, opts: { instanceUniforms?: boolean } = {}) {
    this.field = new SpriteField(undefined, undefined, BATTLE_INFLATE);
    this.actors = new BattleActors(spriteAtlas,
      { field: this.field, xbr: this.xbr, rim: this.uniforms.uSky, instanceUniforms: opts.instanceUniforms });
    this.scene.add(this.actors.group, this.sun, this.sun.target, this.hemi, this.sky.mesh, this.battleSky.mesh, this.arena.group);
    this.battleSky.mesh.visible = false;
    this.scene.fog = new THREE.Fog(0xcfe8ff, 40, 120);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -SUN_SHADOW.half; sc.right = SUN_SHADOW.half; sc.top = SUN_SHADOW.half; sc.bottom = -SUN_SHADOW.half;
    sc.near = SUN_SHADOW.near; sc.far = SUN_SHADOW.far;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.02;
    this.arena.setPlatforms(STAGE.player, STAGE.enemy);
    this.modern = new ModernArena(this.uniforms, this.parts());
    this.modern.group.visible = false;
    this.scene.add(this.modern.group);
  }

  get worldStyle(): WorldStyle {
    return this.style;
  }

  /** Modern / Retro: applies at the next update (the arena the style draws; today's arena built when first shown; the
   *  battlers' field from the next updateField). */
  setWorldStyle(s: WorldStyle): void {
    this.style = s;
  }

  /** Modern's inflated battlers, flat enemy shadow and skipped OBJ-window masks (false: every sprite a card, as in Retro
   *  — the harness's `--ab-feature battlers` baseline; the field is then not computed either). */
  get inflation(): boolean {
    return this.actors.inflation;
  }

  set inflation(on: boolean) {
    this.actors.inflation = on;
  }

  /** Sprite edges of the inflated battlers (Modern): HD smooth (xBR) or Pixel. Cards and Retro are unaffected. */
  setSpriteFilter(f: SpriteFilter): void {
    this.actors.setSpriteFilter(f);
  }

  /** Whether the battlers' field is computed (and drawn from): a Modern battle with inflation on. */
  get fieldLive(): boolean {
    return this.style === 'modern' && this.actors.inflation;
  }

  /**
   * Brings the battlers' inflation field up to the sprite atlas as its last update baked it — the owner calls it right
   * after every atlas update of a battle frame, with that frame's state (sprites change slot and animate: a field one bake
   * behind would displace the wrong pixels) — in a Modern battle with inflation on only (Retro and the cards-only baseline
   * draw no inflated battler). The passes run over the battlers' slots only (the sprites Modern inflates; not the HUD's
   * or the move effects'), and only when a battler's slot or alpha changed (battlerAlphaKey: its tiles, size, flips…):
   * otherwise the field already holds exactly what they would compute (idle battlers bob by position, not by tiles).
   * Their baked xBR decisions (xbr: the HD edges) follow the same slots and are re-baked when the field is, or when a
   * battler's colours changed (battlerPaletteKey: a fade, a flash).
   */
  updateField(renderer: THREE.WebGLRenderer, state: Pick<BattleViewState, 'sprites' | 'mem'>): void {
    if (!this.fieldLive) return;
    const atlas = this.spriteAtlas, rects = atlas.slotRects, key = this.fieldKeyNext, colours = this.xbrKeyNext, bus = state.mem.bus;
    // (the atlas's tile mapping: DISPCNT bit 6, as Renderer / the preview bake it)
    const map2d = (bus.io16[0] & 0x40) === 0;
    key.length = colours.length = 0;
    let n = 0;
    for (const s of state.sprites) {
      if (n >= FIELD_SLOTS || battleRoute(s, 'modern', true) !== 'inflated') continue;
      const info = atlas.slots.get(s.index);
      if (!info) continue;
      const i = info.slot;
      this.fieldRects.setXYZW(n++, rects.getX(i), rects.getY(i), rects.getZ(i), rects.getW(i));
      key.push(rects.getX(i), rects.getY(i), rects.getZ(i), rects.getW(i), battlerAlphaKey(s, bus.vram, map2d));
      colours.push(battlerPaletteKey(s, bus.pram16));
    }
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, k) => v === b[k]);
    const fieldSame = this.fieldValid && same(key, this.fieldKey);
    // (the decisions compare colours: a fade or a flash re-bakes them, the field stays)
    const xbrSame = fieldSame && same(colours, this.xbrKey);
    if (!fieldSame) {
      this.fieldRects.clearUpdateRanges();
      if (n > 0) this.fieldRects.addUpdateRange(0, n * 4);
      this.fieldRects.needsUpdate = true;
      this.field.update(renderer, atlas.target.texture, this.fieldRects, n);
      this.fieldCount = n;
      this.fieldKeyNext = this.fieldKey;
      this.fieldKey = key;
      this.fieldValid = true;
      this.fieldStats.updates++;
    } else this.fieldStats.reused++;
    if (!xbrSame) {
      this.xbr.update(renderer, atlas.target.texture, this.fieldRects, n);
      this.xbrKeyNext = this.xbrKey;
      this.xbrKey = colours;
      this.fieldStats.bakes++;
    }
  }

  /** The slots the battlers' field covers (its last computation): the self-test compares and times exactly these. */
  get fieldSlots(): { rects: THREE.InstancedBufferAttribute; count: number } {
    return { rects: this.fieldRects, count: this.fieldCount };
  }

  /** The battlers' field must be recomputed at the next updateField (a lost and restored WebGL context emptied it). */
  invalidateField(): void {
    this.fieldValid = false;
  }

  /** The preview's &arenaFail=<name>: the arena part of that name throws (with no such part, one of that name covering
   *  every kind is added), so the Modern battle falls back to today's arena. null: the parts as they are. */
  get arenaFailPart(): string | null {
    return this.failPart;
  }

  set arenaFailPart(name: string | null) {
    if (name === this.failPart) return;
    this.failPart = name;
    this.modern.dispose();
    this.modern = new ModernArena(this.uniforms, this.parts());
    this.modern.group.visible = false;
    this.scene.add(this.modern.group);
    this.covered = this.modern.covers(this.kind);
  }

  /** The arena parts the Modern arena builds (and the catalogue compiles): ARENA_PARTS, one made to fail by arenaFailPart. */
  private parts(): readonly ArenaPart[] {
    return this.failPart === null ? ARENA_PARTS : withFailingPart(ARENA_PARTS, this.failPart);
  }

  /**
   * Starts compiling every program the battle scene draws, once, whatever the style: the battle catalogue (every arena
   * part's program variants, today's arena for every environment: catalogue.ts) in the battle scene, with both skies and
   * every actor shown (the inflated battlers too, and every shadow-depth twin through its stand-in), and the battlers'
   * field passes —
   * compileAsync issues them all at once (parallel where the browser has KHR_parallel_shader_compile) into a 1×1
   * target, as PostFX draws the scene, off the main thread; finishPrecompile then draws the frame that compiles the rest
   * (shadow-depth, PostFX's passes), blocking. Live play starts it at boot (Renderer's constructor), the battle preview
   * before its first frame. Resolves when compileAsync's programs are ready; a failure is logged once and never retried
   * (the programs then compile on first use).
   */
  precompile(renderer: THREE.WebGLRenderer): Promise<void> {
    if (this.pre) return this.pre.compiled;
    const pre: PrecompileState = { catalogue: null, compiled: Promise.resolve(), done: false };
    this.pre = pre;
    const t0 = performance.now();
    // (an async body: a synchronous throw becomes the rejection)
    pre.compiled = (async () => {
      // the catalogue's kit materials pool apart: an arena build never takes them (their ids, the opaque draw order, stay)
      const catalogue = pre.catalogue = battleCatalogue({ uniforms: createKitUniforms(), parts: this.parts() });
      const target = new THREE.WebGLRenderTarget(1, 1);
      const prev = renderer.getRenderTarget();
      let ready: Promise<unknown>;
      this.scene.add(catalogue.root);
      const restore = this.actors.showAll(), skies = this.showSkies();
      // the shadow twins too (else the first battle frame's shadow pass compiles them: the cards' alpha-tested one). The
      // shadow pass draws them with this scene's lights but no scene (no fog), into a target: compiled so
      const standIns = new THREE.Group();
      const fog = this.scene.fog;
      try {
        for (const s of shadowDepthStandIns(this.scene)) standIns.add(s);
        renderer.setRenderTarget(target);
        const scene = renderer.compileAsync(this.scene, this.camera);
        this.scene.fog = null;
        ready = Promise.all([scene, renderer.compileAsync(standIns, this.camera, this.scene), this.field.compile(renderer),
          this.xbr.compile(renderer)]);
      } finally {
        this.scene.fog = fog;
        for (const s of standIns.children) if ((s as THREE.InstancedMesh).isInstancedMesh) (s as THREE.InstancedMesh).dispose();
        restore();
        skies();
        catalogue.root.removeFromParent();
        renderer.setRenderTarget(prev);
        target.dispose();
      }
      await ready;
      this.precompileStats.compileMs = performance.now() - t0;
    })().catch((e) => {
      // (after the frame: it compiled the programs and freed the catalogue — nothing failed that matters)
      if (pre.done) return;
      pre.done = true;
      pre.catalogue?.dispose();
      console.warn('[battle] precompile failed (programs compile on first use instead)', e);
    }).finally(() => {
      this.compileReady = true;
    });
    return pre.compiled;
  }

  /** Whether the precompile's parallel compile is done (or failed): the frame finishPrecompile draws then blocks little. */
  get precompileReady(): boolean {
    return this.compileReady;
  }

  /**
   * Draws the precompile frame once (starting the precompile if it was not): the catalogue's meshes and every actor
   * shown, drawn as frames are presented (precompileFrame) — the shadow pass and PostFX's passes compile there; whatever
   * compileAsync has not finished yet is waited for. Live play draws it in Renderer.finishPrecompile (boot, behind the
   * loader; the harness's eval) or, without that, at the first battle sync — never inside an overworld frame; the battle
   * preview before its first frame.
   */
  finishPrecompile(renderer: THREE.WebGLRenderer): void {
    void this.precompile(renderer);
    const pre = this.pre!;
    const catalogue = pre.catalogue;
    // (no catalogue: building it failed — precompile's rejection logs it once)
    if (pre.done || !catalogue) return;
    pre.done = true;
    const t0 = performance.now();
    this.scene.add(catalogue.root);
    const restore = this.actors.showAll(), skies = this.showSkies();
    const draw = () => {
      if (this.precompileFrame) this.precompileFrame();
      else {
        const target = new THREE.WebGLRenderTarget(1, 1);
        const prev = renderer.getRenderTarget();
        try {
          renderer.setRenderTarget(target);
          renderer.render(this.scene, this.camera);
        } finally {
          renderer.setRenderTarget(prev);
          target.dispose();
        }
      }
    };
    try {
      draw();
      // (the frame used every actor program: a uniform-array one that did not link shows in three's diagnostics). A
      // device that needs the attribute fallback gets its programs (main, shadow-depth) compiled by one more frame here,
      // not by the first battle's
      if (this.actors.checkInstanceUniforms((renderer.info.programs ?? []) as unknown as ProgramInfo[])) draw();
    } catch (e) {
      console.warn('[battle] precompile frame failed (programs compile on first use instead)', e);
    } finally {
      restore();
      skies();
      catalogue.dispose();
      this.precompileStats.frameMs = performance.now() - t0;
      this.precompileStats.frameAt = t0;
    }
  }

  /** Shows both skies (today's and the Modern BattleSky: scene members, not in the battle catalogue — the precompile
   *  compiles them with the scene) and returns what puts their visibility back. */
  private showSkies(): () => void {
    const was = [this.sky.mesh.visible, this.battleSky.mesh.visible];
    this.sky.mesh.visible = this.battleSky.mesh.visible = true;
    return () => {
      this.sky.mesh.visible = was[0];
      this.battleSky.mesh.visible = was[1];
    };
  }

  /** Samples the GBA terrain background (BG3) every 0.5 s: today's arena's sky, platform and rim colours. */
  private sampleTerrain(state: BattleViewState): void {
    // Re-sample now and then: BG3 is loaded a little after the battle starts.
    if (this.time - this.lastSample < 0.5) return;
    this.lastSample = this.time;
    // Use the unfaded palette buffer: hardware palette RAM is mid-fade during the intro.
    const bus = state.mem.bus;
    const palOff = (SYM.gPlttBufferUnfaded & 0x3ffff) >>> 1;
    const pal = bus.ewram16.subarray(palOff, palOff + 256);
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
    this.sampled = { sky, platform, rim, key: [sky, platform, rim].map((c) => c.getHexString()).join(':') };
  }

  /** The arena kind (as the GBA picks its background) and whether the Modern arena covers it, recomputed only when one of
   *  the kind's inputs changed (a new kind samples its background at once: the colour lock starts over). */
  private updateKind(state: BattleViewState): void {
    const i = this.kindInputs;
    if (i.environment === state.battleEnvironment && i.battleType === state.battleType && i.trainerClass === state.trainerClass
      && i.mapBattleScene === state.mapBattleScene && i.mapType === state.mapType) return;
    i.environment = state.battleEnvironment;
    i.battleType = state.battleType;
    i.trainerClass = state.trainerClass;
    i.mapBattleScene = state.mapBattleScene;
    i.mapType = state.mapType;
    this.kind = arenaKind(i);
    this.covered = this.modern.covers(this.kind);
    this.lastModernSample = -Infinity;
  }

  /** The Modern arena's colours (ArenaColorLock): until the lock holds a sample of this kind's background, every
   *  SAMPLE_EVERY s the GBA's BG3 as it shows it (decodeBg3 with the unfaded BG palette: hardware palette RAM is mid-fade
   *  during the intro) sampled by sampleArenaColors (null while it is empty or not loaded yet); then nothing more. */
  private modernColors(state: BattleViewState): ArenaColors {
    if (this.lock.locked(this.kind) || this.time - this.lastModernSample < SAMPLE_EVERY) return this.lock.observe(this.kind, null);
    this.lastModernSample = this.time;
    const bus = state.mem.bus;
    const palOff = (SYM.gPlttBufferUnfaded & 0x3ffff) >>> 1;
    const img = decodeBg3(bus.vram, bus.ewram16.subarray(palOff, palOff + 256), bus.io16[0x0e >>> 1], this.bg3);
    return this.lock.observe(this.kind, sampleArenaColors(img));
  }

  /**
   * The arena of this frame: the Modern arena when the style is Modern, it covers the arena kind and its build succeeded
   * (in the lock's colours: the kind's defaults until its background is sampled, at most two builds a battle); else
   * today's arena, built lazily — only while shown — with exactly today's calls at today's frames (setEnvironment on an
   * environment change, setColors when a background sample changes the colours). An environment change restarts the
   * intro sweep in both styles.
   */
  private updateArena(state: BattleViewState): void {
    if (state.battleEnvironment !== this.env) {
      this.env = state.battleEnvironment;
      this.intro = 0;
      this.sampled = null;
    }
    this.updateKind(state);
    const modern = this.style === 'modern' && this.covered && this.modern.build(this.kind, this.modernColors(state), this.quality);
    this.modernShown = modern;
    this.modern.group.visible = modern;
    this.arena.group.visible = !modern;
    if (!modern && this.legacyEnv !== this.env) {
      this.arena.setEnvironment(this.env);
      this.legacyEnv = this.env;
      this.legacyKey = '';
    }
    this.sampleTerrain(state);
    const c = this.sampled;
    if (!modern && c && c.key !== this.legacyKey) {
      this.legacyKey = c.key;
      this.arena.setColors(c.sky, c.platform, c.rim);
    }
  }

  update(state: BattleViewState, dt: number, input: { yaw: number; pitch: number; zoom: number }, hudSprites: SpriteSnap[]): void {
    const C = BATTLE_CAMERA;
    this.time += dt;
    this.intro = Math.min(1, this.intro + dt / C.intro.seconds);
    this.updateArena(state);
    this.yaw = THREE.MathUtils.clamp(this.yaw + input.yaw, -C.yaw, C.yaw);
    if (input.zoom) this.zoom = THREE.MathUtils.clamp(this.zoom * Math.pow(1.1, input.zoom), C.zoom[0], C.zoom[1]);

    // Camera: behind the player's side, framing both platforms like the GBA, with a slow
    // breathing sway and an intro sweep.
    // Look down the reference camera's centre ray; a narrow FOV keeps perspective close to
    // the GBA's flat projection while still giving depth.
    const midDepth = (STAGE.playerDepth + STAGE.enemyDepth) / 2;
    const mid = STAGE.at(120, 82, midDepth);
    // Cinematic focus: while a move animation plays, ease towards the target and push in.
    const targetFocus = state.animActive ? 1 : 0;
    this.focus += (targetFocus - this.focus) * Math.min(1, dt * 2.5);
    if (state.animActive) {
      // Player side = even battler ids; aim at whoever is being hit.
      this.focusSide = (state.target & 1) === 1 ? 1 : -1;
    }
    const focusPoint = this.focusSide > 0 ? STAGE.enemy : STAGE.player;
    mid.lerp(new THREE.Vector3(focusPoint.x, mid.y, focusPoint.z), this.focus * 0.25);
    const ease = 1 - Math.pow(1 - this.intro, 3);
    const sway = Math.sin(this.time * 0.25) * C.sway;
    const yaw = this.yaw + sway + (1 - ease) * C.intro.yaw + this.focus * C.focusYaw * this.focusSide;
    const fov = C.fov;
    const dist = ((80 / PX) / Math.tan(THREE.MathUtils.degToRad(fov / 2))) * this.zoom *
      (1 + (1 - ease) * C.intro.dist) * (1 - this.focus * C.focusPush);
    const pitch = REF_PITCH - C.pitchDrop + (1 - ease) * C.intro.pitch;
    const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
    this.camera.position.copy(mid).addScaledVector(dir, dist);
    this.camera.fov = fov;
    this.camera.lookAt(mid);
    this.camera.updateProjectionMatrix();
    this.cameraRight.set(Math.cos(yaw), 0, -Math.sin(yaw));

    // Light: time of day, like the overworld (battles indoors are evenly lit). The sun's direction is the battle's own
    // (both arenas); its colour and strength, the hemisphere and the fog are the Modern arena's look, else today's.
    const indoor = state.battleEnvironment === 8 || state.battleEnvironment === 7;
    const hour = state.hours + state.minutes / 60;
    const dayPhase = ((hour - 6) / 12) * Math.PI;
    const night = !indoor && (hour < 5.5 || hour > 19.5);
    this.sun.position.copy(mid).add(new THREE.Vector3(Math.cos(dayPhase) * SUN_OFFSET.swing + SUN_OFFSET.x, SUN_OFFSET.y, SUN_OFFSET.z));
    this.sun.target.position.copy(mid);
    this.uniforms.uTime.value = this.time;
    const fog = this.scene.fog as THREE.Fog;
    if (this.modernShown) this.applyLook(hour);
    else {
      this.sun.intensity = indoor ? 1.6 : night ? 0.6 : 2.4;
      this.sun.color.set(night ? 0x9fb3ff : 0xfff3e0);
      this.hemi.intensity = indoor ? 1.6 : night ? 0.7 : 1.15;
      this.hemi.color.copy(HEMI_SKY);
      this.hemi.groundColor.copy(HEMI_GROUND);
      const k = 1 / Math.PI;
      this.charLight.setRGB(
        (this.hemi.intensity + this.sun.intensity * 0.75) * k,
        (this.hemi.intensity + this.sun.intensity * 0.72) * k,
        (this.hemi.intensity + this.sun.intensity * 0.68) * k,
      );
      fog.near = FOG_NEAR;
      fog.far = FOG_FAR;
      this.actors.setExposure(1);
      this.uniforms.uNight.value = 0;
    }
    this.applyShadows(this.modernShown ? 'modern' : 'retro');
    this.arena.update(this.time, night);
    if (!this.modernShown) {
      fog.color.copy(this.arena.horizon);
      this.sky.setColors(this.arena.skyColor, this.arena.horizon, indoor, this.time);
      this.uniforms.uSky.value.copy(this.arena.skyColor);
    }
    // (the Modern arena's sky is BattleSky — after the opaque arena at the far plane, depth-tested: its hidden pixels cost
    // nothing, and the battle camera never frames the horizon, D1; today's arena keeps today's sky, drawn first as today)
    this.sky.mesh.visible = !this.modernShown;
    this.battleSky.mesh.visible = this.modernShown;
    this.sky.mesh.position.copy(this.camera.position);
    this.battleSky.mesh.position.copy(this.camera.position);

    this.actors.update(state.sprites, this.style, this.cameraRight, this.camera.position, this.charLight, hudSprites,
      state.battlerCopies);
  }

  /**
   * The Modern arena's look at `hour` (look.ts, from the palette it was built with) on the scene's lights and fog, the sky
   * dome, the kit's uSky (the battlers' rim, the arena water's sky: the sky × the hemisphere's strength × 0.6, as the
   * overworld's) and uNight; the cards' and the battlers' light (charLight) by the overworld's formula, and the battle
   * actors' exposure (today's battle brightness: BattleActors.setExposure).
   */
  private applyLook(hour: number): void {
    const palette = this.modern.palette;
    if (!palette) return;
    const L = arenaLook(this.kind, palette, hour, this.look);
    this.sun.color.copy(L.sunColor);
    this.sun.intensity = L.sunI;
    this.hemi.color.copy(L.sky);
    this.hemi.groundColor.copy(L.hemiGround);
    this.hemi.intensity = L.hemiI;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(L.fog);
    fog.near = L.fogNear;
    fog.far = L.fogFar;
    this.uniforms.uSky.value.copy(L.sky).multiplyScalar(L.hemiI * 0.6);
    this.uniforms.uNight.value = L.night;
    // (characters are lit like a Lambert surface facing the camera: (ambient + part of the sun) / π — OverworldView's)
    const k = 1 / Math.PI;
    this.charLight.setRGB(
      (L.sky.r * L.hemiI + L.sunColor.r * L.sunI * 0.75) * k,
      (L.sky.g * L.hemiI + L.sunColor.g * L.sunI * 0.75) * k,
      (L.sky.b * L.hemiI + L.sunColor.b * L.sunI * 0.75) * k,
    );
    const setting = ARENA_SETTING[this.kind];
    // The battlers keep today's battle brightness — as the GBA draws its sprites at full brightness whatever the
    // background — while the arena takes the hour's light (or a cave's, the sea floor's): their exposure is today's
    // light for the kind (by day easing to today's night along the overworld's night ramp, so no jump at today's 19:30
    // switch; rooms and caves today's evenly lit rooms') over this light. Their hue and shading stay the look's.
    const today = setting === 'indoor' || setting === 'cave' ? TODAY_LIGHT.room
      : TODAY_LIGHT.day + (TODAY_LIGHT.night - TODAY_LIGHT.day) * L.night;
    const lum = 0.2126 * this.charLight.r + 0.7152 * this.charLight.g + 0.0722 * this.charLight.b;
    this.actors.setExposure(THREE.MathUtils.clamp(today / Math.max(lum, 1e-4), EXPOSURE.min, EXPOSURE.max));
    this.battleSky.setLook(L, setting, this.time);
    this.battleSky.setSun(_sunDir.subVectors(this.sun.position, this.sun.target.position));
  }

  /** The sun's shadow map and softness: Modern's by quality (OverworldView's shadowSettings), today's under today's
   *  arena (2048, radius 1: the constructor's). A size change frees the map (three makes the new one). */
  private applyShadows(style: WorldStyle): void {
    // (unchanged since the last frame: nothing to do — shadowSettings returns a new object)
    if (style === this.shadowStyle && this.quality === this.shadowQuality) return;
    this.shadowStyle = style;
    this.shadowQuality = this.quality;
    const { size, radius } = shadowSettings(this.quality, style);
    const shadow = this.sun.shadow;
    shadow.radius = radius;
    if (shadow.mapSize.x === size) return;
    shadow.mapSize.set(size, size);
    shadow.map?.dispose();
    shadow.map = null;
  }

  /**
   * Rebuilds the Modern arena `runs` times, each with a fresh colour key (the lock's colours nudged; after one untimed
   * rebuild, so warm), and returns each build's ms (ModernArena.lastBuildMs); then builds it back in the lock's colours.
   * The preview's measureArenaBuild (the arena build gate: ≤ 60 ms warm, median).
   */
  measureArenaBuild(runs = 5): number[] {
    const colors = this.lock.observe(this.kind, null);
    const nudged = (i: number): ArenaColors => ({
      ...colors, platform: colors.platform.map((v, j) => (j === 0 ? (v > 0.5 ? v - 0.002 * i : v + 0.002 * i) : v)) as RGB,
    });
    const ms: number[] = [];
    for (let i = 0; i <= runs; i++) {
      this.modern.build(this.kind, nudged(i + 1), this.quality);
      if (i > 0) ms.push(this.modern.lastBuildMs);
    }
    this.modern.build(this.kind, colors, this.quality);
    return ms;
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Draws the battle actors (cards, decals, inflated battlers) flat magenta (the harness's visible-actor mask) or
   *  normally. */
  setActorMask(on: boolean): void {
    this.actors.setMask(on);
  }
}
