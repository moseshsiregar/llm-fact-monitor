import type { OpenRouterAnnotation, OpenRouterResponseLike, OpenRouterUrlCitation } from "./openRouterClient";
import type { NormalizedCitation, ProviderResponse, SearchMechanismValue } from "../types";
import { hasRedirectUrl, isClaimLevel, trustsOffsets, type OpenRouterFamily } from "./citationTrust";

function hasUrlCitation(
  annotation: OpenRouterAnnotation
): annotation is OpenRouterAnnotation & { url_citation: OpenRouterUrlCitation } {
  return annotation.type === "url_citation" && Boolean(annotation.url_citation);
}

/**
 * Normalizes a raw OpenRouter chat-completions response into the shared
 * `ProviderResponse` shape used by every adapter (mock or real). Only
 * structured fields are read - citations always come from
 * `message.annotations[type==="url_citation"]`, never scraped from prose.
 *
 * Every provider-specific honesty rule (offsets, span kind, redirect URLs)
 * is applied per logical family via `citationTrust.ts` - see that module
 * for the empirical basis of each rule.
 */
export function toOpenRouterProviderResponse(params: {
  raw: OpenRouterResponseLike;
  requestedModel: string;
  providerKey: OpenRouterFamily;
  searchMechanism: SearchMechanismValue;
}): ProviderResponse {
  const { raw, requestedModel, providerKey, searchMechanism } = params;
  const message = raw.choices?.[0]?.message;
  const annotations = message?.annotations ?? [];

  const trustOffsets = trustsOffsets(providerKey);
  const claimLevel = isClaimLevel(providerKey);
  const redirectUrl = hasRedirectUrl(providerKey);

  const citations: NormalizedCitation[] = annotations.filter(hasUrlCitation).map((a) => {
    const uc = a.url_citation;
    const citation: NormalizedCitation = {
      url: uc.url,
      title: uc.title ?? undefined,
      spanKind: claimLevel ? "CLAIM_LEVEL" : "RESPONSE_LEVEL",
      citedText: uc.content ?? undefined,
    };
    if (trustOffsets) {
      citation.startIndex = uc.start_index;
      citation.endIndex = uc.end_index;
    }
    if (redirectUrl) {
      citation.rawUrl = uc.url;
      citation.resolvedUrl = undefined;
    }
    return citation;
  });

  return {
    providerKey,
    model: requestedModel,
    returnedModel: raw.model ?? undefined,
    upstreamProvider: raw.provider ?? undefined,
    surface: "OPENROUTER_API_NATIVE_SEARCH",
    accessLayer: "OPENROUTER",
    searchMechanism,
    webSearchEnabled: true,
    providerApi: `openrouter:chat.completions:${requestedModel}`,
    answerText: message?.content ?? "",
    citations,
    // OpenRouter does not expose the provider's internally-generated search
    // query text for any family - never inferred/fabricated here.
    searchQueries: undefined,
    providerRequestId: raw.id ?? undefined,
    usage: raw.usage
      ? {
          inputTokens: raw.usage.prompt_tokens,
          outputTokens: raw.usage.completion_tokens,
          totalTokens: raw.usage.total_tokens,
          searchRequests: raw.usage.server_tool_use_details?.web_search_requests,
          cost: raw.usage.cost,
        }
      : undefined,
    timestamp: new Date(),
    rawResponse: raw,
  };
}
