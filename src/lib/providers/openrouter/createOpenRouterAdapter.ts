import type { LLMProviderAdapter, ProviderResponse, SearchMechanismValue } from "../types";
import { ProviderCallError } from "../types";
import { classifyByStatus, wrapUnknownError } from "../errorClassification";
import { callOpenRouterNativeWebSearch, OpenRouterCallError } from "./openRouterClient";
import { toOpenRouterProviderResponse } from "./toOpenRouterProviderResponse";
import type { OpenRouterFamily } from "./citationTrust";

export interface OpenRouterAdapterConfig {
  /** Logical provider family exposed to the rest of the app - matches
   * `LLMProvider.providerKey` in the database. */
  providerKey: OpenRouterFamily;
  /** Human-readable name shown on the dashboard, e.g. "ChatGPT". */
  displayName: string;
  /** Validated-working OpenRouter model slug used when no environment
   * override is configured. */
  defaultModel: string;
  /** Environment variable name that can override `defaultModel`. */
  envModelVar: string;
  /** Whether to force `plugins:[{id:"web",engine:"native"}]`. False only
   * for families whose search is inherent/always-on (Perplexity) - see
   * `openRouterClient.ts` for why forcing the plugin 404s for those. */
  forceNativePlugin: boolean;
  searchMechanism: SearchMechanismValue;
}

/**
 * Builds an `LLMProviderAdapter` backed by the shared OpenRouter client.
 * One factory, four logical providers (openai/gemini/claude/perplexity) -
 * only the model slug, plugin-forcing behavior, and display name differ.
 */
export function createOpenRouterAdapter(config: OpenRouterAdapterConfig): LLMProviderAdapter {
  function getModel(): string {
    return process.env[config.envModelVar]?.trim() || config.defaultModel;
  }

  return {
    providerKey: config.providerKey,
    displayName: config.displayName,
    get model() {
      return getModel();
    },
    kind: "REAL",
    supportsCitations: true,

    isAvailable(): boolean {
      return Boolean(process.env.OPENROUTER_API_KEY?.trim());
    },

    unavailableReason(): string | null {
      return this.isAvailable() ? null : "OpenRouter API key not configured";
    },

    async runPrompt(prompt: string): Promise<ProviderResponse> {
      if (!this.isAvailable()) {
        throw new ProviderCallError("OpenRouter is not configured (missing OPENROUTER_API_KEY).", {
          category: "AUTHENTICATION",
          retryable: false,
        });
      }

      const apiKey = process.env.OPENROUTER_API_KEY!.trim();
      const model = getModel();

      try {
        const raw = await callOpenRouterNativeWebSearch({
          apiKey,
          model,
          prompt,
          forceNativePlugin: config.forceNativePlugin,
        });
        return toOpenRouterProviderResponse({
          raw,
          requestedModel: model,
          providerKey: config.providerKey,
          searchMechanism: config.searchMechanism,
        });
      } catch (error) {
        if (error instanceof OpenRouterCallError) {
          const { category, retryable } = classifyByStatus(error.status);
          throw new ProviderCallError(error.message, { category, retryable, cause: error.cause });
        }
        throw wrapUnknownError(error, "OpenRouter request failed");
      }
    },
  };
}
