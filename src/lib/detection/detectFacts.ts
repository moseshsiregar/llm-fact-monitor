import { normalizeText, significantWords } from "./normalize";

export type DetectionStatusValue = "FOUND" | "NOT_FOUND" | "UNCERTAIN";
export type DetectionMethodValue =
  | "KEYWORD_MATCH"
  | "PHRASE_MATCH"
  | "MANUAL"
  | "LLM_JUDGE"
  | "OTHER"
  | "DETERMINISTIC_V2"
  | "SEMANTIC_ENTAILMENT";

export interface FactDetectionInput {
  canonicalFactText: string;
  /** Comma-separated identifying keywords/phrases, e.g.
   * "Greenford Youth Trust,patron". Optional - if absent, keywords are
   * auto-derived from the canonical fact text. */
  identifyingKeywords?: string | null;
}

export interface FactDetectionResult {
  status: DetectionStatusValue;
  confidence: number;
  matchingExcerpt: string | null;
  detectionMethod: DetectionMethodValue;
}

const EXCERPT_RADIUS = 90;

/**
 * Transparent, explainable fact-detection (Section 7). This is deliberately
 * simple: normalized keyword/phrase matching with a confidence score, NOT a
 * semantic similarity model or LLM judge. It is designed to be replaced or
 * supplemented later (e.g. `detectionMethod: "LLM_JUDGE"`) without changing
 * callers - they only depend on `FactDetectionResult`.
 *
 * Rules:
 *  - Researcher-defined keywords/phrases (comma-separated) are checked first
 *    as whole-phrase matches against the normalized answer text.
 *  - If no keywords were provided, phrases are auto-derived from the
 *    canonical fact text's significant (non-stopword) words.
 *  - FOUND requires at least half of the phrases to match.
 *  - Partial (but non-zero) matches are UNCERTAIN, never silently FOUND.
 */
export function detectFact(
  fact: FactDetectionInput,
  answerText: string
): FactDetectionResult {
  const normalizedAnswer = normalizeText(answerText);

  const explicitPhrases = (fact.identifyingKeywords ?? "")
    .split(",")
    .map((p) => normalizeText(p))
    .filter((p) => p.length > 0);

  const usingExplicitKeywords = explicitPhrases.length > 0;

  const phrases = usingExplicitKeywords
    ? explicitPhrases
    : chunkIntoPhrases(significantWords(normalizeText(fact.canonicalFactText)));

  if (phrases.length === 0) {
    return {
      status: "NOT_FOUND",
      confidence: 0,
      matchingExcerpt: null,
      detectionMethod: "KEYWORD_MATCH",
    };
  }

  const matched = phrases.filter((phrase) => normalizedAnswer.includes(phrase));
  const matchRatio = matched.length / phrases.length;

  let status: DetectionStatusValue;
  if (matchRatio >= 0.5) {
    status = "FOUND";
  } else if (matchRatio > 0) {
    status = "UNCERTAIN";
  } else {
    status = "NOT_FOUND";
  }

  const matchingExcerpt =
    matched.length > 0 ? extractExcerpt(answerText, matched[0]) : null;

  return {
    status,
    confidence: Math.round(matchRatio * 100) / 100,
    matchingExcerpt,
    detectionMethod: usingExplicitKeywords ? "PHRASE_MATCH" : "KEYWORD_MATCH",
  };
}

/** Groups a flat word list into overlapping 2-3 word phrases so matching is
 * a little more specific than single-word hits when no explicit keywords are
 * supplied. */
function chunkIntoPhrases(words: string[]): string[] {
  if (words.length <= 2) return words;
  const phrases: string[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    phrases.push(`${words[i]} ${words[i + 1]}`);
  }
  return phrases;
}

/** Finds `phrase` (case-insensitive) in the original, non-normalized text
 * and returns a readable window of surrounding text for the evidence view. */
function extractExcerpt(originalText: string, phrase: string): string | null {
  const idx = originalText.toLowerCase().indexOf(phrase.split(" ")[0]);
  if (idx === -1) return originalText.slice(0, EXCERPT_RADIUS * 2).trim();
  const start = Math.max(0, idx - EXCERPT_RADIUS);
  const end = Math.min(originalText.length, idx + EXCERPT_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < originalText.length ? "…" : "";
  return `${prefix}${originalText.slice(start, end).trim()}${suffix}`;
}
