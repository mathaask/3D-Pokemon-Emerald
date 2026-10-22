# Phase 2 — final whole-branch review (summary)

Branch `phase2-characters`, range 75385f0..655bcf4 (12 tasks), reviewed 2026-10-22 in seven passes (game state +
subsprites; actors; kit; renderer/views/preview/atlas/settings; harness; tests; docs). tsc clean, `npm test` 611,
smoke objectGraphics + golden + semantics 26 — all re-run by the reviewer.

## Verdict
**Ready to merge with fixes** — 0 critical, 1 important (bookkeeping), 5 minor + 1 recommendation. No correctness
defects across task boundaries.

## Verified across tasks
- Contracts: `SpriteSnap` fields (offsets 0x2A/0x0C/0x18/0x42), the truck foot with and without composition,
  `aSlotSize` = `slotRects` (field covers the composed 48×48 slot), colour-cache key independent of decode size.
- Lifecycle: per-frame lists rebuilt; Retro hides/empties inflated mesh, contact shadows, models and clears `seen`;
  Retro→Modern resyncs the field; HD↔Pixel is one shared uniform (no recompile).
- Long sessions: every cache bounded (LRU 256, `seen` ≤ 16, ROM-only subsprite cache, WeakMaps, fixed pools); no
  per-frame GPU targets.
- Precompile covers every Phase 2 program (field passes, inflated main + depth for the variant in use, models incl.
  the berry instance-colour variant, model depth materials, Cut-tree depth twin) through a real PostFX frame.

## Findings and what happened to them
| # | Finding | Outcome |
|---|---|---|
| I1 | Progress log stale for merge; Phase 2 known gaps only in a gitignored report; CLAUDE.md "Active work"; README limitation | Fixed by the controller before merge (progress log "Phase 2 result", CLAUDE.md, README, this file, `phase2-sdd-ledger.md`) |
| M2 | `seen` survives periods without overworld updates | Fixed (cleared on a frame gap) |
| M3 | Model materials' extra shader patches not in their program key | Fixed (`:model` suffix) |
| M4 | Duplicated light-floor GLSL, patch helpers, GFX ids | Fixed (one shared block/helper each) |
| M5 | No runtime fallback if the uniform-array program fails to link | Fixed (post-precompile check → attribute path) |
| M6 | No live entry switching style with models in view | Fixed (`lr_truck_switch`) |
| Rec | Render loop dies on any per-frame exception | Fixed (frame guard; renderer resets target/autoClear each frame so V works) |

The fix wave (62b5c48..8827c91) also cleared the per-task deferred minors (xBR per-line blend widths, NPC fade core,
berry soil without its own program, model/subsprite/colour/harness minors). Its scoped re-review: all items
addressed; one residual (frozen frame on V after a PostFX throw) fixed by the controller; the remaining residuals are
listed as known gaps in `modern-3d.md` and the ledger.
