# Phase 1 — Foundation + Outdoor Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pixel-textured boxes/cards of outdoor maps with real stylized 3D models (terrain, cliffs, water, trees, grass, flowers, buildings, props) placed by a semantic layer, while every unrecognised cell keeps rendering exactly as today.

**Architecture:** `classify.ts` is split into a pure analysis (`analyze.ts`) and the old quad emitter (`legacyQuads.ts`, which now skips *claimed* cells). A new `src/render/kit/` runs model *families* in priority order; each family `extract`s placements from the analysis (claiming grid cells) and `build`s Three.js meshes. Families that throw are rolled back so legacy renders their cells.

**Tech Stack:** TypeScript (strict), Three.js 0.186 (WebGL2, `MeshStandardMaterial` + `onBeforeCompile` shader injection, `InstancedMesh`), Vite, Vitest, puppeteer-core (headless Chrome screenshots).

**Spec:** `docs/superpowers/specs/2026-10-19-modern-3d-models-design.md`

## Global Constraints

- No Nintendo assets in the repo and no downloaded third-party assets; all geometry/textures are procedural or decoded at runtime from the user's ROM.
- World mapping is fixed: grid cell (x, y) at height h → world (X = x, Y = h, Z = y + h).
- Per-cell legacy fallback: any cell not claimed by a family renders exactly as before; `World style: Retro 3D` renders everything with legacy.
- Phase 1 kit runs on outdoor maps only (`!indoor && !underground`); indoor/underground maps are unchanged.
- Budgets (medium quality, 1280×800 preview): ≤ 150 draw calls, ≤ 1.5 M triangles per map view; world rebuild ≤ 150 ms.
- Grass blades per cell: low 8 / medium 24 / high 48. Shadow map: low 1024 / medium 2048 / high 4096.
- A family that throws: its claims are rolled back and a single `console.warn('[kit] …')` is logged for that map build. If the whole kit throws, the map builds in Retro.
- Legacy coverage target after Phase 1: ≤ 15 % of non-void cells (averaged over the outdoor regression maps).
- `npx tsc --noEmit` and `npm test` must pass at the end of every task.
- Keep `docs/superpowers/progress/modern-3d.md` updated after every task (status line + anything learned).

## Review Focus

1. **Crossing a map connection in live play** (backup grid shifts; warps are map-local, need +7 `MAP_OFFSET`; buildings in the neighbour strip have no warp) → correct building kinds in the current map, `house`/`special` defaults in the strip, no crash. Pinned by `tests/kitEvents.test.ts` (Task 3).
2. **In-game map edits** (Cut/Rock Smash change metatiles → rebuild) → the old kit objects are fully removed, nothing duplicated or leaked. Pinned by `tests/kitRun.test.ts` "dispose removes all kit objects" (Task 5).
3. **Indoor and cave maps in Modern style** → identical to Retro in Phase 1 (no outdoor trees/houses inside rooms). Pinned by the `house` and `granite` assertions in `tests/smoke/semantics.test.ts` (Task 14) and the golden test (Task 2).
4. **Non-General primary tilesets outdoors** (e.g. Battle Frontier uses other primaries) → id tables disabled, colour heuristics only, no mis-tagging. Pinned by `tests/kitTables.test.ts` "tables ignored when generalPrimary is false" (Task 13).
5. **Night, weather and Flash lighting on kit materials** → kit meshes are lit like legacy, windows glow after dark, nothing renders unlit/black. Pinned by the hour-21 pass and the `granite` (flash) entry of the regression harness (Task 1), reviewed in Tasks 6–15.

---

## File Structure

Created:
- `tools/regress.ts` — regression screenshots (fixed map set × hours) + contact sheets + render stats.
- `tests/smoke/helpers/staticMap.ts` — builds analysis inputs for any map from the ROM in Node.
- `tests/smoke/golden.test.ts`, `tests/smoke/golden-classify.json` — pins legacy output.
- `src/render/overworld/analyze.ts` — cell kinds, heights, buildings, ground refs (pure; from classify.ts).
- `src/render/overworld/legacyQuads.ts` — legacy quad/tree-card emission honouring claims.
- `src/render/overworld/claims.ts` — `Claims` (per-cell bits + ground overrides).
- `src/render/kit/events.ts` — map events → grid-space warps/signs.
- `src/render/kit/geom.ts` — RNG, hashing, value noise (JS), quad helper, coloured geometry merger.
- `src/render/kit/palette.ts` — colour sampling, softening, ground colour classes.
- `src/render/kit/noise.glsl.ts` — shared GLSL noise / voronoi / bayer.
- `src/render/kit/materials.ts` — `KitUniforms`, `kitMaterial()` (wind, bend, fade, glow, patterns).
- `src/render/kit/semantics.ts` — `Family`, `SemanticContext`, `extractAll`, `buildAll`, `runKit`.
- `src/render/kit/index.ts` — ordered family list.
- `src/render/kit/terrain.ts`, `water.ts`, `cliffs.ts`, `trees.ts`, `grass.ts`, `flowers.ts`, `buildings.ts`, `props.ts`, `upscale.ts` (Scale2x/EPX — the spec's "xBR-family" upscaler, simplest member; can be upgraded in Phase 2), `text.ts`.
- `src/render/kit/tables/general.ts` — curated `gTileset_General` ids.
- Tests: `tests/helpers/fakeMap.ts`, `tests/kitEvents.test.ts`, `tests/kitPalette.test.ts`, `tests/kitGeom.test.ts`, `tests/kitMaterials.test.ts`, `tests/kitRun.test.ts`, `tests/kitTerrain.test.ts`, `tests/kitWater.test.ts`, `tests/kitCliffs.test.ts`, `tests/kitTrees.test.ts`, `tests/kitFlora.test.ts`, `tests/kitBuildings.test.ts`, `tests/kitUpscale.test.ts`, `tests/kitTables.test.ts`, `tests/smoke/helpers/maps.ts`, `tests/smoke/semantics.test.ts`.
- Known Phase 1 simplifications (recorded in the progress log at the end): waterfalls are flat animated streaks rather than vertical sheets; currents don't steer the water normals; stairs are per-cell flat steps joined by banks.

Modified:
- `src/render/overworld/classify.ts` — becomes a thin wrapper (types + `classify()`).
- `src/render/overworld/world.ts` — builds kit + legacy; disposal; style.
- `src/render/overworld/overworldView.ts` — style, quality, events, kit uniforms, focus/actors, grass-sprite hiding.
- `src/render/preview.ts`, `src/main.ts`, `src/render/renderer.ts`, `src/ui/settings.ts`, `src/render/post.ts`.
- `package.json` (scripts), `README.md`, `CLAUDE.md`, progress log.

---
### Task 1: Regression screenshot harness

Renders a fixed set of maps through the static preview (`/?map=G.N`) at day and night, writes one PNG per view, a 4-column contact sheet per hour (review one image instead of sixteen), and render stats (draw calls, triangles, world build time).

**Files:**
- Create: `tools/regress.ts`
- Modify: `src/render/preview.ts` (stats), `package.json` (script)

**Interfaces:**
- Produces: `npx tsx tools/regress.ts --label <name> [--style modern|retro] [--only a,b] [--hours 11,21] [--wait ms]` → `out/regress/<label>/<map>_h<hour>.png`, `out/regress/<label>/_sheet_h<hour>.png`, `out/regress/<label>/stats.json`.
- Produces: `PreviewApp.stats(): { calls: number; triangles: number; buildMs: number }` (read via `window.preview.stats()`; `window.preview` is already set in `src/main.ts`).

- [ ] **Step 1: Add render stats to the preview**

In `src/render/preview.ts`:
- add a field `private buildMs = 0;`
- wrap the existing `this.view.buildWorld(grid, bus, palette.subarray(0, 256), map.layout.primaryTileset);` call:

```ts
    const t0 = performance.now();
    this.view.buildWorld(grid, bus, palette.subarray(0, 256), map.layout.primaryTileset);
    this.buildMs = performance.now() - t0;
```

- after `this.webgl.outputColorSpace = THREE.SRGBColorSpace;` add `this.webgl.info.autoReset = false;`
- at the start of `frame()` add `this.webgl.info.reset();`
- add the method:

```ts
  /** Render statistics of the last frame (all passes) and the last world build time. */
  stats(): { calls: number; triangles: number; buildMs: number } {
    const r = this.webgl.info.render;
    return { calls: r.calls, triangles: r.triangles, buildMs: Math.round(this.buildMs) };
  }
```

- [ ] **Step 2: Write `tools/regress.ts`**

```ts
// Visual regression: renders a fixed set of maps through the static preview at day and night,
// writes one PNG per view, a contact sheet per hour, and render stats.
//
//   npx tsx tools/regress.ts --label before [--style retro] [--only littleroot,oldale] [--hours 11,21]
//
// Output: out/regress/<label>/<name>_h<hour>.png, _sheet_h<hour>.png, stats.json

import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import puppeteer, { type Page } from 'puppeteer-core';

const MAPS: { name: string; map: string; extra?: string }[] = [
  { name: 'littleroot', map: '0.9' },
  { name: 'oldale', map: '0.10' },
  { name: 'petalburg', map: '0.0' },
  { name: 'rustboro', map: '0.3' },
  { name: 'woods', map: '24.11' },
  { name: 'slateport', map: '0.1' },
  { name: 'mauville', map: '0.2' },
  { name: 'route113', map: '0.28' },
  { name: 'fortree', map: '0.4' },
  { name: 'lilycove', map: '0.5' },
  { name: 'route119', map: '0.34' },
  { name: 'sootopolis', map: '0.7' },
  { name: 'mossdeep', map: '0.6' },
  { name: 'route110', map: '0.25' },
  { name: 'house', map: '1.0' },
  { name: 'granite', map: '24.7', extra: 'flash=2' },
];

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

/** Composes thumbnails into one image (4 per row) so a whole run can be reviewed at once. */
async function contactSheet(page: Page, dir: string, names: string[], out: string): Promise<void> {
  const cells = names.map((n) => {
    const b64 = fs.readFileSync(path.join(dir, `${n}.png`)).toString('base64');
    return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${n}</figcaption></figure>`;
  }).join('');
  await page.setViewport({ width: 1600, height: 800 });
  await page.setContent(`<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(4,400px)}
    figure{margin:0;position:relative}img{width:400px;height:250px;display:block}
    figcaption{position:absolute;left:4px;top:2px;color:#ff0;font:bold 14px sans-serif;text-shadow:0 0 3px #000}</style>${cells}`);
  await page.screenshot({ path: out as `${string}.png`, fullPage: true });
  await page.setViewport({ width: 1280, height: 800 });
  console.log(`sheet ${out}`);
}

async function main(): Promise<void> {
  const root = path.resolve(import.meta.dirname, '..');
  const label = arg('label', 'current');
  const style = arg('style', '');
  const hours = arg('hours', '11,21').split(',').map(Number);
  const only = arg('only', '');
  const wait = parseInt(arg('wait', '3500'), 10);
  const maps = MAPS.filter((m) => !only || only.split(',').includes(m.name));
  const outDir = path.join(root, 'out/regress', label);
  fs.mkdirSync(outDir, { recursive: true });

  const server = await createServer({ root, server: { port: 5198, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const port = (server.httpServer!.address() as { port: number }).port;
  const browser = await puppeteer.launch({
    executablePath: CHROME.find((p) => fs.existsSync(p))!,
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11'],
    defaultViewport: { width: 1280, height: 800 },
  });
  const stats: Record<string, unknown> = {};
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.log(`[page error] ${(e as Error).message}`));
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warn') console.log(`[page ${m.type()}] ${m.text()}`);
    });
    for (const hour of hours) {
      for (const m of maps) {
        const q = `autostart=1&map=${m.map}&hour=${hour}${style ? `&style=${style}` : ''}${m.extra ? `&${m.extra}` : ''}`;
        await page.goto(`http://localhost:${port}/?${q}`, { waitUntil: 'load' });
        await new Promise((r) => setTimeout(r, wait));
        const key = `${m.name}_h${hour}`;
        await page.screenshot({ path: path.join(outDir, `${key}.png`) as `${string}.png` });
        stats[key] = await page.evaluate(() =>
          (window as unknown as { preview?: { stats(): unknown } }).preview?.stats() ?? null);
        console.log(`shot ${key} ${JSON.stringify(stats[key])}`);
      }
      await contactSheet(page, outDir, maps.map((m) => `${m.name}_h${hour}`), path.join(outDir, `_sheet_h${hour}.png`));
    }
    fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(stats, null, 2));
  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Add the npm script**

In `package.json` `scripts` add: `"regress": "tsx tools/regress.ts"`.

- [ ] **Step 4: Capture the baseline**

Run: `npx tsx tools/regress.ts --label before`
Expected: 32 `shot …` lines with non-null stats, two `sheet …` lines, no `[page error]` other than a favicon 404. View `out/regress/before/_sheet_h11.png` and `_sheet_h21.png` and confirm all 16 maps rendered (no blank frames). Record the max `calls` / `triangles` / `buildMs` from `stats.json` in the progress log as the baseline.

- [ ] **Step 5: Typecheck, test, commit**

Run: `npx tsc --noEmit && npm test` → no errors; all tests pass.

```bash
git add tools/regress.ts src/render/preview.ts package.json docs/superpowers/progress/modern-3d.md
git commit -m "tools: visual regression harness with contact sheets and render stats"
```

---

### Task 2: Golden test, then split `classify.ts` into `analyze.ts` + `legacyQuads.ts` (+ claims)

Pure refactor. A golden test hashes `classify()` output for the 16 regression maps **before** the split; it must still pass after. The split also introduces `Claims`, which `legacyQuads` honours (no caller passes claims yet, so output is identical).

**Files:**
- Create: `tests/smoke/helpers/staticMap.ts`, `tests/smoke/golden.test.ts`, `tests/smoke/golden-classify.json` (generated)
- Create: `src/render/overworld/claims.ts`, `src/render/overworld/analyze.ts`, `src/render/overworld/legacyQuads.ts`
- Modify: `src/render/overworld/classify.ts` (becomes a wrapper)

**Interfaces:**
- Produces (`claims.ts`): `CLAIM_SURFACE = 1`, `CLAIM_OBJECT = 2`, `CLAIM_TOP = 4`, `class Claims { bits: Uint8Array; groundY: Float32Array; groundMt: Int16Array; constructor(n); has(i, bit): boolean; claim(i, bit): void; snapshot(): ClaimsSnapshot; restore(s): void }`.
- Produces (`analyze.ts`): `export const enum K { Void, Floor, Water, Ledge, Block, Tree, Building, Stairs }`, `ClassifyOptions`, `BuildingRegion`, `MapAnalysis`, `CellQueries`, `analyze(grid, opts): MapAnalysis`, `queries(a): CellQueries`, `isWaterBehavior(b)`, `WATER_BEHAVIORS`, `DOOR_BEHAVIORS`, `NARROW_TREE`, `ROUND_TREE`, `RIM`, `STAIRS`, `ROOF_SLOPE`, `WATER_DROP`.
- Produces (`legacyQuads.ts`): `Vec3`, `Quad`, `TreeQuad`, `emitLegacy(a: MapAnalysis, claims?: Claims | null): { quads: Quad[]; trees: TreeQuad[] }`.
- Produces (`classify.ts`): unchanged public API `classify(grid, opts): CellModel` and re-exports `Vec3, Quad, TreeQuad, ClassifyOptions, isWaterBehavior`.

- [ ] **Step 1: Write the static-map helper**

`tests/smoke/helpers/staticMap.ts`:

```ts
// Builds classifier inputs for any map straight from the ROM (no emulator, no GPU), the same
// way the browser preview does: tiles into a scratch VRAM, palettes 0-12, metatile analysis.

import fs from 'node:fs';
import path from 'node:path';
import { Bus } from '../../../src/gba/bus';
import { Mem } from '../../../src/game/mem';
import { RomReader } from '../../../src/game/rom/reader';
import { loadMap, type MapInfo } from '../../../src/game/rom/maps';
import { loadTileset } from '../../../src/game/rom/tileset';
import { SYM } from '../../../src/game/symbols';
import { MetatileAtlas } from '../../../src/render/overworld/metatileAtlas';
import { analyzeMetatiles, type TileInfo } from '../../../src/render/overworld/tileInfo';
import type { GridData } from '../../../src/render/overworld/world';
import type { ClassifyOptions } from '../../../src/render/overworld/classify';

const root = path.resolve(import.meta.dirname, '../../..');
let romBytes: Uint8Array | null = null;

export function loadRom(): Uint8Array {
  if (!romBytes) {
    const f = fs.readdirSync(root).find((n) => n.toLowerCase().endsWith('.gba'));
    if (!f) throw new Error('No .gba ROM in the project root');
    romBytes = new Uint8Array(fs.readFileSync(path.join(root, f)));
  }
  return romBytes;
}

export interface StaticMap {
  map: MapInfo;
  rom: RomReader;
  grid: GridData;
  info: TileInfo;
  opts: Omit<ClassifyOptions, 'margin'>;
}

export function loadStaticMap(group: number, num: number): StaticMap {
  const bytes = loadRom();
  const rom = new RomReader(bytes);
  const map = loadMap(rom, group, num);
  const primary = loadTileset(rom, map.layout.primaryTileset);
  const secondary = loadTileset(rom, map.layout.secondaryTileset);
  const bus = new Bus(bytes);
  bus.vram.set(primary.tiles.subarray(0, 0x4000), 0);
  bus.vram.set(secondary.tiles.subarray(0, 0x4000), 0x4000);
  const palette = new Uint16Array(256);
  palette.set(primary.palettes.subarray(0, 6 * 16), 0);
  palette.set(secondary.palettes.subarray(6 * 16, 13 * 16), 6 * 16);
  palette[0] = 0;
  const atlas = new MetatileAtlas({ vram: null, palette: null } as never, 1);
  atlas.setTilesets(new Mem(bus), map.layout.primaryTileset, map.layout.secondaryTileset);
  const info = analyzeMetatiles(bus, atlas.entries, atlas.attributes, 0, palette);
  return {
    map,
    rom,
    info,
    grid: {
      width: map.layout.width, height: map.layout.height, cells: map.layout.grid,
      border: [...map.layout.border], borderW: 2, borderH: 2, borderPhase: 0,
    },
    opts: {
      info,
      generalPrimary: map.layout.primaryTileset === SYM.gTileset_General,
      indoor: map.mapType === 8 || map.mapType === 9,
      underground: map.mapType === 4,
    },
  };
}
```

- [ ] **Step 2: Write the golden test**

`tests/smoke/golden.test.ts`:

```ts
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
```

and `tests/smoke/helpers/maps.ts` (shared with Task 14):

```ts
/** The regression map set: [name, group, num] (same names as tools/regress.ts). */
export const REGRESSION_MAPS: [string, number, number][] = [
  ['littleroot', 0, 9], ['oldale', 0, 10], ['petalburg', 0, 0], ['rustboro', 0, 3], ['woods', 24, 11],
  ['slateport', 0, 1], ['mauville', 0, 2], ['route113', 0, 28], ['fortree', 0, 4], ['lilycove', 0, 5],
  ['route119', 0, 34], ['sootopolis', 0, 7], ['mossdeep', 0, 6], ['route110', 0, 25], ['house', 1, 0],
  ['granite', 24, 7],
];
```

- [ ] **Step 3: Generate the golden file from the unmodified code**

Run: `UPDATE_GOLDEN=1 npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/golden.test.ts`
Expected: PASS; `tests/smoke/golden-classify.json` has 16 entries. Run again without `UPDATE_GOLDEN` → PASS (determinism check).

- [ ] **Step 4: Commit the golden pin before refactoring**

```bash
git add tests/smoke/helpers tests/smoke/golden.test.ts tests/smoke/golden-classify.json
git commit -m "test: golden hash of legacy classify output for the regression maps"
```

- [ ] **Step 5: Create `src/render/overworld/claims.ts`**

```ts
// Which parts of each grid cell are rendered by kit models (and so skipped by the legacy
// quad emitter), plus per-cell ground overrides for cells whose object a family replaced.

export const CLAIM_SURFACE = 1; // the cell's walkable / ground / water surface
export const CLAIM_OBJECT = 2; // the structure standing on the cell (tree, building, block run)
export const CLAIM_TOP = 4; // the cell's top-layer overhang card (crowns / eaves north of objects)

export interface ClaimsSnapshot {
  bits: Uint8Array;
  groundY: Float32Array;
  groundMt: Int16Array;
}

export class Claims {
  readonly bits: Uint8Array;
  /** Ground height under a claimed object (NaN = analysis groundH). */
  readonly groundY: Float32Array;
  /** Metatile whose look the ground under a claimed object takes (-1 = analysis groundOf). */
  readonly groundMt: Int16Array;

  constructor(n: number) {
    this.bits = new Uint8Array(n);
    this.groundY = new Float32Array(n).fill(NaN);
    this.groundMt = new Int16Array(n).fill(-1);
  }

  has(i: number, bit: number): boolean {
    return (this.bits[i] & bit) !== 0;
  }

  claim(i: number, bit: number): void {
    this.bits[i] |= bit;
  }

  snapshot(): ClaimsSnapshot {
    return { bits: this.bits.slice(), groundY: this.groundY.slice(), groundMt: this.groundMt.slice() };
  }

  restore(s: ClaimsSnapshot): void {
    this.bits.set(s.bits);
    this.groundY.set(s.groundY);
    this.groundMt.set(s.groundMt);
  }
}
```

- [ ] **Step 6: Create `src/render/overworld/analyze.ts` by moving code out of `classify.ts`**

Source is `classify.ts` at commit `667c190` (line numbers below refer to it). Move code, don't rewrite it:
1. Header comment: classify.ts lines 1–8. Imports: `MB` from `../../game/behaviors`, `type TileInfo` from `./tileInfo`, `type GridData` from `./world`.
2. Move `ClassifyOptions` (lines 53–60, exported), the id tables and behaviour sets (lines 62–80, add `export` to `NARROW_TREE`, `ROUND_TREE`, `RIM`, `STAIRS`, `WATER_BEHAVIORS`, `DOOR_BEHAVIORS`), `isWaterBehavior` (82–84), the enum (86, now `export const enum K …`) and `ROOF_SLOPE` / `WATER_DROP` (88–89, now exported).
3. Add the interfaces:

```ts
export interface BuildingRegion { cells: number[]; doorRow: number }

export interface MapAnalysis {
  opts: ClassifyOptions;
  info: TileInfo;
  minX: number; minY: number; maxX: number; maxY: number;
  GW: number; GH: number; N: number;
  idx(x: number, y: number): number;
  inside(x: number, y: number): boolean;
  cellX(i: number): number;
  cellY(i: number): number;
  mt: Int16Array; col: Uint8Array; elev: Uint8Array; beh: Uint8Array; layer: Uint8Array;
  kind: Uint8Array;
  roundTree: Uint8Array;
  building: Int16Array;
  buildings: BuildingRegion[];
  height: Float32Array;
  waterLevel: Float32Array;
  groundOf: Int16Array;
  groundH: Float32Array;
  groundRefs: Int16Array;
  /** NORMAL/SPLIT metatile with top-layer pixels (an overhang drawn over objects). */
  hasTop(i: number): boolean;
  isGeneralId(m: number): boolean;
}

export interface CellQueries {
  groundRefs: Int16Array;
  dominantFloor: number;
  heightAt(x: number, y: number): number;
  waterLevelAt(x: number, y: number): number;
  isWater(x: number, y: number): boolean;
  debugMap(): string;
  minX: number; minY: number; maxX: number; maxY: number;
}
```

4. `export function analyze(grid: GridData, opts: ClassifyOptions): MapAnalysis {` with the body = classify.ts lines 92–457 verbatim (setup, raw cells, kinds, buildings, height solver, per-cell heights, water levels, ground references), followed by:

```ts
  const hasTop = (i: number) => layer[i] !== 1 && info.topCover[mt[i]] > 0;
  return {
    opts, info, minX, minY, maxX, maxY, GW, GH, N, idx, inside,
    cellX: (i) => (i % GW) + minX,
    cellY: (i) => ((i / GW) | 0) + minY,
    mt, col, elev, beh, layer, kind, roundTree, building, buildings,
    height, waterLevel, groundOf, groundH, groundRefs, hasTop, isGeneralId,
  };
}
```

5. `export function queries(a: MapAnalysis): CellQueries` = classify.ts lines 755–796 (`cellAt`, `heightAt`, `waterLevelAt`, `isWater`, `dominantFloor`, `debugMap`) reading `a.kind`, `a.height`, `a.waterLevel`, `a.groundH`, `a.mt`, `a.idx`, `a.inside`, `a.N`, `a.minX…a.maxY`, and returning `groundRefs: a.groundRefs` and `minX, minY, maxX, maxY` from `a`.

- [ ] **Step 7: Create `src/render/overworld/legacyQuads.ts`**

1. Move the types `Vec3`, `Quad`, `TreeQuad` (classify.ts lines 16–35) here, exported. Imports: `Variant` from `./metatileAtlas`, `diffFromGround` from `./tileInfo`, `K`, `ROOF_SLOPE`, `type MapAnalysis` from `./analyze`, `type Claims`, `CLAIM_SURFACE`, `CLAIM_OBJECT`, `CLAIM_TOP` from `./claims`.
2. Header and destructuring so the moved code compiles unchanged:

```ts
/** Today's pixel-textured reconstruction, skipping whatever the kit claimed. */
export function emitLegacy(a: MapAnalysis, claims: Claims | null = null): { quads: Quad[]; trees: TreeQuad[] } {
  const { opts, info, minX, minY, maxX, maxY, idx, inside, mt, layer, kind, roundTree, buildings,
    height, groundOf, groundH, hasTop, GW } = a;
  const claimed = (i: number, bit: number) => claims !== null && (claims.bits[i] & bit) !== 0;
  /** Kind as the legacy emitter sees it: objects claimed by the kit no longer exist here. */
  const kindL = (i: number) => (claimed(i, CLAIM_OBJECT) &&
    (kind[i] === K.Block || kind[i] === K.Tree || kind[i] === K.Building) ? K.Floor : kind[i]);
```

3. Body = classify.ts lines 460–753 verbatim (geometry helpers through "unclaimed overhangs"), then `return { quads, trees };` and `}`. Apply exactly these edits to the moved code:
   - floors loop (orig. 506–523): right after `const i = idx(x, y);` insert `if (claimed(i, CLAIM_SURFACE)) continue;`
   - trees loop (orig. 526–550): every `kind[idx(…)] === K.Tree` / `!== K.Tree` test uses `kindL(idx(…))`; and `const overhang = aboveI >= 0 && kind[aboveI] === K.Floor && hasTop(aboveI) && !claimed(aboveI, CLAIM_TOP);`
   - buildings loop (orig. 553): first line inside `for (const b of buildings) {` → `if (b.cells.some((c) => claimed(c, CLAIM_OBJECT))) continue;`; roof overhang test (orig. 581) → `inside(x, top - 1) && kind[ov] === K.Floor && hasTop(ov) && !claimed(ov, CLAIM_TOP)`
   - generic blocked runs (orig. 621–690): every run test `kind[idx(…)] === K.Block` / `!== K.Block` uses `kindL(idx(…))`; the `walk` helper and the side-skirt neighbour tests keep `kind[…]`; the sparse-prop overhang test (orig. 657) → `ai >= 0 && kind[ai] === K.Floor && hasTop(ai) && !claimed(ai, CLAIM_TOP)`
   - connectors (orig. 698–742): in the south block, after `const j = idx(x, y + 1);` wrap the existing `if (surface(...)…)` in `if (!(claimed(i, CLAIM_SURFACE) && claimed(j, CLAIM_SURFACE))) { … }`; same in the east block after `const j = idx(x + 1, y);`
   - unclaimed overhangs (orig. 748–752): `if (kind[i] !== K.Floor || !hasTop(i) || consumedTop[i] || claimed(i, CLAIM_TOP)) continue;`
   - remove the now-unused `opts` / `GW` from the destructuring if `tsc` reports them unused (keep whatever the moved code uses).

- [ ] **Step 8: Reduce `classify.ts` to a wrapper**

```ts
// Turns the 2D metatile grid into 3D geometry by "un-projecting" the GBA's oblique view.
// The work is split: analyze.ts (cell kinds, heights, buildings) and legacyQuads.ts (the
// pixel-textured quads). This wrapper keeps the original single-call API.

import { analyze, queries, type CellQueries, type ClassifyOptions } from './analyze';
import { emitLegacy, type Quad, type TreeQuad } from './legacyQuads';
import type { GridData } from './world';

export type { ClassifyOptions } from './analyze';
export type { Vec3, Quad, TreeQuad } from './legacyQuads';
export { isWaterBehavior } from './analyze';

export interface CellModel extends CellQueries {
  quads: Quad[];
  /** Camera-facing tree rows (see treeCards.ts). */
  trees: TreeQuad[];
}

export function classify(grid: GridData, opts: ClassifyOptions): CellModel {
  const a = analyze(grid, opts);
  return { ...queries(a), ...emitLegacy(a) };
}
```

- [ ] **Step 9: Verify**

Run: `npx tsc --noEmit` → no errors.
Run: `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/golden.test.ts` → PASS (hashes identical).
Run: `npm test` → all pass.
Run: `npx tsx tools/regress.ts --label t2 --only littleroot,slateport --hours 11` → same look as `out/regress/before`.

- [ ] **Step 10: Commit**

```bash
git add src/render/overworld docs/superpowers/progress/modern-3d.md
git commit -m "refactor: split classify into analyze + legacyQuads with claim support"
```

---

### Task 3: World style setting, quality and map events plumbing

Adds `World style: Modern / Retro 3D`, passes render quality and grid-space map events (warps, signs) down to `World.build`. No visual change yet.

**Files:**
- Create: `src/render/kit/events.ts`, `tests/kitEvents.test.ts`
- Modify: `src/ui/settings.ts`, `src/main.ts`, `src/render/renderer.ts`, `src/render/overworld/overworldView.ts`, `src/render/overworld/world.ts`, `src/render/preview.ts`

**Interfaces:**
- Produces (`events.ts`): `GridWarp { x; y; dest: string }`, `GridSign { x; y }`, `GridEvents { warps; signs }`, `NO_EVENTS`, `gridEvents(ev: MapEvents, offset: number): GridEvents`.
- Produces (`world.ts`): `type WorldStyle = 'modern' | 'retro'`, `interface WorldBuildContext { style: WorldStyle; events: GridEvents; quality: Quality }`, `World.build(grid, opts, ctx: WorldBuildContext)`.
- Produces (`overworldView.ts`): `worldStyle: WorldStyle`, `quality: Quality`, `setWorldStyle(s)`, `buildWorld(grid, bus, bgPalette, primaryTileset, events?: GridEvents)`.
- Produces (`settings.ts`): `Settings.worldStyle: 'modern' | 'retro'` (default `'modern'`).

- [ ] **Step 1: Write the failing test** — `tests/kitEvents.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { gridEvents } from '../src/render/kit/events';
import type { MapEvents } from '../src/game/rom/maps';

const ev: MapEvents = {
  objects: [],
  coordEvents: [],
  warps: [{ x: 5, y: 8, elevation: 0, warpId: 0, mapGroup: 1, mapNum: 0 }],
  bgEvents: [
    { x: 3, y: 4, elevation: 0, kind: 0, script: 0x08000000 },
    { x: 6, y: 4, elevation: 0, kind: 2, script: 0x08000000 },
    { x: 9, y: 9, elevation: 0, kind: 7, hiddenItem: { item: 1, hiddenItemId: 2 } },
  ],
};

describe('gridEvents', () => {
  it('shifts live coordinates by MAP_OFFSET and keeps preview coordinates', () => {
    expect(gridEvents(ev, 7).warps[0]).toMatchObject({ x: 12, y: 15 });
    expect(gridEvents(ev, 0).warps[0]).toMatchObject({ x: 5, y: 8 });
  });
  it('names warp destinations', () => {
    expect(gridEvents(ev, 0).warps[0].dest).toBe('LittlerootTown_BrendansHouse_1F');
  });
  it('keeps interactable signs, drops hidden items', () => {
    expect(gridEvents(ev, 7).signs).toEqual([{ x: 10, y: 11 }, { x: 13, y: 11 }]);
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run tests/kitEvents.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement `src/render/kit/events.ts`**

```ts
// Map events (ROM, map-local coordinates) → grid-space doors and signs for the semantic layer.

import { mapName, BgEventKind, type MapEvents } from '../../game/rom/maps';

export interface GridWarp { x: number; y: number; dest: string }
export interface GridSign { x: number; y: number }
export interface GridEvents { warps: GridWarp[]; signs: GridSign[] }

export const NO_EVENTS: GridEvents = { warps: [], signs: [] };

/** `offset` is MAP_OFFSET (7) for the live backup grid and 0 for the static preview grid. */
export function gridEvents(ev: MapEvents, offset: number): GridEvents {
  return {
    warps: ev.warps.map((w) => ({ x: w.x + offset, y: w.y + offset, dest: mapName(w.mapGroup, w.mapNum) })),
    signs: ev.bgEvents
      .filter((b) => b.kind <= BgEventKind.FACING_WEST)
      .map((b) => ({ x: b.x + offset, y: b.y + offset })),
  };
}
```

Run: `npx vitest run tests/kitEvents.test.ts` → PASS.

- [ ] **Step 4: Settings** — in `src/ui/settings.ts`:
  - `Settings` gets `worldStyle: 'modern' | 'retro';`; defaults get `worldStyle: 'modern'`.
  - In the panel HTML, after the `View` label insert:

```html
      <label>World style
        <select data-k="worldStyle"><option value="modern">Modern 3D</option><option value="retro">Retro 3D (pixel art)</option></select></label>
```

  - In `src/main.ts` `applySettings`, add `renderer.overworld.setWorldStyle(s.worldStyle);`

- [ ] **Step 5: World build context** — in `src/render/overworld/world.ts`:

```ts
import type { Quality } from '../post';
import type { GridEvents } from '../kit/events';
import { analyze, queries } from './analyze';
import { emitLegacy } from './legacyQuads';
import type { Claims } from './claims';
import type { CellModel, ClassifyOptions } from './classify';

export type WorldStyle = 'modern' | 'retro';

export interface WorldBuildContext {
  style: WorldStyle;
  events: GridEvents;
  quality: Quality;
}
```

Replace the head of `build()` (`this.dispose(); const model = classify(grid, { ...opts, margin: this.margin });`) with:

```ts
  build(grid: GridData, opts: Omit<ClassifyOptions, 'margin'>, ctx: WorldBuildContext): void {
    this.dispose();
    const a = analyze(grid, { ...opts, margin: this.margin });
    const claims: Claims | null = null; // filled by the kit (Task 5)
    void ctx;
    const model: CellModel = { ...queries(a), ...emitLegacy(a, claims) };
```

(the rest of `build()` is unchanged and keeps using `model`). Remove the now-unused `classify` import.

- [ ] **Step 6: OverworldView** — in `src/render/overworld/overworldView.ts`:
  - imports: `type Quality` from `../post`; `World, type GridData, type WorldStyle` from `./world`; `gridEvents, NO_EVENTS, type GridEvents` from `../kit/events`; `readEvents` from `../../game/rom/maps`; `RomReader` from `../../game/rom/reader`; `MAP_OFFSET` from `../../game/state`.
  - fields:

```ts
  worldStyle: WorldStyle = 'modern';
  quality: Quality = 'medium';
  private romReader: RomReader | null = null;
  private eventsCache: { addr: number; events: GridEvents } = { addr: -1, events: NO_EVENTS };
```

  - methods:

```ts
  /** Switches Modern/Retro; the world is rebuilt on the next sync. */
  setWorldStyle(s: WorldStyle): void {
    if (s === this.worldStyle) return;
    this.worldStyle = s;
    this.gridKey = '';
  }

  /** Warps and signs of the current map in backup-grid coordinates (cached per events table). */
  private liveEvents(state: GameState): GridEvents {
    const addr = state.header?.events ?? 0;
    if (addr !== this.eventsCache.addr) {
      this.romReader ??= new RomReader(state.mem.bus.rom);
      this.eventsCache = { addr, events: gridEvents(readEvents(this.romReader, addr), MAP_OFFSET) };
    }
    return this.eventsCache.events;
  }
```

  - `sync()`: pass events: `this.buildWorld(grid, m.bus, …, state.layout.primaryTileset, this.liveEvents(state));`
  - `buildWorld(grid, bus, bgPalette, primaryTileset, events: GridEvents = NO_EVENTS)` passes `{ style: this.worldStyle, events, quality: this.quality }` as the third argument of `this.world.build(…)`.

- [ ] **Step 7: Renderer and preview**
  - `src/render/renderer.ts`: right after the `OverworldView` is constructed, add `this.overworld.quality = quality;`
  - `src/render/preview.ts`: after the `OverworldView` is constructed: `this.view.quality = quality; this.view.worldStyle = params.get('style') === 'retro' ? 'retro' : 'modern';` and pass `gridEvents(map.events, 0)` as the fifth argument of `this.view.buildWorld(...)` (import `gridEvents` from `./kit/events`).

- [ ] **Step 8: Verify and commit**

Run: `npx tsc --noEmit && npm test` → pass. Run the golden test → PASS.
Run: `npx tsx tools/regress.ts --label t3 --only littleroot,oldale --hours 11` → same as `before`.

```bash
git add src tests/kitEvents.test.ts docs/superpowers/progress/modern-3d.md
git commit -m "feat: world style setting, quality and grid-space map events plumbing"
```

---

### Task 4: Kit foundation — geometry helpers, palette, GLSL noise, kit materials

**Files:**
- Create: `src/render/kit/geom.ts`, `src/render/kit/palette.ts`, `src/render/kit/noise.glsl.ts`, `src/render/kit/materials.ts`
- Test: `tests/kitGeom.test.ts`, `tests/kitPalette.test.ts`, `tests/kitMaterials.test.ts`

**Interfaces:**
- Produces (`palette.ts`): `type RGB = [number, number, number]`, `bgr555ToSrgb`, `srgbToLinear`, `toLinear`, `luma`, `saturation`, `scale`, `mix`, `dominantColor(px, metatiles, accept?)`, `countPixels(px, metatiles, accept)`, `soften(c, k?)`, `type GroundClass`, `classifyGroundColor(c)`.
- Produces (`geom.ts`): `rng(seed)`, `hashCell(x, y, salt?)`, `toWorld(x, y, h, out?)`, `noise3(x, y, z)`, `type V3 = [number, number, number]`, `class MeshBuilder { quad(a,b,c,d,normal,color); add(geometry, color, matrix?); readonly empty; build() }`.
- Produces (`noise.glsl.ts`): `KIT_NOISE_GLSL` (GLSL: `kitHash12`, `kitHash22`, `kitNoise2`, `kitFbm2`, `kitVoronoi`, `kitBayer4`, `kitSrgbToLinear`).
- Produces (`materials.ts`): `MAX_ACTORS = 8`, `KitUniforms`, `createKitUniforms()`, `KitMaterialOptions`, `KitMaterial { material; depth }`, `kitMaterial(u, opts)`, `applyKitMaterial(mesh, km)`.

- [ ] **Step 1: Write the failing tests**

`tests/kitPalette.test.ts` (colours measured from the ROM: Littleroot grass, Oldale path, Slateport paving, sand, Route 113 ash, Mt Chimney rock, sea):

```ts
import { describe, it, expect } from 'vitest';
import { classifyGroundColor, soften, dominantColor, bgr555ToSrgb, saturation, type RGB } from '../src/render/kit/palette';

describe('classifyGroundColor', () => {
  const cases: [RGB, string][] = [
    [[0.45, 0.78, 0.65], 'grass'],
    [[0.26, 0.71, 0.52], 'grass'],
    [[0.65, 0.84, 0.78], 'path'],
    [[0.81, 0.81, 0.87], 'paving'],
    [[0.97, 0.97, 0.94], 'paving'],
    [[0.87, 0.81, 0.52], 'sand'],
    [[0.58, 0.55, 0.45], 'gravel'],
    [[0.68, 0.68, 0.55], 'gravel'],
    [[0.74, 0.58, 0.55], 'dirt'],
    [[0.87, 0.71, 0.65], 'dirt'],
    [[0.32, 0.42, 0.84], 'water'],
    [[0.05, 0.05, 0.06], 'dark'],
  ];
  for (const [c, want] of cases) it(`${c.join(',')} → ${want}`, () => expect(classifyGroundColor(c)).toBe(want));
});

describe('soften', () => {
  it('lifts black and tames neon saturation', () => {
    const k = soften([0, 0, 0]);
    expect(Math.min(...k)).toBeGreaterThanOrEqual(0.03);
    expect(saturation(soften([1, 0, 0]))).toBeLessThan(saturation([1, 0, 0]));
  });
  it('keeps mid colours close', () => {
    const c: RGB = [0.45, 0.78, 0.65];
    soften(c).forEach((v, i) => expect(Math.abs(v - c[i])).toBeLessThan(0.06));
  });
});

describe('dominantColor', () => {
  it('returns the most frequent accepted opaque colour', () => {
    const px = new Uint16Array(512).fill(0x8000);
    px.fill(31, 0, 100); // red x100 in metatile 0
    px.fill(31 << 5, 256, 300); // green x44 in metatile 1
    px.fill(31 << 10, 300, 330); // blue x30 in metatile 1
    expect(dominantColor(px, [0, 1])).toEqual(bgr555ToSrgb(31));
    expect(dominantColor(px, [0, 1], (c) => c[0] < 0.5)).toEqual(bgr555ToSrgb(31 << 5));
    expect(dominantColor(px, [1], (c) => c[0] > 0.5)).toBeNull();
  });
});
```

`tests/kitGeom.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { rng, hashCell, toWorld, noise3, MeshBuilder } from '../src/render/kit/geom';

describe('geom', () => {
  it('rng is deterministic and in [0, 1)', () => {
    const a = rng(42), b = rng(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('hashCell separates neighbours', () => {
    expect(hashCell(3, 4)).toBe(hashCell(3, 4));
    expect(hashCell(3, 4)).not.toBe(hashCell(4, 3));
    expect(hashCell(3, 4)).not.toBe(hashCell(3, 4, 1));
  });
  it('toWorld un-projects (x, y, h) → (x, h, y + h)', () => {
    expect(toWorld(3, 5, 2).toArray()).toEqual([3, 2, 7]);
  });
  it('noise3 is bounded and continuous', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.137, y = i * 0.071, z = i * 0.019;
      const n = noise3(x, y, z);
      expect(Math.abs(n)).toBeLessThanOrEqual(1);
      expect(Math.abs(n - noise3(x + 1e-3, y, z))).toBeLessThan(0.02);
    }
  });
  it('MeshBuilder.quad faces the given normal whatever the corner order', () => {
    const mb = new MeshBuilder();
    mb.quad([0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 1], [1, 1, 1]); // clockwise seen from +Z
    const g = mb.build();
    const p = g.getAttribute('position');
    expect(p.count).toBe(6);
    const v = (k: number) => new THREE.Vector3().fromBufferAttribute(p, k);
    const n = v(1).sub(v(0)).cross(v(2).sub(v(0)));
    expect(n.z).toBeGreaterThan(0);
  });
});
```

`tests/kitMaterials.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { kitMaterial, createKitUniforms } from '../src/render/kit/materials';

describe('kitMaterial', () => {
  const u = createKitUniforms();
  it('wind adds a matching depth material', () => {
    const k = kitMaterial(u, { wind: 0.1, windHeight: 2 });
    expect(k.material.defines).toHaveProperty('KIT_WIND');
    expect(k.depth).not.toBeNull();
  });
  it('rigid materials need no custom depth', () => {
    expect(kitMaterial(u, { fade: true }).depth).toBeNull();
  });
  it('features map to defines and distinct program keys', () => {
    const a = kitMaterial(u, { fade: true, pattern: 'roofTiles' }).material;
    const b = kitMaterial(u, { fade: true }).material;
    expect(a.defines).toHaveProperty('KIT_FADE');
    expect(a.defines).toHaveProperty('KIT_PATTERN_ROOF');
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run tests/kitPalette.test.ts tests/kitGeom.test.ts tests/kitMaterials.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Implement `src/render/kit/palette.ts`**

```ts
// Colour sampling from the live tiles, and the art-direction adjustments that make ROM colours
// read well under physically based lighting. All colours are sRGB in 0..1 unless noted.

export type RGB = [number, number, number];

export function bgr555ToSrgb(c: number): RGB {
  return [(c & 31) / 31, ((c >> 5) & 31) / 31, ((c >> 10) & 31) / 31];
}

export function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function toLinear(c: RGB): RGB {
  return [srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2])];
}

export function luma(c: RGB): number {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

export function saturation(c: RGB): number {
  return Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
}

export function scale(c: RGB, k: number): RGB {
  return [c[0] * k, c[1] * k, c[2] * k];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * Most frequent colour among the opaque pixels of `metatiles` in a 256-px-per-metatile BGR555
 * buffer (TileInfo.both / .bottom; 0x8000 = transparent), optionally filtered.
 */
export function dominantColor(px: Uint16Array, metatiles: Iterable<number>, accept?: (c: RGB) => boolean): RGB | null {
  const counts = new Map<number, number>();
  for (const m of metatiles) {
    for (let p = 0; p < 256; p++) {
      const v = px[m * 256 + p];
      if (v & 0x8000) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  let best = -1;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n <= bestN || (accept && !accept(bgr555ToSrgb(v)))) continue;
    best = v;
    bestN = n;
  }
  return best < 0 ? null : bgr555ToSrgb(best);
}

/** Number of opaque pixels of `metatiles` whose colour passes `accept`. */
export function countPixels(px: Uint16Array, metatiles: Iterable<number>, accept: (c: RGB) => boolean): number {
  let n = 0;
  for (const m of metatiles) {
    for (let p = 0; p < 256; p++) {
      const v = px[m * 256 + p];
      if (!(v & 0x8000) && accept(bgr555ToSrgb(v))) n++;
    }
  }
  return n;
}

/** Tames neon saturation and lifts crushed darks (art direction: soft, bright, clean). */
export function soften(c: RGB, k = 0.12): RGB {
  const l = luma(c);
  const s = saturation(c);
  const desat = s > 0.5 ? k * (s - 0.5) * 2 : 0;
  const lift = 0.04;
  return [0, 1, 2].map((i) => {
    const v = c[i] + (l - c[i]) * desat;
    return v * (1 - lift) + lift;
  }) as RGB;
}

export type GroundClass = 'grass' | 'path' | 'sand' | 'paving' | 'dirt' | 'gravel' | 'rock' | 'water' | 'dark';

/** Ground material class of a tile's dominant colour (thresholds from measured ROM colours). */
export function classifyGroundColor(c: RGB): GroundClass {
  const [r, g, b] = c;
  const l = luma(c);
  const s = saturation(c);
  if (l < 0.12) return 'dark';
  if (b > r + 0.2 && b > g + 0.05) return 'water';
  if (g > r + 0.15 && s > 0.25) return 'grass';
  if (r > 0.75 && g > 0.65 && b < g - 0.12) return 'sand';
  if (Math.abs(r - g) < 0.06 && b < r - 0.08 && s < 0.2 && l < 0.75) return 'gravel';
  if (s < 0.12) return l >= 0.6 ? 'paving' : 'rock';
  if (g >= r - 0.02 && l > 0.6 && s <= 0.25) return 'path';
  if (r > b + 0.1 && r >= g - 0.02) return 'dirt';
  return 'path';
}
```

- [ ] **Step 4: Implement `src/render/kit/geom.ts`**

```ts
// Small deterministic helpers shared by the model generators.

import * as THREE from 'three';
import type { RGB } from './palette';

export type V3 = [number, number, number];

/** Deterministic PRNG (mulberry32): the same seed always gives the same sequence. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 32-bit hash of a grid cell (plus salt), for per-cell seeds. */
export function hashCell(x: number, y: number, salt = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(salt | 0, 0x1b873593);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Grid cell (x, y) at height h → world position (the un-projection used everywhere). */
export function toWorld(x: number, y: number, h: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(x, h, y + h);
}

const lattice = (x: number, y: number, z: number) => (hashCell(x, y, z) / 4294967296) * 2 - 1;
const fade = (t: number) => t * t * (3 - 2 * t);

/** Smooth 3D value noise in [-1, 1] (CPU-side vertex displacement). */
export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const l = (dx: number, dy: number, dz: number) => lattice(ix + dx, iy + dy, iz + dz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const x00 = lerp(l(0, 0, 0), l(1, 0, 0), fx), x10 = lerp(l(0, 1, 0), l(1, 1, 0), fx);
  const x01 = lerp(l(0, 0, 1), l(1, 0, 1), fx), x11 = lerp(l(0, 1, 1), l(1, 1, 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz);
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3();
const _p = new THREE.Vector3(), _q = new THREE.Vector3(), _m3 = new THREE.Matrix3();

/** Accumulates coloured triangles; build() returns one non-indexed geometry (position, normal, color, uv). */
export class MeshBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private uv: number[] = [];

  get empty(): boolean {
    return this.pos.length === 0;
  }

  private vert(p: V3 | THREE.Vector3, n: V3 | THREE.Vector3, c: RGB, u = 0, v = 0): void {
    if (Array.isArray(p)) this.pos.push(p[0], p[1], p[2]); else this.pos.push(p.x, p.y, p.z);
    if (Array.isArray(n)) this.nor.push(n[0], n[1], n[2]); else this.nor.push(n.x, n.y, n.z);
    this.col.push(c[0], c[1], c[2]);
    this.uv.push(u, v);
  }

  /** Quad a-b-c-d (a=TL, b=TR, c=BR, d=BL of its texture), wound to face `normal`. Colour is linear RGB. */
  quad(a: V3, b: V3, c: V3, d: V3, normal: V3, color: RGB): void {
    _a.fromArray(a); _b.fromArray(b); _d.fromArray(d);
    _n.subVectors(_b, _a).cross(_d.sub(_a));
    const flip = _n.dot(_p.fromArray(normal)) < 0;
    // (b-a)x(d-a) is the normal of triangles (a,b,c) and (a,c,d); three.js front faces are CCW.
    const order: [V3, number, number][] = flip
      ? [[a, 0, 1], [c, 1, 0], [b, 1, 1], [a, 0, 1], [d, 0, 0], [c, 1, 0]]
      : [[a, 0, 1], [b, 1, 1], [c, 1, 0], [a, 0, 1], [c, 1, 0], [d, 0, 0]];
    for (const [p, u, v] of order) this.vert(p, normal, color, u, v);
  }

  /** Appends `g` (indexed or not), transformed by `matrix`, tinted by `color` (× its own colours). */
  add(g: THREE.BufferGeometry, color: RGB, matrix?: THREE.Matrix4): void {
    const src = g.index ? g.toNonIndexed() : g;
    const p = src.getAttribute('position');
    const n = src.getAttribute('normal');
    const c = src.getAttribute('color');
    const t = src.getAttribute('uv');
    if (matrix) _m3.getNormalMatrix(matrix);
    for (let i = 0; i < p.count; i++) {
      _p.fromBufferAttribute(p, i);
      _q.fromBufferAttribute(n, i);
      if (matrix) {
        _p.applyMatrix4(matrix);
        _q.applyMatrix3(_m3).normalize();
      }
      const k: RGB = c ? [c.getX(i) * color[0], c.getY(i) * color[1], c.getZ(i) * color[2]] : color;
      this.vert(_p, _q, k, t ? t.getX(i) : 0, t ? t.getY(i) : 0);
    }
    if (src !== g) src.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}
```

- [ ] **Step 5: Implement `src/render/kit/noise.glsl.ts`**

```ts
// GLSL helpers shared by kit shaders (ground, water, patterns, fade).

export const KIT_NOISE_GLSL = /* glsl */ `
float kitHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 kitHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float kitNoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = kitHash12(i), b = kitHash12(i + vec2(1.0, 0.0));
  float c = kitHash12(i + vec2(0.0, 1.0)), d = kitHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float kitFbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * kitNoise2(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
// x: distance to the nearest cell border (F2 - F1), y: random id of the nearest cell.
vec2 kitVoronoi(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      float d = length(g + kitHash22(i + g) - f);
      if (d < d1) { d2 = d1; d1 = d; id = kitHash12(i + g + 7.7); }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec2(d2 - d1, id);
}
float kitBayer4(vec2 p) {
  ivec2 q = ivec2(mod(floor(p), 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[q.x + q.y * 4]) + 0.5) / 16.0;
}
vec3 kitSrgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`;
```

- [ ] **Step 6: Implement `src/render/kit/materials.ts`**

```ts
// Stylised material factory: MeshStandardMaterial with injected wind sway, actor bending,
// camera-to-player occlusion fade, night glow and procedural surface patterns.

import * as THREE from 'three';
import { KIT_NOISE_GLSL } from './noise.glsl';

export const MAX_ACTORS = 8;

/** Shared, per-frame uniforms (owned by OverworldView; referenced by every kit material). */
export interface KitUniforms {
  uTime: { value: number };
  uNight: { value: number };
  /** Wind direction × strength (world XZ). */
  uWind: { value: THREE.Vector2 };
  /** Player position in drawing-buffer pixels. */
  uFocusPx: { value: THREE.Vector2 };
  /** Player distance along the view axis. */
  uFocusDepth: { value: number };
  /** Occlusion-fade radius in pixels (0 disables). */
  uFadeRadius: { value: number };
  /** Feet of characters that bend grass (unused slots far away). */
  uActors: { value: THREE.Vector3[] };
  /** Sky colour (linear) for water reflections. */
  uSky: { value: THREE.Color };
}

export function createKitUniforms(): KitUniforms {
  return {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uWind: { value: new THREE.Vector2(0.8, 0.35) },
    uFocusPx: { value: new THREE.Vector2(-1e4, -1e4) },
    uFocusDepth: { value: 0 },
    uFadeRadius: { value: 0 },
    uActors: { value: Array.from({ length: MAX_ACTORS }, () => new THREE.Vector3(1e4, 0, 1e4)) },
    uSky: { value: new THREE.Color(0.75, 0.88, 1.0) },
  };
}

export type KitPattern = 'none' | 'roofTiles' | 'planks' | 'stone';

export interface KitMaterialOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  roughness?: number;
  metalness?: number;
  side?: THREE.Side;
  map?: THREE.Texture | null;
  transparent?: boolean;
  flatShading?: boolean;
  /** Sway amplitude in world units at full flex (0 = rigid). */
  wind?: number;
  /** Height above the instance origin at which flex reaches 1. */
  windHeight?: number;
  /** Bend away from actors (grass); needs `wind`. */
  bend?: boolean;
  /** Dither out when between the camera and the player. */
  fade?: boolean;
  /** Warm emissive glow at night (window glass, lamps); value = strength. */
  glow?: number;
  pattern?: KitPattern;
  /** Extra uniforms used by the GLSL hooks below. */
  uniforms?: Record<string, { value: unknown }>;
  /** GLSL declarations appended to the fragment prelude (after the noise helpers). */
  fragHead?: string;
  /** GLSL after <color_fragment>: may change diffuseColor (vKitWorld = world position). */
  fragColor?: string;
  /** GLSL after <normal_fragment_maps>: may change `normal` (view space). */
  fragNormal?: string;
  /** GLSL after <emissivemap_fragment>: may add to totalEmissiveRadiance. */
  fragEmissive?: string;
  /** GLSL after <begin_vertex>: may change `transformed` (object space). */
  vertTransform?: string;
  /** Required with hooks: distinguishes the compiled program. */
  hookKey?: string;
}

export interface KitMaterial {
  material: THREE.MeshStandardMaterial;
  /** Matching shadow-depth material for deforming (wind) materials, else null. */
  depth: THREE.MeshDepthMaterial | null;
}

const VERT_PRELUDE = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uWindAmp;
uniform float uWindHeight;
uniform vec3 uActors[${MAX_ACTORS}];
varying vec3 vKitWorld;
`;

const PROJECT_VERTEX = /* glsl */ `
vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
#ifdef KIT_WIND
{
  vec3 kOrigin = vec3(0.0);
  #ifdef USE_INSTANCING
    kOrigin = instanceMatrix[3].xyz;
  #endif
  float flex = clamp((mvPosition.y - kOrigin.y) / uWindHeight, 0.0, 1.0);
  flex *= flex;
  vec3 wo = (modelMatrix * vec4(kOrigin, 1.0)).xyz;
  float ph = uTime * 1.6 + wo.x * 0.37 + wo.z * 0.29;
  float gust = sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.25 + 0.4;
  mvPosition.xz += uWind * gust * flex * uWindAmp;
  #ifdef KIT_BEND
  {
    vec3 wp = (modelMatrix * mvPosition).xyz;
    for (int k = 0; k < ${MAX_ACTORS}; k++) {
      vec3 d = wp - uActors[k];
      float push = (1.0 - smoothstep(0.2, 0.8, length(d.xz))) * (1.0 - step(1.6, abs(d.y)));
      mvPosition.xz += normalize(d.xz + vec2(1e-4)) * push * flex * 0.32;
      mvPosition.y -= push * flex * 0.14;
    }
  }
  #endif
}
#endif
vKitWorld = (modelMatrix * mvPosition).xyz;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

const FRAG_PRELUDE = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform vec3 uSky;
uniform vec2 uFocusPx;
uniform float uFocusDepth;
uniform float uFadeRadius;
uniform float uGlow;
varying vec3 vKitWorld;
${KIT_NOISE_GLSL}
`;

const FADE = /* glsl */ `
#ifdef KIT_FADE
if (uFadeRadius > 0.0 && vViewPosition.z < uFocusDepth - 0.6) {
  float kf = 1.0 - smoothstep(uFadeRadius * 0.55, uFadeRadius, length(gl_FragCoord.xy - uFocusPx));
  if (kf > 0.0 && kitBayer4(gl_FragCoord.xy) < kf * 0.9) discard;
}
#endif
`;

const PATTERNS = /* glsl */ `
#if defined(KIT_PATTERN_ROOF)
{
  float row = vKitWorld.y * 5.0;
  float fr = fract(row);
  float seam = fract(vKitWorld.x * 3.0 + 0.5 * floor(row));
  float k = mix(0.72, 1.0, smoothstep(0.0, 0.14, fr));
  k *= mix(0.86, 1.0, smoothstep(0.0, 0.06, seam) * smoothstep(1.0, 0.94, seam));
  k *= 0.94 + 0.12 * kitHash12(vec2(floor(vKitWorld.x * 3.0 + 0.5 * floor(row)), floor(row)));
  diffuseColor.rgb *= k;
}
#elif defined(KIT_PATTERN_PLANKS)
{
  float fr = fract(vKitWorld.y * 4.0);
  diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.0, 0.1, fr)) * (0.9 + 0.1 * kitNoise2(vKitWorld.xz * vec2(8.0, 0.8)));
}
#elif defined(KIT_PATTERN_STONE)
{
  vec2 v = kitVoronoi(vKitWorld.xy * 3.0 + vKitWorld.zz * 0.7);
  diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.02, 0.08, v.x)) * (0.92 + 0.12 * v.y);
}
#endif
`;

const GLOW = /* glsl */ `
#ifdef KIT_GLOW
totalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * uNight * uGlow;
#endif
`;

type Local = Record<'uWindAmp' | 'uWindHeight' | 'uGlow', { value: number }>;

function patchKit(s: THREE.WebGLProgramParametersWithUniforms, u: KitUniforms, local: Local, o: KitMaterialOptions, full: boolean): void {
  Object.assign(s.uniforms, {
    uTime: u.uTime, uWind: u.uWind, uActors: u.uActors, uNight: u.uNight, uSky: u.uSky,
    uFocusPx: u.uFocusPx, uFocusDepth: u.uFocusDepth, uFadeRadius: u.uFadeRadius, ...local, ...(o.uniforms ?? {}),
  });
  s.vertexShader = VERT_PRELUDE + s.vertexShader
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (o.vertTransform ?? ''))
    .replace('#include <project_vertex>', PROJECT_VERTEX);
  if (!full) return;
  s.fragmentShader = FRAG_PRELUDE + (o.fragHead ?? '') + s.fragmentShader
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FADE)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + PATTERNS + (o.fragColor ?? ''))
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + (o.fragNormal ?? ''))
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + GLOW + (o.fragEmissive ?? ''));
}

export function kitMaterial(u: KitUniforms, o: KitMaterialOptions = {}): KitMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    vertexColors: o.vertexColors ?? false,
    roughness: o.roughness ?? 0.9,
    metalness: o.metalness ?? 0,
    side: o.side ?? THREE.FrontSide,
    map: o.map ?? null,
    transparent: o.transparent ?? false,
    flatShading: o.flatShading ?? false,
  });
  const defines: Record<string, string> = {};
  if (o.wind) defines.KIT_WIND = '';
  if (o.wind && o.bend) defines.KIT_BEND = '';
  if (o.fade) defines.KIT_FADE = '';
  if (o.glow) defines.KIT_GLOW = '';
  if (o.pattern === 'roofTiles') defines.KIT_PATTERN_ROOF = '';
  else if (o.pattern === 'planks') defines.KIT_PATTERN_PLANKS = '';
  else if (o.pattern === 'stone') defines.KIT_PATTERN_STONE = '';
  material.defines = defines;
  const local: Local = {
    uWindAmp: { value: o.wind ?? 0 },
    uWindHeight: { value: o.windHeight ?? 1 },
    uGlow: { value: o.glow ?? 0 },
  };
  const key = 'kit:' + Object.keys(defines).sort().join(',') + ':' + (o.hookKey ?? '');
  material.onBeforeCompile = (s) => patchKit(s, u, local, o, true);
  material.customProgramCacheKey = () => key;
  let depth: THREE.MeshDepthMaterial | null = null;
  if (o.wind) {
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.defines = o.bend ? { KIT_WIND: '', KIT_BEND: '' } : { KIT_WIND: '' };
    depth.onBeforeCompile = (s) => patchKit(s, u, local, o, false);
    depth.customProgramCacheKey = () => key + ':depth';
  }
  return { material, depth };
}

/** Assigns a kit material (and its shadow-depth twin) to a mesh. */
export function applyKitMaterial(mesh: THREE.Mesh, k: KitMaterial): void {
  mesh.material = k.material;
  if (k.depth) mesh.customDepthMaterial = k.depth;
}
```

- [ ] **Step 7: Run the tests** — `npx vitest run tests/kitPalette.test.ts tests/kitGeom.test.ts tests/kitMaterials.test.ts` → PASS. Then `npx tsc --noEmit && npm test` → pass.

- [ ] **Step 8: Commit**

```bash
git add src/render/kit tests/kitPalette.test.ts tests/kitGeom.test.ts tests/kitMaterials.test.ts docs/superpowers/progress/modern-3d.md
git commit -m "feat(kit): palette sampling, geometry helpers, GLSL noise, stylised material factory"
```

---

### Task 5: Semantic core — families, claims, rollback, World integration

**Files:**
- Create: `src/render/kit/semantics.ts`, `src/render/kit/index.ts`, `tests/kitRun.test.ts`, `tests/helpers/fakeMap.ts`
- Modify: `src/render/overworld/world.ts`, `src/render/overworld/overworldView.ts`

**Interfaces:**
- Consumes: `MapAnalysis` (Task 2), `Claims` (Task 2), `GridEvents` (Task 3), `KitUniforms` (Task 4).
- Produces (`semantics.ts`):
  ```ts
  interface SemanticContext { a: MapAnalysis; events: GridEvents; quality: Quality }
  interface KitContext { uniforms: KitUniforms; quality: Quality; disposables: { dispose(): void }[] }
  interface Family<P> { readonly name: string; extract(ctx, claims): P; build(p: P, ctx, kit): THREE.Object3D | null }
  interface FamilyReport { name: string; ok: boolean; error?: string }
  interface Extracted { claims: Claims; payloads: Map<string, unknown>; added: Map<string, Uint8Array>; report: FamilyReport[] }
  function extractAll(ctx, families): Extracted
  function buildAll(ex, ctx, families, kit): THREE.Group
  function runKit(ctx, families, kit): { group: THREE.Group; claims: Claims; report: FamilyReport[] }
  function disposeKit(root: THREE.Object3D, kit: KitContext): void
  ```
- Produces (`index.ts`): `FAMILIES: readonly Family<unknown>[]` (empty now; Tasks 6–13 append in priority order).
- Produces (`world.ts`): `new World(atlas, materials, uniforms: KitUniforms, families = FAMILIES)`; `World.kitReport: FamilyReport[]`.
- Produces (`overworldView.ts`): `readonly kitUniforms: KitUniforms` (its `uNight`/`uTime` objects replace the old `worldUniforms` fields).

- [ ] **Step 1: Test helper** — `tests/helpers/fakeMap.ts`

```ts
// Tiny synthetic map for unit tests that need a MapAnalysis without the ROM.
import { analyze, type MapAnalysis } from '../../src/render/overworld/analyze';
import type { TileInfo } from '../../src/render/overworld/tileInfo';
import type { GridData } from '../../src/render/overworld/world';

export function fakeInfo(): TileInfo {
  return {
    both: new Uint16Array(1024 * 256).fill(0x8000), bottom: new Uint16Array(1024 * 256).fill(0x8000),
    topCover: new Uint16Array(1024), bottomCover: new Uint16Array(1024), green: new Float32Array(1024),
    blue: new Float32Array(1024), isVoid: new Uint8Array(1024), attributes: new Uint16Array(1024),
  };
}

/** `rows` of characters: '.' walkable metatile 1, '#' blocked metatile 2. */
export function fakeGrid(rows: string[]): GridData {
  const w = rows[0].length, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = ch === '#' ? 2 | 0x0400 : 1 | 0x3000; }));
  return { width: w, height: h, cells, border: [1, 1, 1, 1], borderW: 2, borderH: 2, borderPhase: 0 };
}

export function fakeAnalysis(rows: string[]): MapAnalysis {
  const info = fakeInfo();
  return analyze(fakeGrid(rows), { info, generalPrimary: false, indoor: false, underground: false, margin: 1 });
}
```

- [ ] **Step 2: Write the failing tests** — `tests/kitRun.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { extractAll, buildAll, disposeKit, type Family, type KitContext } from '../src/render/kit/semantics';
import { createKitUniforms } from '../src/render/kit/materials';
import { CLAIM_OBJECT, CLAIM_SURFACE } from '../src/render/overworld/claims';
import { NO_EVENTS } from '../src/render/kit/events';
import { World } from '../src/render/overworld/world';
import { MetatileAtlas } from '../src/render/overworld/metatileAtlas';
import { createWorldMaterials } from '../src/render/overworld/materials';
import { fakeAnalysis, fakeGrid, fakeInfo } from './helpers/fakeMap';

const kit = (): KitContext => ({ uniforms: createKitUniforms(), quality: 'medium', disposables: [] });
const ctx = () => ({ a: fakeAnalysis(['....', '.#..', '....']), events: NO_EVENTS, quality: 'medium' as const });

const claimer = (name: string, i: number, bit: number, fail?: 'extract' | 'build'): Family<number> => ({
  name,
  extract(_c, claims) {
    claims.claim(i, bit);
    if (fail === 'extract') throw new Error('boom');
    return i;
  },
  build() {
    if (fail === 'build') throw new Error('boom');
    return new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  },
});

describe('semantic core', () => {
  it('rolls back a family whose extract throws, and keeps running the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ex = extractAll(ctx(), [claimer('bad', 5, CLAIM_OBJECT, 'extract'), claimer('good', 6, CLAIM_SURFACE)]);
    expect(ex.claims.bits[5]).toBe(0);
    expect(ex.claims.bits[6]).toBe(CLAIM_SURFACE);
    expect(ex.report.map((r) => r.ok)).toEqual([false, true]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('a build failure clears exactly the bits that family added', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fams = [claimer('a', 5, CLAIM_OBJECT, 'build'), claimer('b', 5, CLAIM_SURFACE)];
    const c = ctx();
    const ex = extractAll(c, fams);
    const group = buildAll(ex, c, fams, kit());
    expect(ex.claims.bits[5]).toBe(CLAIM_SURFACE);
    expect(group.children.map((o) => o.name)).toEqual(['b']);
    warn.mockRestore();
  });

  it('dispose removes all kit objects and frees non-shared resources', () => {
    const k = kit();
    const root = new THREE.Group();
    const parent = new THREE.Group();
    parent.add(root);
    const g1 = new THREE.BoxGeometry();
    const shared = new THREE.BoxGeometry();
    shared.userData.shared = true;
    const m1 = new THREE.MeshBasicMaterial();
    root.add(new THREE.Mesh(g1, m1), new THREE.Mesh(shared, m1));
    const tex = { dispose: vi.fn() };
    k.disposables.push(tex);
    const sg = vi.spyOn(g1, 'dispose');
    const ss = vi.spyOn(shared, 'dispose');
    disposeKit(root, k);
    expect(sg).toHaveBeenCalled();
    expect(ss).not.toHaveBeenCalled();
    expect(tex.dispose).toHaveBeenCalled();
    expect(parent.children).toHaveLength(0);
  });

  it('rebuilding a World leaves exactly one kit group', () => {
    const atlas = new MetatileAtlas({ vram: null, palette: null } as never, 1);
    const u = createKitUniforms();
    const mats = createWorldMaterials(atlas.target.texture, u);
    const world = new World(atlas, mats, u, [claimer('box', 5, CLAIM_OBJECT)]);
    const opts = { info: fakeInfo(), generalPrimary: false, indoor: false, underground: false };
    const ctxB = { style: 'modern' as const, events: NO_EVENTS, quality: 'medium' as const };
    world.build(fakeGrid(['....', '.#..', '....']), opts, ctxB);
    world.build(fakeGrid(['....', '.#..', '....']), opts, ctxB);
    expect(world.group.children.filter((o) => o.name === 'kit')).toHaveLength(1);
    world.build(fakeGrid(['....', '.#..', '....']), opts, { ...ctxB, style: 'retro' });
    expect(world.group.children.filter((o) => o.name === 'kit')).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run** — `npx vitest run tests/kitRun.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement `src/render/kit/semantics.ts`**

```ts
// The semantic layer: runs model families over the map analysis. Each family claims grid cells
// (so the legacy emitter skips them) and builds meshes. A family that throws is rolled back,
// and its cells render with the legacy pixel geometry.

import * as THREE from 'three';
import type { MapAnalysis } from '../overworld/analyze';
import { Claims } from '../overworld/claims';
import type { GridEvents } from './events';
import type { KitUniforms } from './materials';
import type { Quality } from '../post';

export interface SemanticContext {
  a: MapAnalysis;
  events: GridEvents;
  quality: Quality;
}

export interface KitContext {
  uniforms: KitUniforms;
  quality: Quality;
  /** Extra resources (textures) freed with the world. */
  disposables: { dispose(): void }[];
}

export interface Family<P> {
  readonly name: string;
  /** Pure: inspects the analysis, claims cells, returns placements. */
  extract(ctx: SemanticContext, claims: Claims): P;
  /** Builds the meshes for the placements (null = nothing to draw). */
  build(p: P, ctx: SemanticContext, kit: KitContext): THREE.Object3D | null;
}

export interface FamilyReport { name: string; ok: boolean; error?: string }

export interface Extracted {
  claims: Claims;
  payloads: Map<string, unknown>;
  /** Claim bits each family added (for rollback when its build fails). */
  added: Map<string, Uint8Array>;
  report: FamilyReport[];
}

export function extractAll(ctx: SemanticContext, families: readonly Family<unknown>[]): Extracted {
  const claims = new Claims(ctx.a.N);
  const ex: Extracted = { claims, payloads: new Map(), added: new Map(), report: [] };
  for (const f of families) {
    const snap = claims.snapshot();
    try {
      ex.payloads.set(f.name, f.extract(ctx, claims));
      const added = new Uint8Array(claims.bits.length);
      for (let i = 0; i < added.length; i++) added[i] = claims.bits[i] & ~snap.bits[i];
      ex.added.set(f.name, added);
      ex.report.push({ name: f.name, ok: true });
    } catch (e) {
      claims.restore(snap);
      ex.report.push({ name: f.name, ok: false, error: String(e) });
      console.warn(`[kit] ${f.name} failed (extract): ${String(e)}`);
    }
  }
  return ex;
}

export function buildAll(ex: Extracted, ctx: SemanticContext, families: readonly Family<unknown>[], kit: KitContext): THREE.Group {
  const group = new THREE.Group();
  group.name = 'kit';
  for (const f of families) {
    if (!ex.payloads.has(f.name)) continue;
    try {
      const obj = f.build(ex.payloads.get(f.name), ctx, kit);
      if (obj) {
        obj.name = f.name;
        group.add(obj);
      }
    } catch (e) {
      const added = ex.added.get(f.name)!;
      for (let i = 0; i < added.length; i++) ex.claims.bits[i] &= ~added[i];
      const r = ex.report.find((x) => x.name === f.name)!;
      r.ok = false;
      r.error = String(e);
      console.warn(`[kit] ${f.name} failed (build): ${String(e)}`);
    }
  }
  return group;
}

export function runKit(ctx: SemanticContext, families: readonly Family<unknown>[], kit: KitContext) {
  const ex = extractAll(ctx, families);
  const group = buildAll(ex, ctx, families, kit);
  return { group, claims: ex.claims, report: ex.report };
}

/** Frees everything under `root` (except geometries flagged `userData.shared`) and detaches it. */
export function disposeKit(root: THREE.Object3D, kit: KitContext): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) mat.dispose();
    m.customDepthMaterial?.dispose();
  });
  for (const d of kit.disposables) d.dispose();
  kit.disposables.length = 0;
  root.removeFromParent();
}
```

- [ ] **Step 5: Implement `src/render/kit/index.ts`**

```ts
// Model families in claim-priority order: objects first, terrain last (it covers the ground
// under every object the earlier families claimed).

import type { Family } from './semantics';

export const FAMILIES: readonly Family<unknown>[] = [];
```

- [ ] **Step 6: World integration** — in `src/render/overworld/world.ts`:
  - constructor becomes `constructor(private atlas: MetatileAtlas, private materials: WorldMaterials, uniforms: KitUniforms, private families: readonly Family<unknown>[] = FAMILIES)` and initialises `this.kit = { uniforms, quality: 'medium', disposables: [] };`
  - fields: `private kit: KitContext; private kitGroup: THREE.Group | null = null; kitReport: FamilyReport[] = [];`
  - in `dispose()` append: `if (this.kitGroup) { disposeKit(this.kitGroup, this.kit); this.kitGroup = null; }`
  - in `build()` replace `const claims: Claims | null = null; void ctx;` with:

```ts
    let claims: Claims | null = null;
    this.kitReport = [];
    if (ctx.style === 'modern' && !opts.indoor && !opts.underground && this.families.length) {
      try {
        this.kit.quality = ctx.quality;
        const r = runKit({ a, events: ctx.events, quality: ctx.quality }, this.families, this.kit);
        claims = r.claims;
        this.kitReport = r.report;
        this.kitGroup = r.group;
        this.group.add(r.group);
      } catch (e) {
        console.warn('[kit] semantic layer failed; this map uses Retro 3D', e);
        claims = null;
        if (this.kitGroup) { disposeKit(this.kitGroup, this.kit); this.kitGroup = null; }
      }
    }
```

  - imports: `runKit, disposeKit, type Family, type KitContext, type FamilyReport` from `../kit/semantics`; `FAMILIES` from `../kit/index`; `type KitUniforms` from `../kit/materials`.
  - `createWorldMaterials(atlas, u: WorldUniforms)` keeps its signature; `KitUniforms` is structurally a superset of `WorldUniforms` (`uNight`, `uTime`), so the same object is passed to both.

- [ ] **Step 7: OverworldView owns the kit uniforms** — in `overworldView.ts`:
  - replace `private worldUniforms: WorldUniforms = { uNight: { value: 0 }, uTime: { value: 0 } };` with `readonly kitUniforms: KitUniforms = createKitUniforms();` and every `this.worldUniforms` use with `this.kitUniforms`;
  - construct the world with `new World(this.atlas, mats, this.kitUniforms)` and the materials with `createWorldMaterials(this.atlas.target.texture, this.kitUniforms)`.

- [ ] **Step 8: Verify and commit**

Run: `npx vitest run tests/kitRun.test.ts` → PASS. `npx tsc --noEmit && npm test` → pass. Golden test → PASS.

```bash
git add src tests/kitRun.test.ts tests/helpers docs/superpowers/progress/modern-3d.md
git commit -m "feat(kit): semantic core with per-family claims, rollback and world integration"
```

---

### Task 6: Terrain family (ground surface + banks)

One continuous ground over walkable cells and under every claimed object, shaded per cell by a procedural material (grass, path, sand, paving, dirt, gravel, rock, deck) and tinted with the cell's own ROM colour; borders between materials are noise-warped so grid-aligned paths look organic. Banks between cells at different heights reuse the legacy connector geometry with a soil look.

**Files:**
- Create: `src/render/kit/terrain.ts`, `tests/kitTerrain.test.ts`
- Modify: `src/render/kit/index.ts`

**Interfaces:**
- Consumes: `MapAnalysis`, `K`, `Claims`/`CLAIM_*`, `dominantColor`, `classifyGroundColor`, `MeshBuilder`, `kitMaterial` (with `uniforms`/`fragHead`/`fragColor`/`hookKey`).
- Produces: `const enum GroundMat { Grass, Path, Sand, Paving, Dirt, Gravel, Rock, Deck, Dark }`, `groundMaterial(beh, colour): GroundMat`, `interface TerrainCell { i; h; mat; tint }`, `interface TerrainPlacement { cells: TerrainCell[] }`, `terrainFamily: Family<TerrainPlacement>`, `cellLook(a, m, cache)` (shared with other families for ground colours).

- [ ] **Step 1: Write the failing test** — `tests/kitTerrain.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { MB } from '../src/game/behaviors';
import { groundMaterial, GroundMat, terrainFamily } from '../src/render/kit/terrain';
import { Claims, CLAIM_OBJECT, CLAIM_SURFACE } from '../src/render/overworld/claims';
import { NO_EVENTS } from '../src/render/kit/events';
import { K } from '../src/render/overworld/analyze';
import { fakeAnalysis } from './helpers/fakeMap';

describe('groundMaterial', () => {
  const grass: [number, number, number] = [0.45, 0.78, 0.65];
  it('behaviour wins over colour', () => {
    expect(groundMaterial(MB.SAND, grass)).toBe(GroundMat.Sand);
    expect(groundMaterial(MB.FORTREE_BRIDGE, grass)).toBe(GroundMat.Deck);
    expect(groundMaterial(MB.ASHGRASS, grass)).toBe(GroundMat.Gravel);
  });
  it('falls back to the colour class', () => {
    expect(groundMaterial(MB.NORMAL, grass)).toBe(GroundMat.Grass);
    expect(groundMaterial(MB.NORMAL, [0.65, 0.84, 0.78])).toBe(GroundMat.Path);
    expect(groundMaterial(MB.NORMAL, [0.81, 0.81, 0.87])).toBe(GroundMat.Paving);
  });
});

describe('terrain extract', () => {
  it('covers walkable cells and the ground under claimed objects', () => {
    const a = fakeAnalysis(['....', '.##.', '....']);
    const claims = new Claims(a.N);
    const objectCell = a.idx(1, 1);
    claims.claim(objectCell, CLAIM_OBJECT);
    claims.groundY[objectCell] = 0.5;
    const p = terrainFamily.extract({ a, events: NO_EVENTS, quality: 'medium' }, claims);
    const covered = new Set(p.cells.map((c) => c.i));
    expect(covered.has(a.idx(0, 0))).toBe(true);
    expect(covered.has(objectCell)).toBe(true);
    expect(p.cells.find((c) => c.i === objectCell)!.h).toBe(0.5);
    // the unclaimed block cell keeps its legacy ground
    expect(covered.has(a.idx(2, 1))).toBe(false);
    expect(a.kind[a.idx(2, 1)]).toBe(K.Block);
    for (const c of p.cells) expect(claims.has(c.i, CLAIM_SURFACE)).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run tests/kitTerrain.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `src/render/kit/terrain.ts`**

```ts
// Ground: one continuous surface over walkable cells and under every claimed object, shaded by
// a procedural material per cell and tinted with the cell's own ROM colour. Material borders
// are noise-warped so the GBA's grid-aligned paths read as organic shapes. Banks between
// heights are the same surface, drawn steep (soil).

import * as THREE from 'three';
import { MB } from '../../game/behaviors';
import { K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_SURFACE, type Claims } from '../overworld/claims';
import { classifyGroundColor, dominantColor, scale, type GroundClass, type RGB } from './palette';
import { MeshBuilder, type V3 } from './geom';
import { kitMaterial } from './materials';
import type { Family, SemanticContext, KitContext } from './semantics';

export const enum GroundMat { Grass = 0, Path = 1, Sand = 2, Paving = 3, Dirt = 4, Gravel = 5, Rock = 6, Deck = 7, Dark = 8 }

const CLASS_MAT: Record<GroundClass, GroundMat> = {
  grass: GroundMat.Grass, path: GroundMat.Path, sand: GroundMat.Sand, paving: GroundMat.Paving,
  dirt: GroundMat.Dirt, gravel: GroundMat.Gravel, rock: GroundMat.Rock, water: GroundMat.Paving, dark: GroundMat.Dark,
};

/** Ground material from the behaviour first, then the tile's dominant colour. */
export function groundMaterial(beh: number, c: RGB): GroundMat {
  switch (beh) {
    case MB.SAND: case MB.DEEP_SAND: case MB.FOOTPRINTS: return GroundMat.Sand;
    case MB.ASHGRASS: return GroundMat.Gravel;
    case MB.MOUNTAIN_TOP: case MB.CAVE: return GroundMat.Rock;
    case MB.TALL_GRASS: case MB.LONG_GRASS: case MB.LONG_GRASS_SOUTH_EDGE: case MB.SHORT_GRASS: return GroundMat.Grass;
    case MB.PUDDLE: return GroundMat.Dirt;
  }
  if (beh >= MB.BRIDGE_OVER_OCEAN && beh <= MB.BIKE_BRIDGE_OVER_BARRIER) return GroundMat.Deck;
  return CLASS_MAT[classifyGroundColor(c)];
}

export interface CellLook { mat: GroundMat; tint: RGB }

/** Material + dominant (sRGB) colour of a metatile's ground layer, cached per metatile. */
export function cellLook(a: MapAnalysis, m: number, cache: Map<number, CellLook>): CellLook {
  let e = cache.get(m);
  if (!e) {
    const c = dominantColor(a.info.bottom, [m]) ?? dominantColor(a.info.both, [m]) ?? [0.45, 0.7, 0.5];
    e = { mat: groundMaterial(a.info.attributes[m] & 0xff, c), tint: c };
    cache.set(m, e);
  }
  return e;
}

export interface TerrainCell { i: number; h: number; mat: GroundMat; tint: RGB }
export interface TerrainPlacement { cells: TerrainCell[] }

const FRAG_HEAD = /* glsl */ `
uniform sampler2D tCells;
uniform vec2 uGridMin;
uniform vec2 uGridSize;
vec3 kitGround(int mat, vec3 tint, vec2 p) {
  float n1 = kitFbm2(p * 1.3);
  float n2 = kitNoise2(p * 9.0);
  vec3 c = tint;
  if (mat == 0) {                 // grass: soft two-tone with fine blade speckle
    c *= 0.84 + 0.3 * n1;
    c = mix(c, c * vec3(1.1, 1.16, 0.92), smoothstep(0.6, 0.9, n2) * 0.6);
    c *= 0.93 + 0.07 * kitNoise2(p * 31.0);
  } else if (mat == 1) {          // path: warmed, pebbly
    c = mix(c, vec3(0.72, 0.6, 0.42), 0.55);
    c *= 0.9 + 0.16 * n1;
    vec2 v = kitVoronoi(p * 5.0);
    c *= 1.0 - 0.16 * (1.0 - smoothstep(0.04, 0.14, v.x)) * step(0.65, v.y);
  } else if (mat == 2) {          // sand: ripples
    c *= 0.95 + 0.05 * sin((p.x * 0.6 + p.y + n1 * 1.5) * 9.0) + 0.06 * (n1 - 0.5);
  } else if (mat == 3) {          // paving: stones and grout
    vec2 v = kitVoronoi(p * 3.0);
    c *= (0.9 + 0.14 * v.y) * mix(0.62, 1.0, smoothstep(0.02, 0.07, v.x));
  } else if (mat == 4) {          // dirt
    c *= 0.82 + 0.3 * n1;
  } else if (mat == 5) {          // gravel / ash
    c *= 0.88 + 0.2 * n1 + 0.06 * n2;
  } else if (mat == 6) {          // rock floor: cracks
    vec2 v = kitVoronoi(p * 2.0);
    c *= (0.85 + 0.2 * n1) * mix(0.7, 1.0, smoothstep(0.01, 0.05, v.x));
  } else if (mat == 7) {          // deck: planks along X
    float fr = fract(p.y * 4.0);
    c *= (0.85 + 0.15 * kitNoise2(vec2(p.x * 1.5, floor(p.y * 4.0) * 7.0)));
    c *= mix(0.6, 1.0, smoothstep(0.0, 0.08, fr) * smoothstep(1.0, 0.92, fr));
  }
  return c;
}
`;

const FRAG_COLOR = /* glsl */ `
{
  vec2 cell = vec2(vKitWorld.x, vKitWorld.z - vKitWorld.y);       // un-project to grid space
  vec2 warp = vec2(kitFbm2(cell * 0.9), kitFbm2(cell * 0.9 + 17.3)) - 0.5;
  vec2 g = cell + warp * 0.55;
  ivec2 ic = clamp(ivec2(floor(g - uGridMin)), ivec2(0), ivec2(uGridSize) - 1);
  int mat = int(texelFetch(tCells, ic, 0).a * 255.0 + 0.5) >> 4;
  vec3 tint = kitSrgbToLinear(texture(tCells, (g - uGridMin) / uGridSize).rgb);
  vec3 col = kitGround(mat, tint, cell);
  vec3 fn = normalize(cross(dFdx(vKitWorld), dFdy(vKitWorld)));
  float steep = 1.0 - smoothstep(0.55, 0.85, abs(fn.y));
  vec3 soil = tint * vec3(0.62, 0.5, 0.4) * (0.85 + 0.3 * kitFbm2(vec2(vKitWorld.x + vKitWorld.z, vKitWorld.y) * 3.0));
  diffuseColor.rgb *= mix(col, soil, steep);
}
`;

export const terrainFamily: Family<TerrainPlacement> = {
  name: 'terrain',

  extract({ a }: SemanticContext, claims: Claims): TerrainPlacement {
    const cells: TerrainCell[] = [];
    const cache = new Map<number, CellLook>();
    for (let i = 0; i < a.N; i++) {
      if (claims.has(i, CLAIM_SURFACE)) continue;
      const k = a.kind[i];
      const walk = k === K.Floor || k === K.Stairs || k === K.Ledge;
      const under = claims.has(i, CLAIM_OBJECT);
      if (!walk && !under) continue;
      let h: number;
      let m: number;
      let shade = 1;
      if (!under) {
        h = a.height[i];
        m = a.mt[i];
      } else {
        h = !Number.isNaN(claims.groundY[i]) ? claims.groundY[i] : walk ? a.height[i] : a.groundH[i];
        m = claims.groundMt[i] >= 0 ? claims.groundMt[i] : a.groundOf[i] >= 0 ? a.groundOf[i] : a.mt[i];
        if (k === K.Tree) shade = 0.72; // canopy shade
      }
      if (Number.isNaN(h)) h = 0;
      const look = cellLook(a, m, cache);
      cells.push({ i, h, mat: look.mat, tint: shade === 1 ? look.tint : scale(look.tint, shade) });
      claims.claim(i, CLAIM_SURFACE);
    }
    return { cells };
  },

  build(p: TerrainPlacement, { a }: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!p.cells.length) return null;
    // Per-cell data: rgb = sRGB tint, a = material << 4. Uncovered texels are dilated from
    // their neighbours so bilinear tint blending never pulls in black.
    const data = new Uint8Array(a.GW * a.GH * 4);
    const has = new Uint8Array(a.N);
    const surfH = new Float32Array(a.N).fill(NaN);
    for (const c of p.cells) {
      data.set([c.tint[0] * 255, c.tint[1] * 255, c.tint[2] * 255, (c.mat << 4) | 8], c.i * 4);
      has[c.i] = 1;
      surfH[c.i] = c.h;
    }
    for (let pass = 0; pass < 3; pass++) {
      const next = has.slice();
      for (let i = 0; i < a.N; i++) {
        if (has[i]) continue;
        const x = a.cellX(i), y = a.cellY(i);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!a.inside(x + dx, y + dy)) continue;
          const j = a.idx(x + dx, y + dy);
          if (!has[j]) continue;
          data.copyWithin(i * 4, j * 4, j * 4 + 4);
          next[i] = 1;
          break;
        }
      }
      has.set(next);
    }
    const tex = new THREE.DataTexture(data, a.GW, a.GH, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.flipY = false;
    tex.needsUpdate = true;
    kit.disposables.push(tex);

    // Water cells count as surfaces for banks (the shore slope belongs to the land).
    for (let i = 0; i < a.N; i++) if (a.kind[i] === K.Water && Number.isNaN(surfH[i])) surfH[i] = a.height[i];
    const covered = new Uint8Array(a.N);
    for (const c of p.cells) covered[c.i] = 1;

    const mb = new MeshBuilder();
    const white: RGB = [1, 1, 1];
    for (const c of p.cells) {
      const x = a.cellX(c.i), y = a.cellY(c.i), h = c.h;
      mb.quad([x, h, y + h], [x + 1, h, y + h], [x + 1, h, y + 1 + h], [x, h, y + 1 + h], [0, 1, 0], white);
    }
    // Banks: same geometry as the legacy connectors, for every S/E pair touching the terrain.
    for (let i = 0; i < a.N; i++) {
      const x = a.cellX(i), y = a.cellY(i);
      const h = surfH[i];
      if (Number.isNaN(h)) continue;
      if (a.inside(x, y + 1)) {
        const j = a.idx(x, y + 1);
        const h2 = surfH[j];
        if ((covered[i] || covered[j]) && !Number.isNaN(h2) && Math.abs(h - h2) > 0.01) {
          const hi = Math.max(h, h2), lo = Math.min(h, h2);
          const n: V3 = h > h2 ? [0, 0, 1] : [0, 0.7, -0.7];
          mb.quad([x, hi, y + 1 + hi], [x + 1, hi, y + 1 + hi], [x + 1, lo, y + 1 + lo], [x, lo, y + 1 + lo], n, white);
        }
      }
      if (a.inside(x + 1, y)) {
        const j = a.idx(x + 1, y);
        const h2 = surfH[j];
        if ((covered[i] || covered[j]) && !Number.isNaN(h2) && Math.abs(h - h2) > 0.01) {
          const hi = Math.max(h, h2), lo = Math.min(h, h2);
          const px = x + 1;
          mb.quad([px, hi, y + hi], [px, hi, y + 1 + hi], [px, lo, y + 1 + lo], [px, lo, y + lo], [h > h2 ? 1 : -1, 0, 0], white);
        }
      }
    }
    const km = kitMaterial(kit.uniforms, {
      roughness: 0.95,
      uniforms: {
        tCells: { value: tex },
        uGridMin: { value: new THREE.Vector2(a.minX, a.minY) },
        uGridSize: { value: new THREE.Vector2(a.GW, a.GH) },
      },
      fragHead: FRAG_HEAD,
      fragColor: FRAG_COLOR,
      hookKey: 'terrain',
    });
    const mesh = new THREE.Mesh(mb.build(), km.material);
    mesh.receiveShadow = true;
    return mesh;
  },
};
```

- [ ] **Step 4: Register the family** — `src/render/kit/index.ts`:

```ts
import type { Family } from './semantics';
import { terrainFamily } from './terrain';

export const FAMILIES: readonly Family<unknown>[] = [
  terrainFamily,
];
```

(Later tasks insert their families **before** `terrainFamily`.)

- [ ] **Step 5: Run tests** — `npx vitest run tests/kitTerrain.test.ts` → PASS; `npx tsc --noEmit && npm test` → pass; golden → PASS (Retro path unchanged).

- [ ] **Step 6: Visual check**

Run: `npx tsx tools/regress.ts --label t6`
Review `out/regress/t6/_sheet_h11.png` and `_sheet_h21.png` against `before`. Acceptance:
- ground is continuous (no holes, cracks or sky showing along shores and terraces);
- paths read as warm light paths with soft, irregular edges; grass is two-tone; Slateport/Lilycove paving shows stones; Route 113 is grey-beige gravel; sandy beaches are sand;
- no z-fighting stripes where legacy objects meet the terrain;
- `house` and `granite` look exactly like `before` (indoor/cave unaffected);
- night shots are evenly dark (no unlit ground).
If a criterion fails, fix the cause in `terrain.ts` (material thresholds belong in `palette.ts`; add a failing unit test first for any classification change) and re-run.

- [ ] **Step 7: Commit**

```bash
git add src/render/kit tests/kitTerrain.test.ts docs/superpowers/progress/modern-3d.md
git commit -m "feat(kit): procedural terrain with per-cell materials, organic borders and banks"
```

---

### Task 7: Water family (surface, shore foam, seabed, waterfalls)

**Files:**
- Create: `src/render/kit/water.ts`, `tests/kitWater.test.ts`
- Modify: `src/render/kit/index.ts`, `src/render/overworld/overworldView.ts` (sky colour → `uSky`)

**Interfaces:**
- Produces: `interface WaterCell { i: number; level: number; fall: boolean }`, `interface WaterPlacement { cells: WaterCell[]; dist: Uint8Array; tint: RGB }`, `shoreDistance(a): Uint8Array` (0 = land, 1 = water touching land, … capped 15), `waterFamily: Family<WaterPlacement>`.

- [ ] **Step 1: Write the failing test** — `tests/kitWater.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { shoreDistance } from '../src/render/kit/water';
import { analyze } from '../src/render/overworld/analyze';
import { fakeInfo } from './helpers/fakeMap';
import { MB } from '../src/game/behaviors';

describe('shoreDistance', () => {
  it('counts water cells away from land', () => {
    const info = fakeInfo();
    info.attributes[3] = MB.OCEAN_WATER; // metatile 3 = water
    const rows = ['.wwww', '.wwww', '.wwww'];
    const w = 5, h = 3;
    const cells = new Uint16Array(w * h);
    rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = ch === 'w' ? 3 | 0x1000 : 1 | 0x3000; }));
    const a = analyze({ width: w, height: h, cells, border: [3, 3, 3, 3], borderW: 2, borderH: 2, borderPhase: 0 },
      { info, generalPrimary: false, indoor: false, underground: false, margin: 0 });
    const d = shoreDistance(a);
    expect(d[a.idx(0, 1)]).toBe(0);
    expect(d[a.idx(1, 1)]).toBe(1);
    expect(d[a.idx(2, 1)]).toBe(2);
    expect(d[a.idx(4, 1)]).toBe(4);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run tests/kitWater.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/render/kit/water.ts`**

```ts
// Water: a glossy surface per water cell at its level, tinted from the ROM water colour and
// darkening with distance from shore; animated foam along shores, layered moving normals,
// fresnel sky reflection, a sandy seabed visible in the shallows, streaks on waterfalls.

import * as THREE from 'three';
import { MB } from '../../game/behaviors';
import { K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_SURFACE, type Claims } from '../overworld/claims';
import { dominantColor, toLinear, type RGB } from './palette';
import { MeshBuilder } from './geom';
import { kitMaterial } from './materials';
import type { Family, KitContext, SemanticContext } from './semantics';

export interface WaterCell { i: number; level: number; fall: boolean }
export interface WaterPlacement { cells: WaterCell[]; dist: Uint8Array; tint: RGB }

/** Multi-source BFS from land: 0 on land, 1 for water touching land, … capped at 15. */
export function shoreDistance(a: MapAnalysis): Uint8Array {
  const dist = new Uint8Array(a.N).fill(255);
  const queue = new Int32Array(a.N);
  let head = 0, tail = 0;
  for (let i = 0; i < a.N; i++) if (a.kind[i] !== K.Water) { dist[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const c = queue[head++];
    const x = a.cellX(c), y = a.cellY(c);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!a.inside(x + dx, y + dy)) continue;
      const j = a.idx(x + dx, y + dy);
      if (dist[j] !== 255) continue;
      dist[j] = Math.min(15, dist[c] + 1);
      queue[tail++] = j;
    }
  }
  for (let i = 0; i < a.N; i++) if (dist[i] === 255) dist[i] = 15; // all-water maps
  return dist;
}

const FRAG_HEAD = /* glsl */ `
uniform sampler2D tWater;
uniform vec2 uGridMin;
uniform vec2 uGridSize;
uniform vec3 uTint;
`;

const FRAG_COLOR = /* glsl */ `
float kitFoam = 0.0;
{
  vec2 cell = vec2(vKitWorld.x, vKitWorld.z - vKitWorld.y);
  vec4 wd = texture(tWater, (cell - uGridMin) / uGridSize);
  float dist = wd.r * 15.0;
  float deep = smoothstep(0.8, 4.5, dist);
  vec3 tint = kitSrgbToLinear(uTint);
  vec3 col = mix(mix(tint, vec3(0.35, 0.75, 0.72), 0.45), tint * vec3(0.45, 0.6, 0.85), deep);
  float band = 1.0 - smoothstep(0.0, 1.05 + 0.25 * sin(uTime * 1.3 + cell.x * 0.8 + cell.y * 0.6), dist);
  float fnoise = kitNoise2(cell * 3.0 + vec2(uTime * 0.3, -uTime * 0.2));
  kitFoam = smoothstep(0.35, 0.75, band * (0.55 + 0.6 * fnoise));
  float streak = smoothstep(0.55, 0.9, kitNoise2(vec2(cell.x * 6.0, cell.y * 1.5 - uTime * 3.0)));
  kitFoam = max(kitFoam, wd.g * streak * 0.8);
  diffuseColor.rgb = mix(col, vec3(0.92, 0.96, 1.0), kitFoam);
  diffuseColor.a = max(mix(0.72, 0.95, deep), kitFoam);
}
`;

const FRAG_NORMAL = /* glsl */ `
{
  vec2 q = vec2(vKitWorld.x, vKitWorld.z - vKitWorld.y) * 2.2;
  vec2 o1 = vec2(uTime * 0.25, uTime * 0.18), o2 = vec2(-uTime * 0.2, uTime * 0.31);
  float e = 0.06;
  float h0 = kitNoise2(q + o1) + 0.5 * kitNoise2(q * 2.3 + o2);
  float hx = kitNoise2(q + vec2(e, 0.0) + o1) + 0.5 * kitNoise2((q + vec2(e, 0.0)) * 2.3 + o2);
  float hz = kitNoise2(q + vec2(0.0, e) + o1) + 0.5 * kitNoise2((q + vec2(0.0, e)) * 2.3 + o2);
  vec3 nW = normalize(vec3(-(hx - h0) / e * 0.12, 1.0, -(hz - h0) / e * 0.12));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}
`;

const FRAG_EMISSIVE = /* glsl */ `
{
  float fres = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 4.0);
  totalEmissiveRadiance += uSky * fres * 0.5 * (1.0 - kitFoam);
}
`;

const VERT_SWELL = /* glsl */ `
{
  vec3 wq = (modelMatrix * vec4(transformed, 1.0)).xyz;
  transformed.y += sin(wq.x * 1.3 + uTime * 1.6) * 0.025 + cos(wq.z * 1.1 + uTime * 1.2) * 0.025;
}
`;

export const waterFamily: Family<WaterPlacement> = {
  name: 'water',

  extract({ a }: SemanticContext, claims: Claims): WaterPlacement {
    const cells: WaterCell[] = [];
    const counts = new Map<number, number>();
    for (let i = 0; i < a.N; i++) {
      if (a.kind[i] !== K.Water || claims.has(i, CLAIM_SURFACE)) continue;
      cells.push({ i, level: a.height[i], fall: a.beh[i] === MB.WATERFALL });
      counts.set(a.mt[i], (counts.get(a.mt[i]) ?? 0) + 1);
      claims.claim(i, CLAIM_SURFACE);
    }
    let common = -1, best = 0;
    for (const [m, n] of counts) if (n > best) { best = n; common = m; }
    const tint = (common >= 0 ? dominantColor(a.info.bottom, [common]) : null) ?? [0.32, 0.42, 0.84];
    return { cells, dist: cells.length ? shoreDistance(a) : new Uint8Array(0), tint };
  },

  build(p: WaterPlacement, { a }: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!p.cells.length) return null;
    const data = new Uint8Array(a.N * 4);
    for (let i = 0; i < a.N; i++) data[i * 4] = Math.round((p.dist[i] / 15) * 255);
    for (const c of p.cells) if (c.fall) data[c.i * 4 + 1] = 255;
    const tex = new THREE.DataTexture(data, a.GW, a.GH, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.flipY = false;
    tex.needsUpdate = true;
    kit.disposables.push(tex);

    const surface = new MeshBuilder();
    const bed = new MeshBuilder();
    const sand = toLinear([0.84, 0.78, 0.58]);
    for (const c of p.cells) {
      const x = a.cellX(c.i), y = a.cellY(c.i), h = c.level;
      surface.quad([x, h, y + h], [x + 1, h, y + h], [x + 1, h, y + 1 + h], [x, h, y + 1 + h], [0, 1, 0], [1, 1, 1]);
      if (p.dist[c.i] <= 2) {
        const b = h - 0.25;
        bed.quad([x, b, y + h], [x + 1, b, y + h], [x + 1, b, y + 1 + h], [x, b, y + 1 + h], [0, 1, 0], sand);
      }
    }
    const group = new THREE.Group();
    const km = kitMaterial(kit.uniforms, {
      roughness: 0.12,
      transparent: true,
      uniforms: {
        tWater: { value: tex },
        uGridMin: { value: new THREE.Vector2(a.minX, a.minY) },
        uGridSize: { value: new THREE.Vector2(a.GW, a.GH) },
        uTint: { value: new THREE.Vector3(...p.tint) },
      },
      fragHead: FRAG_HEAD,
      fragColor: FRAG_COLOR,
      fragNormal: FRAG_NORMAL,
      fragEmissive: FRAG_EMISSIVE,
      vertTransform: VERT_SWELL,
      hookKey: 'water',
    });
    const water = new THREE.Mesh(surface.build(), km.material);
    water.receiveShadow = true;
    water.renderOrder = 1;
    group.add(water);
    if (!bed.empty) {
      const bedMesh = new THREE.Mesh(bed.build(), kitMaterial(kit.uniforms, { vertexColors: true, roughness: 1 }).material);
      bedMesh.receiveShadow = true;
      group.add(bedMesh);
    }
    return group;
  },
};
```

Note: the water vertex swell needs `uTime` in the vertex shader — it is declared in the kit vertex prelude.

- [ ] **Step 4: Register** — in `index.ts` import `waterFamily` and put it before `terrainFamily`: `[waterFamily, terrainFamily]`.

- [ ] **Step 5: Sky colour for reflections** — in `overworldView.ts` `updateLighting()`, after `this.hemi.color.copy(skyColor);` add `this.kitUniforms.uSky.value.copy(skyColor).multiplyScalar(hemiI * 0.6);`

- [ ] **Step 6: Run tests** — `npx vitest run tests/kitWater.test.ts` → PASS; `npx tsc --noEmit && npm test` → pass.

- [ ] **Step 7: Visual check** — `npx tsx tools/regress.ts --label t7 --only slateport,lilycove,route110,sootopolis,mossdeep,route119`. Acceptance: water reads as glossy water (moving highlights, lighter turquoise near shore, darker offshore), a foam line follows every shore, beach shallows show a sandy bed, no grid-aligned seams in the water, night water is dark with a faint sky sheen, waterfalls on Route 119 show moving white streaks.

- [ ] **Step 8: Commit**

```bash
git add src/render/kit src/render/overworld/overworldView.ts tests/kitWater.test.ts docs/superpowers/progress/modern-3d.md
git commit -m "feat(kit): water surface with shore foam, seabed, fresnel sky and waterfalls"
```

---

### Task 8: Cliffs and ledges

Rock walls replace the cliff faces between levels and rocky block runs; a grass lip tops them; ledges become small rounded grassy drops.

**Files:**
- Create: `src/render/kit/cliffs.ts`, `tests/kitCliffs.test.ts`
- Modify: `src/render/kit/index.ts`

**Interfaces:**
- Consumes: `cellLook` (Task 6), `noise3`, `MeshBuilder`, `kitMaterial`.
- Produces: `interface CliffRun { x; zf; hB; topH; tint: RGB; lip: RGB | null }`, `interface SidePanel { px; dir; zb; zt; y0; y1; tint: RGB }`, `interface LedgeLip { x; y; h; dir: 'S' | 'N' | 'E' | 'W'; grass: RGB }`, `interface CliffPlacement { runs; sides; ledges }`, `isRocky(a, m): boolean`, `cliffFamily: Family<CliffPlacement>`, `export let rockIds: (m: number) => boolean` hook (default `() => false`; Task 14 sets it from the General table).

- [ ] **Step 1: Write the failing test** — `tests/kitCliffs.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { cliffFamily } from '../src/render/kit/cliffs';
import { Claims, CLAIM_OBJECT, CLAIM_SURFACE } from '../src/render/overworld/claims';
import { NO_EVENTS } from '../src/render/kit/events';
import { analyze } from '../src/render/overworld/analyze';
import { fakeInfo } from './helpers/fakeMap';

// A plateau (rows 0-1) above a two-row rock face (rows 2-3) above lowland (rows 4-5).
function plateau() {
  const info = fakeInfo();
  // metatile 2 (face) = brown rock pixels
  info.both.fill((10 << 10) | (14 << 5) | 22, 2 * 256, 3 * 256);
  const rows = ['....', '....', '####', '####', '....', '....'];
  const w = 4, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = ch === '#' ? 2 | 0x0400 : 1 | 0x3000; }));
  return analyze({ width: w, height: h, cells, border: [1, 1, 1, 1], borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary: false, indoor: false, underground: false, margin: 0 });
}

describe('cliff extract', () => {
  it('turns a rock face between two levels into cliff runs', () => {
    const a = plateau();
    const claims = new Claims(a.N);
    const p = cliffFamily.extract({ a, events: NO_EVENTS, quality: 'medium' }, claims);
    expect(p.runs).toHaveLength(4);
    expect(p.runs[0].topH).toBeGreaterThan(p.runs[0].hB);
    for (let x = 0; x < 4; x++) {
      expect(claims.has(a.idx(x, 2), CLAIM_OBJECT)).toBe(true);
      expect(claims.has(a.idx(x, 3), CLAIM_SURFACE)).toBe(true);
    }
  });
});
```

(If the height solver gives the plateau the same height as the lowland for this tiny map, the face is still rocky with L = 2, so a run is produced either way.)

- [ ] **Step 2: Run** — `npx vitest run tests/kitCliffs.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/render/kit/cliffs.ts`**

```ts
// Cliffs: displaced, strata-banded rock walls where the analysis found a face between two
// levels (or a rocky block mass), with a grass lip on top and rock side panels; ledges become
// small rounded grassy drops along their jump edge.

import * as THREE from 'three';
import { MB } from '../../game/behaviors';
import { K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_SURFACE, type Claims } from '../overworld/claims';
import { classifyGroundColor, dominantColor, luma, mix, scale, soften, toLinear, type RGB } from './palette';
import { MeshBuilder, noise3, type V3 } from './geom';
import { kitMaterial } from './materials';
import { cellLook, GroundMat, type CellLook } from './terrain';
import type { Family, KitContext, SemanticContext } from './semantics';

export interface CliffRun { x: number; zf: number; hB: number; topH: number; tint: RGB; lip: RGB | null }
export interface SidePanel { px: number; dir: number; zb: number; zt: number; y0: number; y1: number; tint: RGB }
export interface LedgeLip { x: number; y: number; h: number; dir: 'S' | 'N' | 'E' | 'W'; grass: RGB }
export interface CliffPlacement { runs: CliffRun[]; sides: SidePanel[]; ledges: LedgeLip[] }

/** Curated rock ids (set by the General table, Task 14). */
export let rockIds: (m: number) => boolean = () => false;
export function setRockIds(f: (m: number) => boolean): void { rockIds = f; }

/** Rock-looking metatile: brown/grey/beige, little foliage, not water. */
export function isRocky(a: MapAnalysis, m: number): boolean {
  if (a.isGeneralId(m) && rockIds(m)) return true;
  const c = dominantColor(a.info.both, [m], (k) => luma(k) > 0.15);
  if (!c) return false;
  const cls = classifyGroundColor(c);
  return (cls === 'dirt' || cls === 'rock' || cls === 'gravel') && a.info.green[m] < 0.35;
}

const LEDGE_DIR: Record<number, LedgeLip['dir']> = {
  [MB.JUMP_SOUTH]: 'S', [MB.JUMP_SOUTHEAST]: 'S', [MB.JUMP_SOUTHWEST]: 'S',
  [MB.JUMP_NORTH]: 'N', [MB.JUMP_NORTHEAST]: 'N', [MB.JUMP_NORTHWEST]: 'N',
  [MB.JUMP_EAST]: 'E', [MB.JUMP_WEST]: 'W',
};

export const cliffFamily: Family<CliffPlacement> = {
  name: 'cliffs',

  extract({ a }: SemanticContext, claims: Claims): CliffPlacement {
    const out: CliffPlacement = { runs: [], sides: [], ledges: [] };
    if (a.opts.indoor || a.opts.underground) return out;
    const { idx, inside, kind, height } = a;
    const looks = new Map<number, CellLook>();
    const isBlock = (i: number) => kind[i] === K.Block && !claims.has(i, CLAIM_OBJECT);
    const walk = (i: number) => i >= 0 && (kind[i] === K.Floor || kind[i] === K.Stairs || kind[i] === K.Water || kind[i] === K.Ledge);
    for (let x = a.minX; x < a.maxX; x++) {
      let y = a.minY;
      while (y < a.maxY) {
        if (!isBlock(idx(x, y))) { y++; continue; }
        let e = y;
        while (e + 1 < a.maxY && isBlock(idx(x, e + 1))) e++;
        const L = e - y + 1;
        const bi = e + 1 < a.maxY ? idx(x, e + 1) : -1;
        const ai = y > a.minY ? idx(x, y - 1) : -1;
        const hB = walk(bi) ? Math.max(height[bi], 0) : NaN;
        const hA = walk(ai) ? Math.max(height[ai], 0) : NaN;
        const faceRows: number[] = [];
        for (let r = y; r <= e; r++) faceRows.push(a.mt[idx(x, r)]);
        const rocky = faceRows.filter((m) => isRocky(a, m)).length * 2 >= faceRows.length;
        const level = !Number.isNaN(hA) && !Number.isNaN(hB) && hA > hB + 0.01;
        let F = 0;
        if (!Number.isNaN(hB) && rocky && level) F = Math.min(L, Math.max(1, Math.round(hA - hB)));
        else if (!Number.isNaN(hB) && rocky && L >= 2) F = Math.min(L, Math.max(1, Math.min(3, Math.round(L / 2))));
        if (F === 0) { y = e + 1; continue; }
        const topH = hB + F;
        const zf = e + 1 + hB;
        const faceTint = dominantColor(a.info.both, faceRows.slice(-F), (k) => luma(k) > 0.2) ?? [0.6, 0.5, 0.4];
        // top rows: ground at the plateau height with the look of their own tiles
        let lip: RGB | null = null;
        for (let r = y; r <= e - F; r++) {
          const i = idx(x, r);
          claims.claim(i, CLAIM_OBJECT);
          claims.groundY[i] = topH;
          claims.groundMt[i] = a.mt[i];
        }
        const topLook = cellLook(a, a.mt[idx(x, Math.max(y, e - F))], looks);
        if (topLook.mat === GroundMat.Grass) lip = topLook.tint;
        else if (!Number.isNaN(hA)) {
          const above = cellLook(a, a.mt[ai], looks);
          if (above.mat === GroundMat.Grass) lip = above.tint;
        }
        for (let r = e - F + 1; r <= e; r++) {
          const i = idx(x, r);
          claims.claim(i, CLAIM_OBJECT | CLAIM_SURFACE);
        }
        out.runs.push({ x, zf, hB, topH, tint: soften(faceTint), lip });
        // side panels where a top row's west/east neighbour is lower ground
        for (let r = y; r <= e - F; r++) {
          for (const dir of [-1, 1]) {
            const nx = x + dir;
            if (!inside(nx, r)) continue;
            const ni = idx(nx, r);
            if (kind[ni] !== K.Floor && kind[ni] !== K.Water && kind[ni] !== K.Ledge && kind[ni] !== K.Stairs) continue;
            const nh = Number.isNaN(height[ni]) ? hB : Math.max(0, height[ni]);
            if (nh >= topH - 0.01) continue;
            out.sides.push({ px: dir > 0 ? x + 1 : x, dir, zb: r + 1 + topH, zt: r + topH, y0: nh, y1: topH, tint: soften(faceTint) });
          }
        }
        y = e + 1;
      }
    }
    for (let i = 0; i < a.N; i++) {
      if (kind[i] !== K.Ledge) continue;
      const dir = LEDGE_DIR[a.beh[i]];
      if (!dir) continue;
      const look = cellLook(a, a.groundOf[i] >= 0 ? a.groundOf[i] : a.mt[i], looks);
      out.ledges.push({ x: a.cellX(i), y: a.cellY(i), h: Math.max(0, height[i]), dir, grass: look.tint });
    }
    return out;
  },

  build(p: CliffPlacement, _ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!p.runs.length && !p.ledges.length && !p.sides.length) return null;
    const mb = new MeshBuilder();
    const strata = (X: number, Y: number) => 0.84 + 0.16 * Math.sin(Y * 7 + noise3(X * 0.8, Y * 0.8, 9) * 2);
    const disp = (X: number, Y: number) => 0.13 * noise3(X * 1.7, Y * 1.7, 0.5) + 0.05 * noise3(X * 5, Y * 5, 3.1);
    for (const r of p.runs) {
      const tint = toLinear(r.tint);
      const H = r.topH - r.hB;
      const nx = 4, ny = Math.max(2, Math.round(H * 4));
      const P = (u: number, v: number): V3 => {
        const X = r.x + u / nx, Y = r.hB + (v / ny) * H;
        const edge = v === ny ? 0.4 : 1; // keep the top edge close to the plateau lip
        return [X, Y, r.zf + disp(X, Y) * edge];
      };
      for (let v = 0; v < ny; v++) {
        for (let u = 0; u < nx; u++) {
          const a = P(u, v + 1), b = P(u + 1, v + 1), c = P(u + 1, v), d = P(u, v);
          const cx = r.x + (u + 0.5) / nx, cy = r.hB + ((v + 0.5) / ny) * H;
          const ao = 0.7 + 0.3 * Math.min(1, (cy - r.hB) / 0.7);
          mb.quad(a, b, c, d, [0, 0, 1], scale(tint, strata(cx, cy) * ao));
        }
      }
      if (r.lip) {
        const g = new THREE.BoxGeometry(1.04, 0.1, 0.24);
        mb.add(g, toLinear(r.lip), new THREE.Matrix4().makeTranslation(r.x + 0.5, r.topH + 0.02, r.zf - 0.09));
        g.dispose();
      }
    }
    for (const s of p.sides) {
      const tint = toLinear(s.tint);
      const ny = Math.max(1, Math.round((s.y1 - s.y0) * 3));
      for (let v = 0; v < ny; v++) {
        const y0 = s.y0 + ((s.y1 - s.y0) * v) / ny, y1 = s.y0 + ((s.y1 - s.y0) * (v + 1)) / ny;
        mb.quad([s.px, y1, s.zt], [s.px, y1, s.zb], [s.px, y0, s.zb], [s.px, y0, s.zt], [s.dir, 0, 0], scale(tint, strata(s.px, (y0 + y1) / 2)));
      }
    }
    // Ledge profile (along the jump edge): distance back from the edge, height above the cell.
    const PROFILE: [number, number][] = [[-0.5, 0], [-0.32, 0.16], [-0.12, 0.2], [0, 0.12], [0.04, 0]];
    for (const l of p.ledges) {
      const grass = toLinear(l.grass);
      const soil = toLinear(mix(l.grass, [0.55, 0.42, 0.3], 0.6));
      for (let k = 0; k + 1 < PROFILE.length; k++) {
        const [d0, y0] = PROFILE[k], [d1, y1] = PROFILE[k + 1];
        const col = k < 2 ? grass : soil;
        const h = l.h;
        if (l.dir === 'S' || l.dir === 'N') {
          const sgn = l.dir === 'S' ? 1 : -1;
          const z0 = (l.dir === 'S' ? l.y + 1 : l.y) + h;
          const za = z0 + sgn * d0, zb = z0 + sgn * d1;
          mb.quad([l.x, h + y0, za], [l.x + 1, h + y0, za], [l.x + 1, h + y1, zb], [l.x, h + y1, zb], [0, 1, sgn * 0.6], col);
        } else {
          const sgn = l.dir === 'E' ? 1 : -1;
          const x0 = l.dir === 'E' ? l.x + 1 : l.x;
          const xa = x0 + sgn * d0, xb = x0 + sgn * d1;
          const z = l.y + h;
          mb.quad([xa, h + y0, z], [xa, h + y0, z + 1], [xb, h + y1, z + 1], [xb, h + y1, z], [sgn * 0.6, 1, 0], col);
        }
      }
    }
    const km = kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.95, flatShading: true });
    const mesh = new THREE.Mesh(mb.build(), km.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  },
};
```

- [ ] **Step 4: Register** — `index.ts`: `[cliffFamily, waterFamily, terrainFamily]`.

- [ ] **Step 5: Run tests** — `npx vitest run tests/kitCliffs.test.ts` → PASS; `npx tsc --noEmit && npm test` → pass.

- [ ] **Step 6: Visual check** — `npx tsx tools/regress.ts --label t8 --only rustboro,route113,route119,mauville,fortree,mossdeep,sootopolis`. Acceptance: cliff faces are faceted rock with horizontal strata and darker bases, plateau tops meet the wall top without a gap, a grass lip runs along grassy cliff tops, rock side panels close every plateau end, ledges are small rounded grassy drops facing their jump direction, no tree/fence/building is mistaken for rock (if one is, tighten `isRocky` with a unit test). Then orbit check: `npx tsx tools/shot3d.ts --query "map=0.3&hour=11&yaw=0.9" --name t8_orbit` → walls have volume, no paper-thin gaps.

- [ ] **Step 7: Commit**

```bash
git add src/render/kit tests/kitCliffs.test.ts docs/superpowers/progress/modern-3d.md
git commit -m "feat(kit): rock cliffs with strata and grass lips, rounded ledges"
```

---

### Task 9: Trees

Instanced 3D trees replace the tree cards: big round broadleaf trees (the GBA's 2×2 trees), bushy small trees (1-wide), pines (curated ids, Task 14) and palms (trees standing on sand). Colours come from the tree tiles; crowns sway in the wind and dither out when they hide the player.

**Files:**
- Create: `src/render/kit/trees.ts`, `tests/kitTrees.test.ts`
- Modify: `src/render/kit/index.ts`

**Interfaces:**
- Produces: `type TreeStyle = 'round' | 'bushy' | 'pine' | 'palm'`, `interface TreePlacement { x; y; z; style; leaf: RGB; trunk: RGB; seed: number }`, `pairRoundTrees(cands): { x: number; k: number; base: number; big: boolean }[]`, `treeFamily: Family<TreePlacement[]>`, `setPineIds(f)` hook (Task 14).

- [ ] **Step 1: Write the failing test** — `tests/kitTrees.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { pairRoundTrees } from '../src/render/kit/trees';

describe('pairRoundTrees', () => {
  it('pairs side-by-side round-tree columns into one big tree', () => {
    const out = pairRoundTrees([
      { x: 4, k: 10, base: 0 }, { x: 5, k: 10, base: 0 }, // one 2-wide tree
      { x: 8, k: 10, base: 0 },                          // lonely column
    ]);
    expect(out).toEqual([
      { x: 5, k: 10, base: 0, big: true },
      { x: 8.5, k: 10, base: 0, big: false },
    ]);
  });
  it('pairs greedily left to right in long rows', () => {
    const out = pairRoundTrees([0, 1, 2, 3].map((x) => ({ x, k: 3, base: 1 })));
    expect(out.map((t) => t.x)).toEqual([1, 3]);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run tests/kitTrees.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/render/kit/trees.ts`**

```ts
// Trees: instanced stylised trees placed where the analysis found tree runs. Crowns are
// clusters of noise-displaced blobs with a light-top / dark-under gradient (grey vertex
// colours × the ROM leaf colour per instance); trunks are tapered with a root flare.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { K } from '../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_TOP, type Claims } from '../overworld/claims';
import { dominantColor, luma, soften, toLinear, type RGB } from './palette';
import { hashCell, noise3, rng } from './geom';
import { applyKitMaterial, kitMaterial } from './materials';
import { cellLook, GroundMat, type CellLook } from './terrain';
import type { Family, KitContext, SemanticContext } from './semantics';

export type TreeStyle = 'round' | 'bushy' | 'pine' | 'palm';
export interface TreePlacement { x: number; y: number; z: number; style: TreeStyle; leaf: RGB; trunk: RGB; seed: number }

let pineIds: (m: number) => boolean = () => false;
export function setPineIds(f: (m: number) => boolean): void { pineIds = f; }

/** Joins neighbouring round-tree trunk columns (same trunk row) into 2-wide trees. */
export function pairRoundTrees(cands: { x: number; k: number; base: number }[]) {
  const key = (x: number, k: number) => `${x},${k}`;
  const byKey = new Map(cands.map((c) => [key(c.x, c.k), c]));
  const used = new Set<string>();
  const out: { x: number; k: number; base: number; big: boolean }[] = [];
  for (const c of [...cands].sort((p, q) => p.k - q.k || p.x - q.x)) {
    if (used.has(key(c.x, c.k))) continue;
    used.add(key(c.x, c.k));
    const right = byKey.get(key(c.x + 1, c.k));
    if (right && !used.has(key(right.x, right.k))) {
      used.add(key(right.x, right.k));
      out.push({ x: c.x + 1, k: c.k, base: c.base, big: true });
    } else {
      out.push({ x: c.x + 0.5, k: c.k, base: c.base, big: false });
    }
  }
  return out;
}

const VARIANTS = 3;

interface TreeGeo { crown: THREE.BufferGeometry; trunk: THREE.BufferGeometry; doubleSided: boolean }
const geoCache = new Map<string, TreeGeo>();

function gradient(g: THREE.BufferGeometry, y0: number, y1: number): void {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.smoothstep(p.getY(i), y0, y1);
    const k = (0.55 + 0.5 * t) * (0.8 + 0.2 * Math.max(0, n.getY(i)));
    col.set([k, k, k], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function blobCrown(seed: number, count: number, spread: number, rMin: number, rMax: number, y: number, yJit: number, detail: number): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + r() * 0.6;
    const d = i === 0 ? 0 : spread * (0.6 + r() * 0.4);
    const s = i === 0 ? rMax : rMin + r() * (rMax - rMin);
    const g = new THREE.IcosahedronGeometry(s, detail);
    g.translate(Math.cos(a) * d, y + (i === 0 ? yJit * 0.6 : r() * yJit), Math.sin(a) * d);
    parts.push(g);
  }
  let g = mergeGeometries(parts)!;
  parts.forEach((q) => q.dispose());
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g, 1e-4);
  const pos = g.getAttribute('position');
  const v = new THREE.Vector3();
  const c = new THREE.Vector3(0, y + yJit * 0.5, 0);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const dir = v.clone().sub(c).normalize();
    v.addScaledVector(dir, noise3(v.x * 2.4 + seed % 97, v.y * 2.4, v.z * 2.4) * 0.09 * rMax * 2);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  gradient(g, y - rMax, y + yJit + rMax);
  return g;
}

function trunkGeo(rTop: number, rBot: number, h: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 7, 2);
  g.translate(0, h / 2, 0);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.01) { p.setX(i, p.getX(i) * 1.35); p.setZ(i, p.getZ(i) * 1.35); }
  g.computeVertexNormals();
  return g;
}

function pineCrown(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.ConeGeometry(0.62 - i * 0.15 + r() * 0.05, 0.95, 9, 1);
    g.translate(0, 0.85 + i * 0.5, 0);
    parts.push(g);
  }
  const g = mergeGeometries(parts)!;
  parts.forEach((q) => q.dispose());
  g.computeVertexNormals();
  gradient(g, 0.4, 2.3);
  return g;
}

function palmGeo(seed: number): TreeGeo {
  const r = rng(seed);
  const lean = 0.25 + r() * 0.2;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * 0.4, 1.0, 0), new THREE.Vector3(lean, 2.0, 0),
  ]);
  const trunk = new THREE.TubeGeometry(curve, 8, 0.07, 6, false);
  const fronds: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const f = new THREE.PlaneGeometry(1.05, 0.26, 5, 1);
    f.translate(0.52, 0, 0);
    const p = f.getAttribute('position');
    for (let k = 0; k < p.count; k++) p.setY(k, p.getY(k) - 0.35 * p.getX(k) * p.getX(k));
    f.rotateX(-Math.PI / 2);
    f.rotateZ(0.25);
    f.rotateY((i / 7) * Math.PI * 2 + r() * 0.3);
    f.translate(lean, 2.0, 0);
    fronds.push(f);
  }
  const crown = mergeGeometries(fronds)!;
  fronds.forEach((q) => q.dispose());
  crown.computeVertexNormals();
  gradient(crown, 1.4, 2.1);
  return { crown, trunk, doubleSided: true };
}

function treeGeo(style: TreeStyle, variant: number, detail: number): TreeGeo {
  const id = `${style}:${variant}:${detail}`;
  let t = geoCache.get(id);
  if (!t) {
    const seed = 1000 + variant * 77;
    if (style === 'round') t = { crown: blobCrown(seed, 8, 0.55, 0.42, 0.62, 1.6, 0.5, detail), trunk: trunkGeo(0.11, 0.16, 1.4), doubleSided: false };
    else if (style === 'bushy') t = { crown: blobCrown(seed, 5, 0.26, 0.26, 0.38, 1.05, 0.3, detail), trunk: trunkGeo(0.07, 0.1, 0.8), doubleSided: false };
    else if (style === 'pine') t = { crown: pineCrown(seed), trunk: trunkGeo(0.07, 0.1, 0.7), doubleSided: false };
    else t = palmGeo(seed);
    t.crown.userData.shared = true;
    t.trunk.userData.shared = true;
    geoCache.set(id, t);
  }
  return t;
}

export const treeFamily: Family<TreePlacement[]> = {
  name: 'trees',

  extract({ a }: SemanticContext, claims: Claims): TreePlacement[] {
    if (a.opts.indoor || a.opts.underground) return [];
    const { idx, kind, height } = a;
    const isTree = (i: number) => kind[i] === K.Tree && !claims.has(i, CLAIM_OBJECT);
    const looks = new Map<number, CellLook>();
    const leafOf = new Map<number, RGB>();
    const trunkOf = new Map<number, RGB>();
    const leaf = (m: number) => {
      let c = leafOf.get(m);
      if (!c) {
        c = soften(dominantColor(a.info.both, [m], (k) => k[1] > k[0] && k[1] >= k[2] - 0.05 && luma(k) > 0.2) ?? [0.3, 0.6, 0.35]);
        leafOf.set(m, c);
      }
      return c;
    };
    const trunk = (m: number) => {
      let c = trunkOf.get(m);
      if (!c) {
        c = soften(dominantColor(a.info.both, [m], (k) => k[0] > k[2] + 0.12 && k[0] >= k[1] && luma(k) < 0.6) ?? [0.45, 0.3, 0.2]);
        trunkOf.set(m, c);
      }
      return c;
    };
    const round: { x: number; k: number; base: number }[] = [];
    const single: { x: number; k: number; base: number; pine: boolean }[] = [];
    const cellMt = new Map<string, number>();
    for (let x = a.minX; x < a.maxX; x++) {
      let y = a.minY;
      while (y < a.maxY) {
        if (!isTree(idx(x, y))) { y++; continue; }
        let e = y;
        while (e + 1 < a.maxY && isTree(idx(x, e + 1))) e++;
        const below = e + 1 < a.maxY ? idx(x, e + 1) : -1;
        const base = below >= 0 && !Number.isNaN(height[below]) ? Math.max(0, height[below]) : a.groundH[idx(x, e)];
        const above = y > a.minY ? idx(x, y - 1) : -1;
        if (above >= 0 && kind[above] === K.Floor && a.hasTop(above)) claims.claim(above, CLAIM_TOP);
        const period = a.roundTree[idx(x, e)] ? 2 : 1;
        for (let k = e; k >= y; k -= period) {
          const m = a.mt[idx(x, k)];
          cellMt.set(`${x},${k}`, m);
          if (period === 2) round.push({ x, k, base });
          else single.push({ x, k, base, pine: a.isGeneralId(m) && pineIds(m) });
        }
        for (let r = y; r <= e; r++) {
          const i = idx(x, r);
          claims.claim(i, CLAIM_OBJECT);
          claims.groundY[i] = base;
        }
        y = e + 1;
      }
    }
    const out: TreePlacement[] = [];
    const place = (x: number, k: number, base: number, style: TreeStyle, m: number) => {
      const gi = a.groundOf[idx(Math.floor(x), k)];
      const onSand = gi >= 0 && cellLook(a, gi, looks).mat === GroundMat.Sand;
      out.push({
        x, y: base, z: k + 0.5 + base, style: onSand ? 'palm' : style,
        leaf: leaf(m), trunk: trunk(m), seed: hashCell(Math.floor(x * 2), k),
      });
    };
    for (const t of pairRoundTrees(round)) place(t.x, t.k, t.base, t.big ? 'round' : 'bushy', cellMt.get(`${Math.floor(t.x - (t.big ? 1 : 0.5))},${t.k}`)!);
    for (const t of single) place(t.x + 0.5, t.k, t.base, t.pine ? 'pine' : 'bushy', cellMt.get(`${t.x},${t.k}`)!);
    return out;
  },

  build(trees: TreePlacement[], _ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!trees.length) return null;
    const detail = kit.quality === 'high' ? 2 : 1;
    const groups = new Map<string, TreePlacement[]>();
    for (const t of trees) {
      const id = `${t.style}:${t.seed % VARIANTS}`;
      const list = groups.get(id);
      if (list) list.push(t); else groups.set(id, [t]);
    }
    const root = new THREE.Group();
    const crownMat = kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.85, wind: 0.05, windHeight: 2.6, fade: true });
    const palmMat = kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.85, wind: 0.07, windHeight: 2.4, fade: true, side: THREE.DoubleSide });
    const trunkMat = kitMaterial(kit.uniforms, { roughness: 0.95, fade: true });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    for (const [id, list] of groups) {
      const [style, variant] = id.split(':') as [TreeStyle, string];
      const geo = treeGeo(style, Number(variant), detail);
      const crown = new THREE.InstancedMesh(geo.crown, crownMat.material, list.length);
      applyKitMaterial(crown, geo.doubleSided ? palmMat : crownMat);
      const trunk = new THREE.InstancedMesh(geo.trunk, trunkMat.material, list.length);
      list.forEach((t, i) => {
        const r = rng(t.seed);
        const k = 0.9 + r() * 0.2;
        q.setFromAxisAngle(up, r() * Math.PI * 2);
        m.compose(p.set(t.x, t.y, t.z), q, s.set(k, k * (0.92 + r() * 0.16), k));
        crown.setMatrixAt(i, m);
        trunk.setMatrixAt(i, m);
        const lin = toLinear(t.leaf);
        c.setRGB(lin[0], lin[1], lin[2]).offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.06);
        crown.setColorAt(i, c);
        const tl = toLinear(t.trunk);
        trunk.setColorAt(i, c.setRGB(tl[0], tl[1], tl[2]));
      });
      for (const mesh of [crown, trunk]) {
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        root.add(mesh);
      }
    }
    return root;
  },
};
```

- [ ] **Step 4: Register** — `index.ts`: `[treeFamily, cliffFamily, waterFamily, terrainFamily]`.

- [ ] **Step 5: Run tests** — `npx vitest run tests/kitTrees.test.ts` → PASS; `npx tsc --noEmit && npm test` → pass.

- [ ] **Step 6: Visual check** — `npx tsx tools/regress.ts --label t9`. Acceptance: no flat tree cards remain on outdoor maps; Littleroot/Route 101 borders read as a dense, lush 3D forest; 2×2 GBA trees become big round trees, 1-wide trees small bushy trees; colours match each area (Fortree/Route 119 deeper jungle greens, Route 113 ash-tinted); trees cast soft shadows; Mossdeep/Slateport trees on sand are palms; night shot: trees darker, no glowing leaves. Record tree counts and the `stats.json` triangle numbers for `woods` in the progress log (budget ≤ 1.5 M).

- [ ] **Step 7: Commit**

```bash
git add src/render/kit tests/kitTrees.test.ts docs/superpowers/progress/modern-3d.md
git commit -m "feat(kit): instanced stylised trees (round, bushy, pine, palm) with wind"
```

---

### Task 10: Occlusion fade (never lose the player behind a tree or roof)

**Files:**
- Modify: `src/render/overworld/overworldView.ts`, `src/render/renderer.ts`, `src/render/preview.ts`

**Interfaces:**
- Consumes: `KitUniforms.uFocusPx / uFocusDepth / uFadeRadius` (Task 4), `kitMaterial({ fade: true })` users (trees now, buildings/props later).
- Produces: `OverworldView.setBufferSize(w: number, h: number)`; `OverworldView.focusOverride: THREE.Vector3 | null` (preview: `&focus=1` fades around the view target for testing).

- [ ] **Step 1: Buffer size plumbing**
  - `overworldView.ts`: fields `private bufferW = 1; private bufferH = 1; focusOverride: THREE.Vector3 | null = null;` and

```ts
  /** Drawing-buffer size in pixels (the occlusion fade works in screen pixels). */
  setBufferSize(w: number, h: number): void {
    this.bufferW = w;
    this.bufferH = h;
  }
```

  - `renderer.ts` `resize()`: after `this.overworld.resize(...)` add `const db = this.webgl.getDrawingBufferSize(new THREE.Vector2()); this.overworld.setBufferSize(db.x, db.y);`
  - `preview.ts` `resize()`: after `this.view.resize(...)` add `this.view.setBufferSize(size.x, size.y);` (`size` is already the drawing-buffer size there); in the constructor after `overrideTarget` is set: `if (params.has('focus')) this.view.focusOverride = this.target;`

- [ ] **Step 2: Update the focus uniforms every frame** — in `update()`, after `this.camera.updateProjectionMatrix();`:

```ts
    this.camera.updateMatrixWorld();
    const u = this.kitUniforms;
    const focus = this.focusOverride ?? (this.overrideTarget ? null : this.playerWorld(state));
    if (focus && this.worldStyle === 'modern') {
      const chest = new THREE.Vector3(focus.x, focus.y + 0.7, focus.z);
      const ndc = chest.clone().project(this.camera);
      u.uFocusPx.value.set((ndc.x * 0.5 + 0.5) * this.bufferW, (ndc.y * 0.5 + 0.5) * this.bufferH);
      u.uFocusDepth.value = -chest.applyMatrix4(this.camera.matrixWorldInverse).z;
      u.uFadeRadius.value = 0.11 * this.bufferH;
    } else {
      u.uFadeRadius.value = 0;
    }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test` → pass.
Run: `npx tsx tools/shot3d.ts --batch "t10_woods=map=24.11&hour=11&focus=1;t10_lr=map=0.9&hour=11&focus=1&x=10&y=3"`. Acceptance: a soft, dithered hole opens in the canopy around the screen centre (the focus point) so the ground there is visible; trees outside the radius and trees *behind* the focus are untouched.
Live check: `npx tsx tools/shot3d.ts --state out/littleroot.state --wait 3000 --keys "UP:900" --name t10_live` → the player stays visible when walking north behind the treeline/houses.

- [ ] **Step 4: Commit**

```bash
git add src/render docs/superpowers/progress/modern-3d.md
git commit -m "feat(kit): dithered occlusion fade around the player for trees and roofs"
```

---

### Task 11: Tall grass and flowers (+ grass bends around characters)

**Files:**
- Create: `src/render/kit/grass.ts`, `src/render/kit/flowers.ts`, `tests/kitFlora.test.ts`
- Modify: `src/render/kit/index.ts`, `src/render/overworld/overworldView.ts`

**Interfaces:**
- Produces (`grass.ts`): `interface GrassCell { x; y; h; long: boolean; tint: RGB }`, `BLADES: Record<Quality, number>` (`{ low: 8, medium: 24, high: 48 }`), `grassFamily: Family<GrassCell[]>`.
- Produces (`flowers.ts`): `interface FlowerCell { x; y; h; petals: [RGB, RGB] }`, `petalColors(px, m): [RGB, RGB] | null`, `flowerFamily: Family<FlowerCell[]>`, `setFlowerIds(f)` hook (Task 14).
- Produces (`overworldView.ts`): grass-overlay sprites hidden in Modern style; `kitUniforms.uActors` filled from character feet every frame.

- [ ] **Step 1: Write the failing test** — `tests/kitFlora.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { petalColors } from '../src/render/kit/flowers';
import { BLADES } from '../src/render/kit/grass';

describe('flora', () => {
  it('grass density follows quality', () => {
    expect(BLADES).toEqual({ low: 8, medium: 24, high: 48 });
  });
  it('finds two petal colours among green', () => {
    const px = new Uint16Array(256).fill(14 | (25 << 5) | (20 << 10)); // grass green
    px.fill(31 | (4 << 5) | (4 << 10), 0, 30);                        // red petals
    px.fill(31 | (31 << 5) | (31 << 10), 30, 45);                     // white centres
    const c = petalColors(px, 0)!;
    expect(c[0][0]).toBeGreaterThan(0.9);
    expect(c[0][1]).toBeLessThan(0.3);
    expect(c[1]).toEqual([1, 1, 1]);
  });
  it('plain grass has no petals', () => {
    expect(petalColors(new Uint16Array(256).fill(14 | (25 << 5) | (20 << 10)), 0)).toBeNull();
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run tests/kitFlora.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/render/kit/grass.ts`**

```ts
// Tall grass: instanced clumps of curved, tapered blades on every tall/long-grass cell; they
// sway with the wind and bend away from characters (replacing the GBA's grass overlay sprite).

import * as THREE from 'three';
import { MB } from '../../game/behaviors';
import { K } from '../overworld/analyze';
import { CLAIM_TOP, type Claims } from '../overworld/claims';
import { dominantColor, luma, soften, toLinear, type RGB } from './palette';
import { hashCell, rng } from './geom';
import { applyKitMaterial, kitMaterial } from './materials';
import type { Quality } from '../post';
import type { Family, KitContext, SemanticContext } from './semantics';

export interface GrassCell { x: number; y: number; h: number; long: boolean; tint: RGB }
export const BLADES: Record<Quality, number> = { low: 8, medium: 24, high: 48 };

const clumps = new Map<string, THREE.BufferGeometry>();

/** One cell's worth of blades (x/z in [-0.5, 0.5]); grey→white vertex colours, tinted per instance. */
function clump(blades: number, long: boolean, variant: number): THREE.BufferGeometry {
  const id = `${blades}:${long}:${variant}`;
  let g = clumps.get(id);
  if (g) return g;
  const r = rng(77 + variant * 13 + (long ? 500 : 0));
  const pos: number[] = [], col: number[] = [], nor: number[] = [];
  for (let b = 0; b < blades; b++) {
    const x = r() - 0.5, z = r() - 0.5;
    const h = (long ? 0.7 : 0.42) + r() * (long ? 0.25 : 0.18);
    const w = 0.035 + r() * 0.02;
    const yaw = r() * Math.PI * 2;
    const lean = 0.15 + r() * 0.2;
    const dx = Math.cos(yaw), dz = Math.sin(yaw);   // blade width direction
    const fx = -dz * lean, fz = dx * lean;          // lean direction
    const ring = [0, 0.45, 0.8, 1];
    for (let s = 0; s < 3; s++) {
      const t0 = ring[s], t1 = ring[s + 1];
      const w0 = w * (1 - t0), w1 = w * (1 - t1);
      const p0 = [x + fx * t0 * t0, h * t0, z + fz * t0 * t0];
      const p1 = [x + fx * t1 * t1, h * t1, z + fz * t1 * t1];
      const a = [p0[0] - dx * w0, p0[1], p0[2] - dz * w0], b = [p0[0] + dx * w0, p0[1], p0[2] + dz * w0];
      const c = [p1[0] + dx * w1, p1[1], p1[2] + dz * w1], d = [p1[0] - dx * w1, p1[1], p1[2] - dz * w1];
      for (const v of [a, b, c, a, c, d]) {
        pos.push(v[0], v[1], v[2]);
        nor.push(-fz, 0.6, fx);
        const k = 0.55 + 0.5 * (v[1] / h);
        col.push(k, k, k);
      }
    }
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.userData.shared = true;
  clumps.set(id, g);
  return g;
}

export const grassFamily: Family<GrassCell[]> = {
  name: 'grass',

  extract({ a }: SemanticContext, claims: Claims): GrassCell[] {
    if (a.opts.indoor || a.opts.underground) return [];
    const out: GrassCell[] = [];
    const tints = new Map<number, RGB>();
    for (let i = 0; i < a.N; i++) {
      if (a.kind[i] !== K.Floor) continue;
      const b = a.beh[i];
      const long = b === MB.LONG_GRASS || b === MB.LONG_GRASS_SOUTH_EDGE;
      if (b !== MB.TALL_GRASS && !long) continue;
      const m = a.mt[i];
      let tint = tints.get(m);
      if (!tint) {
        tint = soften(dominantColor(a.info.both, [m], (c) => c[1] > c[0] && luma(c) > 0.25) ?? [0.35, 0.7, 0.45]);
        tints.set(m, tint);
      }
      out.push({ x: a.cellX(i), y: a.cellY(i), h: Math.max(0, a.height[i]), long, tint });
      claims.claim(i, CLAIM_TOP); // the 3D blades replace the drawn grass tips
    }
    return out;
  },

  build(cells: GrassCell[], _ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!cells.length) return null;
    const root = new THREE.Group();
    const km = kitMaterial(kit.uniforms, {
      vertexColors: true, roughness: 0.9, side: THREE.DoubleSide, wind: 0.08, windHeight: 0.6, bend: true,
    });
    const blades = BLADES[kit.quality];
    for (const long of [false, true]) {
      for (let v = 0; v < 3; v++) {
        const list = cells.filter((c) => c.long === long && hashCell(c.x, c.y, 5) % 3 === v);
        if (!list.length) continue;
        const mesh = new THREE.InstancedMesh(clump(blades, long, v), km.material, list.length);
        applyKitMaterial(mesh, km);
        const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
        list.forEach((c, i) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (hashCell(c.x, c.y, 9) % 4) * (Math.PI / 2));
          m.compose(new THREE.Vector3(c.x + 0.5, c.h, c.y + c.h + 0.5), q, new THREE.Vector3(1, 1, 1));
          mesh.setMatrixAt(i, m);
          const lin = toLinear(c.tint);
          mesh.setColorAt(i, col.setRGB(lin[0], lin[1], lin[2]));
        });
        mesh.receiveShadow = true;
        mesh.computeBoundingSphere();
        root.add(mesh);
      }
    }
    return root;
  },
};
```

- [ ] **Step 4: Implement `src/render/kit/flowers.ts`**

```ts
// Flowers: small instanced 3D flowers (stem, five petals, centre) on flower cells, coloured
// with the two most frequent petal colours of the tile.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { K } from '../overworld/analyze';
import { CLAIM_TOP, type Claims } from '../overworld/claims';
import { bgr555ToSrgb, luma, saturation, soften, toLinear, type RGB } from './palette';
import { hashCell, rng } from './geom';
import { applyKitMaterial, kitMaterial } from './materials';
import type { Family, KitContext, SemanticContext } from './semantics';

export interface FlowerCell { x: number; y: number; h: number; petals: [RGB, RGB] }

let flowerIds: (m: number) => boolean = () => false;
export function setFlowerIds(f: (m: number) => boolean): void { flowerIds = f; }

const isPetal = (c: RGB) => {
  const greenish = c[1] > c[0] && c[1] > c[2];
  return !greenish && luma(c) > 0.35 && (saturation(c) > 0.35 || luma(c) > 0.9);
};

/** Two most frequent petal colours of metatile `m` (12..140 petal pixels), else null. */
export function petalColors(px: Uint16Array, m: number): [RGB, RGB] | null {
  const counts = new Map<number, number>();
  let total = 0;
  for (let p = 0; p < 256; p++) {
    const v = px[m * 256 + p];
    if (v & 0x8000 || !isPetal(bgr555ToSrgb(v))) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
    total++;
  }
  if (total < 12 || total > 140) return null;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const first = bgr555ToSrgb(sorted[0][0]);
  return [first, sorted[1] ? bgr555ToSrgb(sorted[1][0]) : first];
}

let headGeo: THREE.BufferGeometry | null = null;
let stemGeo: THREE.BufferGeometry | null = null;
let centreGeo: THREE.BufferGeometry | null = null;

function geos() {
  if (!headGeo) {
    const petals: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 5; i++) {
      const g = new THREE.SphereGeometry(0.045, 6, 4);
      g.scale(1, 0.35, 0.6);
      g.translate(0.05, 0, 0);
      g.rotateY((i / 5) * Math.PI * 2);
      petals.push(g);
    }
    headGeo = mergeGeometries(petals)!;
    petals.forEach((g) => g.dispose());
    headGeo.translate(0, 0.24, 0);
    stemGeo = new THREE.CylinderGeometry(0.008, 0.012, 0.24, 4).translate(0, 0.12, 0);
    centreGeo = new THREE.SphereGeometry(0.03, 6, 4).translate(0, 0.25, 0);
    for (const g of [headGeo, stemGeo, centreGeo]) g.userData.shared = true;
  }
  return { head: headGeo!, stem: stemGeo!, centre: centreGeo! };
}

export const flowerFamily: Family<FlowerCell[]> = {
  name: 'flowers',

  extract({ a }: SemanticContext, claims: Claims): FlowerCell[] {
    if (a.opts.indoor || a.opts.underground) return [];
    const out: FlowerCell[] = [];
    const cache = new Map<number, [RGB, RGB] | null>();
    for (let i = 0; i < a.N; i++) {
      if (a.kind[i] !== K.Floor) continue;
      const m = a.mt[i];
      if (!cache.has(m)) {
        const known = a.isGeneralId(m) && flowerIds(m);
        const c = known || a.info.green[m] > 0.25 ? petalColors(a.info.both, m) : null;
        cache.set(m, c);
      }
      const petals = cache.get(m);
      if (!petals) continue;
      out.push({ x: a.cellX(i), y: a.cellY(i), h: Math.max(0, a.height[i]), petals: [soften(petals[0]), soften(petals[1])] });
      claims.claim(i, CLAIM_TOP);
    }
    return out;
  },

  build(cells: FlowerCell[], _ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!cells.length) return null;
    const { head, stem, centre } = geos();
    const per = 4;
    const n = cells.length * per;
    const km = kitMaterial(kit.uniforms, { roughness: 0.8, wind: 0.03, windHeight: 0.3 });
    const heads = new THREE.InstancedMesh(head, km.material, n);
    const stems = new THREE.InstancedMesh(stem, km.material, n);
    const centres = new THREE.InstancedMesh(centre, km.material, n);
    for (const mesh of [heads, stems, centres]) applyKitMaterial(mesh, km);
    const m = new THREE.Matrix4(), col = new THREE.Color();
    const green = toLinear([0.3, 0.55, 0.25]), yellow = toLinear([0.98, 0.85, 0.3]);
    let k = 0;
    for (const c of cells) {
      const r = rng(hashCell(c.x, c.y, 3));
      for (let f = 0; f < per; f++, k++) {
        const s = 0.85 + r() * 0.35;
        m.compose(
          new THREE.Vector3(c.x + 0.15 + r() * 0.7, c.h, c.y + c.h + 0.15 + r() * 0.7),
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28),
          new THREE.Vector3(s, s, s),
        );
        for (const mesh of [heads, stems, centres]) mesh.setMatrixAt(k, m);
        const petal = toLinear(c.petals[f % 2]);
        heads.setColorAt(k, col.setRGB(petal[0], petal[1], petal[2]));
        stems.setColorAt(k, col.setRGB(green[0], green[1], green[2]));
        centres.setColorAt(k, col.setRGB(yellow[0], yellow[1], yellow[2]));
      }
    }
    const root = new THREE.Group();
    for (const mesh of [heads, stems, centres]) {
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
    return root;
  },
};
```

- [ ] **Step 5: Register** — `index.ts`: `[treeFamily, cliffFamily, grassFamily, flowerFamily, waterFamily, terrainFamily]`.

- [ ] **Step 6: Hide grass sprites and feed actor positions** — in `overworldView.ts`:
  - in `buildBillboards()`, after `if (kind === SpriteKind.Hidden) continue;` add `if (kind === SpriteKind.Grass && this.worldStyle === 'modern') continue;`
  - in `update()`, after `this.billboards.set(...)`, fill `uActors` from the upright billboards (feet), nearest to the camera target first:

```ts
    const feet = specs.filter((b) => !b.flat).map((b) => new THREE.Vector3(b.footX, b.footY, b.footZ));
    feet.sort((p, q) => p.distanceToSquared(this.target) - q.distanceToSquared(this.target));
    const actors = this.kitUniforms.uActors.value;
    for (let k = 0; k < actors.length; k++) {
      if (k < feet.length) actors[k].copy(feet[k]); else actors[k].set(1e4, 0, 1e4);
    }
```

    (refactor the existing `this.billboards.set(this.buildBillboards(state), …)` to `const specs = this.buildBillboards(state); this.billboards.set(specs, …);`)

- [ ] **Step 7: Run tests** — `npx vitest run tests/kitFlora.test.ts` → PASS; `npx tsc --noEmit && npm test` → pass.

- [ ] **Step 8: Visual check** — `npx tsx tools/regress.ts --label t11 --only littleroot,oldale,petalburg,route119,route113,route110`; and live: `npx tsx tools/shot3d.ts --state out/r101.state --wait 3000 --keys "UP:600" --name t11_live`. Acceptance: tall-grass patches are dense swaying 3D grass (Route 119 long grass visibly taller), flowers are little 3D flowers in their ROM colours, no flat grass/flower pixel art remains on those cells, in live play the player's legs are hidden *by 3D blades that part around them*, and no flat grass-overlay sprite is drawn.

- [ ] **Step 9: Commit**

```bash
git add src tests/kitFlora.test.ts docs/superpowers/progress/modern-3d.md
git commit -m "feat(kit): swaying tall grass that bends around characters, 3D flowers"
```

---

### Task 12: Buildings I — extraction, kinds, and the house model

**Files:**
- Create: `src/render/kit/buildings.ts`, `tests/kitBuildings.test.ts`
- Modify: `src/render/kit/index.ts`

**Interfaces:**
- Consumes: `a.buildings`, `DOOR_BEHAVIORS` (Task 2), `GridEvents.warps` (Task 3), `dominantColor`, `countPixels`, `MeshBuilder`, `kitMaterial`.
- Produces: `type BuildingKind = 'house' | 'pc' | 'mart' | 'gym' | 'lab' | 'special'`, `buildingKind(dest: string | null, width: number): BuildingKind`, `interface BuildingPlacement { kind; x0; x1; top; bottom; base; wallRows; doorX; roof: RGB; wall: RGB; windows: number[]; chimneyX: number | null; facade: { w: number; h: number; px: Uint16Array } | null }`, `buildingFamily: Family<BuildingPlacement[]>`, `interface BuildingFrame` + `buildFrame(p)` (shared geometry numbers), `addBox(mb, cx, cy, cz, sx, sy, sz, color)`, `roofGeometry(...)`.

- [ ] **Step 1: Write the failing test** — `tests/kitBuildings.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildingKind, buildingFamily } from '../src/render/kit/buildings';
import { analyze } from '../src/render/overworld/analyze';
import { Claims, CLAIM_OBJECT } from '../src/render/overworld/claims';
import { MB } from '../src/game/behaviors';
import { fakeInfo } from './helpers/fakeMap';

describe('buildingKind', () => {
  const cases: [string | null, number, string][] = [
    ['OldaleTown_PokemonCenter_1F', 5, 'pc'],
    ['OldaleTown_Mart', 4, 'mart'],
    ['PetalburgCity_Gym', 8, 'gym'],
    ['LavaridgeTown_Gym_1F', 8, 'gym'],
    ['LittlerootTown_ProfessorBirchsLab', 7, 'lab'],
    ['LittlerootTown_BrendansHouse_1F', 5, 'house'],
    ['OldaleTown_House1', 4, 'house'],
    ['LilycoveCity_LilycoveMuseum_1F', 9, 'special'],
    ['MAP_127_127', 5, 'special'],
    [null, 5, 'house'],
    [null, 8, 'special'],
  ];
  for (const [dest, w, want] of cases) it(`${dest} → ${want}`, () => expect(buildingKind(dest, w)).toBe(want));
});

describe('building extract', () => {
  it('finds the footprint, door and kind of a building', () => {
    const info = fakeInfo();
    info.attributes[4] = MB.ANIMATED_DOOR;
    const rows = ['.....', '.###.', '.###.', '.#D#.', '.....'];
    const w = 5, h = rows.length;
    const cells = new Uint16Array(w * h);
    rows.forEach((r, y) => [...r].forEach((ch, x) => {
      cells[y * w + x] = ch === '#' ? 2 | 0x0400 : ch === 'D' ? 4 | 0x0400 : 1 | 0x3000;
    }));
    const a = analyze({ width: w, height: h, cells, border: [1, 1, 1, 1], borderW: 2, borderH: 2, borderPhase: 0 },
      { info, generalPrimary: false, indoor: false, underground: false, margin: 1 });
    const claims = new Claims(a.N);
    const out = buildingFamily.extract(
      { a, events: { warps: [{ x: 2, y: 3, dest: 'OldaleTown_Mart' }], signs: [] }, quality: 'medium' }, claims);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'mart', x0: 1, x1: 3, top: 1, bottom: 3, doorX: 2, wallRows: 2 });
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) expect(claims.has(a.idx(x, y), CLAIM_OBJECT)).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run tests/kitBuildings.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/render/kit/buildings.ts` (extraction + house)**

```ts
// Buildings: real 3D houses, Pokémon Centers, Marts, Gyms, labs and special buildings, built
// on the footprint the analysis flood-filled from each door. The kind comes from the door's
// warp destination; colours, windows and chimneys come from the building's own tiles.

import * as THREE from 'three';
import { DOOR_BEHAVIORS, K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_TOP, type Claims } from '../overworld/claims';
import { countPixels, dominantColor, luma, mix, saturation, scale, soften, toLinear, type RGB } from './palette';
import { MeshBuilder, type V3 } from './geom';
import { kitMaterial } from './materials';
import type { Family, KitContext, SemanticContext } from './semantics';

export type BuildingKind = 'house' | 'pc' | 'mart' | 'gym' | 'lab' | 'special';

export function buildingKind(dest: string | null, width: number): BuildingKind {
  if (!dest) return width <= 6 ? 'house' : 'special';
  if (/_PokemonCenter_1F$/.test(dest)) return 'pc';
  if (/_Mart$/.test(dest)) return 'mart';
  if (/_Gym(_1F)?$/.test(dest)) return 'gym';
  if (/Lab/.test(dest)) return 'lab';
  if (/House|Home/.test(dest)) return 'house';
  return 'special';
}

export interface BuildingPlacement {
  kind: BuildingKind;
  x0: number; x1: number;
  top: number; bottom: number;
  base: number;
  wallRows: number;
  doorX: number;
  roof: RGB;
  wall: RGB;
  windows: number[];
  chimneyX: number | null;
  /** `special`: the wall rows' ROM pixels (BGR555, 0x8000 transparent), row-major from the top. */
  facade: { w: number; h: number; px: Uint16Array } | null;
}

const isGlass = (c: RGB) => c[2] > c[0] + 0.12 && c[2] >= c[1] && luma(c) > 0.25;
const isGrey = (c: RGB) => saturation(c) < 0.08 && luma(c) > 0.35 && luma(c) < 0.85;

function facadePixels(a: MapAnalysis, x0: number, x1: number, y0: number, y1: number) {
  const w = (x1 - x0 + 1) * 16, h = (y1 - y0 + 1) * 16;
  const px = new Uint16Array(w * h);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const m = a.mt[a.idx(x, y)];
      for (let p = 0; p < 256; p++) {
        px[((y - y0) * 16 + (p >> 4)) * w + (x - x0) * 16 + (p & 15)] = a.info.both[m * 256 + p];
      }
    }
  }
  return { w, h, px };
}

export const buildingFamily: Family<BuildingPlacement[]> = {
  name: 'buildings',

  extract({ a, events }: SemanticContext, claims: Claims): BuildingPlacement[] {
    if (a.opts.indoor || a.opts.underground) return [];
    const out: BuildingPlacement[] = [];
    a.buildings.forEach((b, id) => {
      if (b.cells.some((c) => claims.has(c, CLAIM_OBJECT))) return;
      let x0 = Infinity, x1 = -Infinity, top = Infinity, bottom = -Infinity;
      for (const c of b.cells) {
        const x = a.cellX(c), y = a.cellY(c);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      const rows = bottom - top + 1;
      const wallRows = rows >= 9 ? 4 : rows >= 7 ? 3 : 2;
      let doorX = Math.round((x0 + x1) / 2);
      for (let x = x0; x <= x1; x++) {
        if (a.inside(x, b.doorRow) && DOOR_BEHAVIORS.has(a.beh[a.idx(x, b.doorRow)])) { doorX = x; break; }
      }
      const below = a.inside(doorX, b.doorRow + 1) ? a.idx(doorX, b.doorRow + 1) : -1;
      const base = below >= 0 && !Number.isNaN(a.height[below]) ? Math.max(0, a.height[below]) : 0;
      const warp = events.warps.find((w) => w.x === doorX && w.y === b.doorRow);
      const kind = buildingKind(warp?.dest ?? null, x1 - x0 + 1);
      const inB = (x: number, y: number) => a.inside(x, y) && a.building[a.idx(x, y)] === id;
      const roofMts: number[] = [], wallMts: number[] = [];
      for (let y = top; y <= bottom; y++) {
        for (let x = x0; x <= x1; x++) if (inB(x, y)) (y > bottom - wallRows ? wallMts : roofMts).push(a.mt[a.idx(x, y)]);
      }
      const roof = dominantColor(a.info.both, roofMts, (c) => luma(c) > 0.15 && saturation(c) > 0.12) ?? [0.75, 0.35, 0.3];
      const wall = dominantColor(a.info.both, wallMts, (c) => luma(c) > 0.3 && !isGlass(c)) ?? [0.9, 0.88, 0.8];
      const windows: number[] = [];
      let chimneyX: number | null = null;
      let greyBest = 40;
      for (let x = x0; x <= x1; x++) {
        const wm: number[] = [], rm: number[] = [];
        for (let y = top; y <= bottom; y++) if (inB(x, y)) (y > bottom - wallRows ? wm : rm).push(a.mt[a.idx(x, y)]);
        if (x !== doorX && countPixels(a.info.both, wm, isGlass) > 20) windows.push(x);
        const grey = countPixels(a.info.both, rm, isGrey);
        if (kind === 'house' && grey > greyBest) { greyBest = grey; chimneyX = x; }
      }
      for (const c of b.cells) {
        claims.claim(c, CLAIM_OBJECT);
        claims.groundY[c] = base;
      }
      for (let x = x0; x <= x1; x++) {
        if (!a.inside(x, top - 1)) continue;
        const i = a.idx(x, top - 1);
        if (a.kind[i] === K.Floor && a.hasTop(i)) claims.claim(i, CLAIM_TOP);
      }
      out.push({
        kind, x0, x1, top, bottom, base, wallRows, doorX,
        roof: soften(roof), wall: soften(wall), windows, chimneyX,
        facade: kind === 'special' ? facadePixels(a, x0, x1, bottom - wallRows + 1, bottom) : null,
      });
    });
    return out;
  },

  build(list: BuildingPlacement[], _ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!list.length) return null;
    const parts: BuildingParts = { body: new MeshBuilder(), roof: new MeshBuilder(), glass: new MeshBuilder(), extras: [] };
    for (const p of list) buildBuilding(p, parts, kit);
    const root = new THREE.Group();
    const add = (mb: MeshBuilder, mat: THREE.Material) => {
      if (mb.empty) return;
      const mesh = new THREE.Mesh(mb.build(), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    };
    add(parts.body, kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.85, fade: true }).material);
    add(parts.roof, kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.7, pattern: 'roofTiles', fade: true, side: THREE.DoubleSide }).material);
    add(parts.glass, kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.15, metalness: 0.1, glow: 1.6, fade: true }).material);
    for (const e of parts.extras) root.add(e);
    return root;
  },
};

export interface BuildingParts { body: MeshBuilder; roof: MeshBuilder; glass: MeshBuilder; extras: THREE.Object3D[] }

/** Shared numbers of one building in world space. */
export interface BuildingFrame {
  X0: number; X1: number; cx: number;
  zf: number; zb: number; zm: number;
  y0: number;      // top of the plinth (wall bottom)
  eave: number;    // wall top
  D: number; W: number;
  ov: number;      // roof overhang
}

export function buildFrame(p: BuildingPlacement): BuildingFrame {
  const W = p.x1 - p.x0 + 1;
  const D = Math.min(4, Math.max(1.6, p.bottom - p.top));
  const zf = p.bottom + 1 + p.base;
  const y0 = p.base + 0.12;
  return { X0: p.x0, X1: p.x1 + 1, cx: p.x0 + W / 2, zf, zb: zf - D, zm: zf - D / 2, y0, eave: y0 + p.wallRows * 0.95, D, W, ov: 0.25 };
}

export function addBox(mb: MeshBuilder, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: RGB): void {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  mb.add(g, color, new THREE.Matrix4().makeTranslation(cx, cy, cz));
  g.dispose();
}

function tri(mb: MeshBuilder, a: V3, b: V3, c: V3, color: RGB): void {
  const n = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a))
    .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a))).normalize();
  mb.quad(a, b, c, c, [n.x, n.y, n.z], color);
}

/** Gable (inset 0) or hip roof over [x0, x1] × [zb, zf] from the eave up by `rise`. */
export function roofGeometry(mb: MeshBuilder, x0: number, x1: number, zb: number, zf: number, eave: number, rise: number, hip: boolean, color: RGB): void {
  const zm = (zb + zf) / 2;
  const inset = hip ? Math.min((zf - zb) / 2, (x1 - x0) / 2 - 0.01) : 0;
  const E0: V3 = [x0, eave, zf], E1: V3 = [x1, eave, zf], E2: V3 = [x1, eave, zb], E3: V3 = [x0, eave, zb];
  const R0: V3 = [x0 + inset, eave + rise, zm], R1: V3 = [x1 - inset, eave + rise, zm];
  mb.quad(R0, R1, E1, E0, [0, zf - zm, rise], color);   // front slope
  mb.quad(R1, R0, E3, E2, [0, zf - zm, -rise], color);  // back slope
  if (hip) {
    tri(mb, E3, E0, R0, color);
    tri(mb, E1, E2, R1, color);
  }
}

function buildBuilding(p: BuildingPlacement, parts: BuildingParts, kit: KitContext): void {
  const f = buildFrame(p);
  const wall = toLinear(p.wall);
  const roof = toLinear(p.roof);
  const trim = toLinear(mix(p.wall, p.roof, 0.3).map((v) => v * 0.85) as RGB);
  const stone = toLinear([0.62, 0.6, 0.58]);
  const wood = toLinear([0.5, 0.34, 0.2]);
  const frameC = toLinear([0.93, 0.91, 0.87]);
  const glassC = toLinear([0.55, 0.72, 0.85]);
  const { body, glass } = parts;
  const H = f.eave - f.y0;
  // plinth, walls, baseboard, corner posts
  addBox(body, f.cx, p.base + 0.06, f.zm, f.W + 0.12, 0.12, f.D + 0.12, stone);
  addBox(body, f.cx, f.y0 + H / 2, f.zm, f.W, H, f.D, wall);
  addBox(body, f.cx, f.y0 + 0.15, f.zm, f.W + 0.03, 0.3, f.D + 0.03, scale(wall, 0.72));
  for (const [x, z] of [[f.X0, f.zf], [f.X1, f.zf], [f.X0, f.zb], [f.X1, f.zb]]) addBox(body, x, f.y0 + H / 2, z, 0.12, H, 0.12, trim);
  // step in front of the door
  addBox(body, p.doorX + 0.5, p.base + 0.04, f.zf + 0.22, 1.1, 0.08, 0.36, stone);
  if (p.kind === 'special') {
    addSpecialFacade(p, f, parts, kit);
  } else {
    // door
    addBox(body, p.doorX + 0.5, f.y0 + 0.68, f.zf + 0.03, 0.86, 1.36, 0.08, trim);
    if (p.kind === 'pc' || p.kind === 'mart') addBox(glass, p.doorX + 0.5, f.y0 + 0.62, f.zf + 0.07, 0.72, 1.22, 0.04, glassC);
    else addBox(body, p.doorX + 0.5, f.y0 + 0.62, f.zf + 0.07, 0.68, 1.22, 0.05, wood);
    // windows
    for (const x of p.windows) {
      const wy = f.y0 + H * 0.58;
      addBox(body, x + 0.5, wy, f.zf + 0.03, 0.72, 0.62, 0.06, frameC);
      addBox(glass, x + 0.5, wy, f.zf + 0.065, 0.58, 0.48, 0.03, glassC);
      addBox(body, x + 0.5, wy - 0.33, f.zf + 0.07, 0.82, 0.05, 0.14, frameC);
    }
  }
  // roof
  const hip = p.kind !== 'house' || f.W >= 6;
  const run = f.D / 2 + f.ov;
  const rise = p.kind === 'house' ? 0.55 * run : p.kind === 'gym' ? 0.18 * run : 0.32 * run;
  roofGeometry(parts.roof, f.X0 - f.ov, f.X1 + f.ov, f.zb - f.ov, f.zf + f.ov, f.eave, rise, hip, roof);
  if (!hip) {
    // gable walls under a gable roof
    const gy = f.eave + rise * (f.D / 2) / run;
    // vertex order sets the facing: west gable faces -X, east gable faces +X
    tri(body, [f.X0, f.eave, f.zb], [f.X0, f.eave, f.zf], [f.X0, gy, f.zm], wall);
    tri(body, [f.X1, f.eave, f.zf], [f.X1, f.eave, f.zb], [f.X1, gy, f.zm], wall);
  }
  addBox(body, f.cx, f.eave - 0.04, f.zf + f.ov, f.W + 2 * f.ov, 0.08, 0.06, trim);
  addBox(body, f.cx, f.eave - 0.04, f.zb - f.ov, f.W + 2 * f.ov, 0.08, 0.06, trim);
  const ridgeLen = f.W + 2 * f.ov - (hip ? 2 * Math.min(run, f.W / 2 + f.ov - 0.01) : 0);
  if (ridgeLen > 0.05) addBox(parts.roof, f.cx, f.eave + rise + 0.02, f.zm, ridgeLen, 0.07, 0.14, scale(roof, 0.8));
  if (p.chimneyX !== null) addBox(body, p.chimneyX + 0.5, f.eave + rise * 0.6 + 0.2, f.zm - 0.3, 0.35, 0.7, 0.35, toLinear([0.55, 0.38, 0.32]));
  addKindDetails(p, f, rise, parts, kit);
}

/** Kind-specific details (signs, emblem, awning, pillars, vents); filled in Task 13. */
function addKindDetails(_p: BuildingPlacement, _f: BuildingFrame, _rise: number, _parts: BuildingParts, _kit: KitContext): void {}

/** `special` front wall from the ROM facade; filled in Task 13. */
function addSpecialFacade(_p: BuildingPlacement, _f: BuildingFrame, _parts: BuildingParts, _kit: KitContext): void {}
```

- [ ] **Step 4: Register** — `index.ts`: `[buildingFamily, treeFamily, cliffFamily, grassFamily, flowerFamily, waterFamily, terrainFamily]`.

- [ ] **Step 5: Run tests** — `npx vitest run tests/kitBuildings.test.ts` → PASS; `npx tsc --noEmit && npm test` → pass.

- [ ] **Step 6: Visual check** — `npx tsx tools/regress.ts --label t12 --only littleroot,oldale,petalburg,rustboro,fortree,lilycove` plus orbit `npx tsx tools/shot3d.ts --query "map=0.9&hour=11&yaw=0.7" --name t12_orbit`. Acceptance: every house is a solid 3D building (plinth, walls, baseboard, corner posts, framed windows where the GBA art has windows, a wooden door with a step, a tiled gable/hip roof in the town's roof colour, eave boards, a ridge cap, chimney where the art has one); the building occupies its GBA footprint (characters can walk right up to the door; the walkable row behind the house is not inside the building); windows glow warm at hour 21; the roof fades when the focus is behind it (`&focus=1`). PC/Mart/Gym/special appear as plain buildings in their colours until Task 13.

- [ ] **Step 7: Commit**

```bash
git add src/render/kit tests/kitBuildings.test.ts docs/superpowers/progress/modern-3d.md
git commit -m "feat(kit): 3D buildings from door footprints, warp-based kinds, ROM colours"
```

---

### Task 13: Buildings II — Pokémon Center, Mart, Gym, Lab details, special facades, pixel-art upscaler

**Files:**
- Create: `src/render/kit/upscale.ts`, `src/render/kit/text.ts`, `tests/kitUpscale.test.ts`
- Modify: `src/render/kit/buildings.ts` (`addKindDetails`, `addSpecialFacade`)

**Interfaces:**
- Produces (`upscale.ts`): `scale2x(src: Uint32Array, w, h): Uint32Array`, `scale4x(src, w, h): Uint32Array` (Scale2x/EPX edge-directed pixel-art upscaling).
- Produces (`text.ts`): `signTexture(text: string, fg: string, bg: string): THREE.CanvasTexture`, `pokeballTexture(): THREE.CanvasTexture` (module-cached, never disposed).

- [ ] **Step 1: Write the failing test** — `tests/kitUpscale.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { scale2x, scale4x } from '../src/render/kit/upscale';

const X = 0xff0000ff, O = 0xffffffff;

describe('scale2x', () => {
  it('keeps flat areas flat', () => {
    expect([...scale2x(new Uint32Array(4).fill(X), 2, 2)]).toEqual(new Array(16).fill(X));
  });
  it('rounds a diagonal staircase', () => {
    const src = new Uint32Array([X, X, O, X, O, O, O, O, O]);
    const out = scale2x(src, 3, 3);
    // the centre pixel (O) becomes a 2x2 block whose top-left takes the diagonal colour
    expect(out[2 * 6 + 2]).toBe(X);
    expect(out[2 * 6 + 3]).toBe(O);
    expect(out[3 * 6 + 2]).toBe(O);
    expect(out[3 * 6 + 3]).toBe(O);
  });
  it('scale4x is two passes', () => {
    expect(scale4x(new Uint32Array(6).fill(O), 3, 2)).toHaveLength(12 * 8);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run tests/kitUpscale.test.ts` → FAIL.

- [ ] **Step 3: Implement `src/render/kit/upscale.ts`**

```ts
// Edge-directed pixel-art upscaling (Scale2x / EPX): doubles the resolution while rounding
// staircase diagonals instead of blurring them. Pixels are packed RGBA in Uint32 words.

export function scale2x(src: Uint32Array, w: number, h: number): Uint32Array {
  const W = w * 2;
  const out = new Uint32Array(W * h * 2);
  const at = (x: number, y: number) => src[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const E = at(x, y), B = at(x, y - 1), D = at(x - 1, y), F = at(x + 1, y), H = at(x, y + 1);
      let e0 = E, e1 = E, e2 = E, e3 = E;
      if (B !== H && D !== F) {
        if (D === B) e0 = D;
        if (B === F) e1 = F;
        if (D === H) e2 = D;
        if (H === F) e3 = F;
      }
      const o = y * 2 * W + x * 2;
      out[o] = e0;
      out[o + 1] = e1;
      out[o + W] = e2;
      out[o + W + 1] = e3;
    }
  }
  return out;
}

export function scale4x(src: Uint32Array, w: number, h: number): Uint32Array {
  return scale2x(scale2x(src, w, h), w * 2, h * 2);
}
```

Run: `npx vitest run tests/kitUpscale.test.ts` → PASS.

- [ ] **Step 4: Implement `src/render/kit/text.ts`**

```ts
// Canvas-drawn textures for building signage (text boards and the Poké Ball emblem).
// Generated at runtime — no image assets. Cached for the session.

import * as THREE from 'three';

const cache = new Map<string, THREE.CanvasTexture>();

function canvasTexture(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  let t = cache.get(key);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d')!);
    t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    cache.set(key, t);
  }
  return t;
}

export function signTexture(text: string, fg: string, bg: string): THREE.CanvasTexture {
  return canvasTexture(`sign:${text}:${fg}:${bg}`, 512, 96, (g) => {
    g.fillStyle = bg;
    g.beginPath();
    g.roundRect(4, 4, 504, 88, 18);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.stroke();
    g.fillStyle = fg;
    g.font = 'bold 56px "Trebuchet MS", "Segoe UI", sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 256, 52, 470);
  });
}

export function pokeballTexture(): THREE.CanvasTexture {
  return canvasTexture('pokeball', 256, 256, (g) => {
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#e3350d';
    g.beginPath();
    g.arc(128, 128, 120, Math.PI, 0);
    g.fill();
    g.fillStyle = '#1b1b1b';
    g.fillRect(8, 116, 240, 24);
    g.beginPath();
    g.arc(128, 128, 44, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.arc(128, 128, 28, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 10;
    g.strokeStyle = '#1b1b1b';
    g.beginPath();
    g.arc(128, 128, 120, 0, Math.PI * 2);
    g.stroke();
  });
}
```

- [ ] **Step 5: Fill in `addKindDetails` and `addSpecialFacade` in `buildings.ts`**

Add imports: `signTexture, pokeballTexture` from `./text`; `scale4x` from `./upscale`; `bgr555ToSrgb` from `./palette`. Replace the two stubs with:

```ts
function signBoard(text: string, fg: string, bg: string, w: number, h: number, pos: THREE.Vector3, kit: KitContext): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
    kitMaterial(kit.uniforms, { map: signTexture(text, fg, bg), roughness: 0.6, glow: 0.35 }).material);
  mesh.position.copy(pos);
  return mesh;
}

const css = (c: RGB) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

function addKindDetails(p: BuildingPlacement, f: BuildingFrame, rise: number, parts: BuildingParts, kit: KitContext): void {
  const { body, glass } = parts;
  const H = f.eave - f.y0;
  const signW = Math.min(f.W - 0.4, 2.8);
  const signPos = new THREE.Vector3(p.doorX + 0.5, f.y0 + H - 0.3, f.zf + 0.075);
  const white = toLinear([0.95, 0.95, 0.93]);
  if (p.kind === 'pc') {
    addBox(glass, p.doorX + 0.5, f.y0 + 0.62, f.zf + 0.07, 1.3, 1.22, 0.04, toLinear([0.55, 0.72, 0.85]));
    parts.extras.push(signBoard('POKéMON CENTER', '#ffffff', css(p.roof), signW, signW * 0.17, signPos, kit));
    // Poké Ball emblem on the front roof slope
    const run = f.D / 2 + f.ov;
    const n = new THREE.Vector3(0, run, rise).normalize();
    const eave = new THREE.Vector3(p.doorX + 0.5, f.eave, f.zf + f.ov);
    const ridge = new THREE.Vector3(p.doorX + 0.5, f.eave + rise, f.zm);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 28), [
      kitMaterial(kit.uniforms, { color: 0xf2f2f2 }).material,
      kitMaterial(kit.uniforms, { map: pokeballTexture(), roughness: 0.4, glow: 0.25 }).material,
      kitMaterial(kit.uniforms, { color: 0xf2f2f2 }).material,
    ]);
    disc.position.copy(eave.lerp(ridge, 0.45)).addScaledVector(n, 0.05);
    disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
    parts.extras.push(disc);
  } else if (p.kind === 'mart') {
    addBox(glass, p.doorX + 0.5, f.y0 + 0.62, f.zf + 0.07, 1.3, 1.22, 0.04, toLinear([0.55, 0.72, 0.85]));
    parts.extras.push(signBoard('POKé MART', '#ffffff', css(p.roof), signW, signW * 0.17, signPos, kit));
    // striped awning over the front
    const stripes = Math.max(2, Math.round(f.W * 2));
    const roofC = toLinear(p.roof);
    for (let s = 0; s < stripes; s++) {
      const g = new THREE.BoxGeometry(f.W / stripes, 0.04, 0.5);
      const m = new THREE.Matrix4().makeRotationX(0.35).premultiply(
        new THREE.Matrix4().makeTranslation(f.X0 + (s + 0.5) * (f.W / stripes), f.y0 + H - 0.62, f.zf + 0.25));
      body.add(g, s % 2 ? white : roofC, m);
      g.dispose();
    }
  } else if (p.kind === 'gym') {
    parts.extras.push(signBoard('POKéMON GYM', '#ffffff', css(scale(p.roof, 0.7)), signW, signW * 0.17, signPos, kit));
    for (const dx of [-0.35, 1.35]) {
      const g = new THREE.CylinderGeometry(0.12, 0.14, H, 10);
      body.add(g, white, new THREE.Matrix4().makeTranslation(p.doorX + dx, f.y0 + H / 2, f.zf + 0.25));
      g.dispose();
    }
  } else if (p.kind === 'lab') {
    const vent = toLinear([0.7, 0.72, 0.75]);
    addBox(body, f.X0 + 0.8, f.eave + rise * 0.5 + 0.12, f.zm + 0.2, 0.3, 0.25, 0.3, vent);
    addBox(body, f.X1 - 1.2, f.eave + rise * 0.5 + 0.12, f.zm + 0.2, 0.3, 0.25, 0.3, vent);
    const dish = new THREE.SphereGeometry(0.32, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.5);
    body.add(dish, white, new THREE.Matrix4().makeRotationX(-0.9).premultiply(
      new THREE.Matrix4().makeTranslation(f.X1 - 0.5, f.eave + rise + 0.35, f.zm)));
    dish.dispose();
  }
}

/** Front wall textured with the ROM facade (Scale4x-upscaled) so special buildings keep their signage. */
function addSpecialFacade(p: BuildingPlacement, f: BuildingFrame, parts: BuildingParts, kit: KitContext): void {
  if (!p.facade) return;
  const { w, h, px } = p.facade;
  const wall = p.wall.map((v) => Math.round(v * 255));
  const src = new Uint32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = px[i];
    const c = v & 0x8000 ? wall : bgr555ToSrgb(v).map((k) => Math.round(k * 255));
    src[i] = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
  }
  const big = scale4x(src, w, h);
  const W4 = w * 4, H4 = h * 4;
  // DataTexture rows run bottom-up: flip while copying.
  const flipped = new Uint32Array(W4 * H4);
  for (let y = 0; y < H4; y++) flipped.set(big.subarray(y * W4, (y + 1) * W4), (H4 - 1 - y) * W4);
  const tex = new THREE.DataTexture(new Uint8Array(flipped.buffer), W4, H4, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  kit.disposables.push(tex);
  const H = f.eave - f.y0;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(f.W, H),
    kitMaterial(kit.uniforms, { map: tex, roughness: 0.85, fade: true }).material);
  mesh.position.set(f.cx, f.y0 + H / 2, f.zf + 0.012);
  mesh.receiveShadow = true;
  parts.extras.push(mesh);
}
```

(Signs/emblem/facade meshes are added via `parts.extras`; their materials and geometries are disposed by `disposeKit`; the cached canvas textures are deliberately not registered in `kit.disposables`.)

- [ ] **Step 6: Verify** — `npx tsc --noEmit && npm test` → pass. `npx tsx tools/regress.ts --label t13 --only oldale,petalburg,rustboro,slateport,mauville,lilycove,fortree,mossdeep`. Acceptance: Pokémon Centers have the red roof, glass doors, a Poké Ball emblem on the roof and a "POKéMON CENTER" sign; Marts have the blue roof, striped awning and "POKé MART" sign; Gyms have pillars and a "POKéMON GYM" sign; Birch's lab has vents and a dish; special buildings (Slateport museum/shipyard, Lilycove department store/museum/contest hall, Mauville game corner) are 3D blocks whose front shows their ROM facade, smoothly upscaled (no blur, no jagged pixels); signs glow softly at night.

- [ ] **Step 7: Commit**

```bash
git add src/render/kit tests/kitUpscale.test.ts docs/superpowers/progress/modern-3d.md
git commit -m "feat(kit): Pokémon Center, Mart, Gym and lab details; upscaled facades for special buildings"
```

---

### Task 14: General-tileset table and props (signs, mailboxes, fences, lamps, rocks, bushes)

**Files:**
- Modify: `tools/map-atlas.ts` (zoomed sheet options)
- Create: `src/render/kit/tables/general.ts`, `src/render/kit/props.ts`, `tests/kitTables.test.ts`
- Modify: `src/render/kit/index.ts`, `src/render/kit/trees.ts` (export `blobCrown`)

**Interfaces:**
- Produces (`tables/general.ts`): `type PropKind = 'sign' | 'mailbox' | 'fenceWhite' | 'fenceWood' | 'fenceMetal' | 'lamp' | 'rock' | 'bush' | 'bollard'`, `GENERAL_PROPS: ReadonlyMap<number, PropKind>`, `GENERAL_ROCK`, `GENERAL_PINE`, `GENERAL_FLOWERS: ReadonlySet<number>`, `installGeneralTables(): void`.
- Produces (`props.ts`): `interface PropPlacement { kind: PropKind; x0: number; x1: number; y: number; h: number; color: RGB }`, `blockRun(a, x, y, isB): [number, number]`, `propFamily: Family<PropPlacement[]>`.

- [ ] **Step 1: Zoomed tileset sheets** — in `tools/map-atlas.ts`:
  - parse `const sheetScale = Number(argVal('--sheet-scale') ?? 3); const sheetChunk = Number(argVal('--sheet-chunk') ?? 128); const sheetOnly = argVal('--sheet-only');`
  - `renderSheet` uses `const K = sheetScale;` instead of `3`, and the label offsets scale with it (`cellW = 16 * K * 2 + 6`, labels unchanged);
  - the sheets loop skips tilesets whose `tilesetName(addr)` does not contain `sheetOnly` (when given) and steps `first += sheetChunk` with `Math.min(sheetChunk, …)`.

Run: `npx tsx tools/map-atlas.ts --no-maps --sheet-only General --sheet-scale 5 --sheet-chunk 32` → `out/atlas/tilesets/General_000.png … General_1e0.png` (16 sheets of 32 metatiles).

- [ ] **Step 2: Label the General tileset**

View each of the 16 sheets (Read tool) and record in `src/render/kit/tables/general.ts` every metatile id that shows: a signboard (`sign`), a mailbox (`mailbox`), white picket fence (`fenceWhite`), wooden fence (`fenceWood`), grey post/chain or metal fence (`fenceMetal`), lamp post (`lamp`), a free-standing rock or boulder on grass/sand (`rock`), a small round bush that is not a tree (`bush`), a bollard/short post (`bollard`); brown/grey rock-face and cliff tiles → `GENERAL_ROCK`; triangular conifer tree tiles → `GENERAL_PINE`; flower tiles → `GENERAL_FLOWERS`. Known from the 3× sheets: `0x004` flowers; `0x003` grey metal sign/mailbox board; `0x01B` wooden double signpost; the grey post-and-chain run `0x13A–0x152` region (confirm each id). Ids not listed fall back to the colour heuristics, so omissions are safe; mislabels are not — when unsure, leave it out.

File skeleton:

```ts
// Curated semantics for gTileset_General metatile ids (the primary tileset of every outdoor
// map). Labelled from: npx tsx tools/map-atlas.ts --no-maps --sheet-only General --sheet-scale 5 --sheet-chunk 32

import { setRockIds } from '../cliffs';
import { setPineIds } from '../trees';
import { setFlowerIds } from '../flowers';

export type PropKind = 'sign' | 'mailbox' | 'fenceWhite' | 'fenceWood' | 'fenceMetal' | 'lamp' | 'rock' | 'bush' | 'bollard';

export const GENERAL_PROPS: ReadonlyMap<number, PropKind> = new Map<number, PropKind>([
  [0x003, 'sign'],
  [0x01b, 'sign'],
  // … every labelled prop id from Step 2
]);

export const GENERAL_ROCK: ReadonlySet<number> = new Set<number>([
  // … rock-face / cliff ids from Step 2
]);

export const GENERAL_PINE: ReadonlySet<number> = new Set<number>([
  // … conifer tree ids from Step 2
]);

export const GENERAL_FLOWERS: ReadonlySet<number> = new Set<number>([0x004 /* … */]);

/** Hooks the tables into the families (ids are only consulted when the primary tileset is General). */
export function installGeneralTables(): void {
  setRockIds((m) => GENERAL_ROCK.has(m));
  setPineIds((m) => GENERAL_PINE.has(m));
  setFlowerIds((m) => GENERAL_FLOWERS.has(m));
}
```

(The `// …` lines are filled by the labelling in this step; the committed file contains only real ids.)

- [ ] **Step 3: Write the failing test** — `tests/kitTables.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { propFamily, blockRun } from '../src/render/kit/props';
import { GENERAL_PROPS } from '../src/render/kit/tables/general';
import { analyze, K } from '../src/render/overworld/analyze';
import { Claims, CLAIM_OBJECT } from '../src/render/overworld/claims';
import { fakeInfo } from './helpers/fakeMap';

function map(rows: string[], ids: Record<string, number>, generalPrimary: boolean) {
  const info = fakeInfo();
  const w = rows[0].length, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => {
    cells[y * w + x] = ch === '.' ? 1 | 0x3000 : ids[ch] | 0x0400;
  }));
  return analyze({ width: w, height: h, cells, border: [1, 1, 1, 1], borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary, indoor: false, underground: false, margin: 1 });
}

describe('props', () => {
  const sign = [...GENERAL_PROPS.entries()].find(([, k]) => k === 'sign')![0];
  it('a sign event on a lone block becomes a sign', () => {
    const a = map(['.....', '..S..', '.....'], { S: 9 }, false);
    const claims = new Claims(a.N);
    const out = propFamily.extract({ a, events: { warps: [], signs: [{ x: 2, y: 1 }] }, quality: 'medium' }, claims);
    expect(out.map((p) => p.kind)).toEqual(['sign']);
    expect(claims.has(a.idx(2, 1), CLAIM_OBJECT)).toBe(true);
  });
  it('table ids are used only when the primary tileset is General', () => {
    const a1 = map(['.....', '..S..', '.....'], { S: sign }, true);
    const a2 = map(['.....', '..S..', '.....'], { S: sign }, false);
    const none = { warps: [], signs: [] };
    expect(propFamily.extract({ a: a1, events: none, quality: 'medium' }, new Claims(a1.N))).toHaveLength(1);
    expect(propFamily.extract({ a: a2, events: none, quality: 'medium' }, new Claims(a2.N))).toHaveLength(0);
  });
  it('blockRun finds the vertical run containing a cell', () => {
    const a = map(['..#..', '..#..', '..#..', '.....'], { '#': 9 }, false);
    // the margin row above the map is border (always blocked), so stay inside the map
    expect(blockRun(a, 2, 1, (i) => a.cellY(i) >= 0 && a.kind[i] === K.Block)).toEqual([0, 2]);
  });
});
```

- [ ] **Step 4: Run** — `npx vitest run tests/kitTables.test.ts` → FAIL.

- [ ] **Step 5: Implement `src/render/kit/props.ts`**

In `trees.ts` change `function blobCrown` to `export function blobCrown`. Then:

```ts
// Props: sign posts and mailboxes (from sign events and the General table), fences built as
// continuous runs, lamp posts that glow at night, rocks and bushes.

import * as THREE from 'three';
import { K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_OBJECT, type Claims } from '../overworld/claims';
import { dominantColor, luma, soften, toLinear, scale, type RGB } from './palette';
import { MeshBuilder, hashCell, noise3 } from './geom';
import { kitMaterial } from './materials';
import { blobCrown } from './trees';
import { GENERAL_PROPS, type PropKind } from './tables/general';
import type { Family, KitContext, SemanticContext } from './semantics';

export interface PropPlacement { kind: PropKind; x0: number; x1: number; y: number; h: number; color: RGB }

/** Inclusive [top, bottom] rows of the vertical run of `isB` cells containing (x, y). */
export function blockRun(a: MapAnalysis, x: number, y: number, isB: (i: number) => boolean): [number, number] {
  let t = y, b = y;
  while (t - 1 >= a.minY && isB(a.idx(x, t - 1))) t--;
  while (b + 1 < a.maxY && isB(a.idx(x, b + 1))) b++;
  return [t, b];
}

const FENCES = new Set<PropKind>(['fenceWhite', 'fenceWood', 'fenceMetal']);

export const propFamily: Family<PropPlacement[]> = {
  name: 'props',

  extract({ a, events }: SemanticContext, claims: Claims): PropPlacement[] {
    if (a.opts.indoor || a.opts.underground) return [];
    const out: PropPlacement[] = [];
    const isB = (i: number) => a.kind[i] === K.Block && !claims.has(i, CLAIM_OBJECT);
    const groundUnder = (x: number, bottom: number) => {
      const bi = a.inside(x, bottom + 1) ? a.idx(x, bottom + 1) : -1;
      return bi >= 0 && !Number.isNaN(a.height[bi]) && a.kind[bi] !== K.Water ? Math.max(0, a.height[bi]) : a.groundH[a.idx(x, bottom)];
    };
    const colorOf = (m: number) => soften(dominantColor(a.info.both, [m], (c) => luma(c) > 0.2) ?? [0.6, 0.6, 0.6]);
    const take = (x: number, t: number, b: number, h: number) => {
      for (let y = t; y <= b; y++) {
        const i = a.idx(x, y);
        claims.claim(i, CLAIM_OBJECT);
        claims.groundY[i] = h;
      }
    };
    // 1. sign events on short block runs
    for (const s of events.signs) {
      if (!a.inside(s.x, s.y) || !isB(a.idx(s.x, s.y))) continue;
      const [t, b] = blockRun(a, s.x, s.y, isB);
      if (b - t > 1) continue;
      const nearBuilding = [-1, 1].some((d) => a.inside(s.x + d, s.y) && a.kind[a.idx(s.x + d, s.y)] === K.Building);
      const h = groundUnder(s.x, b);
      out.push({ kind: nearBuilding ? 'mailbox' : 'sign', x0: s.x, x1: s.x, y: b, h, color: colorOf(a.mt[a.idx(s.x, s.y)]) });
      take(s.x, t, b, h);
    }
    // 2. curated General ids
    if (a.opts.generalPrimary) {
      const fenceCells = new Map<string, PropKind>();
      for (let i = 0; i < a.N; i++) {
        if (!isB(i)) continue;
        const kind = GENERAL_PROPS.get(a.mt[i]);
        if (!kind) continue;
        const x = a.cellX(i), y = a.cellY(i);
        const [t, b] = blockRun(a, x, y, isB);
        if (b - t > 1) continue;
        if (FENCES.has(kind)) { fenceCells.set(`${x},${y}`, kind); continue; }
        const h = groundUnder(x, b);
        out.push({ kind, x0: x, x1: x, y: b, h, color: colorOf(a.mt[i]) });
        take(x, t, b, h);
      }
      // fences: horizontal runs of the same fence kind
      const seen = new Set<string>();
      for (const [key, kind] of fenceCells) {
        if (seen.has(key)) continue;
        const [x, y] = key.split(',').map(Number);
        let x0 = x, x1 = x;
        while (fenceCells.get(`${x0 - 1},${y}`) === kind) x0--;
        while (fenceCells.get(`${x1 + 1},${y}`) === kind) x1++;
        const h = groundUnder(x0, y);
        for (let k = x0; k <= x1; k++) { seen.add(`${k},${y}`); take(k, y, y, h); }
        out.push({ kind, x0, x1, y, h, color: colorOf(a.mt[a.idx(x0, y)]) });
      }
    }
    return out;
  },

  build(list: PropPlacement[], _ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!list.length) return null;
    const mb = new MeshBuilder();
    const glow = new MeshBuilder();
    const post = toLinear([0.42, 0.3, 0.2]);
    const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, c: RGB, into = mb) => {
      const g = new THREE.BoxGeometry(sx, sy, sz);
      into.add(g, c, new THREE.Matrix4().makeTranslation(cx, cy, cz));
      g.dispose();
    };
    const cyl = (cx: number, cy: number, cz: number, r: number, h: number, c: RGB) => {
      const g = new THREE.CylinderGeometry(r, r, h, 8);
      mb.add(g, c, new THREE.Matrix4().makeTranslation(cx, cy, cz));
      g.dispose();
    };
    for (const p of list) {
      const c = toLinear(p.color);
      const z = p.y + 0.5 + p.h;
      const cx = (p.x0 + p.x1 + 1) / 2;
      switch (p.kind) {
        case 'sign':
          cyl(cx - 0.3, p.h + 0.35, z, 0.04, 0.7, post);
          cyl(cx + 0.3, p.h + 0.35, z, 0.04, 0.7, post);
          box(cx, p.h + 0.62, z + 0.03, 0.8, 0.46, 0.06, c);
          break;
        case 'mailbox':
          cyl(cx, p.h + 0.3, z, 0.05, 0.6, post);
          box(cx, p.h + 0.72, z, 0.36, 0.3, 0.5, c);
          break;
        case 'lamp':
          cyl(cx, p.h + 0.85, z, 0.05, 1.7, toLinear([0.25, 0.27, 0.3]));
          box(cx, p.h + 1.78, z, 0.26, 0.26, 0.26, toLinear([1, 0.92, 0.7]), glow);
          break;
        case 'rock': {
          const g = new THREE.IcosahedronGeometry(0.42, 1);
          const pos = g.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            const k = 1 + 0.18 * noise3(pos.getX(i) * 3 + cx, pos.getY(i) * 3, pos.getZ(i) * 3 + z);
            pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.75, pos.getZ(i) * k);
          }
          g.computeVertexNormals();
          mb.add(g, c, new THREE.Matrix4().makeTranslation(cx, p.h + 0.25, z));
          g.dispose();
          break;
        }
        case 'bush': {
          const g = blobCrown(hashCell(p.x0, p.y), 4, 0.2, 0.22, 0.3, 0.3, 0.1, 1);
          mb.add(g, c, new THREE.Matrix4().makeTranslation(cx, p.h, z));
          g.dispose();
          break;
        }
        case 'bollard':
          cyl(cx, p.h + 0.3, z, 0.1, 0.6, c);
          break;
        default: {
          // fences: posts on every cell boundary, rails along the run
          const metal = p.kind === 'fenceMetal';
          const rail = metal ? scale(c, 0.8) : c;
          for (let x = p.x0; x <= p.x1 + 1; x++) {
            if (metal) cyl(x, p.h + 0.3, z, 0.06, 0.6, c);
            else box(x, p.h + 0.3, z, 0.09, 0.62, 0.09, c);
          }
          const len = p.x1 - p.x0 + 1;
          for (const ry of metal ? [0.42] : [0.22, 0.48]) box(cx, p.h + ry, z, len, 0.06, 0.05, rail);
        }
      }
    }
    const root = new THREE.Group();
    const body = new THREE.Mesh(mb.build(), kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.85, flatShading: true, fade: true }).material);
    body.castShadow = true;
    body.receiveShadow = true;
    root.add(body);
    if (!glow.empty) root.add(new THREE.Mesh(glow.build(), kitMaterial(kit.uniforms, { vertexColors: true, glow: 2.5 }).material));
    return root;
  },
};
```

- [ ] **Step 6: Register and install tables** — `src/render/kit/index.ts` becomes:

```ts
// Model families in claim-priority order: objects first, terrain last (it covers the ground
// under every object the earlier families claimed).

import type { Family } from './semantics';
import { buildingFamily } from './buildings';
import { propFamily } from './props';
import { treeFamily } from './trees';
import { cliffFamily } from './cliffs';
import { grassFamily } from './grass';
import { flowerFamily } from './flowers';
import { waterFamily } from './water';
import { terrainFamily } from './terrain';
import { installGeneralTables } from './tables/general';

installGeneralTables();

export const FAMILIES: readonly Family<unknown>[] = [
  buildingFamily, propFamily, treeFamily, cliffFamily, grassFamily, flowerFamily, waterFamily, terrainFamily,
];
```

- [ ] **Step 7: Run tests** — `npx vitest run tests/kitTables.test.ts` → PASS; `npx tsc --noEmit && npm test` → pass.

- [ ] **Step 8: Visual check** — `npx tsx tools/regress.ts --label t14`. Acceptance: signs and mailboxes are 3D posts with boards in the tile's colour (Littleroot mailboxes beside the houses), fences are continuous posts+rails along their runs, lamps glow at hour 21, small rocks/bushes are 3D, and nothing that is part of a cliff, building or tree was turned into a prop.

- [ ] **Step 9: Commit**

```bash
git add tools/map-atlas.ts src/render/kit tests/kitTables.test.ts docs/superpowers/progress/modern-3d.md
git commit -m "feat(kit): curated General tileset table; signs, mailboxes, fences, lamps, rocks, bushes"
```

---

### Task 15: Semantic smoke tests and legacy-coverage report

**Files:**
- Create: `tests/smoke/semantics.test.ts`

**Interfaces:**
- Consumes: `loadStaticMap`, `REGRESSION_MAPS` (Task 2), `analyze`, `extractAll`, `FAMILIES`, `gridEvents`.
- Produces: `out/coverage.txt` (per-map legacy share) and assertions pinning the semantics on real maps.

- [ ] **Step 1: Write the smoke test**

```ts
// Semantic layer on real maps (needs the ROM). Also writes the legacy-coverage report.
//   npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/semantics.test.ts

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadStaticMap } from './helpers/staticMap';
import { REGRESSION_MAPS } from './helpers/maps';
import { analyze, K, type MapAnalysis } from '../../src/render/overworld/analyze';
import { extractAll, type Extracted } from '../../src/render/kit/semantics';
import { FAMILIES } from '../../src/render/kit/index';
import { gridEvents } from '../../src/render/kit/events';
import { CLAIM_OBJECT, CLAIM_SURFACE } from '../../src/render/overworld/claims';
import type { BuildingPlacement } from '../../src/render/kit/buildings';

function run(g: number, n: number): { a: MapAnalysis; ex: Extracted | null } {
  const s = loadStaticMap(g, n);
  const a = analyze(s.grid, { ...s.opts, margin: 14 });
  const outdoor = !s.opts.indoor && !s.opts.underground;
  return { a, ex: outdoor ? extractAll({ a, events: gridEvents(s.map.events, 0), quality: 'medium' }, FAMILIES) : null };
}

function legacyShare(a: MapAnalysis, ex: Extracted | null): number {
  let total = 0, legacy = 0;
  for (let i = 0; i < a.N; i++) {
    if (a.kind[i] === K.Void) continue;
    total++;
    const bits = ex ? ex.claims.bits[i] : 0;
    const object = a.kind[i] === K.Block || a.kind[i] === K.Tree || a.kind[i] === K.Building;
    if (!(bits & CLAIM_SURFACE) || (object && !(bits & CLAIM_OBJECT))) legacy++;
  }
  return total ? legacy / total : 0;
}

const payload = <T>(ex: Extracted | null, name: string) => (ex?.payloads.get(name) ?? []) as T;

describe('semantics on real maps', () => {
  it('Littleroot: two houses and the lab', () => {
    const { ex } = run(0, 9);
    expect(payload<BuildingPlacement[]>(ex, 'buildings').map((b) => b.kind).sort()).toEqual(['house', 'house', 'lab']);
  });
  it('Oldale: one Pokémon Center and one Mart', () => {
    const kinds = payload<BuildingPlacement[]>(run(0, 10).ex, 'buildings').map((b) => b.kind);
    expect(kinds.filter((k) => k === 'pc')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'mart')).toHaveLength(1);
  });
  it('Route 101 has tall grass, Petalburg Woods a forest', () => {
    expect(payload<unknown[]>(run(0, 16).ex, 'grass').length).toBeGreaterThanOrEqual(20);
    expect(payload<unknown[]>(run(24, 11).ex, 'trees').length).toBeGreaterThanOrEqual(100);
  });
  it('Slateport has water with a shoreline', () => {
    const w = payload<{ cells: unknown[]; dist: Uint8Array }>(run(0, 1).ex, 'water');
    expect(w.cells.length).toBeGreaterThan(100);
    expect([...w.dist].filter((d) => d === 1).length).toBeGreaterThan(20);
  });
  it('indoor and cave maps are left to legacy', () => {
    expect(run(1, 0).ex).toBeNull();
    expect(run(24, 7).ex).toBeNull();
  });
  it('no family fails on the regression maps; legacy coverage report', () => {
    const lines: string[] = [];
    let sum = 0, count = 0;
    for (const [name, g, n] of REGRESSION_MAPS) {
      const { a, ex } = run(g, n);
      if (ex) {
        expect(ex.report.filter((r) => !r.ok), name).toEqual([]);
        const share = legacyShare(a, ex);
        sum += share;
        count++;
        lines.push(`${name.padEnd(12)} ${(share * 100).toFixed(1)}% legacy`);
      } else {
        lines.push(`${name.padEnd(12)} (indoor/cave: legacy by design)`);
      }
    }
    const avg = sum / count;
    lines.push(`average      ${(avg * 100).toFixed(1)}% legacy (outdoor maps)`);
    const out = path.resolve(import.meta.dirname, '../../out/coverage.txt');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, lines.join('\n') + '\n');
    expect(avg).toBeLessThanOrEqual(0.15);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/semantics.test.ts`
Expected: PASS. If an assertion fails, find the cause in the owning family (write a focused unit test for the case first), fix, re-run. If the average legacy share is above 15 %, read `out/coverage.txt`, find the map with the highest share, render it (`npx tsx tools/shot3d.ts --query "map=G.N&hour=11&style=modern" --name cov`) to see which objects are still legacy, and extend the responsible family or the General table.

- [ ] **Step 3: Commit**

```bash
git add tests/smoke/semantics.test.ts src docs/superpowers/progress/modern-3d.md
git commit -m "test: semantic smoke tests on real maps and legacy coverage report"
```

---

### Task 16: Lighting polish, quality scaling, performance pass

**Files:**
- Modify: `src/render/renderer.ts`, `src/render/preview.ts`, `src/render/overworld/overworldView.ts`, `src/render/post.ts`

**Interfaces:**
- Consumes: existing `PostFX.setTiltShift(focus, band, strength)`.
- Produces: `Renderer.setWorldStyle(s: WorldStyle)`; `OverworldView.setShadowQuality(q: Quality)`.

- [ ] **Step 1: Soft shadows by quality** — in `renderer.ts` and `preview.ts` constructors: `this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;`. In `overworldView.ts` add:

```ts
  /** Sun shadow resolution by quality (low 1024, medium 2048, high 4096). */
  setShadowQuality(q: Quality): void {
    const size = q === 'low' ? 1024 : q === 'high' ? 4096 : 2048;
    if (this.sun.shadow.mapSize.x === size) return;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }
```

and call `this.overworld.setShadowQuality(quality)` (renderer) / `this.view.setShadowQuality(quality)` (preview) after setting `quality`.

- [ ] **Step 2: Gentler tilt-shift in Modern style** — `PostFX.setTiltShift(focus, band, strength)` already exists (unused so far; defaults are focus 0.52, band 0.22, strength 2.2). Add to `renderer.ts`:

```ts
  /** Modern / Retro world style: rebuilds the world and adapts the miniature blur. */
  setWorldStyle(s: WorldStyle): void {
    this.overworld.setWorldStyle(s);
    if (s === 'modern') this.post.setTiltShift(0.52, 0.3, 1.2);
    else this.post.setTiltShift(0.52, 0.22, 2.2);
  }
```

  (import `type WorldStyle` from `./overworld/world`). In `main.ts` `applySettings`, replace `renderer.overworld.setWorldStyle(s.worldStyle);` with `renderer.setWorldStyle(s.worldStyle);`. In `preview.ts`, after creating `this.post`: `if (this.view.worldStyle === 'modern') this.post.setTiltShift(0.52, 0.3, 1.2);`.

- [ ] **Step 3: Performance check** — `npx tsx tools/regress.ts --label t16`. Read `out/regress/t16/stats.json`. Budgets for every map/hour: `calls ≤ 150`, `triangles ≤ 1500000`, `buildMs ≤ 150`. For each over-budget map, fix the largest contributor:
  - triangles: lower crown blob count/detail for `bushy`, drop grass blades to the low setting on maps with > 1500 grass cells, merge fence/prop geometry (already merged);
  - calls: merge per-variant tree instanced meshes that have < 10 instances into a static merged mesh, or drop variants from 3 to 2;
  - buildMs: profile with `performance.now()` around each family in `runKit` (temporary `console.log`), cache any per-build geometry that does not depend on the map.
  Re-run until all budgets hold; record the final max values in the progress log.

- [ ] **Step 4: Visual pass** — review `out/regress/t16/_sheet_h11.png`, `_sheet_h21.png`: lighting consistent (no unlit/black surfaces, no over-bright glows), shadows soft, tilt-shift subtle. `granite` and `house` still identical to `before`.

- [ ] **Step 5: Verify and commit** — `npx tsc --noEmit && npm test` → pass; golden + semantics smoke → pass.

```bash
git add src docs/superpowers/progress/modern-3d.md
git commit -m "feat: soft shadows by quality, gentler tilt-shift for Modern style, performance pass"
```

---

### Task 17: Live-play verification, docs, Phase 1 wrap-up

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/superpowers/progress/modern-3d.md`

- [ ] **Step 1: Live play through map connections** — with existing save states:

```bash
npx tsx tools/shot3d.ts --state out/littleroot.state --wait 3000 --shots 3 --interval 1200 --keys "UP:2500" --name p1_live_lr
npx tsx tools/shot3d.ts --state out/r101.state --wait 3000 --shots 3 --interval 1200 --keys "UP:3000" --name p1_live_r101
```

Acceptance: no `[page error]`; the world rebuilds across the Littleroot → Route 101 → Oldale connections with correct buildings on both sides (no duplicated or missing kit objects); the player is never hidden; tall grass parts around the player; the frame shows Modern style throughout. Then toggle style live: `npx tsx tools/shot3d.ts --state out/littleroot.state --wait 3000 --eval "(() => { const r = window.emu.renderer; r.setWorldStyle('retro'); return 'ok'; })()" --name p1_live_retro` → Retro look returns.

- [ ] **Step 2: Final regression set** — `npx tsx tools/regress.ts --label phase1` and `npx tsx tools/regress.ts --label phase1_retro --style retro`. Compare `phase1_retro` to `before` (must look identical) and `phase1` to `before` (the upgrade). Run all tests: `npm test`, `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/golden.test.ts tests/smoke/semantics.test.ts`, `npx tsc --noEmit`.

- [ ] **Step 3: Docs** — README "What you're looking at → Overworld" paragraph: describe Modern style (real 3D terrain, cliffs, water, trees, grass, flowers, buildings, props; colours sampled from the ROM; dithered see-through around the player) and the `World style` setting (Retro 3D keeps the pixel-art reconstruction). Add `npm run regress` to "Developer tools". `CLAUDE.md`: point "Active work" at Phase 2 (plan to be written) and list `npm run regress` + the smoke commands. Progress log: mark Phase 1 done with the final stats and coverage numbers, list known gaps (caves and indoor maps still legacy until Phase 4; waterfalls are flat; any families/maps with notable heuristics issues).

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md docs/superpowers/progress/modern-3d.md
git commit -m "docs: Phase 1 modern 3D outdoor environment complete"
```

- [ ] **Step 5: Whole-branch review** — request a code review of all Phase 1 commits (`git log 613fd0c..HEAD`) using superpowers:requesting-code-review; address findings; then hand back to the user with screenshots (`out/regress/phase1/_sheet_h11.png`, `_sheet_h21.png`).
