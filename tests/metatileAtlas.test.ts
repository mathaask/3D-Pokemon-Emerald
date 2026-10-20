import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { GbaTextures } from '../src/render/gbaTextures';
import { ATLAS_W, MetatileAtlas, Variant, VARIANT_H } from '../src/render/overworld/metatileAtlas';
import type { Bus } from '../src/gba/bus';
import { World } from '../src/render/overworld/world';
import { createWorldMaterials } from '../src/render/overworld/materials';
import { createKitUniforms } from '../src/render/kit/materials';
import { CLAIM_SURFACE, CLAIM_WATER_UNDER } from '../src/render/overworld/claims';
import { K } from '../src/render/overworld/analyze';
import { MB } from '../src/game/behaviors';
import { NO_EVENTS } from '../src/render/kit/events';
import type { Family } from '../src/render/kit/semantics';
import { fakeGrid, fakeInfo } from './helpers/fakeMap';

/** A scratch bus (VRAM and palette RAM only) behind GbaTextures, as the map preview sets it up. */
function setup() {
  const bus = { vram: new Uint8Array(0x18000), pram16: new Uint16Array(512), vramDirty: true, pramDirty: true } as unknown as Bus;
  const tex = new GbaTextures(bus);
  const palette = new Uint16Array(512);
  tex.paletteSource = palette;
  tex.update(true);
  const atlas = new MetatileAtlas(tex, 1);
  return { bus, tex, palette, atlas };
}

/** Counts the atlas draws and records the scissor state of the target at each. */
function fakeRenderer() {
  let current: THREE.WebGLRenderTarget | null = null;
  const draws: { scissorTest: boolean; scissor: number[] }[] = [];
  const r = {
    getRenderTarget: () => current,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => { current = t; },
    render: () => { draws.push({ scissorTest: current!.scissorTest, scissor: current!.scissor.toArray() }); },
  };
  return { r: r as unknown as THREE.WebGLRenderer, draws };
}

describe('metatile atlas re-rendering', () => {
  it('draws once, then only when its inputs change', () => {
    const { atlas } = setup();
    const { r, draws } = fakeRenderer();
    atlas.render(r, 0);
    expect(draws).toHaveLength(1);
    atlas.render(r, 0);
    atlas.render(r, 0);
    expect(draws).toHaveLength(1);
  });

  it('redraws when the BG tiles it reads change (tile animations), not for other VRAM', () => {
    const { bus, atlas } = setup();
    const { r, draws } = fakeRenderer();
    atlas.render(r, 0);
    bus.vram[0x10000 + 5] = 7; // OBJ tiles (sprites animating)
    atlas.render(r, 0);
    expect(draws).toHaveLength(1);
    bus.vram[0x1234] = 9; // a BG tile (water, flowers)
    atlas.render(r, 0);
    expect(draws).toHaveLength(2);
    atlas.render(r, 0);
    expect(draws).toHaveLength(2);
    // the 1024 tiles from the character base on: 32 KB
    bus.vram[0x7fff] = 1;
    atlas.render(r, 0);
    expect(draws).toHaveLength(3);
    bus.vram[0x8000] = 1; // (beyond the tiles a metatile can name from base 0)
    atlas.render(r, 0);
    expect(draws).toHaveLength(3);
  });

  it('redraws when the BG palettes change, or the character base', () => {
    const { tex, palette, atlas } = setup();
    const { r, draws } = fakeRenderer();
    atlas.render(r, 0);
    palette[300] = 0x1234; // an OBJ palette
    tex.update();
    atlas.render(r, 0);
    expect(draws).toHaveLength(1);
    palette[17] = 0x7fff; // BG palette 1
    tex.update();
    atlas.render(r, 0);
    expect(draws).toHaveLength(2);
    atlas.render(r, 0x4000);
    expect(draws).toHaveLength(3);
  });

  it('redraws after new ground references, and on demand', () => {
    const { atlas } = setup();
    const { r, draws } = fakeRenderer();
    atlas.render(r, 0);
    atlas.setGroundRefs(new Int16Array(1024).fill(-1));
    atlas.render(r, 0);
    expect(draws).toHaveLength(2);
    atlas.invalidate();
    atlas.render(r, 0);
    expect(draws).toHaveLength(3);
  });

  it('leaves out the Dry band unless the world draws with it', () => {
    const { atlas } = setup();
    const { r, draws } = fakeRenderer();
    atlas.setDryNeeded(false);
    atlas.render(r, 0);
    expect(draws[0].scissorTest).toBe(true);
    expect(draws[0].scissor).toEqual([0, 0, ATLAS_W, Variant.Dry * VARIANT_H]);
    // needed again: the band may be stale, so the whole atlas is drawn at once
    atlas.setDryNeeded(true);
    atlas.render(r, 0);
    expect(draws).toHaveLength(2);
    expect(draws[1].scissorTest).toBe(false);
    // no longer needed: nothing to redraw
    atlas.setDryNeeded(false);
    atlas.render(r, 0);
    expect(draws).toHaveLength(2);
  });
});

describe('the world tells the atlas whether it draws with the Dry band', () => {
  // the sea ('w') with a boat ('b') on it: the kit water runs on under the boat's legacy art
  const SEA = 8 | (12 << 5) | (26 << 10), HULL = 24 | (20 << 5) | (14 << 10);
  const info = fakeInfo();
  const fill = (m: number, c: number, from = 0, to = 256) => { info.both.fill(c, m * 256 + from, m * 256 + to); info.bottom.fill(c, m * 256 + from, m * 256 + to); };
  fill(1, 14 | (24 << 5) | (20 << 10));
  fill(3, SEA); info.attributes[3] = MB.OCEAN_WATER;
  fill(5, SEA); info.both.fill(HULL, 5 * 256 + 64, 5 * 256 + 192); info.topCover[5] = 128; info.attributes[5] = 1 << 12; info.blue[5] = 0.7;
  const grid = fakeGrid(['.www', '.wbw', '.www']);
  const code: Record<string, number> = { '.': 1 | 0x3000, w: 3 | 0x1000, b: 5 | 0x1400 };
  ['.www', '.wbw', '.www'].forEach((row, y) => [...row].forEach((ch, x) => { grid.cells[y * 4 + x] = code[ch]; }));
  grid.border = [3, 3, 3, 3];
  const opts = { info, generalPrimary: false, indoor: false, underground: false, underwater: false };
  const water: Family<number> = {
    name: 'water',
    extract({ a }, claims) {
      for (let i = 0; i < a.N; i++) {
        if (a.kind[i] === K.Water && a.mt[i] === 3) claims.claim(i, CLAIM_SURFACE);
        else if (a.kind[i] !== K.Floor) claims.claim(i, CLAIM_WATER_UNDER);
      }
      return 0;
    },
    build: () => null,
  };

  it('Modern with water under legacy art needs it; Retro does not', () => {
    const atlas = new MetatileAtlas({ vram: null, palette: null } as never, 1);
    const u = createKitUniforms();
    const world = new World(atlas, createWorldMaterials(atlas.target.texture, u), u, [water]);
    const ctx = { style: 'modern' as const, events: NO_EVENTS, quality: 'medium' as const };
    world.build(grid, opts, ctx);
    expect(world.model!.quads.some((q) => q.variant === Variant.Dry)).toBe(true);
    expect(atlas.dryNeeded).toBe(true);
    world.build(grid, opts, { ...ctx, style: 'retro' });
    expect(world.model!.quads.some((q) => q.variant === Variant.Dry)).toBe(false);
    expect(atlas.dryNeeded).toBe(false);
  });
});
