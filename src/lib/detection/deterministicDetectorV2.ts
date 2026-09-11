import { normalizeTextV2, significantWords } from "./normalize";
import type { DetectionMethodValue } from "./detectFacts";

export type DeterministicStageStatus =
  | "FOUND_DETERMINISTIC"
  | "NOT_FOUND_DETERMINISTIC"
  | "NEEDS_SEMANTIC_VERIFICATION";

export interface DeterministicFactInput {
  canonicalFactText: string;
  /** Comma-separated identifying keywords/phrases. When present, matched as
   * literal substrings (unchanged from v1) since the researcher wrote them
   * deliberately. When absent, components are auto-derived from the
   * canonical fact text and matched with word-window adjacency (see
   * `WORD_WINDOW`) instead of strict substring adjacency. */
  identifyingKeywords?: string | null;
}

export interface DeterministicDetectionResult {
  status: DeterministicStageStatus;
  /** Ratio (0-1) of components that matched. This is stage-1 evidence
   * strength, not a final confidence - see `hybridDetectFact`. */
  score: number;
  matchingExcerpt: string | null;
  /** Which derived phrase/keyword components matched, for transparency
   * (Phase 5 Part B: "matched components"). */
  matchedComponents: string[];
  totalComponents: number;
  detectionMethod: DetectionMethodValue;
}

const EXCERPT_RADIUS = 90;

/** Max number of words of separation allowed between the two words of an
 * auto-derived fact component when searching the answer. Chosen to absorb
 * ordinary connecting/stop words ("in", "the", month names, etc.) that
 * natural paraphrasing inserts, without turning this into unbounded fuzzy
 * matching (Phase 5 Part B: fix "false uncertainty under ordinary
 * paraphrasing" without building "a giant heuristic system"). */
const WORD_WINDOW = 6;

/** Ratio of matched components required to call the deterministic stage
 * decisive (FOUND). Below this but above zero is NOT silently called
 * FOUND or UNCERTAIN - it is flagged as needing semantic verification. */
const FOUND_THRESHOLD = 0.6;

/**
 * Stage 1 of the Phase 5 hybrid detector: transparent, explainable lexical
 * matching (still not semantic/LLM-based) with two improvements over v1
 * (`detectFacts.ts`):
 *  - date phrasings and common title abbreviations are normalized so they
 *    match regardless of format (see `normalizeTextV2`);
 *  - auto-derived 2-word components only need to appear within
 *    `WORD_WINDOW` words of each other in the answer, not as a literal
 *    adjacent substring - this is what actually fixes the observed false
 *    UNCERTAIN results (e.g. "Manchester in 2017" vs the literal substring
 *    "manchester 2017").
 *
 * Explicit researcher keywords are still matched as literal substrings,
 * unchanged from v1.
 */
export function detectFactDeterministicV2(
  fact: DeterministicFactInput,
  answerText: string
): DeterministicDetectionResult {
  const normalizedAnswer = normalizeTextV2(answerText);

  const explicitPhrases = (fact.identifyingKeywords ?? "")
    .split(",")
    .map((p) => normalizeTextV2(p))
    .filter((p) => p.length > 0);

  if (explicitPhrases.length > 0) {
    const matched = explicitPhrases.filter((phrase) => normalizedAnswer.includes(phrase));
    return finalizeResult(matched, explicitPhrases, answerText, "PHRASE_MATCH");
  }

  const words = significantWords(normalizeTextV2(fact.canonicalFactText));
  const componentPairs = chunkIntoPairs(words);

  if (componentPairs.length === 0) {
    return {
      status: "NOT_FOUND_DETERMINISTIC",
      score: 0,
      matchingExcerpt: null,
      matchedComponents: [],
      totalComponents: 0,
      detectionMethod: "DETERMINISTIC_V2",
    };
  }

  const answerWords = normalizedAnswer.split(" ").filter(Boolean);
  const allComponents = componentPairs.map(([a, b]) => `${a} ${b}`);
  const matchedComponents = componentPairs
    .filter(([a, b]) => windowMatch(answerWords, a, b))
    .map(([a, b]) => `${a} ${b}`);

  return finalizeResult(matchedComponents, allComponents, answerText, "DETERMINISTIC_V2");
}

function finalizeResult(
  matched: string[],
  allComponents: string[],
  answerText: string,
  detectionMethod: DetectionMethodValue
): DeterministicDetectionResult {
  const ratio = allComponents.length ? matched.length / allComponents.length : 0;

  let status: DeterministicStageStatus;
  if (ratio >= FOUND_THRESHOLD) {
    status = "FOUND_DETERMINISTIC";
  } else if (ratio === 0) {
    status = "NOT_FOUND_DETERMINISTIC";
  } else {
    status = "NEEDS_SEMANTIC_VERIFICATION";
  }

  const matchingExcerpt =
    matched.length > 0 ? extractExcerpt(answerText, matched[0].split(" ")[0]) : null;

  return {
    status,
    score: Math.round(ratio * 100) / 100,
    matchingExcerpt,
    matchedComponents: matched,
    totalComponents: allComponents.length,
    detectionMethod,
  };
}

/** Groups a flat word list into overlapping 2-word component pairs, same
 * shape as v1's `chunkIntoPhrases` but returned as tuples rather than
 * pre-joined strings, since v2 needs the two words separately for window
 * matching. */
function chunkIntoPairs(words: string[]): [string, string][] {
  if (words.length === 0) return [];
  if (words.length === 1) return [[words[0], words[0]]];
  const pairs: [string, string][] = [];
  for (let i = 0; i < words.length - 1; i++) {
    pairs.push([words[i], words[i + 1]]);
  }
  return pairs;
}

/** True if `b` occurs within `WORD_WINDOW` words of `a` anywhere in
 * `answerWords` (in either direction). */
function windowMatch(answerWords: string[], a: string, b: string): boolean {
  if (a === b) return answerWords.includes(a);
  for (let i = 0; i < answerWords.length; i++) {
    if (answerWords[i] !== a) continue;
    const lo = Math.max(0, i - WORD_WINDOW);
    const hi = Math.min(answerWords.length - 1, i + WORD_WINDOW);
    for (let j = lo; j <= hi; j++) {
      if (j !== i && answerWords[j] === b) return true;
    }
  }
  return false;
}

/** Finds `word` (case-insensitive) in the original, non-normalized text and
 * returns a readable window of surrounding text for the evidence view. */
function extractExcerpt(originalText: string, word: string): string | null {
  const idx = originalText.toLowerCase().indexOf(word);
  if (idx === -1) return originalText.slice(0, EXCERPT_RADIUS * 2).trim();
  const start = Math.max(0, idx - EXCERPT_RADIUS);
  const end = Math.min(originalText.length, idx + EXCERPT_RADIUS);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < originalText.length ? "…" : "";
  return `${prefix}${originalText.slice(start, end).trim()}${suffix}`;
}
