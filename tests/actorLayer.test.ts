import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SpriteKind, type SpriteClassifier } from '../src/game/spriteKinds';
import type { GameState, SpriteSnap } from '../src/game/state';
import { routeSprite, cardSpec, uprightFoot, ActorLayer, type ActorFrame } from '../src/render/actors/actorLayer';
import { inflateMax } from '../src/render/actors/inflateMath';
import { createKitUniforms } from '../src/render/kit/materials';
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
