/**
 * Fixture data used ONLY by the mock provider adapters.
 *
 * IMPORTANT: this is NOT the researcher-entered Fact data. It is a small,
 * hardcoded "what a web-search LLM might plausibly find" knowledge base used
 * so mock providers can produce varied, semi-realistic answers/citations for
 * local development and demos, without any real API calls.
 *
 * Real provider adapters (OpenAIProvider, GeminiProvider, etc.) will NOT use
 * this file - they will call the actual provider API and return whatever
 * that API genuinely returns.
 */

export interface MockAlternateSource {
  url: string;
  domain: string;
  title?: string;
}

export interface MockFactCandidate {
  /** Loosely correlates with a seeded Fact.label for demo coherence. Not a
   * hard reference/foreign key - mocks must not depend on the database. */
  matchLabel: string;
  sentence: string;
  originalUrl: string;
  originalDomain: string;
  originalTitle?: string;
  alternateSources: MockAlternateSource[];
  /** Lowercase words/phrases that a genuinely topic-directed prompt would
   * plausibly contain (e.g. "organisations", "youth trust"). Used only by
   * the mock adapters to decide whether a given prompt is topically
   * directed toward this candidate (TARGETED_RETRIEVAL-like) or broad
   * (OPEN_ENDED_DISCOVERY-like) - never checked against researcher-entered
   * Fact data. A broad prompt like "Tell me about {politician}" will not
   * match any of these, which is what drives the lower open-ended recall. */
  topicalPromptHints: string[];
}

export interface MockPoliticianFixture {
  /** Case-insensitive substring matched against the prompt text. */
  politicianName: string;
  fallbackSentence: string;
  candidates: MockFactCandidate[];
}

export const MOCK_FIXTURES: MockPoliticianFixture[] = [
  {
    politicianName: "Jane Smith",
    fallbackSentence:
      "Jane Smith is a local councillor known for community engagement work in Greenford.",
    candidates: [
      {
        matchLabel: "Youth Trust patron",
        sentence:
          "Jane Smith became patron of Greenford Youth Trust in September 2026.",
        originalUrl: "https://greenfordyouthtrust.org/news/jane-smith-patron",
        originalDomain: "greenfordyouthtrust.org",
        originalTitle: "Greenford Youth Trust welcomes Jane Smith as patron",
        alternateSources: [
          {
            url: "https://greenfordgazette.co.uk/news/youth-trust-patron",
            domain: "greenfordgazette.co.uk",
            title: "Local councillor named patron of youth charity",
          },
          {
            url: "https://en.wikipedia.org/wiki/Jane_Smith_(councillor)",
            domain: "en.wikipedia.org",
            title: "Jane Smith (councillor) - Wikipedia",
          },
        ],
        topicalPromptHints: ["organisation", "organisations", "youth trust", "patron"],
      },
      {
        matchLabel: "Community surgery launch",
        sentence:
          "Jane Smith launched a monthly community surgery on Greenford High Street in August 2026.",
        originalUrl: "https://janesmith.org.uk/updates/community-surgery",
        originalDomain: "janesmith.org.uk",
        originalTitle: "New monthly surgery for Greenford residents",
        alternateSources: [
          {
            url: "https://greenfordgazette.co.uk/news/community-surgery",
            domain: "greenfordgazette.co.uk",
            title: "Councillor opens regular residents' surgery",
          },
        ],
        topicalPromptHints: ["surgery", "greenford high street"],
      },
      // Note: "Climate panel chair" is intentionally NOT included here - that
      // fact is seeded as PRE_PUBLICATION (not yet public), so no mock
      // provider should ever be able to "discover" it. This keeps the
      // baseline (pre-publication) demo data honest.
    ],
  },
  {
    politicianName: "Daniel Rahman",
    fallbackSentence:
      "Daniel Rahman is a Member of Parliament representing Elmsworth.",
    candidates: [
      {
        matchLabel: "Renters Rights Bill",
        sentence:
          "Daniel Rahman sponsored the Elmsworth Renters' Rights Bill in July 2026.",
        originalUrl:
          "https://parliament.example.gov/bills/elmsworth-renters-rights",
        originalDomain: "parliament.example.gov",
        originalTitle: "Elmsworth Renters' Rights Bill - Parliament record",
        alternateSources: [
          {
            url: "https://elmsworthtimes.co.uk/news/renters-rights-bill",
            domain: "elmsworthtimes.co.uk",
            title: "MP sponsors new renters' rights bill",
          },
        ],
        topicalPromptHints: ["legislation", "bill", "renters", "law"],
      },
      {
        matchLabel: "Food bank partnership post",
        sentence:
          "Daniel Rahman announced a new food bank partnership on his verified social media account in August 2026.",
        originalUrl: "https://twitter.example/danielrahmanmp/status/123456",
        originalDomain: "twitter.example",
        originalTitle: "Daniel Rahman MP on X",
        alternateSources: [
          {
            url: "https://elmsworthtimes.co.uk/news/food-bank-partnership",
            domain: "elmsworthtimes.co.uk",
            title: "MP announces food bank partnership",
          },
        ],
        topicalPromptHints: ["food bank", "charity", "charities"],
      },
      // Note: "Heritage Society honorary member" is intentionally NOT included
      // here - that fact is seeded as PRE_PUBLICATION, so it must remain
      // undiscoverable by every mock provider until it is actually published.
    ],
  },
];

export function findFixtureForPrompt(
  promptText: string
): MockPoliticianFixture | undefined {
  const lower = promptText.toLowerCase();
  return MOCK_FIXTURES.find((f) => lower.includes(f.politicianName.toLowerCase()));
}
