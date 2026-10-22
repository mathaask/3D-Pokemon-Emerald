import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { composeBounds, needsComposition } from '../src/game/subsprites';
import { applyComposition, type SubspritePiece } from '../src/game/subsprites';
import type { SpriteSnap } from '../src/game/state';
import { blankSprite } from '../src/render/previewActors';
import { SpriteAtlas } from '../src/render/spriteAtlas';
import type { GbaTextures } from '../src/render/gbaTextures';

const truck = [                                            // top and bottom rows of a 48×48 image (a subset of the real table)
  { x: -24, y: -24, width: 32, height: 8, tileOffset: 0 }, { x: 8, y: -24, width: 16, height: 8, tileOffset: 4 },
  { x: -24, y: 16, width: 32, height: 8, tileOffset: 30 }, { x: 8, y: 16, width: 16, height: 8, tileOffset: 34 },
];
describe('subsprites', () => {
  it('composes the bounds of the pieces', () => {
    const b = composeBounds(truck, false, false);
    expect(b).toMatchObject({ minX: -24, minY: -24, width: 48, height: 48 });
    expect(b.placed[1]).toMatchObject({ x: 32, y: 0, width: 16 });
  });
  it('mirrors pieces like the GBA when flipped', () => {
    const b = composeBounds(truck, true, false);
    expect(b.minX).toBe(-24);
    expect(b.placed[1]).toMatchObject({ x: 0, y: 0 });     // x' = −(8 + 16) = −24 → left edge
  });
  it('leaves one-piece and same-shape tables alone', () => {
    expect(needsComposition([{ x: -8, y: -16, width: 16, height: 32, tileOffset: 0 }], 16, 32)).toBe(false);
    expect(needsComposition(truck, 32, 32)).toBe(true);
  });
});

// The whole truck table (object_event_subsprites.h sOamTable_48x48): 6 rows of a 32×8 and a 16×8 strip, 6 tiles a row.
const truckTable = Array.from({ length: 6 }, (_, r) => [
  { x: -24, y: -24 + 8 * r, width: 32, height: 8, tileOffset: 6 * r },
  { x: 8, y: -24 + 8 * r, width: 16, height: 8, tileOffset: 6 * r + 4 },
]).flat();
/** The live truck before composition: a 32×32 OAM with the 48×48 image's centre-to-corner (−24, −24), its
 *  world position from the base OAM (worldY = y + c2cY + height + spriteToMapY; spriteToMap 0 here). */
const liveTruck = (p: Partial<SpriteSnap> = {}) => blankSprite({
  width: 32, height: 32, c2cX: -24, c2cY: -24, x: 100, y: 60, worldX: 100, worldY: 60 - 24 + 32,
  subspriteTables: 0x8509654, subspriteTableNum: 1, subspriteMode: 1, ...p,
});

describe('needsComposition on real tables', () => {
  it('treats strips that rebuild the base image in its own tile order as the same image', () => {
    // sOamTable_16x16_2 (two 16×8 rows) and sOamTable_16x16_3 (the image twice, two priorities)
    expect(needsComposition([{ x: -8, y: -8, width: 16, height: 8, tileOffset: 0 }, { x: -8, y: 0, width: 16, height: 8, tileOffset: 2 }], 16, 16)).toBe(false);
    expect(needsComposition([{ x: -8, y: -8, width: 16, height: 16, tileOffset: 0 }, { x: -8, y: -8, width: 16, height: 16, tileOffset: 0 }], 16, 16)).toBe(false);
    expect(needsComposition([], 16, 16)).toBe(false);
  });
  it('composes strips in another tile order, gaps, and the truck', () => {
    // two 16×8 rows in swapped tile order; one row missing (the base image would draw it)
    expect(needsComposition([{ x: -8, y: -8, width: 16, height: 8, tileOffset: 2 }, { x: -8, y: 0, width: 16, height: 8, tileOffset: 0 }], 16, 16)).toBe(true);
    expect(needsComposition([{ x: -8, y: -8, width: 16, height: 8, tileOffset: 0 }, { x: -8, y: 8, width: 16, height: 8, tileOffset: 4 }], 16, 24)).toBe(true);
    expect(needsComposition(truckTable, 32, 32)).toBe(true);
  });
});

describe('applyComposition', () => {
  it('gives the truck its 48×48 image: bottom 16 px lower, centre unchanged', () => {
    const s = liveTruck();
    applyComposition(s, truckTable);
    expect(s).toMatchObject({ width: 48, height: 48, c2cX: -24, c2cY: -24, worldX: 100, worldY: 60 - 24 + 48 });
    expect(s.worldY - s.height - s.c2cY).toBe(s.y); // the sprite centre (Task 8's truck model foot)
    expect(s.pieces).toHaveLength(12);
    expect(s.pieces![1]).toEqual({ x: 32, y: 0, width: 16, height: 8, tileOffset: 4 });
    expect(s.pieces![11]).toEqual({ x: 32, y: 40, width: 16, height: 8, tileOffset: 34 });
    // the raw OAM stays the base 32×32
    expect(s.attr0 >>> 14).toBe(0);
    expect(s.attr1 >>> 14).toBe(2);
  });
  it('mirrors the pieces of a flipped sprite inside the same bounds', () => {
    const s = liveTruck({ hflip: true });
    applyComposition(s, truckTable);
    expect(s).toMatchObject({ width: 48, height: 48, worldX: 100 });
    expect(s.pieces![0]).toMatchObject({ x: 16, y: 0, width: 32 });
    expect(s.pieces![1]).toMatchObject({ x: 0, y: 0, width: 16 });
  });
  it('leaves sprites as they are: subsprites off, HUD sprites, same-image tables, images past 64×64', () => {
    const cases: [SpriteSnap, SubspritePiece[]][] = [
      [liveTruck({ subspriteMode: 0 }), truckTable],
      [liveTruck({ coordOffset: false }), truckTable],
      [blankSprite({ subspriteMode: 1 }), [{ x: -8, y: -16, width: 16, height: 32, tileOffset: 0 }]],
      // a 96×40 image (the S.S. Tidal's size) from 32×8 strips
      [blankSprite({ width: 8, height: 8, subspriteMode: 1 }), Array.from({ length: 15 }, (_, i) => (
        { x: -48 + 32 * (i % 3), y: -20 + 8 * ((i / 3) | 0), width: 32, height: 8, tileOffset: 4 * i }))],
    ];
    for (const [s, pieces] of cases) {
      const before = { ...s };
      applyComposition(s, pieces);
      expect(s).toEqual(before);
      expect(s.pieces).toBeNull();
    }
  });
});

describe('SpriteAtlas with composed sprites', () => {
  const atlasOf = () => {
    const atlas = new SpriteAtlas({ vram: new THREE.Texture(), palette: new THREE.Texture() } as unknown as GbaTextures);
    const scenes: THREE.Scene[] = [];
    const fake = { getRenderTarget: () => null, setRenderTarget: () => {}, setClearColor: () => {}, clear: () => {},
      render: (scene: THREE.Scene) => scenes.push(scene) } as unknown as THREE.WebGLRenderer;
    return { atlas, scenes, fake };
  };
  it('keeps one slot rect per sprite (composed size) and bakes one piece per subsprite, rows bottom-up', () => {
    const { atlas, scenes, fake } = atlasOf();
    const npc = blankSprite({ index: 3, tileNum: 8, palette: 2 });
    const truck = liveTruck({ index: 5, tileNum: 100, palette: 4 });
    applyComposition(truck, truckTable);
    atlas.update(fake, [npc, truck], false);
    // slots: one per sprite, the composed size (the inflation field reads these)
    expect(atlas.slotCount).toBe(2);
    expect(Array.from(atlas.slotRects.array.slice(0, 8))).toEqual([0, 0, 16, 32, 1, 0, 48, 48]);
    expect(atlas.slots.get(5)).toEqual({ slot: 1, u0: 64 / 1024, v0: 48 / 512, u1: (64 + 48) / 1024, v1: 0 });
    // pieces: the NPC whole at its slot's origin, then the truck's 12 strips
    expect(scenes).toHaveLength(1);
    const g = (scenes[0].children[0] as THREE.Mesh).geometry as THREE.InstancedBufferGeometry;
    expect(g.instanceCount).toBe(13);
    const piece = g.getAttribute('aPiece'), size = g.getAttribute('aPieceSize'), tile = g.getAttribute('aTile');
    const at = (i: number) => [piece.getX(i), piece.getY(i), piece.getZ(i), piece.getW(i), size.getX(i), size.getY(i), tile.getX(i), tile.getY(i)];
    expect(at(0)).toEqual([0, 0, 0, 0, 16, 32, 8, 2]);
    expect(at(1)).toEqual([1, 0, 0, 40, 32, 8, 100, 4]);   // the top row: the slot's top 8 rows
    expect(at(2)).toEqual([1, 0, 32, 40, 16, 8, 104, 4]);
    expect(at(12)).toEqual([1, 0, 32, 0, 16, 8, 134, 4]);  // the bottom row
  });
  it('bakes nothing for an empty frame', () => {
    const { atlas, scenes, fake } = atlasOf();
    atlas.update(fake, [], false);
    expect(atlas.slotCount).toBe(0);
    expect(scenes).toHaveLength(0);
  });
});
