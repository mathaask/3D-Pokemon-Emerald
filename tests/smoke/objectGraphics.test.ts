import { describe, it, expect } from 'vitest';
import { RomReader } from '../../src/game/rom/reader';
import { readObjectGraphicsInfo, readFrameImage, readObjectPalette } from '../../src/game/rom/objectGraphics';
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
    expect(truck).toMatchObject({ width: 32, height: 32, c2cX: -24, c2cY: -24, worldY: tt.y * 16 });
    const npc = actors.sprites.find((s, i) => readObjectGraphicsInfo(rom, templates[i].graphicsId)!.height === 32)!;
    expect(npc).toMatchObject({ width: 16, height: 32, c2cX: -8, c2cY: -16 });
    expect(npc.worldY).toBe(actors.objects[npc.index].y * 16 + 16);
    // each (graphics, frame) is copied once: two objects of one graphics id share their tiles
    const byGfx = new Map<number, number>();
    actors.objects.forEach((o, i) => {
      const tile = actors.sprites[i].tileNum;
      expect(byGfx.get(o.graphicsId) ?? tile).toBe(tile);
      byGfx.set(o.graphicsId, tile);
    });
  });

  it('shows every berry growth stage (animNum = localId % 5) at its frame size', () => {
    const { actors, palette } = build(0, 19); // Route 104
    const trees = actors.objects.filter((o) => o.graphicsId >= 60 && o.graphicsId <= 62);
    expect(trees.length).toBeGreaterThan(4);
    const stages = new Set<number>();
    for (const o of trees) {
      const s = actors.sprites[o.index];
      expect(s.animNum).toBe(o.localId % 5);
      stages.add(s.animNum);
      expect(s.height).toBe(s.animNum < 2 ? 16 : 32);
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
});
