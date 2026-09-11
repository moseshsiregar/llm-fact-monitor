import { createMockAdapter } from "./createMockAdapter";

/** Mock Claude: more conservative recall, but when it does cite a source it
 * tends to prefer the original/authoritative one. */
export const MockClaudeProvider = createMockAdapter({
  providerKey: "mock-claude",
  displayName: "Claude (mock)",
  model: "claude-3.7-search-mock",
  recallProfile: {
    baseRecallProbability: 0.45,
    openEndedRecallMultiplier: 0.3,
    originalSourceProbability: 0.7,
  },
});
