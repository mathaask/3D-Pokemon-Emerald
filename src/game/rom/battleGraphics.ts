// Battle graphics straight from the ROM, for the static battle preview and the Modern arena: the background
// DrawMainBattleBackground loads (battle_bg.c), the Pokémon front/back pictures with their placement
// (battle_anim_mons.c GetBattlerSpriteFinal_Y) and the floating enemy's shadow (battle_anim_smokescreen.c).
// Layouts follow pokeemerald include/sprite.h and include/data.h. Browser-safe.

import { RomError, type RomReader } from './reader';
import { SYM, SYM_SIZE } from '../symbols';
import { ARENA_BACKGROUND, type ArenaKind } from '../../render/battle/arenaKind';

export interface BattleBackgroundGfx { tiles: Uint8Array; tilemap: Uint8Array; palette: Uint16Array /* 48: BG palettes 2–4 */ }

function symAddr(name: string): number {
  const a = (SYM as Readonly<Record<string, number>>)[name];
  if (a === undefined) throw new RomError(`no symbol ${name} (add it to tools/gen-symbols.ts)`);
  return a;
}

/** `count` BGR555 colours of LZ77 palette data at `addr` (LoadCompressedPalette: the first `count` of it). */
function compressedPalette(rom: RomReader, addr: number, count: number): Uint16Array {
  const raw = rom.lz77(addr);
  if (raw.length < count * 2) throw new RomError(`palette at 0x${addr.toString(16)} holds ${raw.length >> 1} < ${count} colours`);
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = raw[i * 2] | (raw[i * 2 + 1] << 8);
  return out;
}

/** The background graphics of `kind`: LZ77 tiles, tilemap and palette (3 × 16 colours), via ARENA_BACKGROUND. */
export function readBattleBackground(rom: RomReader, kind: ArenaKind): BattleBackgroundGfx {
  const bg = ARENA_BACKGROUND[kind];
  return {
    tiles: rom.lz77(symAddr(bg.tiles)),
    tilemap: rom.lz77(symAddr(bg.tilemap)),
    palette: compressedPalette(rom, symAddr(bg.palette), 48),
  };
}

/** BG3CNT in battle: priority 3, char base 2, screen base 26, 4bpp, 64×32 tiles. */
export const BG3CNT_BATTLE = 0x5a0b;
const BG3_TILES = 0x8000;     // BG_CHAR_ADDR(2)
const BG3_TILEMAP = 0xd000;   // BG_SCREEN_ADDR(26)
const BG3_PALETTE = 32;       // BG_PLTT_ID(2)

/** Lays it out as LoadBattleTextboxAndBackground does: tiles at 0x8000, tilemap at 0xD000, palettes into pal[32..79];
 *  returns the BG3CNT to decode it with. */
export function installBattleBackground(gfx: BattleBackgroundGfx, vram: Uint8Array, pal: Uint16Array): number {
  // in the game's order: the tilemap lands after (and over) the tiles
  vram.set(gfx.tiles.subarray(0, Math.max(0, vram.length - BG3_TILES)), BG3_TILES);
  vram.set(gfx.tilemap.subarray(0, Math.max(0, vram.length - BG3_TILEMAP)), BG3_TILEMAP);
  pal.set(gfx.palette, BG3_PALETTE);
  return BG3CNT_BATTLE;
}

export interface MonPic { tiles: Uint8Array /* 2048: 64×64 4bpp, frame 0 */; palette: Uint16Array /* 16 */; yOffset: number; elevation: number }

const MON_PIC_BYTES = 64 * 64 / 2;
const SHEET_SIZE = 8;     // CompressedSpriteSheet { const u32 *data; u16 size; u16 tag; }
const PALETTE_SIZE = 8;   // CompressedSpritePalette { const u32 *data; u16 tag; } (padded)
const COORDS_SIZE = 4;    // MonCoords { u8 size; u8 y_offset; } (padded)

/** gMonFrontPicTable / gMonBackPicTable[species] (CompressedSpriteSheet, 8 bytes: data, size, tag; front pics hold two
 *  frames — frame 0 = first 2048 bytes), gMonPaletteTable (CompressedSpritePalette, 8 bytes), gMon{Front,Back}PicCoords
 *  (MonCoords padded to 4 bytes: size u8, y_offset u8), gEnemyMonElevation (u8 per species; back pics: 0). */
export function readMonPic(rom: RomReader, species: number, side: 'front' | 'back'): MonPic {
  const front = side === 'front';
  const table = front ? SYM.gMonFrontPicTable : SYM.gMonBackPicTable;
  const count = (front ? SYM_SIZE.gMonFrontPicTable : SYM_SIZE.gMonBackPicTable) / SHEET_SIZE;
  if (!Number.isInteger(species) || species < 0 || species >= count) throw new RomError(`species ${species} out of range`);
  const pic = rom.lz77(rom.u32(table + species * SHEET_SIZE));
  if (pic.length < MON_PIC_BYTES) throw new RomError(`species ${species} ${side} pic holds ${pic.length} bytes`);
  const palette = compressedPalette(rom, rom.u32(SYM.gMonPaletteTable + species * PALETTE_SIZE), 16);
  const coords = (front ? SYM.gMonFrontPicCoords : SYM.gMonBackPicCoords) + species * COORDS_SIZE;
  // GetBattlerElevation: species past the table (Unown's letters) use entry 0
  const elevation = front ? rom.u8(SYM.gEnemyMonElevation + (species < SYM_SIZE.gEnemyMonElevation ? species : 0)) : 0;
  return { tiles: pic.slice(0, MON_PIC_BYTES), palette, yOffset: rom.u8(coords + 1), elevation };
}

/** sBattlerCoords[double][position]: the battler sprite's centre before its picture's offsets. */
const BATTLER_COORDS: readonly (readonly { x: number; y: number }[])[] = [
  [{ x: 72, y: 80 }, { x: 176, y: 40 }, { x: 48, y: 40 }, { x: 112, y: 80 }],
  [{ x: 32, y: 80 }, { x: 200, y: 40 }, { x: 90, y: 88 }, { x: 152, y: 32 }],
];

/** Sprite top-left as the game creates a battler: sBattlerCoords[double][position] (singles {72,80},{176,40},{48,40},
 *  {112,80}; doubles {32,80},{200,40},{90,88},{152,32}) − 32, y + yOffset − elevation on the enemy side (odd positions). */
export function battlerScreenPos(pic: MonPic, position: number, double: boolean): { x: number; y: number } {
  const c = BATTLER_COORDS[double ? 1 : 0][position & 3];
  const elevation = position & 1 ? pic.elevation : 0;
  // GetBattlerSpriteFinal_Y returns a u8; the 64×64 sprite is centred on it
  return { x: c.x - 32, y: ((c.y + pic.yOffset - elevation) & 0xff) - 32 };
}

/** The floating enemy's shadow: gEnemyMonShadow_Gfx (LZ77, 32×8 4bpp) and its palette (gBattleInterface_BallStatusBarPal,
 *  the healthbox palette its tag 0xD6FF names). */
export function readEnemyShadow(rom: RomReader): { tiles: Uint8Array; palette: Uint16Array } {
  return { tiles: rom.lz77(SYM.gEnemyMonShadow_Gfx), palette: rom.u16Array(SYM.gBattleInterface_BallStatusBarPal, 16) };
}
