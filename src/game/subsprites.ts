// Subsprites: a sprite drawn as several OAM pieces (a SubspriteTable) instead of its own OAM shape, as
// pokeemerald's sprite.c AddSubspritesToOamBuffer does. Most object events have one-piece tables that only
// set the priority by elevation; a few build an image larger than their base OAM from strips (the 48×48
// moving truck on a 32×32 OAM, the S.S. Tidal, the submarine shadow). Those are composed here into one
// image: its size, its placement and the pieces inside it, which the sprite atlas bakes.

import type { SpriteSnap } from './state';

/** OBJ [width, height] in pixels by OAM shape (attr0 bits 14-15) and size (attr1 bits 14-15). */
export const OBJ_SIZES: [number, number][][] = [
  [[8, 8], [16, 16], [32, 32], [64, 64]], // square
  [[16, 8], [32, 8], [32, 16], [64, 32]], // horizontal
  [[8, 16], [8, 32], [16, 32], [32, 64]], // vertical
  [[8, 8], [8, 8], [8, 8], [8, 8]],
];

export interface SubspritePiece { x: number; y: number; width: number; height: number; tileOffset: number } // x/y from the sprite centre

/** A piece inside a composed image: x/y from its top-left corner (px). */
export interface PlacedPiece { x: number; y: number; width: number; height: number; tileOffset: number }

/** The largest composed image a sprite atlas slot holds (px). */
export const MAX_COMPOSED = 64;

export const SUBSPRITE_TABLE_SIZE = 8; // struct SubspriteTable { u8 subspriteCount; const struct Subsprite *subsprites; }
const PIECE_SIZE = 4; // struct Subsprite { s8 x; s8 y; u16 shape:2, size:2, tileOffset:10, priority:2; }

/** struct SubspriteTable { u8 count; Subsprite *pieces } (8 bytes) at tables + 8*tableNum; struct Subsprite (4 bytes):
 *  s8 x, s8 y, u16 shape:2 | size:2 | tileOffset:10 | priority:2. null when the table is missing. */
export function readSubsprites(read: { u8(a: number): number; u16(a: number): number; u32(a: number): number; s8(a: number): number },
  tables: number, tableNum: number): SubspritePiece[] | null {
  if (!tables) return null;
  const table = tables + SUBSPRITE_TABLE_SIZE * tableNum;
  const count = read.u8(table);
  const pieces = read.u32(table + 4);
  // (an empty `{}` entry: the GBA draws the base OAM, as for a missing table)
  if (count === 0 || !pieces) return null;
  const out: SubspritePiece[] = [];
  for (let i = 0; i < count; i++) {
    const a = pieces + i * PIECE_SIZE;
    const bits = read.u16(a + 2);
    const [width, height] = OBJ_SIZES[bits & 3][(bits >>> 2) & 3];
    out.push({ x: read.s8(a), y: read.s8(a + 1), width, height, tileOffset: (bits >>> 4) & 0x3ff });
  }
  return out;
}

/** True when the pieces draw something other than the base OAM image (more than one piece covering a different
 *  shape than width×height in row-major 1D order) — only those sprites are composed. (The tile order checked is
 *  that of 1D-mapped 4bpp OBJ tiles, which every object event uses: tileOffset counts 4bpp tiles.) */
export function needsComposition(pieces: readonly SubspritePiece[], width: number, height: number): boolean {
  if (pieces.length === 0) return false;
  if (pieces.length === 1) {
    // (most object events, every frame: one piece is the base image unless its size or first tile differs)
    const p = pieces[0];
    return p.width !== width || p.height !== height || p.tileOffset !== 0;
  }
  const b = composeBounds(pieces, false, false);
  if (b.width !== width || b.height !== height) return true;
  // every 8×8 cell of the image must show the base image's tile there (1D: row-major, width / 8 tiles a row)
  const cols = width >> 3;
  const covered = new Uint8Array(cols * (height >> 3));
  for (const p of b.placed) {
    if ((p.x & 7) !== 0 || (p.y & 7) !== 0) return true;
    const pc = p.width >> 3;
    for (let ty = 0; ty < p.height >> 3; ty++) {
      for (let tx = 0; tx < pc; tx++) {
        const cell = ((p.y >> 3) + ty) * cols + (p.x >> 3) + tx;
        if (p.tileOffset + ty * pc + tx !== cell) return true;
        covered[cell] = 1;
      }
    }
  }
  return covered.includes(0);
}

/** Bounds of the pieces after flips (sprite.c AddSubspritesToOamBuffer: hflip x' = −(x + w), vflip y' = −(y + h)). */
export function composeBounds(pieces: readonly SubspritePiece[], hflip: boolean, vflip: boolean):
  { minX: number; minY: number; width: number; height: number; placed: PlacedPiece[] } {
  if (pieces.length === 0) return { minX: 0, minY: 0, width: 0, height: 0, placed: [] };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const at = pieces.map((p) => {
    const x = hflip ? -(p.x + p.width) : p.x;
    const y = vflip ? -(p.y + p.height) : p.y;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + p.width);
    maxY = Math.max(maxY, y + p.height);
    return { x, y };
  });
  const placed = pieces.map((p, i) => ({ x: at[i].x - minX, y: at[i].y - minY, width: p.width, height: p.height, tileOffset: p.tileOffset }));
  return { minX, minY, width: maxX - minX, height: maxY - minY, placed };
}

/** A composed image: the pieces' bounds after flips (from the sprite centre) and the pieces placed inside it. */
export interface Composition {
  readonly minX: number; readonly minY: number; readonly width: number; readonly height: number;
  readonly placed: readonly PlacedPiece[];
}

/** Per pieces array (GameState keeps one per ROM table: the same array every frame), per base size and flips. */
const compositions = new WeakMap<readonly SubspritePiece[], Map<number, Composition | null>>();

/**
 * The image `applyComposition` gives a sprite of base OAM size `width`×`height` drawing `pieces` with these flips:
 * null when it draws its base image (`needsComposition` false) or the bounds pass 64×64. Cached with the pieces array
 * (by size and flips), so a multi-piece table — sprites in long grass draw 2-piece ones, the truck composes twice per
 * frame — allocates once, not every frame. The result is shared: never modify it.
 */
export function compositionOf(pieces: readonly SubspritePiece[], width: number, height: number, hflip: boolean,
  vflip: boolean): Composition | null {
  let byShape = compositions.get(pieces);
  if (!byShape) compositions.set(pieces, byShape = new Map());
  const key = ((width * 1024 + height) << 2) | (hflip ? 2 : 0) | (vflip ? 1 : 0);
  let c = byShape.get(key);
  if (c === undefined) {
    c = null;
    if (needsComposition(pieces, width, height)) {
      const b = composeBounds(pieces, hflip, vflip);
      if (b.width <= MAX_COMPOSED && b.height <= MAX_COMPOSED) c = b; // (S.S. Tidal, submarine shadow: base OAM, as today)
    }
    byShape.set(key, c);
  }
  return c;
}

/** Composes a non-affine world sprite in place when `needsComposition` and the bounds fit 64×64 (else leaves it as today):
 *  sets `pieces`, `width/height` = bounds, `c2cY = minY`, and moves `worldX/worldY` from the base-OAM placement to
 *  the composed image. Shared by `GameState` (live) and `previewActors.ts` (static preview). (`c2cX = minX` and
 *  `screenX/Y` follow too, so the snapshot describes the composed image throughout; the raw OAM attributes stay.)
 *  The composition comes from `compositionOf` (cached; `pieces` is its shared, read-only list). */
export function applyComposition(s: SpriteSnap, pieces: readonly SubspritePiece[]): void {
  // world sprites drawing their tables only (HUD and battle sprites stay as they are); not an affine one: the GBA
  // transforms each piece about its own centre, a composed image would turn as one
  if (!s.coordOffset || s.subspriteMode === 0 || s.affine) return;
  const b = compositionOf(pieces, s.width, s.height, s.hflip, s.vflip);
  if (!b) return;
  // the GBA draws each piece at the sprite's centre (oam.x − centerToCornerVecX, likewise y) plus its offset:
  // worldX = x + x2 + spriteToMapX + minX + width / 2, worldY = y + spriteToMapY + minY + height (the bottom)
  s.worldX += b.minX + b.width / 2;
  s.worldY += b.minY + b.height - (s.c2cY + s.height);
  s.screenX += b.minX - s.c2cX;
  s.screenY += b.minY - s.c2cY;
  s.c2cX = b.minX;
  s.c2cY = b.minY;
  s.width = b.width;
  s.height = b.height;
  s.pieces = b.placed;
}
