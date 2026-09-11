import type { NormalizedCitation, ProviderResponse, ProviderUsage } from "../types";

/**
 * Minimal shape of an OpenAI Responses API result that this normalizer
 * reads. Deliberately narrower than the full `OpenAI.Responses.Response`
 * SDK type so this file can be unit-tested against small literal fixtures
 * (Section 25) without constructing every required SDK field. Any real
 * `client.responses.create()` result structurally satisfies this type.
 */
export interface OpenAIResponseLike {
  id: string;
  model: string;
  output_text?: string;
  output?: Array<{
    type: string;
    // ResponseOutputMessage
    content?: Array<{
      type: string;
      text?: string;
      annotations?: Array<{
        type: string;
        url?: string;
        title?: string;
        start_index?: number;
        end_index?: number;
      }>;
    }>;
    // ResponseFunctionWebSearch
    action?: {
      type: string;
      query?: string;
      queries?: string[];
      sources?: Array<{ url?: string }>;
    };
  }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

export interface NormalizedOpenAIResult {
  answerText: string;
  citations: NormalizedCitation[];
  searchQueries: string[];
  webSearchEnabled: boolean;
  providerRequestId: string;
  usage?: ProviderUsage;
}

/**
 * Normalizes a raw OpenAI Responses API result into the application's
 * generic provider representation. Only reads structured fields the SDK
 * actually exposes (URL citation annotations, web_search_call actions) -
 * never scrapes URLs out of the prose text.
 */
export function normalizeOpenAIResponse(raw: OpenAIResponseLike): NormalizedOpenAIResult {
  const answerText = raw.output_text ?? extractTextFromOutput(raw);

  const citations: NormalizedCitation[] = [];
  const searchQueries: string[] = [];
  let webSearchEnabled = false;

  for (const item of raw.output ?? []) {
    if (item.type === "web_search_call") {
      webSearchEnabled = true;
      const action = item.action;
      if (action?.queries) searchQueries.push(...action.queries);
      else if (action?.query) searchQueries.push(action.query);
    }

    if (item.type === "message" && item.content) {
      for (const part of item.content) {
        if (part.type !== "output_text" || !part.annotations) continue;
        for (const annotation of part.annotations) {
          if (annotation.type !== "url_citation" || !annotation.url) continue;
          citations.push({
            url: annotation.url,
            title: annotation.title,
            spanKind: "CLAIM_LEVEL",
            startIndex: annotation.start_index,
            endIndex: annotation.end_index,
            citedText:
              annotation.start_index != null && annotation.end_index != null
                ? answerText.slice(annotation.start_index, annotation.end_index)
                : undefined,
          });
        }
      }
    }
  }

  const usage: ProviderUsage | undefined = raw.usage
    ? {
        inputTokens: raw.usage.input_tokens,
        outputTokens: raw.usage.output_tokens,
        totalTokens: raw.usage.total_tokens,
        searchRequests: raw.output?.filter((i) => i.type === "web_search_call").length || undefined,
      }
    : undefined;

  return {
    answerText,
    citations,
    searchQueries,
    webSearchEnabled,
    providerRequestId: raw.id,
    usage,
  };
}

function extractTextFromOutput(raw: OpenAIResponseLike): string {
  const texts: string[] = [];
  for (const item of raw.output ?? []) {
    if (item.type !== "message" || !item.content) continue;
    for (const part of item.content) {
      if (part.type === "output_text" && part.text) texts.push(part.text);
    }
  }
  return texts.join(" ");
}

/** Builds the full normalized `ProviderResponse` for the runner. Kept
 * separate from `normalizeOpenAIResponse` so the pure-parsing logic above
 * stays trivially unit-testable without constructing a full ProviderResponse. */
export function toProviderResponse(
  raw: OpenAIResponseLike,
  providerKey: string,
  model: string
): ProviderResponse {
  const normalized = normalizeOpenAIResponse(raw);
  return {
    providerKey,
    model: raw.model || model,
    surface: normalized.webSearchEnabled ? "API_WEB_SEARCH" : "API_NO_WEB_SEARCH",
    webSearchEnabled: normalized.webSearchEnabled,
    providerApi: "openai:responses.web_search",
    answerText: normalized.answerText,
    citations: normalized.citations,
    searchQueries: normalized.searchQueries.length ? normalized.searchQueries : undefined,
    providerRequestId: normalized.providerRequestId,
    usage: normalized.usage,
    timestamp: new Date(),
    rawResponse: raw,
  };
}
