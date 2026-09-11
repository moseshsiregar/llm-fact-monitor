import type { LLMProviderAdapter } from "./types";
import { MockChatGPTProvider } from "./mock/MockChatGPTProvider";
import { MockGeminiProvider } from "./mock/MockGeminiProvider";
import { MockClaudeProvider } from "./mock/MockClaudeProvider";
import { MockPerplexityProvider } from "./mock/MockPerplexityProvider";
import { OpenAIProvider } from "./openai/OpenAIProvider";
import { OPENROUTER_PROVIDERS } from "./openrouter/openRouterProviders";

/**
 * Central registry mapping `LLMProvider.providerKey` (database) to a
 * concrete adapter implementation (code). To add a real provider later:
 *   1. Implement `LLMProviderAdapter` in e.g. `openai/OpenAIProvider.ts`.
 *   2. Register it here under a new providerKey (e.g. "openai").
 *   3. Add/update the matching `LLMProvider` row in the database.
 * No other application code needs to change.
 *
 * Live experiment execution now goes through OpenRouter as the unified
 * access layer (see `openrouter/openRouterProviders.ts`): the four logical
 * providers "openai"/"gemini"/"claude"/"perplexity" are all OpenRouter-
 * backed. The original direct-SDK OpenAI adapter is preserved in the
 * repository for possible future comparison but is deliberately registered
 * under a DIFFERENT key ("openai-direct-sdk") so it is never resolved for
 * a live experiment run and never collides with the OpenRouter-backed
 * "openai" entry.
 */
export const PROVIDER_REGISTRY: Record<string, LLMProviderAdapter> = {
  [MockChatGPTProvider.providerKey]: MockChatGPTProvider,
  [MockGeminiProvider.providerKey]: MockGeminiProvider,
  [MockClaudeProvider.providerKey]: MockClaudeProvider,
  [MockPerplexityProvider.providerKey]: MockPerplexityProvider,
  "openai-direct-sdk": OpenAIProvider,
  ...Object.fromEntries(OPENROUTER_PROVIDERS.map((adapter) => [adapter.providerKey, adapter])),
};


export function getProviderAdapter(providerKey: string): LLMProviderAdapter {
  const adapter = PROVIDER_REGISTRY[providerKey];
  if (!adapter) {
    throw new Error(
      `No LLMProviderAdapter registered for providerKey "${providerKey}"`
    );
  }
  return adapter;
}

/** Availability snapshot for every registered adapter (Section 22/23) - safe
 * to call on every page load since it never makes a network request, only
 * reads environment configuration. Used by the New Experiment page and the
 * "Check connections" action. */
export interface ProviderAvailability {
  providerKey: string;
  displayName: string;
  model: string;
  kind: "REAL" | "MOCK";
  available: boolean;
  reason: string | null;
}

export function getProviderAvailability(): ProviderAvailability[] {
  return Object.values(PROVIDER_REGISTRY).map((adapter) => ({
    providerKey: adapter.providerKey,
    displayName: adapter.displayName,
    model: adapter.model,
    kind: adapter.kind,
    available: adapter.isAvailable(),
    reason: adapter.unavailableReason(),
  }));
}

