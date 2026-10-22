// Error isolation for the frame loop: an exception in per-frame render code must not stop emulation for good
// (spec §11: V, the classic 2D view, remains the universal fallback).

/** At most this many distinct failures are reported per guard (a broken frame fails the same way every frame). */
const MAX_REPORTS = 8;

/**
 * A guard for per-frame code: `guard(fn)` runs `fn` and returns whether it completed; an exception in it is caught
 * (the caller's loop goes on) and handed to `report` once per distinct message — a frame that fails once usually
 * fails every frame the same way, while a different, later failure (e.g. in a battle) is still reported — up to
 * MAX_REPORTS distinct failures.
 */
export function frameGuard(report: (e: unknown) => void): (fn: () => void) => boolean {
  const seen = new Set<string>();
  return (fn) => {
    try {
      fn();
      return true;
    } catch (e) {
      const key = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      if (seen.size < MAX_REPORTS && !seen.has(key)) {
        seen.add(key);
        report(e);
      }
      return false;
    }
  };
}
