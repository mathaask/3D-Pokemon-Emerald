// Curated props drawn with the towns' own (secondary) tilesets, keyed by tileset (ROM address):
// ids 512+ mean something else in every secondary tileset. Labelled from the maps that use each
// tileset (npx tsx tools/map-atlas.ts --no-maps --sheet-only <Name> --sheet-scale 5 --sheet-chunk 32).
// Ids not listed fall back to the colour heuristics (or the legacy art).

import { SYM } from '../../../game/symbols';
import type { PropKind } from './general';

export const SECONDARY_PROPS: ReadonlyMap<number, ReadonlyMap<number, PropKind>> = new Map<number, ReadonlyMap<number, PropKind>>([
  // Rustboro City's street lamps (gTileset_Rustboro is also Route 104/116's, Petalburg Woods' and
  // Southern Island's; only Rustboro draws these ids): the post (blocked) and its lantern, drawn
  // over the paving of the walkable cell above it (two paving variants).
  [SYM.gTileset_Rustboro, new Map<number, PropKind>([[0x21a, 'lamp'], [0x212, 'lamp'], [0x213, 'lamp']])],
]);

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * Flower beds drawn in the ground (bottom) layer, by tileset: each tile draws two big flowers of two
 * kinds among leaves (eight variants of each pair of colours). The flowers' blob test rejects them
 * (the two heads touch; pale or shaded petals; a top layer hiding one), and without the 3D flowers
 * the terrain would leave them to the legacy art.
 */
export const SECONDARY_FLOWERS: ReadonlyMap<number, ReadonlySet<number>> = new Map<number, ReadonlySet<number>>([
  // Route 117 and Verdanturf (gTileset_Mauville, also Mauville's, Routes 110/111/118's): pink and
  // white (0x208-0x20f), yellow and light blue (0x210-0x217).
  [SYM.gTileset_Mauville, new Set<number>(range(0x208, 0x217))],
  // Ever Grande: pink and orange (0x288-0x28f), yellow and blue (0x290-0x297), and the same beds with
  // a stone ledge in the top layer over their lower half (0x298-0x29f, 0x2a0-0x2a7).
  [SYM.gTileset_EverGrande, new Set<number>(range(0x288, 0x2a7))],
]);

/**
 * Ground art no family models and the terrain must not paint over, by tileset: landmarks laid in the
 * walkable floor, kept as their legacy pixel art (the terrain leaves them unclaimed).
 */
export const SECONDARY_KEEP_LEGACY: ReadonlyMap<number, ReadonlySet<number>> = new Map<number, ReadonlySet<number>>([
  // Battle Frontier East: the Poké Ball emblem on its stone slab in front of the Battle Tower (3 rows
  // of 5 cells; the outer columns are half slab, half grass). Drawn in the ground layer: the terrain
  // would paint its gems and ball as a mosaic of grass and stone.
  [SYM.gTileset_BattleFrontierOutsideEast, new Set<number>([
    0x2d7, 0x318, 0x319, 0x31a, 0x31b, 0x2df, 0x2f4, 0x2f5, 0x2f6, 0x2ef, 0x31c, 0x31d, 0x31f,
  ])],
  // Battle Frontier West: the Battle Pike's snake head, the walkable cells of its lower jaw (jaw tips,
  // the tongue the player walks in on; its upper head is blocking legacy art already).
  [SYM.gTileset_BattleFrontierOutsideWest, new Set<number>([0x3f0, 0x3f2, 0x3ab, 0x3f9, 0x3fa, 0x3fb])],
  // Route 109's beach towels (gTileset_Slateport; three cells each, two patterns), laid on the sand.
  [SYM.gTileset_Slateport, new Set<number>([0x2e0, 0x2e8, 0x2f0, 0x2e1, 0x2e9, 0x2f1])],
]);

/**
 * Rock (for the cliffs) that the colour heuristics cannot tell from paving, by tileset. For a tileset
 * listed here the table decides: its other ids are never rock, whatever their colour.
 */
export const SECONDARY_ROCK: ReadonlyMap<number, ReadonlySet<number>> = new Map<number, ReadonlySet<number>>([
  // Sootopolis' crater: the white rock top (also the walkways; 0x2d9), its rims and corners, the
  // white slope down to the lake's pink rim (0x2eb, 0x2ed); the grey-cream faces (straight, ends,
  // edges, over water or the pink rim).
  // Not the houses, the white railings and walls (0x200-0x2bf), the Cave of Origin's mouth (0x2f1,
  // 0x2f9), the brown rock standing in the lake (0x2ee, 0x2ef) or the brown tiles among the lake's
  // trees (0x2de, 0x2df).
  [SYM.gTileset_Sootopolis, new Set<number>([
    0x2d0, 0x2d1, 0x2d2, 0x2d9, 0x2db, 0x2dc, 0x2ec, 0x2eb, 0x2ed,
    0x2cd, 0x2ce, 0x2d3, 0x2d4, 0x2d6, 0x2d8, 0x2da, 0x2e0, 0x2e1, 0x2e2,
    0x2f0, 0x2f2, 0x2f3, 0x2f5, 0x2f8, 0x2fa, 0x2fb, 0x2fd,
  ])],
]);

/**
 * The tops of rock masses (rock, and a mass's top whatever the colour of the map's ground), by
 * tileset; their other ids keep the colour heuristics.
 */
export const SECONDARY_ROCK_TOPS: ReadonlyMap<number, ReadonlySet<number>> = new Map<number, ReadonlySet<number>>([
  // Lavaridge's pink mountain (Lavaridge Town, Mt Chimney, Jagged Pass, Route 112): the plain top
  // (0x271, also the mountain maps' walkable ground), its rims and corners. In Lavaridge Town the
  // ground is grass and sand, so the colour of the ground does not tell the top there.
  [SYM.gTileset_Lavaridge, new Set<number>([0x268, 0x269, 0x26a, 0x26c, 0x271, 0x27d, 0x27e, 0x27f])],
]);
