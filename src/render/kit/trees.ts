// Trees: instanced stylised trees where the analysis found tree runs, plus the tree masses it left
// as blocks (a forest drawn in the map's border tiles, like Route 113's ash trees, and the trunk
// rows of secondary-tileset 2x2 trees). Crowns are clusters of noise-displaced blobs with soft,
// mostly radial normals and a light-top / dark-under gradient (vertex colours × the ROM leaf
// colour per instance); trunks are tapered with a root flare.
//
// Crown and trunk share one geometry: trunk vertices are flagged in the vertex alpha and take the
// material's trunk colour. Instances are bucketed into map chunks so the camera and the shadow
// camera cull them (and chunks whose shadows fall outside the view skip the shadow pass): one
// draw per style and chunk in view.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MB } from '../../game/behaviors';
import { attrBehavior } from '../../game/rom/tileset';
import { K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_TOP, type Claims } from '../overworld/claims';
import { buildingLayout } from './footprints';
import { doorStructures } from './cliffs';
import { luma, lush, mix, soften, toLinear, type RGB } from './palette';
import { hashCell, noise3, rng } from './geom';
import { applyKitMaterial, kitMaterial, type KitMaterial } from './materials';
import type { Family, KitContext, SemanticContext } from './semantics';

export type TreeStyle = 'round' | 'bushy' | 'pine' | 'palm';
export interface TreePlacement {
  x: number; y: number; z: number; style: TreeStyle; leaf: RGB; trunk: RGB; seed: number;
  /** Size factor (default 1): the kept trees of a thinned forest interior are larger. */
  scale?: number;
}

let pineIds: (m: number) => boolean = () => false;
export function setPineIds(f: (m: number) => boolean): void { pineIds = f; }

/** Joins neighbouring round-tree trunk columns (same trunk row) into 2-wide trees. */
export function pairRoundTrees(cands: { x: number; k: number; base: number }[]) {
  const key = (x: number, k: number) => (k + 4096) * 8192 + (x + 4096);
  const byKey = new Map(cands.map((c) => [key(c.x, c.k), c]));
  const used = new Set<number>();
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

// ---------------------------------------------------------------- tile colours

/** Foliage greens, dark shades included (their share deepens a jungle tile's colour); not the
 *  bluish mint of the grass around the trees, nor ash or sand. sRGB components. */
const isLeaf = (r: number, g: number, b: number) => g > r + 0.02 && b <= r + 0.05 && g > 0.25;
/** Bark: muted reddish browns and greys. */
const isBark = (r: number, g: number, b: number) => {
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  return r > g + 0.02 && r > b + 0.06 && l > 0.1 && l < 0.55;
};

/** Per-metatile pixel sums: leaf r,g,b,n, leaf centroid x sum, bark r,g,b,n. */
type TileStats = Float64Array;
const LEAF_N = 3, LEAF_CX = 4, BARK = 5, BARK_N = 8;
/** A tile with this many leaf pixels shows a crown. */
const MIN_LEAF = 40;

function tileStats(px: Uint16Array, m: number): TileStats {
  const s = new Float64Array(9);
  for (let p = 0; p < 256; p++) {
    const v = px[m * 256 + p];
    if (v & 0x8000) continue;
    const r = (v & 31) / 31, g = ((v >> 5) & 31) / 31, b = ((v >> 10) & 31) / 31;
    if (isLeaf(r, g, b)) { s[0] += r; s[1] += g; s[2] += b; s[LEAF_N]++; s[LEAF_CX] += p & 15; }
    else if (isBark(r, g, b)) { s[BARK] += r; s[BARK + 1] += g; s[BARK + 2] += b; s[BARK_N]++; }
  }
  return s;
}

/** Horizontal centre of a tile's leaf pixels (0..15; 7.5 = centred). */
const leafCx = (s: TileStats) => (s[LEAF_N] ? s[LEAF_CX] / s[LEAF_N] : 7.5);

const LEAF_FALLBACK: RGB = [0.36, 0.62, 0.3];
const BARK_FALLBACK: RGB = [0.45, 0.31, 0.22];
const WARM_BARK: RGB = [0.48, 0.32, 0.2];

/** Grounds on which a tree is a palm: beach sand, by behaviour (sand-coloured paths are not beaches). */
const BEACH = new Set<number>([MB.SAND, MB.DEEP_SAND, MB.FOOTPRINTS]);
/** Grass behaviours: their top-layer tufts are grass, not crowns. */
const GRASS = new Set<number>([MB.TALL_GRASS, MB.LONG_GRASS, MB.LONG_GRASS_SOUTH_EDGE, MB.SHORT_GRASS, MB.ASHGRASS]);

/**
 * BGR555 leaf colours of the map's border when the border is a forest the analysis left as blocks
 * (secondary-tileset trees not green enough for its tree test: Route 113's ash trees). Null when
 * the border is anything else.
 */
function borderForest(a: MapAnalysis, stray: Uint8Array): Set<number> | null {
  if (a.opts.margin < 2) return null;
  const cells = [a.idx(a.minX, a.minY), a.idx(a.minX + 1, a.minY), a.idx(a.minX, a.minY + 1), a.idx(a.minX + 1, a.minY + 1)];
  if (cells.some((i) => (a.kind[i] !== K.Block && !stray[i]) || a.isGeneralId(a.mt[i]))) return null;
  if (!cells.some((i) => a.info.green[a.mt[i]] >= 0.2)) return null;
  const pal = new Set<number>();
  for (const i of cells) {
    for (let p = 0; p < 256; p++) {
      const v = a.info.both[a.mt[i] * 256 + p];
      if (v & 0x8000) continue;
      const r = (v & 31) / 31, g = ((v >> 5) & 31) / 31, b = ((v >> 10) & 31) / 31;
      if (isLeaf(r, g, b) && luma([r, g, b]) > 0.3) pal.add(v);
    }
  }
  return pal.size ? pal : null;
}

const isTreeAt = (tree: Uint8Array, a: MapAnalysis, x: number, y: number) => a.inside(x, y) && tree[a.idx(x, y)] === 1;

/** A blocked cell the analysis made a step between two levels: walkable ground north and south of
 *  it at different heights (it reads any short blocked run between two walkable areas as a terrace
 *  face). The legacy art keeps such a face. */
function levelStep(a: MapAnalysis, i: number): boolean {
  const walk = (j: number) => j >= 0 && j < a.N && (a.kind[j] === K.Floor || a.kind[j] === K.Stairs) && !Number.isNaN(a.height[j]);
  const n = i - a.GW, s = i + a.GW;
  return walk(n) && walk(s) && Math.abs(Math.max(0, a.height[n]) - Math.max(0, a.height[s])) > 0.5;
}

/**
 * Ground under each tree cell: the metatile of the nearest plain walkable floor (breadth-first
 * through the tree cells; -1 where none is reachable). The analysis' ground reference may be the
 * water beside a riverbank forest, and the ground now shows between the trunks.
 */
function forestFloor(a: MapAnalysis, tree: Uint8Array): Int16Array {
  const W = a.GW;
  const out = new Int16Array(a.N).fill(-1);
  const queue = new Int32Array(a.N);
  let head = 0, tail = 0;
  for (let i = 0; i < a.N; i++) {
    if (a.kind[i] !== K.Floor || (a.layer[i] === 0 && a.info.topCover[a.mt[i]] > 0)) continue;
    out[i] = a.mt[i];
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    const col = i % W;
    for (let k = 0; k < 4; k++) {
      const j = k === 0 ? i - W : k === 1 ? (col > 0 ? i - 1 : -1) : k === 2 ? (col + 1 < W ? i + 1 : -1) : i + W;
      if (j < 0 || j >= a.N || out[j] >= 0 || !tree[j]) continue;
      out[j] = out[i];
      queue[tail++] = j;
    }
  }
  return out;
}

/** Rows of a long tree run (a forest between two levels) that stand on the higher ground behind it. */
const LEVEL_REACH = 2;

// ---------------------------------------------------------------- geometry

const VARIANTS = 3;
/** Map chunk (cells) per instanced mesh: the unit of view and shadow culling. */
const CHUNK = 8;
/** Size of a 1-wide tree drawn with the round tree's geometry. */
const SMALL_ROUND = 0.6;
/** Size of the trees kept in a thinned forest interior (every other one, so the canopy closes). */
const INTERIOR = 1.45;
/** Size of a 2-wide conifer drawn by the General table's tiles (the secret-base tree). */
const PINE_PAIR = 1.3;

const geoCache = new Map<string, THREE.BufferGeometry>();

/** Indexed unit icospheres by detail (built once; crowns copy them). */
const unitIco = new Map<number, { pos: ArrayLike<number>; index: ArrayLike<number> }>();
function icosphere(detail: number) {
  let u = unitIco.get(detail);
  if (!u) {
    const g = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute('normal').deleteAttribute('uv'));
    u = { pos: g.getAttribute('position').array, index: g.index!.array };
    unitIco.set(detail, u);
    g.dispose();
  }
  return u;
}

/**
 * A crown of `count` noise-displaced icosphere blobs: a core of radius `rMax`, the rest around it
 * at about `spread`, radii rMin..rMax, heights y..y + yJit. Normals lean towards the crown's
 * centre-out direction (soft, one-volume shading; the lobes still show in the silhouette); RGBA
 * vertex colours run from a cool, dark, occluded underside to a warm, light top (alpha 1). A new
 * geometry on every call (the tree styles cache theirs).
 */
export function blobCrown(seed: number, count: number, spread: number, rMin: number, rMax: number, y: number, yJit: number, detail: number): THREE.BufferGeometry {
  const r = rng(seed);
  const ico = icosphere(detail);
  const nv = ico.pos.length / 3, ni = ico.index.length;
  const pos = new Float32Array(count * nv * 3);
  const index = new Uint16Array(count * ni);
  for (let b = 0; b < count; b++) {
    const a = (b / count) * Math.PI * 2 + r() * 0.6;
    const d = b === 0 ? 0 : spread * (0.6 + r() * 0.4);
    const s = b === 0 ? rMax : rMin + r() * (rMax - rMin);
    const cx = Math.cos(a) * d, cy = y + (b === 0 ? yJit * 0.6 : r() * yJit), cz = Math.sin(a) * d;
    for (let k = 0; k < nv; k++) {
      const o = (b * nv + k) * 3;
      pos[o] = cx + ico.pos[k * 3] * s; pos[o + 1] = cy + ico.pos[k * 3 + 1] * s; pos[o + 2] = cz + ico.pos[k * 3 + 2] * s;
    }
    for (let k = 0; k < ni; k++) index[b * ni + k] = b * nv + ico.index[k];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  const c = bb.getCenter(new THREE.Vector3());
  const half = bb.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  const attr = g.getAttribute('position') as THREE.BufferAttribute;
  const v = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i < attr.count; i++) {
    v.fromBufferAttribute(attr, i);
    d.subVectors(v, c).normalize();
    v.addScaledVector(d, noise3(v.x * 2.2 + (seed % 97), v.y * 2.2, v.z * 2.2) * 0.2 * rMax);
    attr.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  const nor = g.getAttribute('normal');
  const col = new Float32Array(attr.count * 4);
  const n = new THREE.Vector3();
  for (let i = 0; i < attr.count; i++) {
    v.fromBufferAttribute(attr, i);
    // ellipsoidal centre-out direction
    d.set((v.x - c.x) / half.x, (v.y - c.y) / half.y, (v.z - c.z) / half.z);
    const rel = Math.min(1, d.length());
    d.normalize();
    n.fromBufferAttribute(nor, i).multiplyScalar(0.3).addScaledVector(d, 0.7).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
    const t = THREE.MathUtils.smoothstep(v.y, bb.min.y, bb.max.y);
    const ao = THREE.MathUtils.lerp(0.7, 1, THREE.MathUtils.smoothstep(rel, 0.45, 0.95));
    const k = THREE.MathUtils.lerp(0.58, 1.1, t) * ao * (0.9 + 0.1 * n.y);
    col[i * 4] = k * THREE.MathUtils.lerp(0.88, 1.02, t);
    col[i * 4 + 1] = k * THREE.MathUtils.lerp(0.97, 1.02, t);
    col[i * 4 + 2] = k * THREE.MathUtils.lerp(1.12, 0.97, t);
    col[i * 4 + 3] = 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
}

/** Trunk vertices: alpha 0.1..0.4 = bark shade (dark root to light top), read by TRUNK_FRAG. */
function barkColors(g: THREE.BufferGeometry, y0: number, y1: number): void {
  const p = g.getAttribute('position');
  const col = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    col.set([1, 1, 1, 0.1 + 0.3 * THREE.MathUtils.smoothstep(p.getY(i), y0, y1)], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
}

function trunkGeo(rTop: number, rBot: number, h: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 7, 2, true);
  g.translate(0, h / 2, 0);
  g.deleteAttribute('uv');
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) if (p.getY(i) < 0.01) { p.setX(i, p.getX(i) * 1.4); p.setZ(i, p.getZ(i) * 1.4); }
  g.computeVertexNormals();
  barkColors(g, 0, h);
  return g;
}

/** Leaf gradient for crowns without blobs (cones, fronds): RGBA, alpha 1. */
function leafGradient(g: THREE.BufferGeometry, y0: number, y1: number): void {
  const p = g.getAttribute('position');
  const n = g.getAttribute('normal');
  const col = new Float32Array(p.count * 4);
  for (let i = 0; i < p.count; i++) {
    const t = THREE.MathUtils.smoothstep(p.getY(i), y0, y1);
    const k = THREE.MathUtils.lerp(0.55, 1.1, t) * (0.85 + 0.15 * Math.max(0, n.getY(i)));
    col.set([k * THREE.MathUtils.lerp(0.88, 1.06, t), k, k * THREE.MathUtils.lerp(1.08, 0.86, t), 1], i * 4);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
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
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  leafGradient(g, 0.4, 2.3);
  return g;
}

function palmGeo(seed: number): THREE.BufferGeometry {
  const r = rng(seed);
  const lean = 0.25 + r() * 0.2;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(lean * 0.4, 1.0, 0), new THREE.Vector3(lean, 2.0, 0),
  ]);
  const trunk = new THREE.TubeGeometry(curve, 8, 0.07, 6, false);
  trunk.deleteAttribute('uv');
  barkColors(trunk, 0, 2);
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
    f.deleteAttribute('uv');
    fronds.push(f);
  }
  const crown = mergeGeometries(fronds)!;
  fronds.forEach((q) => q.dispose());
  crown.computeVertexNormals();
  leafGradient(crown, 1.4, 2.1);
  const g = mergeGeometries([crown.toNonIndexed(), trunk.toNonIndexed()])!;
  crown.dispose();
  trunk.dispose();
  return g;
}

/** Merged crown + trunk of a style variant (cached for the session, never disposed). */
function treeGeo(style: TreeStyle, variant: number, detail: number): THREE.BufferGeometry {
  const id = `${style}:${variant}:${detail}`;
  let g = geoCache.get(id);
  if (!g) {
    const seed = 1000 + variant * 77 + style.length * 7919;
    let crown: THREE.BufferGeometry, trunk: THREE.BufferGeometry | null;
    if (style === 'round') {
      crown = blobCrown(seed, 6, 0.64, 0.46, 0.76, 1.0, 0.6, detail);
      trunk = trunkGeo(0.12, 0.17, 1.0);
    } else if (style === 'bushy') {
      crown = blobCrown(seed, 5, 0.32, 0.3, 0.46, 0.78, 0.5, detail);
      trunk = trunkGeo(0.07, 0.1, 0.75);
    } else if (style === 'pine') {
      crown = pineCrown(seed);
      trunk = trunkGeo(0.07, 0.1, 0.7);
    } else {
      crown = palmGeo(seed);
      trunk = null;
    }
    g = trunk ? mergeGeometries([crown, trunk])! : crown;
    if (trunk) { crown.dispose(); trunk.dispose(); }
    g.computeBoundingSphere();
    g.userData.shared = true;
    geoCache.set(id, g);
  }
  return g;
}

/** Trunk vertices (alpha < 0.5) take the bark colour; everything is opaque again afterwards. */
const TRUNK_HEAD = /* glsl */ `
uniform vec3 uTrunk;
`;
const TRUNK_FRAG = /* glsl */ `
#ifdef USE_COLOR_ALPHA
if (vColor.a < 0.5) diffuseColor.rgb = uTrunk * mix(0.7, 1.15, (vColor.a - 0.1) / 0.3);
diffuseColor.a = 1.0;
#endif
`;

/** Furthest a tree's shadow falls from its trunk (the tallest crown with a low sun). */
const SHADOW_REACH = 5;
const _frustum = new THREE.Frustum(), _pv = new THREE.Matrix4(), _sphere = new THREE.Sphere(), _dir = new THREE.Vector3();

/**
 * The shadow camera covers far more ground than the view: a chunk casts shadows only when the
 * ground its shadows can reach is in view. The test runs on the main camera before each shadow
 * draw (three skips an instanced draw with count 0: no call, no triangles).
 */
function shadowsNearView(mesh: THREE.InstancedMesh): void {
  let saved = -1;
  mesh.onBeforeShadow = (_r, _s, camera, shadowCamera) => {
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    // the chunk's bounds swept along the shadows' fall (away from the light, horizontally)
    _dir.set(0, 0, -1).transformDirection(shadowCamera.matrixWorld).setY(0);
    if (_dir.lengthSq() > 1e-6) _dir.normalize();
    _sphere.copy(mesh.boundingSphere!).applyMatrix4(mesh.matrixWorld);
    _sphere.center.addScaledVector(_dir, SHADOW_REACH / 2);
    _sphere.radius += SHADOW_REACH / 2;
    if (!_frustum.intersectsSphere(_sphere)) { saved = mesh.count; mesh.count = 0; }
  };
  mesh.onAfterShadow = () => {
    if (saved >= 0) { mesh.count = saved; saved = -1; }
  };
}

const WIND: Record<TreeStyle, [number, number]> = {
  round: [0.05, 2.6], bushy: [0.045, 1.9], pine: [0.04, 2.4], palm: [0.07, 2.4],
};

// ---------------------------------------------------------------- family

export const treeFamily: Family<TreePlacement[]> = {
  name: 'trees',

  extract({ a, events }: SemanticContext, claims: Claims): TreePlacement[] {
    // (a Dive map's seabed has no trees; its kelp is drawn by the legacy art)
    if (a.opts.indoor || a.opts.underground || a.opts.underwater) return [];
    const { idx, kind, height, mt } = a;
    const stats = new Map<number, TileStats>();
    const st = (m: number) => {
      let s = stats.get(m);
      if (!s) { s = tileStats(a.info.both, m); stats.set(m, s); }
      return s;
    };
    const structure = doorStructures(a, events);
    // (a building flood fill's cells outside every building are blocks: Route 113's ash forest)
    const { stray } = buildingLayout(a, events);
    const secondaryBlock = (i: number) => (kind[i] === K.Block || stray[i] === 1) && !a.isGeneralId(mt[i]) && !structure[i] && !claims.has(i, CLAIM_OBJECT);

    // Tree cells: the analysis' trees, a border forest's blocks, and the trunk rows of 2-wide trees.
    const tree = new Uint8Array(a.N);
    const round = new Uint8Array(a.N);
    for (let i = 0; i < a.N; i++) {
      if (kind[i] === K.Tree && !claims.has(i, CLAIM_OBJECT)) { tree[i] = 1; round[i] = a.roundTree[i]; }
      // the General table's conifers drawn on blocked cells (the secret-base tree's bottom row)
      else if (kind[i] === K.Block && a.isGeneralId(mt[i]) && pineIds(mt[i]) && !structure[i] && !claims.has(i, CLAIM_OBJECT) &&
        !levelStep(a, i)) tree[i] = 1;
    }
    const forest = borderForest(a, stray);
    if (forest) {
      // Blocks mostly in the border trees' leaf colours, then the trunk-and-ground tiles at the
      // forest's edge (leaf and bark) beside them.
      const share = new Map<number, number>();
      const shareOf = (m: number) => {
        let n = share.get(m);
        if (n === undefined) {
          n = 0;
          for (let p = 0; p < 256; p++) if (forest.has(a.info.both[m * 256 + p])) n++;
          share.set(m, n);
        }
        return n;
      };
      for (let i = 0; i < a.N; i++) if (secondaryBlock(i) && shareOf(mt[i]) >= 48) { tree[i] = 1; round[i] = 1; }
      const edge: number[] = [];
      for (let i = 0; i < a.N; i++) {
        if (tree[i] || !secondaryBlock(i) || shareOf(mt[i]) < 16 || shareOf(mt[i]) + st(mt[i])[BARK_N] < 64) continue;
        const x = a.cellX(i), y = a.cellY(i);
        if (isTreeAt(tree, a, x - 1, y) || isTreeAt(tree, a, x + 1, y) || isTreeAt(tree, a, x, y - 1)) edge.push(i);
      }
      for (const i of edge) { tree[i] = 1; round[i] = 1; }
    }
    // 2-wide trees drawn partly in blocking art with less green (Mossdeep's bottom rows and
    // staggered edges): leaf-heavy left and right halves side by side, under or beside a tree.
    const half = (x: number, y: number, side: -1 | 1) => {
      if (!a.inside(x, y)) return false;
      const i = idx(x, y);
      if (!secondaryBlock(i)) return false;
      const s = st(mt[i]);
      return s[LEAF_N] >= MIN_LEAF && (side < 0 ? leafCx(s) >= 8.5 : leafCx(s) <= 6.5);
    };
    const treeKind = (x: number, y: number) => a.inside(x, y) && kind[idx(x, y)] === K.Tree;
    const halves: number[] = [];
    for (let y = a.minY; y < a.maxY; y++) {
      for (let x = a.minX; x < a.maxX; x++) {
        if (tree[idx(x, y)] || !(treeKind(x, y - 1) || treeKind(x - 1, y) || treeKind(x + 1, y))) continue;
        // a tree's bottom row stands on the ground (a stack of leafy blocks is the side of a structure)
        if (y + 1 < a.maxY && kind[idx(x, y + 1)] === K.Block) continue;
        // its other half: a half block (taken with it) or a tree cell
        for (const side of [-1, 1] as const) {
          if (!half(x, y, side)) continue;
          if (half(x - side, y, side === -1 ? 1 : -1)) halves.push(idx(x, y), idx(x - side, y));
          else if (treeKind(x - side, y)) halves.push(idx(x, y));
        }
      }
    }
    for (const j of halves) tree[j] = 1;

    const floor = forestFloor(a, tree);
    // Crown art overhanging the walkable cells around a tree (top-layer leaves; not grass tufts):
    // the 3D crowns replace it.
    for (let i = 0; i < a.N; i++) {
      if (kind[i] !== K.Floor || !a.hasTop(i) || GRASS.has(a.beh[i]) || st(mt[i])[LEAF_N] < MIN_LEAF) continue;
      const x = a.cellX(i), y = a.cellY(i);
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) if (isTreeAt(tree, a, x + dx, y + dy)) { near = true; break; }
      if (near) claims.claim(i, CLAIM_TOP);
    }

    // Runs down each column: claims, round trunk candidates, single-tree candidates (per cell: 1 +
    // the ground level it stands on).
    const roundC: { x: number; k: number; base: number }[] = [];
    const single = new Float32Array(a.N);
    const isTree = (x: number, y: number) => isTreeAt(tree, a, x, y);
    for (let x = a.minX; x < a.maxX; x++) {
      let y = a.minY;
      while (y < a.maxY) {
        if (!tree[idx(x, y)]) { y++; continue; }
        let e = y;
        while (e + 1 < a.maxY && tree[idx(x, e + 1)]) e++;
        const below = e + 1 < a.maxY ? idx(x, e + 1) : -1;
        const base = below >= 0 && !Number.isNaN(height[below]) ? Math.max(0, height[below]) : a.groundH[idx(x, e)];
        const above = y > a.minY ? idx(x, y - 1) : -1;
        if (above >= 0 && kind[above] === K.Floor && a.hasTop(above)) claims.claim(above, CLAIM_TOP);
        // A forest running from higher ground (behind it) down to the level in front: its first
        // rows stand on the higher ground, so their crowns don't rise through it (Route 113's ash
        // forest below the plateau). The step between the levels hides under the canopy.
        const behind = above >= 0 && (kind[above] === K.Floor || kind[above] === K.Stairs) ? Math.max(0, height[above]) : NaN;
        const high = e - y + 1 > LEVEL_REACH && behind > base + 0.01 ? y + LEVEL_REACH : y;
        for (let r = y; r <= e; r++) {
          const i = idx(x, r);
          claims.claim(i, CLAIM_OBJECT);
          claims.groundY[i] = r < high ? behind : base;
          claims.groundMt[i] = floor[i];
        }
        const at = (k: number) => claims.groundY[idx(x, k)];
        if (round[idx(x, e)]) {
          for (let k = e; k >= y; k -= 2) roundC.push({ x, k, base: at(k) });
        } else {
          // A narrow tree is two rows (crown over trunk): a run of L rows holds L - 1 crowns.
          for (let k = e; k >= (e > y ? y + 1 : y); k--) single[idx(x, k)] = 1 + at(k);
        }
        y = e + 1;
      }
    }

    const out: TreePlacement[] = [];
    const sum = new Float64Array(9);
    const colourCache = new Map<number, [RGB, RGB]>();
    /** Leaf and bark colours of the tree drawn by these cells (pixel-weighted means; trees drawn
     *  with the same tiles share them). */
    const colours = (cells: [number, number][]): [RGB, RGB] => {
      let id = 0; // the cells' metatiles (10 bits each, 1024 = none): ≤ 4 cells fit a double exactly
      for (const [x, y] of cells) id = id * 1025 + (isTree(x, y) ? mt[idx(x, y)] : 1024);
      let c = colourCache.get(id);
      if (c) return c;
      sum.fill(0);
      for (const [x, y] of cells) {
        if (!isTree(x, y)) continue;
        const s = st(mt[idx(x, y)]);
        for (let k = 0; k < 9; k++) sum[k] += s[k];
      }
      const leaf: RGB = sum[LEAF_N] ? [sum[0] / sum[LEAF_N], sum[1] / sum[LEAF_N], sum[2] / sum[LEAF_N]] : LEAF_FALLBACK;
      const bark: RGB = sum[BARK_N] >= 4 ? [sum[BARK] / sum[BARK_N], sum[BARK + 1] / sum[BARK_N], sum[BARK + 2] / sum[BARK_N]] : BARK_FALLBACK;
      c = [lush(soften(leaf)), soften(mix(bark, WARM_BARK, 0.4))];
      colourCache.set(id, c);
      return c;
    };
    const place = (x: number, k: number, base: number, style: TreeStyle, cells: [number, number][], scale = 1) => {
      const g = a.groundOf[idx(Math.floor(x), k)];
      const beach = g >= 0 && BEACH.has(attrBehavior(a.info.attributes[g]));
      const [leaf, trunk] = colours(cells);
      const t: TreePlacement = {
        x, y: base, z: k + 0.5 + base, style: beach && style !== 'pine' ? 'palm' : style,
        leaf, trunk, seed: hashCell(Math.floor(x * 2), k),
      };
      if (scale !== 1) t.scale = scale;
      out.push(t);
    };
    for (const t of pairRoundTrees(roundC)) {
      const x0 = Math.floor(t.x - (t.big ? 1 : 0.5));
      const cells: [number, number][] = t.big ? [[x0, t.k], [x0 + 1, t.k], [x0, t.k - 1], [x0 + 1, t.k - 1]] : [[x0, t.k], [x0, t.k - 1]];
      // a 2-wide tree stands on the higher of its two trunk cells
      const base = t.big ? Math.max(t.base, claims.groundY[idx(x0 + 1, t.k)]) : t.base;
      place(t.x, t.k, base, t.big ? 'round' : 'bushy', cells);
    }

    // Single trees, bottom rows first. Secondary-tileset tiles drawing the left and right half of a
    // tree make one round tree (and its crown row); a forest's interior keeps every other tree,
    // larger (its canopy is seen from above only).
    const done = new Uint8Array(a.N);
    for (let k = a.maxY - 1; k >= a.minY; k--) {
      for (let x = a.minX; x < a.maxX; x++) {
        const i = idx(x, k);
        if (!single[i] || done[i]) continue;
        const base = single[i] - 1;
        const m = mt[i];
        // the General table's 2-wide conifer (the secret-base tree): one pine between its columns
        if (x + 1 < a.maxX && single[i + 1] && !done[i + 1] && a.isGeneralId(m) && pineIds(m) && pineIds(mt[i + 1])) {
          done[i] = done[i + 1] = 1;
          place(x + 1, k, Math.max(base, single[i + 1] - 1), 'pine', [[x, k], [x + 1, k], [x, k - 1], [x + 1, k - 1]], PINE_PAIR);
          continue;
        }
        if (x + 1 < a.maxX && single[i + 1] && !done[i + 1] && !a.isGeneralId(m)) {
          const ls = st(m), rs = st(mt[i + 1]);
          if (ls[LEAF_N] >= MIN_LEAF && rs[LEAF_N] >= MIN_LEAF && leafCx(ls) >= 8.5 && leafCx(rs) <= 6.5) {
            done[i] = done[i + 1] = 1;
            if (k > a.minY) done[i - a.GW] = done[i + 1 - a.GW] = 1;
            place(x + 1, k, Math.max(base, single[i + 1] - 1), 'round', [[x, k], [x + 1, k], [x, k - 1], [x + 1, k - 1]]);
            continue;
          }
        }
        done[i] = 1;
        const interior = isTree(x - 1, k) && isTree(x + 1, k) && isTree(x, k - 1) && isTree(x, k + 1);
        if (interior && (x + k) % 2 !== 0) continue;
        const style: TreeStyle = a.isGeneralId(m) && pineIds(m) ? 'pine' : 'bushy';
        place(x + 0.5, k, base, style, [[x, k], [x, k - 1]], interior ? INTERIOR : 1);
      }
    }
    return out;
  },

  build(trees: TreePlacement[], _ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!trees.length) return null;
    // Finer crowns at high quality for the big round trees only (bushy forests hold thousands).
    const detailOf = (style: TreeStyle) => (kit.quality === 'high' && style === 'round' ? 2 : 1);
    /** Map chunk of a tree (numeric key: x and z chunk, 4096 apart). */
    const chunkOf = (t: TreePlacement) => (Math.floor(t.z / CHUNK) + 2048) * 4096 + Math.floor(t.x / CHUNK) + 2048;
    // A small tree among round ones (a lone round-tree column) is drawn as a small round tree:
    // one draw per chunk instead of two.
    const chunks = trees.map(chunkOf);
    const roundChunks = new Set(chunks.filter((_, i) => trees[i].style === 'round'));
    // Buckets: drawn style (one material each) × map chunk. Trunks take their style's most common
    // bark colour: they barely show under the crowns, and one colour per style keeps the draws few.
    const buckets = new Map<string, { t: TreePlacement; k: number; style: TreeStyle; chunk: number }[]>();
    const barks = new Map<TreeStyle, Map<string, { n: number; c: RGB }>>();
    trees.forEach((t, i) => {
      const chunk = chunks[i];
      const small = t.style === 'bushy' && roundChunks.has(chunk);
      const style: TreeStyle = small ? 'round' : t.style;
      const id = style + chunk;
      const entry = { t, k: small ? SMALL_ROUND : 1, style, chunk };
      const list = buckets.get(id);
      if (list) list.push(entry); else buckets.set(id, [entry]);
      const votes = barks.get(style) ?? new Map<string, { n: number; c: RGB }>();
      barks.set(style, votes);
      const bk = t.trunk.map((v) => Math.round(v * 31)).join(',');
      const v = votes.get(bk);
      if (v) v.n++; else votes.set(bk, { n: 1, c: t.trunk });
    });
    const root = new THREE.Group();
    const mats = new Map<TreeStyle, KitMaterial>();
    const linear = new Map<RGB, RGB>(); // leaf colours are shared by the trees drawn with the same tiles
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    for (const list of buckets.values()) {
      const { style, chunk } = list[0];
      let km = mats.get(style);
      if (!km) {
        let bark: RGB = BARK_FALLBACK, best = 0;
        for (const v of barks.get(style)!.values()) if (v.n > best) { best = v.n; bark = v.c; }
        const tl = toLinear(bark);
        km = kitMaterial(kit.uniforms, {
          vertexColors: true, roughness: 0.85, wind: WIND[style][0], windHeight: WIND[style][1], fade: true,
          side: style === 'palm' ? THREE.DoubleSide : THREE.FrontSide,
          uniforms: { uTrunk: { value: new THREE.Color(tl[0], tl[1], tl[2]) } },
          fragHead: TRUNK_HEAD, fragColor: TRUNK_FRAG, hookKey: 'tree',
        });
        mats.set(style, km);
      }
      // (palms and pines are rare: one shape each, varied by rotation and scale)
      const variant = style === 'round' || style === 'bushy' ? hashCell(chunk % 4096, Math.floor(chunk / 4096), style.length) % VARIANTS : 0;
      const mesh = new THREE.InstancedMesh(treeGeo(style, variant, detailOf(style)), km.material, list.length);
      applyKitMaterial(mesh, km);
      list.forEach(({ t, k: size }, i) => {
        const r = rng(t.seed);
        const k = size * (t.scale ?? 1) * (0.92 + r() * 0.16);
        q.setFromAxisAngle(up, r() * Math.PI * 2);
        m.compose(p.set(t.x, t.y, t.z), q, s.set(k * (0.92 + r() * 0.16), k * (0.9 + r() * 0.2), k * (0.92 + r() * 0.16)));
        mesh.setMatrixAt(i, m);
        let lin = linear.get(t.leaf);
        if (!lin) { lin = toLinear(t.leaf); linear.set(t.leaf, lin); }
        // a little lightness and hue jitter (warmer / cooler) per tree
        const v = 1 + (r() - 0.5) * 0.12, w = (r() - 0.5) * 0.08;
        c.setRGB(lin[0] * v * (1 + w), lin[1] * v, lin[2] * v * (1 - w));
        mesh.setColorAt(i, c);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      shadowsNearView(mesh);
      root.add(mesh);
    }
    return root;
  },
};
