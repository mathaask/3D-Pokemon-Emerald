// The interior families (Phase 4) in claim-priority order — furniture first (it claims its cells in the wall band before
// the shell takes the band), then the shell, the floor last (it lays the floor under everything) — and the program
// catalogue's interior entries. The furniture family is composed here with its generators (furniture.ts never imports
// the generator modules, which import it: no import cycle).

import type { Family } from '../semantics';
import type { KitMaterialOptions } from '../materials';
import { furnitureFamilyWith } from './furniture';
import { HOME_GENERATORS } from './furnitureHome';
import { SERVICE_GENERATORS } from './furnitureService';
import { shellFamily, SHELL_CATALOGUE } from './shell';
import { floorFamily, FLOOR_CATALOGUE } from './floors';

export const furnitureFamily = furnitureFamilyWith({ ...HOME_GENERATORS, ...SERVICE_GENERATORS });

export const INTERIOR_FAMILIES: readonly Family<unknown>[] = [
  furnitureFamily as Family<unknown>, shellFamily as Family<unknown>, floorFamily as Family<unknown>,
];

/** One program variant an interior family draws: worldCatalogue adds `kit(material, attrs, castShadow)` for it. */
export interface InteriorCatalogueEntry { material: KitMaterialOptions; attrs: Record<string, number>; castShadow: boolean }

/** The interior families' program variants (FURNITURE_CATALOGUE joins at the group-C join, once the generators draw it). */
export const INTERIOR_CATALOGUE: readonly InteriorCatalogueEntry[] = [...SHELL_CATALOGUE, ...FLOOR_CATALOGUE];
