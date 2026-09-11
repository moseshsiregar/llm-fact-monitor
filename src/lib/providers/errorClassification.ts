import type { ProviderErrorCategoryValue } from "./types";
import { ProviderCallError } from "./types";

/** Maps a generic HTTP status code to a broad error category + whether a
 * bounded automatic retry (Section 15) is appropriate. Shared across
 * provider adapters since most REST/SDK errors surface an HTTP status. */
export function classifyByStatus(
  status: number | null | undefined
): { category: ProviderErrorCategoryValue; retryable: boolean } {
  if (status === 401 || status === 403) return { category: "AUTHENTICATION", retryable: false };
  if (status === 429) return { category: "RATE_LIMIT", retryable: true };
  if (status === 408) return { category: "TIMEOUT", retryable: true };
  if (typeof status === "number" && status >= 500) return { category: "PROVIDER_OUTAGE", retryable: true };
  return { category: "UNKNOWN", retryable: false };
}

/** Ensures any error thrown from within an adapter's `runPrompt` is a
 * `ProviderCallError` so the orchestrator always has a category to record. */
export function wrapUnknownError(error: unknown, fallbackMessage: string): ProviderCallError {
  if (error instanceof ProviderCallError) return error;
  const message = error instanceof Error ? error.message : fallbackMessage;
  return new ProviderCallError(message, { category: "UNKNOWN", retryable: false, cause: error });
}
