// gTileset_GenericBuilding (73 in-scope maps: the houses, the cycling-road gates, the Weather Institute …): what its
// secondary ids (0x200–0x3FF) are, curated from its maps (Phase 4 Task 4a; worklist out/interior-ids.task3.txt,
// sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only GenericBuilding --sheet-scale 5 --sheet-chunk 32).

import type { InteriorId, InteriorTable } from '../building';

export const GENERIC_BUILDING: InteriorTable = {
  name: 'GenericBuilding',
  ids: new Map<number, InteriorId>([]),
  target: 0,
  pins: [],
};
