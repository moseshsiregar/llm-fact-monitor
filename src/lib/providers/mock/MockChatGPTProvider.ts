import { createMockAdapter } from "./createMockAdapter";

/** Mock ChatGPT: moderate recall, roughly even split between original and
 * alternate sources. */
export const MockChatGPTProvider = createMockAdapter({
  providerKey: "mock-chatgpt",
  displayName: "ChatGPT (mock)",
  model: "gpt-4o-search-mock",
  recallProfile: {
    baseRecallProbability: 0.7,
    openEndedRecallMultiplier: 0.45,
    originalSourceProbability: 0.5,
  },
});
