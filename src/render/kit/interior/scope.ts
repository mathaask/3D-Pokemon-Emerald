// Which maps get the interior kit (Phase 4, D1): indoor maps built from gTileset_Building plus one of the five
// in-scope secondaries (138 maps: the houses, Pokémon Centers, Marts, labs, Brendan's and May's houses). Gyms, the
// Battle Frontier, contest halls, museums, the ship, the truck and the secret bases keep today's look.

import { SYM } from '../../../game/symbols';
import type { ClassifyOptions } from '../../overworld/analyze';

/** The in-scope secondary tilesets (ROM addresses; = the keys of `INTERIOR_TABLES`). */
export const INTERIOR_TILESETS: ReadonlySet<number> = new Set<number>([
  SYM.gTileset_GenericBuilding, SYM.gTileset_PokemonCenter, SYM.gTileset_Shop, SYM.gTileset_Lab, SYM.gTileset_BrendansMaysHouse,
]);

/** Indoor, primary `gTileset_Building`, secondary one of `INTERIOR_TILESETS`. */
export function interiorScope(o: Pick<ClassifyOptions, 'indoor' | 'primaryTileset' | 'secondaryTileset'>): boolean {
  return o.indoor && o.primaryTileset === SYM.gTileset_Building && INTERIOR_TILESETS.has(o.secondaryTileset ?? 0);
}
