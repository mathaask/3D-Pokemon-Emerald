// The world's program catalogue against what the world really draws (needs the ROM): every map built as World.build
// builds it (both styles, every quality), every mesh's program signature (kit/catalogue.ts programSignature: material
// program kind, mesh type, per-instance colours, shadow casting and its depth material, geometry attributes) must be
// one the catalogue precompiles at boot, and every catalogue entry must be one some map uses. A family that adds a
// material kind, a side, a map, an attribute or an instanced variant fails here until the catalogue has it.
//   npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/catalogue.test.ts

import { describe, it, expect, vi } from 'vitest';
import { loadRom, loadStaticMap } from './helpers/staticMap';
import { RomReader } from '../../src/game/rom/reader';
import { loadAllMaps } from '../../src/game/rom/maps';
import { MetatileAtlas } from '../../src/render/overworld/metatileAtlas';
import { World, type WorldStyle } from '../../src/render/overworld/world';
import { createHdWorldMaterials, createWorldMaterials } from '../../src/render/overworld/materials';
import { createKitUniforms } from '../../src/render/kit/materials';
import { gridEvents } from '../../src/render/kit/events';
import { meshesOf, programSignature, worldCatalogue } from '../../src/render/kit/catalogue';
import type { Quality } from '../../src/render/post';

describe('world program catalogue (drift guard)', () => {
  it('holds exactly the program variants the world draws on every map, in both styles, at every quality', () => {
    const atlas = new MetatileAtlas({ vram: null, palette: null } as never, 1);
    const u = createKitUniforms();
    // (as OverworldView: the legacy materials with their HD twins, which World draws where the interior kit ran)
    const legacy = createWorldMaterials(atlas.target.texture, u);
    const legacyHd = createHdWorldMaterials(atlas.target.texture, u);
    const world = new World(atlas, { ...legacy, hd: legacyHd }, u);
    // (a family failing on some map is the semantics test's business: quiet here)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const used = new Map<string, string>();
    const builds: [WorldStyle, Quality][] = [['modern', 'low'], ['modern', 'medium'], ['modern', 'high'], ['retro', 'medium']];
    const maps = loadAllMaps(new RomReader(loadRom()));
    for (const m of maps) {
      const s = loadStaticMap(m.group, m.num);
      for (const [style, quality] of builds) {
        world.build(s.grid, s.opts, { style, events: gridEvents(s.map.events, 0), quality, mapKey: `${m.group}.${m.num}` });
        for (const mesh of meshesOf(world.group)) {
          const sig = programSignature(mesh);
          if (!used.has(sig)) used.set(sig, `${m.group}.${m.num} ${m.name} (${style}, ${quality}): ${mesh.name || mesh.parent?.name || '-'}`);
        }
      }
    }
    world.dispose();
    warn.mockRestore();
    expect(maps.length).toBeGreaterThan(500);

    const catalogue = worldCatalogue({ uniforms: createKitUniforms(), legacy, legacyHd, atlas: atlas.target.texture });
    const meshes = meshesOf(catalogue.root);
    const have = new Set(meshes.map(programSignature));
    catalogue.dispose();
    const missing = [...used].filter(([sig]) => !have.has(sig)).map(([sig, at]) => `${sig}  (first on ${at})`);
    const unused = [...have].filter((sig) => !used.has(sig));
    expect(missing, 'drawn by the world, missing from the catalogue').toEqual([]);
    expect(unused, 'in the catalogue, drawn on no map').toEqual([]);
    // (one mesh per variant, every one frustum-culled off: the precompile frame draws it wherever the camera looks)
    expect(meshes).toHaveLength(have.size);
    expect(meshes.every((m) => !m.frustumCulled)).toBe(true);
    expect(catalogue.root.children).toHaveLength(0);
  });
});
