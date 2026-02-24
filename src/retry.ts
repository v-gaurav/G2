import { logger } from './logger.js';

export interface RetryOptions {
  maxRetries?: number;
  delay?: number;
  backoff?: number;
}

/**
 * Retry an async function with exponential backoff.
 * Defaults: 3 retries, 1s initial delay, 2x backoff.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const maxRetries = opts?.maxRetries ?? 3;
  const delay = opts?.delay ?? 1000;
  const backoff = opts?.backoff ?? 2;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        const waitMs = delay * Math.pow(backoff, attempt);
        logger.warn(
          { attempt: attempt + 1, maxRetries, waitMs, err },
          'Retry attempt failed, waiting before next try',
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  throw lastError;
}
