/**
 * Runs one job at a time per key and hands every caller that arrives while it
 * is running the same promise. Used so that two page loads on an empty cache
 * share one build (and one paid Jev pass) instead of each starting their own.
 * A caller with a different key starts its own job, so a stale key never
 * receives a result that was built for another.
 */
export function createSingleFlight<T>(): (key: string, start: () => Promise<T>) => Promise<T> {
  let current: { key: string; promise: Promise<T> } | null = null;
  return (key, start) => {
    if (current && current.key === key) return current.promise;
    const entry = { key, promise: undefined as unknown as Promise<T> };
    entry.promise = start().finally(() => {
      if (current === entry) current = null;
    });
    current = entry;
    return entry.promise;
  };
}
