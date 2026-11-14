import type { TerrainStatus } from './types';

/** Keep a timed-out scene retryable until actual visible terrain becomes ready. */
export function createStartupDeadline(onTimeout: () => void, delay = 30_000) {
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    onTimeout();
  }, delay);

  return {
    allows(state: TerrainStatus['state']) {
      if (state === 'ready') {
        clearTimeout(timer);
        expired = false;
      }
      return !(expired && state === 'loading');
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}
