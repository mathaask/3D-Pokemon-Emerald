// A room's wall parts (moved from battle/parts/rooms.ts in Phase 4 and generalised; the battle's halls and stadium rooms
// build their shells with them unchanged, the interiors build theirs): a wall's frame, the shell's profile (a darker
// baseboard, a lighter wainscot of raised panels under a chair rail, the upper wall, a crown; walls with thickness), walls
// along a path of floor points with mitred corners, windows and bookcases standing against a wall. Soup geometry:
// position, normal, color(3), colours linear (given sRGB).

import { lin, type Soup } from '../soup';
import { mix, scale, type RGB } from '../palette';
import { rng, type V3 } from '../geom';

/** A floor point or direction: (x, z). */
export type V2 = [number, number];

/** A wall seen from inside the room: its inner face's origin on the floor, `u` along it to the right, `w` into the room;
 *  a point on it at (s along u, h over the origin, d into the room); and its run of s. */
export interface WallFrame { o: V3; u: V3; w: V3; s: [number, number]; at(s: number, h: number, d: number): V3 }

/** The frame at origin `o` (u, w unit and horizontal), its run `s`. */
export function wallFrameAt(o: V3, u: V3, w: V3, s: [number, number]): WallFrame {
  return { o, u, w, s, at: (a, h, d) => [o[0] + u[0] * a + w[0] * d, o[1] + h, o[2] + u[2] * a + w[2] * d] };
}

/** A shell's colours (sRGB): the baseboard, the wainscot and its raised panels, the trims (chair rail, crown), the upper
 *  wall. */
export interface ShellColors { base: RGB; wainscot: RGB; panel: RGB; trim: RGB; wall: RGB }

/** The shell's build: walls `thick` thick; the baseboard `base` tall; the wainscot's top (its chair rail) `wainscot` over
 *  the floor — tuned from the brief's 1.8 to 1.15, inside the frame at every hall (the frame top stands 1.55–1.79 over
 *  the floor at the back wall, yaw 0): at 1.8 the idle camera would see a plain band of wainscot, never the rail nor the
 *  wall over it —; the crown `crown` deep under the top; raised panels `width` wide, `gap` apart, from `bottom` over the floor to
 *  `top` under the rail, standing `raise` off the wainscot with bevels `inset` wide. Under the crown, its relief stands at
 *  most `relief` off the inner face (the baseboard's and the rail's faces; the panels 0.05): what stands against a wall
 *  (a bookcase's back) keeps in front of that, or the trim shows through it. */
export const SHELL = { thick: 0.4, base: 0.35, wainscot: 1.15, crown: 0.42, relief: 0.075,
  panel: { width: 1.5, gap: 0.4, bottom: 0.5, top: 0.16, raise: 0.03, inset: 0.035 } };

/** A shell's cross-section: (d into the room from the inner face, h over the floor) points and each step's colour. */
export interface ShellProfile { pts: [number, number][]; col: (keyof ShellColors | 'cap')[] }

/** The shell's cross-section `H` tall with its chair rail at `W`, from the floor up its inner face, over its top and down
 *  its outer face, `thick` (default SHELL.thick) behind the inner one: (d into the room from the inner face, h over the
 *  floor) and each step's colour. */
export function shellProfile(H: number, W: number, thick: number = SHELL.thick): ShellProfile {
  return {
    pts: [[SHELL.relief, -0.04], [SHELL.relief, 0.29], [0.035, SHELL.base], [0.02, SHELL.base], [0.02, W - 0.09], [SHELL.relief, W - 0.05], [SHELL.relief, W + 0.01],
      [0.03, W + 0.06], [0, W + 0.06], [0, H - SHELL.crown], [0.06, H - SHELL.crown + 0.06], [0.06, H - 0.24], [0.16, H - 0.12], [0.16, H],
      [-thick, H], [-thick, -0.04]],
    col: ['base', 'base', 'base', 'wainscot', 'trim', 'trim', 'trim', 'trim', 'wall', 'trim', 'trim', 'trim', 'trim', 'cap', 'cap'],
  };
}

/** How far the profile stands into the room at most (its crown: 0.16 for shellProfile's). */
export function maxProfileDepth(p: ShellProfile): number {
  return Math.max(...p.pts.map(([d]) => d));
}

/** A shell's colours made linear, with its top's (`cap`: the wall × 0.8). */
export type ShellPalette = Record<keyof ShellColors | 'cap', RGB>;
export function shellPalette(c: ShellColors): ShellPalette {
  return { base: lin(c.base), wainscot: lin(c.wainscot), panel: lin(c.panel), trim: lin(c.trim), wall: lin(c.wall), cap: lin(scale(c.wall, 0.8)) };
}

/** The mitre of a corner between walls with inward normals `a` and `b` (at right angles: a + b); the offset point at d is
 *  P + d · mitre. */
function mitre(a: V2, b: V2): V2 {
  const k = 1 + a[0] * b[0] + a[1] * b[1];
  return [(a[0] + b[0]) / k, (a[1] + b[1]) / k];
}

/**
 * Walls along `path` (floor points, consecutive points share an axis), the room on the side `inward[k]` of segment k;
 * each profile step's inner face offset d into the room, corners mitred (P + d·(n₀ + n₁)). A path whose last point equals
 * its first is closed: that corner is mitred too and `caps` is ignored. An open end is offset along its own segment's
 * normal (square), unless `ends[0]` / `ends[1]` gives the inward normal of the wall it meets there (a neighbouring run
 * built as its own mesh): then it is mitred as that corner of a closed path would be. `caps`: every open end closed by the
 * profile's section — on the mitre plane for an end with a neighbour (it still shows when the neighbour is cut away),
 * square otherwise. Emits per profile step the segments' quads in path order, then the two caps (roomShell's order: the
 * battle pins stay byte-identical; the battle passes no `ends`). The profile's h is over `y0`.
 */
export function wallPath(s: Soup, path: readonly V2[], inward: readonly V2[], y0: number, profile: ShellProfile,
  C: ShellPalette, caps: boolean, ends?: readonly [V2 | null, V2 | null]): void {
  const n = path.length - 1;
  if (n < 1) return;
  const closed = n > 1 && path[0][0] === path[n][0] && path[0][1] === path[n][1];
  // each point's offset direction (× d): a corner's mitre, an open end's own normal or its mitre with the neighbour
  const dir: V2[] = path.map((_, i) => {
    if (i > 0 && i < n) return mitre(inward[i - 1], inward[i]);
    if (closed) return mitre(inward[n - 1], inward[0]);
    const own = i === 0 ? inward[0] : inward[n - 1], e = ends?.[i === 0 ? 0 : 1];
    return e ? mitre(e, own) : own;
  });
  const off = (d: number): V2[] => path.map((p, i) => [p[0] + d * dir[i][0], p[1] + d * dir[i][1]]);
  // the open ends' caps face out of the wall: square, along the segment; mitred, across the mitre plane (own − neighbour)
  const capNormal = (end: 0 | 1): V3 => {
    const e = ends?.[end], own = end === 0 ? inward[0] : inward[n - 1];
    if (e) return [own[0] - e[0], 0, own[1] - e[1]];
    // (a difference, not a negation: no negative zeros in the normals)
    const a = end === 0 ? path[1] : path[n - 1], b = end === 0 ? path[0] : path[n];
    return [b[0] - a[0], 0, b[1] - a[1]];
  };
  const { pts, col } = profile;
  const outer = Math.min(...pts.map(([d]) => d));
  for (let k = 0; k + 1 < pts.length; k++) {
    const [d0, h0] = pts[k], [d1, h1] = pts[k + 1];
    const a = off(d0), b = off(d1), ya = y0 + h0, yb = y0 + h1;
    const l = Math.hypot(h1 - h0, d1 - d0), nd = (h1 - h0) / l, nh = -(d1 - d0) / l;
    for (let j = 0; j < n; j++) {
      const nrm: V3 = [inward[j][0] * nd, nh, inward[j][1] * nd];
      s.quad([a[j][0], ya, a[j][1]], [a[j + 1][0], ya, a[j + 1][1]], [b[j + 1][0], yb, b[j + 1][1]], [b[j][0], yb, b[j][1]], nrm, C[col[k]]);
    }
    // the open ends: the section between the outer face and the profile
    if (caps && !closed && h1 > h0 && !(d0 === outer && d1 === outer)) {
      const o = off(outer);
      for (const [end, i] of [[0, 0], [1, n]] as const) {
        s.quad([o[i][0], ya, o[i][1]], [a[i][0], ya, a[i][1]], [b[i][0], yb, b[i][1]], [o[i][0], yb, o[i][1]], capNormal(end), C[col[k]]);
      }
    }
  }
}

// ------------------------------------------------------------------------------------------------- windows

/** A window's size: `width` × `height`, its sill `sill` over the floor, its casing `frame` wide standing `depth` off the
 *  wall, its mullions `mullion` wide. */
export interface WindowSize { width: number; height: number; sill: number; frame: number; depth: number; mullion: number }

/** The battle's windows (the building hall's): the sill just over the chair rail. */
export const WINDOW: WindowSize = { width: 2.3, height: 2.6, sill: SHELL.wainscot + 0.14, frame: 0.12, depth: 0.08, mullion: 0.07 };

/** A window on a wall at s = `at`: its casing (trim colour) standing off the wall, a sill, a cross of mullions; the glass
 *  behind them (light sky blue, paler to the top: daylight outside), in `glass`. Sized by `size` (default WINDOW). */
export function addWindow(body: Soup, glass: Soup, F: WallFrame, at: number, trim: RGB, size: WindowSize = WINDOW): void {
  const W = size, x0 = at - W.width / 2, x1 = at + W.width / 2, y0 = W.sill, y1 = W.sill + W.height, f = W.frame;
  const t = lin(trim), o = F.o;
  const box = (s0: number, s1: number, h0: number, h1: number, d0: number, d1: number, c: RGB) => body.box(o, F.u, F.w, s0, s1, h0, h1, d0, d1, c, true);
  box(x0 - f, x0, y0, y1, 0, W.depth, t);
  box(x1, x1 + f, y0, y1, 0, W.depth, t);
  box(x0 - f, x1 + f, y1, y1 + f, 0, W.depth, t);
  // the sill: deeper, a little wider
  box(x0 - f - 0.08, x1 + f + 0.08, y0 - 0.08, y0, 0, W.depth + 0.1, scale(t, 0.97));
  // mullions: one upright, one across at 0.6 of the height
  const m = W.mullion / 2, mh = y0 + W.height * 0.6;
  box(at - m, at + m, y0, y1, 0.01, W.depth * 0.7, t);
  box(x0, x1, mh - m, mh + m, 0.01, W.depth * 0.7, t);
  // the glass: two rows of panes, a gradient up
  const lo = lin([0.6, 0.78, 0.92]), hi = lin([0.86, 0.94, 1.0]);
  const g = (h: number) => mix(lo, hi, (h - y0) / W.height);
  glass.quadN(F.at(x0, y0, 0.012), F.at(x1, y0, 0.012), F.at(x1, y1, 0.012), F.at(x0, y1, 0.012), F.w, [F.w, F.w, F.w, F.w],
    [g(y0), g(y0), g(y1), g(y1)]);
}

// ------------------------------------------------------------------------------------------------- bookcases

/** A bookcase against a wall: its carcass (sides, top, back, a plinth, three shelves) in `wood`, books of many colours,
 *  widths, heights and depths on its four shelves (seeded), a few gaps between them. Its back panel, shelves, plinth and
 *  books stand `back` off the wall — in front of the wall's relief (SHELL.relief: the rail and the baseboard, the raised
 *  panels; at 0.035 the rail's white stripe crossed the middle shelf and panel edges showed between the books) — `depth`
 *  its front; its sides and top run back to the wall (the relief ends inside them). The battle's size. */
export const SHELF = { width: 2.5, height: 2.5, back: SHELL.relief + 0.015, depth: 0.58, board: 0.05, plinth: 0.14 };
/** The books' colours (sRGB). */
export const BOOKS: RGB[] = [[0.78, 0.33, 0.28], [0.3, 0.47, 0.72], [0.38, 0.6, 0.42], [0.9, 0.76, 0.36], [0.62, 0.44, 0.3], [0.92, 0.9, 0.84],
  [0.55, 0.38, 0.62], [0.28, 0.62, 0.66]];

/** A bookcase (SHELF) centred at s = `at` on the wall `F`, `width` wide and `height` tall (defaults SHELF's), its front
 *  `depth` (default SHELF.depth) off the wall: the books' depth range scales with it. */
export function addShelf(body: Soup, F: WallFrame, at: number, wood: RGB, seed: number, width: number = SHELF.width,
  height: number = SHELF.height, depth: number = SHELF.depth): void {
  const S = SHELF, x0 = at - width / 2, x1 = at + width / 2, o = F.o, w = lin(wood), inner = lin(scale(wood, 0.72));
  const box = (s0: number, s1: number, h0: number, h1: number, d0: number, d1: number, c: RGB) => body.box(o, F.u, F.w, s0, s1, h0, h1, d0, d1, c);
  box(x0, x0 + S.board, 0, height, 0.01, depth, w);
  box(x1 - S.board, x1, 0, height, 0.01, depth, w);
  box(x0, x1, height - S.board, height, 0.01, depth, w);
  box(x0 + S.board, x1 - S.board, 0, S.plinth, S.back, depth - 0.02, scale(w, 0.85));
  // the back panel (in front of the wall's relief)
  body.quad(F.at(x0 + S.board, S.plinth, S.back), F.at(x1 - S.board, S.plinth, S.back), F.at(x1 - S.board, height - S.board, S.back),
    F.at(x0 + S.board, height - S.board, S.back), F.w, inner);
  const shelfH = (height - S.plinth - S.board) / 4;
  const r = rng(seed * 7121 + 0x5be1);
  for (let i = 0; i < 4; i++) {
    const y = S.plinth + i * shelfH;
    if (i > 0) box(x0 + S.board, x1 - S.board, y - S.board / 2, y + S.board / 2, S.back, depth, w);
    // books along the shelf, left to right
    let x = x0 + S.board + 0.03;
    while (x < x1 - S.board - 0.1) {
      const bw = 0.07 + 0.08 * r();
      if (r() < 0.08) { x += 0.15 + 0.2 * r(); continue; }
      const bh = shelfH * (0.62 + 0.28 * r()), bd = (depth - S.back) * (0.62 + 0.25 * r());
      const c = lin(scale(BOOKS[Math.floor(r() * BOOKS.length)], 0.9 + 0.15 * r()));
      if (x + bw > x1 - S.board - 0.02) break;
      box(x, x + bw, y + S.board / 2, y + S.board / 2 + bh, S.back + 0.01, S.back + 0.01 + bd, c);
      x += bw + 0.008;
    }
  }
}
