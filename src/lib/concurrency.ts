/**
 * Minimal bounded-concurrency map helper - no external dependency needed
 * for the small worker counts used here (Phase 8 Section 9: 2-4 concurrent
 * semantic verifier calls, matching the existing provider-retrieval
 * concurrency pattern via `MAX_CONCURRENT_EXPERIMENT_RUNS`).
 *
 * Runs `fn` over every item in `items`, never more than `concurrency` calls
 * in flight at once, preserving each result at its original index.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const boundedConcurrency = Math.max(1, Math.min(concurrency, items.length || 1));
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: boundedConcurrency }, () => worker()));
  return results;
}
