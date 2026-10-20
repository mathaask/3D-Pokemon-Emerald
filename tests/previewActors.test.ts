import { describe, it, expect } from 'vitest';
import { blankSprite } from '../src/render/previewActors';

describe('blankSprite', () => {
  it('defaults every field: a 16x32 world sprite, centre-to-corner from its size', () => {
    const s = blankSprite();
    expect(s).toMatchObject({
      width: 16, height: 32, c2cX: -8, c2cY: -16, coordOffset: true, invisible: false, affine: false,
      scaleX: 1, scaleY: 1, rotation: 0, animNum: 0, images: 0, subspriteTables: 0, subspriteTableNum: 0, subspriteMode: 0,
    });
    expect(s.data).toHaveLength(8);
    expect(blankSprite().data).not.toBe(s.data);
    // OAM: vertical shape (2), size 2 = 16x32; priority 2
    expect(s.attr0 >>> 14).toBe(2);
    expect(s.attr1 >>> 14).toBe(2);
    expect((s.attr2 >>> 10) & 3).toBe(2);
  });

  it('derives the corner offsets, screen position and OAM attributes from the given fields', () => {
    const s = blankSprite({ width: 32, height: 32, tileNum: 40, palette: 3, x: 100, y: 60, hflip: true });
    expect(s).toMatchObject({ c2cX: -16, c2cY: -16, screenX: 84, screenY: 44 });
    expect(s.attr0).toBe(44 | (0 << 14));
    expect(s.attr1).toBe(84 | 0x1000 | (2 << 14));
    expect(s.attr2).toBe(40 | (2 << 10) | (3 << 12));
    expect(blankSprite({ width: 32, height: 32, c2cY: -24, attr2: 7 })).toMatchObject({ c2cY: -24, attr2: 7 });
  });
});
