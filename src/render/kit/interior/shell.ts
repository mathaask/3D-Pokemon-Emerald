// The room shell (Phase 4, D4/D5): walls, windows, clocks, decals, doorways. The family claims the back wall's band (and
// the partitions in it), so no legacy face stands in front of the wall; it builds geom/shellParts.ts' geometry into
// meshes:
// - `walls<Dir>` (BUILDING_BODY): the wall profile, one mesh per direction.
// - `walls<Dir>Pocket<P>` (BUILDING_BODY): the pocket sides (the stairs alcove's side walls, back-wall steps;
//   cutaway.ts pocketDir), also tagged `userData.pocketDir`: the cutaway hides them with `P`'s walls too.
// - `fixtures<Dir>` (BUILDING_BODY): window casings and sills, clocks, door frames and slabs.
// - `roomWindows` (ROOM_GLASS): the glass ('N').
// - `wallDecals` (facadeMaterial): the wall art's Scale4x pixels ('N').
// - `partitions` (BUILDING_BODY): the half-height partitions. These are solid, so they carry no wallDir and the
//   cutaway never hides them.
// Every other mesh carries `userData.wallDir`: the cutaway hides it together with its wall.

import * as THREE from 'three';
import { CLAIM_OBJECT, CLAIM_TOP, type Claims } from '../../overworld/claims';
import type { MapAnalysis } from '../../overworld/analyze';
import type { Family, KitContext, SemanticContext } from '../semantics';
import { applyKitMaterial, kitMaterial, type KitMaterialOptions } from '../materials';
import { BUILDING_BODY, facadeMaterial } from '../buildings';
import { luma, saturation, scale, type RGB } from '../palette';
import { interiorIds } from '../tables/building';
import { roomLayout, type RoomLayout, type WallDir, type WallFeature } from './room';
import { colorInfo, partColors, wallColors } from './colors';
import type { ShellColors } from './wallParts';
import type { InteriorCatalogueEntry } from './index';
import {
  ROOM_GLASS as GLASS, SHELL_DIRS, buildShellSoups, clockGeometry as clock, decalGeometry, packDecals, shellDecals,
} from './geom/shellParts';

/** Window glass seen from inside: its vertex colours (a sky gradient) turned towards night blue by uOutdoorNight (D8). */
export const ROOM_GLASS: KitMaterialOptions = GLASS;

/** A round wall clock (PNC), its back on z = 0 facing +z. */
export function clockGeometry(radius: number, face: RGB, rim: RGB): THREE.BufferGeometry {
  return clock(radius, face, rim);
}

/** What the shell builds: the layout, the back wall's colours, the features drawn as decals. */
export interface ShellPlacement { layout: RoomLayout; colors: ShellColors; decals: WallFeature[] }

/** A clock's colours from its cells' pixels: a light face (its main or second colour, else off-white) in a rim of its
 *  accent (a saturated frame), else its dark. */
function clockColors(a: MapAnalysis, f: WallFeature): { face: RGB; rim: RGB } {
  const c = partColors(colorInfo(a), f.cells.map((i) => a.mt[i]));
  const face = luma(c.main) >= 0.55 ? c.main : luma(c.second) >= 0.55 ? c.second : [0.96, 0.95, 0.9] as RGB;
  const rim = saturation(c.accent) >= 0.3 ? c.accent : luma(c.dark) < 0.35 ? c.dark : scale(c.main, 0.45);
  return { face, rim };
}

export const shellFamily: Family<ShellPlacement | null> = {
  name: 'shell',
  /** Claims every back-wall band cell (partitions included) the furniture has not: CLAIM_OBJECT | CLAIM_TOP, ground
   *  = the room's floor tile. */
  extract(ctx: SemanticContext, claims: Claims): ShellPlacement | null {
    const { a } = ctx;
    const ids = interiorIds(a);
    const L = roomLayout(a, ids, ctx.events.warps);
    if (!L.runs.length) return null;
    for (let i = 0; i < a.N; i++) {
      if (!L.band[i] || claims.has(i, CLAIM_OBJECT)) continue;
      claims.claim(i, CLAIM_OBJECT);
      claims.claim(i, CLAIM_TOP);
      if (L.floorTile >= 0) claims.groundMt[i] = L.floorTile;
    }
    return { layout: L, colors: wallColors(a, L, ids), decals: shellDecals(a, L) };
  },
  build(p: ShellPlacement | null, ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!p) return null;
    const { a } = ctx;
    const S = buildShellSoups({ a, L: p.layout, colors: p.colors, clockColors: (f) => clockColors(a, f) });
    const g = new THREE.Group();
    g.name = 'shell';
    const add = (geo: THREE.BufferGeometry, o: KitMaterialOptions, name: string, dir: WallDir | null, cast: boolean,
      pocket: WallDir | null = null) => {
      const km = kitMaterial(kit.uniforms, o);
      const mesh = new THREE.Mesh(geo, km.material);
      applyKitMaterial(mesh, km);
      mesh.name = name;
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      if (dir) mesh.userData.wallDir = dir;
      if (pocket) mesh.userData.pocketDir = pocket;
      g.add(mesh);
    };
    for (const d of SHELL_DIRS) {
      if (!S.walls[d].empty) add(S.walls[d].geometry(), BUILDING_BODY, `walls${d}`, d, true);
      if (!S.fixtures[d].empty) add(S.fixtures[d].geometry(), BUILDING_BODY, `fixtures${d}`, d, true);
    }
    for (const q of S.pockets) if (!q.walls.empty) add(q.walls.geometry(), BUILDING_BODY, `walls${q.dir}Pocket${q.pocket}`, q.dir, true, q.pocket);
    if (!S.glass.empty) add(S.glass.geometry(), ROOM_GLASS, 'roomWindows', 'N', true);
    if (!S.partitions.empty) add(S.partitions.geometry(), BUILDING_BODY, 'partitions', null, true);
    if (S.decals.length) {
      const P = packDecals(colorInfo(a).both, a.mt, S.decals, p.colors.wall);
      const tex = new THREE.DataTexture(P.data, P.width, P.height, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      kit.disposables.push(tex);
      add(decalGeometry(S.decalRects.map((r, k) => ({ ...r, uv: P.uv[k] }))), facadeMaterial(tex, null), 'wallDecals', 'N', false);
    }
    return g.children.length ? g : null;
  },
};

const PNC = { position: 3, normal: 3, color: 3 };
/** The shell's material kinds: BUILDING_BODY PNC cast, ROOM_GLASS PNC cast (the decals' facadeMaterial without glass on
 *  PNU is the buildings' own entry). */
export const SHELL_CATALOGUE: readonly InteriorCatalogueEntry[] = [
  { material: BUILDING_BODY, attrs: PNC, castShadow: true },
  { material: ROOM_GLASS, attrs: PNC, castShadow: true },
];
