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
import { PostFX, type Quality } from './post';
import { BattleView } from './battle/battleView';
import { BattleTransitionFx } from './transition';
import { SpriteClassifier, SpriteKind } from '../game/spriteKinds';

export type ViewMode = 'auto' | 'classic';

const PAL_UNFADED_OFFSET = (SYM.gPlttBufferUnfaded & 0x3ffff) >>> 1;

export class Renderer {
  readonly webgl: THREE.WebGLRenderer;
  readonly state: GameState;
  private screen: ScreenView;
  private gbaTex: GbaTextures;
  private spriteAtlas: SpriteAtlas;
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
  /** Scene actually presented (transition frames keep the previous one). */
  presented: 'overworld' | 'battle' | 'screen2d' = 'screen2d';
  private transitionFx = new BattleTransitionFx();
  private classifier: SpriteClassifier;
  private inBattleTransition = false;
  private battleHud: import('../game/state').SpriteSnap[] = [];
  private emulatedSinceRender = 0;
  cameraInput = { yaw: 0, pitch: 0, zoom: 0 };

  constructor(private canvas: HTMLCanvasElement, private gba: Gba, quality: Quality = 'medium') {
    this.webgl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.webgl.toneMapping = THREE.NeutralToneMapping;
    this.webgl.toneMappingExposure = 1.0;
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;

    this.state = new GameState(gba.bus);
    this.screen = new ScreenView(gba.ppu.framebuffer);
    this.gbaTex = new GbaTextures(gba.bus);
    this.spriteAtlas = new SpriteAtlas(this.gbaTex);
    this.overworld = new OverworldView(this.gbaTex, this.spriteAtlas, this.webgl.capabilities.getMaxAnisotropy());
    this.battle = new BattleView(this.spriteAtlas);
    this.classifier = new SpriteClassifier(this.state.mem);
    this.overworld.classifier = this.classifier;
    gba.ppu.overlayMask = 0x01; // BG0: text boxes and menus
    this.hud = new Hud(gba.ppu.overlay, this.spriteAtlas);
    const q = new URLSearchParams(location.search).get('quality') ?? quality;
    this.quality = q === 'low' || q === 'high' ? q : 'medium';
    this.overworld.quality = this.quality;
    this.post = new PostFX(this.webgl, this.overworld.scene, this.overworld.camera, this.quality);
    this.fade.frustumCulled = false;
    this.fadeScene.add(this.fade);
    window.addEventListener('resize', () => this.resize());
    this.resize();
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
    // The scene is drawn into the composer's target, which EffectComposer scales by the pixel
    // ratio once more — size the occlusion fade from that target, not the drawing buffer.
    const rt = this.post.composer.renderTarget1;
    this.overworld.setBufferSize(rt.width, rt.height);
    this.battle.resize(this.width / this.height);
  }

  setEffects(tiltShift: boolean, bloom: boolean): void {
    this.post.setEnabled(tiltShift, bloom);
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
      this.hud.updateOverlay();
      this.hud.setSprites(st.sprites.filter((s) => !s.coordOffset && !s.invisible && this.classifier.kind(s) !== SpriteKind.Hidden), this.spriteAtlas);
    } else if (this.presented === 'battle') {
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

  render(_dtMs: number): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTime) / 1000);
    this.lastTime = now;
    if (this.emulatedSinceRender > 0) {
      this.syncFromEmulator();
      this.emulatedSinceRender = 0;
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
