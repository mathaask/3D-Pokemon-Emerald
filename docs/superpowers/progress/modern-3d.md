# Modern 3D models — progress log

Spec: `docs/superpowers/specs/2026-10-19-modern-3d-models-design.md`

## Status
- 2026-10-19: Brainstorming done. User chose: modern stylized 3D; scope = outdoor, interiors,
  characters, battles; approach A in 4 phases. Spec approved ("go for it").
- Git repo initialised; baseline commit `667c190`.
- Phase 1 plan written: `docs/superpowers/plans/2026-10-19-phase1-outdoor.md` (17 tasks). User approved;
  executed **subagent-driven** on branch `phase1-outdoor` (+ inserted tasks 6b, 13b, 15b, 15c, 16a, 17b and a final
  review fix wave). **Phase 1 is complete; final whole-branch review clean.** The full execution ledger (every
  controller ruling + the deferred-minor backlog per task) is preserved in
  `docs/superpowers/progress/phase1-sdd-ledger.md`; the final review in `phase1-final-review.md`.
- 2026-10-20 → 2026-10-22: Phase 2 plan `docs/superpowers/plans/2026-10-20-phase2-characters.md` (12 tasks), executed
  subagent-driven on branch `phase2-characters`. **Phase 2 is complete** (see "Phase 2 result"); its ledger is in
  `docs/superpowers/progress/phase2-sdd-ledger.md`.
- 2026-10-27 → 2026-10-28: Phase 4 plan `docs/superpowers/plans/2026-10-27-phase4-interiors.md` (13 tasks), executed subagent-driven with parallel agents on branch `phase4-interiors`. **Phase 4 is complete** (see "Phase 4 result"); ledger `docs/superpowers/progress/phase4-sdd-ledger.md`.
- 2026-10-23 → 2026-10-27: Phase 3 plan `docs/superpowers/plans/2026-10-23-phase3-battles.md` (12 tasks + inserted 7b,
  12a), executed subagent-driven on branch `phase3-battles`. **Phase 3 is complete** (see "Phase 3 result"); ledger
  `docs/superpowers/progress/phase3-sdd-ledger.md`, final review `phase3-final-review.md`.
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
  `tests/legacyClaims.test.ts`). `disposeKit` frees everything under the kit group (geometries can opt out via
  `userData.shared`), but returns kit materials to the session pool (`releaseKitMaterial`: their shader programs
  outlive the build); textures a family creates go in `kit.disposables`. Per-build uniform values go through
  `kitMaterial`'s `uniforms` (copied into the material's own slots when it is handed out).
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
  `shadow.radius` keeping a ~0.06-unit soft edge; three r186 has no PCFSoftShadowMap any more; Modern only since
  Task 17b — Retro keeps the pre-Phase-1 2048 / radius 1); `Renderer.setWorldStyle`
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
  as crossing a connection) is ≤ 83 ms steady-state (median of 5) on every regression map + Ever Grande (Route 119
  71, Ever Grande 57), BUT the first 1–2 rebuilds after boot are 98–193 ms while the JIT warms up (Route 119
  193/136, Littleroot 161/115) — the first map crossings of a session may hitch slightly (accepted; a boot-time
  warm-up build would remove it). In Modern, interiors/caves/battles also get the gentler blur + softer shadows. The cold
  first build in a page (regress `buildMs`) is machine-state dominated on the dev laptop (same code: 41–134 ms in a
  quiet session, 88–245 ms under load; base vs Task 16 equal in interleaved A/B) — see task-16 report.
- Task 17 (live check, docs): live play from `out/r101.state` (free to walk; `out/s22.state` walks Littleroot before
  the starter, `lr_out`/`s24`/`s26` are cutscenes or blocked) — Route 101 → Oldale → Route 101 and Route 101 →
  Littleroot → Route 101 in Modern: one kit group after every crossing, no family failures, no page errors (only the
  favicon 404), the player never hidden (dithered fade through tree crowns), tall grass parts around the player and
  NPCs, the GBA grass overlay hidden on blade cells and shown again after a live switch to Retro (and back: the kit
  rebuilds). Live crossing rebuilds (one per crossing) 20–45 ms once warm, 59–112 ms for the first crossing of a
  session. **Found (fixed in Task 17b, below):** buildings in a connected map's strip of the live grid were built
  without that map's events (`liveEvents` read the current map only): seen from Route 101, Oldale's Pokémon Center
  was a plain house model and its neighbour pixel art, both switching models when you crossed. Retro regress at
  Task 17 = `before` in calls/triangles (−1/−2 everywhere: the atlas no longer draws every frame); its pixels then
  differed at shadow edges (the Task 16 PCF `shadow.radius` was set per quality in both styles — Task 17b restored
  Retro's pre-Phase-1 shadows) and in water animation phase. Cold regress `buildMs` (first build in a page,
  informational) peaked at 329 ms (Route 119 h11) in this run.
- Task 17b (controller-inserted, after Phase 1): **live events include the connected maps' strips.**
  `kit/events.ts` `liveGridEvents` reads the current map's events plus every connected map's (header.connections →
  gMapGroups → its header), shifted by `stripPlacement` exactly as fieldmap.c `Fill{South,North,West,East}Connection`
  lays them into gBackupMapLayout (map + 15 columns / 14 rows; south/north/west strips 7 cells, east 8; dive/emerge
  not laid out; a cell two strips share belongs to the later one), kept only on the copied cells; cached per
  events/connections/layout (0.02 ms uncached). Unit-tested against a literal transcription of the C fill over a sweep
  of offsets, and live against the real backup grid (`r101`, `s22`: every strip cell equals the neighbour's layout).
  Live from Route 101: Oldale's Pokémon Center (sign + emblem) and the house beside it are the same models before and
  after crossing (emblem z 3.71 → 23.71 = the 20-row origin shift). Game-wide static check (57 connected outdoor maps):
  all 39 strip buildings now have their own map's kind (15 corrected); 12 differ only in extent where the strip cuts
  them. **Retro shadows** are the pre-Phase-1 ones again (`shadowSettings(q, style)`: Retro 2048 / radius 1 at every
  quality, applied on a style switch): Retro regress = pre-Task-16 Retro byte for byte (11 maps; the 5 water maps
  differ only in animation phase). The rest of the Retro-vs-`before` residual (Littleroot 0.59 % px > 2, rows of
  texel edges in the tilt-shift bands) is Task 16a `c5d37e7`'s 5-variant metatile atlas (3072 → 3840 px tall:
  nearest-texel rounding moves); with a 4-variant atlas it is byte-identical — left as is (sub-texel, not a look change).
  Tests: `npm test` 21 files / 423; smoke golden + semantics 15; `tsc` clean.
- **Final review fixes (2026-10-20, report `.superpowers/sdd/2026-10-19-phase1-outdoor/final-fix-report.md`).**
  I1: every rebuild destroyed and recompiled every kit shader program (three releases a program with its last
  material): `disposeKit` now returns kit materials to a session pool (`kit/materials.ts`, per KitUniforms, handed out
  oldest first; each build's textures/geometries/instance buffers still freed) and the legacy tree cards keep one
  material pair. First frame after a warm rebuild (`PreviewApp.measureRebuild()`, median of 5, Modern / Retro):
  Oldale 193.5 / 56.0 → **28.4 / 24.5 ms**, Route 113 153.3 / 29.8 → **35.6 / 22.4**, Route 119 298.3 / 55.5 →
  **26.5 / 26.2**; 0 programs re-created per rebuild (was 6–12). Regress `final` stats.json now has `rebuildMs` +
  `firstFrameMs`: Modern build + first frame ≤ 131 ms on every regression map. Live (r101): warm crossings 30–61 ms
  frames; a map's first visit in a session still compiles the programs it is the first to use (Oldale's water +
  seabed: one 558 ms frame, then 50 ms). M1: Dive-map banks were drawn twice (terrain + legacy connector, 1,037
  edges): `CLAIM_BANKS` → 0. M2: `safeLiveGridEvents` (unrecognised ROM: no frozen render loop). M5: family
  failures warned once per map (`mapKey`). M6: a style switch with the settings panel open rebuilds at once. M7:
  unknown saved `worldStyle` → Modern. P2: Fortree deck-height smoke check. Tests 22 files / 442; smoke 17.

## Phase 1 result (2026-10-20)
Modern style draws terrain, water, cliffs/ledges, trees, tall grass, flowers, buildings (houses, lab, PC, Mart, gyms,
special facades) and props (signs, mailboxes, lamps, fences, rocks) on every outdoor map; Retro 3D is the old look.
- **Stats (regress `phase1`, medium, 1280×800):** max 74 draw calls (Petalburg), max 403,269 triangles (Fortree);
  budgets 150 / 1.5 M. Warm rebuild ≤ 83 ms on every regression map (Task 16); live crossings 20–45 ms warm,
  59–112 ms for the first crossing of a session. Since the final review fixes the first frame after a rebuild costs
  no more than in Retro (no shader programs re-created): build + first frame ≤ 131 ms on every regression map
  (regress `final`, `rebuildMs` + `firstFrameMs`). Cold `buildMs` (first build in a fresh page; informational by
  ruling, machine-load dominated) up to 329 ms (Route 119 h11) in the `phase1` run.
- **Coverage (legacy share, `out/coverage*.txt`):** regression maps 5.3 % average (Littleroot/Oldale 0 %, worst
  Sootopolis 25.2 %); all 68 outdoor maps 7.9 % of the grid, 15.8 % of map cells. Worst by map cells: Mt Chimney
  65.9 %, Ever Grande City 53.3 %, Sky Pillar Top 46.3 % (its cloud backdrop), Route 112 44.9 %, Jagged Pass 39.5 %,
  Sootopolis 34.7 %.
- **Tests:** `npm test` 22 files / 442 tests (after the final review fixes); smoke golden + semantics 17 tests; `tsc` clean.
- **Known gaps:**
  - Mountain ridge fields need a 2D height solve (proposed follow-up "terrain height solver v2"): Mt Chimney (65.9 %
    of map cells legacy), Route 112 (44.9 %), Jagged Pass (39.5 %) are mostly pixel-art rock; Sootopolis' N-S crater
    wall strips, Mossdeep's diagonal rock ridges and some 1-row rock walls too.
  - **Ever Grande City** (53.3 % of map cells legacy; grid: 1,410 block + 290 building cells): a rock-mountain map.
    Its legacy blocks are General mountain rock (0x071–0x07d, 0x089: the mass-top tile is also the walkable plateau
    floor, as on the mountain maps above). Its legacy "building" cells are rock walls, not buildings: the analysis'
    door flood fill spreads from the Victory Road cave mouths (18,27), (18,41) and the League / PC doors into the
    surrounding rock, so the cliffs skip it and no footprint models it (the League and the PC are modelled). Found
    with `.scratch/t17eg.ts` (legacy-cell map + metatile histogram per map).
  - **Sootopolis** (715 legacy building cells over the grid) and **Lavaridge** (215): crater / cliff rock the door
    flood fill labels "building" around the houses carved into Sootopolis' crater and along Lavaridge's Mart/PC
    cliff rows (Task 12); the houses, PC, Mart and gym themselves are modelled.
  - Interiors keep the Retro reconstruction until Phase 4 (`gTileset_Building` furniture); caves are not scheduled
    in the spec yet; Dive maps draw only their seabed terrain in Modern (objects legacy).
  - All outdoor water sits at one level: waterfalls are flat streaked cells; sea currents are not directional;
    puddles/hot springs are wet ground.
  - Stairs are per-cell ramps.
  - Town-tileset fences, bushes and bollards are still pixel art (props only label `gTileset_General` + Rustboro lamps).
  - Lilycove Department Store is read as water by the analysis (no building); legacy specials: Devon Corp, Battle
    Pyramid/Pike/Palace, Fan Club, cable car, Battle Frontier gate/Ranking Hall.
  - ~~Buildings in the connected maps' strips are built without that map's warps~~ — **fixed (Task 17b)**: live events
    include the connected maps' strips. Left: a building the strip cuts can be narrower/shorter (or, where the
    strip's terrain-tile counts differ, wider) than in its own map, so its extent may still change when you cross
    (e.g. a Battle Frontier West special changes size on crossing).
  - Stern's Shipyard's back pier floats behind its 3D roof (the height solver lifts the elevation-1 pier to 4).
  - Rain streaks show below the water surface (the water no longer writes depth).
  - ~~Only the player gets the occlusion fade~~ — **fixed in Phase 2 (Task 11)**: the 3 nearest NPCs within 4 cells too.
  - The first 1–2 map rebuilds after boot may hitch (98–193 ms, JIT warm-up); a boot-time warm-up build would fix it.
  - A kit material kind's shader program compiles the first time it is drawn in a session (then never again): the
    first visit to a map with water stalls one frame (Oldale: 558 ms on the dev iGPU), signs/emblems/flowers less.
    Pre-compiling every kit program at boot (e.g. `compileAsync` over a sample of each kind) would remove it.
  - Pixel-water squares can return under palette effects (drought weather, fades: the Dry cut follows live colours).
  - ~~Characters, Pokémon, field objects are still billboards~~ — **done in Phase 2** (see "Phase 2 result").

## Phase 2 result (2026-10-22)
Modern style draws the player, NPCs and overworld Pokémon as **inflated sprites** (GPU height field from each live
sprite frame, mean-preserving volume shading, sky rim light, silhouette sun shadows via an alpha-tested depth twin,
contact shadows), with **HD sprite edges** (scale-free xBR; Settings → Sprite edges: HD smooth / Pixel). Poké Balls,
Strength boulders, breakable rocks, Cut trees, the moving truck and berry trees (5 growth stages, Modern berry-soil
beds) are **procedural 3D models** coloured from their own sprite's pixels. The truck is composed from its subsprite
pieces in both styles. Nearby NPCs behind crowns/roofs get the occlusion fade. Retro 3D is unchanged except the
(now correct) truck. Executed subagent-driven on branch `phase2-characters`: 12 tasks, per-task reviews + fix rounds,
final whole-branch review ("ready with fixes", 0 critical) + one fix wave + re-review. Full ledger (every ruling,
deferred minors per task): `docs/superpowers/progress/phase2-sdd-ledger.md`.
- **Numbers (Medium, 1280×800, harness `regress:live` labels `p2`/`p2c-final`):** max 117 draw calls, max 466 K
  triangles (budgets 150 / 1.5 M; High with GTAO 140–153 calls, ruled acceptable). Same-session interleaved A/B vs
  flat cards (64 quads): worst +0.45 ms GPU idle, +0.39 ms walking, CPU ≤ +0.18 ms (A/A floor ±0.26 ms), plus the
  field passes 0.13–0.18 ms (budget +1.0 / +0.5 ms). New GPU memory ≈ 9.2 MB (field 8 MB). Phase 2 programs are
  precompiled at the first sync (Medium and High): +0 programs when actors/models first appear or on Retro→Modern.
- **Gates:** Retro 0.00 % vs `out/regress-live/p2-base` on every entry except the composed truck (`lr_truck`,
  `littleroot_npcs`, `lr_truck_switch`). GPU-vs-CPU self-tests: field ≤ 0.02 px, xBR ≤ 2/255.
- **Tests:** `npm test` 37 files / 625 tests; smoke golden + semantics + objectGraphics 26; `tsc` clean.
- **Known gaps:**
  - Objects that stay inflated sprites: boats (Briney's, gfx 88), moving boxes, dolls/cushions, every unmapped object.
  - Oversize multi-piece sprites (S.S. Tidal 96×40, submarine shadow 88×32) still drawn garbled from their base OAM.
  - The silhouette shadow is a camera-facing sheet: its shape changes as the camera orbits.
  - NPC fade uses a fixed sprite height (2) and ignores jumps (lift).
  - Berry soil alone turns moonlit after sunset (art-direction rule); other ground keeps its albedo. 18 berry-soil
    cells on cliff tops (Routes 103/111/120/121) are taken by the cliff family and get no bed (pinned in smoke).
  - xBR merges 1-texel concavities (Zigzagoon's spikes, leg gaps); eyes are kept.
  - Model luminance above 1.15× Retro on rocks / Cut tree (accepted: the Retro cards average in black outlines).
  - The flat-card path (Retro, battles) still re-uploads instance buffers every walking frame (~0.1 ms); the atlas
    and the 4 field passes run on every synced frame even when no sprite changed (0.13–0.18 ms).
  - GTAO's prepass ignores the kit's vertex hooks (Phase 1) and skips flat cards (no card AO). ~~skips actors~~ —
    **fixed in Phase 3**: inflated actors write their own depth + normal into the prepass (both views).
  - First visits still compile Phase 1 world programs (Littleroot flowers 90–150 ms, Oldale water 558 ms) and a map
    crossing rebuilds the world (≈ 52–72 ms) — Phase 1 follow-up.
  - No live save state covers night, surfing or battles-with-actors; night/dusk are verified on static previews only.

## Phase 3 result (2026-10-27)
Modern style rebuilds every battle as a **3D arena per GBA battle background** (24 kinds): outdoor grass / long grass /
plain / sand (trees, grass clumps, flowers, dunes, palms), water (sea with islets, pond with lily pads and a sandy shore,
underwater with caustics, kelp, light shafts), rock (mountain, cave, cave pond, Groudon's lava, Kyogre's sea cave),
indoor halls (building, gym, Leader, Frontier stadium), stadium rooms (Magma/Aqua hideouts, Sidney, Phoebe, Glacia,
Drake, Champion) and the Sky Pillar over a sea of clouds. Colours are sampled from the battle background the game loads
(BG3); outdoor arenas share the overworld's time of day; platforms are modelled per terrain (7 styles). Battlers and
trainer intro pictures are Phase 2 **inflated sprites** (`BATTLE_INFLATE`, baked xBR); move effects, HUD, text and
full-screen BG effects stay 2D. Every battle program is precompiled at boot (own catalogue + drift guard). Retro 3D is
unchanged. Executed subagent-driven: 12 tasks + inserted 7b (draw order) and 12a (review backlog, two parallel agents);
final review as three parallel area reviews (0 critical) + one fix wave in four parallel fixers, each re-reviewed.
- **Numbers (final gate `p3final` @ f50992b, Medium, 1280×800):** Modern battle entries ≤ 56 draw calls, ≤ 268 K
  triangles (b_longgrass) (budgets 150 / 1.5 M); warm arena builds ≤ 26.2 ms (budget 60); battle_enter's first battle
  frame 60–123 ms (cold build of the kind; gate 150); battler luminance 0.966–1.136× Retro, median 1.006. Same-session
  interleaved A/B (Task 12, quiet machine): arena Δgpu +0.61 … +2.77 ms (worst b_rayquaza; budget +3.0), Δcpu
  −0.21 … +0.14; battlers +0.17 … +0.61 ms (budget +1.0). High: actor AO prepass +0.13 … +0.28 ms.
- **Gates:** Retro 0.00 % vs `out/regress-live/p3-base` on every entry (70 shots + 39 GBA/ref pictures); Modern
  overworld, `transition`, `battle_exit` 0.00 %; battle walks compile 0 programs at Medium and High (battle_enter gated
  from right after the eval, so the transition is covered); High runs are deterministic (seeded GTAO noise: 36/36
  byte-identical across runs). `npm test` 839 tests; smoke drift guards (battle + world catalogue) pass; `tsc` clean.
- **Render orders (battle):** scenery and battlers ≤ 2, platform tops 2.5, ground 3, Sky Pillar clouds 3.5, deep
  water −1, sky 10.
- **Known gaps:**
  - Both 3D styles: affine rotation and OBJ mosaic not reproduced; GBA blend registers (semi-transparent / brightened
    effects) not emulated; full-screen BG move effects stay the 2D overlay; Dig/Memento/Mimic can show a flat battler
    copy; BG-palette full fades dim the whole 3D frame, so battlers darken twice for a moment.
  - Arena scope: the sky shows only in reflections and cloud shadows (the camera never frames the horizon); doubles
    share the two platforms; all Frontier facilities share one hall; trainer intro pictures inflate like battlers.
  - First battle of each kind per session pays one cold-build frame (≈ 60–120 ms) inside the battle intro.
  - Look (night): setExposure follows only partly; moonlit field dim; slab tops/sides differ; islet and long-grass
    saturation; rocks on grass moonlit. Look (day): long grass saturated, near blades flat; one palm height; kelp shape;
    faint light shafts; heavy sea glint near the camera; pale mountain scree; Phoebe mid-purple rather than gloomy; the
    Sky Pillar lip reads as a step; Groudon's pools sit behind battlers at yaw ±0.3–0.45 and Magma/Groudon show
    ~65 % of their earlier lava after the sway-safe placement; Groudon's lava blooms (≈ 1–1.2 ms on the dev iGPU;
    Magma's lava and Phoebe's candles stay under the bloom threshold).
  - Camera edge cases: the intro sweep while zoomed to 0.6 can show bare trunks for ~0.5 s (zoom persists); islet
    palms cut at zoom 0.6; no camera clamp beyond 21:9.
  - High: flat cards (Retro, effects) still get no AO; the shadow map is re-rendered inside the AO prepass (unused).
  - Code level: SortSprites ties break by oam.y not index; overworld flat decal footZ/height; no modelled-wall height
    cap; a part that throws after taking a pooled kit material leaks it for the session (≤ 1 per failing key);
    kit/palette `nightSoilScale` not folded onto the shared night helper; `Soup` repeats QuadWriter's winding rule;
    monbg copy history treats a u32 frame-counter wrap like a rewind (one frame, every ~2.3 years of play).

- **Post-merge fix (2026-10-27, branch `battle-feet`, user report "the lower body of big Pokémon is hidden in the
  platforms"):** each battler card slides along the reference camera's ray (orthographic, so the GBA layout is exact)
  until its lowest opaque row stands on the platform top; floaters keep their elevation. Before: up to 12 rows hidden
  (Groudon, Steelix, Aggron, Onix 12, Snorlax 11, Wailord 10); after: 0. Applied to **both styles** (Retro had the same
  bug: a deliberate, user-requested break of the Retro pixel rule; new Retro battle reference = this fix). Moved
  opponents look ≈ 7 % bigger under the perspective default camera. Gates: non-battle shots 0.00 %, walks compile 0,
  luminance 0.967–1.124, A/B +2.57 ms (within the Phase 3 reference), battle_enter first frame 61.7 ms (quiet run).
  Report: `.superpowers/sdd/battle-feet-report.md` (gitignored).

## Phase 4 result (2026-10-28)
Modern style models the **137 in-scope interiors** (houses, Pokémon Centers, Marts, labs, Brendan's/May's house: the
spec's five secondaries; the Lilycove Dept Store rooftop ruled out) as real rooms: walls with thickness, baseboard,
rail and crown, framed glass windows, clocks, Scale4x wall decals, half-height partitions, doorways; floors (boards,
tiles, carpet, rugs, mats) through one shader; window light shafts; furniture at real-world heights (beds, tables,
chairs, TVs, bookcases, kitchens, plants, crates, healing machine, nurse and Mart counters, PCs, Mart shelves, stairs)
coloured from the ROM's static tiles; unknown cells as HD-smoothed legacy boxes; a per-wall cutaway; and **room light
that follows the clock** (user ruling D8). Curated id tables for all five tilesets (100 % labelled, 193 pins); a pure
room-layout analysis (back line, wall runs, windows, doors, partitions; 0 findings on 137 maps, 15 pinned layouts).
Retro, outdoor, battles and every out-of-scope interior are unchanged. Executed subagent-driven with up to five
parallel agents (13 tasks, groups A/B/C, group C in two phases), a 42-finding preflight, three parallel final area
reviews (0 critical), one fix wave in four parallel fixers + re-review, and a perf follow-up.
- **Numbers (Medium, 1280×800):** interior entries ≤ 55 draw calls, ≤ 46 K triangles; warm rebuild ≤ 21 ms (+ first
  frame ≤ 44 ms); new GPU memory ≤ 1.8 MB per interior; door walks: 1 build, 0 compiles, build-frame overhead 24 ms
  (pre-Phase-4 38). Same-session interleaved A/B (kit on vs today's interior): i_lab +1.36/+1.52, i_lab_night
  +1.51/+1.81, houses +1.08..+1.48 ms GPU, Δcpu ≤ +0.41 — **budget ruled +2.0 ms** (the plan proposed +1.5; Phase 3
  arenas got +3.0). Night costs the same as day. Night room luma 0.61–0.63× day, dusk 0.83–0.84×; actors 0.94–0.97× day
  (two-sided gates). Coverage: legacy share 4.5 % average, worst 16.7 %.
- **Gates:** Retro 0.00 % vs `out/regress-live/p4-base` everywhere; outdoor, battles, out-of-scope interiors
  (`i_gym*`, `i_secret`, `i_dept_roof`, `truck_inside`) 0.00 %; programs constant after boot; drift guard over 518
  maps × qualities. `npm test` 1054; smoke (interiors, interiorTables, interiorRooms, interiorFitting, catalogue).
- **Known gaps:**
  - Scope: gyms (10 maps, 8 puzzle tilesets), Battle Frontier, contest halls, museums, Trick House puzzle rooms, E4
    rooms, secret bases, ship, caves keep today's look (a later "Phase 4b"); the Dept Store rooftop is out of scope;
    battles started in a room keep the hall's fixed light (F38).
  - Legacy art (HD boxes): the PC floor emblem and escalators, lift plates, Birch's domed machine and grey unit, the
    lab's book piles, the Weather Institute's tank machine and pillars (decal caps over HD boxes, desks lose their
    papers), the striped bed-overhang art beside Brendan's 2F bed.
  - Shell/light: shafts are light only (no dust); doors don't open; one wall height (2.6) — the Trick House corridor
    (29.2) hides part of its floor at the preview camera; deep partitions' flat lids read as counters; boards read
    strong yellow (the tile's hue); decals are all tagged N (a partition decal would vanish at yaw π; no case today);
    a one-build lag of the indoor light when entering an out-of-scope room from an in-scope one at night.
  - Furniture: no stair rail (closed alcoves); the stairwell rail stands in its warp cell; Mart gondolas duller than
    the coolers; plants read as thin topiaries; the PC's magazine shelf and small shelves are full 2.1 m bookcases.
  - Perf: labs sit near +1.5 ms (walls 0.85–1.1, bookcases 0.65–0.87, HD xBR 0.3–0.5 ms) — follow-up: pre-baked xBR,
    simpler bookcases.
  - Code level: `interiorIds` has no scope guard of its own (World gates it); `ShellPlacement.decals` computed but
    unused by build; loose floor-softening tests; HD cutout shadow pixel-stepped; no unit test for claim rollback /
    cutaway flipping (the harness covers both); coverage tie-break sorts keys as strings; `prepareInterior` and
    `roundBox`/`roundedBlock` duplication left; `shellRuns`/`planOpenings` run 3× per build (negligible).

## Next step
- **Phase 4b (remaining interiors) in progress** on branch `phase4b-special-interiors`, plan `docs/superpowers/plans/2026-10-28-phase4b-special-interiors.md` (15 tasks, user-approved 2026-10-28 with: Retro also gets the incremental cell-change update; REAL raised platforms on gym tiers; a fixture tool may write the warp destination in RAM). SDD ledger `.superpowers/sdd/2026-10-28-phase4b-special-interiors/progress.md`. Started 2026-10-28 — user: "Videre"; scope chosen = ALL four groups (gyms, League/E4 rooms, special buildings, Battle Frontier + secret bases); gym puzzles modernised but reading exactly like the GBA (same cell logic and visibility). Survey `.superpowers/sdd/phase4b-survey.md` → plan(s) in `docs/superpowers/plans/` (likely 4b = gyms + League + special buildings, 4c = Frontier + secret bases), user approval before execution.
- **Phase 4 is complete (2026-10-28)** and merged to `main`. All four phases of the spec are done. Other candidates
  (ask the user): Phase 4b (gyms, Frontier and the other interiors), the terrain height solver v2 (mountain ridges),
  a look-polish pass over the Phase 3/4 known gaps, or interior perf (pre-baked xBR, simpler bookcases).
- **Phase 3 is complete (2026-10-27)** and merged to `main`.

## Phase 4 status
- [x] Plan (user-approved; preflight scan: 42 findings, all rulings applied @ 4f3ed00)
- [x] 1 harness + `p4-base` (105e95a, fix 6df7681: 30 interior entries, door walks, `--interiors`, `NIGHT_TWINS`/`nightLum`)
- [x] 2 battle room geometry → kit (e02f396 pins, a56a8c4 move; battle pixels identical)
- [x] 3 scope/symbols/tables scaffold (bfb5761: 138 in-scope maps, Building tileset symbols, id worklist)
- [x] 4a GenericBuilding (64a29bd, fix 1cc1990) · [x] 4b PokemonCenter + Shop (097220d) · [x] 4c BrendansMaysHouse + Lab
  (7a4ab85) — all five tables 100 % labelled, 193 pins, legacy ≤ 0.8 % (GenericBuilding)
- [x] 5 room layout + colours (cb9a42e, fix 8dcb26e: dividing walls → partition runs on 8 maps, 5 invariants, 15 pinned layouts; 0 findings on 138 maps)
- [x] 6 integration (f197318: families on in-scope maps, cutaway, clock-driven room light — night room 0.61× day, actors 0.94–0.97×; review approved)
- [x] 7 shell (ac2c011, eaa7684) · [x] 8 floors + shafts (466ec2b, 11fda55) · [x] 9 furniture I (0e2940c, 0d23314) · [x] 10 furniture II (4c77c57, 36b107c, 0e1142a, fix 78ef9f5: nurse/clerks visible from the chest up, no navy outlines) — alcove cutaway follow-up 31e9d86 + e39299b; join f5558cb (furniture catalogue)
- [x] 11 legacy HD (d1d6159) · [x] 12 smoke/coverage/live (871b654: coverage avg 4.5 %, worst 16.7 %; Dept Store rooftop ruled out of scope → 137 maps; dusk gate added, actor light fixed in ddf2577: dusk actors 0.96–0.97× day) · [x] 13 perf/docs (be94f11, 7f5e0b9: worst A/B i_lab_night +1.58/+1.44 ms vs +1.5 → floor shader optimisation; rebuild ≤ 21 ms; ≤ 55 calls)
- [x] Final review (3 parallel area reviews: 0 critical, 6 important total) · [x] fix wave (floor shader −0.3–0.6 ms + no floor behind walls; TV-animation colour bug fixed at the root (ROM tiles); two-sided night/dusk gate; shared room helpers; furniture fitting smoke pin) · [x] re-review (all addressed) · [x] crate fix b6c059c · [x] perf follow-up (0fa3fbd, 4aa6509: door-walk build frames) · [x] final gate (perf2) · [x] merged to `main`
- Join gate after group B (`p4b-join`): every entry 0.00 % vs `p4-base`, both styles. Group C gate (`tC-gate`): Retro and everything out of scope 0.00 %; only in-scope Modern interiors change; night rooms 0.61–0.63× day, actors 0.93–0.97×; door walks 1 build, 0 compiles.
- Rulings so far: walkable furniture = low seats (≤ 0.45); chairs/plants one per cell; flat indoor floors; dividing
  walls = half-height partitions (Task 7); battles in rooms don't follow the clock (F38); Dept Store rooftop → Task 12.
  Full ledger: `docs/superpowers/progress/phase4-sdd-ledger.md`; final review `phase4-final-review.md`. Interior GPU budget ruled +2.0 ms.
- **Phase 2 is complete (2026-10-22)** and merged to `main`.
- **2026-10-23: hitch fix done** (user chose "hitch fix, then Phase 3"; in-chat design approved; branch `hitch-fix`,
  reviewed + 1 fix round + re-review, merged):
  - **First-visit compiles gone:** every overworld program (24-mesh catalogue built from the kit families' own
    exported material definitions + legacy materials + actors + sprite bake + field passes) compiles at boot in
    parallel; the one blocking frame (shadow-depth/PostFX programs) is drawn behind the start loader when ready before
    the click, else at the first overworld sync. Programs constant after boot (58 live). Smoke drift guard
    `tests/smoke/catalogue.test.ts`: catalogue signature set == drawn set over all 518 maps × Modern low/medium/high +
    Retro. Before: Oldale water 416–558 ms, flowers 55–600 ms, signs 68 ms on first visits → 0.
  - **One build per map load:** the second build came from reading the game mid-`LoadMapFromCameraTransition` (new
    header, old grid) — `cpu.halted` is never set (busy-wait VBlank), so `src/game/mapLoad.ts` detects it by code
    position (PC/LR/live stacks inside CameraMove) or a warp's 'transition' scene, and `src/render/syncGate.ts` defers
    the whole sync (cap 3 emulated frames for crossings, 30 for faded-out warps). Crossings 2 builds → 1 (Littleroot
    Modern 45+43 → 45–48 ms; Oldale 66+416 → 45–94 ms); door warps too. Harness entries `cross_lr`, `cross_oldale`
    gate programs constant, 1 build, max frame ≤ build + max(40, 0.5×build).
  - **Boot:** cold shader cache + quick click → ~1.9–2.1 s first overworld frame (was 3.3–3.4 s); waiting on the start
    screen → 0.16–0.25 s. JIT warm-up build measured, no gain, not shipped.
  - Remaining: a crossing still costs one world build (≈ 30–75 ms; moving analysis off the main thread would fix it);
    detection relies on the BPEE rev 0 CameraMove address (unknown ROM → old behaviour, bounded by the cap).
- **Phase 3 (battles), 2026-10-23 → 2026-10-27:** plan `docs/superpowers/plans/2026-10-23-phase3-battles.md`
  approved by the user as is ("Godkjenn og kjør"), executed subagent-driven (later with parallel agents at the user's
  request) on branch `phase3-battles`, merged. Ledger: `docs/superpowers/progress/phase3-sdd-ledger.md`.

## Phase 3 status
- [x] Plan (`docs/superpowers/plans/2026-10-23-phase3-battles.md`, 12 tasks)
- [x] 1 battle harness entries + p3-base · [x] 2 arena kinds/ROM graphics/colours · [x] 3 static battle preview
- [x] 4 BattleView split + battle precompile · [x] 5 inflated battlers · [x] 6 arena foundation · [x] 7 outdoor arenas · [x] 7b draw order (inserted; bake = per-kind contingency)
- [x] 8 water arenas · [x] 9 rock arenas · [x] 10 indoor halls · [x] 11 hideouts/E4/Champion/Sky Pillar · [x] 12a backlog (inserted: robustness, frame defects, hygiene; two parallel agents) · [x] 12 perf/docs (verify + docs in parallel)
- [x] Final review (3 parallel area reviews) · [x] fix wave (4 parallel fixers, re-reviewed) · [x] final gate `p3final` · [x] merged to `main`

## Phase 2 status
- [x] Plan (`docs/superpowers/plans/2026-10-20-phase2-characters.md`, 12 tasks; preflight rulings applied @ 2546266)
- [x] 1 live regress harness · [x] 2 preview actors · [x] 3 ActorLayer · [x] 4 inflation field
- [x] 5 inflated actors · [x] 6 xBR edges · [x] 7 gfx mapping · [x] 8 models I · [x] 9 berry plants
- [x] 10 multi-piece sprites · [x] 11 NPC fade · [x] 12 perf/robustness/docs

## Phase 1 tasks
- [x] 1 regress harness · [x] 2 golden + split · [x] 3 style/events · [x] 4 kit foundation
- [x] 5 semantic core · [x] 6 terrain · [x] 7 water (+6b terrain colour fix) · [x] 8 cliffs · [x] 9 trees · [x] 10 fade
- [x] 11 grass/flowers · [x] 12 buildings I · [x] 13 buildings II (+13b walk-in specials) · [x] 14 table/props
- [x] 15 smoke/coverage · [x] 15b rock+mountains · [x] 15c town flowers · [x] 16a polish backlog · [x] 16 polish/perf · [x] 17 live check/docs

## Phases
- [x] Phase 1 — Foundation + Outdoor environment (done 2026-10-20, branch `phase1-outdoor`)
- [x] Phase 2 — Characters, Pokémon, field objects (done 2026-10-22, branch `phase2-characters`)
- [x] Phase 3 — Battles (done 2026-10-27, branch `phase3-battles`)
- [x] Phase 4 — Interiors (done 2026-10-28, branch `phase4-interiors`)

## Key facts (so they don't need re-deriving)
- `classify.ts` is now a wrapper over `analyze.ts` (pure analysis) + `legacyQuads.ts` (quads, honours `Claims`).
- `src/game/rom/maps.ts` already decodes warps + bg events (`MapEvents`); map names in `src/game/mapNames.ts`.
- Live backup grid coords include `MAP_OFFSET = 7` (`src/game/state.ts`); preview uses offset 0. The backup grid is
  the map + 15 columns / 14 rows with the connected maps' strips (`kit/events.ts` `stripPlacement`, = fieldmap.c).
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

## Phase 4b status
- [x] Survey (194 out-of-scope indoor maps; 31 never modelled; cave-like maps → cave pass) · [x] Plan (user-approved)
- [x] preflight (44 findings, all ruled; heights from tierFace labels — game elevation has no tiers; Retro collision edits still rebuild = known gap) · [ ] 1 harness + fixtures + `p4b-base` (c9b08f7: 366 shots; in review) · [x] 2 scope/tables scaffold (b15d351: 182 maps with the 4b flag, 23 tables, tier labels) · [ ] 3 incremental cell-change update
- [ ] 4a–4e tables (all 23 tilesets 100 % labelled: 4a 6240d58, 4b d90cfef, 4c 02124bf, 4d 5c0028b, 4e 463365f; batch review running) · [ ] 5 room layout v2 (9a8f1f9: tier heights from labels; in review) · [x] 6 puzzle state core (71feccb, 169e750) · [ ] 13 rotating gates (running) · [ ] 7 integration
- [ ] 8 puzzle floors · [ ] 9 raised mechanics · [ ] 10 gym/League shell · [ ] 11a props · [ ] 11b special furniture
- [ ] 12 floors v2 + raised tiers · [ ] 14 smoke/coverage/live · [ ] 15 perf/docs · [ ] final review · [ ] merge
