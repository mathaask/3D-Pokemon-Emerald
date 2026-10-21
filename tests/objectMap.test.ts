import { describe, it, expect } from 'vitest';
import { objectModelFor, berryStage, modelImageHeight, GFX } from '../src/render/actors/objectMap';

describe('objectModelFor', () => {
  it('maps the field objects', () => {
    expect(objectModelFor(GFX.ITEM_BALL, 0)).toEqual({ kind: 'pokeball', stage: 0 });
    expect(objectModelFor(GFX.PUSHABLE_BOULDER, 0)).toEqual({ kind: 'boulder', stage: 0 });
    expect(objectModelFor(GFX.BREAKABLE_ROCK, 0)).toEqual({ kind: 'crackedRock', stage: 0 });
    expect(objectModelFor(GFX.CUTTABLE_TREE, 0)).toEqual({ kind: 'cutTree', stage: 0 });
    expect(objectModelFor(GFX.TRUCK, 0)).toEqual({ kind: 'truck', stage: 0 });
  });
  it('gives the removal animation back to the sprite', () => {
    expect(objectModelFor(GFX.CUTTABLE_TREE, 1)).toBeNull();
    expect(objectModelFor(GFX.BREAKABLE_ROCK, 1)).toBeNull();
  });
  it('reads the berry stage from the animation', () => {
    expect(objectModelFor(GFX.BERRY_TREE_EARLY, 0)).toEqual({ kind: 'berry', stage: 1 });
    expect(objectModelFor(GFX.BERRY_TREE_LATE, 4)).toEqual({ kind: 'berry', stage: 5 });
    expect(objectModelFor(GFX.BERRY_TREE, 2)).toEqual({ kind: 'berry', stage: 3 });
    expect(berryStage(9)).toBe(5);
  });
  it('leaves characters, Pokémon and VAR graphics to sprites', () => {
    for (const id of [0, 6, 98, 113, 215, 240, 255]) expect(objectModelFor(id, 0)).toBeNull();
  });
  it('knows the truck image is 48 px tall', () => {
    expect(modelImageHeight('truck', 32)).toBe(48);
    expect(modelImageHeight('pokeball', 16)).toBe(16);
  });
});

describe('objectModelFor edge cases', () => {
  it('maps every berry growth stage: anim (stage − 1), clamped to 1..5', () => {
    expect([0, 1, 2, 3, 4].map(berryStage)).toEqual([1, 2, 3, 4, 5]);
    expect(berryStage(-1)).toBe(1);
    expect(objectModelFor(GFX.BERRY_TREE_EARLY, 1)).toEqual({ kind: 'berry', stage: 2 });
    expect(objectModelFor(GFX.BERRY_TREE_LATE, 2)).toEqual({ kind: 'berry', stage: 3 });
  });
  it('only the obstacles hand their removal anim back; other objects ignore the anim', () => {
    expect(objectModelFor(GFX.CUTTABLE_TREE, 0)).not.toBeNull();
    expect(objectModelFor(GFX.ITEM_BALL, 1)).toEqual({ kind: 'pokeball', stage: 0 });
    expect(objectModelFor(GFX.PUSHABLE_BOULDER, 1)).toEqual({ kind: 'boulder', stage: 0 });
    expect(objectModelFor(GFX.TRUCK, 1)).toEqual({ kind: 'truck', stage: 0 });
  });
  it("uses the sprite's own height for everything but the truck", () => {
    expect(modelImageHeight('berry', 32)).toBe(32);
    expect(modelImageHeight('boulder', 16)).toBe(16);
  });
});
