// GBA key names ("A+UP", "down+b") to key masks, for scripted input (tools, manual stepping).

import { KEY } from '../gba/constants';

const NAMES = new Map<string, number>(Object.entries(KEY));

/** Key names joined by `+`, case-insensitive; `''` is no key. Throws on an unknown name. */
export function keyMask(spec: string): number {
  let mask = 0;
  for (const raw of spec.split('+')) {
    const name = raw.trim().toUpperCase();
    if (!name) continue;
    const bit = NAMES.get(name);
    if (bit === undefined) throw new Error(`unknown GBA key name: ${raw.trim()}`);
    mask |= bit;
  }
  return mask;
}
