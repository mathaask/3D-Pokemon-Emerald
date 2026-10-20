// Curated semantics for gTileset_General metatile ids (the primary tileset of every outdoor
// map). Labelled from: npx tsx tools/map-atlas.ts --no-maps --sheet-only General --sheet-scale 5 --sheet-chunk 32
// and checked against the maps that use each id. Only ids whose meaning is certain are listed:
// an id left out falls back to the families' colour heuristics. The General tileset holds no lamp
// posts, mailboxes, bushes or bollards (towns draw those with their own secondary tilesets); the
// houses' "mailboxes" are the metal sign 0x003 beside their doors (props.ts tells them apart).

import { setRockIds } from '../cliffs';
import { setPineIds } from '../trees';
import { setFlowerIds } from '../flowers';

export type PropKind = 'sign' | 'mailbox' | 'fenceWhite' | 'fenceWood' | 'fenceMetal' | 'lamp' | 'rock' | 'bush' | 'bollard';

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/** Grey post-and-rail fence pieces (posts with white caps): 0x149 the straight run. */
const FENCE_METAL = [0x132, 0x133, 0x134, 0x138, 0x139, 0x13a, 0x140, 0x141, 0x142, 0x148, 0x149, 0x14a];
/** White rail (a white bar with a grey shadow) along shores and terraces, on grass or paving. */
const FENCE_WHITE = [0x03d, 0x03e, 0x03f, 0x045, 0x047, 0x04d, 0x04e, 0x04f, 0x055, 0x056, 0x057, 0x05d, 0x05f, 0x065, 0x066, 0x067];
/** Brown boulders, one cell: on grass, on mountain rock, on sand. */
const BOULDERS = [0x0e0, 0x0e1, 0x0e2];

/**
 * 2x2 cone-shaped brown rocks standing on the ground: [top-left, top-right, bottom-left,
 * bottom-right]. One boulder where all four stand together (the bottom corners are also drawn at
 * the foot of bigger rock masses). 0x083/0x084 are tree ids for the analysis (NARROW_TREE).
 */
export const GENERAL_BIG_ROCKS: readonly (readonly [number, number, number, number])[] = [
  [0x083, 0x084, 0x08b, 0x08c], // on grass (Route 111)
  [0x0a3, 0x0a4, 0x0ab, 0x0ac], // on sand (Route 111)
  [0x093, 0x094, 0x09b, 0x09c], // on mountain rock (Mossdeep, Route 105)
];

export const GENERAL_PROPS: ReadonlyMap<number, PropKind> = new Map<number, PropKind>([
  [0x003, 'sign'], // grey metal sign (town and route signs; beside a house door: its mailbox)
  [0x01b, 'sign'], // wooden sign on one post (trainer tips)
  ...FENCE_METAL.map((m) => [m, 'fenceMetal'] as [number, PropKind]),
  ...FENCE_WHITE.map((m) => [m, 'fenceWhite'] as [number, PropKind]),
  ...[...BOULDERS, ...GENERAL_BIG_ROCKS.flat()].map((m) => [m, 'rock'] as [number, PropKind]),
]);

/**
 * How a fence piece is drawn in its cell: `arms` are the sides (N, E, S, W) its rails run out to,
 * `fx` the X of its N-S line and `fz` the Z of its E-W line within the cell (0..1, where the posts'
 * feet are drawn).
 */
export interface FenceShape { arms: string; fx: number; fz: number }

const shape = (arms: string, fx: number, fz: number): FenceShape => ({ arms, fx, fz });
const GREY_FZ = 0.85, WHITE_TOP = 0.45, WHITE_BOTTOM = 0.95, LEFT = 0.25, RIGHT = 0.75, W_LEFT = 0.2, W_RIGHT = 0.8;

export const GENERAL_FENCE_SHAPES: ReadonlyMap<number, FenceShape> = new Map<number, FenceShape>([
  // grey fence: straight runs, ends and corners; N-S runs are drawn on the left or right of the cell
  [0x149, shape('EW', 0.5, GREY_FZ)],
  [0x134, shape('EW', 0.5, GREY_FZ)], // (over a bank's edge)
  [0x140, shape('NS', LEFT, GREY_FZ)],
  [0x142, shape('NS', RIGHT, GREY_FZ)],
  [0x139, shape('S', LEFT, GREY_FZ)], // top end
  [0x141, shape('S', RIGHT, GREY_FZ)],
  [0x132, shape('NW', LEFT, GREY_FZ)], // foot of a left N-S run (the E-W run ends at it)
  [0x133, shape('N', RIGHT, GREY_FZ)], // foot of a right N-S run
  [0x138, shape('ES', LEFT, GREY_FZ)],
  [0x13a, shape('SW', RIGHT, GREY_FZ)],
  [0x148, shape('NE', LEFT, GREY_FZ)],
  [0x14a, shape('NW', RIGHT, GREY_FZ)],
  // white rail: along the top or bottom edge, or the left or right edge, and the corners
  ...[0x03e, 0x056].map((m) => [m, shape('EW', 0.5, WHITE_TOP)] as [number, FenceShape]),
  ...[0x04e, 0x066].map((m) => [m, shape('EW', 0.5, WHITE_BOTTOM)] as [number, FenceShape]),
  ...[0x045, 0x05d].map((m) => [m, shape('NS', W_LEFT, WHITE_TOP)] as [number, FenceShape]),
  ...[0x047, 0x05f].map((m) => [m, shape('NS', W_RIGHT, WHITE_TOP)] as [number, FenceShape]),
  ...[0x03d, 0x055].map((m) => [m, shape('ES', W_LEFT, WHITE_TOP)] as [number, FenceShape]),
  ...[0x03f, 0x057].map((m) => [m, shape('SW', W_RIGHT, WHITE_TOP)] as [number, FenceShape]),
  ...[0x04d, 0x065].map((m) => [m, shape('NE', W_LEFT, WHITE_BOTTOM)] as [number, FenceShape]),
  ...[0x04f, 0x067].map((m) => [m, shape('NW', W_RIGHT, WHITE_BOTTOM)] as [number, FenceShape]),
]);

/**
 * Brown mountain rock on land: faces, tops, edges and corners of rock masses on grass, sand and
 * rock, the cone rocks and boulders. Not the rock standing in the sea (0x172-0x17f, 0x182, 0x184:
 * sea cliffs and 2x2 cone rocks): the cliffs would make square blocks of them, topped in the
 * water's colours, so they keep their legacy art.
 */
export const GENERAL_ROCK: ReadonlySet<number> = new Set<number>([
  ...range(0x068, 0x06d), ...range(0x070, 0x075), ...range(0x078, 0x07d),
  0x080, 0x081, 0x082, 0x088, 0x089, 0x08a, 0x090, 0x091, 0x092,
  0x0a0, 0x0a2, 0x0a8, 0x0a9, 0x0aa,
  ...range(0x0b4, 0x0b7), 0x0be, 0x0bf, 0x0d7, 0x0db, 0x0dc, 0x0df, 0x0e7, 0x0ee, 0x0ef,
  ...GENERAL_BIG_ROCKS.flat(), ...BOULDERS,
]);

/** The secret-base tree: a 2x2 conical tree (blocked bottom row, also its "open" variant; the
 *  walkable top row is its crown's overhang), the tileset's only conifer. Its bottom row is a
 *  secret-base spot, which no family models (semantics.ts isSecretBaseSpot): it keeps its legacy
 *  art, so the trees never meet these ids today. */
export const GENERAL_PINE: ReadonlySet<number> = new Set<number>([0x01e, 0x01f, 0x026, 0x027, 0x036, 0x037]);

export const GENERAL_FLOWERS: ReadonlySet<number> = new Set<number>([0x004]);

/** Hooks the tables into the families (ids are only consulted when the primary tileset is General). */
export function installGeneralTables(): void {
  setRockIds((m) => GENERAL_ROCK.has(m));
  setPineIds((m) => GENERAL_PINE.has(m));
  setFlowerIds((m) => GENERAL_FLOWERS.has(m));
}
