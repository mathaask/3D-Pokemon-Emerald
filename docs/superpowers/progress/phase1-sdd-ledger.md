# SDD ledger — plan: docs/superpowers/plans/2026-10-19-phase1-outdoor.md

Spec: docs/superpowers/specs/2026-10-19-modern-3d-models-design.md (reachable)
Branch: phase1-outdoor (from main @ 94eaf15). Baseline: tsc clean, npm test 107/107.

## Setup rulings
- Ruling: work in place on branch `phase1-outdoor` instead of a git worktree — the ROM, node_modules and out/*.state save states are untracked files in the main checkout that the screenshot tools and smoke tests need — cost if wrong: none for main (untouched); a worktree could be created later.
- Ruling: implementers use sonnet (plan carries full code but every task also has visual verification needing judgment); Task 14 (labelling tileset images) and Task 16 (perf tuning) use opus; reviewers sonnet; final review opus — cost if wrong: higher spend or an extra fix round.

## Pre-flight scan
Shared files / interfaces:
| tasks | producer → consumer | finding |
|---|---|---|
| T1/T3/T10/T16 | preview.ts: stats (T1), style/quality/events (T3), setBufferSize+focus (T10), shadow quality+tilt (T16) | additive, compatible |
| T3/T5/T7/T10/T11/T16 | overworldView.ts: style/quality/events (T3) → kitUniforms replaces worldUniforms (T5) → uSky (T7), focus (T10), grass sprites+uActors (T11), setShadowQuality (T16) | T7+ use `this.kitUniforms` introduced in T5 ✓ |
| T3/T5 | world.ts build(grid, opts, ctx) (T3) → kit integration replaces `const claims = null; void ctx;` (T5) | ✓ |
| T3/T16 | main.ts calls overworld.setWorldStyle (T3) → replaced by renderer.setWorldStyle (T16) | ✓ explicit in T16 |
| T4 → T6/T7 | kitMaterial hooks (uniforms, fragHead, fragColor, fragNormal, fragEmissive, vertTransform, hookKey); FRAG_PRELUDE declares uTime/uSky | T7 FRAG_HEAD doesn't redeclare uTime/uSky ✓ |
| T6 → T8/T9 | cellLook, GroundMat, CellLook from terrain.ts | ✓ |
| T8/T9/T11 → T14 | setRockIds / setPineIds / setFlowerIds hooks; blobCrown exported in T14 | ✓ |
| T12 → T13 | addKindDetails / addSpecialFacade stubs filled | ✓ |
| T5 → T6/T7/T8/T12/T14 | tests/helpers/fakeMap.ts (fakeInfo, fakeGrid, fakeAnalysis) | ✓ |
| T2 → T15 | tests/smoke/helpers/maps.ts REGRESSION_MAPS, staticMap.ts | ✓ |
| T5 → all families | index.ts FAMILIES; T14 rewrites the final ordered list | ✓ |
Per-task self-consistency:
| task | check | finding |
|---|---|---|
| T1 | tool only, no unit test | ok (visual baseline) |
| T2 | legacyQuads body = orig lines 460–753, which include line 503 `const hasTop = …`; Step 7 also destructures `hasTop` from the analysis | CONFLICT → redeclaration; see ruling R1 |
| T3 | kitEvents expectations vs gridEvents code (offset 7: (3,4)->(10,11), (6,4)->(13,11); group1/num0 = LittlerootTown_BrendansHouse_1F) | ✓ |
| T4 | palette/geom/materials tests vs code (dominantColor, soften math, quad winding) | ✓ hand-checked |
| T5 | kitRun tests vs semantics.ts/world.ts | ✓ |
| T6 | terrain test (claimed object at groundY, unclaimed block not covered) | ✓ |
| T7 | shoreDistance test (margin 0, 1..4) | ✓ |
| T8 | cliff test: solver gives plateau 2 / lowland 0, F=2, 4 runs, claims rows 2–3 | ✓ hand-checked |
| T9 | pairRoundTrees expectations | ✓ |
| T10 | visual only | ok |
| T11 | petalColors test pixel math (30 red + 15 white) | ✓ |
| T12 | building extract test (3x3 footprint, door x=2, wallRows 2); gable winding fixed in plan | ✓ |
| T13 | scale2x expectations | ✓ |
| T14 | table must contain a 'sign' id (0x003 seeded) for the test | ✓ |
| T15 | assertions depend on real data (Littleroot 2 houses+lab, Oldale pc+mart, Woods ROUTE type ≥100 trees) | plausible; verified at run |
| T16/T17 | uses existing PostFX.setTiltShift(focus, band, strength) | ✓ |
Review-rubric conflicts (plan-mandated defects): none found.

- Ruling R1: in Task 2 the moved line `const hasTop = (i: number) => layer[i] !== 1 && info.topCover[mt[i]] > 0;` is dropped from legacyQuads.ts (hasTop now comes from the analysis destructuring) — same definition, so behaviour is identical (golden test proves it) — cost if wrong: none (tsc would reject the duplicate).

## Tasks
- Ruling: the `sonnet` alias is unavailable on this deployment (HTTP 404 model_not_found) — implementers and reviewers run on `opus` instead — cost if wrong: higher token spend per task, no quality loss.
Task 1: complete (commits 94eaf15..5dba3b3, review clean)
Task 1: minor (deferred): baseline already over rebuild budget (route119 162ms) not flagged in log
Task 1: minor (deferred): regress.ts console vs pageerror share "[page error]" prefix (plan-mandated)
Task 1: minor (deferred): regress.ts weak CLI handling (missing flag value, empty --only, no browser) (plan-mandated)
Task 1: minor (deferred): fixed 3500ms wait instead of a readiness signal (plan-mandated)
- Ruling: rebuild budget — route119 legacy build is already 162ms before Phase 1; Task 16 judges buildMs as the median of 3 runs and accepts ≤150ms OR ≤ the map's legacy baseline +15% where the baseline already exceeds 150ms — the pre-existing legacy cost is not Phase 1's regression — cost if wrong: a slight hitch crossing into Route 119.
Task 2: complete (commits b648087..8e25225, review clean)
Task 2: minor (deferred): regress buildMs/PNG noise (littleroot 42→103ms, slateport water not byte-stable) — perf checks need medians
- Ruling: Task 5 additionally commits tests/legacyClaims.test.ts exercising emitLegacy's claim guards (SURFACE skips floors, OBJECT skips tree/block runs, TOP skips overhang cards) — Task 2's 11 guarded branches are otherwise untested until visual tasks 6–13 — cost if wrong: one small extra test file.
- Ruling: Task 3 review Important "progress log not updated" conflicts with the controller's dispatch instruction (implementers add learnings only; the controller ticks tasks and keeps the log current) — the controller adds the quality note and tick in its bookkeeping commit; no fix round — cost if wrong: none (log is current after bookkeeping).
Task 3: complete (commits 88027e4..0699494, review clean after ruling)
Task 3: minor (deferred): gridKey doubles as rebuild flag → style toggle runs onMapChanged (plan-mandated)
Task 3: minor (deferred): NO_EVENTS shared mutable singleton (plan-mandated)
Task 3: minor (deferred): liveEvents/readEvents may throw RomError inside per-frame sync (ROM hacks only)
Task 3: minor (deferred): kitEvents lacks kind-4/kind-8 boundary + uses literal 7 not MAP_OFFSET (plan-mandated)
Task 3: minor (deferred): unexplained 404 in regress output (likely favicon; also in before run)
- Ruling: Task 4 Important (plan-mandated) "wind meshes receive shadows at rest pose" — fix now: worldPosition/vKitWorld from the swayed position — Task 11 grass bending builds on it — cost if wrong: ~5 lines of shader.
- Ruling: Task 4 Important (plan-mandated) "hook materials can share a wrong compiled program" — fix now: program cache key includes a hash of the hook strings (hookKey becomes optional); also create the depth twin when vertTransform is set (minor #4, same lines) — Tasks 6/7 are the first hook users — cost if wrong: none.
Task 4: fix round 1/5 (3 addressed, 0 open — rest-pose shadows; hook cache key; depth twin for vertTransform; commits 047a211..7ff3cb8)
Task 4: complete (commits 3183c16..7ff3cb8, review clean)
Task 4: minor (deferred): depth twin compiles vertTransform into MeshDepthMaterial — vertTransform must only use transformed/position/normal/uv + prelude uniforms
Task 4: minor (deferred): no unit test asserting the worldpos_vertex patch text
Task 4: minor (deferred): no vertHead option — vertTransform can't declare custom uniforms
Task 4: minor (deferred): wind applied in model space; non-instanced meshes sway in lockstep from object origin (fine for instanced trees/grass)
Task 4: minor (deferred): RGBADepthPacking leftover; MeshBuilder.add ignores negative-determinant winding; countPixels allocs per pixel; palette tests miss 'rock' class + weak soften assertion; no customDistanceMaterial; BatchedMesh unsupported
- Ruling: Task 5 Important (plan-mandated) InstancedMesh not disposed by disposeKit → fix now (Tasks 9/11 build instanced meshes over shared geometries) — cost if wrong: none.
- Ruling: `haiku` alias also unavailable (HTTP 404) — all subagent roles use opus — cost if wrong: spend only.
Task 5: fix round 1/5 (1 addressed, 0 open — InstancedMesh disposal; commits f5c05a3..5f57106)
Task 5: complete (commits a0dc0ee..5f57106, review clean)
Task 5: minor (deferred): build-failure rollback can clear CLAIM bits a surviving family also set; leaves groundY/groundMt (plan-mandated)
Task 5: minor (deferred): duplicate family names corrupt payload/report bookkeeping — add uniqueness assert
Task 5: minor (deferred): World catch-block disposeKit branch is dead; kit.disposables pushed before a throw drain only on next successful build
Task 5: minor (deferred): no test for indoor/underground gating, whole-kit Retro fallback, kitReport; legacyClaims misses E/W connectors; isConnector keys on tv0===0.8
Task 5: minor (deferred): disposeKit could call o.dispose() generally (BatchedMesh etc.); doc comment stale
- Ruling: Task 6 Important (plan-mandated) S-bank steepness threshold → fix now (one line, raise band above 0.707); also in the same round: hoist per-cell allocations and profile buildMs per stage (median of 3) because route110/sootopolis h21 rose to ~148ms — budget pressure grows with 7 more families — cost if wrong: one extra round.
Task 6: fix round 1/5 (2 addressed, 0 open — S-bank soil; allocation-free build + per-stage timing; commits df5d090..ed5235b)
Task 6: complete (commits 3883cd2..ed5235b, review clean)
Task 6: minor (deferred): cellLook dark-pixel luma cutoff lives in terrain.ts and is absolute (should be relative / in palette.ts)
Task 6: minor (deferred): palette band 0.71 cutoff vs Sootopolis 0.70 has no pinning test
Task 6: minor (deferred): terrain build() texels/dilation not unit-tested (only scratch md5); isStructure should be shared (analyze/semantics)
Task 6: minor (deferred): shadow-acne rings on tall north-higher banks at Close preset (pre-existing in Retro; Task 8 cliffs replace)
Task 6: note: per-stage build medians (analyze 30–43ms, batching 11–25ms, terrain 5–7.6ms) in task-6-report.md — compare stages, not single totals
- Ruling: Task 7 sea-rock boulders stay in the water family (they need the water's foam collar/flags) rather than moving to Task 14 props — cost if wrong: one table lives outside tables/general.ts.
- Ruling: legacy on-water cells (boats, cycling-road edges, Sootopolis corner) showing as opaque squares are accepted per the per-cell fallback for now; owned by Task 16 polish (try alpha-cutout legacy over kit water or kit water under them) — cost if wrong: visible squares remain until then.
- Ruling: water "sun glints" are view-relative sky-tinted highlights (spec says sun glints) — accepted stylisation — cost if wrong: less sparkle.
Task 7: fix round 1/5 (3 addressed, 0 open — partial sea rock; depthWrite; Slateport check; commits 8de03ec..3ed7e2b)
Task 7: complete (commits 6ad6307..3ed7e2b, review clean)
Task 7: minor (deferred): water fragment pays for waterfall/churn/rock texelFetches everywhere — gate behind cheap branches (Task 16)
Task 7: minor (deferred): ROCK_DZ duplicated as GLSL literal; no tests for waterfall G/B channels
Task 7: minor (deferred): rain streaks now visible below the water surface (water no longer writes depth)
Task 7: minor (deferred): route119 build ~163ms (water adds ~10ms); budget ruling applies
- Ruling: insert follow-up "Task 6b" before Task 8 — terrain draws water-coloured floor cells as blue blotches (Mossdeep/Lilycove shallow-water metatile 0x1ae; Slateport row-32 rooftop 0x290–0x293 at h4 which Retro shows green) — visible on every later screenshot — own brief + review — cost if wrong: one small extra task.
Task 6b: fix round 1/5 (3 addressed, 0 open — Dive seabed exempt via opts.underwater; LayerType helpers; wetGround never water; commits 2dae31b..d18ad1d)
Task 6b: complete (commits 1dcfe10..d18ad1d, review clean)
Task 6b: minor (deferred): MIN_GROUND_PX=64 sits exactly on real data (Route 110 0x3aa) with no 63/64 pin test; deck tint has no coverage floor
Task 6b: minor (deferred): puddles/hot springs render as wet ground (future water family); Mossdeep gantry floor patch at h8 over sea (analysis artefact); Lilycove map-edge blue legacy water cell (64,0)
- Ruling: water family must not run on underwater (Dive) maps — Task 7 draws surface-water slabs with foam on the seabed there — carried into Task 8 as a ruled one-line extra (`if (a.opts.underwater) return empty` in waterFamily.extract + test) — cost if wrong: none.
- Ruling: Task 8 fix round 1 includes, besides the Important west-wedge winding defect: moving QuadWriter/noise2 to geom.ts (Tasks 9/11–13 need them), curated rockIds bypass the floor-colour veto (Task 14 depends on it), an explicit underwater guard, the foot-sampling hairline crack, and MeshBuilder.quad's degenerate-edge flip test (same defect class) — cost if wrong: a slightly larger fix diff.
Task 8: fix round 1/5 (5 addressed, 0 open — west-wedge winding; QuadWriter/noise2 to geom; curated rock bypass; underwater guard; foot cracks; commits a87d5a7..c858099)
Task 8: complete (commits 490c489..c858099, review clean)
Task 8: minor (deferred): remaining legacy cliffs — Rustboro coast strips, Sootopolis white crater walls, Mossdeep diagonal ridges, terrace corners, ledge corner tiles (Task 14 rockIds / Task 15 coverage)
Task 8: minor (deferred): "common floor colour is not rock" may drop cliffs on dirt-floor maps (Routes 111/112/114, Mt Chimney) — check in Task 15
Task 8: minor (deferred): ledge earth colour sampled in build() from a.info; cliffs extract is ~210 lines; terrain.ts:80 comment describes the old flip rule; curated rock id in ground colour can't be a mass's top tile (cliffs.ts:255)
Task 8: minor (deferred): rebuild time evidence for cliffs (+12–22ms) not in artifacts — Task 16 must measure per-stage medians
Task 9: complete (commits 8a046cb..240e33e, review clean)
- Ruling: Task 9 Important (Block→tree heuristics can mis-tag; Fortree treehouse corner tiles 233@(10,14), 237@(39,14) currently become round trees) — no code change now; Task 12's dispatch must make the building family claim Fortree treehouse tiles (non-door K.Block structure tiles) before trees run, and Task 15 adds a per-map count of block→tree cells over all outdoor maps (spot-check Fallarbor, Lavaridge, Mt Pyre, Safari Zone, Ever Grande) — cost if wrong: some treehouse/building corners render as trees.
Task 9: minor (deferred → Task 16 list): style.length used to tell styles apart (round/bushy both 5, pine/palm both 4) — use explicit index
Task 9: minor (deferred → Task 16 list): leafy-overhang claim counts both layers + all 8 neighbours; nearest-floor ground override applies to every tree cell (should only replace water ground); canopy darkening misses block-derived tree cells; level steps visible inside Route 113 ash forest
Task 9: minor (deferred): shadow-skip relies on r186 hooks (add REVISION tripwire comment/test); trees.ts 667 lines (consider split); doorStructures imported from cliffs.ts; one variant per style per chunk; Route 113 crowns read olive rather than ash-grey (user eyeball)
Task 9: stats — medium max 64 calls, 401k tris (woods 193k); route119 rebuild 175ms median (within ruling); high quality peaks 112 calls
- Ruling: pre-existing PostFX HiDPI bug (EffectComposer.setSize gets drawing-buffer px and multiplies by pixelRatio again → 4× pixels at DPR 2, tilt-shift resolution mismatched) — fix in Task 16 perf pass — cost if wrong: HiDPI users pay 4× fill until then.
Task 10: complete (commits f87e6d5..cb7ec7e, review clean)
Task 10: minor (deferred → Task 16 list): fade radius fixed at 0.11×h — scale with projected sprite height (zoom-in / battleZoom can hide the head); PostFX.sceneTargetSize() accessor instead of reaching into composer.renderTarget1
Task 10: minor (deferred): playerWorld computed twice per frame + per-frame Vector3 allocations; preview focus ignores terrain height; AO (high) leaves faint edges at the fade hole
Task 10: note: out/littleroot.state is an indoor Mom cutscene — use out/r101.state for live outdoor checks
Task 11: complete (commits d5c22b8..df6fb6f, review clean)
Task 11: minor (deferred → Task 16 list): depth twin inherits KIT_BEND using cameraPosition (light camera in shadow pass) — drop KIT_BEND from depth twin or pass view cam pos; grass overlay hidden unconditionally (short grass shows feet; grass-family failure shows legs over 2D grass) — hide only where claimed/ok; per-frame uActors allocations
Task 11: minor (deferred → Task 15): secondary-tileset flower tiles missed by the blob test stay legacy all Phase 1 (setFlowerIds gated by isGeneralId) — check Ever Grande / Route 117 coverage
Task 11: minor (deferred): GTAO prepass uses un-bent grass (High); bounding spheres ignore shader displacement; trees.ts GRASS set duplicates GRASS_BEHAVIORS; palette.ts imports three for lush; red shoes visible through blade gaps (legs "largely" hidden)
Task 11: stats — medium max 66 calls / 304k tris; high worst 126 calls / 1.02M (woods); grass+flowers ≤2ms each
- Ruling: Task 12 fix round 1 = Important (walkable cells inside the 3D box: claim only enclosed walkable cells; front-step columns kept out of the box/recessed) + Minors 1 (fixture comment bug), 2 (post rule guard block(x,w.y)), 5 (move computeLayout/buildingLayout/Footprint to kit/footprints.ts to decouple trees/cliffs from buildings before Task 13), 6 (one-row footprints must not reach into the row behind), 7 (consistent base clamping) — cost if wrong: slightly bigger fix diff.
Task 12: fix round 1/5 (6 addressed, 0 open — walkable cells out of box/recessed fronts; fixture; post guard; footprints.ts; one-row skip; base clamp; commits 6959546..5e570e7)
Task 12: complete (commits fd24e9a..5e570e7, review clean)
Task 12: minor (deferred): null-dest door merge radius 18 cells too broad; legacy groundAt only treats claimed K.Building as modelled; one-sided steps leave a mid-wall corner post strip + eave overhang past the bay; stray gating untested; Sootopolis carved houses / Verdanturf tent / Lavaridge Mart cliff row / Lilycove 3 windows; Lilycove Dept Store read as water at margin 14
Task 12: carry to Task 13: D/zm now describe the recessed main body (zb..zr); facades/details over step columns belong at zr (front(x)); lone roof-edge cells on row top−1 are claimed CLAIM_OBJECT but the model never reaches them (renders as open ground) — decide; check off-centre gym doors (Rustboro/Petalburg) against the metatiles
Task 13: complete (commits 63803f5..6e32091, review clean)
Task 13: minor (deferred → Task 16 list): facades never glow at night; buildings.ts 562 lines (split details/facade into buildingDetails.ts); SIGN_BACK duplicates SIGN_FRAME literal
Task 13: minor (deferred): Lavaridge gym sign off-centre (steps [2,3] → 4-wide bay); lab test only checks bbox heights; upscale edge clamping untested; headless canvas fallback in text.ts
- Ruling: insert "Task 13b" — model special buildings whose doors are walkable/non-animated warps (Slateport museum + shipyard, Mauville Game Corner, Lilycove museum; Task 12 footprints only start from blocked doors) and fix ground painted onto facade corners (facadePixels copies both layers incl. ground bottom layer → green corners on the Contest Hall/Battle Tent) — named in spec §5.7 as `special` examples — own brief + review — cost if wrong: one more task.
- Ruling: Task 13b Important (player drawn under the walk-in door threshold) → fix now: families can publish a per-cell walkable-surface height override (e.g. Claims.surfaceY, NaN default) that World.heightAt (sprite placement) honours; buildings set it to base on walk-in door/threshold cells; plus Minor 7 (drop dead `steps`) — cost if wrong: small API addition to Claims/World.
Task 13b: fix round 1/5 (2 addressed, 0 open — surfaceY override for walk-in doors; dead steps removed; commits 96a88ec..34f73c6)
Task 13b: complete (commits 45f3b5f..34f73c6, review clean)
Task 13b: minor (deferred → Task 16 list): Stern's Shipyard back pier strip at h4 floats behind the lower roof (analysis heights); bush 2D art painted on recess-1 wall columns (Weather Institute); world.ts cellOf closure retains whole MapAnalysis
Task 13b: minor (deferred): Dept Store still water (analysis blue-block→water cascade, ~29k Dive cells depend on it); Fan Club / cable car / BF gate / Devon Corp / Battle Pyramid/Pike/Palace/Ranking Hall stay legacy; threshold assumes contiguous walk-in columns; walk-in door column not checked against owner; water surface under owned wet cells; clearGround compares map-wide repeated floor tiles; adjacent walk-in buildings reject each other; footprints.ts 430 / buildings.ts 628 lines
- Ruling: Task 14 Important (secret-base entrance holes hidden by new 3D cliffs) → fix now: cells that are secret-base entrances (secret-base bg events and/or secret-base behaviours / curated hole ids) must never be part of a cliff run or claimed by any family; plus Minor 3 (winding test compares each triangle with its stored normal for every prop kind) — gameplay cue — cost if wrong: none.
Task 14: fix round 1/5 (2 addressed, 0 open — secret-base spots never claimed (behaviours 0x90–0x9d) across all families; winding test all kinds; commits ac45206..2d5598f)
Task 14: complete (commits 5b7efec..2d5598f, review clean)
Task 14: minor (deferred → Task 16 list): opened (walkable) secret-base spot can still get CLAIM_TOP from tree crown loop (trees.ts:479/500) and flowers (flowers.ts:198) — add isSecretBaseSpot guards (+ water) ; GENERAL_PINE/setPineIds/'pine' crown now unreachable (drop or keep for secondary conifers)
Task 14: minor (deferred): fence height interpolates only run ends; N-S fence may pick lower-side ground; pine pairing doesn't check halves; quads with repeated corner double tri count for rocks/bushes; levelStep vs step duplicated; fenceLevel computed twice; town-tileset fences/bushes/bollards remain pixel art (per-tileset labelling)
- Ruling: Task 15 fix round 1 = documentation/metric-label fixes only (progress log flower sentence corrected: unmodelled bottom-layer flower tiles render as plain terrain in Modern — art lost; record C2 sea-rock boxes; coverage header notes CLAIM_TOP ignored + by-kind columns include margins; "block->tree" label) — cost if wrong: none.
- Ruling: insert follow-up "Task 15b" (rock & mountains: C1 mountain/dirt maps mostly legacy — Mt Chimney 90%, Route 112 80%, Jagged Pass 81%, Route 111 62%; C5 Sootopolis white crater rock 77.6%; C2 392 sea-rock cells drawn as cliff boxes against the Task 14 table's intent → exclude) and "Task 15c" (flowers: secondary-tileset bottom-layer flower tiles (Route 117 0x208–0x217, Ever Grande 0x290–0x297, incl. K.Stairs cells) currently LOST under terrain → 3D flowers, or terrain must leave unmodelled decoration to legacy; C4 Trainer Hill facade cells still trees) — both visible quality gaps vs spec §5.3/§5.6 and the per-cell fallback rule — cost if wrong: two more tasks before polish.
Task 15: fix round 1/5 (6 addressed, 0 open — docs/metric labels; commits e21072b..4121c49)
Task 15: complete (commits 274054f..4121c49, review clean) — regression avg 9.0% legacy; all outdoor maps 12.7% grid / 16.2% map cells
Task 15: minor (deferred): report body C3/section 3 keep old wording (fix section supersedes); progress log line wrap; Ever Grande 0x298–0x2a7 overstated
- Ruling: Task 15b Important 1 (mountain diagonal ridge fields need a 2D height solve; Mt Chimney 65.9% / Route 112 44.9% in-map legacy) → deferred as a known Phase 1 gap and proposed to the user as a dedicated follow-up ("terrain height solver v2") — it is a new design touching the analysis, not a patch — cost if wrong: mountain maps keep mostly pixel-art rock until then.
- Ruling: Task 15b fix round 1 = Important 2 (restore coastline land cliffs: sea rock serves as the water-level foot instead of a run breaker; sea-rock cells themselves never boxes; Mossdeep/Route 126 after-shots) + Minor 1 (in-map share caps in the smoke test for the improved maps) + Minor 3 (per-cell top look for terrace clusters; brown patches in Sootopolis) + Minor 5 (free-wall slab: drop invisible/coplanar faces) — cost if wrong: one fix round.
- Ruling: Mossdeep/Route 126 'no worse than before' is judged on land cells (sea-rock cells excluded), because the brief requires sea rocks to stay legacy; raw-share caps pin today's value — cost if wrong: none (all land cells restored; Route 126 −2 cells are one-row faces on sea rocks).
Task 15b: fix round 1/5 (4 addressed, 1 open — coastline cliffs restored, caps, per-cell tops, slab faces; NEW N1: shoal rocks boxed again; commits 0f4cf74..1b44943)
Task 15b: fix round 2/5 (2 addressed, 0 open — shoal rocks never boxes (GENERAL_SHOAL_TOPS, sea-cliff-only waterline); progress log; commits 1b44943..cd1f64c)
Task 15b: complete (commits dba1bb3..cd1f64c, review clean) — regression avg 5.2% legacy; all outdoor maps 7.8% grid / 15.6% map cells
Task 15b: minor (deferred): Route 128 lower shoal plateau half 3D (x70–71) half legacy (x72–74); 131 shoal-formation cells 3D in base now legacy by design; flatten fallback paints rock as floor; footless ground not exactly legacy height; coast face/sea-rock card shows a strip of legacy water from high views; cliffs.ts ~707 lines (extract ~410) — split in Task 16
Task 15b: known gap (ruled): mountain diagonal ridge fields (Mt Chimney 65.9%, Route 112 44.9% in-map legacy) need a 2D height solve — propose follow-up to the user
Task 15c: complete (commits 3f4bec2..ad03ead, review clean) — flowers lost 216→0 (all outdoor maps); Dewford fake flowers 95→0; regression avg 5.3%
Task 15c: minor (deferred): terrain imports isPetal from flowers (move to palette); warp-passage loop broader than comment (trees.ts:477); bush threshold literal 128; Ever Grande yellow muddy (mean of shades); test nits
- Ruling: insert "Task 16a — polish backlog" before the plan's Task 16, covering the player-visible deferred items: (1) COVERED top-layer floor art tinted from the bottom layer (Ever Grande brick path ≈75, rock tops ≈157, Fallarbor ≈34, BF West emblem) + BF East emblem painted over (Task 15c Important); (2) legacy on-water opaque squares (boats, cycling-road edges, Sootopolis corner); (3) grass-overlay sprite hidden only where 3D grass is claimed; (4) fade radius scales with projected sprite height; (5) opened secret-base spots never get CLAIM_TOP (trees/flowers/water guards); (6) trees style.length bug; (7) KIT_BEND dropped from depth twin; (8) special facades/ windows glow at night; (9) Ever Grande yellow petals lighter. Then the plan's Task 16 (shadows, tilt-shift, perf incl. PostFX HiDPI fix, Ever Grande 148–157ms, water fragment gating). — cost if wrong: one more task.
Task 16a: complete (commits ec90192..ba85a82, review clean) — 9/9 polish items; pixel-water squares 10,090→343
Task 16a: carry → Task 16: atlas Dry band +25% fill re-rendered every frame (skip Dry unless CLAIM_WATER_UNDER cells exist / always in Retro; re-render only when VRAM/palette dirty); cliffs.ts cellLook users (rock-top tile choice, grass lips, ledge tint) affected by item 1 — survey/diff over 68 outdoor maps or give cliffs a bottom-layer look helper; fade head coverage (raise focus point or factor ~0.8); shared warm glow constant (buildings.ts:486 vs materials.ts:234)
Task 16a: minor (deferred): Dry cut follows live palette effects (fades, drought weather → pixel-water squares return); no connector between kit water at different levels for CLAIM_WATER_UNDER cells; water-under cells lose waterfall flag; props spot guard untested; Task 17 live check must include item 3 (grass overlay)
- Ruling: the spec's rebuild budget ('≤150 ms, no hitch when crossing map connections') is judged on the warm rebuild (the live-play case: JS already JIT-warm) — Task 16 measures ≤83 ms warm on every regression map + Ever Grande; cold buildMs in a freshly loaded preview (JIT/first-use, machine-load dependent: 41–245 ms) is informational — cost if wrong: first map of a session may take longer to build (one-time).
Task 16: complete (commits 096af9d..391db6a, review clean)
- Ruling: Task 16 Important 1 — the first 1–2 rebuilds after boot are 98–193 ms (JIT warm-up; Route 119 193, Littleroot 161), steady-state warm rebuilds ≤ 83 ms; accepted (a possible slight hitch on the first map crossings of a session), and the progress log is corrected to state it — cost if wrong: brief hitch on the first crossings; a boot-time warm-up build could remove it later.
- Ruling: Task 16 Important 2 (plan-mandated conflict Step 2 vs Step 4) — in Modern style the gentler tilt-shift and soft-shadow radius also apply to interiors, caves and battles (legacy geometry unchanged); accepted as consistent with the Modern art direction; Retro keeps the original values — cost if wrong: interiors look marginally sharper/softer-shadowed in Modern.
Task 16: minor (deferred → final review triage): High shadow radius 5.12 texels with 5 taps is grainy (cap ~2–2.5); terrain look() cache keyed by metatile only (mode footgun); per-frame Uint32Array view in atlas; tilt-shift strength in drawing-buffer px (≈off at DPR 2); post.ts imports WorldStyle (layering)
- Ruling: insert "Task 17b" — live-play connected-map events (neighbour-strip buildings built without the neighbour's warps → Oldale PC renders as a plain house from Route 101 and pops on crossing; plan Review Focus #1) + Retro shadow radius only in Modern (Retro must keep today's look, spec §1/§5.1) — then Task 17 doc fix round (Ever Grande 53.3% + Sootopolis/Lavaridge legacy buildings in known gaps; update connected-map gap after 17b; other doc minors) — cost if wrong: one more task.
Task 17b: complete (commits 42abcd1..5cbbc7a, review clean) — connected-map strip events (fieldmap.c offsets verified, all 4 directions); Retro shadows back to pre-Phase-1 (2048, radius 1)
Task 17b: minor (deferred): strip-cut building extents differ from own-map version (12/39; Battle Frontier West special changes size on crossing) — footprints follow-up; no ROM-driven E/W strip check; mapHeaderAddr no num bound; duplicate quality/shadowQuality state; overlap test clarity; Retro vs before residual 0.59% from 16a's 5-variant atlas (mip/filter)
Task 17: fix round 1/5 (9 addressed, 0 open — known gaps incl. Ever Grande 53.3%, Sootopolis/Lavaridge; 17b reconciliation; README/CLAUDE.md; commits 5cbbc7a..83108ba)
Task 17: complete (commits d774e9c..83108ba incl. 17b, review clean)
Task 17: minor (deferred): Sootopolis 715 legacy cells — why cliffs don't take them not diagnosed; Ever Grande cause "likely" (from histogram); README special-building list incomplete ("e.g."); Chrome/Edge only at default Windows paths; unexplained legacy "building" cells BF East 224 / BF West 186 / Mossdeep 144 / Fallarbor 61
Final review: With fixes — I1 (Important) every Modern rebuild disposes kit materials → three.js destroys + recompiles all kit programs on the first frame (+80–100 ms per crossing vs Retro); M1 Dive-map banks double-drawn (terrain + legacy, 1,037 edges); M2 liveGridEvents can throw RomError inside sync(); M3 exception-path ledge lips/flower beds lost; M4 no test for program lifetime / indoor-cave skip; M5 warn every rebuild not once per map; M6 style switch with panel open half-applies; M7 worldStyle from localStorage unvalidated; P2 Fortree deck-height smoke check missing.
- Ruling: final fix wave = I1 + M1 + M2 + M4 + M5 + M6 + M7 + P2 smoke check; M3 (exception path only) deferred — cost if wrong: on a family build failure, ledge lips may vanish for that map.
Final review: fix wave verified (commits 83108ba..0827593) — all in-scope findings addressed; M3 deferred by ruling. Phase 1 complete.
