import { createOpenRouterAdapter } from "./createOpenRouterAdapter";

/**
 * The four logical providers exposed to the rest of the app, all backed by
 * the single shared OpenRouter access layer (Phase 4 pivot). Default model
 * IDs are the exact slugs validated via live smoke tests (one request per
 * family, native web search confirmed) - see `/memories/repo/llm-fact-monitor.md`.
 * Each can be overridden via its env var without a code change.
 */
export const OpenRouterOpenAIProvider = createOpenRouterAdapter({
  providerKey: "openai",
  displayName: "ChatGPT",
  defaultModel: "openai/gpt-4.1",
  envModelVar: "OPENROUTER_OPENAI_MODEL",
  forceNativePlugin: true,
  searchMechanism: "OPENROUTER_NATIVE_WEB_PLUGIN",
});

export const OpenRouterGeminiProvider = createOpenRouterAdapter({
  providerKey: "gemini",
  displayName: "Gemini",
  defaultModel: "google/gemini-3.1-flash-lite",
  envModelVar: "OPENROUTER_GEMINI_MODEL",
  forceNativePlugin: true,
  searchMechanism: "OPENROUTER_NATIVE_WEB_PLUGIN",
});

export const OpenRouterClaudeProvider = createOpenRouterAdapter({
  providerKey: "claude",
  displayName: "Claude",
  defaultModel: "anthropic/claude-sonnet-4.5",
  envModelVar: "OPENROUTER_CLAUDE_MODEL",
  forceNativePlugin: true,
  searchMechanism: "OPENROUTER_NATIVE_WEB_PLUGIN",
});

export const OpenRouterPerplexityProvider = createOpenRouterAdapter({
  providerKey: "perplexity",
  displayName: "Perplexity",
  defaultModel: "perplexity/sonar",
  envModelVar: "OPENROUTER_PERPLEXITY_MODEL",
  // Perplexity's web search is inherent/always-on - forcing the "native"
  // plugin filter 404s for it (confirmed via live smoke test). Omitting the
  // plugin block still yields the provider's own native search, never Exa.
  forceNativePlugin: false,
  searchMechanism: "PROVIDER_INHERENT_WEB_SEARCH",
});

export const OPENROUTER_PROVIDERS = [
  OpenRouterOpenAIProvider,
  OpenRouterGeminiProvider,
  OpenRouterClaudeProvider,
  OpenRouterPerplexityProvider,
];
