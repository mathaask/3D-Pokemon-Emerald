// Static decoder for Emerald `struct Tileset` (include/global.fieldmap.h) and a software
// metatile renderer. Browser-safe.
import { RomReader } from './reader';

export const NUM_TILES_IN_PRIMARY = 512;
export const NUM_TILES_TOTAL = 1024;
export const NUM_METATILES_IN_PRIMARY = 512;
export const NUM_METATILES_TOTAL = 1024;
export const NUM_PALS_IN_PRIMARY = 6;
export const NUM_PALS_TOTAL = 13;
export const NUM_METATILE_BEHAVIORS = 0xf0;

export const LayerType = { NORMAL: 0, COVERED: 1, SPLIT: 2 } as const;
/**
 * How each layer type maps to GBA BG layers (field_camera.c DrawMetatile). Objects (the player,
 * NPCs) are drawn between BG2 and BG1, so only a NORMAL/SPLIT metatile's top layer covers them.
 *  NORMAL : bottom -> BG2 (under objects), top -> BG1 (over objects)
 *  COVERED: bottom -> BG3, top -> BG2 (both under objects)
 *  SPLIT  : bottom -> BG3 (under objects), top -> BG1 (over objects)
 */
export const LAYER_TYPE_NAMES = ['NORMAL', 'COVERED', 'SPLIT'];

// Metatile behaviours (include/constants/metatile_behaviors.h; MB_UNUSED_* omitted).
export const MB = {
  NORMAL: 0x00, SECRET_BASE_WALL: 0x01, TALL_GRASS: 0x02, LONG_GRASS: 0x03, DEEP_SAND: 0x06,
  SHORT_GRASS: 0x07, CAVE: 0x08, LONG_GRASS_SOUTH_EDGE: 0x09, NO_RUNNING: 0x0a,
  INDOOR_ENCOUNTER: 0x0b, MOUNTAIN_TOP: 0x0c, BATTLE_PYRAMID_WARP: 0x0d, MOSSDEEP_GYM_WARP: 0x0e,
  MT_PYRE_HOLE: 0x0f, POND_WATER: 0x10, INTERIOR_DEEP_WATER: 0x11, DEEP_WATER: 0x12,
  WATERFALL: 0x13, SOOTOPOLIS_DEEP_WATER: 0x14, OCEAN_WATER: 0x15, PUDDLE: 0x16,
  SHALLOW_WATER: 0x17, NO_SURFACING: 0x19, STAIRS_OUTSIDE_ABANDONED_SHIP: 0x1b,
  SHOAL_CAVE_ENTRANCE: 0x1c, ICE: 0x20, SAND: 0x21, SEAWEED: 0x22, ASHGRASS: 0x24,
  FOOTPRINTS: 0x25, THIN_ICE: 0x26, CRACKED_ICE: 0x27, HOT_SPRINGS: 0x28,
  LAVARIDGE_GYM_B1F_WARP: 0x29, SEAWEED_NO_SURFACING: 0x2a, REFLECTION_UNDER_BRIDGE: 0x2b,
  IMPASSABLE_EAST: 0x30, IMPASSABLE_WEST: 0x31, IMPASSABLE_NORTH: 0x32, IMPASSABLE_SOUTH: 0x33,
  IMPASSABLE_NORTHEAST: 0x34, IMPASSABLE_NORTHWEST: 0x35, IMPASSABLE_SOUTHEAST: 0x36,
  IMPASSABLE_SOUTHWEST: 0x37, JUMP_EAST: 0x38, JUMP_WEST: 0x39, JUMP_NORTH: 0x3a, JUMP_SOUTH: 0x3b,
  JUMP_NORTHEAST: 0x3c, JUMP_NORTHWEST: 0x3d, JUMP_SOUTHEAST: 0x3e, JUMP_SOUTHWEST: 0x3f,
  WALK_EAST: 0x40, WALK_WEST: 0x41, WALK_NORTH: 0x42, WALK_SOUTH: 0x43, SLIDE_EAST: 0x44,
  SLIDE_WEST: 0x45, SLIDE_NORTH: 0x46, SLIDE_SOUTH: 0x47, TRICK_HOUSE_PUZZLE_8_FLOOR: 0x48,
  EASTWARD_CURRENT: 0x50, WESTWARD_CURRENT: 0x51, NORTHWARD_CURRENT: 0x52, SOUTHWARD_CURRENT: 0x53,
  NON_ANIMATED_DOOR: 0x60, LADDER: 0x61, EAST_ARROW_WARP: 0x62, WEST_ARROW_WARP: 0x63,
  NORTH_ARROW_WARP: 0x64, SOUTH_ARROW_WARP: 0x65, CRACKED_FLOOR_HOLE: 0x66,
  AQUA_HIDEOUT_WARP: 0x67, LAVARIDGE_GYM_1F_WARP: 0x68, ANIMATED_DOOR: 0x69, UP_ESCALATOR: 0x6a,
  DOWN_ESCALATOR: 0x6b, WATER_DOOR: 0x6c, WATER_SOUTH_ARROW_WARP: 0x6d, DEEP_SOUTH_WARP: 0x6e,
  BRIDGE_OVER_OCEAN: 0x70, BRIDGE_OVER_POND_LOW: 0x71, BRIDGE_OVER_POND_MED: 0x72,
  BRIDGE_OVER_POND_HIGH: 0x73, PACIFIDLOG_VERTICAL_LOG_TOP: 0x74,
  PACIFIDLOG_VERTICAL_LOG_BOTTOM: 0x75, PACIFIDLOG_HORIZONTAL_LOG_LEFT: 0x76,
  PACIFIDLOG_HORIZONTAL_LOG_RIGHT: 0x77, FORTREE_BRIDGE: 0x78, BRIDGE_OVER_POND_MED_EDGE_1: 0x7a,
  BRIDGE_OVER_POND_MED_EDGE_2: 0x7b, BRIDGE_OVER_POND_HIGH_EDGE_1: 0x7c,
  BRIDGE_OVER_POND_HIGH_EDGE_2: 0x7d, BIKE_BRIDGE_OVER_BARRIER: 0x7f, COUNTER: 0x80, PC: 0x83,
  CABLE_BOX_RESULTS_1: 0x84, REGION_MAP: 0x85, TELEVISION: 0x86, POKEBLOCK_FEEDER: 0x87,
  SLOT_MACHINE: 0x89, ROULETTE: 0x8a, CLOSED_SOOTOPOLIS_DOOR: 0x8b, TRICK_HOUSE_PUZZLE_DOOR: 0x8c,
  PETALBURG_GYM_DOOR: 0x8d, RUNNING_SHOES_INSTRUCTION: 0x8e, QUESTIONNAIRE: 0x8f,
  SECRET_BASE_SPOT_RED_CAVE: 0x90, SECRET_BASE_SPOT_RED_CAVE_OPEN: 0x91,
  SECRET_BASE_SPOT_BROWN_CAVE: 0x92, SECRET_BASE_SPOT_BROWN_CAVE_OPEN: 0x93,
  SECRET_BASE_SPOT_YELLOW_CAVE: 0x94, SECRET_BASE_SPOT_YELLOW_CAVE_OPEN: 0x95,
  SECRET_BASE_SPOT_TREE_LEFT: 0x96, SECRET_BASE_SPOT_TREE_LEFT_OPEN: 0x97,
  SECRET_BASE_SPOT_SHRUB: 0x98, SECRET_BASE_SPOT_SHRUB_OPEN: 0x99,
  SECRET_BASE_SPOT_BLUE_CAVE: 0x9a, SECRET_BASE_SPOT_BLUE_CAVE_OPEN: 0x9b,
  SECRET_BASE_SPOT_TREE_RIGHT: 0x9c, SECRET_BASE_SPOT_TREE_RIGHT_OPEN: 0x9d, BERRY_TREE_SOIL: 0xa0,
  SECRET_BASE_PC: 0xb0, SECRET_BASE_REGISTER_PC: 0xb1, SECRET_BASE_SCENERY: 0xb2,
  SECRET_BASE_TRAINER_SPOT: 0xb3, SECRET_BASE_DECORATION: 0xb4, HOLDS_SMALL_DECORATION: 0xb5,
  SECRET_BASE_NORTH_WALL: 0xb7, SECRET_BASE_BALLOON: 0xb8, SECRET_BASE_IMPASSABLE: 0xb9,
  SECRET_BASE_GLITTER_MAT: 0xba, SECRET_BASE_JUMP_MAT: 0xbb, SECRET_BASE_SPIN_MAT: 0xbc,
  SECRET_BASE_SOUND_MAT: 0xbd, SECRET_BASE_BREAKABLE_DOOR: 0xbe, SECRET_BASE_SAND_ORNAMENT: 0xbf,
  IMPASSABLE_SOUTH_AND_NORTH: 0xc0, IMPASSABLE_WEST_AND_EAST: 0xc1, SECRET_BASE_HOLE: 0xc2,
  HOLDS_LARGE_DECORATION: 0xc3, SECRET_BASE_TV_SHIELD: 0xc4, PLAYER_ROOM_PC_ON: 0xc5,
  SECRET_BASE_DECORATION_BASE: 0xc6, SECRET_BASE_POSTER: 0xc7, MUDDY_SLOPE: 0xd0,
  BUMPY_SLOPE: 0xd1, CRACKED_FLOOR: 0xd2, ISOLATED_VERTICAL_RAIL: 0xd3,
  ISOLATED_HORIZONTAL_RAIL: 0xd4, VERTICAL_RAIL: 0xd5, HORIZONTAL_RAIL: 0xd6,
  PICTURE_BOOK_SHELF: 0xe0, BOOKSHELF: 0xe1, POKEMON_CENTER_BOOKSHELF: 0xe2, VASE: 0xe3,
  TRASH_CAN: 0xe4, SHOP_SHELF: 0xe5, BLUEPRINT: 0xe6, CABLE_BOX_RESULTS_2: 0xe7,
  WIRELESS_BOX_RESULTS: 0xe8, TRAINER_HILL_TIMER: 0xe9, SKY_PILLAR_CLOSED_DOOR: 0xea,
} as const;

const MB_NAMES: string[] = (() => {
  const t: string[] = [];
  for (let i = 0; i < 256; i++) t.push(`UNUSED_${i.toString(16).toUpperCase().padStart(2, '0')}`);
  for (const [k, v] of Object.entries(MB)) t[v] = k;
  t[0xff] = 'INVALID';
  return t;
})();

/** Name of a metatile behaviour without the MB_ prefix (e.g. "TALL_GRASS"). */
export function behaviorName(b: number): string {
  return MB_NAMES[b & 0xff];
}

export const attrBehavior = (a: number): number => a & 0xff;
export const attrLayerType = (a: number): number => (a >> 12) & 0xf;

export interface Tileset {
  addr: number;
  isCompressed: boolean;
  isSecondary: boolean;
  tilesAddr: number;
  palettesAddr: number;
  metatilesAddr: number;
  attributesAddr: number;
  callback: number;
  /** Raw 4bpp tile data (32 bytes per tile), decompressed. */
  tiles: Uint8Array;
  numTiles: number;
  /** One byte per pixel (palette index 0-15), 64 bytes per tile. */
  pixels: Uint8Array;
  /** 16 palettes x 16 colours, BGR555 as stored in ROM. */
  palettes: Uint16Array;
  /** 8 tile entries per metatile: 4 bottom-layer then 4 top-layer (TL, TR, BL, BR). */
  metatiles: Uint16Array;
  /** One u16 per metatile: behaviour (bits 0-7), layer type (bits 12-15). */
  attributes: Uint16Array;
  numMetatiles: number;
  /** How the metatile count was established ("gap" = attributes follow metatiles directly). */
  countSource: 'gap' | 'scan';
}

function isValidAttr(a: number): boolean {
  return (a & 0xff) < NUM_METATILE_BEHAVIORS && (a & 0x0f00) === 0 && attrLayerType(a) <= 2;
}

/** Expands 4bpp tile data into one palette index per byte. */
export function expand4bpp(tiles: Uint8Array): Uint8Array {
  const out = new Uint8Array(tiles.length * 2);
  for (let i = 0; i < tiles.length; i++) {
    out[i * 2] = tiles[i] & 0xf;
    out[i * 2 + 1] = tiles[i] >> 4;
  }
  return out;
}

/**
 * Decodes the Tileset struct at `addr`. The metatile count is not stored in the ROM; it is
 * inferred from the gap between the metatile and attribute arrays (the build places
 * `gMetatileAttributes_X` directly after `gMetatiles_X`), falling back to scanning up to 512
 * attributes and stopping at the first invalid one.
 */
export function loadTileset(rom: RomReader, addr: number): Tileset {
  const isCompressed = rom.u8(addr) !== 0;
  const isSecondary = rom.u8(addr + 1) !== 0;
  const tilesAddr = rom.u32(addr + 4);
  const palettesAddr = rom.u32(addr + 8);
  const metatilesAddr = rom.u32(addr + 12);
  const attributesAddr = rom.u32(addr + 16);
  const callback = rom.u32(addr + 20);

  const maxTiles = isSecondary ? NUM_TILES_TOTAL - NUM_TILES_IN_PRIMARY : NUM_TILES_IN_PRIMARY;
  let tiles: Uint8Array;
  if (!rom.isRomPtr(tilesAddr)) tiles = new Uint8Array(0);
  else if (isCompressed) tiles = rom.lz77(tilesAddr);
  else tiles = rom.bytes(tilesAddr, Math.min(maxTiles * 32, rom.size - rom.offset(tilesAddr))).slice();
  if (tiles.length > maxTiles * 32) tiles = tiles.subarray(0, maxTiles * 32);
  const numTiles = tiles.length >> 5;

  const palettes = rom.isRomPtr(palettesAddr) ? rom.u16Array(palettesAddr, 16 * 16) : new Uint16Array(256);

  const cap = isSecondary ? NUM_METATILES_TOTAL - NUM_METATILES_IN_PRIMARY : NUM_METATILES_IN_PRIMARY;
  let numMetatiles = 0;
  let countSource: Tileset['countSource'] = 'scan';
  if (rom.isRomPtr(metatilesAddr) && rom.isRomPtr(attributesAddr)) {
    const gap = attributesAddr - metatilesAddr;
    if (gap > 0 && gap % 16 === 0 && gap / 16 <= cap) {
      numMetatiles = gap / 16;
      countSource = 'gap';
    } else {
      while (numMetatiles < cap && isValidAttr(rom.u16(attributesAddr + numMetatiles * 2))) numMetatiles++;
    }
  }
  const metatiles = numMetatiles ? rom.u16Array(metatilesAddr, numMetatiles * 8) : new Uint16Array(0);
  const attributes = numMetatiles ? rom.u16Array(attributesAddr, numMetatiles) : new Uint16Array(0);

  return {
    addr, isCompressed, isSecondary, tilesAddr, palettesAddr, metatilesAddr, attributesAddr, callback,
    tiles, numTiles, pixels: expand4bpp(tiles), palettes, metatiles, attributes, numMetatiles, countSource,
  };
}

/** BGR555 -> packed little-endian RGBA8 (0xAABBGGRR), using the usual 5->8 bit expansion. */
export function bgr555ToRgba32(c: number): number {
  const r = c & 0x1f;
  const g = (c >> 5) & 0x1f;
  const b = (c >> 10) & 0x1f;
  return (
    ((0xff << 24) | (((b << 3) | (b >> 2)) << 16) | (((g << 3) | (g >> 2)) << 8) | ((r << 3) | (r >> 2))) >>> 0
  );
}

export type MetatileLayer = 'bottom' | 'top' | 'both';

const ZERO8 = new Uint16Array(8);
/** Tilemap entry the game writes to BG3 under NORMAL-layer metatiles (tile 0x014, palette 3). */
const NORMAL_BG3_FILL = 0x3014;

/**
 * Primary+secondary tileset pair as loaded into BG VRAM/palette RAM by the game:
 * tiles 0-511 from the primary, 512-1023 from the secondary; palettes 0-5 from the primary,
 * 6-12 from the secondary (palettes 13-15 are filled from the secondary's array for robustness);
 * palette 0 colour 0 (the backdrop) is forced to black like LoadTilesetPalette does.
 */
export class TilesetPair {
  readonly primary: Tileset;
  readonly secondary: Tileset | null;
  /** 256 colours as packed RGBA (little-endian 0xAABBGGRR). */
  readonly palette = new Uint32Array(256);

  constructor(primary: Tileset, secondary: Tileset | null) {
    this.primary = primary;
    this.secondary = secondary;
    for (let p = 0; p < 16; p++) {
      const src = p < NUM_PALS_IN_PRIMARY || !secondary ? primary.palettes : secondary.palettes;
      for (let c = 0; c < 16; c++) this.palette[p * 16 + c] = bgr555ToRgba32(src[p * 16 + c]);
    }
    this.palette[0] = 0xff000000;
  }

  /** Backdrop colour (palette RAM entry 0). */
  get backdrop(): number {
    return this.palette[0];
  }

  /** True if metatile `id` exists (primary ids 0-511, secondary ids from 512). */
  hasMetatile(id: number): boolean {
    if (id < NUM_METATILES_IN_PRIMARY) return id < this.primary.numMetatiles;
    return !!this.secondary && id - NUM_METATILES_IN_PRIMARY < this.secondary.numMetatiles;
  }

  /** Attribute word of a metatile id (0 if out of range). */
  attr(id: number): number {
    if (id < NUM_METATILES_IN_PRIMARY) return this.primary.attributes[id] ?? 0;
    return this.secondary?.attributes[id - NUM_METATILES_IN_PRIMARY] ?? 0;
  }
  behavior(id: number): number {
    return this.attr(id) & 0xff;
  }
  layerType(id: number): number {
    return attrLayerType(this.attr(id));
  }

  /** The 8 tile entries of a metatile (zeros if out of range). */
  entries(id: number): ArrayLike<number> {
    const ts = id < NUM_METATILES_IN_PRIMARY ? this.primary : this.secondary;
    const local = id < NUM_METATILES_IN_PRIMARY ? id : id - NUM_METATILES_IN_PRIMARY;
    if (!ts || local >= ts.numMetatiles) return ZERO8;
    return ts.metatiles.subarray(local * 8, local * 8 + 8);
  }

  /** Palette-index pixels (64 bytes) of VRAM tile `tile` (0-1023), or null if not loaded. */
  tilePixels(tile: number): Uint8Array | null {
    const ts = tile < NUM_TILES_IN_PRIMARY ? this.primary : this.secondary;
    const local = tile < NUM_TILES_IN_PRIMARY ? tile : tile - NUM_TILES_IN_PRIMARY;
    if (!ts || local >= ts.numTiles) return null;
    return ts.pixels.subarray(local * 64, local * 64 + 64);
  }

  /**
   * Draws one metatile layer into an RGBA32 buffer `dst` (row stride `stride` pixels) at pixel
   * position (x, y). Palette colour 0 is transparent. Returns the number of opaque pixels drawn.
   */
  drawLayer(id: number, top: boolean, dst: Uint32Array, stride: number, x: number, y: number): number {
    const e = this.entries(id);
    let opaque = 0;
    for (let q = 0; q < 4; q++) {
      opaque += this.drawTile(e[(top ? 4 : 0) + q], dst, stride, x + (q & 1) * 8, y + (q >> 1) * 8);
    }
    return opaque;
  }

  /**
   * Draws a metatile like the game composites it: optional backdrop, then the bottom layer,
   * then the top layer (colour 0 transparent in both layers). With `backdrop`, the backdrop
   * colour is filled first and, for NORMAL-layer metatiles, the filler tile the game writes to
   * BG3 (tile 0x014, palette 3) is drawn under the bottom layer, as field_camera.c does.
   */
  drawMetatile(
    id: number, layer: MetatileLayer, dst: Uint32Array, stride: number, x: number, y: number, backdrop = false,
  ): void {
    if (backdrop) {
      for (let ty = 0; ty < 16; ty++) dst.fill(this.palette[0], (y + ty) * stride + x, (y + ty) * stride + x + 16);
      if (layer !== 'top' && this.layerType(id) === LayerType.NORMAL) {
        for (let q = 0; q < 4; q++) this.drawTile(NORMAL_BG3_FILL, dst, stride, x + (q & 1) * 8, y + (q >> 1) * 8);
      }
    }
    if (layer !== 'top') this.drawLayer(id, false, dst, stride, x, y);
    if (layer !== 'bottom') this.drawLayer(id, true, dst, stride, x, y);
  }

  /** Draws one 8x8 tilemap entry (tile id, flips, palette) with colour 0 transparent. */
  drawTile(entry: number, dst: Uint32Array, stride: number, x: number, y: number): number {
    const px = this.tilePixels(entry & 0x3ff);
    if (!px) return 0;
    const hflip = (entry >> 10) & 1;
    const vflip = (entry >> 11) & 1;
    const palBase = (entry >> 12) << 4;
    let opaque = 0;
    for (let ty = 0; ty < 8; ty++) {
      const sy = vflip ? 7 - ty : ty;
      const row = (y + ty) * stride + x;
      for (let tx = 0; tx < 8; tx++) {
        const ci = px[sy * 8 + (hflip ? 7 - tx : tx)];
        if (ci) {
          dst[row + tx] = this.palette[palBase | ci];
          opaque++;
        }
      }
    }
    return opaque;
  }

  /** Count of non-transparent pixels (0-256) in one layer of a metatile. */
  layerCoverage(id: number, top: boolean): number {
    return this.drawLayer(id, top, SCRATCH, 16, 0, 0);
  }
}

const SCRATCH = new Uint32Array(256);

const pairCache = new WeakMap<Tileset, WeakMap<object, TilesetPair>>();
const NO_SECONDARY = {};

/** Returns a cached TilesetPair for (primary, secondary). */
export function tilesetPair(primary: Tileset, secondary: Tileset | null): TilesetPair {
  let inner = pairCache.get(primary);
  if (!inner) pairCache.set(primary, (inner = new WeakMap()));
  const key = secondary ?? NO_SECONDARY;
  let pair = inner.get(key);
  if (!pair) inner.set(key, (pair = new TilesetPair(primary, secondary)));
  return pair;
}

/**
 * Renders metatile `id` (0-1023) as a 16x16 RGBA8 image (1024 bytes). Pixels that are
 * transparent (colour 0) in every drawn layer have alpha 0.
 */
export function renderMetatile(
  primary: Tileset, secondary: Tileset | null, id: number, layer: MetatileLayer,
): Uint8Array {
  const out = new Uint32Array(256);
  tilesetPair(primary, secondary).drawMetatile(id, layer, out, 16, 0, 0, false);
  return new Uint8Array(out.buffer);
}
