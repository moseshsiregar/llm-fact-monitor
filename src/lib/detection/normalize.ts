const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "and",
  "or",
  "is",
  "was",
  "were",
  "be",
  "as",
  "by",
  "with",
  "that",
  "this",
  "it",
  "his",
  "her",
  "he",
  "she",
  "will",
  "has",
  "have",
  "had",
]);

/** Lowercases, strips punctuation, and collapses whitespace. Used so that
 * keyword/phrase matching is not defeated by capitalization or punctuation
 * differences between the seeded fact text and the LLM's free-text answer. */
export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extracts significant (non-stopword) words from a normalized string. */
export function significantWords(normalized: string): string[] {
  return normalized.split(" ").filter((w) => w.length > 3 && !STOPWORDS.has(w));
}

// ---------------------------------------------------------------------------
// Phase 5 (v2) normalization additions. These are deliberately kept OUT of
// `normalizeText`/`significantWords` above so the original v1 deterministic
// detector's behavior is fully preserved and reproducible - see
// `detectFacts.ts`. `normalizeTextV2` is used only by the new
// `deterministicDetectorV2` module.
// ---------------------------------------------------------------------------

/** A short, explicit list of common political-title abbreviations - NOT a
 * general synonym system. Expanded before other normalization so "PM" and
 * "Prime Minister" (or "MP" and "Member of Parliament") normalize
 * identically. */
const TITLE_SYNONYMS: Record<string, string> = {
  pm: "prime minister",
  mp: "member of parliament",
};

/** Expands recognized title abbreviations to their full form. Matches whole
 * words only (word boundaries) so it never touches abbreviations embedded
 * inside other words. */
export function expandTitleSynonyms(input: string): string {
  return input.replace(/\b(pm|mp)\b/gi, (m) => TITLE_SYNONYMS[m.toLowerCase()] ?? m);
}

export const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

export const MONTH_PATTERN = Object.keys(MONTHS).join("|");

/** Collapses recognized "DD Month YYYY" / "Month DD, YYYY" date phrasings
 * (with or without ordinal suffixes) into a single canonical `YYYYMMDD`
 * token, so date matching survives reordering/punctuation differences (e.g.
 * "20 July 2026" vs "July 20, 2026" vs "20th July 2026"). Anything it
 * doesn't recognize is left untouched. */
export function canonicalizeDates(input: string): string {
  let out = input.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
  out = out.replace(
    new RegExp(`\\b(\\d{1,2})\\s+(${MONTH_PATTERN})\\s+(\\d{4})\\b`, "gi"),
    (_m, day: string, month: string, year: string) =>
      `${year}${MONTHS[month.toLowerCase()]}${day.padStart(2, "0")}`
  );
  out = out.replace(
    new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi"),
    (_m, month: string, day: string, year: string) =>
      `${year}${MONTHS[month.toLowerCase()]}${day.padStart(2, "0")}`
  );
  return out;
}

/** v2 normalization: applies title-abbreviation expansion and date
 * canonicalization before the same lowercasing/punctuation-stripping
 * `normalizeText` already does. */
export function normalizeTextV2(input: string): string {
  return normalizeText(canonicalizeDates(expandTitleSynonyms(input)));
}

