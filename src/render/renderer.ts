// Chooses how each frame is presented: 3D overworld, 3D battle, or the 2D GBA screen.

import * as THREE from 'three';
import type { Gba } from '../gba/gba';
import { GameState } from '../game/state';
import { SYM } from '../game/symbols';
import { ScreenView } from './screen/screenView';
import { GbaTextures } from './gbaTextures';
import { SpriteAtlas } from './spriteAtlas';
import { OverworldView } from './overworld/overworldView';
import { Hud } from './hud';
import { PostFX, tiltShiftFor, type Quality } from './post';
import type { WorldStyle } from './overworld/world';
import { BattleView } from './battle/battleView';
import { BattleTransitionFx } from './transition';
import { SpriteClassifier, SpriteKind } from '../game/spriteKinds';
import { mapLoadInProgress } from '../game/mapLoad';
import { SyncGate } from './syncGate';
import { SpriteField } from './actors/spriteField';
import { instanceUniformsFit } from './actors/inflatedActors';
import { fieldDump, actorSelfTest, type ActorSelfTest } from './actors/selfTest';
import type { SpriteFilter } from './actors/actorLayer';

export type ViewMode = 'auto' | 'classic';

const PAL_UNFADED_OFFSET = (SYM.gPlttBufferUnfaded & 0x3ffff) >>> 1;

export class Renderer {
  readonly webgl: THREE.WebGLRenderer;
  readonly state: GameState;
  private screen: ScreenView;
  private gbaTex: GbaTextures;
  private spriteAtlas: SpriteAtlas;
  /** Inflation field of the sprite atlas (Modern overworld only). */
  private spriteField: SpriteField;
  readonly overworld: OverworldView;
  readonly battle: BattleView;
  private hud: Hud;
  private post: PostFX;
  quality: Quality;
  mode: ViewMode = 'auto';
  private width = 1;
  private height = 1;
  private fade = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false }),
  );
  private fadeScene = new THREE.Scene();
  private fadeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private lastTime = performance.now();
  /** Fixed seconds per render() (deterministic stepping), or null: wall-clock time. */
  private fixedDt: number | null = null;
  /** Virtual clock in ms, advanced by fixedDt per render() while a fixed timestep is set. */
  private virtualNow = 0;
  /** Scene actually presented (transition frames keep the previous one). */
  presented: 'overworld' | 'battle' | 'screen2d' = 'screen2d';
  private transitionFx = new BattleTransitionFx();
  private classifier: SpriteClassifier;
  private inBattleTransition = false;
  private battleHud: import('../game/state').SpriteSnap[] = [];
  private emulatedSinceRender = 0;
  /** Sync with the emulator at the next render even if no frame was emulated (a world style change). */
  private resync = false;
  /** Skips a frame's sync that would rebuild the world from a map load in progress (the world is built once, from
   *  the finished map). */
  private syncGate = new SyncGate();
  /** The emulated state read ahead of a sync while the game is loading a map: would the sync rebuild the world? */
  private probe: GameState | null = null;
  /** Whether finishPrecompile compiled the fade quad, ScreenView, the HUD and the transition effect. */
  private screensCompiled = false;
  cameraInput = { yaw: 0, pitch: 0, zoom: 0 };

  constructor(private canvas: HTMLCanvasElement, private gba: Gba, quality: Quality = 'medium') {
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.shadowMap.enabled = true;
    // (three r186 removed PCFSoftShadowMap: PCF softens by the light's shadow.radius instead, set
    // per quality by OverworldView.setShadowQuality)
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.webgl.toneMapping = THREE.NeutralToneMapping;
    this.webgl.toneMappingExposure = 1.0;
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    // whole-frame totals (every pass of a render() call): reset at its start, see stats()
    this.webgl.info.autoReset = false;

    this.state = new GameState(gba.bus);
    this.screen = new ScreenView(gba.ppu.framebuffer);
    this.gbaTex = new GbaTextures(gba.bus);
    this.spriteAtlas = new SpriteAtlas(this.gbaTex);
    this.spriteField = new SpriteField();
    // (the inflated actors' instance data: a uniform array where the device has the vertex uniform vectors; ?actorUniforms=0|1)
    const actorUniforms = instanceUniformsFit(this.webgl.capabilities.maxVertexUniforms, new URLSearchParams(location.search).get('actorUniforms'));
    this.overworld = new OverworldView(this.gbaTex, this.spriteAtlas, this.webgl.capabilities.getMaxAnisotropy(), this.spriteField, actorUniforms);
    this.battle = new BattleView(this.spriteAtlas, { instanceUniforms: actorUniforms });
    this.classifier = new SpriteClassifier(this.state.mem);
    this.overworld.classifier = this.classifier;
    gba.ppu.overlayMask = 0x01; // BG0: text boxes and menus
    this.hud = new Hud(gba.ppu.overlay, this.spriteAtlas);
    const q = new URLSearchParams(location.search).get('quality') ?? quality;
    this.quality = q === 'low' || q === 'high' ? q : 'medium';
    this.overworld.quality = this.quality;
    this.overworld.setShadowQuality(this.quality);
    this.battle.quality = this.quality;
    this.post = new PostFX(this.webgl, this.overworld.scene, this.overworld.camera, this.quality);
    // the overworld's and the battle's precompile frames (before the start gesture, or at the view's first sync) are drawn
    // through PostFX, as frames are presented
    this.overworld.precompileFrame = () => {
      this.post.setCamera(this.overworld.scene, this.overworld.camera);
      this.post.render(0);
    };
    this.battle.precompileFrame = () => {
      this.post.setCamera(this.battle.scene, this.battle.camera);
      this.post.render(0);
    };
    this.applyTiltShift(this.overworld.worldStyle);
    this.fade.frustumCulled = false;
    this.fadeScene.add(this.fade);
    window.addEventListener('resize', () => this.resize());
    // a restored context has lost every render target's pixels: the atlas redraws only on change
    canvas.addEventListener('webglcontextrestored', () => this.overworld.atlas.invalidate());
    this.resize();
    // every overworld program (the world's catalogue, the actors') and every battle program (the battle catalogue: the
    // arenas of both styles) compiles from boot on, in parallel: a map's first visit and a battle's entry compile nothing.
    // The frames that compile the rest block: main.ts draws them while the loader waits for the start gesture if the
    // programs are ready by then (finishPrecompile), else each view's first sync draws its own
    void this.overworld.precompile(this.webgl);
    void this.battle.precompile(this.webgl);
  }

  resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.webgl.setSize(this.width, this.height, false);
    const size = this.webgl.getDrawingBufferSize(new THREE.Vector2());
    this.screen.resize(size.x, size.y);
    this.post?.setSize(size.x, size.y);
    this.hud.resize(this.width, this.height);
    this.overworld.resize(this.width / this.height);
    // the occlusion fade works in pixels of the target the scene is drawn into
    const t = this.post.sceneTargetSize(size);
    this.overworld.setBufferSize(t.x, t.y);
    this.battle.resize(this.width / this.height);
  }

  /** Modern / Retro world style: rebuilds the world and adapts the miniature blur. */
  setWorldStyle(s: WorldStyle): void {
    const changed = s !== this.overworld.worldStyle;
    this.overworld.setWorldStyle(s);
    // (the battle draws its style's arena from its next frame on: BattleView.update runs every frame)
    this.battle.setWorldStyle(s);
    this.applyTiltShift(s);
    // The world is rebuilt by the next sync, which follows an emulated frame; while the settings
    // panel is open emulation is paused, so sync at the next render: the new world shows at once,
    // with the style's shadows and blur.
    if (changed && this.presented === 'overworld') this.resync = true;
  }

  private applyTiltShift(s: WorldStyle): void {
    const t = tiltShiftFor(s);
    this.post.setTiltShift(t.focus, t.band, t.strength);
  }

  setEffects(tiltShift: boolean, bloom: boolean): void {
    this.post.setEnabled(tiltShift, bloom);
  }

  /** Sprite edges of the Modern overworld's actors: HD smooth (xBR) or Pixel. Retro ignores it. */
  setSpriteFilter(f: SpriteFilter): void {
    this.overworld.setSpriteFilter(f);
  }

  /** Called after every emulated frame (possibly several per displayed frame). */
  onEmulatedFrame(): void {
    this.emulatedSinceRender++;
  }

  private syncFromEmulator(): void {
    const st = this.state;
    st.update();
    let scene = st.scene;
    this.inBattleTransition = scene === 'battleTransition';
    if (scene === 'battleTransition') scene = 'overworld';
    if (scene === 'transition') scene = this.presented === 'battle' ? 'screen2d' : this.presented;
    if (this.mode === 'classic') scene = 'screen2d';
    this.presented = scene;

    if (this.presented === 'overworld') {
      // Clean palettes for 3D; fades are re-applied globally.
      this.gbaTex.paletteSource = this.gba.bus.ewram16.subarray(PAL_UNFADED_OFFSET, PAL_UNFADED_OFFSET + 512);
      this.gbaTex.update();
      this.overworld.sync(st, this.webgl);
      const dispcnt = this.gba.bus.io16[0];
      this.spriteAtlas.update(this.webgl, st.sprites, (dispcnt & 0x40) === 0);
      // the inflation field of this same atlas (the actors sample both); Retro draws cards only
      if (this.overworld.worldStyle === 'modern') {
        this.spriteField.update(this.webgl, this.spriteAtlas.target.texture, this.spriteAtlas.slotRects, this.spriteAtlas.slotCount);
      }
      this.hud.updateOverlay();
      this.hud.setSprites(st.sprites.filter((s) => !s.coordOffset && !s.invisible && this.classifier.kind(s) !== SpriteKind.Hidden), this.spriteAtlas);
    } else if (this.presented === 'battle') {
      // (every battle program compiled before the first battle frame: at boot, or here at the latest — never in an
      // overworld frame)
      this.battle.finishPrecompile(this.webgl);
      this.gbaTex.paletteSource = null;
      this.gbaTex.update();
      const dispcnt = this.gba.bus.io16[0];
      this.spriteAtlas.update(this.webgl, st.sprites, (dispcnt & 0x40) === 0);
      this.hud.updateOverlay();
    } else {
      this.gbaTex.paletteSource = null;
      this.screen.update();
    }
    // Overlay layers for the next emulated frame: overworld text = BG0; battle UI = BG0-2.
    this.gba.ppu.overlayMask = this.presented === 'battle' ? 0x07 : 0x01;
  }

  /** Global fade (warps, battle starts/ends): the GBA fades its palettes; we fade the frame. */
  private renderFade(r: THREE.WebGLRenderer): void {
    const st = this.state;
    const k = st.fadeY / 16;
    if (k <= 0) return;
    const mat = this.fade.material as THREE.MeshBasicMaterial;
    const c = st.fadeColor;
    mat.color.setRGB((c & 31) / 31, ((c >> 5) & 31) / 31, ((c >> 10) & 31) / 31, THREE.SRGBColorSpace);
    mat.opacity = k;
    r.autoClear = false;
    r.render(this.fadeScene, this.fadeCamera);
    r.autoClear = true;
  }

  /**
   * Deterministic stepping: every render() advances `dt` seconds and a virtual clock (for the
   * battle transition) instead of reading performance.now(). null restores wall-clock time.
   */
  setFixedTimestep(dt: number | null): void {
    this.fixedDt = dt;
    this.lastTime = performance.now();
  }

  /** Render statistics of the last render() call, all passes together; the session's world builds, the last one's ms
   *  and the syncs deferred during map loads. */
  stats(): { calls: number; triangles: number; programs: number; builds: number; lastBuildMs: number; deferredSyncs: number } {
    const info = this.webgl.info;
    return {
      calls: info.render.calls, triangles: info.render.triangles, programs: info.programs?.length ?? 0,
      builds: this.overworld.builds, lastBuildMs: this.overworld.lastBuildMs, deferredSyncs: this.syncGate.deferred,
    };
  }

  /** Resolves when the overworld's and the battle's precompiles' parallel compiles are done (or failed: logged). */
  precompiled(): Promise<void> {
    return Promise.all([this.overworld.precompile(this.webgl), this.battle.precompile(this.webgl)]).then(() => undefined);
  }

  /**
   * Draws the overworld's and the battle's precompile frames now (once each; they block while the rest compiles:
   * shadow-depth, PostFX passes), then compiles the renderer-level programs nothing else precompiles (compileScreens),
   * then clears the canvas it painted. main.ts calls it while the loader still covers the page, before anything runs (the
   * harness's battle entry and exit walks in their eval); without it the first overworld sync draws the overworld's frame,
   * before the first world build, and the first battle sync the battle's — never an overworld frame.
   */
  finishPrecompile(): void {
    this.overworld.finishPrecompile(this.webgl);
    this.battle.finishPrecompile(this.webgl);
    this.compileScreens();
    this.webgl.setRenderTarget(null);
    this.webgl.clear();
  }

  /**
   * Compiles (once) what the views' precompiles leave to first use, so a battle's entry and exit compile nothing (the
   * battle_enter / battle_exit walks): the fade quad (a palette fade: a battle's end, a warp), ScreenView (its blur pass and
   * screen quad: the `screen2d` frames of the transition after a battle), the HUD (overlay and sprites: first drawn after a
   * wild battle's transition) and the battle transition effect. Each is drawn once as at run time, on the canvas (a render
   * target would compile other variants: linear output, no tone mapping) — invisibly (the fade at opacity 0, the effect at
   * progress 0, no HUD sprites) or cleared by finishPrecompile.
   */
  private compileScreens(): void {
    if (this.screensCompiled) return;
    this.screensCompiled = true;
    const r = this.webgl;
    const auto = r.autoClear;
    try {
      r.setRenderTarget(null);
      r.autoClear = false;
      r.render(this.fadeScene, this.fadeCamera);
      this.transitionFx.precompile(r);
      this.hud.render(r);
      this.screen.precompile(r);
    } catch (e) {
      console.warn('[render] precompiling the screen programs failed (they compile on first use instead)', e);
    } finally {
      r.autoClear = auto;
      r.setRenderTarget(null);
    }
  }

  /**
   * Whether this render skips its sync with the emulator: the overworld is presented, the game is loading a map
   * (crossing a connection, or a warp's loading frames) and the sync would rebuild the world from it — the previous
   * frame's state is drawn once more instead, the world built once, from the finished map (SyncGate: at most
   * MAX_DEFERRED_FRAMES emulated frames in a row, 3 for a crossing, 30 for a warp's faded-out loading frames).
   */
  private deferSync(): boolean {
    return this.syncGate.defer(
      () => (this.presented === 'overworld' && this.mode !== 'classic' ? mapLoadInProgress(this.gba.cpu, this.state.mem) : null),
      () => {
        const p = (this.probe ??= new GameState(this.gba.bus));
        p.update();
        // (a scene the overworld is not synced in builds nothing)
        return p.scene !== 'battle' && p.scene !== 'screen2d' && this.overworld.wouldRebuild(p);
      },
      this.gba.frameCount,
    );
  }

  /** The field is computed in the Modern overworld only: the self-test and the dump need it current. */
  private checkFieldLive(): void {
    if (this.presented !== 'overworld' || this.overworld.worldStyle !== 'modern') {
      throw new Error(`the inflation field is computed in the Modern overworld only (now: ${this.presented}, ${this.overworld.worldStyle})`);
    }
  }

  /** Actor self-test (harness --selftest): the last frame's field vs the CPU reference of its atlas, and the
   *  xBR shader vs its CPU reference on a fixture. */
  actorSelfTest(): Promise<ActorSelfTest> {
    this.checkFieldLive();
    return actorSelfTest(this.webgl, this.spriteAtlas, this.spriteField);
  }

  /** The used slots of the inflation field as a grey PNG data URL (harness --selftest: _field_<entry>.png). */
  actorFieldDump(): string {
    this.checkFieldLive();
    return fieldDump(this.webgl, this.spriteAtlas, this.spriteField);
  }

  render(_dtMs: number): void {
    this.webgl.info.reset();
    // a throw inside an earlier frame's PostFX pass leaves its offscreen target bound and autoClear off:
    // start every frame from the canvas, so classic 2D (V) still shows up after such a failure
    this.webgl.setRenderTarget(null);
    this.webgl.autoClear = true;
    let now: number, dt: number;
    if (this.fixedDt !== null) {
      dt = this.fixedDt;
      now = this.virtualNow += dt * 1000;
    } else {
      now = performance.now();
      dt = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;
    }
    // (a deferred sync stays due: the next render syncs)
    if ((this.emulatedSinceRender > 0 || this.resync) && !this.deferSync()) {
      this.syncFromEmulator();
      this.emulatedSinceRender = 0;
      this.resync = false;
    }
    const r = this.webgl;
    if (this.presented === 'overworld') {
      this.overworld.update(this.state, dt, this.cameraInput);
      this.cameraInput.yaw = this.cameraInput.pitch = this.cameraInput.zoom = 0;
      r.autoClear = true;
      const tp = this.transitionFx.update(this.inBattleTransition, now, this.width / this.height);
      this.overworld.battleZoom = tp;
      this.post.setCamera(this.overworld.scene, this.overworld.camera);
      this.post.render(dt);
      this.renderFade(r);
      this.transitionFx.render(r);
      if (!this.inBattleTransition) this.hud.render(r);
    } else if (this.presented === 'battle') {
      this.battleHud.length = 0;
      this.battle.update(this.state, dt, this.cameraInput, this.battleHud);
      this.cameraInput.yaw = this.cameraInput.pitch = this.cameraInput.zoom = 0;
      this.hud.setSprites(this.battleHud, this.spriteAtlas);
      this.post.setCamera(this.battle.scene, this.battle.camera);
      this.post.render(dt);
      this.renderFade(r);
      this.hud.render(r);
    } else {
      this.screen.render(r);
    }
  }
}
