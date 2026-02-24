import { logger } from './Logger.js';

/**
 * Start a polling loop that runs `fn` every `intervalMs` milliseconds.
 * Handles errors internally (logs and continues).
 * Returns a handle to stop the loop.
 */
export function startPollLoop(
  name: string,
  intervalMs: number,
  fn: () => Promise<void>,
): { stop: () => void } {
  let stopped = false;

  const loop = async () => {
    if (stopped) return;
    try {
      await fn();
    } catch (err) {
      logger.error({ err }, `Error in ${name} loop`);
    }
    if (!stopped) {
      setTimeout(loop, intervalMs);
    }
  };

  loop();
  logger.info({ intervalMs }, `${name} loop started`);

  return {
    stop() {
      stopped = true;
    },
  };
}
