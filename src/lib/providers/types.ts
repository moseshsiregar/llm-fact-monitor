/**
 * Provider abstraction (Section 11 of the research design).
 *
 * Every LLM integration - mock or real - implements `LLMProviderAdapter`.
 * The rest of the application (experiment runner, dashboard, history) only
 * ever talks to this interface and the normalized types below, so
 * provider-specific response parsing never leaks outside
 * `src/lib/providers/<provider>/`.
 */

/** Whether a Citation is tied to a specific span of the answer text (the
 * provider structurally associates this source with that exact text) or
 * only to the response as a whole. Mirrors `CitationSpanKind` in the Prisma
 * schema. */
export type CitationSpanKindValue = "CLAIM_LEVEL" | "RESPONSE_LEVEL";

/** A single citation/source as independently surfaced by the provider's own
 * web-search/retrieval system. We never tell the provider which URLs to use,
 * and we never fabricate a span/attribution the provider didn't give us. */
export interface NormalizedCitation {
  url: string;
  title?: string;
  /** CLAIM_LEVEL only when the provider structurally ties this citation to
   * a specific piece of answer text (e.g. inline annotation spans).
   * Otherwise RESPONSE_LEVEL - the honest default. */
  spanKind: CitationSpanKindValue;
  /** Character offsets into `answerText` this citation covers, only when
   * `spanKind === "CLAIM_LEVEL"` and the provider exposes them. Must stay
   * absent (never `0`) when the provider doesn't genuinely expose offsets -
   * zero is a valid character position and would imply false precision. */
  startIndex?: number;
  endIndex?: number;
  /** The exact excerpt of answer text the provider associates with this
   * citation, when exposed. */
  citedText?: string;
  /** The literal URL the provider returned, before any resolution attempt.
   * Only meaningfully different from `url` for providers whose "URL" is an
   * indirection layer (e.g. Google/Gemini grounding redirect links). */
  rawUrl?: string;
  /** The original publisher URL after safely resolving a redirect-style
   * `rawUrl`, when attempted. Currently never populated. */
  resolvedUrl?: string;
}

/** Token/search usage as reported by the provider. Every field is optional -
 * missing metadata must remain absent, never estimated or fabricated. */
export interface ProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Number of server-side search requests the provider reports performing
   * for this call, if exposed. */
  searchRequests?: number;
  /** Provider-reported cost for this call, ONLY when directly supplied. */
  cost?: number;
}

/** Which execution surface produced a response. API-grounded responses are
 * not necessarily identical to a provider's consumer website/app, so this is
 * recorded explicitly rather than assumed. Mirrors `ExecutionSurface` in the
 * Prisma schema. */
export type ExecutionSurfaceValue =
  | "API_WEB_SEARCH"
  | "API_NO_WEB_SEARCH"
  | "OPENROUTER_API_NATIVE_SEARCH"
  | "MOCK_SIMULATION";

/** How this run reached the underlying model. Mirrors `AccessLayer` in the
 * Prisma schema. */
export type AccessLayerValue = "OPENROUTER" | "DIRECT_SDK" | "NONE";

/** How the provider's native web search was actually invoked. Both non-NONE
 * values represent a genuine provider-native web-search observation, never
 * a third-party/fallback search engine. Mirrors `SearchMechanism` in the
 * Prisma schema. */
export type SearchMechanismValue =
  | "OPENROUTER_NATIVE_WEB_PLUGIN"
  | "PROVIDER_INHERENT_WEB_SEARCH"
  | "NONE";

/** The normalized result of asking a provider a single prompt once. Rich
 * enough to power both the UI and long-term research reproducibility, but
 * every optional field must stay absent (not fabricated) when a provider's
 * API doesn't expose it. */
export interface ProviderResponse {
  /** Key of the adapter that produced this response, e.g. "openai". */
  providerKey: string;
  /** Exact model identifier as reported by/sent to the provider (the
   * requested model - e.g. an OpenRouter model slug). */
  model: string;
  /** Model identifier the access layer reported actually serving the
   * request, when it may differ from the requested `model`. */
  returnedModel?: string;
  /** The underlying upstream provider name as reported by the access layer
   * (e.g. OpenRouter's top-level `provider` field). */
  upstreamProvider?: string;
  /** Which execution surface produced this response. */
  surface: ExecutionSurfaceValue;
  /** How this run reached the underlying model. Absent for mock adapters -
   * the orchestrator defaults it to "NONE" when persisting. */
  accessLayer?: AccessLayerValue;
  /** How the provider's native web search was actually invoked, when
   * applicable. Absent for mock adapters. */
  searchMechanism?: SearchMechanismValue;
  /** Whether the provider's native web-search/search-grounding tool was
   * enabled for this call. */
  webSearchEnabled: boolean;
  /** Identifier of the exact provider API/endpoint used, e.g.
   * "openai:responses.web_search". Freeform since tool/API versions change
   * often - not modeled as an enum. */
  providerApi?: string;
  /** The plain-text answer returned by the provider. */
  answerText: string;
  /** Citations/sources the provider's response included, if any. Some real
   * provider APIs do not expose citations at all - in that case this MUST
   * be an empty array, never fabricated. */
  citations: NormalizedCitation[];
  /** Search queries the provider's own web-search tool generated
   * internally, when exposed. Never inferred for providers that don't
   * expose this. */
  searchQueries?: string[];
  /** Request/response ID reported by the provider, if any. Never a secret. */
  providerRequestId?: string;
  /** Token/search usage, when the provider's API exposes it. */
  usage?: ProviderUsage;
  /** When the provider produced this response. */
  timestamp: Date;
  /** JSON-safe raw payload from the provider, kept for auditability/
   * re-analysis. Must never include API keys, secrets, or request headers. */
  rawResponse?: unknown;
}

/** Broad category of a real-provider run failure. Mirrors `RunErrorCategory`
 * in the Prisma schema. An ERROR is analytically distinct from a fact
 * genuinely not being found - it means no valid observation was obtained. */
export type ProviderErrorCategoryValue =
  | "AUTHENTICATION"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "PROVIDER_OUTAGE"
  | "MALFORMED_RESPONSE"
  | "TOOL_ERROR"
  | "NETWORK"
  | "UNKNOWN";

/** Thrown by real adapters on failure so the orchestration layer can record
 * a meaningful `errorCategory` and decide whether a bounded retry is
 * appropriate, instead of treating every failure as an opaque Error. */
export class ProviderCallError extends Error {
  readonly category: ProviderErrorCategoryValue;
  /** Whether this specific failure is safe to retry automatically (Section
   * 15) - only for transient issues like rate limits/timeouts/5xx/network. */
  readonly retryable: boolean;
  readonly providerRequestId?: string;

  constructor(
    message: string,
    options: {
      category: ProviderErrorCategoryValue;
      retryable?: boolean;
      providerRequestId?: string;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options.cause });
    this.name = "ProviderCallError";
    this.category = options.category;
    this.retryable = options.retryable ?? false;
    this.providerRequestId = options.providerRequestId;
  }
}

/** Implemented by every provider integration, mock or real. */
export interface LLMProviderAdapter {
  /** Stable key matching `LLMProvider.providerKey` in the database. */
  readonly providerKey: string;
  /** Human-readable display name, e.g. "ChatGPT". */
  readonly displayName: string;
  /** Model identifier this adapter is currently configured to use (from
   * environment configuration for real adapters). The ACTUAL model used for
   * a given call is snapshotted per-response in `ProviderResponse.model` and
   * persisted on `ExperimentRun.modelSnapshot` - this field is only a
   * current-configuration convenience, never read back for historical runs. */
  readonly model: string;
  /** Whether this adapter is a real API-backed integration or a synthetic
   * mock. Real experiments must never silently include a MOCK adapter. */
  readonly kind: "REAL" | "MOCK";
  /** Whether this adapter is expected to expose search/citations at all.
   * Real providers that do not expose citations through their API should
   * set this to false rather than inventing citation data. */
  readonly supportsCitations: boolean;

  /** Whether this adapter is currently usable (e.g. a real adapter checks
   * its required API key is configured). Must never throw. Mocks always
   * return true. */
  isAvailable(): boolean;
  /** Human-readable reason `isAvailable()` is false (e.g. "OPENAI_API_KEY is
   * not set"), or null when available. Never includes key values. */
  unavailableReason(): string | null;

  runPrompt(prompt: string): Promise<ProviderResponse>;
}

