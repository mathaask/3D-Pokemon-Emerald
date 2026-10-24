// The arena palette: every colour a Modern arena is built with, derived from the colours sampled off the GBA's battle
// background (bgSample.ts: backdrop, top band, platform fill, platform rim) by the kit's art direction (kit/palette.ts:
// soften tames neon and lifts crushed darks, lush grades foliage, earthTone turns soil warm brown). All sRGB 0..1.

import { lush, mix, scale, soften, earthTone, type RGB } from '../kit/palette';
import { GroundMat } from '../kit/terrain';
import { defaultArenaColors, type ArenaColors } from './bgSample';
import type { ArenaKind } from './arenaKind';

export interface ArenaPalette {
  groundMat: GroundMat; ground: RGB;           // the field
  pathMat: GroundMat; path: RGB;               // the worn ring around the platforms (outdoor kinds)
  platformMat: GroundMat; platformTop: RGB;    // painted by the ground material on the platform tops
  platformSide: RGB; skirt: RGB;               // platform body; the grass skirt
  leaf: RGB; trunk: RGB; blade: RGB; rock: RGB; water: RGB; wall: RGB; accent: RGB;
}

const TRUNK: RGB = [0.42, 0.3, 0.2], ROCK: RGB = [0.58, 0.56, 0.52], WATER: RGB = [0.32, 0.42, 0.84];
/** The seabed's sand (kit/water.ts SEABED_MATERIAL's colour); a warm desert sand the sand field is pulled to. */
const SEABED: RGB = [0.74, 0.66, 0.47], WARM_SAND: RGB = [0.88, 0.76, 0.52];
/** Under the grass kinds' platform rim: a warm soil brown the rim colour is pulled to. */
const SOIL: RGB = [0.5, 0.36, 0.22];
/** The ground scale of the grass kinds: long grass is the darker field. */
const GRASS_SCALE: Partial<Record<ArenaKind, number>> = { longGrass: 0.78, grass: 0.9, plain: 1.0 };
/** The Stadium backgrounds (gBattleEnvironmentTiles_Stadium): their walls are the dark top band's colour. */
const STADIUM: ReadonlySet<ArenaKind> = new Set(['magma', 'aqua', 'sidney', 'phoebe', 'glacia', 'drake', 'champion']);

const clamp01 = (c: RGB): RGB => [0, 1, 2].map((i) => Math.min(1, Math.max(0, c[i]))) as RGB;
const copy = (c: RGB): RGB => [c[0], c[1], c[2]];

/**
 * The palette of an arena kind from its background colours (null → defaultArenaColors(kind)). Rules (`c` the colours):
 * grass / longGrass / plain: the field Grass from the platform's green (soften(scale(c.platform, 0.78 / 0.9 / 1.0))), a
 * worn earth Path ring (earthTone(c.rim)), lush Grass tops on soil sides, a lush rim-coloured grass skirt; sand: Sand
 * field and tops; water / kyogre: a sandy seabed under the platform's water colour, the rim's foam; pond: a grass shore
 * around the pond (lily pads in the rim's green); cavePond: a dark rock bed; underwater: seabed sand, kelp, rocks;
 * mountain: Gravel field, Rock path and tops; cave / groudon: dark Rock from the backdrop, Rock tops from the platform
 * fill, Groudon's lava the top band; building: Deck floor, Paving tops; gym … champion: Paving floor and tops (the
 * Stadium kinds' walls from the dark top band); rayquaza: pale Paving. Unlisted fields: path = ground, skirt = blade and
 * the kit's defaults (trunk, rock, water), wall = c.backdrop, accent = c.top. Every channel stays in 0..1.
 */
export function arenaPalette(kind: ArenaKind, colors: ArenaColors | null): ArenaPalette {
  const c = colors ?? defaultArenaColors(kind);
  const leaf = lush(scale(c.platform, 0.7)), blade = lush(c.platform);
  let p: ArenaPalette;
  switch (kind) {
    case 'grass': case 'longGrass': case 'plain': {
      const ground = soften(scale(c.platform, GRASS_SCALE[kind]!));
      p = {
        groundMat: GroundMat.Grass, ground, pathMat: GroundMat.Path, path: earthTone(c.rim),
        platformMat: GroundMat.Grass, platformTop: lush(c.platform),
        platformSide: earthTone(mix(c.rim, SOIL, 0.7)), skirt: lush(c.rim),
        leaf, trunk: TRUNK, blade, rock: ROCK, water: WATER, wall: copy(c.backdrop), accent: copy(c.top),
      };
      break;
    }
    case 'sand': {
      const blades = mix(c.platform, [0.5, 0.55, 0.3], 0.5);
      // (the field: the platform's yellow warmed half way to desert sand — as it is, lit by the sky it read lime)
      p = {
        groundMat: GroundMat.Sand, ground: soften(mix(c.platform, WARM_SAND, 0.5)), pathMat: GroundMat.Sand, path: soften(c.rim),
        platformMat: GroundMat.Sand, platformTop: soften(c.rim), platformSide: scale(soften(c.platform), 0.8), skirt: blades,
        leaf: [0.35, 0.62, 0.3], trunk: TRUNK, blade: blades, rock: mix(c.platform, [0.6, 0.58, 0.55], 0.6), water: WATER,
        wall: copy(c.backdrop), accent: copy(c.top),
      };
      break;
    }
    case 'water': case 'kyogre': {
      const ground = mix(c.platform, SEABED, 0.5);
      p = {
        groundMat: GroundMat.Sand, ground, pathMat: GroundMat.Sand, path: ground,
        platformMat: GroundMat.Sand, platformTop: copy(c.rim), platformSide: scale(ground, 0.8), skirt: blade,
        leaf, trunk: TRUNK, blade, rock: ROCK, water: copy(c.platform), wall: copy(c.backdrop), accent: copy(c.top),
      };
      break;
    }
    case 'pond': {
      // (its grass, the lily pads and the shore's blades are the rim's green: the platform fill is the pond's water)
      const pad = lush(c.rim), ground = scale(pad, 0.85);
      p = {
        groundMat: GroundMat.Grass, ground, pathMat: GroundMat.Grass, path: ground,
        platformMat: GroundMat.Grass, platformTop: pad, platformSide: scale(pad, 0.7), skirt: pad,
        leaf: lush(scale(c.rim, 0.6)), trunk: TRUNK, blade: pad, rock: ROCK, water: copy(c.platform),
        wall: copy(c.backdrop), accent: copy(c.top),
      };
      break;
    }
    case 'cavePond': {
      const ground = scale(soften(c.backdrop), 0.5);
      p = {
        groundMat: GroundMat.Rock, ground, pathMat: GroundMat.Rock, path: ground,
        platformMat: GroundMat.Rock, platformTop: copy(c.rim), platformSide: scale(ground, 0.8), skirt: lush(c.rim),
        leaf, trunk: TRUNK, blade: lush(c.rim), rock: ROCK, water: copy(c.platform),
        wall: copy(c.backdrop), accent: copy(c.top),
      };
      break;
    }
    case 'underwater': {
      const kelp = mix(lush(c.rim), [0.35, 0.4, 0.2], 0.5), rock = scale(c.platform, 0.8);
      p = {
        groundMat: GroundMat.Sand, ground: mix(c.platform, SEABED, 0.45), pathMat: GroundMat.Sand, path: mix(c.platform, SEABED, 0.45),
        platformMat: GroundMat.Rock, platformTop: rock, platformSide: rock, skirt: kelp,
        leaf, trunk: TRUNK, blade: kelp, rock, water: copy(c.backdrop), wall: copy(c.backdrop), accent: copy(c.top),
      };
      break;
    }
    case 'mountain': {
      const side = scale(soften(c.platform), 0.8);
      p = {
        groundMat: GroundMat.Gravel, ground: soften(c.platform), pathMat: GroundMat.Rock, path: soften(c.rim),
        platformMat: GroundMat.Rock, platformTop: soften(c.rim), platformSide: side, skirt: blade,
        leaf, trunk: TRUNK, blade, rock: side, water: WATER, wall: copy(c.backdrop), accent: copy(c.top),
      };
      break;
    }
    case 'cave': case 'groudon': {
      const ground = scale(soften(c.backdrop), 0.55), side = scale(soften(c.backdrop), 0.7);
      p = {
        groundMat: GroundMat.Rock, ground, pathMat: GroundMat.Rock, path: ground,
        platformMat: GroundMat.Rock, platformTop: soften(c.platform), platformSide: side, skirt: blade,
        leaf, trunk: TRUNK, blade, rock: side, water: WATER, wall: copy(c.backdrop), accent: copy(c.top),
      };
      break;
    }
    case 'building': {
      const ground = soften(c.platform);
      p = {
        groundMat: GroundMat.Deck, ground, pathMat: GroundMat.Deck, path: ground,
        platformMat: GroundMat.Paving, platformTop: soften(c.rim), platformSide: scale(soften(c.rim), 0.8), skirt: blade,
        leaf, trunk: TRUNK, blade, rock: ROCK, water: WATER, wall: soften(c.backdrop), accent: copy(c.top),
      };
      break;
    }
    case 'rayquaza': {
      const stone = soften(c.platform);
      p = {
        groundMat: GroundMat.Paving, ground: stone, pathMat: GroundMat.Paving, path: stone,
        platformMat: GroundMat.Paving, platformTop: stone, platformSide: scale(stone, 0.8), skirt: blade,
        leaf, trunk: TRUNK, blade, rock: soften(c.rim), water: WATER, wall: copy(c.backdrop), accent: copy(c.top),
      };
      break;
    }
    default: {
      // gym, leader, frontier and the Stadium kinds (magma, aqua, the Elite Four, the Champion)
      // (the floor: the platform colour more than half way to the pale backdrop — tuned from 0.3, which floored the Stadium
      // rooms wall to wall in their vivid platform colours, where the GBA's platforms stand out on a pale room)
      const ground = soften(mix(c.platform, c.backdrop, 0.55));
      p = {
        groundMat: GroundMat.Paving, ground, pathMat: GroundMat.Paving, path: ground,
        platformMat: GroundMat.Paving, platformTop: soften(c.platform), platformSide: scale(soften(c.rim), 0.8), skirt: blade,
        leaf, trunk: TRUNK, blade, rock: ROCK, water: WATER,
        wall: STADIUM.has(kind) ? scale(soften(c.top), 0.6) : soften(c.backdrop), accent: copy(c.top),
      };
    }
  }
  for (const k of Object.keys(p) as (keyof ArenaPalette)[]) {
    const v = p[k];
    if (Array.isArray(v)) (p as unknown as Record<string, RGB>)[k] = clamp01(v);
  }
  return p;
}
