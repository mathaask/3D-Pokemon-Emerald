// Which parts of each grid cell are rendered by kit models (and so skipped by the legacy
// quad emitter), plus per-cell ground overrides for cells whose object a family replaced.

export const CLAIM_SURFACE = 1; // the cell's walkable / ground / water surface
export const CLAIM_OBJECT = 2; // the structure standing on the cell (tree, building, block run)
export const CLAIM_TOP = 4; // the cell's top-layer overhang card (crowns / eaves north of objects)
/** The decoration drawn on the cell's ground (3D flowers replace a flower bed): the terrain still
 *  draws the ground under it. (Legacy reads it nowhere; without it the terrain leaves ground art it
 *  cannot paint to the legacy art.) */
export const CLAIM_DECOR = 8;
/** 3D grass blades stand on the cell: they hide the legs of the characters walking in it, so the view
 *  hides the GBA's grass overlay sprite there (and only there). Read only by the view. */
export const CLAIM_BLADES = 16;
/** The kit's water surface runs on under the cell's art, which the legacy emitter still draws (a
 *  boat, a bridge's or cycling road's edge, a rock standing in the sea): without its water-coloured
 *  pixels (Variant.Dry), its floor just above the water's swell, and no pixel water under a block. */
export const CLAIM_WATER_UNDER = 32;

export interface ClaimsSnapshot {
  bits: Uint8Array;
  groundY: Float32Array;
  groundMt: Int16Array;
  surfaceY: Float32Array;
}

export class Claims {
  readonly bits: Uint8Array;
  /** Ground height under a claimed object (NaN = analysis groundH). */
  readonly groundY: Float32Array;
  /** Metatile whose look the ground under a claimed object takes (-1 = analysis groundOf). */
  readonly groundMt: Int16Array;
  /** Height of the walkable surface a family draws on a cell it claimed CLAIM_SURFACE (NaN = the
   *  analysis height): the characters walking on the cell stand on it (World.heightAt). Like the
   *  other overrides it only counts while its claim does (a family whose build fails loses it). */
  readonly surfaceY: Float32Array;

  constructor(n: number) {
    this.bits = new Uint8Array(n);
    this.groundY = new Float32Array(n).fill(NaN);
    this.groundMt = new Int16Array(n).fill(-1);
    this.surfaceY = new Float32Array(n).fill(NaN);
  }

  has(i: number, bit: number): boolean {
    return (this.bits[i] & bit) !== 0;
  }

  claim(i: number, bit: number): void {
    this.bits[i] |= bit;
  }

  snapshot(): ClaimsSnapshot {
    return { bits: this.bits.slice(), groundY: this.groundY.slice(), groundMt: this.groundMt.slice(), surfaceY: this.surfaceY.slice() };
  }

  restore(s: ClaimsSnapshot): void {
    this.bits.set(s.bits);
    this.groundY.set(s.groundY);
    this.groundMt.set(s.groundMt);
    this.surfaceY.set(s.surfaceY);
  }
}
