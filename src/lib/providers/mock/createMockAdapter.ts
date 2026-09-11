import type {
  LLMProviderAdapter,
  NormalizedCitation,
  ProviderResponse,
} from "../types";
import { findFixtureForPrompt, type MockFactCandidate } from "./fixtures";

/** Arbitrary demo-only parameters controlling how "good" a mock provider is
 * at surfacing facts, and how likely it is to cite the original source vs.
 * some other (downstream/alternate) source. These numbers are fictional and
 * are NOT meant to represent real model capability. */
export interface MockRecallProfile {
  /** Probability [0-1] that a candidate fact is surfaced when the prompt is
   * topically directed toward it (i.e. its `topicalPromptHints` appear in
   * the prompt) - representing TARGETED_RETRIEVAL-style prompts. */
  baseRecallProbability: number;
  /** Multiplier [0-1] applied to `baseRecallProbability` when the prompt is
   * NOT topically directed toward the candidate (e.g. a broad "Tell me
   * about {politician}" OPEN_ENDED_DISCOVERY prompt). Lower values mean
   * this provider surfaces fewer specific facts in general answers. */
  openEndedRecallMultiplier: number;
  /** Probability [0-1] that, once surfaced, the original source is cited
   * rather than an alternate/downstream source. */
  originalSourceProbability: number;
}

function pickSource(candidate: MockFactCandidate, originalSourceProbability: number) {
  if (
    candidate.alternateSources.length === 0 ||
    Math.random() < originalSourceProbability
  ) {
    return {
      url: candidate.originalUrl,
      domain: candidate.originalDomain,
      title: candidate.originalTitle,
    };
  }
  const alt =
    candidate.alternateSources[
      Math.floor(Math.random() * candidate.alternateSources.length)
    ];
  return alt;
}

/** Builds a mock LLMProviderAdapter driven by a recall profile. Shared by
 * every Mock*Provider so behavioural differences stay in one small config
 * object per provider rather than duplicated logic. */
export function createMockAdapter(config: {
  providerKey: string;
  displayName: string;
  model: string;
  recallProfile: MockRecallProfile;
}): LLMProviderAdapter {
  return {
    providerKey: config.providerKey,
    displayName: config.displayName,
    model: config.model,
    kind: "MOCK",
    supportsCitations: true,
    isAvailable: () => true,
    unavailableReason: () => null,
    async runPrompt(prompt: string): Promise<ProviderResponse> {
      // Simulate network latency so the UI's pending states are exercised.
      await new Promise((resolve) => setTimeout(resolve, 150 + Math.random() * 350));

      const fixture = findFixtureForPrompt(prompt);
      const citations: NormalizedCitation[] = [];
      const sentences: string[] = [];
      const normalizedPrompt = prompt.toLowerCase();

      if (fixture) {
        for (const candidate of fixture.candidates) {
          const isTopicallyDirected = candidate.topicalPromptHints.some((hint) =>
            normalizedPrompt.includes(hint.toLowerCase())
          );
          const effectiveProbability = isTopicallyDirected
            ? config.recallProfile.baseRecallProbability
            : config.recallProfile.baseRecallProbability * config.recallProfile.openEndedRecallMultiplier;

          if (Math.random() < effectiveProbability) {
            sentences.push(candidate.sentence);
            const source = pickSource(
              candidate,
              config.recallProfile.originalSourceProbability
            );
            citations.push({ url: source.url, title: source.title, spanKind: "RESPONSE_LEVEL" });
          }
        }
        if (sentences.length === 0) {
          sentences.push(fixture.fallbackSentence);
        }
      } else {
        sentences.push(
          "I don't have enough current, verifiable information to answer that specifically."
        );
      }

      const answerText = sentences.join(" ");

      return {
        providerKey: config.providerKey,
        model: config.model,
        surface: "MOCK_SIMULATION",
        webSearchEnabled: true,
        answerText,
        citations,
        timestamp: new Date(),
        rawResponse: {
          mock: true,
          providerKey: config.providerKey,
          prompt,
          answerText,
          citations,
        },
      };
    },
  };
}
