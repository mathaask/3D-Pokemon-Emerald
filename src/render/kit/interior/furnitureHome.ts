// Furniture kit I — home (Phase 4 Task 9): beds, tables, chairs, TVs, bookcases, plants, kitchens, crates, bins and
// vases. The geometry lives in geom/homeFurniture.ts (pure builders on a piece's footprints, colours, facing and seed);
// here each kind's builder is routed into the family's soups by isLow (D7): low pieces into low / glowLow
// (never fade, the TV's screen included), tall ones into tall / glow.

import type { FurnitureKind } from '../tables/building';
import { isLow, type FurnitureGenerator, type FurnitureOut } from './furniture';
import { HOME_BUILDERS, HOME_KINDS, type HomeSoups } from './geom/homeFurniture';

const soupsOf = (kind: FurnitureKind, out: FurnitureOut): HomeSoups =>
  isLow(kind) ? { body: out.low, glow: out.glowLow } : { body: out.tall, glow: out.glow };

export const HOME_GENERATORS: Partial<Record<FurnitureKind, FurnitureGenerator>> = Object.fromEntries(
  HOME_KINDS.map((k): [FurnitureKind, FurnitureGenerator] => [k, (p, out, q) => HOME_BUILDERS[k](p, soupsOf(k, out), q)]),
);
