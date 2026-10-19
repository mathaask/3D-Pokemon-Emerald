// Buildings: real 3D houses, Pokémon Centers, Marts, Gyms, labs and special buildings, built on
// footprints grown out from each door over the building's own art (footprints.ts: the analysis'
// door flood fill also swallows the fences, posts, rock and forest around it). The kind comes from
// the door's warp destination; colours, windows and chimneys come from the building's own tiles.

import * as THREE from 'three';
import { K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_TOP, type Claims } from '../overworld/claims';
import { bgr555ToSrgb, luma, mix, saturation, scale, soften, toLinear, type RGB } from './palette';
import { MeshBuilder, type V3 } from './geom';
import { buildingKind, buildingLayout, type BuildingKind } from './footprints';
import { kitMaterial } from './materials';
import type { Family, KitContext, SemanticContext } from './semantics';
import { pokeballTexture, signTexture, SIGN_ASPECT } from './text';
import { scale4x } from './upscale';

export { buildingKind, type BuildingKind } from './footprints';

export interface BuildingPlacement {
  kind: BuildingKind;
  x0: number; x1: number;
  top: number; bottom: number;
  base: number;
  wallRows: number;
  doorX: number;
  roof: RGB;
  wall: RGB;
  windows: number[];
  chimneyX: number | null;
  /** Columns whose door-row cell is the building's walkable front steps: the walls stand one row
   *  back over them (the door's bay stays at the front). */
  steps: number[];
  /** `special`: the wall rows' ROM pixels (BGR555, 0x8000 transparent), row-major from the top. */
  facade: { w: number; h: number; px: Uint16Array } | null;
}

/** Window glass: a light blue (not the navy outlines), unlike the wall around it (Marts, Pokémon
 *  Centers and gyms have pale blue walls in the same shades as houses' windows). */
const isGlass = (c: RGB, wall: RGB) => c[2] > c[0] + 0.12 && c[2] >= c[1] && luma(c) > 0.45 && saturation(c) > 0.12 &&
  Math.abs(c[0] - wall[0]) + Math.abs(c[1] - wall[1]) + Math.abs(c[2] - wall[2]) > 0.1;
const isGrey = (c: RGB) => saturation(c) < 0.08 && luma(c) > 0.35 && luma(c) < 0.85;
/** The tiles' outline and shadow shades (navy, slate, mid grey), shared by every building. */
const isOutline = (c: RGB) => luma(c) <= 0.35 || (saturation(c) < 0.06 && luma(c) < 0.6);

/** Colour counts of metatiles' opaque pixels, cached per tile and per colour (one map's extract). */
class TileColors {
  private hists = new Map<number, Map<number, number>>();
  private rgb = new Map<number, RGB>();
  constructor(private readonly px: Uint16Array) {}

  /** Pixel count per BGR555 colour over `mts`. */
  counts(mts: readonly number[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const m of mts) {
      let h = this.hists.get(m);
      if (!h) {
        h = new Map();
        for (let p = 0; p < 256; p++) {
          const v = this.px[m * 256 + p];
          if (!(v & 0x8000)) h.set(v, (h.get(v) ?? 0) + 1);
        }
        this.hists.set(m, h);
      }
      for (const [v, n] of h) out.set(v, (out.get(v) ?? 0) + n);
    }
    return out;
  }

  color(v: number): RGB {
    let c = this.rgb.get(v);
    if (!c) this.rgb.set(v, (c = bgr555ToSrgb(v)));
    return c;
  }

  /** Number of pixels of `mts` whose colour passes `accept`. */
  count(mts: readonly number[], accept: (c: RGB) => boolean): number {
    let n = 0;
    for (const [v, k] of this.counts(mts)) if (accept(this.color(v))) n += k;
    return n;
  }

  /** Most frequent colour of `mts` passing `accept`, with its pixel count. */
  top(mts: readonly number[], accept: (c: RGB) => boolean): { c: RGB; n: number } | null {
    let best: { c: RGB; n: number } | null = null;
    for (const [v, n] of this.counts(mts)) {
      if (best && n <= best.n) continue;
      const c = this.color(v);
      if (accept(c)) best = { c, n };
    }
    return best;
  }
}

/** Wall colour: the lightest of its common light shades (at least half as frequent as the most
 *  common): the plaster, not the pillars and frames drawn around it (Lilycove). Outline shades
 *  and window glass never count. */
function wallColor(tc: TileColors, mts: readonly number[]): RGB | null {
  const light: { c: RGB; n: number }[] = [];
  for (const [v, n] of tc.counts(mts)) {
    const c = tc.color(v);
    if (!isOutline(c) && luma(c) > 0.5 && !(c[2] > c[0] + 0.12 && saturation(c) > 0.3)) light.push({ c, n });
  }
  const top = Math.max(0, ...light.map((k) => k.n));
  let best: RGB | null = null;
  for (const { c, n } of light) if (n * 2 >= top && (!best || luma(c) > luma(best))) best = c;
  return best;
}

/** Roof colour: its most common colourful shade, unless a neutral one (a grey slate roof) covers
 *  more than twice as much. Outline shades never count. */
function roofColor(tc: TileColors, mts: readonly number[]): RGB | null {
  const s = tc.top(mts, (c) => !isOutline(c) && saturation(c) >= 0.12);
  const n = tc.top(mts, (c) => !isOutline(c) && luma(c) > 0.45 && saturation(c) < 0.12);
  if (s && (!n || s.n * 2 >= n.n)) return s.c;
  return n?.c ?? null;
}

function facadePixels(a: MapAnalysis, x0: number, x1: number, y0: number, y1: number) {
  const w = (x1 - x0 + 1) * 16, h = (y1 - y0 + 1) * 16;
  const px = new Uint16Array(w * h);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const m = a.mt[a.idx(x, y)];
      for (let p = 0; p < 256; p++) {
        px[((y - y0) * 16 + (p >> 4)) * w + (x - x0) * 16 + (p & 15)] = a.info.both[m * 256 + p];
      }
    }
  }
  return { w, h, px };
}

// ---------------------------------------------------------------- family

export const buildingFamily: Family<BuildingPlacement[]> = {
  name: 'buildings',

  extract({ a, events }: SemanticContext, claims: Claims): BuildingPlacement[] {
    // (a Dive map has no buildings to stand on its seabed)
    if (a.opts.indoor || a.opts.underground || a.opts.underwater) return [];
    const { footprints, owner } = buildingLayout(a, events);
    const tc = new TileColors(a.info.both);
    const out: BuildingPlacement[] = [];
    footprints.forEach((fp, k) => {
      const { x0, x1, top, bottom, doorX } = fp;
      const mine = (x: number, y: number) => a.inside(x, y) && owner[a.idx(x, y)] === k + 1;
      for (let y = top; y <= bottom; y++) for (let x = x0; x <= x1; x++) if (mine(x, y) && claims.has(a.idx(x, y), CLAIM_OBJECT)) return;
      const rows = bottom - top + 1;
      const wallRows = rows >= 9 ? 4 : rows >= 7 ? 3 : 2;
      const { base, steps } = fp;
      const kind = buildingKind(fp.dest, x1 - x0 + 1);
      const roofMts: number[] = [], wallMts: number[] = [];
      for (let y = top; y <= bottom; y++) {
        for (let x = x0; x <= x1; x++) if (mine(x, y)) (y > bottom - wallRows ? wallMts : roofMts).push(a.mt[a.idx(x, y)]);
      }
      const roof = roofColor(tc, roofMts) ?? [0.75, 0.35, 0.3];
      // the wall's own (light) colour, not its outlines and shadows
      const wall = wallColor(tc, wallMts) ?? tc.top(wallMts, (c) => luma(c) > 0.3)?.c ?? [0.9, 0.88, 0.8];
      const glass = (c: RGB) => isGlass(c, wall);
      const windows: number[] = [];
      // A chimney is a roof column far greyer than all the others (outlines and grey slate roofs
      // are grey everywhere).
      const greys: number[] = [];
      for (let x = x0; x <= x1; x++) {
        const wm: number[] = [], rm: number[] = [];
        for (let y = top; y <= bottom; y++) if (mine(x, y)) (y > bottom - wallRows ? wm : rm).push(a.mt[a.idx(x, y)]);
        if (x !== doorX && tc.count(wm, glass) > 20) windows.push(x);
        greys.push(tc.count(rm, isGrey));
      }
      const [g1, g2 = 0] = [...greys].sort((p, q) => q - p);
      const chimneyX = kind === 'house' && g1 > 40 && g1 >= 2 * g2 ? x0 + greys.indexOf(g1) : null;
      // The model stands on its art and on the walkable cells walled in by it (their art is the
      // building's: the ground beneath takes the look of the ground before the door). Walkable
      // cells the player can reach (the front steps) stay outside it. The lone roof-edge cells on
      // the row above stay the legacy art's (standing blocks behind the roof): the model never
      // reaches that row, and some of them are no roof at all (a cliff's foot, a ledge's end).
      const below = a.inside(doorX, bottom + 1) ? a.idx(doorX, bottom + 1) : -1;
      const ground = below >= 0 && a.kind[below] === K.Floor ? a.mt[below] : -1;
      for (let y = top - 1; y <= bottom; y++) {
        for (let x = x0; x <= x1; x++) {
          if (!a.inside(x, y)) continue;
          const i = a.idx(x, y);
          if (y >= top && mine(x, y)) {
            claims.claim(i, CLAIM_OBJECT);
            claims.groundY[i] = base;
            claims.groundMt[i] = ground;
          }
          // overhang art on the walkable row behind (and on walkable cells inside): the 3D roof replaces it
          if (a.kind[i] === K.Floor && a.hasTop(i)) claims.claim(i, CLAIM_TOP);
        }
      }
      out.push({
        kind, x0, x1, top, bottom, base, wallRows, doorX,
        roof: soften(roof), wall: soften(wall), windows, chimneyX, steps,
        facade: kind === 'special' ? facadePixels(a, x0, x1, bottom - wallRows + 1, bottom) : null,
      });
    });
    return out;
  },

  build(list: BuildingPlacement[], _ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!list.length) return null;
    const parts: BuildingParts = { body: new MeshBuilder(), roof: new MeshBuilder(), glass: new MeshBuilder(), extras: [] };
    for (const p of list) buildBuilding(p, parts, kit);
    const root = new THREE.Group();
    const add = (mb: MeshBuilder, mat: THREE.Material) => {
      if (mb.empty) return;
      const mesh = new THREE.Mesh(mb.build(), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    };
    add(parts.body, kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.85, fade: true }).material);
    add(parts.roof, kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.7, pattern: 'roofTiles', fade: true, side: THREE.DoubleSide }).material);
    add(parts.glass, kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.15, metalness: 0.1, glow: 1.6, fade: true }).material);
    for (const e of parts.extras) root.add(e);
    return root;
  },
};

export interface BuildingParts { body: MeshBuilder; roof: MeshBuilder; glass: MeshBuilder; extras: THREE.Object3D[] }

/** Shared numbers of one building in world space. */
export interface BuildingFrame {
  X0: number; X1: number; cx: number;
  zf: number;      // front at the door (the door row's front edge)
  zr: number;      // front of the main body: zf, or one row back over walkable front steps
  zb: number; zm: number; // back and middle of the main body
  y0: number;      // top of the plinth (wall bottom)
  eave: number;    // wall top
  D: number; W: number; // main body depth (zr - zb) and width
  ov: number;      // roof overhang
}

export function buildFrame(p: BuildingPlacement): BuildingFrame {
  const W = p.x1 - p.x0 + 1;
  const zf = p.bottom + 1 + p.base;
  // the walls start behind the top row (the GBA draws the roof's back slope there), at least 1.6 deep
  const zb = zf - Math.min(4, Math.max(1.6, p.bottom - p.top));
  const zr = p.steps.length ? zf - 1 : zf;
  const y0 = p.base + 0.12;
  // Pokémon Centers, Marts and gyms stand a little taller: their signs hang between the door and
  // the eave, below the band the roof's overhang hides from the camera
  const H = p.wallRows * 0.95 + (isStore(p.kind) ? 0.3 : 0);
  return { X0: p.x0, X1: p.x1 + 1, cx: p.x0 + W / 2, zf, zr, zb, zm: (zb + zr) / 2, y0, eave: y0 + H, D: zr - zb, W, ov: 0.25 };
}

/** Kinds with a shop front: wide glass sliding doors, a sign over them. */
const isStore = (k: BuildingKind) => k === 'pc' || k === 'mart' || k === 'gym';

/** Axis-aligned box centred on (cx, cy, cz), all six faces (quads straight into `mb`: no geometry). */
export function addBox(mb: MeshBuilder, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: RGB): void {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  mb.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], color);
  mb.quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], [0, -1, 0], color);
  mb.quad([x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1], [0, 0, 1], color);
  mb.quad([x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0], [0, 0, -1], color);
  mb.quad([x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0], [-1, 0, 0], color);
  mb.quad([x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1], [1, 0, 0], color);
}

function tri(mb: MeshBuilder, a: V3, b: V3, c: V3, color: RGB): void {
  const n = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a))
    .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a))).normalize();
  mb.quad(a, b, c, c, [n.x, n.y, n.z], color);
}

/** Gable (inset 0) or hip roof over [x0, x1] × [zb, zf] from the eave up by `rise`. */
export function roofGeometry(mb: MeshBuilder, x0: number, x1: number, zb: number, zf: number, eave: number, rise: number, hip: boolean, color: RGB): void {
  const zm = (zb + zf) / 2;
  const inset = hip ? Math.min((zf - zb) / 2, (x1 - x0) / 2 - 0.01) : 0;
  const E0: V3 = [x0, eave, zf], E1: V3 = [x1, eave, zf], E2: V3 = [x1, eave, zb], E3: V3 = [x0, eave, zb];
  const R0: V3 = [x0 + inset, eave + rise, zm], R1: V3 = [x1 - inset, eave + rise, zm];
  mb.quad(R0, R1, E1, E0, [0, zf - zm, rise], color);   // front slope
  mb.quad(R1, R0, E3, E2, [0, zf - zm, -rise], color);  // back slope
  if (hip) {
    tri(mb, E3, E0, R0, color);
    tri(mb, E1, E2, R1, color);
  }
}

function buildBuilding(p: BuildingPlacement, parts: BuildingParts, kit: KitContext): void {
  const f = buildFrame(p);
  const wall = toLinear(p.wall);
  const roof = toLinear(p.roof);
  const trim = toLinear(mix(p.wall, p.roof, 0.3).map((v) => v * 0.85) as RGB);
  const stone = toLinear([0.62, 0.6, 0.58]);
  const wood = toLinear([0.5, 0.34, 0.2]);
  const frameC = toLinear([0.93, 0.91, 0.87]);
  const glassC = toLinear([0.55, 0.72, 0.85]);
  const { body, glass } = parts;
  const H = f.eave - f.y0;
  /** Plinth, walls, baseboard and front corner posts of the block [x0, x1] × [zb, zf]. */
  const block = (x0: number, x1: number, zb: number, zf: number) => {
    const cx = (x0 + x1) / 2, cz = (zb + zf) / 2, w = x1 - x0, d = zf - zb;
    addBox(body, cx, p.base + 0.06, cz, w + 0.12, 0.12, d + 0.12, stone);
    addBox(body, cx, f.y0 + H / 2, cz, w, H, d, wall);
    addBox(body, cx, f.y0 + 0.15, cz, w + 0.03, 0.3, d + 0.03, scale(wall, 0.72));
    for (const x of [x0, x1]) addBox(body, x, f.y0 + H / 2, zf, 0.12, H, 0.12, trim);
  };
  // the main body (one row back over walkable front steps), its back corner posts
  block(f.X0, f.X1, f.zb, f.zr);
  for (const x of [f.X0, f.X1]) addBox(body, x, f.y0 + H / 2, f.zb, 0.12, H, 0.12, trim);
  // the bays between the steps, out to the door row's front edge, under flat caps
  const steps = new Set(p.steps);
  for (let x = p.x0; x <= p.x1 && f.zr < f.zf; x++) {
    if (steps.has(x)) continue;
    let e = x;
    while (e + 1 <= p.x1 && !steps.has(e + 1)) e++;
    block(x, e + 1, f.zr, f.zf);
    addBox(parts.roof, (x + e + 1) / 2, f.eave + 0.04, (f.zr + f.zf + f.ov) / 2, e + 1 - x + 0.2, 0.1, f.zf - f.zr + f.ov, roof);
    x = e;
  }
  // step in front of the door
  addBox(body, p.doorX + 0.5, p.base + 0.04, f.zf + 0.22, 1.1, 0.08, 0.36, stone);
  if (p.kind === 'special') {
    addSpecialFacade(p, f, parts, kit);
  } else {
    // Pokémon Centers, Marts and gyms: wide glass sliding doors, windows kept below the sign
    const store = isStore(p.kind);
    const dx = p.doorX + 0.5;
    if (store) {
      addBox(body, dx, f.y0 + OPENING_TOP / 2, f.zf + 0.03, 1.08, OPENING_TOP, 0.08, trim);
      addBox(glass, dx, f.y0 + 0.6, f.zf + 0.075, 0.94, 1.16, 0.03, glassC);
      addBox(body, dx, f.y0 + 0.6, f.zf + 0.095, 0.035, 1.16, 0.02, trim);
    } else {
      addBox(body, dx, f.y0 + 0.68, f.zf + 0.03, 0.86, 1.36, 0.08, trim);
      addBox(body, dx, f.y0 + 0.62, f.zf + 0.07, 0.68, 1.22, 0.05, wood);
    }
    // windows (a gym's door bay holds its pillars instead)
    const [ba, bb] = frontRun(p, p.doorX);
    for (const x of p.windows) {
      if (p.kind === 'gym' && x >= ba && x < bb) continue;
      const wy = f.y0 + (store ? OPENING_TOP - 0.4 : H * 0.58), z = frontZ(p, f, x);
      addBox(body, x + 0.5, wy, z + 0.03, 0.72, 0.62, 0.06, frameC);
      addBox(glass, x + 0.5, wy, z + 0.065, 0.58, 0.48, 0.03, glassC);
      addBox(body, x + 0.5, wy - 0.33, z + 0.07, 0.82, 0.05, 0.14, frameC);
    }
  }
  // roof
  const hip = p.kind !== 'house' || f.W >= 6;
  const run = f.D / 2 + f.ov;
  const rise = p.kind === 'house' ? 0.55 * run : p.kind === 'gym' ? 0.18 * run : 0.32 * run;
  roofGeometry(parts.roof, f.X0 - f.ov, f.X1 + f.ov, f.zb - f.ov, f.zr + f.ov, f.eave, rise, hip, roof);
  if (!hip) {
    // gable walls under a gable roof
    const gy = f.eave + rise * (f.D / 2) / run;
    // vertex order sets the facing: west gable faces -X, east gable faces +X
    tri(body, [f.X0, f.eave, f.zb], [f.X0, f.eave, f.zr], [f.X0, gy, f.zm], wall);
    tri(body, [f.X1, f.eave, f.zr], [f.X1, f.eave, f.zb], [f.X1, gy, f.zm], wall);
  }
  addBox(body, f.cx, f.eave - 0.04, f.zr + f.ov, f.W + 2 * f.ov, 0.08, 0.06, trim);
  addBox(body, f.cx, f.eave - 0.04, f.zb - f.ov, f.W + 2 * f.ov, 0.08, 0.06, trim);
  const ridgeLen = f.W + 2 * f.ov - (hip ? 2 * Math.min(run, f.W / 2 + f.ov - 0.01) : 0);
  if (ridgeLen > 0.05) addBox(parts.roof, f.cx, f.eave + rise + 0.02, f.zm, ridgeLen, 0.07, 0.14, scale(roof, 0.8));
  if (p.chimneyX !== null) addBox(body, p.chimneyX + 0.5, f.eave + rise * 0.6 + 0.2, f.zm - 0.3, 0.35, 0.7, 0.35, toLinear([0.55, 0.38, 0.32]));
  addKindDetails(p, f, rise, parts, kit);
}

// ---------------------------------------------------------------- details

/** Top of the door frames (and of storefront windows) above the plinth: signs hang above it. */
const OPENING_TOP = 1.32;
/** Signs are lit from within (their own colours, not the windows' warm wash): a little by day, so
 *  they read in the eave's shadow, more at night. */
const SIGN_GLOW = 'totalEmissiveRadiance += diffuseColor.rgb * (0.12 + 0.5 * uNight);';
/** The roof emblem, in full sun by day (its white would bloom), is lit at night only. */
const EMBLEM_GLOW = 'totalEmissiveRadiance += diffuseColor.rgb * 0.35 * uNight;';
const WHITE = toLinear([0.95, 0.95, 0.93]);
/** The sign boards' backing, in the canvas frame's colour (text.ts SIGN_FRAME). */
const SIGN_BACK = toLinear([0x1d / 255, 0x1d / 255, 0x22 / 255]);

/** Front of column x: the door row's front edge, or one row back over walkable front steps. */
function frontZ(p: BuildingPlacement, f: BuildingFrame, x: number): number {
  return p.steps.includes(x) ? f.zr : f.zf;
}

/** Columns [a, b) around x whose fronts stand in one plane: the door's bay between the walkable
 *  front steps, a wing over them, or the whole front. */
function frontRun(p: BuildingPlacement, x: number): [number, number] {
  const step = p.steps.includes(x);
  let a = x, b = x + 1;
  while (a > p.x0 && p.steps.includes(a - 1) === step) a--;
  while (b <= p.x1 && p.steps.includes(b) === step) b++;
  return [a, b];
}

/** Height of the main hip roof's surface over (x, z) (the eave outside it). */
function roofY(f: BuildingFrame, rise: number, x: number, z: number): number {
  const run = f.D / 2 + f.ov;
  const inset = Math.min(run, f.W / 2 + f.ov - 0.01);
  const k = Math.min(1 - Math.abs(z - f.zm) / run, (x - f.X0 + f.ov) / inset, (f.X1 + f.ov - x) / inset);
  return f.eave + rise * Math.max(0, Math.min(1, k));
}

const css = (c: RGB) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

/** Lit sign board over the door, on a dark backing board: centred on the door's front run (its bay, or
 *  the whole front), just above the door frame (clear of the band the eave hides). */
function doorSign(p: BuildingPlacement, f: BuildingFrame, text: string, bg: RGB, parts: BuildingParts, kit: KitContext): void {
  const [a, b] = frontRun(p, p.doorX);
  const lo = f.y0 + OPENING_TOP + 0.04, hi = f.eave - 0.3;
  const w = Math.min(b - a - 0.3, 2.8, (hi - lo) * SIGN_ASPECT);
  const h = w / SIGN_ASPECT, x = (a + b) / 2, y = lo + h / 2, z = frontZ(p, f, p.doorX);
  addBox(parts.body, x, y, z + 0.035, w + 0.06, h + 0.06, 0.07, SIGN_BACK);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), kitMaterial(kit.uniforms, {
    map: signTexture(text, '#ffffff', css(bg)), roughness: 0.6, fade: true, fragEmissive: SIGN_GLOW, hookKey: 'sign',
  }).material);
  mesh.name = `sign:${text}`;
  mesh.position.set(x, y, z + 0.075);
  mesh.receiveShadow = true;
  parts.extras.push(mesh);
}

/** Poké Ball emblem on a white rim, set into the middle of the front roof slope. */
function addEmblem(f: BuildingFrame, rise: number, parts: BuildingParts, kit: KitContext): void {
  const run = f.D / 2 + f.ov, len = Math.hypot(run, rise);
  const r = Math.min(0.46, len * 0.34);
  const X = new THREE.Vector3(1, 0, 0);
  const n = new THREE.Vector3(0, run / len, rise / len); // the slope's normal
  const up = new THREE.Vector3(0, rise / len, -run / len); // up the slope
  // on the slope, 45 % of the way from the eave to the ridge
  const c = new THREE.Vector3(f.cx, f.eave + 0.45 * rise, f.zr + f.ov - 0.45 * run);
  const rim = new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.08, 32);
  parts.body.add(rim, WHITE, new THREE.Matrix4().makeBasis(X, n, up.clone().negate()).setPosition(c.clone().addScaledVector(n, 0.02)));
  rim.dispose();
  const face = new THREE.Mesh(new THREE.CircleGeometry(r, 32), kitMaterial(kit.uniforms, {
    map: pokeballTexture(), roughness: 0.4, fade: true, fragEmissive: EMBLEM_GLOW, hookKey: 'emblem',
  }).material);
  face.name = 'emblem';
  face.matrixAutoUpdate = false;
  face.matrix.makeBasis(X, up, n).setPosition(c.addScaledVector(n, 0.065));
  face.receiveShadow = true;
  parts.extras.push(face);
}

/** Two-colour striped awning along [xa, xb] of the wall plane z, hanging from height y. */
function addAwning(mb: MeshBuilder, xa: number, xb: number, y: number, z: number, c1: RGB, c2: RGB): void {
  const depth = 0.4, drop = 0.16, t = 0.04, valance = 0.1;
  const yf = y - drop, zf = z + depth, len = Math.hypot(depth, drop);
  const n: V3 = [0, depth / len, drop / len];
  const stripes = Math.max(2, Math.round((xb - xa) * 2.5));
  for (let s = 0; s < stripes; s++) {
    const x0 = xa + ((xb - xa) * s) / stripes, x1 = xa + ((xb - xa) * (s + 1)) / stripes;
    const c = s % 2 ? c2 : c1;
    mb.quad([x0, y, z], [x1, y, z], [x1, yf, zf], [x0, yf, zf], n, c);
    mb.quad([x0, yf - t, zf], [x1, yf - t, zf], [x1, y - t, z], [x0, y - t, z], [0, -n[1], -n[2]], scale(c, 0.8));
    mb.quad([x0, yf, zf], [x1, yf, zf], [x1, yf - valance, zf], [x0, yf - valance, zf], [0, 0, 1], c);
  }
  for (const [x, dir] of [[xa, -1], [xb, 1]]) mb.quad([x, y, z], [x, yf, zf], [x, yf - valance, zf], [x, y - t, z], [dir, 0, 0], c1);
}

/** Column flanking the door: plinth, shaft, capital up to the sign (into the body). */
function addPillar(mb: MeshBuilder, x: number, z: number, y0: number, top: number, color: RGB): void {
  addBox(mb, x, y0 + 0.05, z, 0.26, 0.1, 0.26, color);
  const shaft = new THREE.CylinderGeometry(0.085, 0.1, top - y0 - 0.18, 12);
  mb.add(shaft, color, new THREE.Matrix4().makeTranslation(x, (y0 + 0.1 + top - 0.08) / 2, z));
  shaft.dispose();
  addBox(mb, x, top - 0.04, z, 0.28, 0.08, 0.28, color);
}

/** Roof furniture of a lab: a round turbine vent where the GBA draws it (left of the middle, on
 *  the front slope), small box vents behind the ridge and a satellite dish on a mast. */
function addLabRoof(f: BuildingFrame, rise: number, mb: MeshBuilder): void {
  const run = f.D / 2 + f.ov;
  const grey = toLinear([0.74, 0.76, 0.79]), dark = toLinear([0.42, 0.44, 0.48]);
  const vx = f.X0 + Math.max(1.2, f.W * 0.3), vz = f.zm + run * 0.35, vy = roofY(f, rise, vx, vz);
  addBox(mb, vx, vy + 0.06, vz, 0.66, 0.34, 0.66, grey);
  const drum = new THREE.CylinderGeometry(0.25, 0.28, 0.3, 20);
  mb.add(drum, grey, new THREE.Matrix4().makeTranslation(vx, vy + 0.38, vz));
  drum.dispose();
  const cap = new THREE.CylinderGeometry(0.31, 0.31, 0.06, 20);
  mb.add(cap, dark, new THREE.Matrix4().makeTranslation(vx, vy + 0.56, vz));
  cap.dispose();
  const bz = f.zm - run * 0.4;
  for (const k of [0.5, 0.6]) {
    const x = f.X0 + f.W * k;
    addBox(mb, x, roofY(f, rise, x, bz) + 0.08, bz, 0.26, 0.32, 0.26, grey);
  }
  const dx = f.X1 - Math.max(1.0, f.W * 0.18), dy = roofY(f, rise, dx, f.zm);
  const mast = new THREE.CylinderGeometry(0.04, 0.05, 0.6, 8);
  mb.add(mast, dark, new THREE.Matrix4().makeTranslation(dx, dy + 0.25, f.zm));
  mast.dispose();
  // the dish: a shallow cone, its face turned to the southern sky
  const tilt = new THREE.Matrix4().makeRotationX(0.6).premultiply(new THREE.Matrix4().makeTranslation(dx, dy + 0.6, f.zm));
  const dish = new THREE.CylinderGeometry(0.36, 0.08, 0.14, 20);
  mb.add(dish, WHITE, tilt);
  dish.dispose();
  const feed = new THREE.CylinderGeometry(0.025, 0.025, 0.3, 6);
  mb.add(feed, dark, new THREE.Matrix4().makeTranslation(0, 0.2, 0).premultiply(tilt));
  feed.dispose();
}

function addKindDetails(p: BuildingPlacement, f: BuildingFrame, rise: number, parts: BuildingParts, kit: KitContext): void {
  if (p.kind === 'pc') {
    doorSign(p, f, 'POKéMON CENTER', p.roof, parts, kit);
    addEmblem(f, rise, parts, kit);
  } else if (p.kind === 'mart') {
    doorSign(p, f, 'POKé MART', p.roof, parts, kit);
    const [a, b] = frontRun(p, p.doorX);
    addAwning(parts.body, a + 0.06, b - 0.06, f.y0 + OPENING_TOP + 0.04, frontZ(p, f, p.doorX), toLinear(p.roof), WHITE);
  } else if (p.kind === 'gym') {
    doorSign(p, f, 'POKéMON GYM', scale(p.roof, 0.7), parts, kit);
    const [a, b] = frontRun(p, p.doorX), z = frontZ(p, f, p.doorX) + 0.13;
    for (const x of [p.doorX - 0.19, p.doorX + 1.19]) {
      if (x - 0.14 >= a && x + 0.14 <= b) addPillar(parts.body, x, z, f.y0, f.y0 + OPENING_TOP + 0.04, WHITE);
    }
  } else if (p.kind === 'lab') {
    addLabRoof(f, rise, parts.body);
  }
}

/** A special building's fronts dressed in its ROM facade (wall rows' pixels, Scale4x-upscaled,
 *  transparent pixels in the wall colour), each front run on its own plane, so signage and
 *  character survive. */
function addSpecialFacade(p: BuildingPlacement, f: BuildingFrame, parts: BuildingParts, kit: KitContext): void {
  if (!p.facade) return;
  const { w, h, px } = p.facade;
  const pack = (c: RGB) => ((255 << 24) | (Math.round(c[2] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[0] * 255)) >>> 0;
  const wall = pack(p.wall);
  const packed = new Map<number, number>();
  const src = new Uint32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const v = px[i];
    if (v & 0x8000) { src[i] = wall; continue; }
    let c = packed.get(v);
    if (c === undefined) packed.set(v, (c = pack(soften(bgr555ToSrgb(v)))));
    src[i] = c;
  }
  const big = scale4x(src, w, h);
  const W4 = w * 4, H4 = h * 4;
  // DataTexture rows run bottom-up: flip while copying.
  const flipped = new Uint32Array(W4 * H4);
  for (let y = 0; y < H4; y++) flipped.set(big.subarray(y * W4, (y + 1) * W4), (H4 - 1 - y) * W4);
  const tex = new THREE.DataTexture(new Uint8Array(flipped.buffer), W4, H4, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  kit.disposables.push(tex);
  // one quad per front run (in front of the baseboard), mapped to its own columns of the facade
  const pos: number[] = [], uv: number[] = [], nor: number[] = [], index: number[] = [];
  for (let x = p.x0; x <= p.x1;) {
    const [a, b] = frontRun(p, x), z = frontZ(p, f, x) + 0.02, k = pos.length / 3;
    const u0 = (a - p.x0) / f.W, u1 = (b - p.x0) / f.W;
    pos.push(a, f.eave, z, b, f.eave, z, b, f.y0, z, a, f.y0, z);
    uv.push(u0, 1, u1, 1, u1, 0, u0, 0);
    nor.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
    index.push(k, k + 3, k + 1, k + 1, k + 3, k + 2);
    x = b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  const mesh = new THREE.Mesh(g, kitMaterial(kit.uniforms, { map: tex, roughness: 0.85, fade: true }).material);
  mesh.name = 'facade';
  mesh.receiveShadow = true;
  parts.extras.push(mesh);
}
