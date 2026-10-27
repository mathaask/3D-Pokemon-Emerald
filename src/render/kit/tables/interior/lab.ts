// gTileset_Lab (4 in-scope maps: Birch's lab …): what its secondary ids (0x200–0x3FF) are, curated from its maps
// (Phase 4 Task 4c; worklist out/interior-ids.task3.txt,
// sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only Lab --sheet-scale 5 --sheet-chunk 32).

import type { InteriorId, InteriorTable } from '../building';

export const LAB: InteriorTable = {
  name: 'Lab',
  ids: new Map<number, InteriorId>([]),
  target: 0,
  pins: [],
};
