// Object-event graphics straight from the ROM: gObjectEventGraphicsInfoPointers (per graphics id:
// palette tag, image size, OAM, subsprites, anims, frame images) and sObjectEventSpritePalettes.
// Layouts follow pokeemerald include/global.fieldmap.h and include/sprite.h. Browser-safe.

import type { RomReader } from './reader';
import { SYM, SYM_SIZE } from '../symbols';

/** Graphics ids at and above this are VAR ids (OBJ_EVENT_GFX_VARS: resolved from a script variable). */
export const NUM_OBJ_EVENT_GFX = 239;

export interface ObjectGraphicsInfo {
  graphicsId: number;
  paletteTag: number;
  /** Bytes of one frame image (4bpp: 32 per 8×8 tile). */
  size: number;
  /** Image size in pixels (centerToCornerVec = −(width >> 1), −(height >> 1)). */
  width: number;
  height: number;
  paletteSlot: number;
  inanimate: boolean;
  /** ROM pointers: OamData, SubspriteTable[] (0: none), AnimCmd*[], SpriteFrameImage[]. */
  oam: number;
  subspriteTables: number;
  anims: number;
  images: number;
}

const INFO_SIZE = 0x24;
const FRAME_IMAGE_SIZE = 8; // SpriteFrameImage { const void *data; u16 size; }
const PALETTE_ENTRY_SIZE = 8; // SpritePalette { const u16 *data; u16 tag; }
const MAX_PALETTES = SYM_SIZE.sObjectEventSpritePalettes / PALETTE_ENTRY_SIZE; // 36
/** OBJ_EVENT_PAL_TAG_NONE: the terminator of BUGFIX builds (retail ends the table with tag 0). */
const PAL_TAG_NONE = 0x11ff;

/** The ObjectEventGraphicsInfo of a graphics id; null for VAR ids (≥ 239) or a bad pointer. */
export function readObjectGraphicsInfo(rom: RomReader, graphicsId: number): ObjectGraphicsInfo | null {
  if (!Number.isInteger(graphicsId) || graphicsId < 0 || graphicsId >= NUM_OBJ_EVENT_GFX) return null;
  const a = rom.u32(SYM.gObjectEventGraphicsInfoPointers + graphicsId * 4);
  if (!rom.isRomPtr(a) || !rom.isRomPtr(a + INFO_SIZE - 1)) return null;
  const oam = rom.u32(a + 0x10);
  const subspriteTables = rom.u32(a + 0x14);
  const anims = rom.u32(a + 0x18);
  const images = rom.u32(a + 0x1c);
  if (!rom.isRomPtr(oam) || !rom.isRomPtr(anims) || !rom.isRomPtr(images)) return null;
  const bits = rom.u8(a + 0x0c); // paletteSlot:4 | shadowSize:2 | inanimate:1 | disableReflectionPaletteLoad:1
  return {
    graphicsId,
    paletteTag: rom.u16(a + 2),
    size: rom.u16(a + 6),
    width: rom.s16(a + 8),
    height: rom.s16(a + 0x0a),
    paletteSlot: bits & 0xf,
    inanimate: (bits & 0x40) !== 0,
    oam,
    subspriteTables: rom.isRomPtr(subspriteTables) ? subspriteTables : 0,
    anims,
    images,
  };
}

/** The base OAM shape and size codes of an object (OamData attr0 bits 14-15, attr1 bits 14-15). */
export function readOamShape(rom: RomReader, info: ObjectGraphicsInfo): { shape: number; size: number } {
  return { shape: (rom.u16(info.oam) >>> 14) & 3, size: (rom.u16(info.oam + 2) >>> 14) & 3 };
}

/** A copy of frame `frame`'s tiles: its own `SpriteFrameImage.size` bytes, 4bpp tiles in 1D order. */
export function readFrameImage(rom: RomReader, info: ObjectGraphicsInfo, frame: number): Uint8Array {
  const f = info.images + frame * FRAME_IMAGE_SIZE;
  const data = rom.u32(f);
  const size = rom.u16(f + 4);
  return rom.bytes(data, size).slice();
}

/** Image index of the first frame of anim `animNum` (anims[animNum] → first AnimCmd, imageValue = low 16 bits). */
export function firstAnimFrame(rom: RomReader, info: ObjectGraphicsInfo, animNum: number): number {
  const anim = rom.u32(info.anims + animNum * 4);
  if (!rom.isRomPtr(anim)) return 0;
  const imageValue = rom.u32(anim) & 0xffff;
  // (a script starting with a jump, loop or end command — type −3..−1 — shows its first image)
  return imageValue >= 0xfffd ? 0 : imageValue;
}

/** The 16 BGR555 colours sObjectEventSpritePalettes holds for `tag`, or null if it has none. */
export function readObjectPalette(rom: RomReader, tag: number): Uint16Array | null {
  for (let i = 0; i < MAX_PALETTES; i++) {
    const e = SYM.sObjectEventSpritePalettes + i * PALETTE_ENTRY_SIZE;
    const data = rom.u32(e);
    const t = rom.u16(e + 4);
    if (t === 0 || t === PAL_TAG_NONE || data === 0) break;
    if (t === tag) return rom.isRomPtr(data) ? rom.u16Array(data, 16) : null;
  }
  return null;
}
