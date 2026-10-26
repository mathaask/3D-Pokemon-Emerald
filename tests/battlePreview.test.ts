import { describe, it, expect } from 'vitest';
import { previewBattleSprites, restoreFieldOnContextRestored } from '../src/render/battlePreview';
import { SYM } from '../src/game/symbols';
import type { MonPic } from '../src/game/rom/battleGraphics';

const pic = (yOffset: number, elevation = 0): MonPic => ({ tiles: new Uint8Array(2048), palette: new Uint16Array(16), yOffset, elevation });

describe('previewBattleSprites', () => {
  it('places single battlers as the game does, with their tiles and palettes', () => {
    const s = previewBattleSprites([{ pic: pic(5), position: 0 }, { pic: pic(15), position: 1 }], false);
    expect(s.map((x) => [x.screenX, x.screenY, x.tileNum, x.palette, x.width, x.height])).toEqual(
      [[40, 53, 0, 0, 64, 64], [144, 23, 64, 1, 64, 64]]);
    expect(s.every((x) => x.template === SYM.gMultiuseSpriteTemplate && x.affine && !x.coordOffset)).toBe(true);
  });
  it('adds the shadow sprite under a floating enemy', () => {
    const s = previewBattleSprites([{ pic: pic(5), position: 0 }, { pic: pic(6, 8), position: 1 }], false);
    expect(s[1].screenY).toBe(40 + 6 - 8 - 32);
    expect(s[2]).toMatchObject({ template: SYM.gSpriteTemplate_EnemyShadow, width: 32, height: 8, screenX: 160, screenY: 65, palette: 4, tileNum: 128 });
  });
  it('places four battlers in a double battle', () => {
    const s = previewBattleSprites([0, 1, 2, 3].map((position) => ({ pic: pic(0), position })), true);
    expect(s.map((x) => [x.screenX, x.screenY])).toEqual([[0, 48], [168, 8], [58, 56], [120, 0]]);
  });
  it('gives each floating opponent of a double battle its shadow (one sheet, one palette)', () => {
    const s = previewBattleSprites([0, 1, 2, 3].map((position) => ({ pic: pic(0, position & 1 ? 4 : 0), position })), true);
    expect(s.slice(4).map((x) => [x.template, x.screenX, x.screenY, x.tileNum, x.palette, x.data[0]])).toEqual([
      [SYM.gSpriteTemplate_EnemyShadow, 200 - 16, 40 + 29 - 4, 256, 4, 1],
      [SYM.gSpriteTemplate_EnemyShadow, 152 - 16, 32 + 29 - 4, 256, 4, 3],
    ]);
  });
});

describe('the battle preview after a lost WebGL context', () => {
  it("recomputes the battlers' field once the context is restored (its targets lost their pixels), as live play does", () => {
    const canvas = new EventTarget();
    let invalidated = 0;
    restoreFieldOnContextRestored(canvas, { invalidateField: () => { invalidated++; } });
    expect(invalidated).toBe(0);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    expect(invalidated).toBe(0);
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(invalidated).toBe(1);
  });
});
