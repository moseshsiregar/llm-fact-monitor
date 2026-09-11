import { createMockAdapter } from "./createMockAdapter";

/** Mock Perplexity: highest recall (search-first product), decent original
 * source attribution. */
export const MockPerplexityProvider = createMockAdapter({
  providerKey: "mock-perplexity",
  displayName: "Perplexity (mock)",
  model: "sonar-search-mock",
  recallProfile: {
    baseRecallProbability: 0.85,
    openEndedRecallMultiplier: 0.7,
    originalSourceProbability: 0.6,
  },
});
