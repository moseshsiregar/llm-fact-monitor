import { createMockAdapter } from "./createMockAdapter";

/** Mock Gemini: moderate recall, leans towards alternate/downstream sources
 * (e.g. news or social coverage) over the original publisher. */
export const MockGeminiProvider = createMockAdapter({
  providerKey: "mock-gemini",
  displayName: "Gemini (mock)",
  model: "gemini-2.5-search-mock",
  recallProfile: {
    baseRecallProbability: 0.55,
    openEndedRecallMultiplier: 0.55,
    originalSourceProbability: 0.35,
  },
});
