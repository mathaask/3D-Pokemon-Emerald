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
 *  shape than width×height in row-major 1D order) — only those sprites are composed. */
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

/** Composes a world sprite in place when `needsComposition` and the bounds fit 64×64 (else leaves it as today):
 *  sets `pieces`, `width/height` = bounds, `c2cY = minY`, and moves `worldX/worldY` from the base-OAM placement to
 *  the composed image. Shared by `GameState` (live) and `previewActors.ts` (static preview). (`c2cX = minX` and
 *  `screenX/Y` follow too, so the snapshot describes the composed image throughout; the raw OAM attributes stay.) */
export function applyComposition(s: SpriteSnap, pieces: readonly SubspritePiece[]): void {
  // world sprites drawing their tables only (HUD and battle sprites stay as they are)
  if (!s.coordOffset || s.subspriteMode === 0 || !needsComposition(pieces, s.width, s.height)) return;
  const b = composeBounds(pieces, s.hflip, s.vflip);
  if (b.width > MAX_COMPOSED || b.height > MAX_COMPOSED) return; // (S.S. Tidal, submarine shadow: base OAM, as today)
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
