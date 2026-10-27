// gTileset_BrendansMaysHouse (4 in-scope maps: Brendan's and May's houses, 1F and 2F): what its secondary ids
// (0x200–0x3FF) are, curated from its maps (Phase 4 Task 4c; worklist out/interior-ids.task3.txt,
// sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only BrendansMaysHouse --sheet-scale 5 --sheet-chunk 32).

import type { InteriorId, InteriorTable } from '../building';

export const BRENDANS_MAYS_HOUSE: InteriorTable = {
  name: 'BrendansMaysHouse',
  ids: new Map<number, InteriorId>([]),
  target: 0,
  pins: [],
};
