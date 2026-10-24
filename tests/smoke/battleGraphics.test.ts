import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { RomReader } from '../../src/game/rom/reader';
import { loadRom } from './helpers/staticMap';
import { ARENA_KINDS, arenaKind, type ArenaKind } from '../../src/render/battle/arenaKind';
import { decodeBg3, sampleArenaColors, BG_W, BG_H, type ArenaColors } from '../../src/render/battle/bgSample';
import { readBattleBackground, installBattleBackground, readMonPic, battlerScreenPos, readEnemyShadow } from '../../src/game/rom/battleGraphics';
import { Gba } from '../../src/gba/gba';
import { GameState } from '../../src/game/state';
import { encodePng, upscale } from '../../tools/lib/png';
import { arenaPalette } from '../../src/render/battle/palette';
import { GroundMat } from '../../src/render/kit/terrain';

const root = path.resolve(import.meta.dirname, '../..');
const hex = (c: number[]) => c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
describe('battle graphics from the ROM', () => {
  const rom = new RomReader(loadRom());
  const colors = new Map<ArenaKind, ArenaColors>();
  it('decodes every arena kind\'s background into a valid colour set', () => {
    const dir = path.join(root, 'out/battle-bg');
    fs.mkdirSync(dir, { recursive: true });
    const lines: string[] = [];
    for (const kind of ARENA_KINDS) {
      const gfx = readBattleBackground(rom, kind);
      expect(gfx.tiles.length, kind).toBeGreaterThanOrEqual(0x1000);
      const vram = new Uint8Array(0x18000), pal = new Uint16Array(512);
      const img = decodeBg3(vram, pal, installBattleBackground(gfx, vram, pal));
      const c = sampleArenaColors(img);
      expect(c, kind).not.toBeNull();
      colors.set(kind, c!);
      // (also: out/battle-bg/<kind>.png at 2x and out/battle-colors.txt)
      const rgba = new Uint8Array(BG_W * BG_H * 4);
      for (let i = 0; i < img.length; i++) {
        const v = img[i];
        rgba[i * 4] = ((v & 31) * 255 / 31) | 0;
        rgba[i * 4 + 1] = (((v >> 5) & 31) * 255 / 31) | 0;
        rgba[i * 4 + 2] = (((v >> 10) & 31) * 255 / 31) | 0;
        rgba[i * 4 + 3] = 255;
      }
      fs.writeFileSync(path.join(dir, `${kind}.png`), encodePng(BG_W * 2, BG_H * 2, upscale(BG_W, BG_H, rgba, 2)));
      lines.push(`${kind.padEnd(10)} backdrop ${hex(c!.backdrop)} stripe ${hex(c!.stripe)} top ${hex(c!.top)} ` +
        `platform ${hex(c!.platform)} detail ${hex(c!.platformDetail)} rim ${hex(c!.rim)}`);
    }
    fs.writeFileSync(path.join(root, 'out/battle-colors.txt'), lines.join('\n') + '\n');
  });
  it('samples the colours each kind is known for', () => {
    const green = (c: number[]) => c[1] > c[0] && c[1] > c[2];
    const blue = (c: number[]) => c[2] > c[0] + 0.2;
    expect(green(colors.get('grass')!.platform) && green(colors.get('longGrass')!.platform)).toBe(true);
    for (const k of ['water', 'pond', 'kyogre'] as const) expect(blue(colors.get(k)!.platform), k).toBe(true);
    expect(green(colors.get('pond')!.rim)).toBe(true);                                        // lily pads
    expect(colors.get('magma')!.platform[0]).toBeGreaterThan(colors.get('magma')!.platform[2] + 0.4); // orange
  });
  it('derives an in-gamut arena palette from every background, in the colours each kind is known for', () => {
    const lines: string[] = [];
    for (const kind of ARENA_KINDS) {
      const p = arenaPalette(kind, colors.get(kind)!);
      for (const [name, v] of Object.entries(p)) {
        if (!Array.isArray(v)) continue;
        for (const x of v) { expect(x, `${kind} ${name}`).toBeGreaterThanOrEqual(0); expect(x, `${kind} ${name}`).toBeLessThanOrEqual(1); }
      }
      lines.push(`${kind.padEnd(10)} ground ${hex(p.ground)} path ${hex(p.path)} top ${hex(p.platformTop)} side ${hex(p.platformSide)} ` +
        `skirt ${hex(p.skirt)} leaf ${hex(p.leaf)} blade ${hex(p.blade)} water ${hex(p.water)} wall ${hex(p.wall)}`);
    }
    fs.writeFileSync(path.join(root, 'out/battle-palettes.txt'), lines.join('\n') + '\n');
    const green = (c: number[]) => c[1] > c[0] && c[1] > c[2];
    for (const k of ['grass', 'longGrass', 'plain'] as const) {
      const p = arenaPalette(k, colors.get(k)!);
      expect(p.groundMat).toBe(GroundMat.Grass);
      expect(green(p.ground) && green(p.platformTop), k).toBe(true);
    }
    expect(green(arenaPalette('pond', colors.get('pond')!).platformTop)).toBe(true);                      // lily pads
    const magma = arenaPalette('magma', colors.get('magma')!).platformTop;
    expect(magma[0]).toBeGreaterThan(magma[2] + 0.4);                                                   // Magma orange
    const water = arenaPalette('water', colors.get('water')!).water;
    expect(water[2]).toBeGreaterThan(water[0] + 0.2);                                                   // blue water
  });
  it('places battlers where the game does', () => {
    expect(battlerScreenPos(readMonPic(rom, 280, 'back'), 0, false)).toEqual({ x: 40, y: 53 });   // Torchic (battle1.state)
    expect(battlerScreenPos(readMonPic(rom, 288, 'front'), 1, false)).toEqual({ x: 144, y: 23 }); // Zigzagoon
    expect(battlerScreenPos(readMonPic(rom, 290, 'front'), 1, false)).toEqual({ x: 144, y: 22 }); // Wurmple (fuzz.state)
    expect(readMonPic(rom, 41, 'front').elevation).toBe(8);                                      // Zubat floats
    expect(readMonPic(rom, 280, 'back').tiles).toHaveLength(2048);
    expect(readEnemyShadow(rom).tiles).toHaveLength(128);
  });
  it('places Castform\'s normal form by the game\'s own offsets, not the tables\'', () => {
    // battle_anim_mons.c: gCastformFrontSpriteCoords y 17, sCastformElevations 13, sCastformBackSpriteYCoords 0
    // (the ROM tables hold elevation 16 and back y_offset 13 for species 385)
    expect(readMonPic(rom, 385, 'front')).toMatchObject({ yOffset: 17, elevation: 13 });
    expect(readMonPic(rom, 385, 'back')).toMatchObject({ yOffset: 0, elevation: 0 });
    expect(battlerScreenPos(readMonPic(rom, 385, 'front'), 1, false)).toEqual({ x: 144, y: 12 });
    expect(battlerScreenPos(readMonPic(rom, 385, 'back'), 0, false)).toEqual({ x: 40, y: 48 });
  });
  it('reads the arena inputs of a live battle', () => {
    const gba = new Gba(new Uint8Array(loadRom()));
    gba.loadState(new Uint8Array(fs.readFileSync(path.join(root, 'out/battle1.state'))));
    for (let i = 0; i < 2; i++) gba.runFrame();
    const st = new GameState(gba.bus);
    st.update();
    expect([st.battleEnvironment, st.trainerClass, st.mapBattleScene]).toEqual([9, 0, 0]);
    expect(arenaKind({ environment: st.battleEnvironment, battleType: st.battleType, trainerClass: st.trainerClass,
      mapBattleScene: st.mapBattleScene, mapType: st.mapType })).toBe('plain');
  });
});
