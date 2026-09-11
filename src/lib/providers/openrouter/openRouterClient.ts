/**
 * Minimal OpenRouter chat-completions client, forcing the provider's own
 * native web search via the (legacy but still supported) `web` plugin with
 * `engine: "native"`. Deliberately does NOT use OpenRouter's newer
 * `openrouter:web_search` server tool, because that tool silently falls
 * back to Exa when the underlying model lacks native search support -
 * `engine: "native"` on the `web` plugin instead errors out in that case,
 * which is what we want (never substitute a third-party search engine for
 * "the provider's own web search").
 *
 * This is the shared HTTP client used by every OpenRouter-backed
 * `LLMProviderAdapter` (see `createOpenRouterAdapter.ts`) as well as the
 * standalone smoke test (`scripts/test-openrouter.ts`).
 */

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterUrlCitation {
  url: string;
  title?: string;
  content?: string;
  start_index?: number;
  end_index?: number;
}

export interface OpenRouterAnnotation {
  type: string;
  url_citation?: OpenRouterUrlCitation;
}

export interface OpenRouterChoiceMessage {
  role: string;
  content: string | null;
  annotations?: OpenRouterAnnotation[];
}

export interface OpenRouterChoice {
  message: OpenRouterChoiceMessage;
  finish_reason?: string | null;
}

export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
  server_tool_use_details?: { web_search_requests?: number };
  [key: string]: unknown;
}

export interface OpenRouterResponseLike {
  id?: string;
  model?: string;
  /** Upstream provider name actually serving the request, e.g. "OpenAI",
   * "Google", "Anthropic", "Perplexity". */
  provider?: string;
  choices?: OpenRouterChoice[];
  usage?: OpenRouterUsage;
  error?: { message?: string; code?: number; metadata?: unknown };
}

export class OpenRouterCallError extends Error {
  readonly status?: number;
  constructor(message: string, options?: { status?: number; cause?: unknown }) {
    super(message);
    this.name = "OpenRouterCallError";
    this.status = options?.status;
    if (options?.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/**
 * Sends ONE chat-completions request to OpenRouter, by default forcing the
 * `web` plugin to native mode. Throws `OpenRouterCallError` on any non-2xx
 * response or transport failure - never silently returns a degraded result.
 *
 * Some providers (currently: Perplexity) have web search built directly
 * into the model itself - it is always-on and cannot be toggled through
 * OpenRouter's plugin system, so forcing `plugins:[{id:"web",engine:"native"}]`
 * on those models returns a routing error ("Filter by Native Web Search
 * Support") before any model call is made. Set `forceNativePlugin: false`
 * for those models - this does NOT invoke Exa or any other fallback search
 * engine, it simply omits an unsupported plugin block so the model's own
 * inherent search still runs.
 */
export async function callOpenRouterNativeWebSearch(params: {
  apiKey: string;
  model: string;
  prompt: string;
  forceNativePlugin?: boolean;
}): Promise<OpenRouterResponseLike> {
  const { apiKey, model, prompt, forceNativePlugin = true } = params;

  let res: Response;
  try {
    res = await fetch(OPENROUTER_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        ...(forceNativePlugin ? { plugins: [{ id: "web", engine: "native" }] } : {}),
      }),
    });
  } catch (error) {
    throw new OpenRouterCallError("Network error calling OpenRouter", { cause: error });
  }

  let json: OpenRouterResponseLike;
  try {
    json = (await res.json()) as OpenRouterResponseLike;
  } catch (error) {
    throw new OpenRouterCallError(`OpenRouter returned a non-JSON response (status ${res.status})`, {
      status: res.status,
      cause: error,
    });
  }

  if (!res.ok) {
    throw new OpenRouterCallError(
      json?.error?.message ?? `OpenRouter request failed with status ${res.status}`,
      { status: res.status, cause: json?.error }
    );
  }

  return json;
}
