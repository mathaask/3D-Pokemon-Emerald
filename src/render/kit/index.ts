// Model families in claim-priority order: objects first, terrain last (it covers the ground
// under every object the earlier families claimed).

import type { Family } from './semantics';

export const FAMILIES: readonly Family<unknown>[] = [];
