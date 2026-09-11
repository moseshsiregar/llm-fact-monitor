/**
 * Phase 6, second follow-up, item 6 — local, ZERO-COST adversarial unit
 * fixtures for the combined semantic/component adjudication logic
 * (`adjudicateFinalVerdict` in `openRouterFactVerifier.ts`).
 *
 * Updated for Phase 7.1's materiality-weighted, semantic-verdict-dispatched
 * redesign (the old blanket Rule C is gone - see the header doc comment in
 * `openRouterFactVerifier.ts`). Fixtures 1/3/4/6 exercise the UNCHANGED
 * Rule A (contradiction) / Rule B (bag-of-words guard) / Rule E (no
 * informative components) paths and still expect the exact same outcomes
 * as before Phase 7.1. Fixtures 2/5/7/8 exercised the old blanket Rule C
 * and have been updated to reflect the new Case-based expectations.
 * Fixtures 9-11 are NEW, added specifically to validate the new Case 2
 * upgrade path and its PARTIAL-vs-MISSING discriminator, and the new Case 1
 * severity escalation for multiple missing material details.
 *
 * These tests make NO network calls and NO paid API calls. Each fixture
 * supplies a fact/answer pair (so `extractCriticalComponents` /
 * `checkCriticalComponents` run for real against real text) plus a
 * SIMULATED semantic verifier raw verdict (standing in for what an LLM
 * judge might plausibly return), so the adjudication combinator itself can
 * be exercised and checked deterministically, independent of any live
 * model call.
 *
 * Run with: npm run test:adjudication-fixtures
 */
import {
  extractCriticalComponents,
  checkCriticalComponents,
  type CriticalComponentCheckResult,
} from "../src/lib/detection/verifiers/criticalComponents";
import { adjudicateFinalVerdict } from "../src/lib/detection/verifiers/openRouterFactVerifier";
import type { ComponentAdjudication, VerifierRawStatus } from "../src/lib/detection/factVerifier";

interface AdjudicationFixture {
  name: string;
  fact: string;
  answer: string;
  /** The semantic verifier's raw verdict is SIMULATED here (no LLM call) -
   * chosen to stress a specific adjudication rule. */
  simulatedSemanticRawVerdict: VerifierRawStatus;
  /** The semantic verifier's confidence is SIMULATED too - defaults to a
   * high 0.9 (matching `adjudicateFinalVerdict`'s own default) when
   * omitted. Only matters for the Case 2 (semantic NOT_FOUND) upgrade
   * path, which requires moderate-or-lower confidence. */
  simulatedSemanticConfidence?: number;
  expected: {
    componentAdjudication: ComponentAdjudication;
    finalVerdict: VerifierRawStatus;
    disagreement: boolean;
  };
  /** Free-text note on what this fixture is meant to expose/prove. */
  purpose: string;
}

const FIXTURES: AdjudicationFixture[] = [
  {
    name: "1. Same entities + year, wrong relationship",
    fact: "Andy Burnham defeated Sarah Coombes in the 2024 mayoral election.",
    answer: "In the 2024 mayoral election, Andy Burnham and Sarah Coombes both stood as candidates.",
    simulatedSemanticRawVerdict: "NOT_FOUND",
    expected: { componentAdjudication: "FOUND", finalVerdict: "UNCERTAIN", disagreement: true },
    purpose:
      "All entities/year MATCH (bag-of-words would say FOUND), but the relationship ('defeated' vs 'both stood') " +
      "is not entailed. Rule B must not let full component match override a correct semantic NOT_FOUND into FOUND - " +
      "it must land on UNCERTAIN, protecting against the component layer becoming a naive bag-of-words detector.",
  },
  {
    name: "2. Same office, wrong politician",
    fact: "Andy Burnham is the Mayor of Greater Manchester.",
    answer: "Marcus Reed is the Mayor of Greater Manchester.",
    simulatedSemanticRawVerdict: "NOT_FOUND",
    expected: { componentAdjudication: "NOT_FOUND", finalVerdict: "NOT_FOUND", disagreement: false },
    purpose:
      "OFFICE_TITLE and place MATCH but the named person (a CORE_ENTITY component) is MISSING - a different person " +
      "is named instead. Phase 7.1 fix: the old blanket Rule C forced this to PARTIAL_SUPPORT regardless of the " +
      "semantic NOT_FOUND, a known limitation (a wrong-entity substitution is a stronger disqualifier than a " +
      "genuine missing-precision-detail case). The materiality-weighted redesign now correctly treats a MISSING " +
      "CORE_ENTITY (coreIssues > 0) as disqualifying any upgrade, so the verdict stays NOT_FOUND, agreeing with " +
      "the semantic verifier.",
  },
  {
    name: "3. Exact fact contradicted (negation)",
    fact: "Andy Burnham was re-elected in 2024.",
    answer: "Andy Burnham did not stand for re-election in 2024.",
    simulatedSemanticRawVerdict: "FOUND", // simulates a judge fooled by keyword overlap
    expected: { componentAdjudication: "NOT_FOUND", finalVerdict: "NOT_FOUND", disagreement: true },
    purpose:
      "The YEAR component is present but inside a negated clause ('did not stand') - the negation-cue heuristic must " +
      "classify it CONTRADICTED, and Rule A must force NOT_FOUND even though the (simulated, fooled) semantic verdict " +
      "was FOUND.",
  },
  {
    name: "4. Correct proposition, heavy paraphrasing, no informative components",
    fact: "He pledged to expand affordable housing across the region.",
    answer: "In his speech, he committed to a major increase in affordable housing provision throughout the area.",
    simulatedSemanticRawVerdict: "FOUND",
    expected: { componentAdjudication: "NOT_INFORMATIVE", finalVerdict: "FOUND", disagreement: false },
    purpose:
      "No dates/numbers/titles/proper nouns are extractable from this fact at all - Rule E must defer entirely to the " +
      "semantic verifier's paraphrastic judgment (FOUND passes straight through).",
  },
  {
    name: "5. Correct event, missing exact date (the original Phase 6 regression case)",
    fact: "Andy Burnham became Prime Minister of the United Kingdom on 20 July 2026.",
    answer: "Andy Burnham has served as Prime Minister of the United Kingdom since July 2026.",
    simulatedSemanticRawVerdict: "NOT_FOUND", // the actual v2-precision-aware live result for this case
    simulatedSemanticConfidence: 0.7, // moderate - required for the Case 2 upgrade path to fire
    expected: { componentAdjudication: "PARTIAL_SUPPORT", finalVerdict: "PARTIAL_SUPPORT", disagreement: true },
    purpose:
      "This is the exact case that regressed in the last live run (semantic judge overcorrected to NOT_FOUND). " +
      "Under Phase 7.1's Case 2 logic: all core entities/titles (Andy Burnham, Prime Minister, United Kingdom) " +
      "MATCHED, exactly one material detail (DATE) is not matched, and its status is specifically PARTIAL " +
      "(month/year present) rather than MISSING (zero evidence) - combined with only-moderate semantic confidence, " +
      "this narrowly upgrades to PARTIAL_SUPPORT, fixing the regression without a blanket rule.",
  },
  {
    name: "6. Correct date, wrong event",
    fact: "Andy Burnham resigned as Mayor on 20 July 2026.",
    answer: "Andy Burnham was re-elected as Mayor on 20 July 2026.",
    simulatedSemanticRawVerdict: "NOT_FOUND",
    expected: { componentAdjudication: "FOUND", finalVerdict: "UNCERTAIN", disagreement: true },
    purpose:
      "Date/title/person all MATCH, but the event itself ('resigned' vs 're-elected') is different - same protective " +
      "mechanism as fixture 1 (Rule B downgrades a component-FOUND to UNCERTAIN rather than trusting entity/date " +
      "overlap alone).",
  },
  {
    name: "7. Continuous tenure vs. explicit re-election",
    fact: "Andy Burnham was elected Mayor of Greater Manchester in 2017 and was re-elected in 2021 and 2024.",
    answer: "Andy Burnham has served as Mayor of Greater Manchester continuously since 2017.",
    simulatedSemanticRawVerdict: "PARTIAL_SUPPORT", // a correctly-behaving judge under the softened prompt
    expected: { componentAdjudication: "PARTIAL_SUPPORT", finalVerdict: "PARTIAL_SUPPORT", disagreement: false },
    purpose:
      "2021/2024 are not separately stated (continuous tenure only) - two of three YEAR components are MISSING, " +
      "but all core entities/titles (Andy Burnham, Mayor, Greater Manchester) MATCHED, so Case 4 (semantic " +
      "PARTIAL_SUPPORT) keeps PARTIAL_SUPPORT regardless of the material-detail gap count - and here the simulated " +
      "semantic verdict already agrees (disagreement should be false), showing the full-agreement path still works.",
  },
  {
    name: "8. Approximate number vs. exact number",
    fact: "Turnout in the election was 50%.",
    answer: "Turnout in the election was about half of eligible voters.",
    simulatedSemanticRawVerdict: "FOUND", // simulates a permissive judge ignoring the precision rule
    expected: { componentAdjudication: "PARTIAL_SUPPORT", finalVerdict: "PARTIAL_SUPPORT", disagreement: true },
    purpose:
      "'about half' is an approximate paraphrase of '50%' (PARTIAL, not MATCHED, not MISSING), and there are no " +
      "CORE_ENTITY components in this fact at all - Case 1 (semantic FOUND) downgrades a single material-detail " +
      "gap to PARTIAL_SUPPORT regardless of a permissive semantic FOUND.",
  },
  {
    name: "9. NEW (Phase 7.1) - Case 2 upgrade: partial evidence, not zero evidence",
    fact: "Diane Foster became Chancellor of the Exchequer on 12 March 2027.",
    answer: "Diane Foster has served as Chancellor of the Exchequer since March 2027.",
    simulatedSemanticRawVerdict: "NOT_FOUND", // simulates an overly strict judge penalizing the missing exact day
    simulatedSemanticConfidence: 0.65, // moderate/low - required for the upgrade path
    expected: { componentAdjudication: "PARTIAL_SUPPORT", finalVerdict: "PARTIAL_SUPPORT", disagreement: true },
    purpose:
      "Both core entities (Diane Foster, Chancellor) MATCHED, and the only material gap (DATE) is PARTIAL - " +
      "month/year evidence literally exists, only the exact day is missing. Combined with a moderate-confidence " +
      "semantic NOT_FOUND, this fires the new narrow Case 2 upgrade to PARTIAL_SUPPORT.",
  },
  {
    name: "10. NEW (Phase 7.1) - Case 2 non-upgrade: MISSING (zero evidence), not PARTIAL",
    fact: "Diane Foster was first elected to Parliament in 2019.",
    answer:
      "Diane Foster has represented her constituency in Parliament for several years, focusing on local " +
      "infrastructure investment.",
    simulatedSemanticRawVerdict: "NOT_FOUND",
    simulatedSemanticConfidence: 0.6, // deliberately low, to prove confidence alone is not sufficient
    expected: { componentAdjudication: "NOT_FOUND", finalVerdict: "NOT_FOUND", disagreement: false },
    purpose:
      "The only core entity (Diane Foster) MATCHED, and there is exactly one material gap (YEAR), structurally " +
      "similar to fixture 9 - but this YEAR component is MISSING (zero evidence for 2019 anywhere in the answer), " +
      "not PARTIAL. Even at low simulated confidence, the Case 2 upgrade must NOT fire here - this is the exact " +
      "PARTIAL-vs-MISSING discriminator the redesign relies on to avoid upgrading a genuinely unsupported claim " +
      "just because a core entity's name happens to be mentioned.",
  },
  {
    name: "11. NEW (Phase 7.1) - Case 1 severity escalation: multiple missing material details",
    fact: "Diane Foster was elected Mayor of Redcliffe in 2019 with 62% of the vote.",
    answer: "Diane Foster is the Mayor of Redcliffe.",
    simulatedSemanticRawVerdict: "FOUND", // simulates an overly generous judge
    expected: { componentAdjudication: "NOT_FOUND", finalVerdict: "UNCERTAIN", disagreement: true },
    purpose:
      "Core entities (Diane Foster, Mayor) MATCHED, but BOTH material details (YEAR, PERCENTAGE) are entirely " +
      "MISSING from the answer - two absent specifics, not one. Case 1 (semantic FOUND) escalates this to " +
      "UNCERTAIN rather than the milder PARTIAL_SUPPORT a single gap would receive, since a permissive semantic " +
      "FOUND with two unsupported material details is a bigger concern than one imprecise detail.",
  },
];

function formatComponents(checks: CriticalComponentCheckResult[]): string {
  if (checks.length === 0) return "    (none extracted)";
  return checks
    .map(
      (c) =>
        `    - [${c.type}] expected="${c.expected}" -> ${c.status}` +
        (c.matchedEvidence ? ` | evidence="${c.matchedEvidence}"` : "") +
        (c.note ? ` | note: ${c.note}` : "")
    )
    .join("\n");
}

function main() {
  console.log(`Running ${FIXTURES.length} local, zero-cost adjudication fixture(s) - no network calls.\n`);

  let passCount = 0;
  let failCount = 0;

  for (const fx of FIXTURES) {
    console.log("=".repeat(90));
    console.log(fx.name);
    console.log(`Fact:   ${fx.fact}`);
    console.log(`Answer: ${fx.answer}`);
    console.log(`Purpose: ${fx.purpose}`);

    const components = extractCriticalComponents(fx.fact);
    const checks = checkCriticalComponents(components, fx.answer);
    console.log(`Extracted/checked critical components (${checks.length}):`);
    console.log(formatComponents(checks));

    const { componentAdjudication, finalVerdict, disagreement, adjudicationReason } = adjudicateFinalVerdict(
      fx.simulatedSemanticRawVerdict,
      checks,
      fx.simulatedSemanticConfidence
    );

    console.log(`Simulated semantic raw verdict: ${fx.simulatedSemanticRawVerdict}`);
    console.log(`Computed componentAdjudication: ${componentAdjudication} (expected ${fx.expected.componentAdjudication})`);
    console.log(`Computed finalVerdict: ${finalVerdict} (expected ${fx.expected.finalVerdict})`);
    console.log(`Computed disagreement: ${disagreement} (expected ${fx.expected.disagreement})`);
    console.log(`Adjudication reason: ${adjudicationReason}`);

    const pass =
      componentAdjudication === fx.expected.componentAdjudication &&
      finalVerdict === fx.expected.finalVerdict &&
      disagreement === fx.expected.disagreement;

    console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");
    if (pass) passCount++;
    else failCount++;
    console.log();
  }

  console.log("=".repeat(90));
  console.log(`Summary: ${passCount} passed, ${failCount} failed, out of ${FIXTURES.length} fixture(s).`);
  if (failCount > 0) {
    process.exitCode = 1;
  }
}

main();
