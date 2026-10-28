import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SpriteKind, type SpriteClassifier } from '../src/game/spriteKinds';
import type { GameState, SpriteSnap } from '../src/game/state';
import { SYM } from '../src/game/symbols';
import { ActorLayer, type ActorFrame } from '../src/render/actors/actorLayer';
import {
  GATE, gateArms, gateColors, gateGeometry, gatePlacement, gateYaw, isRotatingGate, type GateArms,
} from '../src/render/actors/rotatingGate';
import type { SpritePixelSource } from '../src/render/actors/spriteColors';
import { createKitUniforms } from '../src/render/kit/materials';
import { blankSprite } from '../src/render/previewActors';

/**
 * A gate image as rotating_gate.c's sheets draw one (graphics/rotating_gates/*.png, read live from OBJ VRAM): a 6-px hub
 * at the centre (pivot between the middle rows / columns) and 4-px-wide arms reaching 15 px per cell from the pivot.
 * Index 0 transparent, 0xd the beams, 0xc their light stripe, 0xf the hub.
 */
function gateImage(size: 32 | 64, arms: GateArms): Uint8Array {
  const px = new Uint8Array(size * size), c = size >> 1;
  const set = (x: number, y: number, v: number) => { if (x >= 0 && y >= 0 && x < size && y < size) px[y * size + x] = v; };
  const arm = (dx: number, dy: number, len: number) => {
    for (let k = 0; k < len * 16 - 1; k++) {
      for (let w = -2; w < 2; w++) {
        const x = dx ? (dx > 0 ? c + k : c - 1 - k) : c + w, y = dy ? (dy > 0 ? c + k : c - 1 - k) : c + w;
        set(x, y, w === -1 ? 0xc : 0xd);
      }
    }
  };
  arm(0, -1, arms.n); arm(1, 0, arms.e); arm(0, 1, arms.s); arm(-1, 0, arms.w);
  for (let y = -3; y < 3; y++) for (let x = -3; x < 3; x++) set(c + x, c + y, 0xf);
  return px;
}

const asImage = (px: Uint8Array, size: number) => ({ w: size, h: size, opaque: (x: number, y: number) => px[y * size + x] !== 0 });

/** Writes `px` (size × size, 4bpp, 1D mapping) into OBJ VRAM at tile `tile`, as decodeSpriteIndices reads it. */
function writeObj(vram: Uint8Array, px: Uint8Array, size: number, tile: number): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = tile + (y >> 3) * (size >> 3) + (x >> 3);
      const a = 0x10000 + t * 32 + (y & 7) * 4 + ((x & 7) >> 1);
      vram[a] = x & 1 ? (vram[a] & 0x0f) | (px[y * size + x] << 4) : (vram[a] & 0xf0) | px[y * size + x];
    }
  }
}

describe('gateArms', () => {
  it('reads an L gate (long north arm, short east arm) from its 64×64 image', () => {
    const arms = { n: 2, e: 1, s: 0, w: 0 };
    expect(gateArms(asImage(gateImage(64, arms), 64))).toEqual(arms);
  });
  it('reads a T gate (north, east, south) from its 32×32 image', () => {
    const arms = { n: 1, e: 1, s: 1, w: 0 };
    expect(gateArms(asImage(gateImage(32, arms), 32))).toEqual(arms);
  });
  it('reads a T gate with a long east arm (T3) and a long-armed L (L4)', () => {
    for (const arms of [{ n: 1, e: 2, s: 1, w: 0 }, { n: 2, e: 2, s: 0, w: 0 }]) {
      expect(gateArms(asImage(gateImage(64, arms), 64))).toEqual(arms);
    }
  });
  it('reads no arm from a blank image (tiles not loaded)', () => {
    expect(gateArms(asImage(new Uint8Array(32 * 32), 32))).toEqual({ n: 0, e: 0, s: 0, w: 0 });
  });
});

describe('gateGeometry', () => {
  const colors = { main: [0.52, 0.48, 0.28] as [number, number, number], dark: [0.23, 0.23, 0.1] as [number, number, number] };
  const box = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };

  it('spans the arms (±0.05) and stands 0.9 high; the hub alone where there is no arm', () => {
    for (const arms of [{ n: 2, e: 1, s: 0, w: 0 }, { n: 1, e: 1, s: 1, w: 0 }, { n: 1, e: 2, s: 1, w: 0 }]) {
      const b = box(gateGeometry(arms, colors, 'medium'));
      const reach = { n: -b.min.z, e: b.max.x, s: b.max.z, w: -b.min.x };
      for (const k of ['n', 'e', 's', 'w'] as const) {
        if (arms[k] > 0) expect(Math.abs(reach[k] - arms[k]), `${k} of ${JSON.stringify(arms)}`).toBeLessThanOrEqual(0.05);
        else expect(reach[k]).toBeLessThanOrEqual(GATE.hubR + 1e-6);
      }
      expect(b.min.y).toBeCloseTo(0, 6);
      expect(b.max.y).toBeCloseTo(0.9, 6);
    }
  });

  it('keeps every rail and post at or under 0.9 (D6: they hide nothing the sprite does not)', () => {
    const g = gateGeometry({ n: 2, e: 2, s: 1, w: 1 }, colors, 'high');
    const pos = g.getAttribute('position');
    let top = 0;
    for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i));
    expect(top).toBeLessThanOrEqual(0.9 + 1e-6);
  });

  it('carries the object models\' attributes: position, normal, RGBA colour (alpha 1: the colour as it is)', () => {
    const g = gateGeometry({ n: 1, e: 1, s: 1, w: 0 }, colors, 'low');
    expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position']);
    const col = g.getAttribute('color');
    expect(col.itemSize).toBe(4);
    for (let i = 0; i < col.count; i++) expect(col.getW(i)).toBe(1);
  });

  it('rounds the hub more at higher quality (8 / 12 / 16 sides)', () => {
    const n = (q: 'low' | 'medium' | 'high') => gateGeometry({ n: 1, e: 0, s: 0, w: 0 }, colors, q).getAttribute('position').count;
    expect(n('low')).toBeLessThan(n('medium'));
    expect(n('medium')).toBeLessThan(n('high'));
  });
});

describe('gateColors', () => {
  it('takes the rails from the highlight tone and the posts from the body tone, lifted off the outline\'s near-black', () => {
    const c = gateColors({
      colors: { main: [0.23, 0.23, 0.1], accent: null, green: null },
      tones: { body: [0.23, 0.23, 0.1], highlight: [0.52, 0.48, 0.28], crevice: null, dark: null },
    });
    expect(c.main).toEqual([0.52, 0.48, 0.28]);
    expect(c.dark[0] / c.dark[2]).toBeCloseTo(0.23 / 0.1); // hue kept
  });
});

describe('isRotatingGate', () => {
  it('knows a gate by its callback alone, Thumb bit set or clear', () => {
    const cb = SYM.SpriteCallback_RotatingGate;
    expect(isRotatingGate({ callback: cb | 1 })).toBe(true);
    expect(isRotatingGate({ callback: cb & ~1 })).toBe(true);
    expect(isRotatingGate({ callback: SYM.UpdateObjectReflectionSprite | 1 })).toBe(false);
    expect(isRotatingGate({ callback: 0 })).toBe(false);
  });
});

describe('gateYaw', () => {
  it('turns the model as the sprite is drawn: the sprite rotation (anticlockwise on screen) is an anticlockwise yaw', () => {
    // the model's north arm (−Z) after the yaw lands where the image's top arm is drawn: rotation θ (pa = cos θ, pc = sin θ,
    // screen → texture) shows texel (0, −1) (up) at screen (−sin θ, −cos θ)·r; the yaw takes −Z to (−sin θ, ·, −cos θ)
    for (const r of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.3]) {
      const screen = new THREE.Vector2(-Math.sin(r), -Math.cos(r));
      const arm = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), gateYaw(r));
      expect(arm.x).toBeCloseTo(screen.x, 6);
      expect(arm.z).toBeCloseTo(screen.y, 6);
    }
  });
});

describe('gatePlacement', () => {
  it('stands the model on the pivot (the sprite centre, a cell corner) on the lowest ground around it, un-projected', () => {
    // a 64×64 gate at cell (9, 15): sprite centre at (144, 240) px, worldY = centre + 32
    const s = blankSprite({ width: 64, height: 64, worldX: 144, worldY: 272, affine: true });
    const heightAt = (x: number, y: number) => (x > 9 && y > 15 ? 1 : 0.5);
    expect(gatePlacement(s, heightAt)).toEqual({ x: 9, y: 0.5, z: 15.5 });
  });
});

describe('the actor layer\'s gates', () => {
  const TILE = 40;
  const pixels = (): SpritePixelSource => {
    const vram = new Uint8Array(0x18000);
    writeObj(vram, gateImage(32, { n: 1, e: 1, s: 1, w: 0 }), 32, TILE);
    const palette = new Uint16Array(512);
    palette[256 + 2 * 16 + 0xc] = 0x21ef; palette[256 + 2 * 16 + 0xd] = 0x0ce7; palette[256 + 2 * 16 + 0xf] = 0;
    return { vram, palette, map2d: false };
  };
  const gate = (rotation: number): SpriteSnap => blankSprite({
    index: 3, width: 32, height: 32, worldX: 6 * 16, worldY: 23 * 16 + 16, affine: true, tileNum: TILE, palette: 2,
    callback: SYM.SpriteCallback_RotatingGate | 1, rotation,
  });
  const atlas = { slots: new Map([[3, { u0: 0, v0: 0, u1: 0.1, v1: 0.1 }]]), target: { texture: new THREE.Texture() } };
  const frame = (style: 'modern' | 'retro'): ActorFrame => ({
    style, classifier: { kind: () => SpriteKind.Upright } as unknown as SpriteClassifier,
    heightAt: () => 0.25, hasGrassBlades: () => false, cameraRight: new THREE.Vector3(1, 0, 0), charLight: new THREE.Color(1, 1, 1),
  });
  const stateOf = (s: SpriteSnap, f: number) => ({ sprites: [s], objects: [], frame: f }) as unknown as GameState;
  const gateMesh = (layer: ActorLayer) => {
    const g = layer.group.getObjectByName('rotatingGates')!;
    return g.children.find((m) => (m as THREE.InstancedMesh).count > 0) as THREE.InstancedMesh | undefined;
  };

  it('draws a gate as a turnstile model turning with the sprite, frame by frame, on its pivot', () => {
    const layer = new ActorLayer(atlas, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });
    layer.setPixelSource(pixels());
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    [0, Math.PI / 4, Math.PI / 2, Math.PI].forEach((rotation, f) => {
      layer.update(stateOf(gate(rotation), f), frame('modern'));
      expect(layer.counts()).toEqual({ cards: 0, inflated: 0, models: 1 });
      const mesh = gateMesh(layer)!;
      expect(mesh.count).toBe(1);
      mesh.getMatrixAt(0, m);
      m.decompose(p, q, sc);
      const e = m.elements;
      // (a turn about +Y by the yaw: column 0 = (cos, 0, −sin), column 2 = (sin, 0, cos))
      expect(e[0]).toBeCloseTo(Math.cos(gateYaw(rotation)), 5);
      expect(e[8]).toBeCloseTo(Math.sin(gateYaw(rotation)), 5);
      expect(e[2]).toBeCloseTo(-Math.sin(gateYaw(rotation)), 5);
      expect(p.toArray()).toEqual([6, 0.25, 23.25]);
    });
    // its geometry is the image's T (north, east, south: one cell each)
    const b = gateMesh(layer)!.geometry.boundingBox!;
    expect(b.max.x).toBeCloseTo(1, 1);
    expect(b.min.z).toBeCloseTo(-1, 1);
    expect(b.max.z).toBeCloseTo(1, 1);
    expect(b.min.x).toBeGreaterThan(-0.2);
  });

  it('draws it with the object models\' material (no program of its own)', () => {
    const layer = new ActorLayer(atlas, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });
    layer.setPixelSource(pixels());
    layer.update(stateOf(gate(0), 0), frame('modern'));
    const rock = layer.group.getObjectByName('crackedRock') as THREE.InstancedMesh;
    expect(gateMesh(layer)!.material).toBe(rock.material);
  });

  it('keeps the gate a card in Retro (as today), and its models hidden', () => {
    const layer = new ActorLayer(atlas, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });
    layer.setPixelSource(pixels());
    layer.update(stateOf(gate(Math.PI / 2), 0), frame('modern'));
    layer.update(stateOf(gate(Math.PI / 2), 1), frame('retro'));
    expect(layer.counts()).toEqual({ cards: 1, inflated: 0, models: 0 });
    expect(layer.group.getObjectByName('rotatingGates')!.visible).toBe(false);
  });
});
