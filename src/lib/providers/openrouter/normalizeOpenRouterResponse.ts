import type { OpenRouterAnnotation, OpenRouterResponseLike, OpenRouterUrlCitation } from "./openRouterClient";
import { trustsOffsets, type OpenRouterFamily } from "./citationTrust";

export interface NormalizedOpenRouterCitation {
  url: string;
  title: string | null;
  content: string | null;
  startIndex: number | null;
  endIndex: number | null;
}

export interface NormalizedOpenRouterResult {
  requestedModel: string;
  returnedModel: string | null;
  requestId: string | null;
  answerText: string;
  citations: NormalizedOpenRouterCitation[];
  usage: OpenRouterResponseLike["usage"] | null;
  raw: OpenRouterResponseLike;
}

/** Maps an OpenRouter model slug's vendor prefix to a logical family so the
 * shared citation-trust rules can be applied. Falls back to treating an
 * unrecognized prefix as untrustworthy for offsets (the safe default). */
function familyFromModelSlug(model: string): OpenRouterFamily | null {
  const prefix = model.split("/")[0];
  if (prefix === "openai") return "openai";
  if (prefix === "google") return "gemini";
  if (prefix === "anthropic") return "claude";
  if (prefix === "perplexity") return "perplexity";
  return null;
}

/**
 * Extracts only structured fields from an OpenRouter chat-completions
 * response - never scrapes URLs out of the answer text itself. Citations
 * come exclusively from `message.annotations[type === "url_citation"]`,
 * which OpenRouter standardizes across every native search provider.
 *
 * `start_index`/`end_index` are only trusted for families confirmed (via
 * live smoke test) to return genuine character offsets - Claude and
 * Perplexity both literally send `0`/`0` for every citation regardless of
 * true position, so those values are discarded here rather than stored as
 * false precision. See `citationTrust.ts`.
 */
export function normalizeOpenRouterResponse(
  requestedModel: string,
  raw: OpenRouterResponseLike
): NormalizedOpenRouterResult {
  const message = raw.choices?.[0]?.message;
  const annotations = message?.annotations ?? [];
  const family = familyFromModelSlug(requestedModel);
  const trustOffsets = family !== null && trustsOffsets(family);

  function hasUrlCitation(
    annotation: OpenRouterAnnotation
  ): annotation is OpenRouterAnnotation & { url_citation: OpenRouterUrlCitation } {
    return annotation.type === "url_citation" && Boolean(annotation.url_citation);
  }

  const citations: NormalizedOpenRouterCitation[] = annotations
    .filter(hasUrlCitation)
    .map((a) => ({
      url: a.url_citation.url,
      title: a.url_citation.title ?? null,
      content: a.url_citation.content ?? null,
      startIndex: trustOffsets ? a.url_citation.start_index ?? null : null,
      endIndex: trustOffsets ? a.url_citation.end_index ?? null : null,
    }));

  return {
    requestedModel,
    returnedModel: raw.model ?? null,
    requestId: raw.id ?? null,
    answerText: message?.content ?? "",
    citations,
    usage: raw.usage ?? null,
    raw,
  };
}

