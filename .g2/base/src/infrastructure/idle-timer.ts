/**
 * Creates a resettable idle timer. Calls `onIdle` after `timeoutMs`
 * of inactivity (no `reset()` calls).
 */
export function createIdleTimer(
  onIdle: () => void,
  timeoutMs: number,
): { reset: () => void; clear: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  return {
    reset() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onIdle, timeoutMs);
    },
    clear() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
