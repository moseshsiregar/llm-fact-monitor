/**
 * Phase 6 — minimal OpenRouter chat-completions client used ONLY by the
 * semantic `FactVerifier` (see `openRouterFactVerifier.ts`).
 *
 * This is deliberately a SEPARATE, independent client from
 * `src/lib/providers/openrouter/openRouterClient.ts` (the retrieval-side
 * client used by the tested provider adapters):
 *  - it never sets `plugins`/web-search, because the verifier's job is to
 *    judge entailment against text that has ALREADY been retrieved and
 *    persisted - it must never go fetch its own corroborating evidence
 *    from the web, which would turn "does the answer assert this fact"
 *    into "is this fact true", a different (and out of scope) question;
 *  - it lives under `detection/verifiers/`, not `providers/`, so
 *    verification stays architecturally separate from retrieval (Part C)
 *    and nothing here can be mistaken for, or accidentally wired into,
 *    provider retrieval code.
 *
 * Phase 8: every failure is now thrown as a categorized `VerifierCallError`
 * (timeout/rate-limit/outage/malformed-response/network/auth/unknown) so
 * callers can distinguish a technical failure from a genuine NOT_FOUND
 * judgment, and can decide whether a bounded retry is appropriate (Section
 * 7). A bounded request timeout (`VERIFIER_TIMEOUT_MS`, default 30s) is
 * enforced via `AbortController` - the retrieval-side client has no
 * equivalent, but the verifier is a synchronous "does this text say X"
 * check with no reason to ever hang indefinitely.
 */
import { VerifierCallError, classifyVerifierStatus } from "./verifierErrorClassification";

const OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const VERIFIER_TIMEOUT_MS = Number(process.env.VERIFIER_TIMEOUT_MS) || 30_000;

/** @deprecated kept as an alias so any external importer of the old name
 * keeps working; new code should import `VerifierCallError` from
 * `./verifierErrorClassification`. */
export { VerifierCallError as OpenRouterJudgeCallError };

interface OpenRouterJudgeUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number;
}

interface OpenRouterJudgeResponseLike {
  id?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: OpenRouterJudgeUsage;
  error?: { message?: string; code?: number };
}

export interface OpenRouterJudgeCallResult {
  content: string;
  costUsd: number | null;
  /** OpenRouter's generation/request ID for this call, if exposed. */
  requestId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

/**
 * Sends ONE non-search chat-completions request to OpenRouter with a fixed
 * system + user prompt pair. Throws a categorized `VerifierCallError` on
 * any non-2xx response, timeout, transport failure, or empty response -
 * callers must decide how to degrade (the `FactVerifier` implementation
 * treats an unrecoverable failure as an honest technical `ERROR`, never a
 * silent NOT_FOUND/guess - see Phase 8 Section 6).
 */
export async function callOpenRouterJudge(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userPrompt: string;
}): Promise<OpenRouterJudgeCallResult> {
  const { apiKey, model, systemPrompt, userPrompt } = params;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VERIFIER_TIMEOUT_MS);

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
        temperature: 0,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new VerifierCallError(`OpenRouter verifier call timed out after ${VERIFIER_TIMEOUT_MS}ms`, {
        category: "TIMEOUT",
        retryable: true,
        cause: error,
      });
    }
    throw new VerifierCallError("Network error calling OpenRouter (semantic verifier)", {
      category: "NETWORK",
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  let json: OpenRouterJudgeResponseLike;
  try {
    json = (await res.json()) as OpenRouterJudgeResponseLike;
  } catch (error) {
    throw new VerifierCallError(`OpenRouter verifier returned a non-JSON response (status ${res.status})`, {
      category: "MALFORMED_RESPONSE",
      retryable: false,
      status: res.status,
      cause: error,
    });
  }

  if (!res.ok) {
    const { category, retryable } = classifyVerifierStatus(res.status);
    throw new VerifierCallError(json?.error?.message ?? `OpenRouter verifier request failed with status ${res.status}`, {
      category,
      retryable,
      status: res.status,
      cause: json?.error,
    });
  }

  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new VerifierCallError("OpenRouter verifier response had no message content", {
      category: "MALFORMED_RESPONSE",
      retryable: false,
    });
  }

  return {
    content,
    costUsd: typeof json?.usage?.cost === "number" ? json.usage.cost : null,
    requestId: typeof json?.id === "string" ? json.id : null,
    inputTokens: typeof json?.usage?.prompt_tokens === "number" ? json.usage.prompt_tokens : null,
    outputTokens: typeof json?.usage?.completion_tokens === "number" ? json.usage.completion_tokens : null,
    totalTokens: typeof json?.usage?.total_tokens === "number" ? json.usage.total_tokens : null,
  };
}

