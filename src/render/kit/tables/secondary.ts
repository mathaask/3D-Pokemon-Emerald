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
