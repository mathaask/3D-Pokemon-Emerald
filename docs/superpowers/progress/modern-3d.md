# Modern 3D models — progress log

Spec: `docs/superpowers/specs/2026-10-19-modern-3d-models-design.md`

## Status
- 2026-10-19: Brainstorming done. User chose: modern stylized 3D; scope = outdoor, interiors,
  characters, battles; approach A in 4 phases. Spec approved ("go for it").
- Git repo initialised; baseline commit `667c190`.
- Phase 1 plan written: `docs/superpowers/plans/2026-10-19-phase1-outdoor.md` (17 tasks). User approved;
  executing **subagent-driven** on branch `phase1-outdoor`. SDD ledger (task-level detail, rulings):
  `.superpowers/sdd/2026-10-19-phase1-outdoor/progress.md` (gitignored) — read it first after a reset.
- Regression baseline (`npx tsx tools/regress.ts --label before`, 16 maps × h11/h21, `out/regress/before/stats.json`):
  max calls 27, max triangles 111213 (route119), max buildMs 162 (route119 h21; build time is noisy, 108 at h11).
  NOTE: route119's legacy build already exceeds the 150 ms budget before Phase 1 (see ledger ruling).
- Task 2: `tests/smoke/golden.test.ts` pins legacy `classify()` output (hash per regression map). Regress PNGs
  are not byte-stable everywhere: littleroot reproduces exactly, slateport's water (right side, ~2–5 % px) differs
  between two runs of the same code — compare such maps by eye + stats, not bytes.
- Task 3: `OverworldView.quality` comes from `Renderer.quality` *after* the `?quality=` URL override (same value
  PostFX uses). Live map events: `OverworldView.liveEvents()` (ROM events table, +MAP_OFFSET); preview uses offset 0.
- Task 4: kit shaders verified in Chrome/ANGLE via a temporary probe in `preview.ts` — check
  `renderer.info.programs` entries whose `cacheKey` contains `kit:` (+ any `diagnostics`). `kitMaterial` replaces
  `<project_vertex>` wholesale, so `USE_BATCHING` (BatchedMesh) is unsupported. It also replaces `<worldpos_vertex>`
  so shadows/env use the swayed pose; the hook GLSL is hashed into the program key (`hookKey` optional); a depth twin
  exists for `wind` or `vertTransform`. Kit materials must not be `clone()`d (onBeforeCompile/key are not copied).
- Task 5: `tests/helpers/fakeMap.ts` `fakeAnalysis(rows)` (no ROM) has a *blocked* border ring, so passable cells
  flanked W+E by blocks become Stairs and a `'#'` row lifts the floor north of it to height 1 (see the header of
  `tests/legacyClaims.test.ts`). `disposeKit` disposes every material under the kit group (only geometries can opt
  out, via `userData.shared`); textures a family creates go in `kit.disposables`.
- Task 6: terrain skips walkable *structure* cells (NON_ANIMATED_DOOR, LADDER, NO_RUNNING = Fortree treehouse
  walkways/ladders, DOOR_BEHAVIORS, Acro Bike rails 0xd3–0xd6) — they stay legacy pixel art. `cellLook` ignores pixels with luma < 0.33
  (outlines/shadows, e.g. Fortree bridge canopy, Route 119 long-grass edges) and takes Deck tints from the composite
  layer (bridge planks are top-layer); SHALLOW_WATER → Sand. Terrain casts shadows (as legacy floors did). Until the
  water family claims water, shore banks are drawn by both terrain and the legacy connectors (coplanar; no visible
  z-fight in regress shots).
- Task 7: every outdoor map's water sits at one level (-0.3; the analysis floods the minimum through connected water),
  so there are no water-to-water steps and waterfalls are flat streaked cells. Water cells keep legacy art when they
  carry an overhang (`hasTop`: bridge decks, roof eaves, canopy over water) or are blocked non-water cells with
  top-layer art (boats, bank edges); the General 2x2 sea rock (bottom row 0x158|0x16c, 0x159|0x16d) becomes a boulder.
  SHALLOW_WATER metatile 0x1ae (Mossdeep/Lilycove) is terrain sand tinted deep blue (Task 6 cellLook) — reads as blue
  blotches next to the new water.
- Task 6b: water pixels in a walkable cell's tile are never its ground — they are the sea beside a shore tile (0x1ae),
  the backdrop hidden under a NORMAL overhang (Slateport roof 0x290–0x293, Mossdeep rocket gantry) or under COVERED
  logs/planks/shallows. `cellLook` takes the dominant non-water colour when ≥ 1/4 of the layer, then a COVERED cell's
  top layer, else `wetGround()` (greyed water, Sand). No land terrain cell is water-tinted any more. Dive maps
  (`ClassifyOptions.underwater`, map type 5; read only by the kit) are exempt: their seabed is drawn in water colours.
- Task 8: colour alone can't tell rock from wood/beige buildings — Devon Corp, Fortree's treehouses and the Game
  Corner are K.Block (their doors are NON_ANIMATED_DOOR warps on walkable cells, so the analysis never floods them)
  and Route 113's ash trees are K.Block with rock-coloured trunk rows. Cliffs therefore skip block masses on a
  warp (`doorStructures`), ignore tiles in the map's common floor colours, need rock masses ≥ 2 columns wide and
  keep only walls whose neighbour column shares the foot row (Mossdeep's diagonal rock ridges stay legacy). Water
  family skips Dive maps. Perf: `noise3` ≈ 0.6 µs/call and MeshBuilder's per-vertex pushes dominate meshes of
  thousands of quads — the cliff build writes typed arrays and uses a 2D value noise (cold browser runs ≈ 2–3× Node).
- Task 9: trees are InstancedMeshes per drawn style × 8-cell map chunk (crown + trunk in one geometry, trunk flagged
  in the vertex alpha). The sun's 48×48 shadow box draws ~3× the view's trees, so each chunk's `onBeforeShadow`
  sets `count = 0` when its shadows can't reach the camera frustum (three then issues no draw). The post grade
  (saturation 1.12, contrast 1.05 around 0.18, linear) crushes the blue of the GBA's yellow-greens to 0 — leaf
  colours are pixel means with capped saturation. Route 113's ash trees are K.Block: found via the map's border
  tiles (a foliage border = the forest); part of that forest is K.Building (the analysis' flood fill from the Glass
  Workshop door) and stays legacy. Tree counts (margin 14): woods 1176, route119 4146 (interior thinned), fortree
  1515, littleroot 491; regress woods ≈ 193k triangles, max 401k (fortree h21), max 64 calls.

## Next step
- Continue Phase 1 at the first unticked task below (ledger has the exact state).

## Phase 1 tasks
- [x] 1 regress harness · [x] 2 golden + split · [x] 3 style/events · [x] 4 kit foundation
- [x] 5 semantic core · [x] 6 terrain · [x] 7 water (+6b terrain colour fix) · [x] 8 cliffs · [x] 9 trees · [ ] 10 fade
- [ ] 11 grass/flowers · [ ] 12 buildings I · [ ] 13 buildings II · [ ] 14 table/props
- [ ] 15 smoke/coverage · [ ] 16 polish/perf · [ ] 17 live check/docs

## Phases
- [ ] Phase 1 — Foundation + Outdoor environment
- [ ] Phase 2 — Characters, Pokémon, field objects
- [ ] Phase 3 — Battles
- [ ] Phase 4 — Interiors

## Key facts (so they don't need re-deriving)
- `classify.ts` is now a wrapper over `analyze.ts` (pure analysis) + `legacyQuads.ts` (quads, honours `Claims`).
- `src/game/rom/maps.ts` already decodes warps + bg events (`MapEvents`); map names in `src/game/mapNames.ts`.
- Live backup grid coords include `MAP_OFFSET = 7` (`src/game/state.ts`); preview uses offset 0.
- `ObjectEventSnap.graphicsId` available for object model replacements (phase 2).
- Indoor maps share primary `gTileset_Building`; outdoor share `gTileset_General`.
- Existing screenshots of the old look: `out/3d/*.png` (pv_*, t_* are map previews).
- PC (red roof 0x050–0x06B), Mart (blue roof 0x030–0x04B), gym facades (0x1C8–0x1D5) are all in
  gTileset_General → identical in every town. Building kind comes from warp destination names.
- Measured ROM ground colours (sRGB): grass (0.45,0.78,0.65); path (0.65,0.84,0.78) pale mint;
  paving (0.81,0.81,0.87); sand (0.87,0.81,0.52); Route 113 ash (0.68,0.68,0.55); water (0.32,0.42,0.84).
- Map ids: Littleroot 0.9, Oldale 0.10, Petalburg 0.0, Rustboro 0.3, Petalburg Woods 24.11 (ROUTE type),
  Slateport 0.1, Mauville 0.2, Route 101 0.16, Route 110 0.25, Route 113 0.28, Route 119 0.34,
  Fortree 0.4, Lilycove 0.5, Mossdeep 0.6, Sootopolis 0.7, Brendan's house 1F 1.0, Granite Cave 1F 24.7.
- Bash heredocs with large content fail in this harness — write big files with the Write tool.
- `npx tsx -e "..."` with dynamic imports hung once; use a script file in `.scratch/` (gitignored).
