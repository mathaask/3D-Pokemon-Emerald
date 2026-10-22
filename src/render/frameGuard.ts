// Error isolation for the frame loop: an exception in per-frame render code must not stop emulation for good
// (spec §11: V, the classic 2D view, remains the universal fallback).

/**
 * A guard for per-frame code: `guard(fn)` runs `fn` and returns whether it completed; an exception in it is caught
 * (the caller's loop goes on) and the first one is handed to `report` — once per guard, later ones are dropped (a
 * frame that fails once usually fails every frame).
 */
export function frameGuard(report: (e: unknown) => void): (fn: () => void) => boolean {
  let reported = false;
  return (fn) => {
    try {
      fn();
      return true;
    } catch (e) {
      if (!reported) {
        reported = true;
        report(e);
      }
      return false;
    }
  };
}
