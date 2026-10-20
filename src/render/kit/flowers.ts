// Flowers: small instanced 3D flowers (leaves, stem, five cupped petals, centre) on flower cells,
// in the tile's two most frequent petal colours (petals, centre) and its leaf green. Three per
// cell, as the GBA's flower tiles draw them; a town's flower bed tile, two big flowers of two kinds,
// gets four (two of each). They sway a little and part around characters. Instanced per 16-cell
// map chunk and centre/leaf colour pair; they receive shadows, cast none.
//
// A flower tile is told apart from other light art over grass (roof eaves, signs, fences, paving
// edges, speckled grass) by its petal blobs: small, several, and set in foliage. The towns' flower
// beds, which that test rejects, are listed by tileset (tables/secondary.ts).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_DECOR, CLAIM_OBJECT, CLAIM_TOP, type Claims } from '../overworld/claims';
import { bgr555ToSrgb, countPixels, luma, lush, saturation, soften, toLinear, type RGB } from './palette';
import { hashCell, rng } from './geom';
import { GRASS_BEHAVIORS } from './grass';
import { applyKitMaterial, kitMaterial, type KitMaterial } from './materials';
import { SECONDARY_FLOWERS } from './tables/secondary';
import { isSecretBaseSpot, type Family, type KitContext, type SemanticContext } from './semantics';

export interface FlowerCell {
  x: number; y: number; h: number; petals: [RGB, RGB];
  /** Leaf and stem colour (default: a mid green). */
  leaf?: RGB;
  /** A second kind of flower's petals (a bed of two kinds): every other flower takes them. */
  second?: RGB;
}

let flowerIds: (m: number) => boolean = () => false;
export function setFlowerIds(f: (m: number) => boolean): void { flowerIds = f; }

/** A petal's colour: not foliage green, lit, and saturated or near white. */
export const isPetal = (c: RGB) => {
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

/** A blob of this many petal pixels is one flower (more is an eave, a sign or paving). */
const BLOB_MIN = 4, BLOB_MAX = 40;

/**
 * Whether metatile `m` draws flowers: at least two petal blobs (4-connected petal pixels, 4..40 px)
 * whose outline is mostly foliage (green or dark olive), holding most of the tile's petal pixels.
 * Roof eaves, signs, fences and paving are outlined in dark blues and greys, or one large blob;
 * Fortree's speckled grass is single pixels.
 */
export function isFlowerTile(px: Uint16Array, m: number): boolean {
  const pet = new Uint8Array(256);
  let total = 0;
  for (let p = 0; p < 256; p++) {
    const v = px[m * 256 + p];
    if (!(v & 0x8000) && isPetal(bgr555ToSrgb(v))) { pet[p] = 1; total++; }
  }
  if (!total) return false;
  const seen = new Uint8Array(256), edge = new Uint8Array(256);
  const stack: number[] = [];
  let blobs = 0, inBlobs = 0;
  for (let s = 0; s < 256; s++) {
    if (!pet[s] || seen[s]) continue;
    seen[s] = 1;
    stack.push(s);
    edge.fill(0);
    let size = 0, border = 0, leafy = 0;
    while (stack.length) {
      const p = stack.pop()!;
      size++;
      const x = p & 15, y = p >> 4;
      for (let k = 0; k < 4; k++) {
        const nx = x + (k === 0 ? 1 : k === 1 ? -1 : 0), ny = y + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || ny < 0 || nx > 15 || ny > 15) continue;
        const q = ny * 16 + nx;
        if (pet[q]) {
          if (!seen[q]) { seen[q] = 1; stack.push(q); }
          continue;
        }
        if (edge[q]) continue;
        edge[q] = 1;
        border++;
        const v = px[m * 256 + q];
        if (v & 0x8000) continue;
        const r = v & 31, g = (v >> 5) & 31, b = (v >> 10) & 31;
        if (g > r && g >= b) leafy++;
      }
    }
    if (size >= BLOB_MIN && size <= BLOB_MAX && leafy >= border * 0.6) { blobs++; inBlobs += size; }
  }
  return blobs >= 2 && inBlobs >= total * 0.6;
}

/**
 * Whether metatile `m`'s ground (bottom) layer is mostly in petal colours: then the "petals" the
 * blob test sees between leaves are that ground showing through (the sand or sea under Dewford's
 * bushes, drawn in the top layer), not flowers.
 */
const groundPetals = (bottom: Uint16Array, m: number) => countPixels(bottom, [m], isPetal) >= 128;

/** A flower head's colour: not foliage, not an outline; saturated, or light (white, pale blue). */
const isHead = (c: RGB) => !(c[1] > c[0] && c[1] > c[2]) && luma(c) >= 0.35 && (saturation(c) >= 0.2 || luma(c) >= 0.75);
const isPale = (c: RGB) => saturation(c) < 0.2;
/** Hue in degrees (0..360). */
function hue([r, g, b]: RGB): number {
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}
/** One family of flower colours: pale with pale, else within 25° of hue (a petal's shades). */
function sameFamily(a: RGB, b: RGB): boolean {
  if (isPale(a) || isPale(b)) return isPale(a) && isPale(b);
  const d = Math.abs(hue(a) - hue(b));
  return Math.min(d, 360 - d) <= 25;
}

/**
 * Colours of a flower bed tile (two big flowers of two kinds among leaves, tables/secondary.ts): its
 * flower-head colours grouped into families of one hue (a petal's shades and highlights; whites and
 * pale tints together), families of 4 px or more by size, each its mean colour weighted towards its
 * lighter shades (luma³: the GBA draws a petal's shading into it, the 3D flower is shaded by its
 * light; Ever Grande's yellow, drawn mostly in a dark shade, would average to mustard): the first two
 * are the two kinds' petals, a third their centre. Null without a flower colour.
 */
export function bedColors(px: Uint16Array, m: number): { petals: RGB; second?: RGB; centre?: RGB } | null {
  const counts = new Map<number, number>();
  for (let p = 0; p < 256; p++) {
    const v = px[m * 256 + p];
    if (!(v & 0x8000) && isHead(bgr555ToSrgb(v))) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const families: { first: RGB; sum: RGB; weight: number; n: number }[] = [];
  for (const [v, n] of [...counts].sort((p, q) => q[1] - p[1])) {
    const c = bgr555ToSrgb(v);
    let f = families.find((g) => sameFamily(g.first, c));
    if (!f) families.push(f = { first: c, sum: [0, 0, 0], weight: 0, n: 0 });
    const w = n * luma(c) ** 3;
    for (let k = 0; k < 3; k++) f.sum[k] += c[k] * w;
    f.weight += w;
    f.n += n;
  }
  const [a, b, c] = families.filter((f) => f.n >= 4).sort((p, q) => q.n - p.n)
    .map((f) => f.sum.map((s) => s / f.weight) as RGB);
  return a ? { petals: a, ...(b ? { second: b } : {}), ...(c ? { centre: c } : {}) } : null;
}

/** Leaf colour of a flower tile: its most frequent foliage green (lit), foliage-graded. */
function leafColor(px: Uint16Array, m: number): RGB {
  const counts = new Map<number, number>();
  for (let p = 0; p < 256; p++) {
    const v = px[m * 256 + p];
    if (v & 0x8000) continue;
    const c = bgr555ToSrgb(v);
    if (c[1] > c[0] && c[1] >= c[2] && luma(c) > 0.3 && luma(c) < 0.62) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best = -1, bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return lush(soften(best >= 0 ? bgr555ToSrgb(best) : LEAF), 0.45);
}

const LEAF: RGB = [0.3, 0.55, 0.25];
const YELLOW: RGB = [0.98, 0.85, 0.3];
/** Flowers per cell (the GBA's flower tiles draw three); a bed of two kinds gets two of each. */
const PER_CELL = 3, BED_PER_CELL = 4;
const perCell = (c: FlowerCell) => (c.second ? BED_PER_CELL : PER_CELL);

interface FlowerLook { petals: [RGB, RGB]; second?: RGB; leaf: RGB; bed: boolean }

/** The flowers metatile `m` draws (null: none): a curated bed of the map's town tileset, read from
 *  its ground layer, or a curated General id / a tile the blob test takes, read from both layers. */
function flowerLook(a: MapAnalysis, m: number, beds: ReadonlySet<number> | undefined): FlowerLook | null {
  const { both, bottom } = a.info;
  if (m >= 512 && beds?.has(m)) {
    const c = bedColors(bottom, m);
    if (!c) return null;
    return {
      petals: [soften(c.petals), c.centre ? soften(c.centre) : YELLOW], ...(c.second ? { second: soften(c.second) } : {}),
      leaf: leafColor(bottom, m), bed: true,
    };
  }
  const known = a.isGeneralId(m) && flowerIds(m);
  const c = known || (a.info.green[m] > 0.25 && isFlowerTile(both, m) && !groundPetals(bottom, m)) ? petalColors(both, m) : null;
  return c ? { petals: [soften(c[0]), soften(c[1])], leaf: leafColor(both, m), bed: false } : null;
}

const CHUNK = 16;

// ---------------------------------------------------------------- geometry

/**
 * One flower (origin at the stem's root): three leaves, a stem, five cupped petals and a centre,
 * the head tipped towards the camera's side (+z). RGBA vertex colours flag the parts: alpha 1 =
 * petal (the instance colour), 0.6 = centre, 0.1..0.3 = leaf and stem shade (read by PART_FRAG).
 */
let flowerGeo: THREE.BufferGeometry | null = null;
function flower(): THREE.BufferGeometry {
  if (flowerGeo) return flowerGeo;
  const H = 0.3;
  const parts: THREE.BufferGeometry[] = [];
  const paint = (g: THREE.BufferGeometry, f: (y: number) => number) => {
    const p = g.getAttribute('position');
    const c = new Float32Array(p.count * 4);
    for (let i = 0; i < p.count; i++) c.set([1, 1, 1, f(p.getY(i))], i * 4);
    g.setAttribute('color', new THREE.BufferAttribute(c, 4));
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    const flat = g.index ? g.toNonIndexed() : g;
    if (flat !== g) g.dispose();
    return flat;
  };
  const head = new THREE.Matrix4().makeRotationX(0.4).setPosition(0, H, 0);
  for (let i = 0; i < 5; i++) {
    const g = new THREE.SphereGeometry(0.075, 6, 3);
    g.scale(1, 0.28, 0.62);
    g.translate(0.078, 0, 0);
    g.rotateZ(0.28); // cupped
    g.rotateY((i / 5) * Math.PI * 2);
    g.applyMatrix4(head);
    parts.push(paint(g, () => 1));
  }
  const centre = new THREE.SphereGeometry(0.042, 6, 4).scale(1, 0.6, 1).translate(0, 0.014, 0).applyMatrix4(head);
  parts.push(paint(centre, () => 0.6));
  const stem = new THREE.CylinderGeometry(0.011, 0.016, H, 4, 1, true).translate(0, H / 2, 0);
  parts.push(paint(stem, (y) => 0.15 + 0.1 * (y / H)));
  for (let i = 0; i < 3; i++) {
    // a leaf: a diamond from the root, rising outwards
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.1, 0.02, 0.045, 0.21, 0, 0, 0.1, 0.02, -0.045], 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.rotateZ(0.35 + 0.15 * i).rotateY(0.5 + (i / 3) * Math.PI * 2).translate(0, 0.015, 0);
    parts.push(paint(g, (y) => 0.1 + 0.15 * Math.min(1, y / 0.12)));
  }
  flowerGeo = mergeGeometries(parts)!;
  parts.forEach((g) => g.dispose());
  flowerGeo.computeBoundingSphere();
  flowerGeo.userData.shared = true;
  return flowerGeo;
}

const PART_HEAD = /* glsl */ `
uniform vec3 uCentre;
uniform vec3 uLeaf;
`;
/** Leaves and stem (alpha < 0.45) take the leaf colour, the centre (alpha ~0.6) its own. */
const PART_FRAG = /* glsl */ `
#ifdef USE_COLOR_ALPHA
if (vColor.a < 0.45) diffuseColor.rgb = uLeaf * (0.55 + 2.0 * vColor.a);
else if (vColor.a < 0.8) diffuseColor.rgb = uCentre;
diffuseColor.a = 1.0;
#endif
`;
/** Thin leaves are lit on both faces with their own normal. */
const BOTH_FACES = /* glsl */ `
normal = normalize(vNormal);
`;

export const flowerFamily: Family<FlowerCell[]> = {
  name: 'flowers',

  extract({ a }: SemanticContext, claims: Claims): FlowerCell[] {
    if (a.opts.indoor || a.opts.underground || a.opts.underwater) return [];
    const out: FlowerCell[] = [];
    const beds = SECONDARY_FLOWERS.get(a.opts.secondaryTileset ?? 0);
    const cache = new Map<number, FlowerLook | null>();
    for (let i = 0; i < a.N; i++) {
      const k = a.kind[i];
      if ((k !== K.Floor && k !== K.Stairs) || claims.has(i, CLAIM_OBJECT) || GRASS_BEHAVIORS.has(a.beh[i]) || isSecretBaseSpot(a, i)) continue;
      const m = a.mt[i];
      let look = cache.get(m);
      if (look === undefined) {
        look = flowerLook(a, m, beds);
        cache.set(m, look);
      }
      if (!look) continue;
      out.push({
        x: a.cellX(i), y: a.cellY(i), h: Math.max(0, a.height[i]), petals: look.petals, leaf: look.leaf,
        ...(look.second ? { second: look.second } : {}),
      });
      // The 3D flowers replace the drawn ones: on the ground (the terrain paints plain ground under
      // them), and in the top layer, unless the flowers are a bed's (its top layer is other art: Ever
      // Grande's stone ledge stays).
      claims.claim(i, CLAIM_DECOR);
      if (!look.bed) claims.claim(i, CLAIM_TOP);
    }
    return out;
  },

  build(cells: FlowerCell[], _ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!cells.length) return null;
    const geo = flower();
    // Buckets: centre + leaf colours (one material each; a map has one or two flower tiles) × chunk.
    const buckets = new Map<string, FlowerCell[]>();
    const key3 = (c: RGB) => c.map((v) => Math.round(v * 255)).join(',');
    const centreOf = (c: FlowerCell): RGB => (key3(c.petals[1]) === key3(c.petals[0]) ? YELLOW : c.petals[1]);
    for (const c of cells) {
      const id = `${key3(centreOf(c))}|${key3(c.leaf ?? LEAF)}|${Math.floor(c.x / CHUNK)},${Math.floor(c.y / CHUNK)}`;
      const list = buckets.get(id);
      if (list) list.push(c); else buckets.set(id, [c]);
    }
    const mats = new Map<string, KitMaterial>();
    const root = new THREE.Group();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
    for (const [id, list] of buckets) {
      const matId = id.slice(0, id.lastIndexOf('|'));
      let km = mats.get(matId);
      if (!km) {
        const centre = toLinear(centreOf(list[0])), leaf = toLinear(list[0].leaf ?? LEAF);
        km = kitMaterial(kit.uniforms, {
          vertexColors: true, roughness: 0.75, side: THREE.DoubleSide, wind: 0.03, windHeight: 0.3, bend: true,
          uniforms: {
            uCentre: { value: new THREE.Color(centre[0], centre[1], centre[2]) },
            uLeaf: { value: new THREE.Color(leaf[0], leaf[1], leaf[2]) },
          },
          fragHead: PART_HEAD, fragColor: PART_FRAG, fragNormal: BOTH_FACES, hookKey: 'flowers',
        });
        mats.set(matId, km);
      }
      const mesh = new THREE.InstancedMesh(geo, km.material, list.reduce((n, c) => n + perCell(c), 0));
      applyKitMaterial(mesh, km);
      let k = 0;
      for (const c of list) {
        const r = rng(hashCell(c.x, c.y, 3));
        const petal = toLinear(c.petals[0]), second = c.second ? toLinear(c.second) : petal;
        const turn = r() * Math.PI * 2;
        const n = perCell(c);
        for (let f = 0; f < n; f++, k++) {
          // flowers around the cell's centre, facing the camera's side (a little turned); a bed's two
          // kinds take turns
          const a = turn + (f / n) * Math.PI * 2, d = 0.2 + r() * 0.08;
          const size = 0.9 + r() * 0.3;
          q.setFromAxisAngle(up, (r() - 0.5) * 1.2);
          m.compose(p.set(c.x + 0.5 + Math.cos(a) * d, c.h, c.y + c.h + 0.5 + Math.sin(a) * d), q, s.set(size, size * (0.85 + r() * 0.3), size));
          mesh.setMatrixAt(k, m);
          const v = 0.94 + r() * 0.12, p2 = f % 2 ? second : petal;
          mesh.setColorAt(k, col.setRGB(p2[0] * v, p2[1] * v, p2[2] * v));
        }
      }
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      root.add(mesh);
    }
    return root;
  },
};
