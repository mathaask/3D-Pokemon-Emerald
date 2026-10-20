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
- Task 10: `PostFX.setSize` passes drawing-buffer pixels to `EffectComposer.setSize`, which multiplies by the pixel
  ratio again — at DPR 2 the scene renders into a 4× drawing-buffer target (5120×3200 for a 2560×1600 buffer). The
  occlusion fade therefore takes its pixel size from `post.composer.renderTarget1`, not the drawing buffer; shot3d
  runs at DPR 1 and can't show the difference. `out/littleroot.state` is indoors (Brendan's house cutscene) —
  live fade checks use `out/r101.state` (e.g. `--keys "LEFT:1100,DOWN:700"` puts the player against a treeline).
- Task 11: at the Classic camera (pitch ≈ 47°) a blade of height h standing d in front of a billboard hides it
  only up to h − 1.07·d, so radially pushed grass bares the legs: KIT_BEND now parts blades beside/behind an
  actor and leans the ones in front *in* towards the legs (uses `cameraPosition`; `--keys "LEFT:1800,DOWN:300"`
  on `out/r101.state` stands the player inside a patch). Terrain under grass takes the blade colour (gaps read as
  grass). Ash grass (MB.ASHGRASS, Route 113) is grass. Flowers need ≥ 2 small petal blobs outlined in foliage —
  petal counts alone also take roof eaves, signs, paving edges and Fortree's speckled grass; on the regression
  maps only General 0x004 (and Route 110's copy 0x206) are flowers.
- Task 12: the analysis' door flood fill is no footprint — it swallows lamp posts, fences, gardens, crater rock and
  Route 113's ash forest, joins neighbours (Mauville House2 + Mart) and can hand a building's upper half to the
  neighbour flooded first (Lavaridge's Mart region holds the PC's roof). `buildingLayout` (footprints.ts, memoised per
  analysis) grows footprints from each door instead; region cells outside them (`stray`) are blocks again for
  trees, `doorStructures` and the legacy emitter. Pokémon Center/Mart "signs" are bg events on their *wall* cells,
  PC/Mart/lab doors are 2 cells wide with a warp on one, tents have 2-row doors, and Mart/PC/gym walls use the same
  pale blues as house windows (glass is judged against the wall colour). Fortree's treehouse side posts run 1–2 rows
  past the door row: `doorStructures` now keeps such short posts. At margin 14 Lilycove's Department Store tiles
  read as water (blue blocks beside the map-edge sea): no building there.
- Task 13: specials whose doors are NON_ANIMATED_DOOR warps on walkable cells (Slateport Oceanic Museum, Stern's
  Shipyard, Fan Club, Harbor; Mauville Game Corner; Lilycove Museum; Devon Corp) get no footprint — `buildingLayout`
  seeds only blocked doors — so they stay legacy art and get no facade (part of the Oceanic Museum is even K.Tree).
  At the Classic pitch the 0.25 roof overhang hides the top ≈ 0.27 of a wall: signs hang just above the door, and
  PC/Mart/gym walls are 0.3 taller. Signs are `CanvasTexture`s cached per session; a page's first canvas text costs
  2–7 ms in the app (≈ 80 ms on a blank page: font init). Lone roof-edge cells (27 on all maps) are owned but left
  unclaimed: legacy draws them as standing faces behind the roof (several are no roof: Lavaridge's cliff foot,
  Sootopolis' ledge end).
- Task 13b: walk-in doors are NON_ANIMATED_DOOR warps on walkable cells; ≈ 60 on outdoor maps, mostly cave mouths
  (General 0x0a7), forests and Fortree's treehouses (their front cell is a NO_RUNNING walkway). A walk-in door cell's
  analysis height can sit below the street (Game Corner 0 vs 2, Lilycove Harbor 0 vs 4): the building claims its
  surface and lays a threshold. The Lilycove Museum's door is behind a walkable landing (front one row lower). The
  Dept Store's water reading is the blue-block→water pass cascading row by row from the border sea; that cascade is
  load-bearing (≈ 28k cells on Dive maps), so it stays. Buildings draw non-rectangular corners with the ground's own
  8×8 tiles in any quarter (the Slateport tent's bottom = grass 0x001's top half). Stern's Shipyard's back row is an
  elevation-1 pier the height solver lifts to 4 (top of the building's face): it floats behind the 3D roof.
- Task 14: gTileset_General holds signs (0x003 metal, 0x01b wooden), the grey post fence and the white rail (with
  corners and N-S runs drawn on one side of the cell: `GENERAL_FENCE_SHAPES`), boulders and 2x2 cone rocks, but no
  lamps, mailboxes, bushes or bollards: a house's "mailbox" is the 0x003 sign beside its door, and Rustboro's lamps
  are its own tileset's (post 0x21a, lantern overhang 0x212/0x213 above) — `tables/secondary.ts`, keyed by the
  secondary tileset's address (`ClassifyOptions.secondaryTileset`). NARROW_TREE holds fence posts (0x132/0x133/0x139)
  and the cone rock's top (0x083/0x084); the props take them. The height solver reads any blocked row between two
  walkable areas as a one-level face (Route 110's islet: sign + secret-base tree): props skip such steps.
  Brown rock standing in the sea (0x172–0x17f, 0x182, 0x184) stays out of `GENERAL_ROCK` (the cliffs made square
  blocks with water-coloured tops of it) — but the cliffs' colour fallback still makes boxes of 392 such cells (Task 15). Secret-base spots (behaviours 0x90–0x9d: cave holes, shrubs, the
  secret-base tree; 75 cells, each under a secret-base bg event) are a gameplay cue: `isSecretBaseSpot` (semantics.ts)
  keeps every family off them (cliff/tree runs break there) so they stay legacy art.
- Task 15: `tests/smoke/semantics.test.ts` (smoke config) pins the families on real maps (every town's PC/Mart/Gym,
  Dive maps terrain-only, Fortree's treehouse corners, no tree in front of a warp, 75 secret-base spots unclaimed)
  and writes `out/coverage.txt` + `out/coverage-all.txt` (legacy share of non-void cells at margin 14; the margin
  dominates small maps, so the reports also give the map-only share). **Coverage: regression average 9.0 %** (max
  Sootopolis 77.6 % — its white crater rock is not rock to the cliffs; next Route 119 7.2 %); **all 68 outdoor maps
  12.7 %** (16.2 % of map cells). Mountain maps stay mostly legacy — Mt Chimney 89.9, Lavaridge 87.6 (28.5 in-map),
  Jagged Pass 81.1, Route 112 79.6, Route 111 62.0, Route 114 19.0 — because their rock-mass top tile (0x071, 0x271,
  0x241) is also their walkable plateau floor: the cliffs' common-floor-colour veto rejects the masses and tints
  the mass tops with a dark face tile. Sky Pillar Top's 87.8 is its cloud backdrop. Secondary-tileset flower beds
  fail the blob test and are **not drawn at all** in Modern: Route 117 0x208–0x217 (52 floor cells) and Ever Grande
  0x290–0x297 (76 floor + 38 stairs cells) draw their flowers in the bottom layer (topCover 0), terrain claims the
  surface and paints plain ground, legacy skips the floor quad and there is no top card — the coverage metric
  counts them as modelled. (Ever Grande's flowers over stone, 0x298–0x2a7, are top-layer art: legacy cards stay.)
  The metric also ignores CLAIM_TOP overhang cards, so its shares understate legacy. Sea rock: the cliffs' colour
  fallback (`isRocky`) still takes 392 General sea-rock cells (0x17a/17b/17c/182/184…, 18 maps, most on Routes
  124/127/133) as cliff boxes, despite their absence from `GENERAL_ROCK` (Task 14 above). The analysis'
  colour-guessed trees (secondary green blocks) in the column north of a warp are left to legacy art: they were
  Petalburg Woods' north exit, Mt Pyre's summit path and the Trainer Hill door's lintel.
- Task 15b (cliffs.ts): the common-floor-colour veto is now a structural rule. A block tile in the ground's colour
  (no foliage, not water-coloured, its ground layer showing that colour) is a mass *top*: rock only where its run
  stands on a rock face. Free-standing masses topped so become **terraces** (from the foot up, each band of ≤ 3
  face rows rises from the height reached, carrying the tops above it; vertical strips of face tiles are part of
  the top; an unmatched band or a taller face flattens onto the band below); each top cell takes the walkable
  ground's look of its own tile. Block runs with nothing in front (running off the grid, into a tree or another
  model) made only of such tops become kit ground at the level legacy lays them flat. Tables: `GENERAL_SEA_ROCK`
  (the sea cliffs 0x172–0x17f, 0x182, 0x184 and the shoal-rock tops `GENERAL_SHOAL_TOPS` 0x157, 0x15e, 0x15f) is
  never rock and breaks runs; the rows under a shoal top are that shoal rock's own and stay legacy too, whatever
  their tiles (0x166/7, 0x16e/f are land rock elsewhere: Mossdeep's coastal corners under land rock). A land
  face standing on a sea cliff (never a shoal top) at the waterline stands on the water behind it (the sea rock
  keeps its legacy card in front; walls at the water line up at the waterline); islet tops on sea rocks stay
  legacy. `SECONDARY_ROCK` (Sootopolis' crater, the table decides: houses/railings in its colours are never rock;
  stray flood-fill crater cells of a modelled building count; one-row crater walls between walkways at one level
  are free-standing capped walls, drawing only their visible faces); `SECONDARY_ROCK_TOPS` (Lavaridge's pink top,
  whatever the ground's colour). Lava is no rock (saturation > 0.6). **Coverage (all / map): Mt Chimney 89.9/72.7
  → 44.6/65.9, Jagged Pass 81.1/41.3 → 21.5/39.5, Route 112 79.6/49.3 → 23.2/44.9, Route 111 62.0/30.1 →
  15.5/28.8, Route 114 19.0/43.5 → 13.4/30.8, Sootopolis 77.6/51.8 → 25.2/34.7, Lavaridge 87.6/28.5 → 16.2/23.3;
  regression average 9.0 → 5.2 %; all 68 maps 12.7/16.2 → 7.8/15.6.** Sea rocks: 0 cliff cells on a sea-rock id,
  under or on a shoal top (smoke-asserted on all maps). Route 126 23.8 % in-map as before; Mossdeep 11.4 → 12.3 %
  in-map, exactly its 27 former sea-rock boxes (land cells 293 → 293). Still legacy: the in-map ridge fields of
  Mt Chimney / Route 112 (diagonal ridges whose column stacks disagree; needs a 2D height solve — a known Phase 1
  gap by ruling), Sootopolis' N-S wall strips, rock 1-row walls elsewhere.
- Task 15c: town flower beds are 3D flowers. `SECONDARY_FLOWERS` (tables/secondary.ts, keyed by tileset; SYM gained
  `gTileset_Mauville`, `gTileset_EverGrande`): Mauville 0x208–0x217 (Route 117, Verdanturf), Ever Grande
  0x288–0x2a7 (incl. the beds under a stone ledge, whose top layer stays legacy). A bed tile draws two kinds:
  `FlowerCell.second`, 4 flowers per cell (2 + 2), colours = hue families of the bed's flower-head colours
  (mean of each; a third family = centre). Flowers take K.Stairs too and claim the new `CLAIM_DECOR` (bit 8).
  The blob test no longer plants "flowers" on Dewford's bushes (sand/sea showing between leaves: a bottom layer
  mostly petal-coloured). **Terrain safeguard:** a walkable (not ledge) cell without `CLAIM_DECOR` whose bottom
  layer draws ≥ 24 px of decoration (`decorationPixels`: vivid non-water colours far from the tint, in blobs
  spanning ≥ 3×3 with ≤ 4 px on the tile border, not hidden by the top layer) keeps its legacy art. **Survey (all
  68 outdoor maps): flower-art cells modelled 725/941 → 941/941 (lost 216 → 0: Ever Grande 152, Route 117 52,
  Verdanturf 12); false flowers 95 → 0 (Dewford 32, Routes 105–107 63); decoration painted over 95 → 0; cells the
  safeguard keeps: 2 (Battle Frontier East (42,50), (48,50): flowers half under the palace roof).** Trees:
  colour-guessed K.Tree tiles need ≥ MIN_LEAF foliage pixels — 99 cells on 10 maps go legacy, all checked not
  trees (Trainer Hill facade, Mauville/Route 111/117 log posts, Verdanturf's green fence, Petalburg Woods' south
  exits, Mt Pyre summit passage); the warp-passage rule runs past them. Coverage all/map 7.81/15.59 → 7.85/15.73 %;
  regression average 5.3 %.
- Task 16a (polish backlog, 9 items): (1) a COVERED tile whose top layer paints ≥ 128 px over its bottom in other
  colours is tinted from the composite (not ledges, not Dive maps): Ever Grande's brick path, General/Fallarbor rock
  tops, Fallarbor's orange paths, boardwalks — 441 cells on 31 maps, plain ground unchanged;
  `SECONDARY_KEEP_LEGACY` (tables/secondary.ts) keeps BF East's Poké Ball emblem (15 cells), the Battle Pike's jaw
  (BF West, 6) and Route 109's loungers/float (72) as pixel art. (2) The water family draws its surface under the art
  it leaves to legacy on the water (boats, cycling-road and bridge edges, overhangs, blocks standing in water by
  behaviour or colour) and claims `CLAIM_WATER_UNDER` (32); legacy draws them with the new atlas variant
  `Variant.Dry` (water colours cut out, alpha-tested, floors +0.06 over the swell) and drops pixel-water floors under
  such blocks: water-showing legacy quads beside kit water 10,090 → 343. (3) `CLAIM_BLADES` (16): the grass overlay
  sprite is hidden only on cells with 3D blades (`World.hasGrassBlades`, `hidesGrassOverlay`). (4) The fade radius is
  0.69 × the character's projected height (= 0.11 h at Classic's default zoom), capped at h/2. (5) No family claims a
  secret-base spot, opened or not (trees' crown/run-top, flowers, water, buildings' and props' overhangs). (6) Trees
  use an explicit style index (seeds/variants). (7) Depth twins drop KIT_BEND. (8) Special facades' window panes
  (glass colours in pane-sized runs) glow at night (tGlass mask, 32 of 44 facades). (9) Bed petal colours are
  luma³-weighted (Ever Grande yellow bfaf43 → d3c43b). The map preview takes `&h=`. 518 maps 0 failures; regress
  t16a ≤ 75 calls / 403k tris.
- Task 16 (polish/perf): soft sun shadows by quality (`OverworldView.setShadowQuality`: 1024/2048/4096 with a PCF
  `shadow.radius` keeping a ~0.06-unit soft edge; three r186 has no PCFSoftShadowMap any more); `Renderer.setWorldStyle`
  (Modern tilt-shift 0.52/0.3/1.2, Retro 0.52/0.22/2.2, `tiltShiftFor`); PostFX works in drawing-buffer pixels
  (`composer.setPixelRatio(1)`, `PostFX.sceneTargetSize()`): at DPR 2 the scene target is 2560×1600, not 5120×3200
  (GPU frame 400–550 → 80–117 ms on the dev iGPU); the metatile atlas redraws only when its 32 KB of BG tiles, BG
  palettes, char base, tilesets or ground refs change (live Route 101: half the synced frames; preview: once), skips
  the Dry band unless a Dry quad exists, and draws without a clear; the water shader gates shore-foam noise, rock
  fetches, waterfall streaks and pool fbm (same pixels); the fade circle centres on the sprite's screen middle with a
  0.85-radius full core (`FADE_CORE`: feet to head top never hidden); `WARM_GLOW_GLSL`; cliffs use
  `groundLayerLook` (output identical to pre-16a on all 82 outdoor maps). **Status (final perf):** regress t16 max
  74 calls / 403,269 triangles (medium, 1280×800; budgets 150 / 1.5 M); GPU frame (timer queries, Intel iGPU,
  medium) Route 119 17.6 → 16.9 ms, Woods 18.9 → 17.8, Route 124 17.0 → 15.2; warm rebuild (`PreviewApp.rebuild()`,
  as crossing a connection) ≤ 83 ms on every regression map + Ever Grande (Route 119 71, Ever Grande 57); the cold
  first build in a page (regress `buildMs`) is machine-state dominated on the dev laptop (same code: 41–134 ms in a
  quiet session, 88–245 ms under load; base vs Task 16 equal in interleaved A/B) — see task-16 report.

## Next step
- Continue Phase 1 at the first unticked task below (ledger has the exact state).

## Phase 1 tasks
- [x] 1 regress harness · [x] 2 golden + split · [x] 3 style/events · [x] 4 kit foundation
- [x] 5 semantic core · [x] 6 terrain · [x] 7 water (+6b terrain colour fix) · [x] 8 cliffs · [x] 9 trees · [x] 10 fade
- [x] 11 grass/flowers · [x] 12 buildings I · [x] 13 buildings II (+13b walk-in specials) · [x] 14 table/props
- [x] 15 smoke/coverage · [x] 15b rock+mountains · [x] 15c town flowers · [x] 16a polish backlog · [ ] 16 polish/perf · [ ] 17 live check/docs

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
