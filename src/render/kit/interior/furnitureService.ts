// Furniture kit II — Pokémon Center, Mart, computers, stairs (Phase 4 Task 10). Empty until Task 10 (a kind without a
// generator stays legacy).

import type { FurnitureKind } from '../tables/building';
import type { FurnitureGenerator } from './furniture';

export const SERVICE_GENERATORS: Partial<Record<FurnitureKind, FurnitureGenerator>> = {};
