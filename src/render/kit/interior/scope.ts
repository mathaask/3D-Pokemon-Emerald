// Which maps get the interior kit (Phase 4, D1): indoor maps built from gTileset_Building plus one of the five
// in-scope secondaries (138 maps: the houses, Pokémon Centers, Marts, labs, Brendan's and May's houses), less the maps
// named in OUT_OF_SCOPE_MAPS (137 in scope). Gyms, the Battle Frontier, contest halls, museums, the ship, the truck and
// the secret bases keep today's look.

import { SYM } from '../../../game/symbols';
import type { ClassifyOptions } from '../../overworld/analyze';

/** The in-scope secondary tilesets (ROM addresses; = the keys of `INTERIOR_TABLES`). */
export const INTERIOR_TILESETS: ReadonlySet<number> = new Set<number>([
  SYM.gTileset_GenericBuilding, SYM.gTileset_PokemonCenter, SYM.gTileset_Shop, SYM.gTileset_Lab, SYM.gTileset_BrendansMaysHouse,
]);

/** Maps ("group.num") on an in-scope tileset pair that keep today's look all the same: the Lilycove Department Store
 *  rooftop (13.21) is an open-air roof (railings, vending machines, benches, planters under the sky) the room kit
 *  misreads — 58 % legacy, its benches read as chairs, its vending machines as shelves (Phase 4 Task 12). */
export const OUT_OF_SCOPE_MAPS: ReadonlySet<string> = new Set<string>(['13.21']);

/** Indoor, primary `gTileset_Building`, secondary one of `INTERIOR_TILESETS`, and a known map (`mapKey` "group.num")
 *  not one of `OUT_OF_SCOPE_MAPS`. Fails closed: without a map key (null) nothing is in scope, so no caller can let an
 *  excluded map back in by omitting it. */
export function interiorScope(o: Pick<ClassifyOptions, 'indoor' | 'primaryTileset' | 'secondaryTileset'>, mapKey: string | null): boolean {
  return o.indoor && o.primaryTileset === SYM.gTileset_Building && INTERIOR_TILESETS.has(o.secondaryTileset ?? 0)
    && mapKey !== null && !OUT_OF_SCOPE_MAPS.has(mapKey);
}
