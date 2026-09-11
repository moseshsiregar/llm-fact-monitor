import OpenAI, {
  APIConnectionTimeoutError,
  APIConnectionError,
  AuthenticationError,
  RateLimitError,
} from "openai";
import type { LLMProviderAdapter, ProviderResponse } from "../types";
import { ProviderCallError } from "../types";
import { classifyByStatus, wrapUnknownError } from "../errorClassification";
import { toProviderResponse, type OpenAIResponseLike } from "./normalizeOpenAIResponse";

const PROVIDER_KEY = "openai";
const DEFAULT_MODEL = "gpt-4o";

function getModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}

let cachedClient: OpenAI | null = null;
function getClient(): OpenAI {
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return cachedClient;
}

/**
 * Real OpenAI adapter (Section 8). Uses the Responses API with OpenAI's
 * native `web_search` tool - we never perform our own search or restrict
 * the model to a source list; the model chooses what to search for.
 */
export const OpenAIProvider: LLMProviderAdapter = {
  providerKey: PROVIDER_KEY,
  displayName: "ChatGPT",
  get model() {
    return getModel();
  },
  kind: "REAL",
  supportsCitations: true,

  isAvailable(): boolean {
    return Boolean(process.env.OPENAI_API_KEY?.trim());
  },

  unavailableReason(): string | null {
    return this.isAvailable() ? null : "OPENAI_API_KEY is not set";
  },

  async runPrompt(prompt: string): Promise<ProviderResponse> {
    if (!this.isAvailable()) {
      throw new ProviderCallError("OpenAI is not configured (missing OPENAI_API_KEY).", {
        category: "AUTHENTICATION",
        retryable: false,
      });
    }

    const model = getModel();
    const client = getClient();

    try {
      const response = await client.responses.create({
        model,
        tools: [{ type: "web_search" }],
        input: prompt,
      });

      return toProviderResponse(response as unknown as OpenAIResponseLike, PROVIDER_KEY, model);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw new ProviderCallError(error.message, { category: "AUTHENTICATION", retryable: false, cause: error });
      }
      if (error instanceof RateLimitError) {
        throw new ProviderCallError(error.message, { category: "RATE_LIMIT", retryable: true, cause: error });
      }
      if (error instanceof APIConnectionTimeoutError) {
        throw new ProviderCallError(error.message, { category: "TIMEOUT", retryable: true, cause: error });
      }
      if (error instanceof APIConnectionError) {
        throw new ProviderCallError(error.message, { category: "NETWORK", retryable: true, cause: error });
      }
      if (error && typeof error === "object" && "status" in error) {
        const { category, retryable } = classifyByStatus((error as { status?: number }).status);
        throw new ProviderCallError(error instanceof Error ? error.message : "OpenAI request failed", {
          category,
          retryable,
          cause: error,
        });
      }
      throw wrapUnknownError(error, "OpenAI request failed");
    }
  },
};
