// Furniture kit I — home (Phase 4 Task 9): beds, tables, chairs, TVs, bookcases, plants, kitchens, crates. Empty until
// Task 9 (a kind without a generator stays legacy).

import type { FurnitureKind } from '../tables/building';
import type { FurnitureGenerator } from './furniture';

export const HOME_GENERATORS: Partial<Record<FurnitureKind, FurnitureGenerator>> = {};
