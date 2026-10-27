import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import {
  battleRoute, battleCardSpec, battleDecalSpec, battleFadeOverlay, battlerAlphaKey, battlerPaletteKey, isBattler, BattleActors,
} from '../src/render/battle/battleActors';
import { STAGE, REF_PITCH } from '../src/render/battle/stage';
import { blankSprite } from '../src/render/previewActors';
import { SYM } from '../src/game/symbols';
import type { SpriteSnap } from '../src/game/state';
import { previewBattleSprites } from '../src/render/battlePreview';

const slot = { u0: 0, v0: 0.125, u1: 0.0625, v1: 0 };
const battler = (index: number, screenX: number, screenY: number) => blankSprite({ index, template: SYM.gMultiuseSpriteTemplate,
  width: 64, height: 64, affine: true, coordOffset: false, screenX, screenY });
const effect = (index: number, screenX: number) => blankSprite({ index, template: 0x08590000, width: 32, height: 32, coordOffset: false, screenX, screenY: 40 });
const shadow = blankSprite({ index: 2, template: SYM.gSpriteTemplate_EnemyShadow, width: 32, height: 8, coordOffset: false, screenX: 160, screenY: 65 });

describe('battleCardSpec (today\'s placement)', () => {
  it('stands a battler on its side\'s depth plane, stretched by 1/cos(pitch)', () => {
    const s = battleCardSpec(battler(0, 40, 53), slot, STAGE);
    const centre = STAGE.at(72, 85, STAGE.playerDepth);
    const h = 2 / Math.cos(REF_PITCH);
    expect(s).toMatchObject({ width: 2, lift: 0, flat: false });
    expect(s.height).toBeCloseTo(h, 6);
    expect(s.footX).toBeCloseTo(centre.x, 6); expect(s.footY).toBeCloseTo(centre.y - h / 2, 6); expect(s.footZ).toBeCloseTo(centre.z, 6);
  });
  it('interpolates an effect\'s depth between the platforms and wraps screen x like the GBA', () => {
    const mid = (STAGE.playerDepth + STAGE.enemyDepth) / 2;
    expect(battleCardSpec(effect(1, 108), slot, STAGE).footZ).toBeCloseTo(STAGE.at(124, 56, mid).z, 6);
    expect(battleCardSpec(effect(1, 500), slot, STAGE).footX).toBeCloseTo(STAGE.at(-12 + 16, 56, STAGE.playerDepth).x, 6);
  });
});

describe('battleDecalSpec (the enemy shadow on the platform)', () => {
  it('lays the sprite\'s screen rectangle on the platform top: x at its centre\'s ground hit, z spanning its edges\' ground hits', () => {
    const d = battleDecalSpec(shadow, slot, STAGE);
    const top = STAGE.groundHit(176, 65), bottom = STAGE.groundHit(176, 73);
    expect(d.flat).toBe(true);
    expect(d.footX).toBeCloseTo(top.x, 6);
    expect(d.width).toBeCloseTo(32 / 32, 6);
    // (a flat card covers footZ − height .. footZ: the nearer edge is the screen rectangle's bottom)
    expect(d.footZ).toBeCloseTo(bottom.z, 6);
    expect(d.footZ - d.height).toBeCloseTo(top.z, 6);
    expect(d.height).toBeGreaterThan(0);
  });
  it('keeps the sprite\'s uv as it is: the flat card puts its top row (v0) on the far edge (Billboards)', () => {
    expect(battleDecalSpec(shadow, slot, STAGE).slot).toEqual(slot);
  });
  it('lays both enemy shadows of a double battle flat, each under its own floating opponent', () => {
    const s = previewBattleSprites([0, 1, 2, 3].map((position) => ({ pic: { tiles: new Uint8Array(2048), palette: new Uint16Array(16),
      yOffset: 0, elevation: position & 1 ? 4 : 0 }, position })), true);
    const atlas = { slots: new Map(s.map((x) => [x.index, slot])), target: { texture: new THREE.Texture() } };
    const a = new BattleActors(atlas, { field: { texture: new THREE.Texture() } });
    a.update(s, 'modern', new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 3, 11), new THREE.Color(1, 1, 1), []);
    expect(a.counts()).toEqual({ cards: 0, inflated: 4, decals: 2 });
    const [d1, d3] = s.slice(4).map((x) => battleDecalSpec(x, slot, STAGE));
    // under opponents 1 (right, screen x 200) and 3 (left, 152), on the platform top
    for (const [d, shadowSprite] of [[d1, s[4]], [d3, s[5]]] as const) {
      expect(d.footY).toBe(0);
      expect(d.footX).toBeCloseTo(STAGE.groundHit(shadowSprite.screenX + 16, shadowSprite.screenY + 4).x, 6);
    }
    expect(d1.footX).toBeGreaterThan(d3.footX);
    expect(d1.footZ).not.toBeCloseTo(d3.footZ, 3);
  });
});

describe('battleRoute', () => {
  it('Modern inflates battlers, lays the enemy shadow flat, skips OBJ-window masks; Retro draws cards', () => {
    const b = battler(0, 40, 53);
    expect(battleRoute(b, 'modern', true)).toBe('inflated');
    expect(battleRoute(b, 'modern', false)).toBe('card');
    expect(battleRoute(b, 'retro', true)).toBe('card');
    expect(battleRoute({ ...b, objMode: 2 }, 'modern', true)).toBe('skip');
    expect(battleRoute({ ...b, objMode: 2 }, 'retro', true)).toBe('card');     // today's (the GBA never shows it)
    expect(battleRoute(shadow, 'modern', true)).toBe('decal');
    expect(battleRoute(shadow, 'retro', true)).toBe('card');
    expect(battleRoute(effect(1, 108), 'modern', true)).toBe('card');
  });
  it('skips invisible sprites and hands HUD sprites to the HUD in both styles', () => {
    expect(isBattler(battler(0, 40, 53))).toBe(true);
    for (const style of ['retro', 'modern'] as const) {
      expect(battleRoute(blankSprite({ invisible: true }), style, true)).toBe('skip');
      expect(battleRoute(blankSprite({ template: 0x0832c140 }), style, true)).toBe('hud');   // a healthbox
    }
  });
});

describe('battler copies on BG layers (a move\'s monbg)', () => {
  // (which battlers GameState lists as copied, by emulated frames: tests/monBgCopies.test.ts)
  it('Modern hides a battler while its flat copy shows on the overlay (no duplicate); Retro and the cards baseline as today', () => {
    const b = battler(4, 144, 23);
    expect(battleRoute(b, 'modern', true, true)).toBe('skip');
    expect(battleRoute(b, 'modern', true, false)).toBe('inflated');
    expect(battleRoute(b, 'retro', true, true)).toBe('card');
    expect(battleRoute(b, 'modern', false, true)).toBe('card');
    const atlas = { slots: new Map([[0, slot], [4, slot]]), target: { texture: new THREE.Texture() } };
    const a = new BattleActors(atlas, { field: { texture: new THREE.Texture() } });
    a.update([battler(0, 40, 53), b], 'modern', new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 3, 11), new THREE.Color(1, 1, 1), [], [4]);
    expect(a.counts()).toEqual({ cards: 0, inflated: 1, decals: 0 });
  });
});

describe('battlerAlphaKey (when the battlers\' field must be recomputed)', () => {
  it('changes with the tiles the atlas bakes a battler from, its size, tile number and flips, never with its palette', () => {
    const vram = new Uint8Array(0x18000);
    const b = { ...battler(0, 40, 53), tileNum: 64 };
    const k = battlerAlphaKey(b, vram, false);
    expect(battlerAlphaKey({ ...b, palette: 3, screenX: 90, y2: 6 }, vram, false)).toBe(k);   // colour, position: the same
    vram[0x10000 + 64 * 32 + 5] = 0x10;                                                          // a pixel of its first tile
    const k2 = battlerAlphaKey(b, vram, false);
    expect(k2).not.toBe(k);
    vram[0x10000 + 200 * 32] = 0x11;                                                             // another sprite's tile
    expect(battlerAlphaKey(b, vram, false)).toBe(k2);
    vram[0x10000 + (64 + 63) * 32 + 31] = 0x01;                                                  // its last tile (64 tiles, 4bpp)
    expect(battlerAlphaKey(b, vram, false)).not.toBe(k2);
    for (const other of [{ ...b, tileNum: 0 }, { ...b, hflip: true }, { ...b, width: 32 }, { ...b, bpp8: true }]) {
      expect(battlerAlphaKey(other, vram, false)).not.toBe(battlerAlphaKey(b, vram, false));
    }
    expect(battlerAlphaKey(b, vram, true)).not.toBe(battlerAlphaKey(b, vram, false));           // 2D tile mapping
  });
  it("hashes the full colour indices, not only the silhouette: the baked xBR decisions compare colours (re-baked with it)", () => {
    const vram = new Uint8Array(0x18000);
    const b = { ...battler(0, 40, 53), tileNum: 64 };
    vram[0x10000 + 64 * 32 + 5] = 0x10;                                                          // a pixel at colour index 1
    const k = battlerAlphaKey(b, vram, false);
    vram[0x10000 + 64 * 32 + 5] = 0x20;                                                          // the same pixel, index 2: as opaque
    expect(battlerAlphaKey(b, vram, false)).not.toBe(k);
    // (and the same tiles hash alike in a subsprite piece: its offset into the tiles)
    const pieces = [{ x: 0, y: 0, width: 32, height: 32, tileOffset: 0 }, { x: 32, y: 0, width: 32, height: 32, tileOffset: 16 }];
    const kp = battlerAlphaKey({ ...b, pieces }, vram, false);
    vram[0x10000 + (64 + 16) * 32 + 2] = 0x03;                                                  // the second piece's first tile
    expect(battlerAlphaKey({ ...b, pieces }, vram, false)).not.toBe(kp);
  });
});

describe('battlerPaletteKey (when the battlers\' baked xBR decisions must be recomputed)', () => {
  it('changes with the colours of the battler\'s OBJ palette (a fade, a flash), not with another palette', () => {
    const pram = new Uint16Array(512);
    const b = { ...battler(0, 40, 53), palette: 1 };
    const k = battlerPaletteKey(b, pram);
    pram[256 + 2 * 16 + 3] = 0x7fff;                      // OBJ palette 2: not its own
    expect(battlerPaletteKey(b, pram)).toBe(k);
    pram[256 + 16 + 3] = 0x1234;                          // its own, colour 3
    expect(battlerPaletteKey(b, pram)).not.toBe(k);
    const k8 = battlerPaletteKey({ ...b, bpp8: true }, pram);
    pram[256 + 200] = 0x0421;                             // 8 bpp: all 256 OBJ colours count
    expect(battlerPaletteKey({ ...b, bpp8: true }, pram)).not.toBe(k8);
  });
});

describe('battleFadeOverlay (the palette fade over the 3D battle)', () => {
  it('Modern: an OBJ-palette-only normal fade (the intro darkening the wild Pokémon) dims no 3D frame; Retro: as today', () => {
    const intro = { fadeY: 10, fadeMode: 0, fadePalettes: 0x20000 };          // BeginNormalPaletteFade(0x20000, 0, 10, 10, …)
    expect(battleFadeOverlay(intro, 'modern')).toBe(0);
    expect(battleFadeOverlay(intro, 'retro')).toBe(10 / 16);
    // a fade of every palette (the battle's start and end), one with BG palettes, a fast or hardware fade: the whole frame
    for (const f of [{ fadePalettes: 0xffffffff }, { fadePalettes: 0x00010000 | 0x1 }, { fadePalettes: 0x20000, fadeMode: 1 },
      { fadePalettes: 0x20000, fadeMode: 2 }]) {
      expect(battleFadeOverlay({ fadeY: 8, fadeMode: 0, ...f }, 'modern')).toBe(0.5);
    }
  });
});

describe('BattleActors', () => {
  it('draws today\'s cards in sprite order and hands HUD sprites back', () => {
    const atlas = { slots: new Map([[0, slot], [1, slot], [2, slot]]), target: { texture: new THREE.Texture() } };
    const a = new BattleActors(atlas);
    const hud: ReturnType<typeof blankSprite>[] = [];
    const hb = blankSprite({ index: 2, template: 0x0832c140 });
    a.update([battler(0, 40, 53), effect(1, 108), hb], 'retro', new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 3, 11), new THREE.Color(1, 1, 1), hud);
    expect(a.counts()).toEqual({ cards: 2, inflated: 0, decals: 0 });
    expect(hud).toEqual([hb]);
  });
  it('routes a battle frame per style, four battlers in a double battle', () => {
    const atlas = { slots: new Map([0, 1, 2, 3, 4, 5].map((i) => [i, slot])), target: { texture: new THREE.Texture() } };
    const a = new BattleActors(atlas, { field: { texture: new THREE.Texture() } });
    const hud: SpriteSnap[] = [];
    const args = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 3, 11), new THREE.Color(1, 1, 1), hud] as const;
    const single = [battler(0, 40, 53), battler(1, 144, 23), shadow, effect(3, 108)];
    a.update(single, 'modern', ...args); expect(a.counts()).toEqual({ cards: 1, inflated: 2, decals: 1 });
    a.update(single, 'retro', ...args);  expect(a.counts()).toEqual({ cards: 4, inflated: 0, decals: 0 });
    const double = [battler(0, 0, 48), battler(1, 168, 8), battler(2, 58, 56), battler(3, 120, 0)];
    a.update(double, 'modern', ...args); expect(a.counts().inflated).toBe(4);
    const decal = battleDecalSpec(shadow, slot, STAGE);
    expect(decal.flat).toBe(true); expect(decal.footY).toBeCloseTo(0, 6);
  });
  it('keeps the cards and the inflated battlers out of override passes on their own programs (no override variant to compile)', () => {
    const atlas = { slots: new Map([[0, slot]]), target: { texture: new THREE.Texture() } };
    const a = new BattleActors(atlas, { field: { texture: new THREE.Texture() } });
    const meshes: THREE.Mesh[] = [];
    a.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.map((m) => m.name).sort()).toEqual(['battleCards', 'battleInflated']);
    const r = {} as THREE.WebGLRenderer, cam = new THREE.Camera(), scene = new THREE.Scene();
    for (const m of meshes) {
      const own = m.material as THREE.Material, g = m.geometry as THREE.InstancedBufferGeometry;
      // (three then draws the mesh with its own material in the override pass: the main pass's program)
      expect(own.allowOverride, m.name).toBe(false);
      g.instanceCount = 3;
      scene.overrideMaterial = new THREE.MeshNormalMaterial();
      m.onBeforeRender(r, scene, cam, g, own, null as unknown as THREE.Group);
      expect(g.instanceCount, m.name).toBe(0);
      m.onAfterRender(r, scene, cam, g, own, null as unknown as THREE.Group);
      expect(g.instanceCount, m.name).toBe(3);
      scene.overrideMaterial = null;
      m.onBeforeRender(r, scene, cam, g, own, null as unknown as THREE.Group);
      expect(g.instanceCount, m.name).toBe(3);
      g.instanceCount = 5; // (the next frame's count, set between passes)
      m.onAfterRender(r, scene, cam, g, own, null as unknown as THREE.Group);
      expect(g.instanceCount, m.name).toBe(5);
    }
  });
  it('gives a sprite scaled to nothing (affine growth at send-out) finite card and decal specs', () => {
    const finite = (s: ReturnType<typeof battleCardSpec>) => [s.footX, s.footY, s.footZ, s.width, s.height, s.lift].every(Number.isFinite);
    expect(finite(battleCardSpec({ ...battler(0, 40, 53), scaleX: 0, scaleY: 0 }, slot, STAGE))).toBe(true);
    expect(finite(battleDecalSpec({ ...shadow, scaleX: 0, scaleY: 0 }, slot, STAGE))).toBe(true);
  });
  it('falls back to instance attributes when the battle variant\'s uniform-array programs did not link (only then, once)', () => {
    const atlas = { slots: new Map([[0, slot]]), target: { texture: new THREE.Texture() } };
    const a = new BattleActors(atlas, { field: { texture: new THREE.Texture() } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failed = (key: string) => [{ cacheKey: `x,${key}`, diagnostics: { runnable: false } }];
    const meshes = () => a.group.children.filter((o) => o.name === 'battleInflated') as THREE.Mesh[];
    expect(a.checkInstanceUniforms(failed('actor:inflated:1:uniforms'))).toBe(false);   // the overworld's: not ours
    expect(a.checkInstanceUniforms(failed('actor:inflated-battle-depth:1:uniforms'))).toBe(true);
    expect(meshes()).toHaveLength(1);
    expect((meshes()[0].material as THREE.Material).customProgramCacheKey()).toBe('actor:inflated-battle:1:attributes');
    expect(a.checkInstanceUniforms(failed('actor:inflated-battle:1:uniforms'))).toBe(false); // already on attributes
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    a.update([battler(0, 40, 53)], 'modern', new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 3, 11), new THREE.Color(1, 1, 1), []);
    expect(a.counts().inflated).toBe(1);
  });
  it('without an inflation field (or with inflation off) a Modern battle draws cards only', () => {
    const atlas = { slots: new Map([0, 1, 2].map((i) => [i, slot])), target: { texture: new THREE.Texture() } };
    const args = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 3, 11), new THREE.Color(1, 1, 1), [] as SpriteSnap[]] as const;
    const frame = [battler(0, 40, 53), battler(1, 144, 23), shadow];
    const plain = new BattleActors(atlas);
    plain.update(frame, 'modern', ...args);
    expect(plain.counts()).toEqual({ cards: 3, inflated: 0, decals: 0 });
    const a = new BattleActors(atlas, { field: { texture: new THREE.Texture() } });
    a.inflation = false;
    a.update(frame, 'modern', ...args);
    expect(a.counts()).toEqual({ cards: 3, inflated: 0, decals: 0 });
    a.inflation = true;
    a.update(frame, 'modern', ...args);
    expect(a.counts()).toEqual({ cards: 0, inflated: 2, decals: 1 });
  });
});
