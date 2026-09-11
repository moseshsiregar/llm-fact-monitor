/**
 * Per-family citation trust policy for OpenRouter-backed providers.
 *
 * OpenRouter standardizes every native-search provider's citations into the
 * same `message.annotations[type==="url_citation"]` shape, but the FIELDS
 * inside that shape do not mean the same thing for every provider - this
 * was confirmed empirically via one live smoke test per family (see
 * `/memories/repo/llm-fact-monitor.md`, "OpenRouter access-layer
 * exploration"):
 *
 *  - OpenAI:      real character offsets, real direct URLs.
 *  - Gemini:      real character offsets, but the URL is an opaque Google
 *                 grounding REDIRECT link, not the original publisher URL.
 *  - Claude:      real direct URLs + quoted excerpt text, but
 *                 start_index/end_index are ALWAYS 0 (not genuine offsets).
 *  - Perplexity:  real direct URLs, response-level only (no claim mapping),
 *                 start_index/end_index are ALWAYS 0.
 *
 * Rather than trusting whatever value the API happens to send, we apply a
 * static per-family policy so we never store a fabricated `0` offset or an
 * over-claimed CLAIM_LEVEL attribution.
 */
export type OpenRouterFamily = "openai" | "gemini" | "claude" | "perplexity";

/** Families whose reported start_index/end_index are genuine character
 * offsets into the answer text. All other families' offsets must be
 * treated as absent (null), never a fabricated `0`. */
const FAMILIES_WITH_REAL_OFFSETS = new Set<OpenRouterFamily>(["openai", "gemini"]);

/** Families whose citations are structurally tied to a specific piece of
 * answer text (CLAIM_LEVEL), as opposed to only the response as a whole
 * (RESPONSE_LEVEL). Claude qualifies via its quoted excerpt text even
 * though it doesn't expose character offsets. Perplexity does not qualify -
 * it only ever supplies response-level sources. */
const CLAIM_LEVEL_FAMILIES = new Set<OpenRouterFamily>(["openai", "gemini", "claude"]);

/** Only Gemini's URL is a redirect indirection rather than the original
 * publisher URL. */
const REDIRECT_URL_FAMILIES = new Set<OpenRouterFamily>(["gemini"]);

export function trustsOffsets(family: OpenRouterFamily): boolean {
  return FAMILIES_WITH_REAL_OFFSETS.has(family);
}

export function isClaimLevel(family: OpenRouterFamily): boolean {
  return CLAIM_LEVEL_FAMILIES.has(family);
}

export function hasRedirectUrl(family: OpenRouterFamily): boolean {
  return REDIRECT_URL_FAMILIES.has(family);
}
