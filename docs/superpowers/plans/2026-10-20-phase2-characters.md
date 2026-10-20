# Phase 2 — Characters, Pokémon, Field Objects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Modern style, characters and overworld Pokémon become lit, rounded ("inflated") sprites with HD-smoothed edges and real shadows, and the common field objects (item balls, Strength boulders, breakable rocks, Cut trees, berry trees, the moving truck) become procedural 3D models that follow the game's live object state — while Retro renders every sprite exactly as today.

**Architecture:** A GPU *sprite field* pass turns the live sprite atlas into a per-slot inflation height field every synced frame (exact separable distance transform → `k·sqrt(d)` profile → blur). An `ActorLayer` (extracted from `OverworldView`) routes each sprite: flat decals and grass overlays stay billboard cards; upright sprites become `InflatedActors` (one instanced grid mesh displaced by vertex texture fetch, MeshStandardMaterial lighting + rim, alpha-tested shadow-depth twin, scale-free xBR edge smoothing in the fragment shader); object events whose `graphicsId` is mapped become instanced procedural models (`ObjectModels`). Verification comes first: a deterministic live-state harness (save states stepped frame by frame) and ROM-template actors in the static map preview.

**Tech Stack:** TypeScript (strict), Three.js 0.186 (WebGL2: MeshStandardMaterial + `onBeforeCompile`, InstancedBufferGeometry / InstancedMesh, HalfFloat render targets, vertex texture fetch, `compileAsync`), Vite, Vitest, puppeteer-core (headless Chrome, ANGLE D3D11).

**Spec:** `docs/superpowers/specs/2026-10-19-modern-3d-models-design.md` (§6 Phase 2; §7 Phase 3 will reuse this inflation for battlers; §9 testing; §10 budgets). Progress log: `docs/superpowers/progress/modern-3d.md`.

## Global Constraints

- **No Nintendo assets in the repository and no third-party asset downloads.** Models are procedural; colours are sampled at runtime from the live sprite pixels / palettes (emulated RAM) or ROM data.
- World mapping is fixed: grid cell (x, y) at height h → world (X = x, Y = h, Z = y + h). Upright actors stand where today's cards stand: foot = (worldX/16, h, worldY/16 − 0.5 + h).
- **Retro 3D renders every sprite exactly as today** (flat billboard cards, blob shadows, `charLight`). Gate: `regress-live --compare p2-base` reports 0.00 % differing pixels on every Retro entry after every task (sole allowed exception: Task 10's multi-piece sprites, if the controller confirms Task 10).
- Phase 2 features (inflation, xBR smoothing, object models, NPC fade) are Modern-only. **Battles (`battle/battleView.ts`) are unchanged in Phase 2**; the inflation API must stay reusable by Phase 3 (no overworld-only types in `InflatedActors` / `SpriteField`).
- Animation frames stay the game's own (atlas decoded from live OBJ VRAM every synced frame); actors keep facing the camera (yaw only), as today.
- Flat decals (shadows, ripples, footprints, tracks) and grass overlays keep their current card treatment.
- Budgets (medium quality, 1280×800, harness `--gpu`): ≤ 150 draw calls and ≤ 1.5 M triangles on every harness entry; GPU frame (median of 60, timer queries) ≤ the `p2-base` value + 1.0 ms on every live Modern entry; renderer CPU time per frame ≤ `p2-base` + 0.5 ms; new GPU memory ≤ 10 MB; DPR 2 renders without errors.
- No first-use hitch from Phase 2 materials: their programs compile at startup (`compileAsync`); `renderer.info.programs.length` does not grow when an object model first appears.
- New setting **Sprite edges: HD smooth / Pixel** (`spriteFilter: 'smooth' | 'pixel'`, default `'smooth'`), persisted with the other settings, URL override `?spriteFilter=`; Retro ignores it.
- `npx tsc --noEmit` and `npm test` pass at the end of every task; ROM smoke tests a task adds or touches pass (`npx vitest run --config tests/smoke/vitest.smoke.config.ts <file>`).
- The controller keeps `docs/superpowers/progress/modern-3d.md` up to date; implementers put learnings in their task report, not in the log.
- Bash heredocs with large content fail in this harness: write files with the editor tools; scratch scripts go in `.scratch/` (gitignored).

## Review Focus

1. **Sprite slots move between frames** (a sprite appears/disappears → every later sprite changes atlas slot): the field must be computed from the same frame's atlas the actors sample, or heights flicker/belong to another sprite. Pinned in Task 4 (`--selftest` after walking/animating steps compares the live field with a CPU reference of the *current* atlas).
2. **Objects despawn, warps and map crossings** (item ball picked up, rock smashed, connection crossed): no model instance may linger. Pinned in Task 8 (`ObjectModels` test "an empty frame clears every instance") and Task 3/5 (`ActorLayer` rebuilds its lists every frame).
3. **Live Modern ↔ Retro switch**: immediate and complete — Retro shows cards only, no inflated mesh, no models, no field pass. Pinned in Task 5 (`ActorLayer` test "switching to Retro routes every sprite back to cards") and Task 8 (models hidden in Retro).
4. **Large and edge-touching sprites** (48–64 px objects, sprites in neighbouring atlas slots, hflip, affine scale): distance field and xBR must not read across the sprite rectangle. Pinned in Task 4 (GPU fixture with two fully opaque adjacent slots: edge distance 0.5) and Task 6 (CPU rect-clamp test + GPU parity fixture).
5. **Dark and night lighting** (Flash caves, night, interiors): inflated actors are lit by the real lights (lantern, sky) — never black, not visibly darker than Retro's cards. Pinned in Task 5 by the static harness entries `granite_flash`, `r104_night` and the live indoor entry `vigoroth` with explicit acceptance.

## Key design decisions (deviations from spec §6 are marked ⚑)

- **D1 ⚑ GPU field instead of a CPU chamfer transform.** The atlas is GPU-rendered and changes every synced frame; the slot ↔ sprite assignment shifts whenever a sprite (dis)appears. A CPU transform would need either a GPU readback (pipeline stall) or a duplicate CPU decoder plus texture uploads. Four tiny instanced passes over the *used* slots (exact separable EDT: row pass + column pass, then a separable blur) cost well under 0.3 ms, need no uploads, and work unchanged for Phase 3 battlers. The maths lives in a pure TS reference (`inflateMath.ts`, unit-tested) and a browser self-test checks GPU == CPU on the live atlas.
- **D2 ⚑ One displaced front sheet, no back half.** Cards always face the camera, so the back half is never seen; the shadow-depth twin uses the same displaced sheet (DoubleSide), whose silhouette equals a lens's to within its thickness (≤ 0.19 units). Saves half the vertices; Phase 3 can add a back half behind a define if orbiting cameras need it.
- **D3 ⚑ Scale-free xBR at sampling time instead of a 4× upscaled atlas.** Sprites are magnified 3–8× on screen, so a fixed 4× atlas (4096×2048 RGBA8 = 32 MB) would still need filtering. An xBR-lv2-style filter evaluated per fragment at the actual magnification costs ~21 texel fetches on actor pixels only and no memory. CPU reference in `kit/upscale.ts` + GPU parity self-test. Nearest stays selectable.
- **D4 Removal animations fall back to the game's sprite.** Cut tree / breakable rock play `ANIM_REMOVE_OBSTACLE` (animNum 1) before the script removes them: while it plays, the object is drawn as its (inflated) sprite — the game's own break frames, ~0.5 s. Pushed boulders and everything else follow the sprite's live position every frame.
- **D5 Static preview actors from ROM templates.** No save state reaches boulders, rocks, Cut trees or berry trees. The map preview (`?map=G.N&actors=1`) decodes each object template's graphics (ROM `gObjectEventGraphicsInfoPointers`, `sObjectEventSpritePalettes`) into scratch OBJ VRAM and fakes `SpriteSnap`/`ObjectEventSnap`s, so the whole live pipeline (atlas → field → actors → models) runs on any map deterministically.
- **D6 The moving truck is a model;** its sprite is a 48×48 multi-piece subsprite that today's atlas draws garbled (verified: `out/lr_out.state`). Task 10 composes multi-piece subsprites in the atlas for world sprites (truck, Briney's boat, S.S. Tidal) in **both** styles — a decoding bug fix that changes Retro pixels of those sprites only (**controller to confirm**; Task 10 can be dropped without affecting the others).
- **D7 Optional NPC occlusion fade (Task 11)** limited to the 3 nearest NPCs within 4 cells of the player (the ones you interact with); dropping it leaves the Phase 1 behaviour.

---

## File Structure

Created:
- `tools/regress-live.ts` — deterministic live-state + static-actor regression harness (PNGs, contact sheets, centre-crop sheet, stats, pixel diff, GPU timing, self-tests).
- `src/input/keyNames.ts` — `keyMask('LEFT+A')` for scripted input.
- `src/game/rom/objectGraphics.ts` — ROM decode of object graphics info, frame images, object palettes.
- `src/render/previewActors.ts` — `blankSprite()`, ROM-template actors for the static preview.
- `src/render/actors/actorLayer.ts` — per-frame routing of sprites to cards / inflated actors / models (extracted from `OverworldView.buildBillboards`).
- `src/render/actors/inflateMath.ts` — CPU reference: row distances, EDT, profile, blur, gradient.
- `src/render/actors/spriteField.ts` — GPU field passes (`SpriteField`).
- `src/render/actors/inflatedActors.ts` — instanced inflated mesh, depth twin, contact-shadow geometry.
- `src/render/actors/xbr.glsl.ts` — scale-free xBR GLSL.
- `src/render/actors/selfTest.ts` — GPU-vs-CPU parity checks (field, xBR) for the harness.
- `src/render/actors/objectMap.ts` — graphicsId → model kind, berry stage, removal fallback (pure).
- `src/render/actors/spriteColors.ts` — CPU sprite decode (indices) + colour picking + cache.
- `src/render/actors/models.ts` — procedural geometries (Poké Ball, boulder, cracked rock, Cut tree, truck, berry plants).
- `src/render/actors/objectModels.ts` — `ObjectModels`: instanced placement per kind, tints, precompile.
- `src/game/subsprites.ts` — (Task 10) subsprite table decode + composed bounds.
- Tests: `tests/keyNames.test.ts`, `tests/actorLayer.test.ts`, `tests/inflateMath.test.ts`, `tests/spriteField.test.ts`, `tests/inflatedActors.test.ts`, `tests/kitXbr.test.ts`, `tests/objectMap.test.ts`, `tests/spriteColors.test.ts`, `tests/actorModels.test.ts`, `tests/objectModels.test.ts`, `tests/subsprites.test.ts`, `tests/fadeActors.test.ts` (Task 11), `tests/smoke/objectGraphics.test.ts`.

Modified:
- `src/main.ts` — `?manual=1` stepping API, URL overrides (`style`, `camera`, `spriteFilter`), `emu.step / gpuFrames / selfTest`.
- `src/render/renderer.ts` — `setFixedTimestep`, `stats()`, owns `SpriteField`, sprite filter.
- `src/render/preview.ts` — `&actors=1`, `&manual=1` + `frames(n)`, `focusGfx/focusObj`, `&removing=1`, atlas + field updates.
- `src/render/overworld/overworldView.ts` — delegates sprites to `ActorLayer`; re-exports `hidesGrassOverlay`.
- `src/render/overworld/billboards.ts` — structural atlas type; `BlobShadows` takes any shadow-geometry source + `setScale`.
- `src/render/overworld/sky.ts`, `src/render/battle/battleView.ts` — sky time from the view clock (determinism).
- `src/render/spriteAtlas.ts` — `slotRects` / `slotCount` accessors; (Task 10) subsprite pieces.
- `src/game/state.ts` — `SpriteSnap.animNum / images / subspriteTables / subspriteTableNum / subspriteMode`.
- `src/ui/settings.ts` — `spriteFilter`.
- `src/render/kit/upscale.ts` — `xbrSample` CPU reference.
- `src/render/kit/trees.ts` — export `smallTreeGeo(seed)` for the Cut tree.
- `src/render/kit/materials.ts` — (Task 11) extra fade foci.
- `package.json` (`regress:live` script), `README.md`, `CLAUDE.md` (Task 12).

---

### Task 1: Deterministic live regression harness + baseline

Today's tools hold keys for wall-clock milliseconds and screenshot after a wall-clock wait, so frames, NPC positions and animation phases differ run to run, and the static previews have no actors. This task makes live play steppable frame by frame with a fixed timestep and adds a harness that captures save-state scenes in both styles, with stats, diffs and GPU timing. Its first run is the Phase 2 baseline `p2-base`.

**Files:**
- Create: `tools/regress-live.ts`, `src/input/keyNames.ts`, `tests/keyNames.test.ts`
- Modify: `src/main.ts`, `src/render/renderer.ts`, `src/render/overworld/sky.ts` (`setColors` gets a `time` argument), `src/render/overworld/overworldView.ts` and `src/render/battle/battleView.ts` (pass their `time`), `package.json` (script `"regress:live": "tsx tools/regress-live.ts"`)

**Interfaces:**
- Produces: `keyMask(spec: string): number` — names joined by `+`, case-insensitive (`A B SELECT START RIGHT LEFT UP DOWN R L`), `''` → 0, unknown name throws an Error naming it.
- Produces: `Renderer.setFixedTimestep(dt: number | null): void` — when set, `render()` uses `dt` seconds per call and a virtual clock (`now += dt*1000`) for `transitionFx`, instead of `performance.now()`.
- Produces: `Renderer.stats(): { calls: number; triangles: number; programs: number }` — whole-frame totals (`webgl.info.autoReset = false`, `info.reset()` at the start of `render()`), `programs = webgl.info.programs?.length ?? 0`.
- Produces (`?manual=1`, implies autostart): the rAF loop neither emulates nor renders; `window.emu.step(keys: string, frames: number): void` runs `frames` × { `gba.keys = keyMask(keys)`; `gba.runFrame()`; `renderer.onEmulatedFrame()`; `renderer.render(1000 / 60)` } with `setFixedTimestep(1/60)`; `window.emu.gpuFrames(n: number): Promise<{ gpuMs: number; gpuP90: number; cpuMs: number }>` (n × step('', 1) with an `EXT_disjoint_timer_query_webgl2` query around `renderer.render`, `readPixels` sync after each, medians).
- Produces: URL overrides (not saved): `?style=modern|retro`, `?camera=0..3`, (Task 6) `?spriteFilter=smooth|pixel`.
- Produces CLI: `npx tsx tools/regress-live.ts --label <name> [--styles modern,retro] [--only a,b] [--dpr 1] [--query k=v&…] [--compare <label>] [--gpu] [--selftest] [--static]` (`--query` is appended to every page URL) → `out/regress-live/<label>/<entry>_<style>.png`, `_sheet_<style>.png` (4 columns), `_crops.png` (per entry: 320×400 centre crops, Modern | Retro side by side — the camera centres on the player), `stats.json` (`{ [entry_style]: { calls, triangles, programs, gpuMs?, gpuP90?, cpuMs?, diff?: { pct, bbox }, selftest? } }`, merged into an existing file of the same label so partial `--only` runs add or replace entries; sheets are rebuilt from all PNGs in the folder).

- [ ] **Step 1: Write the failing test** `tests/keyNames.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { keyMask } from '../src/input/keyNames';
import { KEY } from '../src/gba/constants';

describe('keyMask', () => {
  it('maps key names joined by +', () => {
    expect(keyMask('LEFT')).toBe(KEY.LEFT);
    expect(keyMask('A+UP')).toBe(KEY.A | KEY.UP);
    expect(keyMask('')).toBe(0);
  });
  it('is case-insensitive and rejects unknown names', () => {
    expect(keyMask('down+b')).toBe(KEY.DOWN | KEY.B);
    expect(() => keyMask('JUMP')).toThrow(/JUMP/);
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run tests/keyNames.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement `keyNames.ts`**, then the manual mode in `main.ts` (skip `waitForGesture`, never start the tick loop, expose `emu.step` / `emu.gpuFrames`), the URL overrides (applied to the in-memory settings before `applySettings`, never saved), `Renderer.setFixedTimestep` / `stats()`, and the sky clock: `Sky.setColors(sky, fog, indoor, time)` sets `uTime = time` (overworld passes `this.time`, battle its `this.time`) — no more `performance.now()` there. GPU timing follows `.scratch/t16_gpu.ts` (query per frame, `readPixels(0,0,1,1)` to sync, poll `QUERY_RESULT_AVAILABLE`, discard if `GPU_DISJOINT_EXT`).
- [ ] **Step 4: Write `tools/regress-live.ts`.** Same server/browser setup as `tools/regress.ts` (Chrome/Edge path list, `--use-angle=d3d11`, viewport 1280×800 × `--dpr`). Per entry and style: `goto /?manual=1&state=/<state>&style=<style>[&camera=..]`, wait until `window.emu?.step` exists, run `eval` (if any), run the steps, screenshot. Entry table (frame counts are starting values — tune them so the scene matches the comment and record the final numbers in the file):

```ts
interface LiveEntry { name: string; state: string; steps: [string, number][]; query?: string; eval?: string }
const LIVE: LiveEntry[] = [
  { name: 'r101', state: 'out/r101.state', steps: [['', 30]] },                              // Route 101: player, youngster, boy
  { name: 'r101_grass', state: 'out/r101.state', steps: [['LEFT', 108], ['DOWN', 18], ['', 30]] }, // standing in tall grass
  { name: 'r101_tree', state: 'out/r101.state', steps: [['LEFT', 66], ['DOWN', 42], ['', 30]] },   // against the treeline (fade)
  { name: 'r101_low', state: 'out/r101.state', query: 'camera=3', steps: [['', 30]] },         // Low preset: volume visible
  { name: 'r101_yaw', state: 'out/r101.state', eval: 'emu.renderer.overworld.yaw = 0.9', steps: [['', 30]] },
  { name: 'birch', state: 'out/s27.state', steps: [['', 30]] },                               // Birch, bag, Zigzagoon (a Pokémon)
  { name: 'lr_truck', state: 'out/lr_out.state', steps: [['', 30]] },                         // Littleroot: Mom, truck (gfx 94)
  { name: 'lr_walk', state: 'out/s22.state', steps: [['', 30]] },                             // Littleroot free walk
  { name: 'item_indoor', state: 'out/s16.state', steps: [['', 30]] },                         // indoor item ball (gfx 59)
  { name: 'truck_inside', state: 'out/truck.state', steps: [['', 30]] },                      // moving boxes (gfx 113)
  { name: 'vigoroth', state: 'out/littleroot.state', steps: [['', 30]] },                     // indoor, Vigoroths (Pokémon)
  { name: 'battle', state: 'out/battle1.state', steps: [['', 30]] },                          // must stay unchanged in Phase 2
  { name: 'transition', state: 'out/wild_transition.state', steps: [['', 20]] },
];
```

  `--compare <label>`: diff each PNG against `out/regress-live/<label>/<same file>` in the page (two `<img>` → canvases → `getImageData`; a pixel differs when any channel differs by > 8), record `pct` (2 decimals) and the bounding box, print a line per entry. `--gpu`: after the screenshot, `await emu.gpuFrames(60)`. `--static` is wired in Task 2 (no entries yet).
- [ ] **Step 5: Verify determinism.** `npm run regress:live -- --label det1` then `npm run regress:live -- --label det2 --compare det1` → every entry in both styles 0.00 %. If an entry is not stable, find the remaining wall-clock/random source (e.g. `weather.ts` seeds, only relevant with weather) and fix it or record the entry as "stats only" in the file with the reason.
- [ ] **Step 6: Capture the baseline.** `npm run regress:live -- --label p2-base --gpu` (both styles). Open `_sheet_modern.png`, `_sheet_retro.png`, `_crops.png`; check each entry shows its comment's scene. Report calls/triangles/gpuMs per entry in the task report (the controller copies them to the progress log).
- [ ] **Step 7: Typecheck, test, commit.** `npx tsc --noEmit && npm test`; `git add tools/regress-live.ts src/input/keyNames.ts tests/keyNames.test.ts src/main.ts src/render/renderer.ts src/render/overworld/sky.ts src/render/overworld/overworldView.ts src/render/battle/battleView.ts package.json && git commit -m "tools: deterministic live regression harness (save states stepped per frame, stats, diffs, GPU timing)"`

**Acceptance:** determinism run 0.00 % everywhere (or documented exceptions); `p2-base` captured; normal play (no `?manual`) unchanged in behaviour.

---

### Task 2: Static preview actors from ROM templates

Makes the map preview draw each map's object events (NPCs, item balls, boulders, rocks, Cut trees, berry trees, the truck) through the same atlas/billboard path as live play, deterministically, so models can be verified on maps no save state reaches. Also adds the sprite fields later tasks read.

**Files:**
- Create: `src/game/rom/objectGraphics.ts`, `src/render/previewActors.ts`, `tests/smoke/objectGraphics.test.ts`
- Modify: `src/game/state.ts`, `src/render/preview.ts`, `tools/regress-live.ts`, `tests/smoke/state.test.ts` (only if it pins `SpriteSnap` keys)

**Interfaces:**
- Produces (`state.ts`): `SpriteSnap` gains `animNum: number` (u8 @ sprite+0x2A), `images: number` (u32 @ +0x0C, the frame-image table: identifies a berry type / object graphics), `subspriteTables: number` (u32 @ +0x18), `subspriteTableNum: number` (u8 @ +0x42 & 0x3f), `subspriteMode: number` (u8 @ +0x42 >> 6).
- Produces (`objectGraphics.ts`):
  ```ts
  export const NUM_OBJ_EVENT_GFX = 239;
  export interface ObjectGraphicsInfo { graphicsId: number; paletteTag: number; size: number; width: number; height: number;
    paletteSlot: number; inanimate: boolean; oam: number; subspriteTables: number; anims: number; images: number }
  export function readObjectGraphicsInfo(rom: RomReader, graphicsId: number): ObjectGraphicsInfo | null; // null: id ≥ 239 or bad pointer
  export function readFrameImage(rom: RomReader, info: ObjectGraphicsInfo, frame: number): Uint8Array;    // `size` bytes, 4bpp 1D tiles
  export function readObjectPalette(rom: RomReader, tag: number): Uint16Array | null;                    // 16 BGR555 colours
  ```
  Layouts (pokeemerald `global.fieldmap.h`, `sprite.h`): `gObjectEventGraphicsInfoPointers[id]` → struct of 0x24 bytes: tileTag u16 @0, paletteTag u16 @2, reflectionPaletteTag u16 @4, size u16 @6, width s16 @8, height s16 @0xA, byte @0xC = paletteSlot:4 | shadowSize:2 | inanimate:1 | …, oam* @0x10, subspriteTables* @0x14, anims* @0x18, images* @0x1C; `SpriteFrameImage` = { data* u32, size u16 } (8 bytes); `sObjectEventSpritePalettes` = array of { data* u32, tag u16, pad } (8 bytes) ending at tag 0x11FF.
- Produces (`previewActors.ts`):
  ```ts
  export function blankSprite(p?: Partial<SpriteSnap>): SpriteSnap;   // every field defaulted (16x32, coordOffset true, …)
  export interface PreviewActors { sprites: SpriteSnap[]; objects: ObjectEventSnap[] }
  export function buildPreviewActors(rom: RomReader, vram: Uint8Array, palette: Uint16Array,
    templates: readonly ObjectEventTemplate[], opts: { removing: boolean }): PreviewActors;
  ```
  Rules: skip templates with graphicsId ≥ 239 (VAR ids); tiles of each distinct graphicsId copied once into OBJ VRAM (`vram[0x10000 + tile*32 …]`, tiles allocated sequentially); one OBJ palette slot per distinct tag (`palette[256 + slot*16 …]`, ≤ 16 slots, extra tags reuse slot 15); sprite `i` ↔ object `i` (`spriteId = index = i`); `worldX = x*16 + 8`, `worldY = y*16 + 16` (map-local preview grid, offset 0); berry trees (gfx 60–62): `animNum = localId % 5` (all five stages visible on a map); `opts.removing` sets `animNum = 1` on gfx 82 / 86.
- Produces (preview URL): `&actors=1` (fill `fakeState.sprites/objects`, update the sprite atlas every frame with `map2d = false` — object sprites use 1D mapping), `&manual=1` (no rAF loop) + `PreviewApp.frames(n: number): void` (n frames at dt = 1/60), `&focusGfx=G` (camera on the first template with graphicsId G), `&focusObj=N` (on template N), `&removing=1`.
- Produces (harness): `STATIC` entries, run with `--static`, in both styles at hour 11 unless stated:
  ```ts
  const STATIC = [
    { name: 'littleroot_npcs', q: 'map=0.9&focusGfx=94' },  { name: 'rustboro_npcs', q: 'map=0.3' },
    { name: 'r104_berries', q: 'map=0.19&focusGfx=60' },     { name: 'r104_night', q: 'map=0.19&focusGfx=60&hour=21' },
    { name: 'r116_cut', q: 'map=0.31&focusGfx=82' },         { name: 'r114_rocks', q: 'map=0.29&focusGfx=86' },
    { name: 'fiery_boulders', q: 'map=24.14&focusGfx=87' },  { name: 'r119_items', q: 'map=0.34&focusGfx=59' },
    { name: 'granite_flash', q: 'map=24.7&flash=2&focusObj=0' },
  ];
  ```
  (`/?autostart=1&manual=1&actors=1&<q>`, then `preview.frames(60)`, screenshot, `preview.stats()`.)

- [ ] **Step 1: Write the failing smoke test** `tests/smoke/objectGraphics.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { RomReader } from '../../src/game/rom/reader';
import { readObjectGraphicsInfo, readFrameImage, readObjectPalette } from '../../src/game/rom/objectGraphics';
import { loadRom } from './helpers/staticMap';

describe('object graphics from the ROM', () => {
  const rom = new RomReader(loadRom());
  it('reads the item ball, the boulder and the truck', () => {
    expect(readObjectGraphicsInfo(rom, 59)).toMatchObject({ width: 16, height: 16, paletteTag: 0x1105, inanimate: true, size: 128 });
    expect(readObjectGraphicsInfo(rom, 87)).toMatchObject({ width: 16, height: 16, paletteTag: 0x1103 });
    expect(readObjectGraphicsInfo(rom, 94)).toMatchObject({ width: 48, height: 48, paletteTag: 0x110d, size: 1152 });
    expect(readObjectGraphicsInfo(rom, 239)).toBeNull();
  });
  it('reads frame tiles and palettes by tag', () => {
    expect(readFrameImage(rom, readObjectGraphicsInfo(rom, 59)!, 0)).toHaveLength(128);
    expect(readObjectPalette(rom, 0x1105)).toHaveLength(16);
    expect(readObjectPalette(rom, 0x7777)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it** — `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/objectGraphics.test.ts` → FAIL.
- [ ] **Step 3: Implement** `objectGraphics.ts` (use `SYM.gObjectEventGraphicsInfoPointers`, `SYM.sObjectEventSpritePalettes`), the `SpriteSnap` fields, `previewActors.ts`, and the preview params. Template x/y are map-local and the preview grid has offset 0, so `ObjectEventSnap.x/y` = template x/y.
- [ ] **Step 4: Run** the smoke test → PASS; `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Look.** `npm run regress:live -- --label t2 --static --compare p2-base` — live entries 0.00 % in both styles (the new `SpriteSnap` fields change nothing). Static entries: NPCs, balls, rocks, boulders, Cut trees, berry trees appear as today's cards on their cells (the truck card is garbled, as in live play). Then add the static baseline without touching the live one: `npm run regress:live -- --label p2-base --static --gpu --only littleroot_npcs,rustboro_npcs,r104_berries,r104_night,r116_cut,r114_rocks,fiery_boulders,r119_items,granite_flash` (pick another `focusObj` for `granite_flash` if Granite Cave 1F has no object near a lit spot; record it).
- [ ] **Step 6: Commit** — `git add src/game/rom/objectGraphics.ts src/render/previewActors.ts tests/smoke/objectGraphics.test.ts src/game/state.ts src/render/preview.ts tools/regress-live.ts && git commit -m "preview: object-event actors from ROM templates; sprite anim/images/subsprite fields"`

**Acceptance:** every static entry shows its objects at their cells in both styles; live entries unchanged; static baseline captured.

---

### Task 3: `ActorLayer` — sprite routing extracted from `OverworldView` (no visual change)

`OverworldView.buildBillboards` (551-line file) becomes `actors/actorLayer.ts`, which owns the billboards and blob shadows and decides, per sprite, how it is drawn. The routes for inflated actors and models exist from now on but are drawn as cards until Tasks 5 and 8 — so this task is pixel-identical in both styles.

**Files:**
- Create: `src/render/actors/actorLayer.ts`, `tests/actorLayer.test.ts`
- Modify: `src/render/overworld/overworldView.ts` (delegate; keep `export { hidesGrassOverlay }` — `tests/kitRun.test.ts` imports it from there), `src/render/overworld/billboards.ts` (constructor takes the structural type `{ target: { texture: THREE.Texture } }` instead of `SpriteAtlas`, so node tests can build it)

**Interfaces:**
- Produces:
  ```ts
  export type ActorRoute = 'card' | 'inflated' | 'model' | 'skip';
  /** Retro: every visible sprite is a card. Modern: decals/grass are cards, uprights inflate, mapped objects are models. */
  export function routeSprite(kind: SpriteKind, style: WorldStyle, mapped: boolean): ActorRoute;
  /** Today's card placement (BillboardSpec) of a sprite: uprights on the cell centre, flats on their rectangle,
   *  grass overlays `grassOffset` in front of the legs. `heightAt(x, y)` takes grid coordinates (cell centre). */
  export function cardSpec(s: SpriteSnap, kind: SpriteKind, slot: SlotUv, heightAt: (x: number, y: number) => number,
    grassOffset?: number /* default 0.06 */): BillboardSpec;
  export interface SlotUv { u0: number; v0: number; u1: number; v1: number }
  export interface ActorAtlas { slots: ReadonlyMap<number, SlotUv>; target: { texture: THREE.Texture } }
  export interface ActorFrame {
    style: WorldStyle; classifier: SpriteClassifier | null;
    heightAt(x: number, y: number): number; hasGrassBlades(x: number, y: number): boolean;
    cameraRight: THREE.Vector3; charLight: THREE.Color;
  }
  export interface ActorLayerOptions { field?: { texture: THREE.Texture }; kit?: KitUniforms }   // used from Tasks 5/8
  export class ActorLayer {
    readonly group: THREE.Group;                          // billboards + blob shadows (+ inflated, models later)
    constructor(atlas: ActorAtlas, opts?: ActorLayerOptions);
    /** Rebuilds every list from scratch; returns the feet of upright actors (grass bending), reusing one array. */
    update(state: GameState, f: ActorFrame): readonly { x: number; y: number; z: number }[];
  }
  ```
- Consumes: `blankSprite` (Task 2) in tests.

- [ ] **Step 1: Write the failing test** `tests/actorLayer.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { SpriteKind } from '../src/game/spriteKinds';
import { routeSprite, cardSpec } from '../src/render/actors/actorLayer';
import { blankSprite } from '../src/render/previewActors';

const slot = { u0: 0, v0: 0.0625, u1: 0.015625, v1: 0 };

describe('routeSprite', () => {
  it('Retro draws every visible sprite as a card', () => {
    for (const k of [SpriteKind.Upright, SpriteKind.Flat, SpriteKind.Grass])
      for (const mapped of [false, true]) expect(routeSprite(k, 'retro', mapped)).toBe('card');
    expect(routeSprite(SpriteKind.Hidden, 'retro', false)).toBe('skip');
  });
  it('Modern inflates uprights, models mapped objects, keeps decals and grass as cards', () => {
    expect(routeSprite(SpriteKind.Upright, 'modern', false)).toBe('inflated');
    expect(routeSprite(SpriteKind.Upright, 'modern', true)).toBe('model');
    expect(routeSprite(SpriteKind.Flat, 'modern', true)).toBe('card');
    expect(routeSprite(SpriteKind.Grass, 'modern', false)).toBe('card');
    expect(routeSprite(SpriteKind.Hidden, 'modern', true)).toBe('skip');
  });
});

describe('cardSpec', () => {
  const s = blankSprite({ worldX: 40, worldY: 64, width: 16, height: 32 });
  it('stands uprights on the cell centre, at the cell height', () => {
    expect(cardSpec(s, SpriteKind.Upright, slot, () => 2)).toMatchObject(
      { footX: 2.5, footY: 2, footZ: 5.5, width: 1, height: 2, lift: 0, flat: false });
  });
  it('lays flats on their rectangle and puts grass in front of the legs', () => {
    expect(cardSpec(s, SpriteKind.Flat, slot, () => 0)).toMatchObject({ footZ: 4, flat: true });
    expect(cardSpec(s, SpriteKind.Grass, slot, () => 0).footZ).toBeCloseTo(3.56);
  });
  it('lifts jumping sprites by -y2', () => {
    expect(cardSpec(blankSprite({ worldX: 40, worldY: 64, y2: -8 }), SpriteKind.Upright, slot, () => 0).lift).toBe(0.5);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/actorLayer.test.ts` → FAIL.
- [ ] **Step 3: Implement.** Move the body of `buildBillboards` into `ActorLayer.update` + `cardSpec` unchanged in behaviour (same order of sprites, same skips: `!coordOffset || invisible`, Hidden, `hidesGrassOverlay`, missing slot). In this task `mapped` is always `false` and routes `'inflated'`/`'model'` are drawn as cards. `OverworldView` keeps the camera/lighting code, calls `actors.update(...)`, passes the returned feet to `setKitActors`, and adds `actors.group` to the scene instead of the billboards/blob meshes. Avoid per-frame allocations in the new code (reuse arrays/vectors; Phase 1 deferred minor).
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Verify pixel identity.** `npm run regress:live -- --label t3 --static --compare p2-base` → 0.00 % on every entry, both styles.
- [ ] **Step 6: Commit** — `git add src/render/actors/actorLayer.ts tests/actorLayer.test.ts src/render/overworld/overworldView.ts src/render/overworld/billboards.ts && git commit -m "refactor: ActorLayer routes overworld sprites (no visual change)"`

**Acceptance:** 0.00 % diff everywhere; `overworldView.ts` no longer builds billboard specs itself.

---

### Task 4: Inflation field — CPU reference + GPU passes + parity self-test

Computes, for every used atlas slot, the inflation height of each texel: exact Euclidean distance `d` (px) from the texel to the nearest transparent texel (outside the sprite rectangle counts as transparent), profile `h = amp·sqrt(min(d, cap))`, a 7-tap separable Gaussian blur, masked to opaque texels. Nothing is drawn with it yet; a self-test proves GPU == CPU on the live atlas.

**Files:**
- Create: `src/render/actors/inflateMath.ts`, `src/render/actors/spriteField.ts`, `src/render/actors/selfTest.ts`, `tests/inflateMath.test.ts`, `tests/spriteField.test.ts`
- Modify: `src/render/spriteAtlas.ts` (accessors), `src/render/renderer.ts` (owns + updates the field; `actorSelfTest()`), `src/render/preview.ts` (same), `src/main.ts` (`emu.selfTest()`), `tools/regress-live.ts` (`--selftest`: run after the steps of `r101_grass`, `birch`, `lr_truck`; write the result into stats and `_field_<entry>.png`)

**Interfaces:**
- Produces (`inflateMath.ts`, all texel grids row-major `w×h`, rows in atlas order (bottom-up); outside the grid = transparent):
  ```ts
  export interface InflateParams { amp: number; cap: number; window: number; sigma: number }
  export const INFLATE: InflateParams = { amp: 1.0, cap: 9, window: 12, sigma: 1.25 }; // tuned in Task 5
  /** Height (sprite px) of the flattest-topped point: amp·sqrt(cap). */
  export const inflateMax = (p: InflateParams = INFLATE) => p.amp * Math.sqrt(p.cap);
  export function profile(d: number, p?: InflateParams): number;            // amp·sqrt(min(d, cap)); 0 for d <= 0
  export function rowDistances(alpha: Uint8Array, w: number, h: number, window: number): Float32Array; // 0 on transparent; nearest transparent |dx| ≤ window, else window+1
  export function distanceField(alpha: Uint8Array, w: number, h: number, window: number): Float32Array; // sqrt(min_k k² + g(y+k)²) − 0.5, |k| ≤ window
  export function bruteForceDistance(alpha: Uint8Array, w: number, h: number): Float32Array;          // test oracle
  export function blurWeights(sigma: number): number[];                                               // 7 taps (k = −3..3), sum 1
  export function heights(alpha: Uint8Array, w: number, h: number, p?: InflateParams): Float32Array; // profile → blur x → blur y → mask
  export function gradientAt(hs: Float32Array, w: number, h: number, x: number, y: number): [number, number]; // central differences, outside = 0
  ```
- Produces (`spriteAtlas.ts`): `get slotRects(): THREE.InstancedBufferAttribute` (the existing `aSlotSize`: slot x, slot y (slot units), width, height (px)) and `get slotCount(): number`.
- Produces (`spriteField.ts`):
  ```ts
  export class SpriteField {
    /** R = blurred inflation height in sprite px; same size and layout as the atlas; LinearFilter. */
    readonly texture: THREE.Texture;
    constructor(width?: number /* SLOT*SLOT_COLS */, height?: number /* SLOT*SLOT_ROWS */, params?: InflateParams);
    /** Draws the 4 passes over the first `count` slots of `slots` (instanced quads, like the atlas). */
    update(renderer: THREE.WebGLRenderer, atlas: THREE.Texture, slots: THREE.InstancedBufferAttribute, count: number): void;
    dispose(): void;
  }
  ```
  Two HalfFloat RGBA ping-pong targets (1024×512, 4 MB each, `depthBuffer: false`; the final pass writes `texture`'s target). Each pass clears its target, then draws the used slots; the quads share the atlas's `slots` attribute (no copy). Renderer: right after `spriteAtlas.update` in the overworld branch, `if (overworld.worldStyle === 'modern') spriteField.update(webgl, spriteAtlas.target.texture, spriteAtlas.slotRects, spriteAtlas.slotCount)`; the field is handed to `OverworldView` (constructor param `field?: SpriteField`) → `ActorLayer` options. Preview: same after its atlas update.
- Produces (`selfTest.ts`): `fieldSelfTest(renderer, atlas: SpriteAtlas, field: SpriteField): { slots: number; maxErr: number; fixtureMaxErr: number; gpuMs: number }` — reads the atlas alpha per used slot (`readRenderTargetPixels`), computes `heights()` on the CPU, reads the field (`Uint16Array` + `THREE.DataUtils.fromHalfFloat`), max |GPU − CPU| in px; `fixtureMaxErr` from a synthetic 1024×512 `DataTexture` with **two fully opaque 64×64 slots side by side** (edge texels must be `profile(0.5)` before blur — no bleed); `gpuMs` = timer query around `update`.

**GLSL sketch** (fragment of each pass; vertex shader as the atlas's, passing `flat vec4 vSlot` = sprite origin in texels (slot*64) and size):

```glsl
// helpers shared by all passes
bool inside(ivec2 p) { ivec2 o = ivec2(vSlot.xy); return all(greaterThanEqual(p, o)) && all(lessThan(p, o + ivec2(vSlot.zw))); }
float opaque(ivec2 p) { return (inside(p) && texelFetch(tAtlas, p, 0).a >= 0.5) ? 1.0 : 0.0; }
float src(ivec2 p) { return inside(p) ? texelFetch(tSrc, p, 0).r : 0.0; }   // previous pass, 0 outside the sprite
// pass 1 (rows):    g = 0 if !opaque(p); else first k in 1..WINDOW with !opaque(p ± (k,0)), else WINDOW+1
// pass 2 (columns): if !opaque(p) → 0; best = min over k in −WINDOW..WINDOW of k*k + src(p+(0,k))²;
//                   d = sqrt(best) − 0.5;  h = AMP * sqrt(clamp(d, 0.0, CAP))
// pass 3 (blur x):  sum_k W[k] * src(p + (k,0)),  k = −3..3
// pass 4 (blur y):  opaque(p) * sum_k W[k] * src(p + (0,k))
```

- [ ] **Step 1: Write the failing tests** `tests/inflateMath.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { distanceField, bruteForceDistance, heights, blurWeights, profile, gradientAt, INFLATE } from '../src/render/actors/inflateMath';
import { rng } from '../src/render/kit/geom';

const mask = (w: number, h: number, f: (x: number, y: number) => boolean) => {
  const a = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = f(x, y) ? 1 : 0;
  return a;
};

describe('distanceField', () => {
  it('puts an isolated texel half a texel from the edge', () => {
    const d = distanceField(mask(5, 5, (x, y) => x === 2 && y === 2), 5, 5, 12);
    expect(d[12]).toBeCloseTo(0.5);
    expect(d[0]).toBe(0);
  });
  it('treats everything outside the sprite as transparent', () => {
    const d = distanceField(mask(4, 3, () => true), 4, 3, 12);
    expect([...d.subarray(0, 4)]).toEqual([0.5, 0.5, 0.5, 0.5]);
    expect([...d.subarray(4, 8)]).toEqual([0.5, 1.5, 1.5, 0.5]);
  });
  it('is the exact Euclidean distance (separable == brute force)', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const r = rng(seed);
      const a = mask(16, 32, () => r() < 0.75);
      const d = distanceField(a, 16, 32, 64), b = bruteForceDistance(a, 16, 32);
      for (let i = 0; i < d.length; i++) expect(Math.abs(d[i] - b[i])).toBeLessThan(1e-5);
    }
  });
  it('stops searching at the window', () => {
    const d = distanceField(mask(40, 40, () => true), 40, 40, 12);
    expect(d[20 * 40 + 20]).toBeCloseTo(12.5);
  });
});

describe('heights', () => {
  it('follows amp·sqrt(d), flat beyond the cap', () => {
    expect(profile(0.5)).toBeCloseTo(INFLATE.amp * Math.sqrt(0.5));
    expect(profile(100)).toBeCloseTo(INFLATE.amp * Math.sqrt(INFLATE.cap));
    expect(profile(0)).toBe(0);
  });
  it('has normalised symmetric blur weights', () => {
    const w = blurWeights(1.25);
    expect(w).toHaveLength(7);
    expect(w.reduce((s, v) => s + v, 0)).toBeCloseTo(1);
    expect(w[0]).toBeCloseTo(w[6]);
  });
  it('is zero outside the silhouette, symmetric and highest in the middle of a disc', () => {
    const a = mask(15, 15, (x, y) => (x - 7) ** 2 + (y - 7) ** 2 <= 36);
    const hs = heights(a, 15, 15);
    expect(hs[0]).toBe(0);
    for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
      expect(hs[y * 15 + x]).toBeCloseTo(hs[(14 - y) * 15 + (14 - x)], 5);
      expect(hs[y * 15 + x]).toBeLessThanOrEqual(hs[7 * 15 + 7] + 1e-6);
    }
    expect(gradientAt(hs, 15, 15, 7, 7)[0]).toBeCloseTo(0);
    expect(gradientAt(hs, 15, 15, 3, 7)[0]).toBeGreaterThan(0); // rising towards the middle
  });
});
```

  and `tests/spriteField.test.ts` (node: no GL, checks the wiring that Review Focus #1 depends on):

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SpriteField } from '../src/render/actors/spriteField';

describe('SpriteField', () => {
  it('matches the atlas size and draws from the atlas slot attribute itself', () => {
    const f = new SpriteField();
    const slots = new THREE.InstancedBufferAttribute(new Float32Array(128 * 4), 4);
    const calls: unknown[] = [];
    // (extend this fake with any other renderer method the implementation calls; keep the assertions)
    const fake = { getRenderTarget: () => null, setRenderTarget: () => {}, setClearColor: () => {}, getClearColor: (c: THREE.Color) => c,
      getClearAlpha: () => 1, clear: () => {}, render: (scene: THREE.Scene) => calls.push(scene) } as unknown as THREE.WebGLRenderer;
    f.update(fake, new THREE.Texture(), slots, 3);
    expect((f.texture.image as { width: number }).width).toBe(1024);
    expect(calls).toHaveLength(4);
    const mesh = (calls[0] as THREE.Scene).children[0] as THREE.Mesh;
    const g = mesh.geometry as THREE.InstancedBufferGeometry;
    expect(g.getAttribute('aSlotSize')).toBe(slots);
    expect(g.instanceCount).toBe(3);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/inflateMath.test.ts tests/spriteField.test.ts` → FAIL.
- [ ] **Step 3: Implement** `inflateMath.ts` (the GLSL above in TS; `bruteForceDistance` scans all transparent texels in the grid extended by a one-texel transparent ring), then `SpriteField` (constants injected as `#define`s from `INFLATE`, blur weights as a `float[7]` uniform), the accessors, renderer/preview wiring, `selfTest.ts`, `emu.selfTest()` / `preview.selfTest()` and the harness `--selftest` (also dump the field slots as a grey image: `h / inflateMax()`).
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: GPU parity.** `npm run regress:live -- --label t4 --selftest --static --compare p2-base` → selftest `maxErr ≤ 0.02` px and `fixtureMaxErr ≤ 0.02` on every self-tested entry (these run after walking/animation steps, so a stale or mis-slotted field fails), `gpuMs ≤ 0.3`; the field dumps show soft pillows inside each sprite silhouette; images 0.00 % vs `p2-base` (nothing visible changed); `stats` calls grow by ≤ 4 in Modern, 0 in Retro.
- [ ] **Step 6: Commit** — `git add src/render/actors/inflateMath.ts src/render/actors/spriteField.ts src/render/actors/selfTest.ts tests/inflateMath.test.ts tests/spriteField.test.ts src/render/spriteAtlas.ts src/render/renderer.ts src/render/preview.ts src/main.ts tools/regress-live.ts && git commit -m "feat(actors): GPU inflation field (exact EDT + sqrt profile + blur) with CPU reference and parity self-test"`

**Acceptance:** parity within 0.02 px on live slots and the bleed fixture; no visible change; field passes skipped in Retro and in battles.

---

### Task 5: Inflated actors (Modern)

Upright sprites become one instanced, camera-facing grid mesh displaced towards the camera by the field height, shaded by the scene lights with normals from the height gradient, with a sky-tinted rim, real shadows from an alpha-tested depth twin and a small contact shadow. Retro is untouched.

**Files:**
- Create: `src/render/actors/inflatedActors.ts`, `tests/inflatedActors.test.ts`
- Modify: `src/render/actors/actorLayer.ts` (route `'inflated'` to `InflatedActors`; extra test), `src/render/overworld/billboards.ts` (`BlobShadows(source: { geometryForShadows(): THREE.InstancedBufferGeometry })`, `uScale` uniform default 1 + `setScale(k)`), `src/render/overworld/overworldView.ts` (pass `field` and `kit` to the layer), `src/render/actors/inflateMath.ts` (tuned constants only)

**Interfaces:**
- Consumes: `SpriteField.texture` (Task 4), `inflateMax()` (Task 4), `ActorLayer` / `cardSpec` (Task 3), `KitUniforms.uSky` (rim colour).
- Produces:
  ```ts
  export const ACTOR_GRID = { x: 16, y: 32 };          // segments per actor (spec §6)
  export const RIM = 0.35;                              // rim strength (tunable)
  export const CONTACT = { strength: 0.25, scale: 0.75 }; // contact blob under inflated actors (tunable)
  export const MAX_ACTORS = 64;                         // gSprites has 64 entries
  export class InflatedActors {
    readonly mesh: THREE.Mesh;                          // castShadow, receiveShadow, customDepthMaterial set, renderOrder 2
    constructor(atlas: THREE.Texture, field: THREE.Texture, rimColor: { value: THREE.Color }, atlasSize?: THREE.Vector2 /* 1024×512 */);
    set(list: readonly BillboardSpec[], cameraRight: THREE.Vector3): void;   // flat/tint ignored
    setSmoothing(on: boolean): void;                    // no-op until Task 6
    geometryForShadows(): THREE.InstancedBufferGeometry; // 4-vertex quad + the shared aFoot/aSize instance attributes
  }
  ```
  `ActorLayer` in Modern: `'inflated'` sprites → `InflatedActors.set`, plus a second `BlobShadows` over them with `CONTACT`; grass overlays get `grassOffset = 0.06 + inflateMax() / 16` (they must stay in front of the displaced legs); the feet list still contains every upright actor. In Retro the inflated mesh and its contact shadows get an empty list and `visible = false`.

**Shader sketch** (`MeshStandardMaterial({ roughness: 0.8, metalness: 0 })` + `onBeforeCompile`, `customProgramCacheKey = () => 'actor:inflated:1'`; mesh at identity, `frustumCulled = false`; geometry = `PlaneGeometry(1, 1, 16, 32)` translated to x ∈ [−0.5, 0.5], y ∈ [0, 1], instanced attributes `aFoot` (vec3), `aSize` (vec4: width, height, lift, 0), `aUv` (vec4: u0, v0 top, u1, v1 bottom) exactly as `Billboards`):

```glsl
// vertex prelude: attributes, uniforms uRight, tField, uAtlasSize; varyings vAtlasUv, vRect (sprite rect in texels)
float fieldH(vec2 uv) { return texture(tField, uv).r; }                       // sprite px (bilinear)
vec2 fieldGrad(vec2 uv) { vec2 t = 1.0 / uAtlasSize;
  return 0.5 * vec2(fieldH(uv + vec2(t.x, 0.)) - fieldH(uv - vec2(t.x, 0.)), fieldH(uv + vec2(0., t.y)) - fieldH(uv - vec2(0., t.y))); }
// replaces <beginnormal_vertex>
vec2 local = position.xy;
vec2 auv = vec2(mix(aUv.x, aUv.z, local.x + 0.5), mix(aUv.w, aUv.y, local.y));
vec3 fwd = vec3(-uRight.z, 0.0, uRight.x);                                   // horizontal, towards the camera
vec2 g = fieldGrad(auv);                                                      // px per px: scale-free
vec3 objectNormal = normalize(fwd - g.x * uRight - g.y * vec3(0.0, 1.0, 0.0));
// replaces <begin_vertex>
float pxWorld = aSize.x / max((aUv.z - aUv.x) * uAtlasSize.x, 1.0);         // world units per sprite pixel
vec3 transformed = aFoot + uRight * (local.x * aSize.x) + vec3(0.0, local.y * aSize.y + aSize.z, 0.0)
                 + fwd * (fieldH(auv) * pxWorld);
vAtlasUv = auv; vRect = vec4(aUv.x, aUv.w, aUv.z, aUv.y) * uAtlasSize.xyxy;
// fragment, after <map_fragment>:  vec4 c = texture(tAtlas, vAtlasUv);  if (c.a < 0.5) discard;  diffuseColor.rgb *= c.rgb;
// after <normal_fragment_maps>:    recompute g at vAtlasUv (smooth per-pixel normal) → world normal as above →
//                                  normal = normalize((viewMatrix * vec4(nWorld, 0.0)).xyz);
// after <emissivemap_fragment>:    totalEmissiveRadiance += uRimColor * uRim * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
```

  Depth twin: a `ShaderMaterial` sharing the vertex GLSL string (same displacement; `#include <common>`/`<packing>`), fragment = nearest atlas alpha test + `packDepthToRGBA(gl_FragCoord.z)` exactly like `billboards.ts` `DEPTH_FRAG`, `side: DoubleSide`.

- [ ] **Step 1: Write the failing tests** `tests/inflatedActors.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { InflatedActors, ACTOR_GRID } from '../src/render/actors/inflatedActors';

const spec = (x: number) => ({ footX: x, footY: 0, footZ: 3, width: 1, height: 2, lift: 0, flat: false,
  slot: { u0: 0, v0: 32 / 512, u1: 16 / 1024, v1: 0 } });
const make = () => new InflatedActors(new THREE.Texture(), new THREE.Texture(), { value: new THREE.Color() });

describe('InflatedActors', () => {
  it('draws one instanced 16x32 grid per actor', () => {
    const a = make();
    a.set([spec(1), spec(2)], new THREE.Vector3(1, 0, 0));
    const g = a.mesh.geometry as THREE.InstancedBufferGeometry;
    expect(g.instanceCount).toBe(2);
    expect(g.getAttribute('position').count).toBe((ACTOR_GRID.x + 1) * (ACTOR_GRID.y + 1));
    expect(g.getAttribute('aFoot').getX(1)).toBe(2);
  });
  it('shares its instance buffers with a 4-vertex contact-shadow geometry', () => {
    const a = make();
    const s = a.geometryForShadows();
    a.set([spec(1)], new THREE.Vector3(1, 0, 0));
    expect(s.instanceCount).toBe(1);
    expect(s.getAttribute('aFoot')).toBe((a.mesh.geometry as THREE.InstancedBufferGeometry).getAttribute('aFoot'));
    expect(s.getAttribute('position').count).toBe(4);
  });
  it('casts and receives shadows through a depth twin', () => {
    const a = make();
    expect(a.mesh.castShadow && a.mesh.receiveShadow).toBe(true);
    expect(a.mesh.customDepthMaterial).toBeInstanceOf(THREE.ShaderMaterial);
  });
  it('patches the standard shader chunks it relies on (catches three chunk renames)', () => {
    const s = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    (make().mesh.material as THREE.MeshStandardMaterial).onBeforeCompile(s, null as unknown as THREE.WebGLRenderer);
    expect(s.vertexShader).toContain('tField');
    expect(s.vertexShader).not.toContain('#include <begin_vertex>');
    expect(s.vertexShader).not.toContain('#include <beginnormal_vertex>');
    expect(s.fragmentShader).toContain('discard');
    expect(s.fragmentShader).toContain('uRim');
  });
});
```

  and in `tests/actorLayer.test.ts` (Review Focus #3), with a fake atlas `{ slots: new Map([[0, slot], [1, slot]]), target: { texture: new THREE.Texture() } }`, a `GameState`-shaped object `{ sprites: [blankSprite({ index: 0, worldX: 40, worldY: 64 }), blankSprite({ index: 1, worldX: 56, worldY: 64 })], objects: [] } as unknown as GameState` and an `ActorFrame` (`heightAt: () => 0`, `hasGrassBlades: () => false`, `cameraRight: new THREE.Vector3(1, 0, 0)`, `charLight: new THREE.Color(1, 1, 1)`) whose `classifier` is `{ kind: (s: SpriteSnap) => (s.index === 0 ? SpriteKind.Upright : SpriteKind.Flat) } as unknown as SpriteClassifier`:

```ts
it('switching to Retro routes every sprite back to cards and empties the inflated mesh', () => {
  const layer = new ActorLayer(atlas, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });
  layer.update(state, { ...frame, style: 'modern' });
  expect(layer.counts()).toEqual({ cards: 1, inflated: 1, models: 0 });
  layer.update(state, { ...frame, style: 'retro' });
  expect(layer.counts()).toEqual({ cards: 2, inflated: 0, models: 0 });
});
```
  (add `counts(): { cards: number; inflated: number; models: number }` to `ActorLayer` — instance counts of the meshes it owns.)

- [ ] **Step 2: Run** `npx vitest run tests/inflatedActors.test.ts tests/actorLayer.test.ts` → FAIL.
- [ ] **Step 3: Implement** `InflatedActors` (sketch above), the routing, `BlobShadows` generalisation (Retro path keeps `uScale = 1`, identical output), the contact shadows, the grass offset.
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Look and tune.** `npm run regress:live -- --label t5 --static --gpu --selftest --compare p2-base`. Tune `INFLATE.amp/cap/sigma`, `RIM`, `CONTACT`, roughness until, on `_crops.png` and the Modern sheets:
  - characters read as soft rounded volumes (cheeks/body/limbs) yet the front silhouette and every animation frame equal the sprite's; `r101_low` and `r101_yaw` show volume without card edges, cracks or stretched texels;
  - the sun shadow is the character's silhouette (not a blob), feet look grounded (contact shadow), no acne stripes on the characters, tree shadows fall on characters walking under them;
  - brightness: Modern characters are not visibly darker than the Retro crops by day (`r101`, `birch`), at night (`r104_night`), indoors (`vigoroth`, `item_indoor`) and in the Flash cave (`granite_flash`: actors near the focus lit warm by the lantern, never black);
  - `r101_grass`: blades still hide the legs as in Phase 1 (no leg drawn through the blades); `r101_tree`: the player's fade still works;
  - Retro: 0.00 % vs `p2-base` on every entry; `battle`/`transition` Modern also 0.00 % (battles untouched);
  - budgets: calls ≤ 150, triangles ≤ 1.5 M, `gpuMs` ≤ `p2-base` + 1.0 ms, `cpuMs` ≤ `p2-base` + 0.5 ms on every live Modern entry.
  Record the chosen constants and the measured deltas in the task report.
- [ ] **Step 6: Commit** — `git add src/render/actors/inflatedActors.ts tests/inflatedActors.test.ts src/render/actors/actorLayer.ts tests/actorLayer.test.ts src/render/overworld/billboards.ts src/render/overworld/overworldView.ts src/render/actors/inflateMath.ts && git commit -m "feat(actors): inflated, lit, rim-lit characters with silhouette shadows (Modern)"`

**Acceptance:** the bullets of Step 5.

---

### Task 6: HD edge-smoothing (scale-free xBR) + "Sprite edges" setting

Replaces the nearest atlas sample of inflated actors with an xBR-lv2-style filter evaluated at the fragment's continuous texel position, so staircase edges and silhouettes become smooth curves at any magnification. "Pixel" keeps nearest.

**Files:**
- Create: `src/render/actors/xbr.glsl.ts`, `tests/kitXbr.test.ts`
- Modify: `src/render/kit/upscale.ts` (`xbrSample` CPU reference), `src/render/actors/inflatedActors.ts` (`setSmoothing`, `uSmooth`, `uXbrDelta`), `src/render/actors/actorLayer.ts` + `overworldView.ts` (`setSpriteFilter`), `src/render/renderer.ts` (`setSpriteFilter(f)`), `src/ui/settings.ts` (+ panel select "Sprite edges (Modern)": HD smooth / Pixel), `src/main.ts` (apply + `?spriteFilter=`), `src/render/preview.ts` (`&spriteFilter=`), `src/render/actors/selfTest.ts` (`xbrSelfTest`), `tests/settings.test.ts`

**Interfaces:**
- Produces (CPU reference, `kit/upscale.ts`; pixels packed as in `scale2x`, `0xAABBGGRR`, rows top-down; `rect` = [x0, y0, x1, y1) in texels, texels outside it read as transparent black):
  ```ts
  export const XBR = { eq: 0.06, coef: 2.0 };   // "equal" threshold (weighted distance), lv2 slope coefficient
  export function xbrSample(src: Uint32Array, w: number, h: number, x: number, y: number, delta: number,
    rect?: [number, number, number, number]): [number, number, number, number]; // RGBA 0..1 at continuous texel coords (centres at k + 0.5)
  ```
- Produces (GLSL, `xbr.glsl.ts`): `export const XBR_GLSL` defining `vec4 xbrSample(sampler2D tex, vec2 p, vec4 rect, float delta)` with the same constants; the actor fragment uses `p = vAtlasUv * uAtlasSize`, `rect = vRect`, `delta = clamp(0.5 * fwidth(p.x + p.y), 0.02, 0.5)` when `uSmooth > 0.5`.
- Produces: `Settings.spriteFilter: 'smooth' | 'pixel'` (default `'smooth'`, unknown → `'smooth'`), `Renderer.setSpriteFilter(f)`, `xbrSelfTest(renderer): { maxErr: number }` (a 16×16 fixture `DataTexture` — staircase, disc, 1-px line, transparency — sampled at 64×64 points through `XBR_GLSL` into an RGBA8 target with fixed `delta = 0.1`, compared to `xbrSample`).

**Algorithm sketch** (one corner; evaluate all four by rotating the neighbourhood; the CPU reference and the GLSL share the structure). Neighbourhood around E = the texel containing p, rotated so the corner under evaluation is the +x/+y one (rows grow with y):
```
      A1 B1 C1
   A0 A  B  C  C4
   D0 D  E  F  F4
   G0 G  H  I  I4
      G5 H5 I5
```
```
df(a, b)  = dot(|a.rgb − b.rgb|, (0.299, 0.587, 0.114)) + |a.a − b.a|      // alpha differences count fully: silhouettes are edges
neq(a, b) = df(a, b) > XBR.eq
edge      = (df(E,C) + df(E,G) + df(I,H5) + df(I,F4) + 4·df(H,F))  <  (df(H,D) + df(H,I5) + df(F,I4) + df(F,B) + 4·df(E,I))
            && neq(E,F) && neq(E,H)
shallow   = coef·df(F,G) <= df(H,C) && neq(E,G) && neq(D,G)               // lv2: 30° line into G's side
steep     = df(F,G) >= coef·df(H,C) && neq(E,C) && neq(B,C)               // lv2: 60° line into C's side
f         = fract(p) in the rotated frame
cov       = edge ? max( smoothstep(1.5−δ, 1.5+δ, f.x + f.y),
                        shallow ? smoothstep(1.0−δ, 1.0+δ, f.y + 0.5·f.x) : 0,
                        steep   ? smoothstep(2.0−δ, 2.0+δ, 2.0·f.x + f.y) : 0 ) : 0
px        = df(E,F) <= df(E,H) ? F : H
colour    = mix(colour, px, cov)                                          // colour starts as E; corners applied in a fixed order
```

- [ ] **Step 1: Write the failing tests** `tests/kitXbr.test.ts` (+ settings cases)

```ts
import { describe, it, expect } from 'vitest';
import { xbrSample } from '../src/render/kit/upscale';

const X = 0xff0000ff, O = 0x00000000;                       // opaque red, transparent
const a = (img: Uint32Array, w: number, h: number, x: number, y: number) => xbrSample(img, w, h, x, y, 0.1)[3];

describe('xbrSample', () => {
  it('reproduces flat areas exactly', () => {
    expect(xbrSample(new Uint32Array(9).fill(X), 3, 3, 1.3, 1.7, 0.1)).toEqual([1, 0, 0, 1]);
  });
  it('keeps an isolated pixel and a checkerboard at texel centres', () => {
    const dot = new Uint32Array(25); dot[12] = X;
    expect(a(dot, 5, 5, 2.5, 2.5)).toBe(1);
    const cb = new Uint32Array(36).map((_, i) => ((i % 6) + Math.floor(i / 6)) % 2 ? X : O);
    for (let i = 0; i < 36; i++) expect(a(cb, 6, 6, (i % 6) + 0.5, Math.floor(i / 6) + 0.5)).toBe(cb[i] === X ? 1 : 0);
  });
  it('turns a 45° staircase into a straight edge', () => {
    const st = new Uint32Array(64).map((_, i) => ((i % 8) <= Math.floor(i / 8) ? X : O)); // filled where x <= y
    for (let k = 2; k <= 5; k++) {
      expect(a(st, 8, 8, k + 0.9, k + 0.1)).toBeLessThan(0.5);    // the step's outer corner is cut
      expect(a(st, 8, 8, k + 1.1, k + 0.9)).toBeGreaterThan(0.5); // the step's inner notch is filled
    }
  });
  it('never reads outside its rectangle', () => {
    const two = new Uint32Array(8 * 4).fill(X);                 // an 8x4 image: left 4 columns = sprite A, right = sprite B
    const solo = new Uint32Array(8 * 4).map((_, i) => (i % 8) < 4 ? X : O);
    for (const [x, y] of [[3.9, 0.1], [3.6, 2.5], [3.95, 3.9]])
      expect(xbrSample(two, 8, 4, x, y, 0.1, [0, 0, 4, 4])).toEqual(xbrSample(solo, 8, 4, x, y, 0.1, [0, 0, 4, 4]));
  });
});
```

```ts
// tests/settings.test.ts additions
it('sprite edges default to HD smooth and reject unknown values', () => {
  expect(parseSettings(null).spriteFilter).toBe('smooth');
  expect(parseSettings('{"spriteFilter":"pixel"}').spriteFilter).toBe('pixel');
  expect(parseSettings('{"spriteFilter":"blurry"}').spriteFilter).toBe('smooth');
});
```

- [ ] **Step 2: Run** `npx vitest run tests/kitXbr.test.ts tests/settings.test.ts` → FAIL.
- [ ] **Step 3: Implement** `xbrSample`, `XBR_GLSL` (`texelFetch` with integer coords; outside `rect` → `vec4(0)`), the actor fragment switch, the setting plumbing, `xbrSelfTest` (wired into `emu.selfTest()` / harness `--selftest`).
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Look.** `npm run regress:live -- --label t6 --static --selftest --compare t5` and `--label t6px --static --query spriteFilter=pixel --compare t5`: selftest `xbr.maxErr ≤ 2/255`; HD crops show smooth curved outlines and rounded pixel staircases (faces, hair, Zigzagoon) without blur, halos or lost one-pixel details (eyes); Pixel run = `t5` 0.00 %; Retro 0.00 % vs `p2-base`; one run at `--dpr 2` (`--label t6dpr2 --only r101,birch --styles modern`) shows the same smoothness at 2× size; `gpuMs` still within budget.
- [ ] **Step 6: Commit** — `git add src/render/actors/xbr.glsl.ts tests/kitXbr.test.ts src/render/kit/upscale.ts src/render/actors/inflatedActors.ts src/render/actors/actorLayer.ts src/render/overworld/overworldView.ts src/render/renderer.ts src/ui/settings.ts src/main.ts src/render/preview.ts src/render/actors/selfTest.ts tests/settings.test.ts && git commit -m "feat(actors): scale-free xBR sprite edge smoothing + Sprite edges setting"`

**Acceptance:** parity, the Step 5 visuals, Pixel identical to Task 5.

---

### Task 7: Object mapping and sprite colours (pure logic)

Decides which object events become models (and when they must not), and samples model colours from the object's own sprite pixels so every model keeps the ROM's colours.

**Files:**
- Create: `src/render/actors/objectMap.ts`, `src/render/actors/spriteColors.ts`, `tests/objectMap.test.ts`, `tests/spriteColors.test.ts`

**Interfaces:**
- Produces (`objectMap.ts`; ids from `vendor/pokeemerald-src/include/constants/event_objects.h`):
  ```ts
  export const GFX = { ITEM_BALL: 59, BERRY_TREE: 60, BERRY_TREE_EARLY: 61, BERRY_TREE_LATE: 62, CUTTABLE_TREE: 82,
    BREAKABLE_ROCK: 86, PUSHABLE_BOULDER: 87, TRUCK: 94 } as const;
  export const ANIM_REMOVE_OBSTACLE = 1;                    // constants/event_object_movement.h
  export type ObjectModelKind = 'pokeball' | 'boulder' | 'crackedRock' | 'cutTree' | 'berry' | 'truck';
  export interface ObjectModelRef { kind: ObjectModelKind; stage: number }   // stage: berry 1..5, else 0
  /** null: draw the sprite (unmapped id, a VAR id ≥ 240, or a Cut tree / rock playing its removal animation). */
  export function objectModelFor(graphicsId: number, animNum: number): ObjectModelRef | null;
  /** Berry trees run anim (stage − 1) (event_object_movement.c SetBerryTreeGraphics): stage = clamp(animNum + 1, 1, 5). */
  export function berryStage(animNum: number): number;
  /** Height in sprite px of the image the model stands for (the truck's 48×48 subsprite image; others: the sprite's). */
  export function modelImageHeight(kind: ObjectModelKind, spriteHeight: number): number;
  ```
- Produces (`spriteColors.ts`; `RGB` = sRGB 0..1 triple from `kit/palette.ts`):
  ```ts
  export interface SpritePixelSource { vram: Uint8Array; palette: Uint16Array }   // bus VRAM (OBJ tiles at 0x10000); 512 BGR555, OBJ at 256..
  /** Palette indices (row 0 = top) of a sprite's current image, decoded exactly like spriteAtlas.ts's shader. */
  export function decodeSpriteIndices(vram: Uint8Array, s: Pick<SpriteSnap, 'tileNum' | 'width' | 'height' | 'bpp8' | 'hflip' | 'vflip'>,
    map2d: boolean): Uint8Array;
  export interface SpriteColors { main: RGB | null; accent: RGB | null; green: RGB | null }
  /** main: most frequent opaque colour with luma ≥ 0.2 (outlines excluded); accent: most saturated (≥ 0.35) non-green colour by
   *  pixel count × saturation; green: pixel-weighted mean of green-hued colours (hue 70°–170°, saturation ≥ 0.2). */
  export function pickColors(indices: Uint8Array, palette16: Uint16Array): SpriteColors;
  /** Cached per (images, animNum, palette slot contents). */
  export class SpriteColorCache { get(s: SpriteSnap, src: SpritePixelSource): SpriteColors }
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// tests/objectMap.test.ts
import { describe, it, expect } from 'vitest';
import { objectModelFor, berryStage, modelImageHeight, GFX } from '../src/render/actors/objectMap';

describe('objectModelFor', () => {
  it('maps the field objects', () => {
    expect(objectModelFor(GFX.ITEM_BALL, 0)).toEqual({ kind: 'pokeball', stage: 0 });
    expect(objectModelFor(GFX.PUSHABLE_BOULDER, 0)).toEqual({ kind: 'boulder', stage: 0 });
    expect(objectModelFor(GFX.BREAKABLE_ROCK, 0)).toEqual({ kind: 'crackedRock', stage: 0 });
    expect(objectModelFor(GFX.CUTTABLE_TREE, 0)).toEqual({ kind: 'cutTree', stage: 0 });
    expect(objectModelFor(GFX.TRUCK, 0)).toEqual({ kind: 'truck', stage: 0 });
  });
  it('gives the removal animation back to the sprite', () => {
    expect(objectModelFor(GFX.CUTTABLE_TREE, 1)).toBeNull();
    expect(objectModelFor(GFX.BREAKABLE_ROCK, 1)).toBeNull();
  });
  it('reads the berry stage from the animation', () => {
    expect(objectModelFor(GFX.BERRY_TREE_EARLY, 0)).toEqual({ kind: 'berry', stage: 1 });
    expect(objectModelFor(GFX.BERRY_TREE_LATE, 4)).toEqual({ kind: 'berry', stage: 5 });
    expect(objectModelFor(GFX.BERRY_TREE, 2)).toEqual({ kind: 'berry', stage: 3 });
    expect(berryStage(9)).toBe(5);
  });
  it('leaves characters, Pokémon and VAR graphics to sprites', () => {
    for (const id of [0, 6, 98, 113, 215, 240, 255]) expect(objectModelFor(id, 0)).toBeNull();
  });
  it('knows the truck image is 48 px tall', () => {
    expect(modelImageHeight('truck', 32)).toBe(48);
    expect(modelImageHeight('pokeball', 16)).toBe(16);
  });
});
```

```ts
// tests/spriteColors.test.ts
import { describe, it, expect } from 'vitest';
import { decodeSpriteIndices, pickColors } from '../src/render/actors/spriteColors';
import { bgr555ToSrgb } from '../src/render/kit/palette';

const bgr = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);
/** A 4bpp tile at `tile` whose pixel (x, y) has index f(x, y). */
function putTile(vram: Uint8Array, tile: number, f: (x: number, y: number) => number) {
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x += 2)
    vram[0x10000 + tile * 32 + y * 4 + (x >> 1)] = (f(x, y) & 15) | ((f(x + 1, y) & 15) << 4);
}
const sprite = { tileNum: 2, width: 16, height: 8, bpp8: false, hflip: false, vflip: false };

describe('decodeSpriteIndices', () => {
  const vram = new Uint8Array(0x18000);
  putTile(vram, 2, (x, y) => (x + y) & 7);
  putTile(vram, 3, () => 9);
  it('reads 1D-mapped 4bpp tiles row-major', () => {
    const px = decodeSpriteIndices(vram, sprite, false);
    expect(px[3 * 16 + 2]).toBe(5);
    expect(px[0 * 16 + 9]).toBe(9);     // second tile
  });
  it('mirrors when hflipped', () => {
    expect(decodeSpriteIndices(vram, { ...sprite, hflip: true }, false)[0]).toBe(9);
  });
});

describe('pickColors', () => {
  const pal = new Uint16Array(16);
  pal[1] = bgr(31, 2, 2); pal[2] = bgr(30, 30, 30); pal[3] = bgr(2, 2, 3); pal[4] = bgr(4, 20, 6);
  it('finds the body colour, the accent and the greens', () => {
    const c = pickColors(new Uint8Array([0, 1, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4]), pal);
    expect(c.main).toEqual(bgr555ToSrgb(pal[2]));   // most frequent, outline (3) excluded
    expect(c.accent).toEqual(bgr555ToSrgb(pal[1])); // saturated, not green
    expect(c.green).toEqual(bgr555ToSrgb(pal[4]));
  });
  it('returns nulls for a transparent image', () => {
    expect(pickColors(new Uint8Array(8), pal)).toEqual({ main: null, accent: null, green: null });
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/objectMap.test.ts tests/spriteColors.test.ts` → FAIL.
- [ ] **Step 3: Implement.** `decodeSpriteIndices` mirrors the atlas shader (tile = `tileNum + (ty * (w >> 3) + tx) * (bpp8 ? 2 : 1)` in 1D, `tileNum + ty * 32 + tx * …` in 2D; 4bpp low nibble = even x). `SpriteColorCache` keys on `${images}:${animNum}:${hash of the 16 palette entries}` and keeps ≤ 256 entries.
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Commit** — `git add src/render/actors/objectMap.ts src/render/actors/spriteColors.ts tests/objectMap.test.ts tests/spriteColors.test.ts && git commit -m "feat(actors): graphicsId → model mapping, berry stages, sprite colour sampling"`

**Acceptance:** tests pass; no runtime wiring yet (Task 8).

---

### Task 8: Object models I — Poké Ball, boulder, cracked rock, Cut tree, truck

Mapped object events are drawn as instanced procedural models placed where their sprite stands every frame (so a pushed boulder slides with the game's movement), coloured from their sprite; their sprite is not drawn. Models compile at startup.

**Files:**
- Create: `src/render/actors/models.ts`, `src/render/actors/objectModels.ts`, `tests/actorModels.test.ts`, `tests/objectModels.test.ts`
- Modify: `src/render/actors/actorLayer.ts` (sprite → object link, `'model'` route, colours, pixel source, `precompile`), `src/render/overworld/overworldView.ts` (pixel source: live `{ vram: bus.vram, palette: unfaded EWRAM palette (512) }`; precompile once at the first `sync`), `src/render/preview.ts` (pixel source = scratch VRAM + palette; precompile), `src/render/kit/trees.ts` (export `smallTreeGeo(seed: number): THREE.BufferGeometry` = a `blobCrown` + trunk at 0.6× the bushy style, trunk flagged in vertex alpha like the tree styles, `userData.shared`; also export the `TRUNK_HEAD` / `TRUNK_FRAG` hooks)

**Interfaces:**
- Consumes: `objectModelFor`, `modelImageHeight`, `SpriteColorCache`, `SpritePixelSource` (Task 7); `cardSpec` (Task 3); `kitMaterial` / `KitUniforms` (`kit/materials.ts`); `blobCrown`/`smallTreeGeo` (`kit/trees.ts`); `soften`, `lush`, `toLinear` (`kit/palette.ts`).
- Produces (`models.ts`): every geometry is non-indexed or indexed with `position`, `normal`, 4-component `color` (RGB = shade or fixed colour, **alpha = tint code: 1 fixed colour, 0.5 → tint A × shade, 0 → tint B × shade**), base at y = 0, centred on x = z = 0, cached per seed (`userData.shared = true`):
  ```ts
  export function pokeBallGeo(): THREE.BufferGeometry;            // r 0.27; top half tint A (shell), white bottom, black band, white button with black ring
  export function boulderGeo(seed: number): THREE.BufferGeometry; // ≈0.9 wide, 0.8 tall, noise-displaced icosphere, tint A
  export function crackedRockGeo(seed: number): THREE.BufferGeometry; // ≈0.9 wide, 0.6 tall, flatter; 2–3 crack grooves = tint A × 0.45
  export function cutTreeGeo(seed: number): THREE.BufferGeometry; // = smallTreeGeo(seed): ≈1.1 tall. Exception to the tint codes: it keeps
                                                                  // the tree family's convention (crown alpha 1 × material colour = tint A;
                                                                  // trunk alpha 0.1–0.4 → bark colour via the trees' TRUNK hook), own material
  export function truckGeo(): THREE.BufferGeometry;               // box truck ≈3.0 (X) × 1.9 (Y) × 1.7 (Z): cargo box tint A, stripe/cab trim tint B,
                                                                  // dark glass, black tyres; orientation as the GBA image shows it
  ```
- Produces (`objectModels.ts`):
  ```ts
  export const MAX_PER_KIND = 16;                                  // gObjectEvents has 16 slots
  export interface ModelInstance { kind: ObjectModelKind; stage: number; x: number; y: number; z: number; colors: SpriteColors }
  export class ObjectModels {
    readonly group: THREE.Group;                                   // one InstancedMesh per kind, named by kind ('pokeball', …)
    constructor(kit: KitUniforms);
    /** Resets every mesh's count, then places the instances (≤ MAX_PER_KIND each); updates a kind's tint uniforms
     *  (uTintA / uTintB) from the first instance's colours, falling back to the defaults below. */
    set(list: readonly ModelInstance[]): void;
    precompile(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void>;
  }
  ```
  Default / derived tints (linear via `toLinear`): pokeball A = accent ?? (0.86, 0.16, 0.16); boulder A = soften(main) ?? (0.55, 0.5, 0.45); crackedRock A = soften(main) ?? (0.6, 0.55, 0.5); cutTree A = lush(green) ?? (0.3, 0.6, 0.3), trunk (uTrunk) = (0.42, 0.3, 0.2); truck A = main ?? (0.92, 0.92, 0.9), B = accent ?? (0.2, 0.35, 0.8). Materials: `kitMaterial(kit, { vertexColors: true, roughness: 0.6 (ball 0.35), uniforms: { uTintA, uTintB }, fragHead, fragColor })` — the `fragColor` hook applies the tint code; created once, never released (not part of a world build).
- Produces (`ActorLayer`): `setPixelSource(src: SpritePixelSource | null): void` (colours; null → fallback tints) and `precompile(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): Promise<void>` (delegates to `ObjectModels`).
- `ActorLayer` (Modern): per frame build `spriteId → ObjectEventSnap` from `state.objects`; an Upright sprite whose object has `objectModelFor(o.graphicsId, s.animNum)` and is not `o.invisible` routes to `'model'`: foot = `cardSpec` foot, except that the foot Z uses the model image's bottom (`worldY − s.height/2 + modelImageHeight(kind, s.height)/2`, in px, then /16 − 0.5 + h) so the 48-px truck stands on its real cells. The sprite is not drawn; the model's foot joins the grass-bending feet. Retro: no models (`group.visible = false`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/actorModels.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pokeBallGeo, boulderGeo, crackedRockGeo, cutTreeGeo, truckGeo } from '../src/render/actors/models';

const box = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

describe('object model geometry', () => {
  it('has the agreed sizes and stands on y = 0', () => {
    const b = box(pokeBallGeo());
    expect(b.min.y).toBeCloseTo(0, 2); expect(b.max.y).toBeCloseTo(0.54, 1); expect(b.max.x).toBeCloseTo(0.27, 1);
    const r = box(boulderGeo(1)); expect(r.max.x - r.min.x).toBeLessThanOrEqual(1.0); expect(r.min.y).toBeGreaterThanOrEqual(-0.02);
    const c = box(crackedRockGeo(1)); expect(c.max.y).toBeLessThan(0.75);
    expect(box(cutTreeGeo(1)).max.y).toBeGreaterThan(0.9);
    const t = box(truckGeo()); expect(t.max.x - t.min.x).toBeCloseTo(3.0, 0); expect(t.max.y).toBeLessThan(2.1);
  });
  it('uses only the tint codes 0, 0.5 and 1 in the colour alpha', () => {
    for (const g of [pokeBallGeo(), boulderGeo(1), crackedRockGeo(1), truckGeo()]) {
      const col = g.getAttribute('color');
      expect(col.itemSize).toBe(4);
      for (let i = 0; i < col.count; i++) expect([0, 0.5, 1].some((c) => Math.abs(col.getW(i) - c) < 0.01)).toBe(true);
    }
  });
  it('stays within its triangle budget', () => {
    expect(tris(pokeBallGeo())).toBeLessThanOrEqual(2000);
    expect(tris(boulderGeo(1))).toBeLessThanOrEqual(1500);
    expect(tris(crackedRockGeo(1))).toBeLessThanOrEqual(1500);
    expect(tris(cutTreeGeo(1))).toBeLessThanOrEqual(3000);
    expect(tris(truckGeo())).toBeLessThanOrEqual(2500);
  });
  it('points the boulder normals outwards', () => {
    const g = boulderGeo(3), p = g.getAttribute('position'), n = g.getAttribute('normal');
    const c = box(g).getCenter(new THREE.Vector3());
    let out = 0;
    for (let i = 0; i < p.count; i++)
      if ((p.getX(i) - c.x) * n.getX(i) + (p.getY(i) - c.y) * n.getY(i) + (p.getZ(i) - c.z) * n.getZ(i) > 0) out++;
    expect(out / p.count).toBeGreaterThan(0.95);
  });
});
```

```ts
// tests/objectModels.test.ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ObjectModels, MAX_PER_KIND } from '../src/render/actors/objectModels';
import { createKitUniforms } from '../src/render/kit/materials';

const colors = { main: null, accent: null, green: null };
const count = (m: ObjectModels, k: string) => (m.group.getObjectByName(k) as THREE.InstancedMesh).count;

describe('ObjectModels', () => {
  it('places one instance per object and clears them when the objects are gone', () => {
    const m = new ObjectModels(createKitUniforms());
    m.set([{ kind: 'pokeball', stage: 0, x: 3, y: 0, z: 5, colors }, { kind: 'boulder', stage: 0, x: 4, y: 1, z: 6, colors }]);
    expect(count(m, 'pokeball')).toBe(1);
    expect(count(m, 'boulder')).toBe(1);
    const at = new THREE.Matrix4();
    (m.group.getObjectByName('boulder') as THREE.InstancedMesh).getMatrixAt(0, at);
    expect(new THREE.Vector3().setFromMatrixPosition(at).toArray()).toEqual([4, 1, 6]);
    m.set([]);
    expect(count(m, 'pokeball')).toBe(0);
    expect(count(m, 'boulder')).toBe(0);
  });
  it('caps each kind at 16 instances', () => {
    const m = new ObjectModels(createKitUniforms());
    m.set(Array.from({ length: 20 }, (_, i) => ({ kind: 'pokeball' as const, stage: 0, x: i, y: 0, z: 0, colors })));
    expect(count(m, 'pokeball')).toBe(MAX_PER_KIND);
  });
});
```

  and in `tests/actorLayer.test.ts`: with an object `{ spriteId: 0, graphicsId: 59, invisible: false }` in `state.objects`, Modern `counts()` = `{ cards: 0, inflated: 0, models: 1 }`; the same sprite with `animNum: 1` and `graphicsId: 82` → `{ inflated: 1, models: 0 }`; Retro → `{ cards: 1, models: 0 }`; `invisible: true` object → no model.
- [ ] **Step 2: Run** `npx vitest run tests/actorModels.test.ts tests/objectModels.test.ts tests/actorLayer.test.ts` → FAIL.
- [ ] **Step 3: Implement** the geometries (seeded via `kit/geom.ts` `rng` / `noise3`; boulder/rock like `blobCrown`'s displaced icospheres, detail ≤ 2), `ObjectModels` (InstancedMesh per kind, `castShadow`/`receiveShadow`, `frustumCulled = false`, `visible = count > 0`), the `ActorLayer` route and `precompile` (`renderer.compileAsync(group, camera, scene)` with every mesh temporarily `visible` and `count = 1`, restored after). For the truck, find which way the GBA image faces with `--static` `littleroot_npcs` in Retro after Task 10 or by decoding its frame with `objectGraphics.ts` + the subsprite table in a `.scratch` script; record it.
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Look.** `npm run regress:live -- --label t8 --static --gpu --compare t6`: `item_indoor`, `r119_items` (3D Poké Balls, red/white from the sprite), `fiery_boulders`, `r114_rocks` (rock colours of the sprite, cracks visible), `r116_cut` (small round trees matching the kit's trees, sprite's greens), `lr_truck` + `littleroot_npcs` (a box truck on the truck's cells, not floating, not sunk); every model casts and receives shadows; Retro 0.00 % vs `p2-base`; static `&removing=1` run (`--label t8rm --static --only r116_cut,r114_rocks --query removing=1`) shows the inflated sprites instead of the models; live budgets as in Task 5; `stats.programs` equal before and after the first model is on screen (precompiled).
- [ ] **Step 6: Commit** — `git add src/render/actors/models.ts src/render/actors/objectModels.ts tests/actorModels.test.ts tests/objectModels.test.ts src/render/actors/actorLayer.ts tests/actorLayer.test.ts src/render/overworld/overworldView.ts src/render/preview.ts src/render/kit/trees.ts && git commit -m "feat(actors): 3D Poké Balls, boulders, cracked rocks, Cut trees and the moving truck by graphicsId"`

**Acceptance:** the Step 5 visuals; no model ever lingers after its sprite is gone; no program compile on first appearance.

---

### Task 9: Object models II — berry plants per growth stage

Berry trees become 3D plants whose shape follows the live growth stage (soil mound → sprout → sapling → flowering bush → bush with berries); flowers and berries take their colours from the sprite.

**Files:**
- Modify: `src/render/actors/models.ts`, `src/render/actors/objectModels.ts`, `tests/actorModels.test.ts`, `tests/objectModels.test.ts`

**Interfaces:**
- Consumes: `objectModelFor` → `{ kind: 'berry', stage }` (Task 7), `ObjectModels` (Task 8).
- Produces:
  ```ts
  export type BerryStage = 1 | 2 | 3 | 4 | 5;
  /** Plant body (tint codes: leaves A = green, soil fixed brown) and the anchor points (plant space) of its flowers
   *  (stage 4) or berries (stage 5); no anchors otherwise. Cached per (stage, seed). */
  export function berryPlantGeo(stage: BerryStage, seed: number): { body: THREE.BufferGeometry; anchors: THREE.Vector3[] };
  export function berryFruitGeo(): THREE.BufferGeometry;   // r 0.07 sphere, tint A
  export function berryFlowerGeo(): THREE.BufferGeometry;  // 5-petal disc r 0.09, petals tint A, yellow centre fixed
  ```
  Shapes (all ≤ 1.0 wide, within the cell): 1 = soil mound (≈0.5 wide, 0.12 tall); 2 = mound + sprout with 2 leaves (≈0.35 tall); 3 = stem with 3–4 leaf pairs (≈0.65 tall); 4 = small bush (`blobCrown`, ≈0.9 tall) + 5–7 flower anchors on the crown surface; 5 = the same bush + 5–7 berry anchors. `ObjectModels` meshes `berry1`…`berry5` (bodies), `berryFlower`, `berryFruit` (instanced, `instanceColor` per plant = the sprite's accent; fallbacks fruit (0.85, 0.2, 0.25), petals (0.95, 0.55, 0.75); leaves = lush(green) ?? (0.3, 0.6, 0.3)); `MAX_PER_KIND` for bodies, 16 × 7 for flowers/fruits.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/actorModels.test.ts (add; extend the import from '../src/render/actors/models' with berryPlantGeo)
it('grows with the berry stage and carries flowers / berries on the last two', () => {
  const top = (s: 1 | 2 | 3 | 4 | 5) => box(berryPlantGeo(s, 7).body).max.y;
  expect(top(1)).toBeLessThan(top(2));
  expect(top(2)).toBeLessThan(top(3));
  expect(top(3)).toBeLessThan(top(4));
  expect(top(5)).toBeGreaterThanOrEqual(top(4) - 0.05);
  for (const s of [1, 2, 3] as const) expect(berryPlantGeo(s, 7).anchors).toHaveLength(0);
  for (const s of [4, 5] as const) {
    const n = berryPlantGeo(s, 7).anchors.length;
    expect(n).toBeGreaterThanOrEqual(5); expect(n).toBeLessThanOrEqual(7);
  }
  const b = box(berryPlantGeo(5, 7).body); expect(b.max.x - b.min.x).toBeLessThanOrEqual(1.0);
});
```

```ts
// tests/objectModels.test.ts (add; plus `import { berryPlantGeo } from '../src/render/actors/models';` at the top)
it('draws a body per berry tree and its berries at the anchors', () => {
  const m = new ObjectModels(createKitUniforms());
  m.set([{ kind: 'berry', stage: 5, x: 2, y: 0, z: 2, colors }, { kind: 'berry', stage: 5, x: 5, y: 0, z: 2, colors },
         { kind: 'berry', stage: 1, x: 8, y: 0, z: 2, colors }]);
  expect(count(m, 'berry5')).toBe(2);
  expect(count(m, 'berry1')).toBe(1);
  expect(count(m, 'berryFruit')).toBe(2 * berryPlantGeo(5, 0).anchors.length);
  expect(count(m, 'berryFlower')).toBe(0);
  m.set([]);
  expect(count(m, 'berryFruit')).toBe(0);
});
```
  (all plants use seed 0 for their geometry so anchors are shared; per-instance yaw keeps them from looking identical.)

- [ ] **Step 2: Run** `npx vitest run tests/actorModels.test.ts tests/objectModels.test.ts` → FAIL.
- [ ] **Step 3: Implement** the stage geometries, the extra meshes, anchor transforms (plant matrix × anchor), per-instance colours.
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Look.** `npm run regress:live -- --label t9 --static --only r104_berries,r104_night,r119_items --compare t8`: all five stages visible (preview stages cycle by localId), plants sit in their soil cells, flowers/berries in sprite colours, readable at night; Retro 0.00 % vs `p2-base`.
- [ ] **Step 6: Commit** — `git add src/render/actors/models.ts src/render/actors/objectModels.ts tests/actorModels.test.ts tests/objectModels.test.ts && git commit -m "feat(actors): berry plants per growth stage with sprite-coloured flowers and berries"`

**Acceptance:** Step 5.

---

### Task 10: Multi-piece subsprites composed in the atlas (both styles) — **controller to confirm**

The GBA builds some world sprites from several OAM pieces (subsprite tables): the 48×48 moving truck, Briney's boat, the S.S. Tidal. The atlas draws only the base OAM shape, so these are garbled today in both styles. This task composes the pieces for world sprites (`coordOffset`), fixing them everywhere — it therefore changes Retro pixels of exactly those sprites. Skip the task if the controller rules Retro must stay byte-identical (Modern still shows the truck model).

**Files:**
- Create: `src/game/subsprites.ts`, `tests/subsprites.test.ts`
- Modify: `src/game/state.ts` (composed size/position + `pieces`), `src/render/spriteAtlas.ts` (one atlas instance per piece), `tests/smoke/objectGraphics.test.ts` (truck table)

**Interfaces:**
- Produces:
  ```ts
  export interface SubspritePiece { x: number; y: number; width: number; height: number; tileOffset: number } // x/y from the sprite centre
  /** struct SubspriteTable { u8 count; Subsprite *pieces } (8 bytes) at tables + 8*tableNum; struct Subsprite (4 bytes):
   *  s8 x, s8 y, u16 shape:2 | size:2 | tileOffset:10 | priority:2. null when the table is missing. */
  export function readSubsprites(read: { u8(a: number): number; u16(a: number): number; u32(a: number): number; s8(a: number): number },
    tables: number, tableNum: number): SubspritePiece[] | null;
  /** True when the pieces draw something other than the base OAM image (more than one piece covering a different
   *  shape than width×height in row-major 1D order) — only those sprites are composed. */
  export function needsComposition(pieces: readonly SubspritePiece[], width: number, height: number): boolean;
  /** Bounds of the pieces after flips (sprite.c AddSubspritesToOamBuffer: hflip x' = −(x + w), vflip y' = −(y + h)). */
  export function composeBounds(pieces: readonly SubspritePiece[], hflip: boolean, vflip: boolean):
    { minX: number; minY: number; width: number; height: number; placed: { x: number; y: number; width: number; height: number; tileOffset: number }[] };
  ```
  `SpriteSnap` gains `pieces: { x: number; y: number; width: number; height: number; tileOffset: number }[] | null` (offsets inside the composed image); for composed sprites `width/height` = bounds, `worldX = x + x2 + spriteToMapX + minX + width/2`, `worldY = y + spriteToMapY + minY + height` (sprite.y is the centre, see `AddSubspritesToOamBuffer`). The atlas instance attribute stores per instance its pixel origin inside the slot (piece offset) and its own size/tile; a non-composed sprite stays exactly one instance as today.

- [ ] **Step 1: Write the failing test** `tests/subsprites.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { composeBounds, needsComposition } from '../src/game/subsprites';

const truck = [                                            // top and bottom rows of a 48×48 image (a subset of the real table)
  { x: -24, y: -24, width: 32, height: 8, tileOffset: 0 }, { x: 8, y: -24, width: 16, height: 8, tileOffset: 4 },
  { x: -24, y: 16, width: 32, height: 8, tileOffset: 30 }, { x: 8, y: 16, width: 16, height: 8, tileOffset: 34 },
];
describe('subsprites', () => {
  it('composes the bounds of the pieces', () => {
    const b = composeBounds(truck, false, false);
    expect(b).toMatchObject({ minX: -24, minY: -24, width: 48, height: 48 });
    expect(b.placed[1]).toMatchObject({ x: 32, y: 0, width: 16 });
  });
  it('mirrors pieces like the GBA when flipped', () => {
    const b = composeBounds(truck, true, false);
    expect(b.minX).toBe(-24);
    expect(b.placed[1]).toMatchObject({ x: 0, y: 0 });     // x' = −(8 + 16) = −24 → left edge
  });
  it('leaves one-piece and same-shape tables alone', () => {
    expect(needsComposition([{ x: -8, y: -16, width: 16, height: 32, tileOffset: 0 }], 16, 32)).toBe(false);
    expect(needsComposition(truck, 32, 32)).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run tests/subsprites.test.ts` → FAIL.
- [ ] **Step 3: Implement** (`readSubsprites` through `Mem`, cached per table address; composition only for `coordOffset` sprites with `subspriteMode !== 0` and `needsComposition`; HUD/battle sprites untouched). Smoke: the truck's graphics info (`readObjectGraphicsInfo(rom, 94).subspriteTables`, table 0) composes to 48×48.
- [ ] **Step 4: Run** `npx tsc --noEmit && npm test` and the smoke test → PASS.
- [ ] **Step 5: Look.** `npm run regress:live -- --label t10 --static --compare t9`: Retro `lr_truck` / `littleroot_npcs` show the real truck image (diff confined to the truck's rectangle); a static entry `r104_boat` (`map=0.19&focusGfx=88`) shows Briney's boat whole in both styles (inflated in Modern); every other entry 0.00 %.
- [ ] **Step 6: Commit** — `git add src/game/subsprites.ts tests/subsprites.test.ts src/game/state.ts src/render/spriteAtlas.ts tests/smoke/objectGraphics.test.ts tools/regress-live.ts && git commit -m "fix: compose multi-piece world sprites (truck, boats) in the sprite atlas"`

**Acceptance:** Step 5; Retro differs from `p2-base` only on multi-piece sprites.

---

### Task 11 (optional): Occlusion fade for nearby NPCs

Phase 1 fades trees/roofs only between the camera and the player. This extends the same dithered fade to the 3 nearest inflated NPCs within 4 cells of the player (trainers and people you talk to), so they are not hidden behind crowns or roofs. Drop the task if the GPU budget or the look (holes in canopies) does not hold.

**Files:**
- Create: `tests/fadeActors.test.ts`
- Modify: `src/render/kit/materials.ts` (`uFocusExtra`, FADE loop, `setKitFocusExtra`), `src/render/actors/actorLayer.ts` (expose NPC feet), `src/render/overworld/overworldView.ts`

**Interfaces:**
- Produces:
  ```ts
  export const MAX_FADE_ACTORS = 3;
  /** Nearest `max` feet within `radius` (XZ, world units) of the player, excluding the player itself (a foot closer than 0.01). */
  export function pickFadeActors(feet: readonly { x: number; y: number; z: number }[], player: THREE.Vector3,
    max?: number /* 3 */, radius?: number /* 4 */): { x: number; y: number; z: number }[];
  /** Same projection as setKitFocus, one vec4 (px.x, px.y, depth, radius) per actor; unused slots radius 0. */
  export function setKitFocusExtra(u: KitUniforms, feet: readonly { x: number; y: number; z: number }[], camera: THREE.Camera, w: number, h: number): void;
  ```
  `KitUniforms.uFocusExtra: { value: THREE.Vector4[] }` (3 entries); the `KIT_FADE` block tests the player circle as today, then each extra circle with the same core/edge/Bayer rule. Retro: radii 0.

- [ ] **Step 1: Write the failing test** `tests/fadeActors.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pickFadeActors } from '../src/render/kit/materials';

describe('pickFadeActors', () => {
  const player = new THREE.Vector3(10, 0, 10);
  it('keeps the nearest NPCs within the radius, not the player', () => {
    const feet = [{ x: 10, y: 0, z: 10 }, { x: 13, y: 0, z: 10 }, { x: 10, y: 0, z: 11 }, { x: 20, y: 0, z: 10 },
      { x: 11, y: 0, z: 12 }, { x: 8, y: 0, z: 8 }];
    expect(pickFadeActors(feet, player)).toEqual([{ x: 10, y: 0, z: 11 }, { x: 11, y: 0, z: 12 }, { x: 8, y: 0, z: 8 }]);
  });
  it('returns nothing when nobody is near', () => {
    expect(pickFadeActors([{ x: 30, y: 0, z: 30 }], player)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4:** `npx tsc --noEmit && npm test` → PASS.
- [ ] **Step 5: Look.** A static entry `woods_npc` (`map=24.11&focusObj=<an NPC standing north of a crown, recorded>&focus=1`) and live `r101_tree`: the NPC stays visible through the crown; canopies elsewhere unchanged; `gpuMs` + ≤ 0.3 ms vs `t9`; Retro 0.00 % vs `p2-base`.
- [ ] **Step 6: Commit** — `git add tests/fadeActors.test.ts src/render/kit/materials.ts src/render/actors/actorLayer.ts src/render/overworld/overworldView.ts tools/regress-live.ts && git commit -m "feat(kit): occlusion fade also clears nearby NPCs"`

---

### Task 12: Performance, robustness and documentation pass

**Files:**
- Modify: whatever the checks below require (keep fixes small; anything larger goes back to the controller), `README.md`, `CLAUDE.md`

- [ ] **Step 1: Full run.** `npm run regress:live -- --label p2 --static --gpu --selftest --compare p2-base` (both styles) and `--label p2dpr2 --dpr 2 --styles modern --only r101,birch,lr_truck,r104_berries --static`. Check against the Global Constraints: calls ≤ 150, triangles ≤ 1.5 M, `gpuMs` ≤ `p2-base` + 1.0 ms and `cpuMs` ≤ `p2-base` + 0.5 ms (live Modern entries), Retro 0.00 % (except Task 10's sprites), `battle`/`transition` 0.00 % in both styles, self-tests within tolerance, DPR 2 without page errors and with crisp edges.
- [ ] **Step 2: High quality.** One run with `?quality=high` (`--query quality=high --only r101,birch,lr_truck`): the GTAO normal/depth prepass renders with an override material that ignores the actors' instance attributes — if AO artefacts appear (dark quads at the world origin or flat cards), hide the actor and model meshes during that prepass (e.g. `onBeforeRender` checking the GTAO pass's render target) and re-check.
- [ ] **Step 3: First-use hitch.** In live `r101`, `stats.programs` after 30 frames equals the value after 300 frames of walking into Oldale (`steps: [['UP', 300]]` or the Phase 1 crossing route); no frame in that walk exceeds the `p2-base` maximum by more than 16 ms (record the per-frame CPU times from `emu.step` in the report).
- [ ] **Step 4: Live sanity by eye** (`npx tsx tools/shot3d.ts --state out/r101.state --keys "LEFT:1800,DOWN:300"` and `--keys "UP:4000"`): walking/turning animation frames are the game's, characters face the camera when it orbits (`COMMA`/`PERIOD`), a live Settings switch Modern ↔ Retro ↔ Modern and HD ↔ Pixel applies at once, no console errors.
- [ ] **Step 5: Docs.** `README.md`: Phase 2 features (inflated actors, HD sprite edges + setting, object models, what stays a sprite), `CLAUDE.md`: `npm run regress:live` usage (`--static`, `--compare`, `--gpu`, `--selftest`, `?manual=1` + `emu.step`), the `p2-base` baseline, preview `&actors=1&focusGfx=`. List in the report every known gap for the controller's progress log (e.g. objects that stay inflated sprites: boats, S.S. Tidal, moving boxes, dolls/cushions; yaw-dependent shadow shape; Phase 3 to reuse `InflatedActors` + `SpriteField` for battlers).
- [ ] **Step 6: Commit** — `git add -A src tools tests README.md CLAUDE.md && git commit -m "docs+polish: Phase 2 performance checks, harness docs"` (never `out/`, states or the ROM — they are gitignored; check `git status` first).

**Acceptance:** every Global Constraint verified with numbers in the report.

---

## Self-review

**Spec §6 coverage:** inflated sprites — distance field (Task 4, D1 GPU instead of CPU chamfer), camera-facing 16×32 grid displaced by `k·sqrt(d)` (Task 5, D2 front sheet only), normals from the height gradient lit by the scene lights replacing `charLight` (Task 5), rim light (Task 5), real shape shadows via a custom depth material (Task 5), animation frames the game's own (atlas unchanged), flat decals and grass overlays unchanged (Tasks 3/5). HD edge-smoothing with a nearest setting (Task 6, D3 scale-free instead of a 4× atlas). Object model replacements by graphicsId: item ball, boulder, breakable rock, Cut tree (kit tree geometry), berry trees per stage from the sprite's animation (Tasks 7–9), unmapped objects inflated (Task 5 routing), live position/animation followed and removal animations shown as sprites (Tasks 7–8, D4). Spec §9.1 unit tests: distance field + inflation maths (Task 4), upscaler on fixtures (Task 6), mapping/colours (Task 7). §9.3 save-state shots (Tasks 1–2). §10 budgets (Global Constraints, Tasks 5/8/12). §7 reuse: `SpriteField` / `InflatedActors` take plain textures/specs (Global Constraints). Phase 1 gaps addressed: characters still billboards (Tasks 5–9), NPC occlusion fade (optional Task 11), moving truck (Tasks 8/10), first-use compile hitch for the new materials (Tasks 8/12).

**Interfaces used across tasks:** `blankSprite` (T2 → T3, T5 tests), `routeSprite`/`cardSpec`/`ActorLayer`/`ActorFrame` (T3 → T5, T8, T11), `ActorLayer.counts()` (T5 → T8 tests), `ActorLayer.setPixelSource`/`precompile` (T8), `INFLATE`/`inflateMax`/`SpriteField` (T4 → T5, T6), `InflatedActors.setSmoothing` (T5 → T6), `objectModelFor`/`modelImageHeight`/`SpriteColorCache`/`SpritePixelSource` (T7 → T8, T9), `ObjectModels`/`MAX_PER_KIND`/mesh names by kind (T8 → T9), `SpriteSnap.animNum/images/subsprite*` (T2 → T7, T8, T10).
