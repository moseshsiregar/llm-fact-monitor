import { MONTHS, MONTH_PATTERN } from "../normalize";

/**
 * Phase 6 follow-up — deterministic "precision awareness" layer.
 *
 * The 3-fixture semantic test exposed a real validity problem: the LLM
 * judge treated "since July 2026" as FOUND support for a fact requiring
 * "20 July 2026" - i.e. it silently weakened an exact date to month-level
 * granularity. Rather than trying to fix this purely by asking the LLM to
 * "try harder" (prompt-only fixes are not verifiable/auditable), this
 * module deterministically extracts the "critical components" that carry
 * the factual PRECISION of a monitored fact (exact dates, years, numbers,
 * percentages, named offices/titles, obvious proper nouns) and checks
 * whether the answer text actually supports each one at the SAME
 * granularity - independent of, and after, whatever the semantic judge
 * says. A semantic FOUND can be downgraded by this layer; it can never be
 * upgraded (this module only tightens, never loosens, adjudication).
 *
 * Deliberately NOT an exhaustive NLP/NER pipeline - simple, transparent,
 * regex-based checks for a bounded set of high-value component types, per
 * the "do not build an enormous brittle ontology" instruction.
 */

export type CriticalComponentType =
  | "DATE"
  | "MONTH_YEAR"
  | "YEAR"
  | "NUMBER"
  | "PERCENTAGE"
  | "OFFICE_TITLE"
  | "PROPER_NOUN";

/**
 * Phase 7.1 — materiality classification, independent of component TYPE.
 * This is what lets the adjudication layer weigh a missing named entity or
 * office/title (CORE_ENTITY) far more heavily than a missing exact day or
 * incidental number (MATERIAL_DETAIL), instead of treating every component
 * as equally important. CORE_PREDICATE and OPTIONAL_DETAIL are reserved for
 * future extraction (predicate/relationship detection is deliberately left
 * to the semantic verifier, not extracted deterministically here); no
 * current `CriticalComponentType` maps to them yet.
 */
export type ComponentMateriality = "CORE_ENTITY" | "CORE_PREDICATE" | "MATERIAL_DETAIL" | "OPTIONAL_DETAIL";

function materialityForType(type: CriticalComponentType): ComponentMateriality {
  switch (type) {
    case "PROPER_NOUN":
    case "OFFICE_TITLE":
      return "CORE_ENTITY";
    case "DATE":
    case "MONTH_YEAR":
    case "YEAR":
    case "NUMBER":
    case "PERCENTAGE":
      return "MATERIAL_DETAIL";
  }
}

export interface ExtractedCriticalComponent {
  type: CriticalComponentType;
  /** Verbatim substring from the canonical fact text this was derived from. */
  text: string;
  /** Normalized comparison value: YYYYMMDD (DATE), YYYYMM (MONTH_YEAR),
   * YYYY (YEAR), bare numeric string (NUMBER/PERCENTAGE), lowercased
   * trimmed phrase (OFFICE_TITLE/PROPER_NOUN). */
  normalizedValue: string;
  /** How much this component's status should weigh in adjudication. */
  materiality: ComponentMateriality;
}

export type CriticalComponentStatus = "MATCHED" | "PARTIAL" | "MISSING" | "CONTRADICTED";

export interface CriticalComponentCheckResult {
  type: CriticalComponentType;
  expected: string;
  status: CriticalComponentStatus;
  matchedEvidence: string | null;
  note?: string;
  materiality: ComponentMateriality;
}

interface Span {
  start: number;
  end: number;
}

function overlapsAny(span: Span, spans: Span[]): boolean {
  return spans.some((s) => span.start < s.end && span.end > s.start);
}

/** A short, bounded list of common political/institutional titles - NOT a
 * general ontology. Matched case-insensitively as whole phrases. Extend
 * deliberately and sparingly. */
const OFFICE_TITLES = [
  "prime minister",
  "president",
  "vice president",
  "deputy prime minister",
  "mayor",
  "deputy mayor",
  "chancellor",
  "foreign secretary",
  "home secretary",
  "health secretary",
  "education secretary",
  "chief secretary to the treasury",
  "secretary of state",
  "minister",
  "member of parliament",
  "senator",
  "governor",
  "leader of the labour party",
  "leader of the opposition",
  "speaker of the house",
  "attorney general",
];

const APPROXIMATION_WORDS = [
  "half",
  "quarter",
  "third",
  "majority",
  "most",
  "nearly",
  "almost",
  "approximately",
  "around",
  "about",
  "roughly",
];

/** A small, bounded set of negation cues. Used only to catch the fairly
 * common case where a bare substring match (e.g. a year or number) sits
 * inside a sentence that actually DENIES the proposition ("did not stand
 * in 2024") - without this, a plain substring check would wrongly treat
 * that as MATCHED. Deliberately simple/sentence-scoped, not a general
 * negation/NLI system. */
const NEGATION_CUES = [
  "not",
  "never",
  "no longer",
  "didn't",
  "doesn't",
  "wasn't",
  "weren't",
  "isn't",
  "aren't",
  "failed to",
  "declined to",
  "refused to",
];

/** Returns the sentence (bounded by '.', '!', '?', or string start/end)
 * containing the character at `index`, so a negation cue elsewhere in the
 * answer doesn't spuriously affect an unrelated match. */
function sentenceContaining(text: string, index: number): string {
  const boundaryStarts = [text.lastIndexOf(".", index), text.lastIndexOf("!", index), text.lastIndexOf("?", index)];
  const start = Math.max(...boundaryStarts) + 1;
  const boundaryEnds = [text.indexOf(".", index), text.indexOf("!", index), text.indexOf("?", index)].filter(
    (i) => i !== -1
  );
  const end = boundaryEnds.length > 0 ? Math.min(...boundaryEnds) : text.length;
  return text.slice(start, end);
}

function hasNegationCue(sentence: string): boolean {
  const lower = sentence.toLowerCase();
  return NEGATION_CUES.some((cue) => lower.includes(cue));
}


// ---------------------------------------------------------------------------
// Extraction (from the canonical FACT text)
// ---------------------------------------------------------------------------

const FULL_DATE_DMY = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\s+(\\d{4})\\b`, "gi");
const FULL_DATE_MDY = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi");
const MONTH_YEAR_RE = new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{4})\\b`, "gi");
const YEAR_RE = /\b(\d{4})\b/g;
const PERCENTAGE_RE = /\b(\d+(?:\.\d+)?)\s?%/g;
const NUMBER_RE = /\b(\d+(?:\.\d+)?)\b/g;
const PROPER_NOUN_RE = /\b([A-Z][a-zA-Z'\u2019-]*(?:\s+[A-Z][a-zA-Z'\u2019-]*)+)\b/g;

export function extractCriticalComponents(factText: string): ExtractedCriticalComponent[] {
  const components: ExtractedCriticalComponent[] = [];
  const consumed: Span[] = [];

  // 1. Full dates (day + month + year), both orderings.
  for (const re of [FULL_DATE_DMY, FULL_DATE_MDY]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(factText))) {
      const span: Span = { start: m.index, end: m.index + m[0].length };
      if (overlapsAny(span, consumed)) continue;
      let day: string, month: string, year: string;
      if (re === FULL_DATE_DMY) {
        [, day, month, year] = m;
      } else {
        [, month, day, year] = m;
      }
      const mm = MONTHS[month.toLowerCase()];
      components.push({
        type: "DATE",
        text: m[0],
        normalizedValue: `${year}${mm}${day.padStart(2, "0")}`,
        materiality: materialityForType("DATE"),
      });
      consumed.push(span);
    }
  }

  // 2. Month + year (no day), skipping spans already consumed by a full date.
  MONTH_YEAR_RE.lastIndex = 0;
  {
    let m: RegExpExecArray | null;
    while ((m = MONTH_YEAR_RE.exec(factText))) {
      const span: Span = { start: m.index, end: m.index + m[0].length };
      if (overlapsAny(span, consumed)) continue;
      const [, month, year] = m;
      components.push({
        type: "MONTH_YEAR",
        text: m[0],
        normalizedValue: `${year}${MONTHS[month.toLowerCase()]}`,
        materiality: materialityForType("MONTH_YEAR"),
      });
      consumed.push(span);
    }
  }

  // 3. Standalone years, skipping spans already consumed above.
  YEAR_RE.lastIndex = 0;
  {
    let m: RegExpExecArray | null;
    while ((m = YEAR_RE.exec(factText))) {
      const span: Span = { start: m.index, end: m.index + m[0].length };
      if (overlapsAny(span, consumed)) continue;
      components.push({ type: "YEAR", text: m[0], normalizedValue: m[1], materiality: materialityForType("YEAR") });
      consumed.push(span);
    }
  }

  // 4. Percentages.
  PERCENTAGE_RE.lastIndex = 0;
  {
    let m: RegExpExecArray | null;
    while ((m = PERCENTAGE_RE.exec(factText))) {
      const span: Span = { start: m.index, end: m.index + m[0].length };
      if (overlapsAny(span, consumed)) continue;
      components.push({
        type: "PERCENTAGE",
        text: m[0],
        normalizedValue: m[1],
        materiality: materialityForType("PERCENTAGE"),
      });
      consumed.push(span);
    }
  }

  // 5. Remaining standalone numbers (not already part of a date/year/percentage).
  NUMBER_RE.lastIndex = 0;
  {
    let m: RegExpExecArray | null;
    while ((m = NUMBER_RE.exec(factText))) {
      const span: Span = { start: m.index, end: m.index + m[0].length };
      if (overlapsAny(span, consumed)) continue;
      components.push({ type: "NUMBER", text: m[0], normalizedValue: m[1], materiality: materialityForType("NUMBER") });
      consumed.push(span);
    }
  }

  // 6. Named offices/titles (bounded keyword list). Longest phrases first
  // so e.g. "prime minister" is claimed before the shorter "minister"
  // would otherwise redundantly match the same span. Uses a word-boundary
  // regex (not a plain substring search) so e.g. "mayoral election" does
  // NOT spuriously extract "mayor" out of the middle of "mayoral" -
  // extraction must stay consistent with `checkOfficeTitle`, which already
  // requires a word-boundary match against the answer.
  const titlesByLength = [...OFFICE_TITLES].sort((a, b) => b.length - a.length);
  for (const title of titlesByLength) {
    const titleRe = new RegExp(`\\b${escapeRegExp(title)}\\b`, "i");
    const match = titleRe.exec(factText);
    if (!match) continue;
    const span: Span = { start: match.index, end: match.index + match[0].length };
    if (overlapsAny(span, consumed)) continue;
    components.push({
      type: "OFFICE_TITLE",
      text: match[0],
      normalizedValue: title,
      materiality: materialityForType("OFFICE_TITLE"),
    });
    consumed.push(span);
  }

  // 7. Obvious proper-noun entities: runs of 2+ consecutive capitalized
  // words, excluding anything already claimed by an office/title match.
  PROPER_NOUN_RE.lastIndex = 0;
  {
    const seen = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = PROPER_NOUN_RE.exec(factText))) {
      const span: Span = { start: m.index, end: m.index + m[0].length };
      if (overlapsAny(span, consumed)) continue;
      const normalized = m[1].toLowerCase();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      components.push({
        type: "PROPER_NOUN",
        text: m[1],
        normalizedValue: normalized,
        materiality: materialityForType("PROPER_NOUN"),
      });
    }
  }

  return components;
}

// ---------------------------------------------------------------------------
// Checking (against the ANSWER text)
// ---------------------------------------------------------------------------

function findFullDates(text: string): { normalizedValue: string; raw: string; index: number }[] {
  const out: { normalizedValue: string; raw: string; index: number }[] = [];
  for (const re of [FULL_DATE_DMY, FULL_DATE_MDY]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      let day: string, month: string, year: string;
      if (re === FULL_DATE_DMY) {
        [, day, month, year] = m;
      } else {
        [, month, day, year] = m;
      }
      out.push({
        normalizedValue: `${year}${MONTHS[month.toLowerCase()]}${day.padStart(2, "0")}`,
        raw: m[0],
        index: m.index,
      });
    }
  }
  return out;
}

function findMonthYears(text: string): { normalizedValue: string; raw: string; index: number }[] {
  const out: { normalizedValue: string; raw: string; index: number }[] = [];
  MONTH_YEAR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MONTH_YEAR_RE.exec(text))) {
    out.push({ normalizedValue: `${m[2]}${MONTHS[m[1].toLowerCase()]}`, raw: m[0], index: m.index });
  }
  return out;
}

/** Grabs a short, readable snippet of surrounding context for a match, so
 * evidence like "since July 2026" (not just "July 2026") is preserved. */
function contextSnippet(text: string, index: number, matchLength: number, radius = 20): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + matchLength + radius);
  const prefix = start > 0 ? "\u2026" : "";
  const suffix = end < text.length ? "\u2026" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

/** Internal check-function return shape, before the caller attaches the
 * `materiality` tag (which comes from the originating `ExtractedCriticalComponent`,
 * not from the check logic itself). */
type RawCheckResult = Omit<CriticalComponentCheckResult, "materiality">;

function checkDate(expected: string, expectedText: string, answer: string): RawCheckResult {
  const dates = findFullDates(answer);
  const exact = dates.find((d) => d.normalizedValue === expected);
  if (exact) {
    return { type: "DATE", expected: expectedText, status: "MATCHED", matchedEvidence: exact.raw };
  }
  const expectedYearMonth = expected.slice(0, 6);
  const conflicting = dates.find((d) => d.normalizedValue.slice(0, 6) === expectedYearMonth);
  if (conflicting) {
    return {
      type: "DATE",
      expected: expectedText,
      status: "CONTRADICTED",
      matchedEvidence: conflicting.raw,
      note: `Answer asserts a different day (${conflicting.raw}) within the same month/year.`,
    };
  }
  const monthYears = findMonthYears(answer);
  const monthYearMatch = monthYears.find((my) => my.normalizedValue === expectedYearMonth);
  if (monthYearMatch) {
    return {
      type: "DATE",
      expected: expectedText,
      status: "PARTIAL",
      matchedEvidence: contextSnippet(answer, monthYearMatch.index, monthYearMatch.raw.length),
      note: "Answer supports the month and year but does not state the specific day required by the fact.",
    };
  }
  const expectedYear = expected.slice(0, 4);
  const yearRe = new RegExp(`\\b${expectedYear}\\b`);
  const yearMatch = yearRe.exec(answer);
  if (yearMatch) {
    return {
      type: "DATE",
      expected: expectedText,
      status: "PARTIAL",
      matchedEvidence: contextSnippet(answer, yearMatch.index, yearMatch[0].length),
      note: "Answer only supports the year; month and day are not established.",
    };
  }
  return { type: "DATE", expected: expectedText, status: "MISSING", matchedEvidence: null };
}

function checkMonthYear(expected: string, expectedText: string, answer: string): RawCheckResult {
  const dates = findFullDates(answer);
  const dateMatch = dates.find((d) => d.normalizedValue.slice(0, 6) === expected);
  if (dateMatch) {
    return { type: "MONTH_YEAR", expected: expectedText, status: "MATCHED", matchedEvidence: dateMatch.raw };
  }
  const monthYears = findMonthYears(answer);
  const monthYearMatch = monthYears.find((my) => my.normalizedValue === expected);
  if (monthYearMatch) {
    return {
      type: "MONTH_YEAR",
      expected: expectedText,
      status: "MATCHED",
      matchedEvidence: contextSnippet(answer, monthYearMatch.index, monthYearMatch.raw.length),
    };
  }
  const expectedYear = expected.slice(0, 4);
  const yearRe = new RegExp(`\\b${expectedYear}\\b`);
  const yearMatch = yearRe.exec(answer);
  if (yearMatch) {
    return {
      type: "MONTH_YEAR",
      expected: expectedText,
      status: "PARTIAL",
      matchedEvidence: contextSnippet(answer, yearMatch.index, yearMatch[0].length),
      note: "Answer only supports the year; the specific month is not established.",
    };
  }
  return { type: "MONTH_YEAR", expected: expectedText, status: "MISSING", matchedEvidence: null };
}

function checkYear(expected: string, expectedText: string, answer: string): RawCheckResult {
  const yearRe = new RegExp(`\\b${expected}\\b`);
  const match = yearRe.exec(answer);
  if (match) {
    const sentence = sentenceContaining(answer, match.index);
    if (hasNegationCue(sentence)) {
      return {
        type: "YEAR",
        expected: expectedText,
        status: "CONTRADICTED",
        matchedEvidence: contextSnippet(answer, match.index, match[0].length),
        note: "The year appears in the answer, but within an apparently negated statement (e.g. \"did not\"/\"never\") - treated as contradicting rather than confirming the fact.",
      };
    }
    return {
      type: "YEAR",
      expected: expectedText,
      status: "MATCHED",
      matchedEvidence: contextSnippet(answer, match.index, match[0].length),
    };
  }
  return { type: "YEAR", expected: expectedText, status: "MISSING", matchedEvidence: null };
}

function checkPercentage(expected: string, expectedText: string, answer: string): RawCheckResult {
  PERCENTAGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  const found: { value: string; raw: string; index: number }[] = [];
  while ((m = PERCENTAGE_RE.exec(answer))) {
    found.push({ value: m[1], raw: m[0], index: m.index });
  }
  const exact = found.find((f) => f.value === expected);
  if (exact) {
    if (hasNegationCue(sentenceContaining(answer, exact.index))) {
      return {
        type: "PERCENTAGE",
        expected: expectedText,
        status: "CONTRADICTED",
        matchedEvidence: exact.raw,
        note: "The percentage appears in the answer, but within an apparently negated statement - treated as contradicting rather than confirming the fact.",
      };
    }
    return { type: "PERCENTAGE", expected: expectedText, status: "MATCHED", matchedEvidence: exact.raw };
  }
  if (found.length > 0) {
    return {
      type: "PERCENTAGE",
      expected: expectedText,
      status: "CONTRADICTED",
      matchedEvidence: found[0].raw,
      note: `Answer states a different percentage (${found[0].raw}) than the fact's ${expectedText}.`,
    };
  }
  const approxWordRe = new RegExp(`\\b(${APPROXIMATION_WORDS.join("|")})\\b`, "i");
  const approxMatch = approxWordRe.exec(answer);
  if (approxMatch) {
    return {
      type: "PERCENTAGE",
      expected: expectedText,
      status: "PARTIAL",
      matchedEvidence: contextSnippet(answer, approxMatch.index, approxMatch[0].length),
      note: "Possible approximate/paraphrased numeric match - exact precision not confirmed deterministically.",
    };
  }
  return { type: "PERCENTAGE", expected: expectedText, status: "MISSING", matchedEvidence: null };
}

function checkNumber(expected: string, expectedText: string, answer: string): RawCheckResult {
  const exactRe = new RegExp(`\\b${expected.replace(".", "\\.")}\\b`);
  const exact = exactRe.exec(answer);
  if (exact) {
    if (hasNegationCue(sentenceContaining(answer, exact.index))) {
      return {
        type: "NUMBER",
        expected: expectedText,
        status: "CONTRADICTED",
        matchedEvidence: exact[0],
        note: "The number appears in the answer, but within an apparently negated statement - treated as contradicting rather than confirming the fact.",
      };
    }
    return { type: "NUMBER", expected: expectedText, status: "MATCHED", matchedEvidence: exact[0] };
  }
  const approxWordRe = new RegExp(`\\b(${APPROXIMATION_WORDS.join("|")})\\b`, "i");
  const approxMatch = approxWordRe.exec(answer);
  if (approxMatch) {
    return {
      type: "NUMBER",
      expected: expectedText,
      status: "PARTIAL",
      matchedEvidence: contextSnippet(answer, approxMatch.index, approxMatch[0].length),
      note: "Possible approximate/paraphrased numeric match - exact precision not confirmed deterministically.",
    };
  }
  return { type: "NUMBER", expected: expectedText, status: "MISSING", matchedEvidence: null };
}

/** Reverse abbreviation map for the small set of title abbreviations this
 * module recognizes, so an answer using "PM"/"MP" is matched without
 * mutating (and thereby misaligning the character indices of) the answer
 * text being searched. */
const ABBREVIATION_FOR: Record<string, string> = {
  "prime minister": "pm",
  "member of parliament": "mp",
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function checkOfficeTitle(expected: string, expectedText: string, answer: string): RawCheckResult {
  const alternatives = [escapeRegExp(expected)];
  const abbrev = ABBREVIATION_FOR[expected];
  if (abbrev) alternatives.push(escapeRegExp(abbrev));
  const re = new RegExp(`\\b(${alternatives.join("|")})\\b`, "i");
  const match = re.exec(answer);
  if (!match) {
    return { type: "OFFICE_TITLE", expected: expectedText, status: "MISSING", matchedEvidence: null };
  }
  return { type: "OFFICE_TITLE", expected: expectedText, status: "MATCHED", matchedEvidence: match[0] };
}

function checkProperNoun(expected: string, expectedText: string, answer: string): RawCheckResult {
  const idx = answer.toLowerCase().indexOf(expected);
  if (idx === -1) {
    return { type: "PROPER_NOUN", expected: expectedText, status: "MISSING", matchedEvidence: null };
  }
  return {
    type: "PROPER_NOUN",
    expected: expectedText,
    status: "MATCHED",
    matchedEvidence: answer.slice(idx, idx + expected.length),
  };
}

/**
 * Checks each extracted critical component (from the fact) against the
 * answer text, at the SAME granularity the fact requires. Never consults
 * the semantic verifier's own output - this is a purely deterministic,
 * independent cross-check.
 */
export function checkCriticalComponents(
  components: ExtractedCriticalComponent[],
  answerText: string
): CriticalComponentCheckResult[] {
  return components.map((c) => {
    let result: RawCheckResult;
    switch (c.type) {
      case "DATE":
        result = checkDate(c.normalizedValue, c.text, answerText);
        break;
      case "MONTH_YEAR":
        result = checkMonthYear(c.normalizedValue, c.text, answerText);
        break;
      case "YEAR":
        result = checkYear(c.normalizedValue, c.text, answerText);
        break;
      case "PERCENTAGE":
        result = checkPercentage(c.normalizedValue, c.text, answerText);
        break;
      case "NUMBER":
        result = checkNumber(c.normalizedValue, c.text, answerText);
        break;
      case "OFFICE_TITLE":
        result = checkOfficeTitle(c.normalizedValue, c.text, answerText);
        break;
      case "PROPER_NOUN":
        result = checkProperNoun(c.normalizedValue, c.text, answerText);
        break;
    }
    return { ...result, materiality: c.materiality };
  });
}
