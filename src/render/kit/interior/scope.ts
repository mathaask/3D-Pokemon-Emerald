// Which maps get the interior kit (Phase 4, D1): indoor maps built from gTileset_Building plus one of the five
// in-scope secondaries (138 maps: the houses, Pokémon Centers, Marts, labs, Brendan's and May's houses), less the maps
// named in OUT_OF_SCOPE_MAPS (137 in scope). Phase 4b (D1) adds, per map, the 45 maps of PHASE4B_MAPS (the gyms, the
// League and the Hall of Fame, the town specials, the Trick House), each on a tileset whose table lists it, with its
// MapProfile (D8: shell mode, back-band depth, theme, puzzle and tier flags). The 4b scope stays off (PHASE4B_DEFAULT)
// until Task 7 switches it on. The Battle Frontier, contest halls, the ship, the facility rooms, secret bases (Phase 4c),
// the link rooms, the truck and the dungeons keep today's look.

import { SYM } from '../../../game/symbols';
import type { ClassifyOptions } from '../../overworld/analyze';
import type { RGB } from '../palette';
import { INTERIOR_TABLES } from '../tables/building';

/** The in-scope secondary tilesets of Phase 4's rule (ROM addresses; = the keys of `INTERIOR_TABLES` without `maps`). */
export const INTERIOR_TILESETS: ReadonlySet<number> = new Set<number>([
  SYM.gTileset_GenericBuilding, SYM.gTileset_PokemonCenter, SYM.gTileset_Shop, SYM.gTileset_Lab, SYM.gTileset_BrendansMaysHouse,
]);

/** Maps ("group.num") on an in-scope tileset pair that keep today's look all the same: the Lilycove Department Store
 *  rooftop (13.21) is an open-air roof (railings, vending machines, benches, planters under the sky) the room kit
 *  misreads — 58 % legacy, its benches read as chairs, its vending machines as shelves (Phase 4 Task 12). */
export const OUT_OF_SCOPE_MAPS: ReadonlySet<string> = new Set<string>(['13.21']);

/** How a room's walls stand (D7): `band` Phase 4's back band in a recess (`bandMax` rows deep at most), `perimeter` walls
 *  on the boundary between room and void, no recess (wall art inside the room becomes masses). */
export type ShellMode = 'band' | 'perimeter';
/** A League room's theme (its floor, decals and emissive accents). */
export type RoomTheme = 'sidney' | 'phoebe' | 'glacia' | 'drake' | 'champion' | 'hall' | 'hallOfFame';
/** `tiers`: the map has real raised platforms whose heights `prepareInterior` keeps (D13). `puzzle`: a gym or Trick
 *  House room (D6's visibility rule). */
export interface MapProfile { shell: ShellMode; bandMax: number; theme: RoomTheme | null; puzzle: boolean; tiers: boolean }
/** Phase 4's rooms, and every map not in PHASE4B_MAPS. */
export const DEFAULT_PROFILE: MapProfile = Object.freeze({ shell: 'band', bandMax: 3, theme: null, puzzle: false, tiers: false });

/** The emissive accent of flames, candles and glows (light colours, not surface colours, D9): tuned in the looks. */
export const THEME_LIGHT: Readonly<Record<RoomTheme, RGB>> = {
  sidney: [1.0, 0.45, 0.25], phoebe: [0.65, 0.45, 1.0], glacia: [0.55, 0.85, 1.0], drake: [1.0, 0.55, 0.2],
  champion: [1.0, 0.85, 0.5], hall: [1.0, 0.8, 0.55], hallOfFame: [1.0, 0.95, 0.75],
};

const profile = (p: Partial<MapProfile>): MapProfile => Object.freeze({ ...DEFAULT_PROFILE, ...p });
/** D8's perimeter shells: the rooms whose walls are not a band (Dewford 22 % band fit, Sootopolis 32 %, Fortree 50 %,
 *  Mossdeep Game Corner 33 %). */
const PERIMETER = new Set(['3.3', '15.0', '15.1', '12.1', '14.11']);
/** The maps with real raised platforms (D13; Task 5 measures the others and proposes more with evidence). */
const TIERS = new Set(['15.0', '15.1']);
const GYMS = ['3.3', '4.1', '4.2', '8.1', '10.0', '11.3', '12.1', '14.0', '15.0', '15.1'];
const LEAGUE: readonly [string, RoomTheme][] = [
  ['16.0', 'sidney'], ['16.1', 'phoebe'], ['16.2', 'glacia'], ['16.3', 'drake'], ['16.4', 'champion'],
  ['16.5', 'hall'], ['16.6', 'hall'], ['16.7', 'hall'], ['16.8', 'hall'], ['16.9', 'hall'], ['16.11', 'hallOfFame'],
];
const SPECIALS = ['9.6', '9.7', '9.8', '10.1', '10.3', '11.0', '11.2', '11.4', '13.2', '13.3', '14.11', '15.13', '15.14', '17.1',
  '22.0', '28.0'];
const TRICK_HOUSE = ['29.3', '29.4', '29.5', '29.6', '29.7', '29.8', '29.9', '29.10'];
const shellOf = (k: string): Partial<MapProfile> => ({ shell: PERIMETER.has(k) ? 'perimeter' : 'band', tiers: TIERS.has(k) });

/** The 45 maps of D1 ("group.num") with D8's profiles: the 10 gym maps and the 8 Trick House rooms are puzzle maps; the
 *  League rooms, halls and the Hall of Fame carry their theme; the 16 town specials are rooms as in Phase 4. */
export const PHASE4B_MAPS: ReadonlyMap<string, MapProfile> = new Map<string, MapProfile>([
  ...GYMS.map((k): [string, MapProfile] => [k, profile({ ...shellOf(k), puzzle: true })]),
  ...LEAGUE.map(([k, theme]): [string, MapProfile] => [k, profile({ ...shellOf(k), theme })]),
  ...SPECIALS.map((k): [string, MapProfile] => [k, profile(shellOf(k))]),
  ...TRICK_HOUSE.map((k): [string, MapProfile] => [k, profile({ ...shellOf(k), puzzle: true })]),
]);

/** Phase 4b's scope until Task 7 switches it on: off, so nothing renders differently. */
export const PHASE4B_DEFAULT = false;
let phase4b = PHASE4B_DEFAULT;
/** Test seam: the 4b scope on or off (default PHASE4B_DEFAULT). */
export function setPhase4bScope(on: boolean): void {
  phase4b = on;
}

/** The profile of a PHASE4B_MAPS map (whether or not the 4b scope is on: `interiorScope` decides whether the kit runs);
 *  DEFAULT_PROFILE for Phase 4's maps, every other map and null. */
export function mapProfile(mapKey: string | null): MapProfile {
  return (mapKey !== null && PHASE4B_MAPS.get(mapKey)) || DEFAULT_PROFILE;
}

/** A map's League theme (null: none). Here, not in a themes.ts, so group C's Phase A reads it without waiting (F21). */
export function themeOf(mapKey: string | null): RoomTheme | null {
  return mapProfile(mapKey).theme;
}

/** Phase 4's rule — indoor, primary `gTileset_Building`, secondary one of `INTERIOR_TILESETS`, and a known map (`mapKey`
 *  "group.num") not one of `OUT_OF_SCOPE_MAPS` — or, with the 4b scope on, an indoor PHASE4B_MAPS map whose secondary
 *  has a table listing it (`maps`) and whose primary is the table's (default gTileset_Building). Fails closed: without a
 *  map key (null) nothing is in scope, so no caller can let an excluded map back in by omitting it. */
export function interiorScope(o: Pick<ClassifyOptions, 'indoor' | 'primaryTileset' | 'secondaryTileset'>, mapKey: string | null): boolean {
  if (!o.indoor || mapKey === null) return false;
  const secondary = o.secondaryTileset ?? 0;
  if (o.primaryTileset === SYM.gTileset_Building && INTERIOR_TILESETS.has(secondary)) return !OUT_OF_SCOPE_MAPS.has(mapKey);
  if (!phase4b || !PHASE4B_MAPS.has(mapKey)) return false;
  const t = INTERIOR_TABLES.get(secondary);
  return !!t?.maps?.includes(mapKey) && (t.primary ?? SYM.gTileset_Building) === o.primaryTileset;
}
