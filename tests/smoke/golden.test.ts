// Pins the legacy reconstruction: hashes classify() output for the regression maps so the
// analyze/legacyQuads split (and the claim plumbing) provably changes nothing.
//   UPDATE_GOLDEN=1 npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/golden.test.ts

import { it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadStaticMap } from './helpers/staticMap';
import { REGRESSION_MAPS } from './helpers/maps';
import { classify } from '../../src/render/overworld/classify';

const FILE = path.join(import.meta.dirname, 'golden-classify.json');

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

it('legacy reconstruction is unchanged', () => {
  const got: Record<string, string> = {};
  for (const [name, g, n] of REGRESSION_MAPS) {
    const s = loadStaticMap(g, n);
    const model = classify(s.grid, { ...s.opts, margin: 14 });
    got[name] = fnv(JSON.stringify({ q: model.quads, t: model.trees, d: model.debugMap(), f: model.dominantFloor }));
  }
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(FILE, JSON.stringify(got, null, 2) + '\n');
  expect(got).toEqual(JSON.parse(fs.readFileSync(FILE, 'utf8')));
});
