import { describe, it, expect, vi } from 'vitest';
import { RomReader } from '../../src/game/rom/reader';
import { NUM_OBJ_EVENT_GFX, readObjectGraphicsInfo, readFrameImage, readObjectPalette, readOamShape } from '../../src/game/rom/objectGraphics';
import { OBJ_SIZES, composeBounds, needsComposition, readSubsprites } from '../../src/game/subsprites';
import { loadMap } from '../../src/game/rom/maps';
import { buildPreviewActors } from '../../src/render/previewActors';
import { loadRom } from './helpers/staticMap';

describe('object graphics from the ROM', () => {
  const rom = new RomReader(loadRom());
  it('reads the item ball, the boulder and the truck', () => {
    expect(readObjectGraphicsInfo(rom, 59)).toMatchObject({ width: 16, height: 16, paletteTag: 0x1105, inanimate: true, size: 128 });
    expect(readObjectGraphicsInfo(rom, 87)).toMatchObject({ width: 16, height: 16, paletteTag: 0x1103 });
    expect(readObjectGraphicsInfo(rom, 94)).toMatchObject({ width: 48, height: 48, paletteTag: 0x110d, size: 1152 });
    expect(readObjectGraphicsInfo(rom, 239)).toBeNull();
  });
  it('composes the truck from its subsprite table: 48×48 on a 32×32 OAM, strips in row-major tile order', () => {
    const info = readObjectGraphicsInfo(rom, 94)!;
    const { shape, size } = readOamShape(rom, info);
    expect(OBJ_SIZES[shape][size]).toEqual([32, 32]);
    const pieces = readSubsprites(rom, info.subspriteTables, 0)!;
    expect(pieces).toHaveLength(12); // 6 rows of a 32×8 and a 16×8 strip
    expect(needsComposition(pieces, 32, 32)).toBe(true);
    const b = composeBounds(pieces, false, false);
    expect(b).toMatchObject({ minX: -24, minY: -24, width: 48, height: 48 });
    for (const p of b.placed) expect(p.tileOffset).toBe((p.y / 8) * 6 + p.x / 8); // the image is 6 tiles wide
  });
  it('finds the multi-piece objects: only the truck fits a 64×64 atlas slot; one-piece tables (berry trees) stay', () => {
    const composed: Record<number, string> = {};
    for (let g = 0; g < NUM_OBJ_EVENT_GFX; g++) {
      const info = readObjectGraphicsInfo(rom, g);
      if (!info?.subspriteTables) continue;
      const { shape, size } = readOamShape(rom, info);
      const [w, h] = OBJ_SIZES[shape][size];
      for (let t = 0; t < 6; t++) { // (every table array has 6 entries; elevations use 0-2)
        const pieces = readSubsprites(rom, info.subspriteTables, t);
        if (!pieces || !needsComposition(pieces, w, h)) continue;
        const b = composeBounds(pieces, false, false);
        composed[g] = `${b.width}x${b.height}`;
      }
    }
    // the truck, the S.S. Tidal and the submarine shadow (the last two exceed a slot and stay as they are)
    expect(composed).toEqual({ 94: '48x48', 140: '96x40', 141: '88x32' });
    expect(readObjectGraphicsInfo(rom, 60)!.subspriteTables).toBe(0);
  });
  it('reads frame tiles and palettes by tag', () => {
    expect(readFrameImage(rom, readObjectGraphicsInfo(rom, 59)!, 0)).toHaveLength(128);
    expect(readObjectPalette(rom, 0x1105)).toHaveLength(16);
    expect(readObjectPalette(rom, 0x7777)).toBeNull();
  });
});

describe('preview actors from map templates', () => {
  const rom = new RomReader(loadRom());
  const build = (group: number, num: number, removing = false) => {
    const map = loadMap(rom, group, num);
    const vram = new Uint8Array(0x18000);
    const palette = new Uint16Array(512);
    return { map, vram, palette, actors: buildPreviewActors(rom, vram, palette, map.events.objects, { removing }) };
  };

  it('pairs sprite i with object i and places them as live play does (the truck: y*16)', () => {
    const { map, vram, palette, actors } = build(0, 9); // Littleroot Town
    const templates = map.events.objects.filter((t) => t.graphicsId < 239);
    expect(actors.objects).toHaveLength(templates.length);
    expect(actors.sprites).toHaveLength(templates.length);
    actors.objects.forEach((o, i) => {
      const t = templates[i];
      expect(o).toMatchObject({ index: i, spriteId: i, graphicsId: t.graphicsId, localId: t.localId, x: t.x, y: t.y });
      const s = actors.sprites[i];
      expect(s).toMatchObject({ index: i, coordOffset: true, worldX: t.x * 16 + 8 });
      expect(s.data[0]).toBe(i);
      // tiles and palette of the sprite hold the object's frame 0 and palette
      const info = readObjectGraphicsInfo(rom, t.graphicsId)!;
      const img = readFrameImage(rom, info, 0);
      expect(vram.subarray(0x10000 + s.tileNum * 32, 0x10000 + s.tileNum * 32 + img.length)).toEqual(img);
      expect(palette.subarray(256 + s.palette * 16, 256 + s.palette * 16 + 16)).toEqual(readObjectPalette(rom, info.paletteTag));
    });
    const truck = actors.sprites[templates.findIndex((t) => t.graphicsId === 94)];
    const tt = templates.find((t) => t.graphicsId === 94)!;
    // the truck: its 48×48 image composed from subsprite table 0 (as live play draws it), bottom on its cell's bottom
    expect(truck).toMatchObject({ width: 48, height: 48, c2cX: -24, c2cY: -24, worldX: tt.x * 16 + 8, worldY: tt.y * 16 + 16 });
    expect(truck).toMatchObject({ subspriteTableNum: 0, subspriteMode: 2 });
    expect(truck.attr0 >>> 14).toBe(0); // the base OAM stays 32×32 (square, size 2)
    expect(truck.attr1 >>> 14).toBe(2);
    expect(truck.pieces).toHaveLength(12);
    expect(truck.pieces![1]).toEqual({ x: 32, y: 0, width: 16, height: 8, tileOffset: 4 });
    // the sprite's centre is unchanged (y: live play's cell * 16 + 16 + c2cY), as Task 8's model foot reads it
    expect(truck.worldY - truck.height - truck.c2cY).toBe(truck.y);
    expect(truck.y).toBe(tt.y * 16 - 8);
    const npc = actors.sprites.find((s, i) => readObjectGraphicsInfo(rom, templates[i].graphicsId)!.height === 32)!;
    expect(npc).toMatchObject({ width: 16, height: 32, c2cX: -8, c2cY: -16, pieces: null });
    expect(npc.worldY).toBe(actors.objects[npc.index].y * 16 + 16);
    // each (graphics, frame) is copied once: two objects of one graphics id share their tiles
    const byGfx = new Map<number, number>();
    actors.objects.forEach((o, i) => {
      const tile = actors.sprites[i].tileNum;
      expect(byGfx.get(o.graphicsId) ?? tile).toBe(tile);
      byGfx.set(o.graphicsId, tile);
    });
  });

  it('shows every berry growth stage (animNum = localId % 5) with its stage graphics, as live play', () => {
    const { actors, palette } = build(0, 19); // Route 104
    const trees = actors.objects.filter((o) => o.graphicsId >= 60 && o.graphicsId <= 62);
    expect(trees.length).toBeGreaterThan(4);
    const stages = new Set<number>();
    for (const o of trees) {
      const s = actors.sprites[o.index];
      expect(s.animNum).toBe(o.localId % 5);
      stages.add(s.animNum);
      // SetBerryTreeGraphics: early stages gfx 61 (16x16), late stages gfx 62 (16x32), their tables;
      // subsprites stay off on map entry (spawned as gfx 60, which has none; live play turns them on after
      // a return to field); the table number follows elevation
      const stageGfx = s.animNum < 2 ? 61 : 62;
      expect(o.graphicsId).toBe(stageGfx);
      const info = readObjectGraphicsInfo(rom, stageGfx)!;
      expect(s).toMatchObject({ width: 16, height: s.animNum < 2 ? 16 : 32, c2cX: -8, c2cY: s.animNum < 2 ? -8 : -16 });
      expect(s).toMatchObject({ images: info.images, subspriteTables: info.subspriteTables, subspriteMode: 0, subspriteTableNum: 1, pieces: null });
      expect(info.subspriteTables).not.toBe(0);
      expect(s.worldY).toBe(o.y * 16 + 16);
      // live play draws the (Pecha) stages in OBJ palettes 3, 4, 4, 4, 4: tags NPC_2, NPC_3
      expect(palette.subarray(256 + s.palette * 16, 256 + s.palette * 16 + 16))
        .toEqual(readObjectPalette(rom, s.animNum === 0 ? 0x1104 : 0x1105));
    }
    expect(stages.size).toBe(5);
  });

  it('sets the breaking anim on Cut trees and rocks when removing', () => {
    const { actors } = build(0, 31, true); // Route 116
    const trees = actors.objects.filter((o) => o.graphicsId === 82);
    expect(trees.length).toBeGreaterThan(0);
    for (const o of trees) expect(actors.sprites[o.index].animNum).toBe(1);
    expect(build(0, 31).actors.sprites[trees[0].index].animNum).toBe(0);
  });

  it('warns about what it leaves out (OBJ VRAM full) or draws with a stand-in palette (> 16 tags)', () => {
    const template = (g: number, i: number) => ({
      localId: i + 1, graphicsId: g, kind: 0, x: i % 20, y: (i / 20) | 0, elevation: 3, movementType: 0,
      movementRangeX: 0, movementRangeY: 0, trainerType: 0, trainerRangeOrBerryTreeId: 0, script: 0, flagId: 0,
    });
    const run = (gfx: number[]) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const actors = buildPreviewActors(rom, new Uint8Array(0x18000), new Uint16Array(512), gfx.map(template), { removing: false });
        return { actors, messages: warn.mock.calls.map((c) => String(c[0])) };
      } finally {
        warn.mockRestore();
      }
    };
    // one object of every graphics id: more tiles than OBJ VRAM holds
    const all = run(Array.from({ length: 239 }, (_, g) => g));
    expect(all.messages.some((m) => m.includes('overflow OBJ VRAM'))).toBe(true);
    expect(all.actors.sprites.length).toBe(all.actors.objects.length);
    expect(all.actors.sprites.length).toBeLessThan(239);
    expect(all.actors.sprites.every((s) => s.tileNum + (s.width * s.height) / 64 <= 1024)).toBe(true);
    // one object per distinct palette tag: more tags than 16 slots
    const byTag = new Map<number, number>();
    for (let g = 0; g < 239; g++) {
      const tag = readObjectGraphicsInfo(rom, g)?.paletteTag;
      if (tag !== undefined && !byTag.has(tag)) byTag.set(tag, g);
    }
    expect(byTag.size).toBeGreaterThan(16);
    const tags = run([...byTag.values()]);
    expect(tags.messages.some((m) => m.includes('past 16 slots'))).toBe(true);
    expect(tags.actors.sprites.length).toBe(byTag.size);
    expect(tags.actors.sprites.every((s) => s.palette <= 15)).toBe(true);
  });
});
