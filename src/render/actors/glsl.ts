// Helpers for the actors' shader code: GLSL number literals and patches of three's shader chunks.

/** A GLSL float literal of `v` at full precision (an integer gets its ".0"). */
export function glslFloat(v: number): string {
  return Number.isInteger(v) ? v.toFixed(1) : String(v);
}

/** Replaces three's `#include <chunk>` in `src` with `by`; throws if three renamed the chunk (the patch would silently
 *  do nothing). */
export function patchChunk(src: string, chunk: string, by: string): string {
  const include = `#include <${chunk}>`;
  if (!src.includes(include)) throw new Error(`three shader chunk <${chunk}> not found`);
  return src.replace(include, by);
}

/** `#include <chunk>` followed by `code` (patchChunk, keeping the chunk). */
export function afterChunk(src: string, chunk: string, code: string): string {
  return patchChunk(src, chunk, `#include <${chunk}>\n${code}`);
}
