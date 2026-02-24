/**
 * Safely parse a JSON string, returning null on failure.
 */
export function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
