/**
 * Phase 8 — error classification for the semantic verifier's own API calls.
 *
 * Deliberately a SEPARATE helper from `src/lib/providers/errorClassification.ts`
 * (the retrieval-side equivalent), matching `openRouterJudgeClient.ts`'s own
 * stated architectural-separation rationale: verification must never share
 * code paths with retrieval, even for something as generic as HTTP status
 * classification, so the two layers can evolve independently and neither
 * can be accidentally entangled with the other.
 *
 * A technical verifier failure (timeout, rate limit, outage, malformed
 * response, network error, auth problem) must NEVER be recorded as a
 * substantive NOT_FOUND - see `VerifierCallError`'s consumers in
 * `openRouterFactVerifier.ts`.
 */

export type VerifierErrorCategoryValue =
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "PROVIDER_OUTAGE"
  | "MALFORMED_RESPONSE"
  | "NETWORK"
  | "UNKNOWN";

export class VerifierCallError extends Error {
  readonly category: VerifierErrorCategoryValue;
  /** Whether this specific failure is safe to retry automatically (Phase 8
   * Section 7) - only for transient issues (timeout/rate-limit/5xx/network). */
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    message: string,
    options: {
      category: VerifierErrorCategoryValue;
      retryable?: boolean;
      status?: number;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = "VerifierCallError";
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    this.status = options.status;
  }
}

/** Maps a generic HTTP status code to a broad error category + whether a
 * bounded automatic retry is appropriate. */
export function classifyVerifierStatus(
  status: number | null | undefined
): { category: VerifierErrorCategoryValue; retryable: boolean } {
  if (status === 401 || status === 403) return { category: "AUTHENTICATION", retryable: false };
  if (status === 429) return { category: "RATE_LIMIT", retryable: true };
  if (status === 408) return { category: "TIMEOUT", retryable: true };
  if (typeof status === "number" && status >= 500) return { category: "PROVIDER_OUTAGE", retryable: true };
  return { category: "UNKNOWN", retryable: false };
}
