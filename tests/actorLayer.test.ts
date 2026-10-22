import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SpriteKind, type SpriteClassifier } from '../src/game/spriteKinds';
import type { GameState, ObjectEventSnap, SpriteSnap } from '../src/game/state';
import { routeSprite, cardSpec, uprightFoot, ActorLayer, skipOverridePasses, type ActorFrame } from '../src/render/actors/actorLayer';
import { inflateMax } from '../src/render/actors/inflateMath';
import type { SpritePixelSource } from '../src/render/actors/spriteColors';
import { createKitUniforms } from '../src/render/kit/materials';
import { bgr555ToSrgb, toLinear } from '../src/render/kit/palette';
import { blankSprite } from '../src/render/previewActors';

const slot = { u0: 0, v0: 0.0625, u1: 0.015625, v1: 0 };

describe('routeSprite', () => {
  it('Retro draws every visible sprite as a card', () => {
    for (const k of [SpriteKind.Upright, SpriteKind.Flat, SpriteKind.Grass])
      for (const mapped of [false, true]) expect(routeSprite(k, 'retro', mapped)).toBe('card');
    expect(routeSprite(SpriteKind.Hidden, 'retro', false)).toBe('skip');
  });
  it('Modern inflates uprights, models mapped objects, keeps decals and grass as cards', () => {
    expect(routeSprite(SpriteKind.Upright, 'modern', false)).toBe('inflated');
    expect(routeSprite(SpriteKind.Upright, 'modern', true)).toBe('model');
    expect(routeSprite(SpriteKind.Flat, 'modern', true)).toBe('card');
    expect(routeSprite(SpriteKind.Grass, 'modern', false)).toBe('card');
    expect(routeSprite(SpriteKind.Hidden, 'modern', true)).toBe('skip');
  });
});

describe('cardSpec', () => {
  const s = blankSprite({ worldX: 40, worldY: 64, width: 16, height: 32 });
  it('stands uprights on the cell centre, at the cell height', () => {
    expect(cardSpec(s, SpriteKind.Upright, slot, () => 2)).toMatchObject(
      { footX: 2.5, footY: 2, footZ: 5.5, width: 1, height: 2, lift: 0, flat: false });
  });
  it('lays flats on their rectangle and puts grass in front of the legs', () => {
    expect(cardSpec(s, SpriteKind.Flat, slot, () => 0)).toMatchObject({ footZ: 4, flat: true });
    expect(cardSpec(s, SpriteKind.Grass, slot, () => 0).footZ).toBeCloseTo(3.56);
  });
  it('lifts jumping sprites by -y2', () => {
    expect(cardSpec(blankSprite({ worldX: 40, worldY: 64, y2: -8 }), SpriteKind.Upright, slot, () => 0).lift).toBe(0.5);
  });
  it('shares its upright foot with uprightFoot (the camera target)', () => {
    const heightAt = (x: number, y: number) => x * 0.1 + y;
    for (const p of [{ worldX: 40, worldY: 64 }, { worldX: 47, worldY: 71 }, { worldX: 33, worldY: 57 }]) {
      const sp = blankSprite(p);
      const c = cardSpec(sp, SpriteKind.Upright, slot, heightAt);
      expect(uprightFoot(sp, heightAt)).toEqual({ x: c.footX, y: c.footY, z: c.footZ });
    }
  });
});

describe('skipOverridePasses', () => {
  it('draws no instance in a pass with an override material (the GTAO prepass), its own material untouched', () => {
    const g = new THREE.InstancedBufferGeometry();
    g.instanceCount = 3;
    const own = new THREE.MeshBasicMaterial(), override = new THREE.MeshNormalMaterial();
    const mesh = new THREE.Mesh(g, own);
    skipOverridePasses(mesh);
    const r = {} as THREE.WebGLRenderer, scene = new THREE.Scene(), cam = new THREE.Camera();
    mesh.onBeforeRender(r, scene, cam, g, override, null as unknown as THREE.Group);
    expect(g.instanceCount).toBe(0);
    mesh.onAfterRender(r, scene, cam, g, override, null as unknown as THREE.Group);
    expect(g.instanceCount).toBe(3);
    mesh.onBeforeRender(r, scene, cam, g, own, null as unknown as THREE.Group);
    expect(g.instanceCount).toBe(3);
    g.instanceCount = 5; // (the next frame's count, set between passes)
    mesh.onAfterRender(r, scene, cam, g, own, null as unknown as THREE.Group);
    expect(g.instanceCount).toBe(5);
  });
  it('covers every mesh of the layer that places its instances in its own shader (not the models)', () => {
    const layer = new ActorLayer({ slots: new Map(), target: { texture: new THREE.Texture() } }, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });
    const meshes: THREE.Mesh[] = [];
    layer.group.traverse((o) => { if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) meshes.push(o as THREE.Mesh); });
    expect(meshes.length).toBe(4);
    for (const m of meshes) expect(m.onBeforeRender).not.toBe(THREE.Object3D.prototype.onBeforeRender);
  });
});

describe('ActorLayer', () => {
  // sprite index -> kind (the classifier's answer); unlisted indices are uprights
  const kinds = new Map<number, SpriteKind>();
  const classifier = { kind: (s: SpriteSnap) => kinds.get(s.index) ?? SpriteKind.Upright } as unknown as SpriteClassifier;
  const slots = new Map<number, typeof slot>();
  const layer = new ActorLayer({ slots, target: { texture: new THREE.Texture() } });
  const meshes = layer.group.children as THREE.Mesh[];
  const cards = meshes.find((m) => m.renderOrder === 2)!;
  const blobs = meshes.find((m) => m.renderOrder === 1)!;
  const count = (m: THREE.Mesh) => (m.geometry as THREE.InstancedBufferGeometry).instanceCount;
  const foot = (i: number) => (cards.geometry.getAttribute('aFoot') as THREE.InstancedBufferAttribute).array.slice(i * 3, i * 3 + 3);
  const frame = (style: 'modern' | 'retro', blades = false): ActorFrame => ({
    style, classifier, heightAt: () => 1, hasGrassBlades: () => blades,
    cameraRight: new THREE.Vector3(1, 0, 0), charLight: new THREE.Color(1, 1, 1),
  });
  const state = (sprites: SpriteSnap[]) => ({ sprites }) as unknown as GameState;
  const at = (index: number, p: Partial<SpriteSnap> = {}) => blankSprite({ index, worldX: 40, worldY: 64, ...p });

  it('holds the billboards and their blob shadows', () => {
    expect(cards).toBeDefined();
    expect(blobs).toBeDefined();
  });

  it('draws visible sprites in order and returns the feet of everything but flat decals', () => {
    kinds.clear(); slots.clear();
    for (const i of [0, 1, 2, 3, 4, 5, 6]) slots.set(i, slot);
    kinds.set(1, SpriteKind.Flat); kinds.set(2, SpriteKind.Grass); kinds.set(3, SpriteKind.Hidden);
    const sprites = [
      at(0, { worldX: 24 }),                  // upright
      at(1),                                  // flat decal: drawn, bends no grass
      at(2),                                  // grass overlay
      at(3),                                  // hidden (reflection, weather)
      at(4, { invisible: true }),
      at(5, { coordOffset: false }),          // HUD sprite
      at(7),                                  // not in the atlas
      at(6, { worldX: 72 }),
    ];
    const feet = layer.update(state(sprites), frame('retro'));
    expect(count(cards)).toBe(4);
    expect(count(blobs)).toBe(4);
    expect(Array.from(foot(0))).toEqual([1.5, 1, 4.5]);
    expect(Array.from(foot(1))).toEqual([2.5, 1, 5]);
    expect(Array.from(foot(3))).toEqual([4.5, 1, 4.5]);
    expect(feet.map((p) => [p.x, p.y, p.z])).toEqual([[1.5, 1, 4.5], [2.5, 1, 3.5 + 0.06 + 1], [4.5, 1, 4.5]]);
  });

  it('leaves out the grass overlay in Modern where 3D blades stand on its cell', () => {
    kinds.clear(); slots.clear();
    slots.set(0, slot); slots.set(1, slot);
    kinds.set(1, SpriteKind.Grass);
    const sprites = [at(0), at(1)];
    expect(layer.update(state(sprites), frame('modern', true))).toHaveLength(1);
    expect(count(cards)).toBe(1);
    expect(layer.update(state(sprites), frame('modern', false))).toHaveLength(2);
    expect(layer.update(state(sprites), frame('retro', true))).toHaveLength(2);
    expect(count(cards)).toBe(2);
  });

  it('rebuilds every list each frame, reusing one feet array', () => {
    kinds.clear(); slots.clear();
    slots.set(0, slot); slots.set(1, slot);
    const first = layer.update(state([at(0), at(1)]), frame('retro'));
    expect(first).toHaveLength(2);
    const empty = layer.update(state([]), frame('retro'));
    expect(empty).toBe(first);
    expect(empty).toHaveLength(0);
    expect(count(cards)).toBe(0);
    expect(count(blobs)).toBe(0);
  });

  it('accepts the classifier being unavailable (every sprite upright)', () => {
    kinds.clear(); slots.clear();
    kinds.set(0, SpriteKind.Flat);
    slots.set(0, slot);
    expect(layer.update(state([at(0)]), { ...frame('retro'), classifier: null })).toHaveLength(1);
  });
});

describe('ActorLayer with inflated actors', () => {
  const atlas = { slots: new Map([[0, slot], [1, slot]]), target: { texture: new THREE.Texture() } };
  const state = { sprites: [blankSprite({ index: 0, worldX: 40, worldY: 64 }), blankSprite({ index: 1, worldX: 56, worldY: 64 })],
    objects: [] } as unknown as GameState;
  const frame: Omit<ActorFrame, 'style'> = {
    classifier: { kind: (s: SpriteSnap) => (s.index === 0 ? SpriteKind.Upright : SpriteKind.Flat) } as unknown as SpriteClassifier,
    heightAt: () => 0, hasGrassBlades: () => false,
    cameraRight: new THREE.Vector3(1, 0, 0), charLight: new THREE.Color(1, 1, 1),
  };

  it('switching to Retro routes every sprite back to cards and empties the inflated mesh', () => {
    const layer = new ActorLayer(atlas, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });
    layer.update(state, { ...frame, style: 'modern' });
    expect(layer.counts()).toEqual({ cards: 1, inflated: 1, models: 0 });
    layer.update(state, { ...frame, style: 'retro' });
    expect(layer.counts()).toEqual({ cards: 2, inflated: 0, models: 0 });
  });

  it('hides the inflated mesh and its contact shadows in Retro', () => {
    const layer = new ActorLayer(atlas, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });
    const inflatedMeshes = () => (layer.group.children as THREE.Mesh[]).filter((m) => ['inflatedActors', 'contactShadows'].includes(m.name));
    layer.update(state, { ...frame, style: 'modern' });
    expect(inflatedMeshes().length).toBe(2);
    expect(inflatedMeshes().every((m) => m.visible)).toBe(true);
    layer.update(state, { ...frame, style: 'retro' });
    expect(inflatedMeshes().every((m) => !m.visible)).toBe(true);
  });

  const grass = { ...frame, classifier: { kind: (s: SpriteSnap) => (s.index === 0 ? SpriteKind.Upright : SpriteKind.Grass) } as unknown as SpriteClassifier };
  // the grass overlay's card foot (in Modern the only card here: the upright is inflated)
  const overlayCard = (layer: ActorLayer, i = 0) => {
    const cards = (layer.group.children as THREE.Mesh[]).find((m) => m.renderOrder === 2 && m.name !== 'inflatedActors')!;
    const a = cards.geometry.getAttribute('aFoot');
    return new THREE.Vector3(a.getX(i), a.getY(i), a.getZ(i));
  };

  it('bends the grass at every upright and overlay where the sprite stands (also in Modern)', () => {
    const layer = new ActorLayer(atlas, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });
    const modern = layer.update(state, { ...grass, style: 'modern' }).map((p) => p.z);
    expect(modern[0]).toBe(3.5);
    expect(modern[1]).toBeCloseTo(3.56);
    const retro = layer.update(state, { ...grass, style: 'retro' }).map((p) => p.z);
    expect(retro[1]).toBeCloseTo(3.56);
  });

  it('draws Modern grass overlays in front of the inflated legs, moved towards the eye along their view ray', () => {
    const layer = new ActorLayer(atlas, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });
    layer.update(state, { ...grass, style: 'modern' }); // no eye: far away horizontally
    expect(overlayCard(layer).z).toBeCloseTo(3.5 + 0.06 + inflateMax() / 16);
    const eye = new THREE.Vector3(1, 9, 14);
    layer.update(state, { ...grass, style: 'modern', cameraPosition: eye });
    const card = new THREE.Vector3(3.5, 0, 3.56); // today's overlay placement: it stays put on screen
    const moved = overlayCard(layer).sub(card);
    expect(moved.length()).toBeCloseTo(inflateMax() / 16);
    expect(moved.normalize().dot(eye.clone().sub(card).normalize())).toBeCloseTo(1);
    layer.update(state, { ...grass, style: 'retro', cameraPosition: eye });
    expect(overlayCard(layer, 1).z).toBeCloseTo(3.56); // (Retro: card 0 = the upright, card 1 = the overlay)
  });

  it('switches the inflated actors between HD smooth (default) and Pixel sprite edges, their shadow twin with them', () => {
    const layer = new ActorLayer(atlas, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });
    const mesh = (layer.group.children as THREE.Mesh[]).find((m) => m.name === 'inflatedActors')!;
    const smooth = () => (mesh.customDepthMaterial as THREE.ShaderMaterial).uniforms.uSmooth.value;
    expect(smooth()).toBe(1);
    layer.setSpriteFilter('pixel');
    expect(smooth()).toBe(0);
    layer.setSpriteFilter('smooth');
    expect(smooth()).toBe(1);
    new ActorLayer(atlas).setSpriteFilter('pixel'); // (no field, no inflated actors: nothing to switch)
  });

  it('draws characters as cards while inflation is off (the --ab baseline)', () => {
    const layer = new ActorLayer(atlas, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });
    layer.inflation = false;
    layer.update(state, { ...frame, style: 'modern' });
    expect(layer.counts()).toEqual({ cards: 2, inflated: 0, models: 0 });
    layer.inflation = true;
    layer.update(state, { ...frame, style: 'modern' });
    expect(layer.counts()).toEqual({ cards: 1, inflated: 1, models: 0 });
  });
});

describe('ActorLayer object models', () => {
  const atlas = { slots: new Map([[0, slot]]), target: { texture: new THREE.Texture() } };
  const upright: Omit<ActorFrame, 'style'> = {
    classifier: { kind: () => SpriteKind.Upright } as unknown as SpriteClassifier,
    heightAt: () => 0, hasGrassBlades: () => false,
    cameraRight: new THREE.Vector3(1, 0, 0), charLight: new THREE.Color(1, 1, 1),
  };
  const modern: ActorFrame = { ...upright, style: 'modern' };
  const newLayer = () => new ActorLayer(atlas, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });
  const state = (o: Partial<ObjectEventSnap> = {}, s: Partial<SpriteSnap> = {}, frame = 1) => ({
    frame,
    sprites: [blankSprite({ index: 0, worldX: 40, worldY: 64, ...s })],
    objects: [{ index: 0, spriteId: 0, graphicsId: 59, invisible: false, ...o }],
  }) as unknown as GameState;
  const mesh = (layer: ActorLayer, kind: string) => layer.group.getObjectByName(kind) as THREE.InstancedMesh;
  const placed = (layer: ActorLayer, kind: string, i = 0) => {
    const m = new THREE.Matrix4();
    mesh(layer, kind).getMatrixAt(i, m);
    return new THREE.Vector3().setFromMatrixPosition(m);
  };

  it('draws a mapped object as its model in Modern, not as a sprite', () => {
    const layer = newLayer();
    layer.update(state(), modern);
    expect(layer.counts()).toEqual({ cards: 0, inflated: 0, models: 1 });
  });
  it('draws a Cut tree being cut (animNum 1) as its inflated sprite', () => {
    const layer = newLayer();
    layer.update(state({ graphicsId: 82 }, { animNum: 1 }), modern);
    expect(layer.counts()).toMatchObject({ inflated: 1, models: 0 });
  });
  it('draws no model in Retro', () => {
    const layer = newLayer();
    layer.update(state(), { ...upright, style: 'retro' });
    expect(layer.counts()).toMatchObject({ cards: 1, models: 0 });
  });
  it('draws no model for an invisible object', () => {
    const layer = newLayer();
    layer.update(state({ invisible: true }), modern);
    expect(layer.counts()).toMatchObject({ models: 0 });
  });
  it('draws berry trees as their plant model', () => {
    const layer = newLayer();
    layer.update(state({ graphicsId: 60 }), modern);
    expect(layer.counts()).toMatchObject({ inflated: 0, models: 1 });
  });

  // ---- beyond the brief ----

  it('stands a model where its card stood, follows the sprite every frame and bends the grass there', () => {
    const layer = newLayer();
    const feet = layer.update(state({ graphicsId: 87 }), { ...modern, heightAt: () => 1 });
    expect(placed(layer, 'boulder').toArray()).toEqual([2.5, 1, 4.5]);
    expect(feet.map((p) => [p.x, p.y, p.z])).toEqual([[2.5, 1, 4.5]]);
    // pushed: the boulder slides with its sprite (mid-step, half a cell on)
    layer.update(state({ graphicsId: 87 }, { worldX: 48 }, 2), { ...modern, heightAt: () => 1 });
    expect(placed(layer, 'boulder').x).toBe(3);
  });
  it("stands the 48×48 truck on its own cells (its image's bottom, not its 32×32 base OAM's)", () => {
    const layer = newLayer();
    // gfx 94 at cell (2, 10): x = 40, worldY = y * 16 (live and preview), c2cY = −24
    const truck = state({ graphicsId: 94 }, { width: 32, height: 32, c2cY: -24, worldX: 40, worldY: 160 });
    layer.update(truck, { ...modern, heightAt: (_x, y) => (y > 10 ? 0.5 : 0) });
    expect(placed(layer, 'truck').toArray()).toEqual([2.5, 0.5, 11]); // row 10's centre (10.5) on row 10's ground
  });
  it('routes models back to cards while inflation is off (the --ab baseline: the pre-Task-5 path)', () => {
    const layer = newLayer();
    layer.inflation = false;
    layer.update(state(), modern);
    expect(layer.counts()).toEqual({ cards: 1, inflated: 0, models: 0 });
  });
  it('hides the models in Retro and clears them when their objects are gone', () => {
    const layer = newLayer();
    const group = layer.group.getObjectByName('objectModels')!;
    layer.update(state(), modern);
    expect(group.visible).toBe(true);
    layer.update(state(), { ...upright, style: 'retro' });
    expect(group.visible).toBe(false);
    expect(mesh(layer, 'pokeball').count).toBe(0);
    layer.update(state(), modern);
    layer.update({ frame: 3, sprites: [], objects: [] } as unknown as GameState, modern);
    expect(layer.counts().models).toBe(0);
    expect(mesh(layer, 'pokeball').count).toBe(0);
  });

  it('turns the truck half way round when its sprite is mirrored', () => {
    const layer = newLayer();
    const truck = (hflip: boolean) => state({ graphicsId: 94 }, { width: 32, height: 32, c2cY: -24, worldY: 160, hflip });
    const e00 = () => { const m = new THREE.Matrix4(); mesh(layer, 'truck').getMatrixAt(0, m); return m.elements[0]; };
    layer.update(truck(false), modern);
    expect(e00()).toBeCloseTo(1, 6);
    layer.update(truck(true), modern);
    expect(e00()).toBeCloseTo(-1, 6);
  });
  it('draws a berry tree at its growth stage (gfx 61: anims 0-1, gfx 62: anims 2-4), with its flowers or berries', () => {
    const layer = newLayer();
    const tree = (gfx: number, animNum: number, frame: number) =>
      state({ graphicsId: gfx, localId: 3 }, { animNum, height: gfx === 61 ? 16 : 32, c2cY: gfx === 61 ? -8 : -16 }, frame);
    const shown = () => ['berry1', 'berry2', 'berry3', 'berry4', 'berry5', 'berryFlower', 'berryFruit'].map((k) => mesh(layer, k).count);
    layer.update(tree(61, 0, 1), modern);
    expect(shown()).toEqual([1, 0, 0, 0, 0, 0, 0]);
    layer.update(tree(61, 1, 2), modern);
    expect(shown()).toEqual([0, 1, 0, 0, 0, 0, 0]);
    layer.update(tree(62, 2, 3), modern);
    expect(shown()).toEqual([0, 0, 1, 0, 0, 0, 0]);
    layer.update(tree(62, 3, 4), modern);
    expect(shown().slice(0, 5)).toEqual([0, 0, 0, 1, 0]);
    expect(shown()[5]).toBeGreaterThanOrEqual(5);
    layer.update(tree(62, 4, 5), modern);
    expect(shown().slice(0, 6)).toEqual([0, 0, 0, 0, 1, 0]);
    expect(shown()[6]).toBeGreaterThanOrEqual(5);
    expect(placed(layer, 'berry5').toArray()).toEqual([2.5, 0, 3.5]);   // in its cell, where its card stood
    expect(layer.counts()).toEqual({ cards: 0, inflated: 0, models: 1 });
  });
  it('draws nothing for an empty soil cell (a NO_BERRY tree keeps gfx 60, its sprite invisible)', () => {
    const layer = newLayer();
    layer.update(state({ graphicsId: 60 }, { invisible: true }), modern);
    expect(layer.counts()).toEqual({ cards: 0, inflated: 0, models: 0 });
    expect(mesh(layer, 'berry1').count).toBe(0);
  });
  it('forgets which objects it has seen over a Retro (or Phase 2 off) period', () => {
    const layer = newLayer();
    const seen = () => (layer as unknown as { seen: Map<number, unknown> }).seen.size;
    layer.setPixelSource({ vram: new Uint8Array(0x18000), palette: new Uint16Array(512) });
    layer.update(state(), modern);
    expect(seen()).toBe(1);
    layer.update(state({}, {}, 2), { ...upright, style: 'retro' });
    expect(seen()).toBe(0);
  });

  describe('colours', () => {
    const bgr = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);
    const RED = bgr(31, 4, 4), BLUE = bgr(4, 8, 31);
    /** Fills `tiles` 4bpp tiles from tile 0 with palette index `ci`. */
    const fill = (vram: Uint8Array, ci: number, tiles = 4) => vram.fill(ci | (ci << 4), 0x10000, 0x10000 + tiles * 32);
    const source = () => {
      const src: SpritePixelSource = { vram: new Uint8Array(0x18000), palette: new Uint16Array(512) };
      src.palette[257] = RED; src.palette[258] = BLUE;
      fill(src.vram, 1);
      return src;
    };
    const ball = (frame: number, images = 0x8500000) => state({}, { width: 16, height: 16, images }, frame);
    const tints = (layer: ActorLayer, kind: string) => mesh(layer, kind).userData.tints as { a: THREE.Color; b: THREE.Color };
    const linear = (c: number) => new THREE.Color(...toLinear(bgr555ToSrgb(c)));

    it("tints a model with its sprite's colours (the ball's shell: its accent)", () => {
      const layer = newLayer();
      layer.setPixelSource(source());
      layer.update(ball(1), modern);
      expect(tints(layer, 'pokeball').a.equals(linear(RED))).toBe(true);
    });
    it('falls back to the default tints without a pixel source', () => {
      const layer = newLayer();
      layer.update(ball(1), modern);
      expect(tints(layer, 'pokeball').a.equals(new THREE.Color(...toLinear([0.86, 0.16, 0.16])))).toBe(true);
    });
    it("never stores the colours of an object's first synced frame (its tiles may still be another object's)", () => {
      const layer = newLayer();
      const src = source();
      layer.setPixelSource(src);
      layer.update(ball(1), modern);                // spawn frame: the last object's tiles (RED)
      expect(tints(layer, 'pokeball').a.equals(linear(RED))).toBe(true);
      layer.update(ball(1), modern);                // (a second render of the same sync: still not stored)
      fill(src.vram, 2);                            // the VBlank copy brought the ball's own tiles (BLUE)
      layer.update(ball(2), modern);
      expect(tints(layer, 'pokeball').a.equals(linear(BLUE))).toBe(true);
      fill(src.vram, 1);                            // stored on frame 2: the same key keeps BLUE
      layer.update(ball(3), modern);
      expect(tints(layer, 'pokeball').a.equals(linear(BLUE))).toBe(true);
    });
    it('treats a new image set or anim on an existing object as a spawn frame too', () => {
      const layer = newLayer();
      const src = source();
      layer.setPixelSource(src);
      layer.update(ball(1), modern);
      layer.update(ball(2), modern);                // stored: images 0x8500000 → RED
      fill(src.vram, 2);
      layer.update(ball(3, 0x8500100), modern);     // new images: decoded (BLUE), not stored
      fill(src.vram, 1);
      layer.update(ball(4, 0x8500100), modern);     // decoded again: RED (BLUE had frame 3 stored it)
      expect(tints(layer, 'pokeball').a.equals(linear(RED))).toBe(true);
    });
    it("colours a berry plant's berries with its own sprite's accent", () => {
      const layer = newLayer();
      layer.setPixelSource(source());
      layer.update(state({ graphicsId: 62 }, { animNum: 4, images: 0x8500300 }, 1), modern);
      const c = mesh(layer, 'berryFruit').instanceColor!.array;
      const want = linear(RED);
      expect([c[0], c[1], c[2]].map((v) => +v.toFixed(5))).toEqual([want.r, want.g, want.b].map((v) => +v.toFixed(5)));
    });
    it('samples the truck at its 48×48 image size', () => {
      const layer = newLayer();
      const src = source();
      // its 48×48 image (36 tiles, 1D): only the last tile row is BLUE, which a 32×32 decode never reaches
      fill(src.vram, 0, 36);
      src.vram.fill(0x22, 0x10000 + 30 * 32, 0x10000 + 36 * 32);
      const truck = state({ graphicsId: 94 }, { width: 32, height: 32, c2cY: -24, worldY: 160, images: 0x8500200 }, 1);
      layer.setPixelSource(src);
      layer.update(truck, modern);
      expect(tints(layer, 'truck').b.equals(linear(BLUE))).toBe(true);
    });
  });
});
