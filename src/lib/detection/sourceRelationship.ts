export type SourceRelationshipValue =
  | "ORIGINAL_SOURCE"
  | "DOWNSTREAM_OR_DIFFERENT_SOURCE"
  | "UNKNOWN_SOURCE"
  | "NOT_APPLICABLE";

/** Strips a leading "www." so "www.example.org" and "example.org" compare
 * as the same domain. */
function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

/**
 * Compares a SINGLE, specific citation's domain against a fact's registered
 * original-source domain. Use this only when the citation is genuinely known
 * to support that specific fact (i.e. CLAIM_LEVEL attribution) - never call
 * it with a citation picked arbitrarily from a response-level list.
 */
export function classifySourceRelationship(
  citationDomain: string | null | undefined,
  originalSourceDomain: string
): SourceRelationshipValue {
  if (!citationDomain) return "UNKNOWN_SOURCE";
  return normalizeDomain(citationDomain) === normalizeDomain(originalSourceDomain)
    ? "ORIGINAL_SOURCE"
    : "DOWNSTREAM_OR_DIFFERENT_SOURCE";
}

/**
 * Response-level source relationship (Section 8/10): most provider APIs
 * (including all mocks here) only return citations for the answer as a
 * whole, not per-claim. So instead of guessing which single citation
 * "supports" a detected fact, we can only honestly say: among the sources
 * cited anywhere in this response, was the fact's original source one of
 * them? This does not claim causal/claim-level attribution.
 */
export function classifySourceRelationshipFromDomains(
  responseCitationDomains: string[],
  originalSourceDomain: string
): SourceRelationshipValue {
  if (responseCitationDomains.length === 0) return "UNKNOWN_SOURCE";
  const normalizedOriginal = normalizeDomain(originalSourceDomain);
  const matchesOriginal = responseCitationDomains.some(
    (d) => normalizeDomain(d) === normalizedOriginal
  );
  return matchesOriginal ? "ORIGINAL_SOURCE" : "DOWNSTREAM_OR_DIFFERENT_SOURCE";
}

/** Extracts a lowercase registrable-ish domain from a URL string. Falls
 * back to returning the trimmed input if URL parsing fails. */
export function extractDomain(url: string): string {
  try {
    const { hostname } = new URL(url);
    return normalizeDomain(hostname);
  } catch {
    return normalizeDomain(url);
  }
}
