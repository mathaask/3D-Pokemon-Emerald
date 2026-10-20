// The legacy pixel-textured reconstruction: floors, tree cards, building shells, blocked runs,
// connectors and overhang cards, built from a MapAnalysis (see analyze.ts). Cells the kit
// claimed (claims.ts) are skipped so its models can take their place.

import { Variant } from './metatileAtlas';
import { diffFromGround, type TileInfo } from './tileInfo';
import { bgr555ToSrgb, classifyGroundColor } from '../kit/palette';
import { K, ROOF_SLOPE, type MapAnalysis } from './analyze';
import { type Claims, CLAIM_SURFACE, CLAIM_OBJECT, CLAIM_TOP, CLAIM_WATER_UNDER } from './claims';

export type Vec3 = [number, number, number];

export interface Quad {
  a: Vec3; b: Vec3; c: Vec3; d: Vec3; // texture TL, TR, BR, BL
  normal: Vec3;
  metatile: number;
  variant: Variant;
  tu0: number; tu1: number; tv0: number; tv1: number;
  cutout: boolean;
  shade: number;
  /** Rendered with the water material. */
  water?: boolean;
  /** Building wall: window pixels glow at night. */
  glow?: boolean;
}

/** Height above the water level of legacy art the kit's water runs under (CLAIM_WATER_UNDER): over
 *  the water surface's swell (kit/water.ts: +-0.05). */
export const DRY_LIFT = 0.06;

export interface TreeQuad {
  px: number; py: number; pz: number; y0: number;
  metatile: number; variant: Variant;
}

/** Whether metatile `m`'s art shows water (16 px or more of water colours, as the atlas' Dry variant
 *  cuts out). */
function drawsWater(info: TileInfo, m: number): boolean {
  let n = 0;
  for (let p = m * 256, end = p + 256; p < end && n < 16; p++) {
    const v = info.both[p];
    if (!(v & 0x8000) && classifyGroundColor(bgr555ToSrgb(v)) === 'water') n++;
  }
  return n >= 16;
}

/** Today's pixel-textured reconstruction, skipping whatever the kit claimed. */
export function emitLegacy(a: MapAnalysis, claims: Claims | null = null): { quads: Quad[]; trees: TreeQuad[] } {
  const { opts, info, minX, minY, maxX, maxY, idx, inside, mt, kind, roundTree, building, buildings,
    height, groundOf, groundH, hasTop, GW, N } = a;
  const claimed = (i: number, bit: number) => claims !== null && (claims.bits[i] & bit) !== 0;
  // Cells the kit's water runs under: their art is drawn without its water (Dry, alpha-tested) where
  // it shows any, and no floor of pixel water lies under a block standing in the water.
  const wetArt = new Map<number, boolean>();
  const dry = (i: number) => {
    if (!claimed(i, CLAIM_WATER_UNDER)) return false;
    const m = mt[i];
    let w = wetArt.get(m);
    if (w === undefined) wetArt.set(m, (w = drawsWater(info, m)));
    return w;
  };
  /** Variant and cutout flag of cell i's art drawn with `v` (Both unless dry). */
  const art = (i: number, v: Variant): [Variant, boolean] => (dry(i) ? [Variant.Dry, true] : [v, v === Variant.Cutout]);
  /** A surface for the connectors: drawn by the kit (its own, or its water under legacy art). */
  const kitSurface = (i: number) => claimed(i, CLAIM_SURFACE) || claimed(i, CLAIM_WATER_UNDER);
  // Buildings the kit modelled: the cells of their door flood fill outside the model (art the fill
  // swallowed: fences, lamp posts, rock) are plain blocks again.
  const modelled = new Uint8Array(buildings.length);
  if (claims) buildings.forEach((b, id) => { modelled[id] = b.cells.some((c) => claimed(c, CLAIM_OBJECT)) ? 1 : 0; });
  /** Kind as the legacy emitter sees it: objects claimed by the kit no longer exist here. */
  const kindL = (i: number) => {
    const k = kind[i];
    if (claimed(i, CLAIM_OBJECT) && (k === K.Block || k === K.Tree || k === K.Building)) return K.Floor;
    return k === K.Building && modelled[building[i]] ? K.Block : k;
  };

  const quads: Quad[] = [];
  const trees: TreeQuad[] = [];
  const floor = (x: number, y: number, h: number, m: number, variant: Variant, cutout = false, shade = 1) => {
    const z0 = y + h;
    quads.push({
      a: [x, h, z0], b: [x + 1, h, z0], c: [x + 1, h, z0 + 1], d: [x, h, z0 + 1],
      normal: [0, 1, 0], metatile: m, variant, tu0: 0, tu1: 1, tv0: 0, tv1: 1, cutout, shade,
    });
  };
  /** Vertical south-facing quad at plane z = zf, world heights [y0, y1]. */
  const face = (x: number, zf: number, y0: number, y1: number, m: number, variant: Variant, cutout = false, shade = 0.94) => {
    quads.push({
      a: [x, y1, zf], b: [x + 1, y1, zf], c: [x + 1, y0, zf], d: [x, y0, zf],
      normal: [0, 0, 1], metatile: m, variant, tu0: 0, tu1: 1, tv0: 0, tv1: 1, cutout, shade,
    });
  };
  /** Generic quad from a row's bottom edge (zb, yb) to its top edge (zt, yt). */
  const slope = (x: number, zb: number, yb: number, zt: number, yt: number, m: number, variant: Variant, cutout = false, shade = 1) => {
    const dz = zt - zb, dy = yt - yb;
    const len = Math.hypot(dz, dy) || 1;
    quads.push({
      a: [x, yt, zt], b: [x + 1, yt, zt], c: [x + 1, yb, zb], d: [x, yb, zb],
      normal: [0, -dz / len, dy / len], metatile: m, variant, tu0: 0, tu1: 1, tv0: 0, tv1: 1, cutout, shade,
    });
  };
  /** Side quad on plane x = px (facing +X if dir > 0) from z range and heights. */
  const side = (px: number, dir: number, zb: number, zt: number, yb0: number, yb1: number, yt0: number, yt1: number,
    m: number, variant: Variant, shade = 0.78) => {
    // corners: front-top (zb, yb1), back-top (zt, yt1), back-bottom (zt, yt0), front-bottom (zb, yb0)
    if (dir > 0) {
      quads.push({
        a: [px, yb1, zb], b: [px, yt1, zt], c: [px, yt0, zt], d: [px, yb0, zb],
        normal: [1, 0, 0], metatile: m, variant, tu0: 0, tu1: 1, tv0: 0, tv1: 1, cutout: false, shade,
      });
    } else {
      quads.push({
        a: [px, yt1, zt], b: [px, yb1, zb], c: [px, yb0, zb], d: [px, yt0, zt],
        normal: [-1, 0, 0], metatile: m, variant, tu0: 0, tu1: 1, tv0: 0, tv1: 1, cutout: false, shade,
      });
    }
  };

  const consumedTop = new Uint8Array(N); // overhang tops used by a structure south of them

  // ---- floors, water, stairs, ledges, and ground under structures
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const i = idx(x, y);
      if (claimed(i, CLAIM_SURFACE)) continue;
      const k = kind[i];
      if (k === K.Void) continue;
      if (k === K.Floor || k === K.Stairs || k === K.Ledge) {
        const h = height[i];
        floor(x, y, h, mt[i], hasTop(i) ? Variant.Bottom : Variant.Both);
      } else if (k === K.Water) {
        if (claimed(i, CLAIM_WATER_UNDER)) {
          floor(x, y, height[i] + DRY_LIFT, mt[i], Variant.Dry, true, 1);
        } else {
          floor(x, y, height[i], mt[i], Variant.Both, false, 1);
          quads[quads.length - 1].water = true;
        }
      } else if (claimed(i, CLAIM_WATER_UNDER)) {
        // (standing in the kit's water: no floor under it)
      } else {
        const g = groundOf[i];
        // No plain ground nearby (dense forest): use the cell itself so nothing shows through.
        floor(x, y, groundH[i], g >= 0 ? g : mt[i], Variant.Both, false, g >= 0 ? 0.9 : 0.6);
      }
    }
  }

  // ---- trees: one standing card per trunk (narrow: 2 rows, round: 3 rows)
  for (let x = minX; x < maxX; x++) {
    let y = minY;
    while (y < maxY) {
      if (kindL(idx(x, y)) !== K.Tree) { y++; continue; }
      let e = y;
      while (e + 1 < maxY && kindL(idx(x, e + 1)) === K.Tree) e++;
      const below = e + 1 < maxY ? idx(x, e + 1) : -1;
      const base = below >= 0 && !Number.isNaN(height[below]) ? Math.max(0, height[below]) : groundH[idx(x, e)];
      const aboveI = y > minY ? idx(x, y - 1) : -1;
      const overhang = aboveI >= 0 && kind[aboveI] === K.Floor && hasTop(aboveI) && !claimed(aboveI, CLAIM_TOP);
      if (overhang) consumedTop[aboveI] = 1;
      const period = roundTree[idx(x, e)] ? 2 : 1;
      for (let k = e; k >= y; k -= period) {
        let hi = k - period;
        if (hi < y) hi = overhang ? y - 1 : y;
        const zf = k + 1 + base;
        for (let r = hi; r <= k; r++) {
          const ri = idx(x, r);
          const variant = r < y ? Variant.Top : Variant.Cutout;
          trees.push({ px: x + 0.5, py: base, pz: zf - 0.5, y0: k - r, metatile: mt[ri], variant });
        }
      }
      y = e + 1;
    }
  }

  // ---- buildings: front wall (bottom rows) + sloped roof (+ overhang row) + sides
  for (const b of buildings) {
    if (b.cells.some((c) => claimed(c, CLAIM_OBJECT))) continue;
    const cols = new Map<number, { top: number; bottom: number }>();
    for (const c of b.cells) {
      const cx = (c % GW) + minX, cy = ((c / GW) | 0) + minY;
      const e = cols.get(cx);
      if (!e) cols.set(cx, { top: cy, bottom: cy });
      else { e.top = Math.min(e.top, cy); e.bottom = Math.max(e.bottom, cy); }
    }
    const xs = [...cols.keys()].sort((p, q) => p - q);
    const rowsMax = Math.max(...[...cols.values()].map((c) => c.bottom - c.top + 1));
    const wallRows = rowsMax >= 9 ? 4 : rowsMax >= 7 ? 3 : 2;
    const doorBelow = idx(xs[Math.floor(xs.length / 2)], b.doorRow + 1);
    const base = inside(xs[0], b.doorRow + 1) && !Number.isNaN(height[doorBelow]) ? Math.max(0, height[doorBelow]) : 0;
    const profiles = new Map<number, { zf: number; pts: [number, number][] }>();
    for (const x of xs) {
      const { top, bottom } = cols.get(x)!;
      const n = bottom - top + 1;
      const w = Math.min(wallRows, n);
      const zf = bottom + 1 + base;
      for (let r = bottom - w + 1; r <= bottom; r++) {
        const y0 = base + (bottom - r);
        face(x, zf, y0, y0 + 1, mt[idx(x, r)], Variant.Both, false, 0.95);
        quads[quads.length - 1].glow = true;
      }
      // roof rows: from the lowest roof row up to the overhang
      const pts: [number, number][] = [[zf, base + w]];
      let j = 0;
      const ov = idx(x, top - 1);
      const roofTopRow = inside(x, top - 1) && kind[ov] === K.Floor && hasTop(ov) && !claimed(ov, CLAIM_TOP) ? top - 1 : top;
      if (roofTopRow < top) consumedTop[ov] = 1;
      for (let r = bottom - w; r >= roofTopRow; r--, j++) {
        const yb = base + w + ROOF_SLOPE * j;
        const yt = yb + ROOF_SLOPE;
        const zb = r + 1 + yb;
        const zt = r + yt;
        const variant = r < top ? Variant.Top : Variant.Both;
        slope(x, zb, yb, zt, yt, mt[idx(x, r)], variant, r < top, 1);
        pts.push([zt, yt]);
      }
      profiles.set(x, { zf, pts });
    }
    // side walls on the outer columns, and a back wall behind the ridge
    for (const [x, dir] of [[xs[0], -1], [xs[xs.length - 1], 1]] as [number, number][]) {
      const p = profiles.get(x)!;
      const { bottom } = cols.get(x)!;
      const wallM = mt[idx(x, bottom - 1 >= cols.get(x)!.top ? bottom - 1 : bottom)];
      const px = dir > 0 ? x + 1 : x;
      // wall part: from the front face back to the first roof point
      for (let s = 0; s + 1 < p.pts.length; s++) {
        const [zb, yb] = p.pts[s];
        const [zt, yt] = p.pts[s + 1];
        side(px, dir, zb, zt, base, yb, base, yt, wallM, Variant.Both);
      }
      void p.zf;
    }
    for (const x of xs) {
      const p = profiles.get(x)!;
      const [zt, yt] = p.pts[p.pts.length - 1];
      const { bottom } = cols.get(x)!;
      quads.push({
        a: [x + 1, yt, zt], b: [x, yt, zt], c: [x, base, zt], d: [x + 1, base, zt],
        normal: [0, 0, -1], metatile: mt[idx(x, bottom)], variant: Variant.Both,
        tu0: 0, tu1: 1, tv0: 0, tv1: 1, cutout: false, shade: 0.7,
      });
    }
  }

  // ---- generic blocked runs: cliffs, rock blocks, props, fences, indoor walls, furniture
  for (let x = minX; x < maxX; x++) {
    let y = minY;
    while (y < maxY) {
      if (kindL(idx(x, y)) !== K.Block) { y++; continue; }
      let e = y;
      while (e + 1 < maxY && kindL(idx(x, e + 1)) === K.Block) e++;
      const L = e - y + 1;
      const bi = e + 1 < maxY ? idx(x, e + 1) : -1;
      const ai = y > minY ? idx(x, y - 1) : -1;
      const walk = (i: number) => i >= 0 && (kind[i] === K.Floor || kind[i] === K.Stairs || kind[i] === K.Water || kind[i] === K.Ledge);
      /** Ground level beside the run (a modelled building's cell: the ground the model stands on). */
      const groundAt = (i: number) => (walk(i) ? Math.max(height[i], 0)
        : i >= 0 && kind[i] === K.Building && claimed(i, CLAIM_OBJECT) ? claims!.groundY[i] : NaN);
      const hB = groundAt(bi);
      const hA = groundAt(ai);
      if (Number.isNaN(hB)) {
        // Nothing in front: a flat top at the level behind (or ground level).
        const top = Number.isNaN(hA) ? groundH[idx(x, e)] : hA;
        for (let r = y; r <= e; r++) floor(x, r, top, mt[idx(x, r)], ...art(idx(x, r), Variant.Both));
        y = e + 1;
        continue;
      }
      let F: number;
      if (!Number.isNaN(hA) && hA > hB + 0.01) {
        F = Math.min(L, Math.max(1, Math.round(hA - hB)));
      } else if (opts.indoor) {
        // Back walls reach to the void; furniture is a box.
        const toVoid = ai < 0 || kind[ai] === K.Void || kind[ai] === K.Block;
        F = toVoid ? Math.min(L, 3) : Math.min(L, Math.max(1, Math.round(L / 2)));
      } else if (L <= 2) {
        // props and fences: standing cutout card if they don't fill the cell
        const ref = groundOf[idx(x, e)];
        const sparse = ref >= 0 && diffFromGround(info, mt[idx(x, e)], ref) < 0.8;
        if (sparse) {
          const zf = e + 0.5 + hB; // stand on the cell's centre line
          for (let r = y; r <= e; r++) {
            const y0 = hB + (e - r);
            face(x, zf, y0, y0 + 1, mt[idx(x, r)], ...art(idx(x, r), Variant.Cutout), 1);
          }
          if (ai >= 0 && kind[ai] === K.Floor && hasTop(ai) && !claimed(ai, CLAIM_TOP)) {
            consumedTop[ai] = 1;
            face(x, zf, hB + L, hB + L + 1, mt[ai], Variant.Top, true, 1);
          }
          y = e + 1;
          continue;
        }
        F = L;
      } else {
        F = Math.min(L, Math.max(1, Math.min(3, Math.round(L / 2))));
      }
      const zf = e + 1 + hB;
      for (let r = e - F + 1; r <= e; r++) {
        const y0 = hB + (e - r);
        face(x, zf, y0, y0 + 1, mt[idx(x, r)], ...art(idx(x, r), Variant.Both), 0.92);
      }
      const topH = hB + F;
      for (let r = y; r <= e - F; r++) floor(x, r, topH, mt[idx(x, r)], ...art(idx(x, r), Variant.Both), 1);
      // side skirts per top row, only where the west/east neighbour is lower
      for (let r = y; r <= e - F; r++) {
        for (const dir of [-1, 1]) {
          const nx = x + dir;
          if (!inside(nx, r)) continue;
          const ni = idx(nx, r);
          if (kind[ni] === K.Block || kind[ni] === K.Building || kind[ni] === K.Tree) continue;
          const nh = Number.isNaN(height[ni]) ? hB : Math.max(0, height[ni]);
          if (nh >= topH - 0.01) continue;
          const px = dir > 0 ? x + 1 : x;
          side(px, dir, r + 1 + topH, r + topH, nh, topH, nh, topH, mt[idx(x, r)], Variant.Both, 0.72);
        }
      }
      y = e + 1;
    }
  }

  // ---- connectors: close the gaps between adjacent surfaces at different heights (shores,
  //      stairs, terraces). Un-projection shifts lower surfaces north (Z = y + h), so without
  //      these the sky would show through thin slits along every shoreline.
  const surface = (k: number) => k === K.Floor || k === K.Water || k === K.Stairs || k === K.Ledge;
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const i = idx(x, y);
      if (!surface(kind[i])) continue;
      const h = height[i];
      // south neighbour: edge (Z = y+1+h, Y = h) -> (Z = y+1+h2, Y = h2)
      if (y + 1 < maxY) {
        const j = idx(x, y + 1);
        if (!(kitSurface(i) && kitSurface(j))) {
          if (surface(kind[j]) && Math.abs(height[j] - h) > 0.01) {
            const h2 = height[j];
            // Lower north cell -> this is the front of the higher cell (lit); higher south cell ->
            // the shadowed underside of a raised deck/walkway, nearly edge-on to the camera.
            const front = h > h2;
            const src = front ? i : i;
            quads.push({
              a: [x, Math.max(h, h2), y + 1 + Math.max(h, h2)], b: [x + 1, Math.max(h, h2), y + 1 + Math.max(h, h2)],
              c: [x + 1, Math.min(h, h2), y + 1 + Math.min(h, h2)], d: [x, Math.min(h, h2), y + 1 + Math.min(h, h2)],
              normal: [0, 0, 1], metatile: mt[src], variant: Variant.Both, tu0: 0, tu1: 1, tv0: 0.8, tv1: 1,
              cutout: false, shade: front ? 0.8 : 0.45, water: kind[src] === K.Water,
            });
          }
        }
      }
      // east neighbour: parallelogram on the plane X = x + 1
      if (x + 1 < maxX) {
        const j = idx(x + 1, y);
        if (!(kitSurface(i) && kitSurface(j))) {
          if (surface(kind[j]) && Math.abs(height[j] - h) > 0.01) {
            const h2 = height[j];
            const hi = Math.max(h, h2), lo = Math.min(h, h2);
            const upper = h > h2 ? i : j;
            const dir = h > h2 ? 1 : -1; // faces towards the lower cell
            const px = x + 1;
            if (dir > 0) {
              quads.push({
                a: [px, hi, y + hi], b: [px, hi, y + 1 + hi], c: [px, lo, y + 1 + lo], d: [px, lo, y + lo],
                normal: [1, 0, 0], metatile: mt[upper], variant: Variant.Both, tu0: 0, tu1: 1, tv0: 0.8, tv1: 1,
                cutout: false, shade: 0.75, water: kind[upper] === K.Water,
              });
            } else {
              quads.push({
                a: [px, hi, y + 1 + hi], b: [px, hi, y + hi], c: [px, lo, y + lo], d: [px, lo, y + 1 + lo],
                normal: [-1, 0, 0], metatile: mt[upper], variant: Variant.Both, tu0: 0, tu1: 1, tv0: 0.8, tv1: 1,
                cutout: false, shade: 0.75, water: kind[upper] === K.Water,
              });
            }
          }
        }
      }
    }
  }

  // ---- unclaimed overhangs: top layer stands up as a card at the cell's south edge
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const i = idx(x, y);
      if (kind[i] !== K.Floor || !hasTop(i) || consumedTop[i] || claimed(i, CLAIM_TOP)) continue;
      const h = height[i];
      face(x, y + 1 + h, h, h + 1, mt[i], Variant.Top, true, 1);
    }
  }

  return { quads, trees };
}
